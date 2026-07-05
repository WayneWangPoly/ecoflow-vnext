-- EcoFlow Ordermentum blocked-order fallback views
-- Safe migration: creates/replaces read-only views only. No existing tables are changed.
-- Purpose: when missing invoice/order detail is fetched into ordermentum_raw_invoices or
-- ordermentum_raw_orders, the operational views can use the raw detail immediately without
-- requiring a full parse into the older om_invoices / om_order_items staging tables.

create or replace view public.v_ecoflow_ordermentum_order_lines as
with raw_line_source as (
  select
    o.id::text as external_order_id,
    o.order_number,
    o.invoice_number,
    line.value as raw_line
  from public.ordermentum_raw_orders r
  join public.om_orders o
    on o.id::text = r.external_order_id
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(r.raw_payload -> 'lineItems') = 'array' then r.raw_payload -> 'lineItems'
      when jsonb_typeof(r.raw_payload -> 'line_items') = 'array' then r.raw_payload -> 'line_items'
      when jsonb_typeof(r.raw_payload -> 'items') = 'array' then r.raw_payload -> 'items'
      when jsonb_typeof(r.raw_payload -> 'orderItems') = 'array' then r.raw_payload -> 'orderItems'
      when jsonb_typeof(r.raw_payload -> 'order' -> 'lineItems') = 'array' then r.raw_payload -> 'order' -> 'lineItems'
      when jsonb_typeof(r.raw_payload -> 'order' -> 'items') = 'array' then r.raw_payload -> 'order' -> 'items'
      when jsonb_typeof(r.raw_payload -> 'data' -> 'lineItems') = 'array' then r.raw_payload -> 'data' -> 'lineItems'
      when jsonb_typeof(r.raw_payload -> 'data' -> 'items') = 'array' then r.raw_payload -> 'data' -> 'items'
      else '[]'::jsonb
    end
  ) as line(value)
  where not exists (
    select 1
    from public.om_order_items existing
    where existing.order_id = o.id
  )
),
raw_lines as (
  select
    external_order_id,
    order_number,
    invoice_number,
    coalesce(
      nullif(raw_line ->> 'id', ''),
      nullif(raw_line ->> 'uuid', ''),
      nullif(raw_line ->> 'lineId', ''),
      'RAW-LINE-' || left(md5(raw_line::text), 12)
    ) as line_id,
    coalesce(nullif(raw_line ->> 'productId', ''), nullif(raw_line ->> 'product_id', ''), nullif(raw_line -> 'product' ->> 'id', '')) as product_id,
    coalesce(nullif(raw_line ->> 'variantId', ''), nullif(raw_line ->> 'variant_id', ''), nullif(raw_line -> 'variant' ->> 'id', '')) as variant_id,
    coalesce(
      nullif(raw_line ->> 'sku', ''),
      nullif(raw_line ->> 'productSku', ''),
      nullif(raw_line ->> 'product_sku', ''),
      nullif(raw_line -> 'product' ->> 'sku', ''),
      nullif(raw_line -> 'variant' ->> 'sku', ''),
      'OM-LINE-' || left(md5(raw_line::text), 8)
    ) as sku,
    coalesce(
      nullif(raw_line ->> 'name', ''),
      nullif(raw_line ->> 'productName', ''),
      nullif(raw_line ->> 'product_name', ''),
      nullif(raw_line -> 'product' ->> 'name', ''),
      'Ordermentum line item'
    ) as name,
    case
      when coalesce(raw_line ->> 'quantity', raw_line ->> 'qty', raw_line ->> 'orderedQuantity', raw_line ->> 'ordered_quantity') ~ '^-?[0-9]+(\.[0-9]+)?$'
      then coalesce(raw_line ->> 'quantity', raw_line ->> 'qty', raw_line ->> 'orderedQuantity', raw_line ->> 'ordered_quantity')::numeric
      else 0::numeric
    end as quantity,
    coalesce(nullif(raw_line ->> 'unit', ''), nullif(raw_line ->> 'unitName', ''), nullif(raw_line ->> 'uom', '')) as unit,
    coalesce(nullif(raw_line ->> 'uom', ''), nullif(raw_line ->> 'unitOfMeasure', ''), nullif(raw_line ->> 'unit_of_measure', '')) as uom,
    case when coalesce(raw_line ->> 'packingUnit', raw_line ->> 'packing_unit') ~ '^-?[0-9]+(\.[0-9]+)?$'
      then coalesce(raw_line ->> 'packingUnit', raw_line ->> 'packing_unit')::numeric end as packing_unit,
    case when coalesce(raw_line ->> 'price', raw_line ->> 'unitPrice', raw_line ->> 'unit_price') ~ '^-?[0-9]+(\.[0-9]+)?$'
      then coalesce(raw_line ->> 'price', raw_line ->> 'unitPrice', raw_line ->> 'unit_price')::numeric end as price,
    case when coalesce(raw_line ->> 'ratePrice', raw_line ->> 'rate_price') ~ '^-?[0-9]+(\.[0-9]+)?$'
      then coalesce(raw_line ->> 'ratePrice', raw_line ->> 'rate_price')::numeric end as rate_price,
    case when raw_line ->> 'subtotal' ~ '^-?[0-9]+(\.[0-9]+)?$' then (raw_line ->> 'subtotal')::numeric end as subtotal,
    case when coalesce(raw_line ->> 'gst', raw_line ->> 'totalGst', raw_line ->> 'total_gst') ~ '^-?[0-9]+(\.[0-9]+)?$'
      then coalesce(raw_line ->> 'gst', raw_line ->> 'totalGst', raw_line ->> 'total_gst')::numeric end as gst,
    case when coalesce(raw_line ->> 'tax', raw_line ->> 'totalTax', raw_line ->> 'total_tax') ~ '^-?[0-9]+(\.[0-9]+)?$'
      then coalesce(raw_line ->> 'tax', raw_line ->> 'totalTax', raw_line ->> 'total_tax')::numeric end as tax,
    case when raw_line ->> 'total' ~ '^-?[0-9]+(\.[0-9]+)?$' then (raw_line ->> 'total')::numeric end as total
  from raw_line_source
)
select
  o.id::text as external_order_id,
  o.order_number,
  o.invoice_number,
  li.id::text as line_id,
  li.product_id::text as product_id,
  li.variant_id::text as variant_id,
  coalesce(nullif(li.sku, ''), 'OM-LINE-' || left(li.id::text, 8)) as sku,
  coalesce(nullif(li.name, ''), 'Ordermentum line item') as name,
  coalesce(li.quantity, 0) as quantity,
  li.unit,
  li.uom,
  li.packing_unit,
  li.price,
  li.rate_price,
  li.subtotal,
  li.gst,
  li.tax,
  li.total
from public.om_order_items li
join public.om_orders o
  on o.id = li.order_id
union all
select
  external_order_id,
  order_number,
  invoice_number,
  line_id,
  product_id,
  variant_id,
  sku,
  name,
  quantity,
  unit,
  uom,
  packing_unit,
  price,
  rate_price,
  subtotal,
  gst,
  tax,
  total
from raw_lines;

create or replace view public.v_ecoflow_ordermentum_inbox as
with item_totals as (
  select
    external_order_id,
    count(*) as line_count,
    coalesce(sum(quantity), 0) as total_units,
    coalesce(sum(total), 0) as order_items_total
  from public.v_ecoflow_ordermentum_order_lines
  group by external_order_id
)
select
  r.id as raw_order_id,
  r.external_order_id,
  r.external_order_number,
  r.external_invoice_number,

  o.id as om_order_id,
  o.order_number,
  o.invoice_number,
  o.status as order_status,
  o.payment_status,
  o.created_at as order_created_at,
  o.updated_at as order_updated_at,

  (o.created_at at time zone 'Australia/Adelaide')::date as received_business_day,
  (o.updated_at at time zone 'Australia/Adelaide')::date as updated_business_day,

  coalesce(i.id, raw_invoice.id) as invoice_id,
  coalesce(i.number, raw_invoice.external_invoice_number) as invoice_detail_number,
  coalesce(i.status, raw_invoice.invoice_status) as invoice_status,
  coalesce(i.payment_status, raw_invoice.payment_status) as invoice_payment_status,
  coalesce(i.total, raw_invoice.total) as invoice_total,
  coalesce(i.total_due, raw_invoice.total_due) as total_due,
  i.is_outstanding,
  coalesce(i.due_at, raw_invoice.due_at) as invoice_due_at,
  coalesce(i.date, raw_invoice.invoice_date) as invoice_date,

  coalesce(t.line_count, 0) as line_count,
  coalesce(t.total_units, 0) as total_units,
  coalesce(t.order_items_total, 0) as order_items_total,

  case when coalesce(i.id, raw_invoice.id) is null then true else false end as invoice_detail_missing,
  case when coalesce(t.line_count, 0) = 0 then true else false end as line_items_missing,

  r.first_seen_at,
  r.last_seen_at,
  r.last_synced_at,
  r.payload_hash,
  r.import_source,
  r.created_at as raw_created_at,
  r.updated_at as raw_updated_at
from public.ordermentum_raw_orders r
left join public.om_orders o
  on o.id::text = r.external_order_id
left join public.om_invoices i
  on i.number = o.invoice_number
left join public.ordermentum_raw_invoices raw_invoice
  on raw_invoice.external_invoice_number = coalesce(o.invoice_number, r.external_invoice_number)
left join item_totals t
  on t.external_order_id = r.external_order_id;

create or replace view public.v_ecoflow_ordermentum_exceptions as
select
  raw_order_id,
  external_order_id,
  external_order_number,
  external_invoice_number,
  order_number,
  invoice_number,
  'INVOICE_DETAIL_MISSING' as exception_type,
  'Order exists but invoice detail is missing from parsed and raw invoice stores' as message,
  'OPEN' as status,
  order_updated_at as detected_at
from public.v_ecoflow_ordermentum_inbox
where invoice_detail_missing = true
union all
select
  raw_order_id,
  external_order_id,
  external_order_number,
  external_invoice_number,
  order_number,
  invoice_number,
  'LINE_ITEMS_MISSING' as exception_type,
  'Order exists but no item lines were found in parsed or raw order detail' as message,
  'OPEN' as status,
  order_updated_at as detected_at
from public.v_ecoflow_ordermentum_inbox
where line_items_missing = true;

create or replace view public.v_ecoflow_ordermentum_sync_health as
select
  count(*) as raw_orders,
  count(*) filter (where invoice_detail_missing = true) as invoice_detail_missing,
  count(*) filter (where line_items_missing = true) as line_items_missing,
  min(order_created_at) as first_order_created_at,
  max(order_created_at) as last_order_created_at,
  min(order_updated_at) as first_order_updated_at,
  max(order_updated_at) as last_order_updated_at,
  max(last_synced_at) as last_synced_at
from public.v_ecoflow_ordermentum_inbox;

create or replace view public.v_ecoflow_ordermentum_release_queue as
select
  inbox.raw_order_id,
  inbox.external_order_id,
  inbox.external_order_number,
  inbox.external_invoice_number,
  inbox.order_number,
  inbox.invoice_number,
  inbox.order_status,
  inbox.payment_status,
  inbox.order_created_at,
  inbox.order_updated_at,
  inbox.received_business_day,
  inbox.updated_business_day,
  inbox.invoice_total,
  inbox.total_due,
  inbox.is_outstanding,
  inbox.line_count,
  inbox.total_units,
  inbox.invoice_detail_missing,
  inbox.line_items_missing,
  case
    when inbox.invoice_detail_missing or inbox.line_items_missing then 'BLOCKED_DATA'
    when inbox.payment_status is null or upper(inbox.payment_status) in ('N/A', 'UNKNOWN') then 'REVIEW_PAYMENT'
    else 'READY_TO_RELEASE'
  end as release_status,
  concat_ws(', ',
    case when inbox.invoice_detail_missing then 'invoice detail missing' end,
    case when inbox.line_items_missing then 'line items missing' end,
    case when inbox.payment_status is null or upper(inbox.payment_status) in ('N/A', 'UNKNOWN') then 'payment status review' end
  ) as release_blockers,
  case when inbox.invoice_detail_missing or inbox.line_items_missing then false else true end as can_create_internal_order,
  inbox.last_synced_at
from public.v_ecoflow_ordermentum_inbox inbox;

create or replace view public.v_ecoflow_ordermentum_readiness_summary as
select
  count(*) as total_orders,
  count(*) filter (where release_status = 'READY_TO_RELEASE') as ready_to_release,
  count(*) filter (where release_status = 'REVIEW_PAYMENT') as review_payment,
  count(*) filter (where release_status = 'BLOCKED_DATA') as blocked_data,
  count(*) filter (where invoice_detail_missing) as invoice_detail_missing,
  count(*) filter (where line_items_missing) as line_items_missing,
  coalesce(sum(invoice_total), 0) as invoice_total,
  coalesce(sum(total_due), 0) as total_due,
  max(order_updated_at) as latest_order_update,
  max(last_synced_at) as last_synced_at
from public.v_ecoflow_ordermentum_release_queue;
