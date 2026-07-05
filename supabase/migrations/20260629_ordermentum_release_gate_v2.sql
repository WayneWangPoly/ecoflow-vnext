-- EcoFlow Ordermentum release gate v2
-- Safe migration: creates or replaces read-only views only. No existing data is changed.
-- Purpose: separate data completeness from operational readiness before internal orders are created.

create or replace view public.v_ecoflow_ordermentum_sku_mapping_candidates as
with line_usage as (
  select
    nullif(trim(line.sku), '') as external_sku_code,
    max(line.name) as external_product_name,
    count(distinct line.external_order_id) as order_count,
    count(*) as line_count,
    coalesce(sum(line.quantity), 0) as total_required_quantity,
    coalesce(sum(line.total), 0) as total_value
  from public.v_ecoflow_ordermentum_order_lines line
  group by nullif(trim(line.sku), '')
)
select
  usage.external_sku_code,
  usage.external_product_name,
  usage.order_count,
  usage.line_count,
  usage.total_required_quantity,
  usage.total_value,
  mapping.id as mapping_id,
  mapping.internal_sku_id,
  sku.sku_code as internal_sku_code,
  sku.display_name as internal_sku_name,
  mapping.default_unit_level,
  mapping.confidence,
  case
    when usage.external_sku_code is null then 'MISSING_EXTERNAL_SKU'
    when mapping.id is null then 'UNMAPPED'
    when sku.id is null then 'BROKEN_MAPPING'
    else 'MAPPED'
  end as mapping_status
from line_usage usage
left join public.external_product_mappings mapping
  on mapping.provider = 'ORDERMENTUM'
 and mapping.external_product_code = usage.external_sku_code
 and mapping.is_active = true
left join public.skus sku
  on sku.id = mapping.internal_sku_id;

create or replace view public.v_ecoflow_ordermentum_release_gate_v2 as
with line_mapping as (
  select
    line.external_order_id,
    line.order_number,
    line.invoice_number,
    count(*) as line_count,
    coalesce(sum(line.quantity), 0) as required_quantity,
    count(*) filter (where mapping.id is not null and sku.id is not null) as mapped_line_count,
    count(*) filter (where mapping.id is null or sku.id is null) as unmapped_line_count,
    coalesce(sum(line.quantity) filter (where mapping.id is not null and sku.id is not null), 0) as mapped_required_quantity,
    coalesce(sum(inv.quantity_available) filter (where mapping.id is not null and sku.id is not null), 0) as mapped_available_quantity,
    count(*) filter (
      where mapping.id is not null
        and sku.id is not null
        and coalesce(inv.quantity_available, 0) < coalesce(line.quantity, 0)
    ) as stock_shortage_count
  from public.v_ecoflow_ordermentum_order_lines line
  left join public.external_product_mappings mapping
    on mapping.provider = 'ORDERMENTUM'
   and mapping.external_product_code = line.sku
   and mapping.is_active = true
  left join public.skus sku
    on sku.id = mapping.internal_sku_id
  left join public.inventory_balances inv
    on inv.sku_id = sku.id
  group by line.external_order_id, line.order_number, line.invoice_number
),
queue as (
  select * from public.v_ecoflow_ordermentum_release_queue
)
select
  queue.raw_order_id,
  queue.external_order_id,
  queue.external_order_number,
  queue.external_invoice_number,
  queue.order_number,
  queue.invoice_number,
  queue.order_status,
  queue.payment_status,
  queue.order_created_at,
  queue.order_updated_at,
  queue.received_business_day,
  queue.updated_business_day,
  queue.invoice_total,
  queue.total_due,
  queue.is_outstanding,
  queue.invoice_detail_missing,
  queue.line_items_missing,
  queue.release_status as data_release_status,
  coalesce(lines.line_count, queue.line_count, 0) as line_count,
  coalesce(lines.required_quantity, queue.total_units, 0) as required_quantity,
  coalesce(lines.mapped_line_count, 0) as mapped_line_count,
  coalesce(lines.unmapped_line_count, case when queue.line_items_missing then 1 else 0 end) as unmapped_line_count,
  coalesce(lines.mapped_required_quantity, 0) as mapped_required_quantity,
  coalesce(lines.mapped_available_quantity, 0) as mapped_available_quantity,
  coalesce(lines.stock_shortage_count, 0) as stock_shortage_count,
  case
    when queue.release_status = 'BLOCKED_DATA' then 'BLOCKED_DATA'
    when coalesce(lines.unmapped_line_count, 0) > 0 then 'BLOCKED_MAPPING'
    when coalesce(lines.stock_shortage_count, 0) > 0 then 'BLOCKED_STOCK'
    when queue.release_status = 'REVIEW_PAYMENT' then 'REVIEW_PAYMENT'
    else 'READY_TO_RELEASE'
  end as operational_release_status,
  concat_ws(', ',
    nullif(queue.release_blockers, ''),
    case when coalesce(lines.unmapped_line_count, 0) > 0 then coalesce(lines.unmapped_line_count, 0)::text || ' SKU lines unmapped' end,
    case when coalesce(lines.stock_shortage_count, 0) > 0 then coalesce(lines.stock_shortage_count, 0)::text || ' stock shortages' end
  ) as operational_blockers,
  case
    when queue.release_status = 'BLOCKED_DATA' then false
    when coalesce(lines.unmapped_line_count, 0) > 0 then false
    when coalesce(lines.stock_shortage_count, 0) > 0 then false
    when queue.release_status = 'REVIEW_PAYMENT' then false
    else true
  end as can_create_internal_order,
  queue.last_synced_at
from queue
left join line_mapping lines
  on lines.external_order_id = queue.external_order_id;

create or replace view public.v_ecoflow_ordermentum_release_summary_v2 as
select
  count(*) as total_orders,
  count(*) filter (where operational_release_status = 'READY_TO_RELEASE') as ready_to_release,
  count(*) filter (where operational_release_status = 'REVIEW_PAYMENT') as review_payment,
  count(*) filter (where operational_release_status = 'BLOCKED_DATA') as blocked_data,
  count(*) filter (where operational_release_status = 'BLOCKED_MAPPING') as blocked_mapping,
  count(*) filter (where operational_release_status = 'BLOCKED_STOCK') as blocked_stock,
  coalesce(sum(line_count), 0) as line_count,
  coalesce(sum(required_quantity), 0) as required_quantity,
  coalesce(sum(mapped_line_count), 0) as mapped_line_count,
  coalesce(sum(unmapped_line_count), 0) as unmapped_line_count,
  coalesce(sum(stock_shortage_count), 0) as stock_shortage_count,
  coalesce(sum(invoice_total), 0) as invoice_total,
  coalesce(sum(total_due), 0) as total_due,
  max(order_updated_at) as latest_order_update,
  max(last_synced_at) as last_synced_at
from public.v_ecoflow_ordermentum_release_gate_v2;

create or replace view public.v_ecoflow_ordermentum_ready_to_internalise as
select *
from public.v_ecoflow_ordermentum_release_gate_v2
where can_create_internal_order = true;
