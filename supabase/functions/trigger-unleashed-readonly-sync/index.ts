// Supabase Edge Function: trigger-unleashed-readonly-sync
// Runs a bounded, GET-only Unleashed API probe/snapshot without exposing
// Unleashed credentials or returning raw source records to the browser.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const DEFAULT_API_BASE_URL = 'https://api.unleashedsoftware.com';
const DEFAULT_CLIENT_TYPE = 'waynx/unleashedreadonly';
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 1;
const HARD_MAX_PAGE_SIZE = 200;
const HARD_MAX_PAGES = 5;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const modifiedSincePattern = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z?)?$/;

type SyncMode = 'probe' | 'bounded_snapshot';

type ResourceDefinition = {
  endpoint: string;
  paginated: boolean;
  supportsModifiedSince: boolean;
  defaultQuery?: Record<string, string>;
  itemKeys: string[];
};

const RESOURCE_DEFINITIONS = {
  products: {
    endpoint: 'Products',
    paginated: true,
    supportsModifiedSince: true,
    defaultQuery: { includeObsolete: 'true' },
    itemKeys: ['Items', 'Product', 'Products'],
  },
  customers: {
    endpoint: 'Customers',
    paginated: true,
    supportsModifiedSince: true,
    itemKeys: ['Items', 'Customer', 'Customers'],
  },
  customer_delivery_addresses: {
    endpoint: 'CustomerDeliveryAddresses',
    paginated: true,
    supportsModifiedSince: true,
    itemKeys: ['Items', 'CustomerDeliveryAddress', 'CustomerDeliveryAddresses'],
  },
  suppliers: {
    endpoint: 'Suppliers',
    paginated: true,
    supportsModifiedSince: true,
    itemKeys: ['Items', 'Supplier', 'Suppliers'],
  },
  warehouses: {
    endpoint: 'Warehouses',
    paginated: true,
    supportsModifiedSince: true,
    itemKeys: ['Items', 'Warehouse', 'Warehouses'],
  },
  stock_on_hand: {
    endpoint: 'StockOnHand',
    paginated: true,
    supportsModifiedSince: true,
    itemKeys: ['Items', 'StockOnHand'],
  },
  sales_orders_open: {
    endpoint: 'SalesOrders',
    paginated: true,
    supportsModifiedSince: true,
    defaultQuery: { orderStatus: 'Parked,Placed,Backordered' },
    itemKeys: ['Items', 'SalesOrder', 'SalesOrders'],
  },
  purchase_orders_open: {
    endpoint: 'PurchaseOrders',
    paginated: true,
    supportsModifiedSince: true,
    defaultQuery: { orderStatus: 'Parked,Placed,Unapproved,Costed,Receipted' },
    itemKeys: ['Items', 'PurchaseOrder', 'PurchaseOrders'],
  },
  sales_invoices: {
    endpoint: 'Invoices',
    paginated: true,
    supportsModifiedSince: true,
    itemKeys: ['Items', 'Invoice', 'Invoices', 'SalesInvoice', 'SalesInvoices'],
  },
  credit_notes: {
    endpoint: 'CreditNotes',
    paginated: true,
    supportsModifiedSince: true,
    itemKeys: ['Items', 'CreditNote', 'CreditNotes'],
  },
  sales_shipments: {
    endpoint: 'SalesShipments',
    paginated: true,
    supportsModifiedSince: true,
    itemKeys: ['Items', 'SalesShipment', 'SalesShipments'],
  },
  supplier_returns: {
    endpoint: 'SupplierReturns',
    paginated: true,
    supportsModifiedSince: true,
    itemKeys: ['Items', 'SupplierReturn', 'SupplierReturns'],
  },
  stock_adjustments: {
    endpoint: 'StockAdjustments',
    paginated: true,
    supportsModifiedSince: true,
    itemKeys: ['Items', 'StockAdjustment', 'StockAdjustments'],
  },
  warehouse_stock_transfers: {
    endpoint: 'WarehouseStockTransfers',
    paginated: true,
    supportsModifiedSince: true,
    itemKeys: ['Items', 'WarehouseStockTransfer', 'WarehouseStockTransfers'],
  },
  stock_counts: {
    endpoint: 'StockCounts',
    paginated: true,
    supportsModifiedSince: true,
    itemKeys: ['Items', 'StockCount', 'StockCounts'],
  },
  sales_quotes: {
    endpoint: 'SalesQuotes',
    paginated: true,
    supportsModifiedSince: true,
    itemKeys: ['Items', 'SalesQuote', 'SalesQuotes'],
  },
  salespersons: {
    endpoint: 'Salespersons',
    paginated: true,
    supportsModifiedSince: false,
    itemKeys: ['Items', 'Salesperson', 'Salespersons'],
  },
  product_groups: {
    endpoint: 'ProductGroups',
    paginated: true,
    supportsModifiedSince: false,
    itemKeys: ['Items', 'ProductGroup', 'ProductGroups'],
  },
  product_brands: {
    endpoint: 'ProductBrands',
    paginated: true,
    supportsModifiedSince: false,
    itemKeys: ['Items', 'ProductBrand', 'ProductBrands'],
  },
  sell_price_tiers: {
    endpoint: 'SellPriceTiers',
    paginated: false,
    supportsModifiedSince: false,
    itemKeys: ['Items', 'SellPriceTier', 'SellPriceTiers'],
  },
} as const satisfies Record<string, ResourceDefinition>;

type ResourceName = keyof typeof RESOURCE_DEFINITIONS;

type RequestBody = {
  mode?: SyncMode;
  resources?: unknown;
  reason?: string | null;
  dryRun?: boolean;
  modifiedSince?: string | null;
  pageSize?: number;
  maxPages?: number;
};

type ActorProfile = {
  email: string | null;
  app_role: string;
  is_active: boolean;
  team_status: string;
};

type PageResult = {
  resource: ResourceName;
  endpointPath: string;
  pageNumber: number;
  pageSize: number;
  httpStatus: number;
  responseSha256: string;
  pagination: Record<string, unknown>;
  recordsSeen: number;
  recordsStaged: number;
  highWatermark: string | null;
};

const DEFAULT_RESOURCES: ResourceName[] = [
  'products',
  'customers',
  'suppliers',
  'warehouses',
  'stock_on_hand',
  'sales_orders_open',
  'purchase_orders_open',
];

const SALES_INTELLIGENCE_RESOURCES: ResourceName[] = [
  'sales_orders_open',
  'sales_invoices',
  'credit_notes',
  'sales_shipments',
  'customers',
  'products',
  'product_groups',
  'warehouses',
  'salespersons',
];

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSyncMode(value: unknown): value is SyncMode {
  return value === 'probe' || value === 'bounded_snapshot';
}

function isResourceName(value: unknown): value is ResourceName {
  return typeof value === 'string' && Object.hasOwn(RESOURCE_DEFINITIONS, value);
}

function normalizeResources(mode: SyncMode, value: unknown): ResourceName[] {
  if (value === 'sales_intelligence') return SALES_INTELLIGENCE_RESOURCES;
  if (value === undefined || value === null) return mode === 'probe' ? ['warehouses'] : DEFAULT_RESOURCES;
  if (!Array.isArray(value)) throw new Error('INVALID_RESOURCES');

  const resources: ResourceName[] = [];
  for (const entry of value) {
    if (!isResourceName(entry)) throw new Error(`UNSUPPORTED_RESOURCE:${String(entry)}`);
    if (!resources.includes(entry)) resources.push(entry);
  }
  if (!resources.length) throw new Error('EMPTY_RESOURCES');
  return mode === 'probe' ? [resources[0]] : resources;
}

function normalizeInteger(value: unknown, fallback: number, min: number, max: number, errorCode: string) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(errorCode);
  return value;
}

function normalizeModifiedSince(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new Error('INVALID_MODIFIED_SINCE');
  const trimmed = value.trim();
  if (!modifiedSincePattern.test(trimmed)) throw new Error('INVALID_MODIFIED_SINCE');
  return trimmed;
}

function normalizeBaseUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('UNLEASHED_API_BASE_URL_MUST_BE_HTTPS');
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('UNLEASHED_API_BASE_URL_MUST_NOT_CONTAIN_AUTH_QUERY_OR_FRAGMENT');
  }
  return url.toString().replace(/\/$/, '');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return btoa(binary);
}

async function hmacSha256Base64(queryString: string, privateKey: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(privateKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(queryString));
  return bytesToBase64(new Uint8Array(signature));
}

async function sha256Hex(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function appendQuery(search: URLSearchParams, key: string, value: string) {
  search.append(key, value);
}

function buildRequestUrl(baseUrl: string, definition: ResourceDefinition, pageNumber: number, queryString: string) {
  const pageSuffix = definition.paginated ? `/${pageNumber}` : '';
  const url = new URL(`${baseUrl}/${definition.endpoint}${pageSuffix}`);
  url.search = queryString;
  return url;
}

function buildQuery(definition: ResourceDefinition, pageSize: number, modifiedSince: string | null) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(definition.defaultQuery ?? {})) appendQuery(search, key, value);
  if (definition.paginated) appendQuery(search, 'pageSize', String(pageSize));
  if (modifiedSince && definition.supportsModifiedSince) appendQuery(search, 'modifiedSince', modifiedSince);
  return search;
}

function getPagination(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload)) return {};
  const pagination = payload.Pagination ?? payload.pagination;
  return isRecord(pagination) ? pagination : {};
}

function paginationNumber(pagination: Record<string, unknown>, key: string) {
  const value = pagination[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return null;
}

function getItems(payload: unknown, definition: ResourceDefinition): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];

  for (const key of definition.itemKeys) {
    const value = payload[key];
    if (Array.isArray(value)) return value.filter(isRecord);
    if (isRecord(value)) return [value];
  }

  for (const [key, value] of Object.entries(payload)) {
    if (key.toLowerCase() === 'pagination') continue;
    if (Array.isArray(value)) return value.filter(isRecord);
  }
  return [];
}

function readString(item: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function readDate(value: string | null) {
  if (!value) return null;
  const dotNetDate = /^\/Date\((\d+)\)\/$/.exec(value);
  if (dotNetDate) return new Date(Number(dotNetDate[1])).toISOString();
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

async function buildSnapshotRows(resource: ResourceName, runId: string, items: Record<string, unknown>[]) {
  const rows = [];
  for (const item of items) {
    const stablePayload = stableStringify(item);
    const payloadSha256 = await sha256Hex(stablePayload);
    const guid = readString(item, ['Guid', 'guid', 'ProductGuid', 'CustomerGuid', 'SupplierGuid', 'WarehouseId']);
    const externalCode = readString(item, [
      'ProductCode',
      'CustomerCode',
      'SupplierCode',
      'WarehouseCode',
      'SalespersonCode',
      'GroupName',
      'BrandName',
    ]);
    const externalNumber = readString(item, [
      'OrderNumber',
      'PurchaseOrderNumber',
      'InvoiceNumber',
      'CreditNoteNumber',
      'ShipmentNumber',
      'SupplierReturnNumber',
      'StockAdjustmentNumber',
      'TransferOrderNumber',
      'QuoteNumber',
      'StockCountNumber',
    ]);
    const displayName = readString(item, [
      'ProductDescription',
      'CustomerName',
      'SupplierName',
      'WarehouseName',
      'ProductGroupName',
      'GroupName',
      'BrandName',
      'SalespersonName',
      'FullName',
      'Name',
      'Description',
    ]);
    const sourceLastModifiedAt = readDate(readString(item, ['LastModifiedOn', 'lastModifiedOn']));
    const externalKey = guid && uuidPattern.test(guid)
      ? `guid:${guid.toLowerCase()}`
      : externalCode
        ? `code:${externalCode}`
        : externalNumber
          ? `number:${externalNumber}`
          : `hash:${payloadSha256}`;

    rows.push({
      resource,
      external_key: externalKey,
      external_guid: guid,
      external_code: externalCode,
      external_number: externalNumber,
      display_name: displayName,
      source_last_modified_at: sourceLastModifiedAt,
      payload: item,
      payload_sha256: payloadSha256,
      payload_object_keys: Object.keys(item).sort(),
      first_seen_run_id: runId,
      last_seen_run_id: runId,
      metadata: { source: 'unleashed_api' },
    });
  }

  return [...new Map(rows.map((row) => [`${row.resource}\u0000${row.external_key}`, row])).values()];
}

function summarizeHighWatermark(items: Record<string, unknown>[]) {
  let highWatermark: string | null = null;
  for (const item of items) {
    const candidate = readDate(readString(item, ['LastModifiedOn', 'lastModifiedOn']));
    if (!candidate) continue;
    if (!highWatermark || candidate > highWatermark) highWatermark = candidate;
  }
  return highWatermark;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json(500, { error: 'MISSING_SUPABASE_FUNCTION_SECRETS' });

  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json(401, { error: 'MISSING_BEARER_TOKEN' });

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json(401, { error: 'INVALID_SESSION', details: userError?.message });

  const { data: actorProfile, error: actorError } = await adminClient
    .from('app_user_profiles')
    .select('email,app_role,is_active,team_status')
    .eq('user_id', userData.user.id)
    .maybeSingle();
  if (actorError) return json(500, { error: 'ACTOR_PROFILE_LOOKUP_FAILED', details: actorError.message });
  const actor = actorProfile as ActorProfile | null;
  if (!actor || !actor.is_active || actor.team_status !== 'ACTIVE' || !['OWNER', 'ADMIN'].includes(actor.app_role)) {
    return json(403, { error: 'OWNER_OR_ADMIN_REQUIRED' });
  }

  let body: RequestBody;
  try { body = await req.json(); }
  catch { return json(400, { error: 'INVALID_JSON_BODY' }); }

  const mode = body.mode ?? 'probe';
  if (!isSyncMode(mode)) return json(400, { error: 'INVALID_SYNC_MODE' });

  let resources: ResourceName[];
  let modifiedSince: string | null;
  let pageSize: number;
  let maxPages: number;
  try {
    resources = normalizeResources(mode, body.resources);
    modifiedSince = normalizeModifiedSince(body.modifiedSince);
    pageSize = mode === 'probe' ? 1 : normalizeInteger(body.pageSize, DEFAULT_PAGE_SIZE, 1, HARD_MAX_PAGE_SIZE, 'INVALID_PAGE_SIZE');
    maxPages = mode === 'probe' ? 1 : normalizeInteger(body.maxPages, DEFAULT_MAX_PAGES, 1, HARD_MAX_PAGES, 'INVALID_MAX_PAGES');
  } catch (error) {
    return json(400, { error: error instanceof Error ? error.message : 'INVALID_REQUEST' });
  }

  const dryRun = body.dryRun !== false;
  const unleashedApiId = Deno.env.get('UNLEASHED_API_ID');
  const unleashedApiKey = Deno.env.get('UNLEASHED_API_KEY');
  const clientType = (Deno.env.get('UNLEASHED_CLIENT_TYPE') ?? DEFAULT_CLIENT_TYPE).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9/_-]{2,80}$/.test(clientType)) return json(500, { error: 'INVALID_UNLEASHED_CLIENT_TYPE' });
  let apiBaseUrl: string;
  try {
    apiBaseUrl = normalizeBaseUrl(Deno.env.get('UNLEASHED_API_BASE_URL') ?? DEFAULT_API_BASE_URL);
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : 'INVALID_UNLEASHED_API_BASE_URL' });
  }

  const { data: run, error: runError } = await adminClient
    .from('unleashed_sync_runs')
    .insert({
      run_type: mode === 'probe' ? 'PROBE' : 'BOUNDED_SNAPSHOT',
      status: 'RUNNING',
      reason: body.reason ?? null,
      requested_by: userData.user.id,
      requested_by_email: actor.email,
      dry_run: dryRun,
      resource_set: resources,
      requested_modified_since: modifiedSince,
      page_size: pageSize,
      max_pages: maxPages,
      metadata: {
        source: 'unleashed_api',
        allowed_methods: ['GET'],
        credentials_location: 'supabase_edge_function_secrets',
      },
    })
    .select('id,requested_at')
    .single();

  if (runError || !run) return json(500, { error: 'UNLEASHED_SYNC_RUN_CREATE_FAILED', details: runError?.message });

  if (!unleashedApiId || !unleashedApiKey) {
    await adminClient.from('unleashed_sync_runs').update({
      status: 'FAILED',
      error_code: 'MISSING_UNLEASHED_API_SECRETS',
      error_message: 'UNLEASHED_API_ID and UNLEASHED_API_KEY must be configured as Edge Function secrets.',
      records_failed: 1,
    }).eq('id', run.id);
    await adminClient.from('app_security_audit_events').insert({
      actor_user_id: userData.user.id,
      actor_email: actor.email,
      actor_role: actor.app_role,
      action: 'UNLEASHED_READONLY_SYNC_FAILED',
      target_type: 'unleashed_sync_run',
      target_id: run.id,
      after_data: {
        mode,
        dryRun,
        resources,
        modifiedSince,
        pageSize,
        maxPages,
        status: 'FAILED',
        errorCode: 'MISSING_UNLEASHED_API_SECRETS',
      },
      user_agent: req.headers.get('user-agent'),
    });
    return json(500, { error: 'MISSING_UNLEASHED_API_SECRETS', runId: run.id });
  }

  const pageResults: PageResult[] = [];
  let recordsSeen = 0;
  let recordsStaged = 0;
  let recordsFailed = 0;
  let finalStatus: 'SUCCEEDED' | 'PARTIAL' | 'FAILED' = 'SUCCEEDED';
  let finalErrorCode: string | null = null;
  let finalErrorMessage: string | null = null;

  for (const resource of resources) {
    const definition = RESOURCE_DEFINITIONS[resource];
    let pageNumber = 1;
    let knownNumberOfPages: number | null = definition.paginated ? null : 1;
    let resourceHighWatermark: string | null = null;
    let resourceFailed = false;

    while (pageNumber <= maxPages && pageNumber <= (knownNumberOfPages ?? maxPages)) {
      const query = buildQuery(definition, pageSize, modifiedSince);
      const queryParams = Object.fromEntries(query.entries());
      const queryString = query.toString();
      const url = buildRequestUrl(apiBaseUrl, definition, pageNumber, queryString);
      const endpointPath = `/${definition.endpoint}${definition.paginated ? `/${pageNumber}` : ''}`;
      const signature = await hmacSha256Base64(queryString, unleashedApiKey);

      try {
        const response = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'api-auth-id': unleashedApiId,
            'api-auth-signature': signature,
            'client-type': clientType,
          },
        });
        const responseText = await response.text();
        const responseSha256 = await sha256Hex(responseText);

        if (!response.ok) {
          recordsFailed += 1;
          resourceFailed = true;
          finalStatus = pageResults.length ? 'PARTIAL' : 'FAILED';
          finalErrorCode = 'UNLEASHED_API_REQUEST_FAILED';
          finalErrorMessage = `${resource} page ${pageNumber} returned HTTP ${response.status}`;
          await adminClient.from('unleashed_sync_batches').insert({
            run_id: run.id,
            resource,
            endpoint_path: endpointPath,
            page_number: pageNumber,
            page_size: pageSize,
            status: 'FAILED',
            responded_at: new Date().toISOString(),
            http_status: response.status,
            response_sha256: responseSha256,
            query_params: queryParams,
            error_code: finalErrorCode,
            error_message: finalErrorMessage,
            metadata: { upstream_body_redacted: true },
          });
          break;
        }

        let payload: unknown;
        try { payload = JSON.parse(responseText); }
        catch {
          recordsFailed += 1;
          resourceFailed = true;
          finalStatus = pageResults.length ? 'PARTIAL' : 'FAILED';
          finalErrorCode = 'UNLEASHED_API_NON_JSON_RESPONSE';
          finalErrorMessage = `${resource} page ${pageNumber} returned a non-JSON response`;
          await adminClient.from('unleashed_sync_batches').insert({
            run_id: run.id,
            resource,
            endpoint_path: endpointPath,
            page_number: pageNumber,
            page_size: pageSize,
            status: 'FAILED',
            responded_at: new Date().toISOString(),
            http_status: response.status,
            response_sha256: responseSha256,
            query_params: queryParams,
            error_code: finalErrorCode,
            error_message: finalErrorMessage,
          });
          break;
        }

        const pagination = getPagination(payload);
        const items = getItems(payload, definition);
        const pageHighWatermark = summarizeHighWatermark(items);
        if (pageHighWatermark && (!resourceHighWatermark || pageHighWatermark > resourceHighWatermark)) {
          resourceHighWatermark = pageHighWatermark;
        }
        recordsSeen += items.length;

        let stagedOnPage = 0;
        if (!dryRun && items.length) {
          const snapshotRows = await buildSnapshotRows(resource, run.id, items);
          const identityRows = snapshotRows.map((row) => ({
            resource: row.resource,
            external_key: row.external_key,
            external_guid: row.external_guid,
            external_code: row.external_code,
            external_number: row.external_number,
            display_name: row.display_name,
            latest_payload_sha256: row.payload_sha256,
            latest_source_last_modified_at: row.source_last_modified_at,
            first_seen_run_id: run.id,
            last_seen_run_id: run.id,
            metadata: { source: 'unleashed_api' },
          }));

          const { error: snapshotError } = await adminClient
            .from('unleashed_raw_snapshots')
            .upsert(snapshotRows, { onConflict: 'resource,external_key' });
          if (snapshotError) throw new Error(`UNLEASHED_RAW_SNAPSHOT_UPSERT_FAILED:${snapshotError.message}`);

          const { error: identityError } = await adminClient
            .from('unleashed_external_identities')
            .upsert(identityRows, { onConflict: 'resource,external_key' });
          if (identityError) throw new Error(`UNLEASHED_EXTERNAL_IDENTITY_UPSERT_FAILED:${identityError.message}`);

          stagedOnPage = snapshotRows.length;
          recordsStaged += stagedOnPage;
        }

        const { data: batch, error: batchError } = await adminClient.from('unleashed_sync_batches').insert({
          run_id: run.id,
          resource,
          endpoint_path: endpointPath,
          page_number: pageNumber,
          page_size: pageSize,
          status: 'SUCCEEDED',
          responded_at: new Date().toISOString(),
          http_status: response.status,
          records_seen: items.length,
          records_staged: stagedOnPage,
          response_sha256: responseSha256,
          query_params: queryParams,
          pagination,
          metadata: { dry_run: dryRun },
        }).select('id').single();
        if (batchError || !batch) throw new Error(`UNLEASHED_SYNC_BATCH_CREATE_FAILED:${batchError?.message}`);

        pageResults.push({
          resource,
          endpointPath,
          pageNumber,
          pageSize,
          httpStatus: response.status,
          responseSha256,
          pagination,
          recordsSeen: items.length,
          recordsStaged: stagedOnPage,
          highWatermark: pageHighWatermark,
        });

        const apiNumberOfPages = paginationNumber(pagination, 'NumberOfPages') ?? paginationNumber(pagination, 'numberOfPages');
        if (apiNumberOfPages !== null) knownNumberOfPages = Math.max(1, apiNumberOfPages);
        if (!definition.paginated || items.length < pageSize) break;
        pageNumber += 1;
      } catch (error) {
        recordsFailed += 1;
        resourceFailed = true;
        finalStatus = pageResults.length ? 'PARTIAL' : 'FAILED';
        finalErrorCode = 'UNLEASHED_CONNECTOR_PAGE_FAILED';
        finalErrorMessage = error instanceof Error ? error.message.slice(0, 1000) : 'Unknown Unleashed connector failure';
        await adminClient.from('unleashed_sync_batches').insert({
          run_id: run.id,
          resource,
          endpoint_path: endpointPath,
          page_number: pageNumber,
          page_size: pageSize,
          status: 'FAILED',
          responded_at: new Date().toISOString(),
          query_params: queryParams,
          error_code: finalErrorCode,
          error_message: finalErrorMessage,
        });
        break;
      }
    }

    if (!dryRun) {
      await adminClient.from('unleashed_resource_cursors').upsert({
        resource,
        cursor_status: resourceFailed ? 'FAILED' : 'READY',
        last_successful_run_id: resourceFailed ? null : run.id,
        last_successful_at: resourceFailed ? null : new Date().toISOString(),
        last_successful_modified_since: resourceFailed ? null : modifiedSince,
        high_watermark_at: resourceFailed ? null : resourceHighWatermark,
        next_modified_since: resourceFailed ? null : resourceHighWatermark,
        last_error_code: resourceFailed ? finalErrorCode : null,
        last_error_message: resourceFailed ? finalErrorMessage : null,
        metadata: { dry_run: dryRun },
      }, { onConflict: 'resource' });
    }

    if (resourceFailed) break;
  }

  const { error: updateError } = await adminClient.from('unleashed_sync_runs').update({
    status: finalStatus,
    records_seen: recordsSeen,
    records_staged: recordsStaged,
    records_failed: recordsFailed,
    error_code: finalErrorCode,
    error_message: finalErrorMessage,
    completed_at: new Date().toISOString(),
  }).eq('id', run.id);
  if (updateError) return json(500, { error: 'UNLEASHED_SYNC_RUN_UPDATE_FAILED', runId: run.id, details: updateError.message });

  await adminClient.from('app_security_audit_events').insert({
    actor_user_id: userData.user.id,
    actor_email: actor.email,
    actor_role: actor.app_role,
    action: finalStatus === 'SUCCEEDED' ? 'UNLEASHED_READONLY_SYNC_COMPLETED' : 'UNLEASHED_READONLY_SYNC_FAILED',
    target_type: 'unleashed_sync_run',
    target_id: run.id,
    after_data: {
      mode,
      dryRun,
      resources,
      modifiedSince,
      pageSize,
      maxPages,
      status: finalStatus,
      recordsSeen,
      recordsStaged,
      recordsFailed,
    },
    user_agent: req.headers.get('user-agent'),
  });

  return json(finalStatus === 'FAILED' ? 502 : 200, {
    ok: finalStatus !== 'FAILED',
    runId: run.id,
    requestedAt: run.requested_at,
    status: finalStatus,
    dryRun,
    resources,
    pageSize,
    maxPages,
    recordsSeen,
    recordsStaged,
    recordsFailed,
    pages: pageResults.map((page) => ({
      resource: page.resource,
      endpointPath: page.endpointPath,
      pageNumber: page.pageNumber,
      pageSize: page.pageSize,
      httpStatus: page.httpStatus,
      responseSha256: page.responseSha256,
      recordsSeen: page.recordsSeen,
      recordsStaged: page.recordsStaged,
      highWatermark: page.highWatermark,
      pagination: page.pagination,
    })),
    errorCode: finalErrorCode,
    errorMessage: finalErrorMessage,
  });
});
