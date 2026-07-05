-- Ordermentum order coverage + SKU activity V2
-- Purpose: audit every raw Ordermentum order after full/history sync and rebuild SKU activity from raw synced order detail,
-- not only the older om_order_items staging tables.

begin;

create or replace function public.ecoflow_try_numeric(input text)
returns numeric
language plpgsql
immutable
as $$
declare
  cleaned text;
begin
  if input is null or btrim(input) = '' then
    return null;
  end if;

  cleaned := regexp_replace(input, '[^0-9\.\-]', '', 'g');
  if cleaned is null or cleaned = '' or cleaned = '-' or cleaned = '.' then
    return null;
  end if;

  return cleaned::numeric;
exception when others then
  return null;
end;
$$;

create or replace view public.v_ecoflow_ordermentum_raw_order_line_extract_v2 as
with raw_line_arrays as (
  select
    r.id as raw_order_id,
    r.external_order_id,
    r.external_order_number,
    r.external_invoice_number,
    r.external_created_at,
    r.external_updated_at,
    r.last_synced_at,
    r.import_source,
    case
      when jsonb_typeof(r.raw_payload->'items') = 'array' then r.raw_payload->'items'
      when jsonb_typeof(r.raw_payload->'lineItems') = 'array' then r.raw_payload->'lineItems'
      when jsonb_typeof(r.raw_payload->'orderItems') = 'array' then r.raw_payload->'orderItems'
      when jsonb_typeof(r.raw_payload->'invoiceItems') = 'array' then r.raw_payload->'invoiceItems'
      when jsonb_typeof(r.raw_payload->'lines') = 'array' then r.raw_payload->'lines'
      when jsonb_typeof(r.raw_payload#>'{order,items}') = 'array' then r.raw_payload#>'{order,items}'
      when jsonb_typeof(r.raw_payload#>'{order,lineItems}') = 'array' then r.raw_payload#>'{order,lineItems}'
      when jsonb_typeof(r.raw_payload#>'{data,items}') = 'array' then r.raw_payload#>'{data,items}'
      when jsonb_typeof(r.raw_payload#>'{data,lineItems}') = 'array' then r.raw_payload#>'{data,lineItems}'
      else '[]'::jsonb
    end as line_array
  from public.ordermentum_raw_orders r
), extracted as (
  select
    r.raw_order_id,
    r.external_order_id,
    r.external_order_number,
    r.external_invoice_number,
    r.external_created_at,
    r.external_updated_at,
    r.last_synced_at,
    r.import_source,
    item.value as item,
    item.ordinality::int as line_index
  from raw_line_arrays r
  left join lateral jsonb_array_elements(r.line_array) with ordinality as item(value, ordinality)
    on true
  where jsonb_typeof(r.line_array) = 'array'
)
select
  raw_order_id,
  external_order_id,
  external_order_number as order_number,
  external_invoice_number as invoice_number,
  coalesce(item->>'id', item->>'lineId', item->>'uuid', external_order_id || ':' || line_index::text) as source_line_id,
  line_index,
  coalesce(
    item->>'SKU',
    item->>'sku',
    item->>'productSku',
    item->>'productSKU',
    item->>'variantSku',
    item->>'variantSKU',
    item->>'code',
    item->>'productCode',
    item->>'variantCode',
    item->>'externalSku',
    item#>>'{product,SKU}',
    item#>>'{product,sku}',
    item#>>'{variant,SKU}',
    item#>>'{variant,sku}'
  ) as external_sku_code,
  coalesce(
    item->>'name',
    item->>'productName',
    item->>'description',
    item->>'title',
    item#>>'{product,name}',
    item#>>'{variant,name}'
  ) as external_product_name,
  coalesce(item->>'productId', item->>'product_id', item#>>'{product,id}') as product_id,
  coalesce(item->>'variantId', item->>'variant_id', item#>>'{variant,id}') as variant_id,
  coalesce(public.ecoflow_try_numeric(item->>'quantity'), public.ecoflow_try_numeric(item->>'qty'), 0)::numeric(12,4) as quantity,
  coalesce(public.ecoflow_try_numeric(item->>'price'), public.ecoflow_try_numeric(item->>'ratePrice'), public.ecoflow_try_numeric(item->>'unitPrice'), 0)::numeric(12,4) as price,
  coalesce(public.ecoflow_try_numeric(item->>'ratePrice'), public.ecoflow_try_numeric(item->>'price'), public.ecoflow_try_numeric(item->>'unitPrice'), 0)::numeric(12,4) as rate_price,
  coalesce(public.ecoflow_try_numeric(item->>'subtotal'), public.ecoflow_try_numeric(item->>'subTotal'), 0)::numeric(12,4) as subtotal,
  coalesce(public.ecoflow_try_numeric(item->>'gst'), public.ecoflow_try_numeric(item->>'totalGst'), 0)::numeric(12,4) as gst,
  coalesce(public.ecoflow_try_numeric(item->>'tax'), 0)::numeric(12,4) as tax,
  coalesce(public.ecoflow_try_numeric(item->>'total'), public.ecoflow_try_numeric(item->>'lineTotal'), 0)::numeric(12,4) as total,
  coalesce(item->>'unit', item#>>'{product,unit}') as unit,
  coalesce(item->>'uom', item#>>'{product,uom}') as uom,
  public.ecoflow_try_numeric(coalesce(item->>'packingUnit', item->>'packing_unit'))::numeric(12,4) as packing_unit,
  'ordermentum_raw_orders'::text as source,
  item as raw_line_payload
from extracted
where item is not null;

create or replace view public.v_ecoflow_ordermentum_order_lines_v2 as
select
  r.id as raw_order_id,
  o.id::text as source_order_id,
  o.order_number,
  o.invoice_number,
  oi.id::text as source_line_id,
  row_number() over (partition by o.id order by oi.id)::int as line_index,
  oi.sku as external_sku_code,
  oi.name as external_product_name,
  oi.product_id::text as product_id,
  oi.variant_id::text as variant_id,
  oi.quantity::numeric(12,4) as quantity,
  oi.price::numeric(12,4) as price,
  oi.rate_price::numeric(12,4) as rate_price,
  oi.subtotal::numeric(12,4) as subtotal,
  oi.gst::numeric(12,4) as gst,
  oi.tax::numeric(12,4) as tax,
  oi.total::numeric(12,4) as total,
  oi.unit,
  oi.uom,
  oi.packing_unit::numeric(12,4) as packing_unit,
  'om_order_items'::text as source
from public.om_order_items oi
join public.om_orders o
  on o.id = oi.order_id
left join public.ordermentum_raw_orders r
  on r.external_order_id = o.id::text

union all

select
  rl.raw_order_id,
  rl.external_order_id as source_order_id,
  rl.order_number,
  rl.invoice_number,
  rl.source_line_id,
  rl.line_index,
  rl.external_sku_code,
  rl.external_product_name,
  rl.product_id,
  rl.variant_id,
  rl.quantity,
  rl.price,
  rl.rate_price,
  rl.subtotal,
  rl.gst,
  rl.tax,
  rl.total,
  rl.unit,
  rl.uom,
  rl.packing_unit,
  rl.source
from public.v_ecoflow_ordermentum_raw_order_line_extract_v2 rl
where not exists (
  select 1
  from public.om_orders o
  join public.om_order_items oi on oi.order_id = o.id
  where o.id::text = rl.external_order_id
)

union all

select
  r.id as raw_order_id,
  l.source_order_id,
  l.order_number,
  l.invoice_number,
  l.source_line_id,
  l.line_index,
  l.external_sku_code,
  l.external_product_name,
  null::text as product_id,
  null::text as variant_id,
  l.quantity,
  l.price,
  l.rate_price,
  l.subtotal,
  l.gst,
  l.tax,
  l.total,
  l.unit,
  l.uom,
  l.packing_unit,
  l.source
from public.v_ecoflow_ordermentum_order_lines l
left join public.ordermentum_raw_orders r
  on r.external_order_id = l.source_order_id
where l.source = 'ordermentum_raw_invoices'
  and not exists (
    select 1
    from public.v_ecoflow_ordermentum_order_lines_v2 existing
    where existing.source_order_id = l.source_order_id
      and existing.external_sku_code = l.external_sku_code
      and existing.source <> 'ordermentum_raw_invoices'
  );

create or replace view public.v_ecoflow_ordermentum_all_orders_audit_v2 as
with line_totals as (
  select
    coalesce(raw_order_id::text, source_order_id) as order_key,
    count(*)::bigint as line_count,
    count(*) filter (where external_sku_code is null or btrim(external_sku_code) = '')::bigint as missing_sku_lines,
    coalesce(sum(quantity), 0)::numeric(12,4) as total_quantity,
    coalesce(sum(total), 0)::numeric(12,4) as line_total_value,
    string_agg(distinct source, ', ' order by source) as line_sources
  from public.v_ecoflow_ordermentum_order_lines_v2
  group by coalesce(raw_order_id::text, source_order_id)
)
select
  r.id as raw_order_id,
  r.external_order_id,
  r.external_order_number as order_number,
  r.external_invoice_number as invoice_number,
  coalesce(r.raw_payload->>'status', r.raw_payload#>>'{order,status}') as order_status,
  coalesce(r.raw_payload->>'paymentStatus', r.raw_payload->>'payment_status', r.raw_payload#>>'{payment,status}') as payment_status,
  coalesce(
    r.raw_payload->>'retailerName',
    r.raw_payload->>'customerName',
    r.raw_payload#>>'{retailer,name}',
    r.raw_payload#>>'{customer,name}',
    r.raw_payload#>>'{store,name}'
  ) as customer_or_store_name,
  r.external_created_at as order_created_at,
  r.external_updated_at as order_updated_at,
  (coalesce(r.external_created_at, r.created_at) at time zone 'Australia/Adelaide')::date as order_created_day,
  (coalesce(r.external_updated_at, r.updated_at) at time zone 'Australia/Adelaide')::date as order_updated_day,
  coalesce(lt.line_count, 0)::bigint as line_count,
  coalesce(lt.missing_sku_lines, 0)::bigint as missing_sku_lines,
  coalesce(lt.total_quantity, 0)::numeric(12,4) as total_quantity,
  coalesce(
    public.ecoflow_try_numeric(r.raw_payload->>'total'),
    public.ecoflow_try_numeric(r.raw_payload->>'totalDue'),
    public.ecoflow_try_numeric(r.raw_payload->>'total_due'),
    lt.line_total_value,
    0
  )::numeric(12,4) as order_total_value,
  coalesce(lt.line_total_value, 0)::numeric(12,4) as line_total_value,
  case
    when coalesce(lt.line_count, 0) = 0 then 'MISSING_LINES'
    when coalesce(lt.missing_sku_lines, 0) > 0 then 'LINES_WITHOUT_SKU'
    else 'OK'
  end as order_data_status,
  lt.line_sources,
  r.import_source,
  r.first_seen_at,
  r.last_seen_at,
  r.last_synced_at,
  r.payload_hash,
  r.created_at as raw_created_at,
  r.updated_at as raw_updated_at
from public.ordermentum_raw_orders r
left join line_totals lt
  on lt.order_key = r.id::text
  or lt.order_key = r.external_order_id;

create or replace view public.v_ecoflow_ordermentum_order_monthly_summary_v2 as
select
  date_trunc('month', order_created_at)::date as order_month,
  count(*)::bigint as order_count,
  count(*) filter (where order_data_status = 'OK')::bigint as ok_orders,
  count(*) filter (where order_data_status <> 'OK')::bigint as orders_with_data_issues,
  coalesce(sum(order_total_value), 0)::numeric(12,4) as sales_value,
  coalesce(sum(total_quantity), 0)::numeric(12,4) as quantity,
  max(order_updated_at) as latest_order_update,
  max(last_synced_at) as latest_sync_at
from public.v_ecoflow_ordermentum_all_orders_audit_v2
where order_created_at is not null
group by date_trunc('month', order_created_at)::date;

create or replace view public.v_ecoflow_sku_activity_summary_v2 as
with sku_lines as (
  select
    l.external_sku_code,
    max(l.external_product_name) as external_product_name,
    l.order_number,
    l.raw_order_id,
    o.customer_or_store_name,
    o.order_created_at,
    o.order_updated_at,
    o.order_created_day,
    l.quantity,
    l.total,
    l.unit,
    l.uom
  from public.v_ecoflow_ordermentum_order_lines_v2 l
  left join public.v_ecoflow_ordermentum_all_orders_audit_v2 o
    on o.raw_order_id = l.raw_order_id
    or o.external_order_id = l.source_order_id
  where l.external_sku_code is not null
    and btrim(l.external_sku_code) <> ''
)
select
  external_sku_code,
  max(external_product_name) as external_product_name,
  min(order_created_day) as first_ordered_day,
  max(order_created_day) as last_ordered_day,
  max(order_updated_at) as last_order_updated_at,
  count(distinct order_number)::bigint as lifetime_order_count,
  count(distinct customer_or_store_name) filter (where customer_or_store_name is not null)::bigint as customer_count,
  count(*)::bigint as lifetime_line_count,
  coalesce(sum(quantity), 0)::numeric(12,4) as lifetime_quantity,
  coalesce(sum(total), 0)::numeric(12,4) as lifetime_sales_value,
  coalesce(avg(nullif(quantity, 0)), 0)::numeric(12,4) as avg_quantity_per_line,
  count(distinct order_number) filter (where order_created_day >= (current_date - interval '30 days')::date)::bigint as orders_30d,
  count(distinct order_number) filter (where order_created_day >= (current_date - interval '60 days')::date)::bigint as orders_60d,
  count(distinct order_number) filter (where order_created_day >= (current_date - interval '90 days')::date)::bigint as orders_90d,
  coalesce(sum(quantity) filter (where order_created_day >= (current_date - interval '30 days')::date), 0)::numeric(12,4) as quantity_30d,
  coalesce(sum(total) filter (where order_created_day >= (current_date - interval '30 days')::date), 0)::numeric(12,4) as sales_value_30d,
  max(unit) as sample_unit,
  max(uom) as sample_uom,
  case
    when external_sku_code ilike '%freight%' or max(external_product_name) ilike '%freight%' then true
    when external_sku_code ilike 'FC-%' then true
    else false
  end as likely_service_item
from sku_lines
group by external_sku_code;

create or replace view public.v_ecoflow_sku_abc_analysis_v2 as
with base as (
  select
    s.*,
    sum(s.lifetime_sales_value) over () as total_sales_all_skus,
    sum(s.lifetime_quantity) over () as total_quantity_all_skus
  from public.v_ecoflow_sku_activity_summary_v2 s
), ranked as (
  select
    b.*,
    row_number() over (order by lifetime_sales_value desc, lifetime_order_count desc, external_sku_code) as sales_rank,
    row_number() over (order by lifetime_quantity desc, lifetime_order_count desc, external_sku_code) as quantity_rank,
    case when total_sales_all_skus > 0
      then sum(lifetime_sales_value) over (order by lifetime_sales_value desc, lifetime_order_count desc, external_sku_code rows between unbounded preceding and current row) / total_sales_all_skus
      else 0 end as cumulative_sales_share,
    case when total_quantity_all_skus > 0
      then sum(lifetime_quantity) over (order by lifetime_quantity desc, lifetime_order_count desc, external_sku_code rows between unbounded preceding and current row) / total_quantity_all_skus
      else 0 end as cumulative_quantity_share
  from base b
)
select
  *,
  case
    when likely_service_item then 'SERVICE'
    when cumulative_sales_share <= 0.80 then 'A'
    when cumulative_sales_share <= 0.95 then 'B'
    else 'C'
  end as abc_sales_class,
  case
    when likely_service_item then 'SERVICE'
    when cumulative_quantity_share <= 0.80 then 'A'
    when cumulative_quantity_share <= 0.95 then 'B'
    else 'C'
  end as abc_quantity_class,
  case
    when likely_service_item then 'SERVICE'
    when orders_30d >= 10 then 'FAST'
    when orders_90d >= 10 then 'MEDIUM'
    when lifetime_order_count > 0 then 'SLOW'
    else 'DORMANT'
  end as movement_class
from ranked;

create or replace view public.v_ecoflow_ordermentum_sku_library_dashboard_v2 as
with listed as (
  select count(distinct sku)::bigint as listed_sku_count
  from (
    select sku from public.om_products where sku is not null and btrim(sku) <> ''
    union
    select sku from public.om_variants where sku is not null and btrim(sku) <> ''
  ) x
), ordered as (
  select * from public.v_ecoflow_sku_abc_analysis_v2
), barcode_counts as (
  select
    count(distinct sku_id) filter (where status = 'CONFIRMED')::bigint as barcode_confirmed_sku_count,
    count(distinct sku_id) filter (where status = 'CONFIRMED' and level_code = 'CARTON')::bigint as carton_barcode_confirmed_sku_count,
    count(distinct sku_id) filter (where status = 'CONFIRMED' and level_code = 'SLEEVE')::bigint as sleeve_barcode_confirmed_sku_count
  from public.sku_barcodes
)
select
  listed.listed_sku_count,
  (select count(*)::bigint from ordered)::bigint as ordered_sku_count,
  greatest(listed.listed_sku_count - (select count(*) from ordered), 0)::bigint as dormant_or_unordered_sku_count,
  (select count(*)::bigint from ordered where likely_service_item = true)::bigint as service_item_count,
  (select count(*)::bigint from ordered where abc_sales_class = 'A')::bigint as a_class_sku_count,
  (select count(*)::bigint from ordered where movement_class = 'FAST')::bigint as fast_moving_sku_count,
  coalesce(barcode_counts.barcode_confirmed_sku_count, 0)::bigint as barcode_confirmed_sku_count,
  coalesce(barcode_counts.carton_barcode_confirmed_sku_count, 0)::bigint as carton_barcode_confirmed_sku_count,
  coalesce(barcode_counts.sleeve_barcode_confirmed_sku_count, 0)::bigint as sleeve_barcode_confirmed_sku_count,
  (select count(*)::bigint from ordered where likely_service_item = false)::bigint - coalesce(barcode_counts.carton_barcode_confirmed_sku_count, 0)::bigint as ordered_skus_missing_carton_barcode,
  coalesce((select sum(lifetime_sales_value) from ordered), 0)::numeric(12,4) as total_lifetime_sales_value,
  coalesce((select sum(lifetime_quantity) from ordered), 0)::numeric(12,4) as total_lifetime_quantity,
  (select max(last_ordered_day) from ordered)::date as latest_ordered_day,
  (select count(*) from public.ordermentum_raw_orders)::bigint as raw_order_count,
  (select min(external_created_at) from public.ordermentum_raw_orders) as first_raw_order_created_at,
  (select max(external_created_at) from public.ordermentum_raw_orders) as latest_raw_order_created_at,
  (select max(external_updated_at) from public.ordermentum_raw_orders) as latest_raw_order_updated_at,
  (select max(last_synced_at) from public.ordermentum_raw_orders) as latest_raw_order_synced_at
from listed
cross join barcode_counts;

create or replace view public.v_ecoflow_top_skus_for_barcode_confirmation_v2 as
select
  row_number() over (
    order by
      case when likely_service_item then 1 else 0 end,
      case abc_sales_class when 'A' then 1 when 'B' then 2 else 3 end,
      lifetime_sales_value desc,
      lifetime_order_count desc,
      external_sku_code
  )::bigint as barcode_priority_rank,
  external_sku_code,
  external_product_name,
  abc_sales_class,
  abc_quantity_class,
  movement_class,
  lifetime_order_count,
  lifetime_quantity,
  lifetime_sales_value,
  orders_30d,
  orders_60d,
  orders_90d,
  sample_unit,
  sample_uom,
  likely_service_item,
  case
    when likely_service_item then 'SERVICE_ITEM_NO_BARCODE_REQUIRED'
    else 'MISSING_CONFIRMED_CARTON_BARCODE'
  end as required_action
from public.v_ecoflow_sku_abc_analysis_v2;

commit;
