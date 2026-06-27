import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Json = Record<string, any>;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sync-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ORDERMENTUM_AUTH_URL = "https://app.ordermentum.com/v1/auth";
const ORDERMENTUM_API_BASE = "https://api.ordermentum.com";
const ORDERMENTUM_APP_BASE = "https://app.ordermentum.com";
const ORDERMENTUM_STOCK_BASE = "https://stock.ordermentum.com/v1";

let tokenCache: { token: string; expiresAt: number } | null = null;

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asDate(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function imageUrl(input: any): string | null {
  return (
    input?.image?.secure_url ??
    input?.image?.data?.secure_url ??
    input?.images?.original ??
    input?.images?.large ??
    input?.product?.image?.secure_url ??
    input?.product?.images?.original ??
    null
  );
}

function chunk<T>(items: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getOrdermentumToken(): Promise<string> {
  const now = Date.now();

  // Ordermentum token is roughly 24 hours. Refresh at 23h to avoid expiry edge cases.
  if (tokenCache && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.token;
  }

  const username = requiredEnv("ORDERMENTUM_USERNAME");
  const password = requiredEnv("ORDERMENTUM_PASSWORD");

  const res = await fetch(ORDERMENTUM_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(
      `Ordermentum auth failed ${res.status}: ${JSON.stringify(body)}`
    );
  }

  const token = body.access_token ?? body.token;

  if (!token) {
    throw new Error(`Ordermentum auth did not return access_token`);
  }

  tokenCache = {
    token,
    expiresAt: now + 23 * 60 * 60 * 1000,
  };

  return token;
}

async function omFetch<T = Json>(
  path: string,
  token: string,
  base: "api" | "app" = "api"
): Promise<T> {
  const root = base === "api" ? ORDERMENTUM_API_BASE : ORDERMENTUM_APP_BASE;
  const url = `${root}${path}`;

  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const body = await res.json().catch(() => ({}));

    if (res.ok) {
      return body as T;
    }

    if (res.status === 429) {
      const retryAfterSeconds = Number(res.headers.get("retry-after"));
      const waitMs =
        Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? retryAfterSeconds * 1000
          : Math.min(45_000, 2_000 * Math.pow(2, attempt));

      console.log(
        `Ordermentum 429 rate limited. Waiting ${waitMs}ms. Attempt ${
          attempt + 1
        }/6. Path: ${path}`
      );

      await sleep(waitMs);
      continue;
    }

    throw new Error(
      `Ordermentum fetch failed ${res.status} ${path}: ${JSON.stringify(body)}`
    );
  }

  throw new Error(`Ordermentum fetch failed after retries: ${path}`);
}

async function omFetchWithFallback<T = Json>(
  path: string,
  token: string
): Promise<T> {
  try {
    return await omFetch<T>(path, token, "api");
  } catch (err) {
    console.log(`API base failed for ${path}, retrying app base`, String(err));
    return await omFetch<T>(path, token, "app");
  }
}

async function fetchPaged(
  pathFactory: (pageNo: number) => string,
  token: string,
  base: "api" | "app" = "api",
  maxPages = 500,
  delayMs = 250
): Promise<Json[]> {
  const all: Json[] = [];

  for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
    if (pageNo > 1 && delayMs > 0) await sleep(delayMs);

    const page = await omFetch<Json>(pathFactory(pageNo), token, base);
    const data = Array.isArray(page.data) ? page.data : [];

    all.push(...data);

    const totalPages = Number(page.meta?.totalPages ?? 1);
    if (pageNo >= totalPages) break;
  }

  return all;
}

async function upsertRawPayloads(
  supabase: any,
  entityType: string,
  records: Json[],
  idKey = "id"
) {
  const rows = records
    .filter((r) => r?.[idKey])
    .map((r) => ({
      entity_type: entityType,
      entity_id: String(r[idKey]),
      payload: r,
      synced_at: new Date().toISOString(),
    }));

  for (const part of chunk(rows, 200)) {
    const { error } = await supabase
      .from("om_raw_payloads")
      .upsert(part, { onConflict: "entity_type,entity_id" });

    if (error) throw error;
  }
}

function mapPriceGroup(pg: Json) {
  return {
    id: pg.id,
    supplier_id: pg.supplierId,
    name: pg.name,
    is_default: Boolean(pg.default),
    retailers_total: asNumber(pg.retailersTotal),
    products_total: asNumber(pg.productsTotal),
    external_id: pg.externalId ?? null,
    raw_json: pg,
    created_at: asDate(pg.createdAt),
    updated_at: asDate(pg.updatedAt),
    deleted_at: asDate(pg.deletedAt),
  };
}

function mapProduct(p: Json) {
  return {
    id: p.id,
    supplier_id: p.supplierId,
    name: p.name,
    sku: p.SKU ?? p.sku ?? p.variant?.SKU ?? null,
    base_price: asNumber(p.basePrice),
    price: asNumber(p.price),
    cost: asNumber(p.cost),
    category_names: Array.isArray(p.categoryNames) ? p.categoryNames : [],
    description: p.description ?? null,
    image_url: imageUrl(p),
    unit: p.unit ?? p.variant?.unit ?? null,
    uom: p.uom ?? p.variant?.uom ?? null,
    unit_size: asNumber(p.unitSize),
    min_quantity: asNumber(p.minQuantity),
    max_quantity: asNumber(p.maxQuantity),
    tax_type: p.taxType ?? null,
    out_of_stock: p.outOfStock ?? null,
    stock_tracking: p.stockTracking ?? null,
    variant_id: p.variantId ?? p.variant?.id ?? null,
    badge_label: p.badgeLabel ?? null,
    featured: p.featured ?? null,
    raw_json: p,
    created_at: asDate(p.createdAt),
    updated_at: asDate(p.updatedAt),
    deleted_at: asDate(p.deletedAt ?? p.deactivatedAt),
  };
}

function mapVariant(v: Json, supplierId: string) {
  return {
    id: v.id,
    product_id: v.productId ?? null,
    supplier_id: v.supplierId ?? supplierId,
    sku: v.SKU ?? v.sku ?? null,
    name: v.name,
    price: asNumber(v.price),
    base_price: asNumber(v.basePrice),
    cost: asNumber(v.cost),
    barcode: v.barcode ?? null,
    unit: v.unit ?? null,
    uom: v.uom ?? null,
    unit_size: asNumber(v.unitSize),
    packing_unit: asNumber(v.packingUnit),
    visible: v.visible ?? null,
    out_of_stock: v.outOfStock ?? null,
    tracked: v.tracked ?? null,
    available: asNumber(v.available),
    allow_oversell: v.allowOversell ?? null,
    raw_json: v,
    created_at: asDate(v.createdAt),
    updated_at: asDate(v.updatedAt),
    deleted_at: asDate(v.deletedAt ?? v.deactivatedAt),
  };
}

function mapProductPrices(product: Json) {
  const prices = product.prices ?? {};
  const configs = product.priceConfig ?? {};
  const productId = product.id;

  return Object.entries(prices)
    .filter(([priceGroupId]) => Boolean(priceGroupId && productId))
    .map(([priceGroupId, price]) => {
      const config = configs[priceGroupId] ?? {};

      return {
        product_id: productId,
        price_group_id: priceGroupId,
        price: asNumber(price),
        config_type: config.type ?? null,
        percent: asNumber(config.percent),
        raw_json: config,
        updated_at: new Date().toISOString(),
      };
    });
}

function mapCustomer(p: Json) {
  const deliveryAddress =
    p.retailerAddress ??
    p.deliveryAddress ??
    p.retailer?.address ??
    p.address ??
    null;

  const billingAddress =
    p.billingAddress ??
    p.retailer?.billingAddress ??
    p.retailer?.billing_address ??
    null;

  return {
    purchaser_id: p.id,
    retailer_id: p.retailerId ?? p.retailer?.id ?? null,
    supplier_id: p.supplierId,
    reference: p.reference ?? null,
    name: p.name ?? p.retailerName ?? p.retailer?.name ?? null,
    retailer_name: p.retailerName ?? p.retailer?.name ?? null,
    legal_name: p.retailerLegalName ?? p.retailer?.legalName ?? null,
    trading_name: p.retailerTradingName ?? p.retailer?.tradingName ?? null,
    abn: p.retailerAbn ?? p.retailer?.abn ?? null,
    email: p.retailerEmail ?? p.retailer?.email ?? null,
    billing_email: p.retailerBillingEmail ?? p.retailer?.billingEmail ?? null,
    phone: p.retailerPhone ?? p.retailer?.phone ?? null,
    price_group_id: p.priceGroupId ?? p.priceGroup?.id ?? null,
    freight_group_id: p.freightGroupId ?? null,
    visibility_group_id: p.visibilityGroupId ?? null,
    payment_delay: asNumber(p.paymentDelay),
    payment_schedule: p.paymentSchedule ?? null,
    default_payment_method:
      p.defaultPaymentMethodType?.value ?? p.defaultPaymentMethodType ?? null,
    payment_method_display:
      p.paymentMethodTypes?.display ??
      p.defaultPaymentMethodType?.display ??
      null,
    stop_credit: p.stopCredit ?? null,
    minimum_order_value: asNumber(p.minimumOrderValue),
    days_since_last_order: asNumber(p.daysSinceLastOrder),
    delivery_instructions: p.deliveryInstructions ?? null,
    notes: p.notes ?? null,
    delivery_address: deliveryAddress,
    billing_address: billingAddress,
    latitude: asNumber(
      deliveryAddress?.latitude ?? deliveryAddress?.lat ?? p.latitude
    ),
    longitude: asNumber(
      deliveryAddress?.longitude ?? deliveryAddress?.lng ?? p.longitude
    ),
    first_ordered_at: asDate(p.firstOrderedAt),
    ordered_at: asDate(p.orderedAt),
    activated_at: asDate(p.activatedAt),
    archived: p.archived ?? null,
    disabled: p.disabled ?? null,
    raw_json: p,
    created_at: asDate(p.createdAt),
    updated_at: asDate(p.updatedAt),
  };
}

function mapOrder(o: Json) {
  return {
    id: o.id,
    supplier_id: o.supplierId,
    purchaser_id: o.purchaserId ?? o.purchaser?.id ?? null,
    retailer_id: o.retailerId ?? o.retailer?.id ?? null,
    invoice_id: o.invoiceId ?? o.invoice?.id ?? null,
    order_number: o.orderNumber ?? o.number ?? null,
    status: o.status ?? null,
    order_status: o.orderStatus ?? null,
    payment_status:
      o.paymentStatus ?? o.invoice?.invoiceStatusLabel ?? o.invoice?.status ?? null,
    retailer_name: o.retailerName ?? o.retailer?.name ?? null,
    delivery_date: asDate(o.deliveryDate),
    due_at: asDate(o.dueAt),
    created_at: asDate(o.createdAt),
    updated_at: asDate(o.updatedAt),
    cancelled_at: asDate(o.cancelledAt),
    cancelled: Boolean(o.cancelled),
    placed_by_retailer: o.placedByRetailer ?? null,
    invoice_number: o.invoiceNumber ?? o.invoice?.number ?? null,
    subtotal: asNumber(o.subtotal),
    total_gst: asNumber(o.totalGST ?? o.gst),
    total_freight: asNumber(o.totalFreight ?? o.freight),
    surcharge: asNumber(o.surcharge),
    total_discount: asNumber(o.totalDiscount ?? o.discount),
    total: asNumber(o.total),
    total_due: asNumber(o.totalDue),
    total_quantity: asNumber(o.totalQuantity),
    line_count: asNumber(o.lineCount),
    customer_reference: o.customerReference ?? null,
    raw_json: o,
  };
}

function mapOrderItem(item: Json, orderId: string) {
  return {
    id: item.id,
    order_id: orderId,
    product_id: item.productId ?? item.product?.id ?? null,
    variant_id:
      item.variantId ?? item.product?.variantId ?? item.variant?.id ?? null,
    sku:
      item.SKU ??
      item.sku ??
      item.product?.SKU ??
      item.product?.sku ??
      item.variant?.SKU ??
      item.variant?.sku ??
      null,
    name: item.name ?? item.product?.name ?? "Unknown product",
    quantity: asNumber(item.quantity),
    price: asNumber(item.price),
    rate_price: asNumber(item.ratePrice),
    subtotal: asNumber(item.subtotal),
    gst: asNumber(item.gst),
    tax: asNumber(item.tax),
    total: asNumber(item.total),
    unit: item.unit ?? item.variant?.unit ?? item.product?.unit ?? null,
    uom: item.uom ?? item.variant?.uom ?? item.product?.uom ?? null,
    packing_unit: asNumber(item.packingUnit ?? item.variant?.packingUnit),
    batch_code: item.batchCode ?? item.product?.batchCode ?? null,
    description: item.description ?? item.product?.description ?? null,
    image_url: imageUrl(item),
    raw_json: item,
    created_at: asDate(item.createdAt),
    updated_at: asDate(item.updatedAt),
  };
}

function mapInvoice(i: Json) {
  return {
    id: i.id,
    supplier_id: i.supplierId ?? i.supplier_id,
    purchaser_id: i.purchaserId ?? i.purchaser_id ?? i.purchaser?.id ?? null,
    retailer_id: i.retailerId ?? i.retailer_id ?? i.retailer?.id ?? null,
    number: i.number ?? null,
    reference: i.reference ?? null,
    status: i.status ?? null,
    payment_status: i.paymentStatus ?? i.invoiceStatusLabel ?? i.status ?? null,
    invoice_status: i.invoiceStatus ?? null,
    payment_method: i.paymentMethod ?? null,
    payment_transaction_id: i.paymentTransactionId ?? null,
    settlement_reference: i.settlementReference ?? null,
    paid_at: asDate(i.paidAt),
    paid_supplier_at: asDate(i.paidSupplierAt),
    due_at: asDate(i.dueAt),
    charge_at: asDate(i.chargeAt),
    date: asDate(i.date),
    subtotal: asNumber(i.subtotal),
    total_gst: asNumber(i.totalGST ?? i.gst),
    total_freight: asNumber(i.totalFreight ?? i.freight),
    surcharge: asNumber(i.surcharge),
    total_discount: asNumber(i.totalDiscount ?? i.discount),
    total: asNumber(i.total),
    total_due: asNumber(i.totalDue),
    total_charge: asNumber(i.totalCharge),
    credit: asNumber(i.credit),
    is_outstanding: i.isOutstanding ?? null,
    raw_json: i,
    created_at: asDate(i.createdAt),
    updated_at: asDate(i.updatedAt),
  };
}

function mapStockLocation(loc: Json, supplierId: string) {
  return {
    id: loc.id,
    supplier_id: loc.supplierId ?? supplierId,
    name: loc.name,
    is_default: Boolean(loc.default),
    external_id: loc.externalId ?? null,
    raw_json: loc,
    created_at: asDate(loc.createdAt),
    updated_at: asDate(loc.updatedAt),
  };
}

async function syncPriceGroups(supabase: any, token: string) {
  const groups = await fetchPaged(
    (pageNo) => `/v1/price-groups?pageSize=100&pageNo=${pageNo}`,
    token,
    "app",
    50,
    250
  );

  const rows = groups.map(mapPriceGroup).filter((r) => r.id && r.supplier_id);

  if (rows.length) {
    const { error } = await supabase
      .from("om_price_groups")
      .upsert(rows, { onConflict: "id" });

    if (error) throw error;

    await upsertRawPayloads(supabase, "price_group", groups);
  }

  return rows.length;
}

async function syncProducts(supabase: any, token: string, supplierId: string) {
  const products = await fetchPaged(
    (pageNo) =>
      `/v1/products?supplierId=${supplierId}&pageSize=100&pageNo=${pageNo}`,
    token,
    "app",
    100,
    250
  );

  const productRows = products
    .map(mapProduct)
    .filter((r) => r.id && r.supplier_id);

  for (const part of chunk(productRows, 100)) {
    const { error } = await supabase
      .from("om_products")
      .upsert(part, { onConflict: "id" });

    if (error) throw error;
  }

  const productIds = productRows.map((p) => p.id);

  for (const part of chunk(productIds, 100)) {
    const { error } = await supabase
      .from("om_product_prices")
      .delete()
      .in("product_id", part);

    if (error) throw error;
  }

  const priceRows = products.flatMap(mapProductPrices);

  for (const part of chunk(priceRows, 200)) {
    const { error } = await supabase
      .from("om_product_prices")
      .upsert(part, { onConflict: "product_id,price_group_id" });

    if (error) throw error;
  }

  await upsertRawPayloads(supabase, "product", products);

  return {
    products: productRows.length,
    productPrices: priceRows.length,
  };
}

async function syncVariants(supabase: any, token: string, supplierId: string) {
  const variants = await fetchPaged(
    (pageNo) =>
      `/v1/variants?supplierId=${supplierId}&pageSize=100&pageNo=${pageNo}`,
    token,
    "api",
    100,
    250
  );

  const rows = variants
    .map((v) => mapVariant(v, supplierId))
    .filter((r) => r.id && r.supplier_id);

  for (const part of chunk(rows, 100)) {
    const { error } = await supabase
      .from("om_variants")
      .upsert(part, { onConflict: "id" });

    if (error) throw error;
  }

  await upsertRawPayloads(supabase, "variant", variants);

  return rows.length;
}

async function syncStockLocations(
  supabase: any,
  token: string,
  supplierId: string
) {
  const res = await fetch(
    `${ORDERMENTUM_STOCK_BASE}/locations?pageSize=100&pageNo=1`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "context-entity": "supplier",
        "context-id": supplierId,
      },
    }
  );

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 429) {
      await sleep(5_000);
      return await syncStockLocations(supabase, token, supplierId);
    }

    throw new Error(
      `Stock locations failed ${res.status}: ${JSON.stringify(body)}`
    );
  }

  const locations = Array.isArray(body.data) ? body.data : [];
  const rows = locations.map((loc) => mapStockLocation(loc, supplierId));

  if (rows.length) {
    const { error } = await supabase
      .from("om_stock_locations")
      .upsert(rows, { onConflict: "id" });

    if (error) throw error;

    await upsertRawPayloads(supabase, "stock_location", locations);
  }

  return rows.length;
}

async function syncCustomerById(
  supabase: any,
  token: string,
  purchaserId: string
) {
  if (!purchaserId) return null;

  const purchaser = await omFetchWithFallback<Json>(
    `/v1/purchasers/${purchaserId}`,
    token
  );

  const row = mapCustomer(purchaser);

  if (!row.purchaser_id || !row.supplier_id) {
    return null;
  }

  const { error } = await supabase
    .from("om_customers")
    .upsert(row, { onConflict: "purchaser_id" });

  if (error) throw error;

  await upsertRawPayloads(supabase, "purchaser", [purchaser]);

  return row.purchaser_id;
}

async function syncInvoiceById(
  supabase: any,
  token: string,
  invoiceId: string
) {
  if (!invoiceId) return null;

  const invoice = await omFetchWithFallback<Json>(
    `/v1/invoices/${invoiceId}`,
    token
  );

  const row = mapInvoice(invoice);

  if (!row.id || !row.supplier_id) {
    return null;
  }

  const { error } = await supabase
    .from("om_invoices")
    .upsert(row, { onConflict: "id" });

  if (error) throw error;

  await upsertRawPayloads(supabase, "invoice", [invoice]);

  return row.id;
}

async function syncOrderDetail(supabase: any, token: string, orderId: string) {
  const order = await omFetchWithFallback<Json>(`/v1/orders/${orderId}`, token);

  if (order.purchaser?.id) {
    const customerRow = mapCustomer(order.purchaser);

    if (customerRow.purchaser_id && customerRow.supplier_id) {
      const { error } = await supabase
        .from("om_customers")
        .upsert(customerRow, { onConflict: "purchaser_id" });

      if (error) throw error;
    }
  }

  const orderRow = mapOrder(order);

  if (!orderRow.id || !orderRow.supplier_id) {
    throw new Error(`Order detail missing id or supplierId: ${orderId}`);
  }

  const { error: orderError } = await supabase
    .from("om_orders")
    .upsert(orderRow, { onConflict: "id" });

  if (orderError) throw orderError;

  const items = Array.isArray(order.lineItems)
    ? order.lineItems
        .map((item) => mapOrderItem(item, order.id))
        .filter((item) => item.id && item.order_id)
    : [];

  const { error: deleteItemsError } = await supabase
    .from("om_order_items")
    .delete()
    .eq("order_id", order.id);

  if (deleteItemsError) throw deleteItemsError;

  if (items.length) {
    const { error: itemError } = await supabase
      .from("om_order_items")
      .insert(items);

    if (itemError) throw itemError;
  }

  if (order.invoice?.id) {
    const invoiceRow = mapInvoice(order.invoice);

    if (invoiceRow.id && invoiceRow.supplier_id) {
      const { error: invoiceError } = await supabase
        .from("om_invoices")
        .upsert(invoiceRow, { onConflict: "id" });

      if (invoiceError) throw invoiceError;
    }
  }

  await upsertRawPayloads(supabase, "order", [order]);

  return {
    orderId: order.id,
    itemCount: items.length,
  };
}

async function syncOrders(
  supabase: any,
  token: string,
  supplierId: string,
  fromIso: string,
  toIso: string | null,
  maxOrderDetails: number,
  maxSummaryPages: number,
  orderPageSize: number
) {
  const params = new URLSearchParams({
    supplierId,
    pageSize: String(orderPageSize),
    pageNo: "1",
  });

  params.set("updatedAt[gte]", fromIso);
  if (toIso) params.set("updatedAt[lte]", toIso);

  const firstPath = `/v2/orders?${params.toString()}`;
  const first = await omFetch<Json>(firstPath, token, "app");

  const totalPages = Number(first.meta?.totalPages ?? 1);
  const effectivePages = Math.min(totalPages, maxSummaryPages);
  const summaries: Json[] = Array.isArray(first.data) ? [...first.data] : [];

  for (let pageNo = 2; pageNo <= effectivePages; pageNo++) {
    await sleep(750);

    const p = new URLSearchParams({
      supplierId,
      pageSize: String(orderPageSize),
      pageNo: String(pageNo),
    });

    p.set("updatedAt[gte]", fromIso);
    if (toIso) p.set("updatedAt[lte]", toIso);

    const page = await omFetch<Json>(`/v2/orders?${p.toString()}`, token, "app");
    summaries.push(...(Array.isArray(page.data) ? page.data : []));
  }

  const summaryRows = summaries
    .map(mapOrder)
    .filter((r) => r.id && r.supplier_id);

  for (const part of chunk(summaryRows, 100)) {
    const { error } = await supabase
      .from("om_orders")
      .upsert(part, { onConflict: "id" });

    if (error) throw error;
  }

  await upsertRawPayloads(supabase, "order_summary", summaries);

  const detailTargets = summaries.filter((o) => o.id).slice(0, maxOrderDetails);

  let detailsSynced = 0;
  let orderItemsSynced = 0;
  let customersSynced = 0;
  let invoicesSynced = 0;
  const detailErrors: Json[] = [];

  for (const summary of detailTargets) {
    await sleep(750);

    try {
      const detail = await syncOrderDetail(supabase, token, summary.id);
      detailsSynced++;
      orderItemsSynced += detail.itemCount;

      const purchaserId = summary.purchaserId ?? summary.purchaser?.id;
      const invoiceId = summary.invoiceId ?? summary.invoice?.id;

      if (purchaserId) {
        await sleep(300);
        await syncCustomerById(supabase, token, purchaserId);
        customersSynced++;
      }

      if (invoiceId) {
        await sleep(300);
        await syncInvoiceById(supabase, token, invoiceId);
        invoicesSynced++;
      }
    } catch (err) {
      detailErrors.push({
        orderId: summary.id,
        orderNumber: summary.orderNumber ?? summary.number ?? null,
        error: err instanceof Error ? err.message : String(err),
      });

      console.log(
        `Order detail sync failed for ${summary.id}:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  return {
    totalPages,
    effectivePages,
    maxSummaryPages,
    orderPageSize,
    summaries: summaryRows.length,
    detailsTargeted: detailTargets.length,
    detailsSynced,
    orderItemsSynced,
    customersSynced,
    invoicesSynced,
    detailErrors,
    truncated: totalPages > effectivePages,
  };
}

function countProcessed(result: Json): number {
  let total = 0;

  for (const value of Object.values(result)) {
    if (typeof value === "number") {
      total += value;
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const nested of Object.values(value)) {
        if (typeof nested === "number") total += nested;
      }
    }
  }

  return total;
}

async function runSync(req: Request) {
  const syncAdminKey = Deno.env.get("SYNC_ADMIN_KEY");

  if (syncAdminKey && req.headers.get("x-sync-key") !== syncAdminKey) {
    return new Response(JSON.stringify({ error: "Unauthorized sync key" }), {
      status: 401,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
      },
    });
  }

  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supplierId = requiredEnv("ORDERMENTUM_SUPPLIER_ID");

  const body = await req.json().catch(() => ({}));

  const mode = String(body.mode ?? "master");

  const defaultFrom = new Date(
    Date.now() - 90 * 24 * 60 * 60 * 1000
  ).toISOString();

  const fromIso = body.from ?? defaultFrom;
  const toIso = body.to ?? null;

  const maxOrderDetails = Math.max(
    0,
    Math.min(Number(body.maxOrderDetails ?? 50), 250)
  );

  const maxSummaryPages = Math.max(
    1,
    Math.min(Number(body.maxSummaryPages ?? 5), 20)
  );

  const orderPageSize = Math.max(
    1,
    Math.min(Number(body.orderPageSize ?? 50), 50)
  );

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
    },
  });

  const syncRunInsert = await supabase
    .from("om_sync_runs")
    .insert({
      sync_type: mode,
      status: "running",
      meta: {
        mode,
        supplierId,
        from: fromIso,
        to: toIso,
        maxOrderDetails,
        maxSummaryPages,
        orderPageSize,
      },
    })
    .select("id")
    .single();

  if (syncRunInsert.error) throw syncRunInsert.error;

  const syncRunId = syncRunInsert.data.id;

  try {
    const token = await getOrdermentumToken();

    const result: Json = {};

    if (
      mode === "master" ||
      mode === "all" ||
      mode === "price-groups" ||
      mode === "products"
    ) {
      result.priceGroups = await syncPriceGroups(supabase, token);
    }

    if (mode === "master" || mode === "all" || mode === "products") {
      result.products = await syncProducts(supabase, token, supplierId);
    }

    if (mode === "master" || mode === "all" || mode === "variants") {
      result.variants = await syncVariants(supabase, token, supplierId);
    }

    if (mode === "master" || mode === "all" || mode === "stock-locations") {
      result.stockLocations = await syncStockLocations(
        supabase,
        token,
        supplierId
      );
    }

    if (mode === "orders" || mode === "all") {
      result.orders = await syncOrders(
        supabase,
        token,
        supplierId,
        fromIso,
        toIso,
        maxOrderDetails,
        maxSummaryPages,
        orderPageSize
      );
    }

    const recordsProcessed = countProcessed(result);

    await supabase
      .from("om_sync_runs")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
        records_processed: recordsProcessed,
        meta: {
          mode,
          supplierId,
          from: fromIso,
          to: toIso,
          maxOrderDetails,
          maxSummaryPages,
          orderPageSize,
          result,
        },
      })
      .eq("id", syncRunId);

    return new Response(
      JSON.stringify({
        ok: true,
        syncRunId,
        mode,
        from: fromIso,
        to: toIso,
        result,
      }),
      {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await supabase
      .from("om_sync_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_message: message,
      })
      .eq("id", syncRunId);

    throw err;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: CORS_HEADERS,
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
      },
    });
  }

  try {
    return await runSync(req);
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }),
      {
        status: 500,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json",
        },
      }
    );
  }
});