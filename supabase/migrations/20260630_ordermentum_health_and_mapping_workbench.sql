-- EcoFlow Ordermentum Health + SKU Mapping Workbench
-- Safe migration: creates/replaces views only. No table data is deleted or updated.

begin;

create or replace view public.v_ecoflow_ordermentum_system_health_checks as
with counts as (
  select
    (select count(*) from public.ordermentum_raw_orders)::bigint as raw_orders,
    (select count(*) from public.ordermentum_order_versions)::bigint as order_versions,
    (select count(*) from public.ordermentum_legacy_links)::bigint as legacy_links,
    (select count(*) from public.ordermentum_raw_invoices)::bigint as raw_invoices,
    (select count(*) from public.om_orders)::bigint as om_orders,
    (select count(*) from public.om_invoices)::bigint as om_invoices,
    (select count(*) from public.om_order_items)::bigint as om_order_items,
    (select count(*) from public.om_products)::bigint as om_products,
    (select count(*) from public.om_variants)::bigint as om_variants,
    (select count(*) from public.om_product_prices)::bigint as om_product_prices,
    (select count(*) from public.om_customers)::bigint as om_customers,
    (select count(*) from public.om_price_groups)::bigint as om_price_groups,
    (select count(*) from public.v_ecoflow_ordermentum_inbox)::bigint as inbox_orders,
    (select count(*) from public.v_ecoflow_ordermentum_order_lines)::bigint as inbox_lines,
    (select count(*) from public.v_ecoflow_ordermentum_exceptions)::bigint as open_exceptions,
    (select coalesce(sum(case when release_gate_status = 'BLOCKED_DATA' then 1 else 0 end),0) from public.v_ecoflow_ordermentum_release_gate_v2)::bigint as blocked_data,
    (select coalesce(sum(case when release_gate_status = 'BLOCKED_MAPPING' then 1 else 0 end),0) from public.v_ecoflow_ordermentum_release_gate_v2)::bigint as blocked_mapping,
    (select coalesce(sum(case when release_gate_status = 'READY_TO_INTERNALISE' then 1 else 0 end),0) from public.v_ecoflow_ordermentum_release_gate_v2)::bigint as ready_to_internalise,
    (select coalesce(sum(case when release_gate_status = 'REVIEW_PAYMENT' then 1 else 0 end),0) from public.v_ecoflow_ordermentum_release_gate_v2)::bigint as review_payment,
    (select max(last_synced_at) from public.ordermentum_raw_orders) as last_raw_order_sync,
    (select max(created_at) from public.ordermentum_raw_invoices) as last_raw_invoice_capture
)
select * from (
  select
    'RAW_ORDERS_CAPTURED'::text as check_key,
    case when raw_orders = inbox_orders and raw_orders > 0 then 'OK' else 'WARN' end as status,
    raw_orders::text as current_value,
    inbox_orders::text as expected_value,
    'Every raw order should appear in the Ordermentum inbox.'::text as message,
    10::integer as sort_order
  from counts

  union all
  select
    'ORDER_VERSION_COVERAGE',
    case when order_versions >= raw_orders and raw_orders > 0 then 'OK' else 'WARN' end,
    order_versions::text,
    raw_orders::text,
    'Each raw order should have at least one captured payload version.',
    20
  from counts

  union all
  select
    'LEGACY_LINK_COVERAGE',
    case when legacy_links >= raw_orders and raw_orders > 0 then 'OK' else 'WARN' end,
    legacy_links::text,
    raw_orders::text,
    'Legacy om_orders rows should be linked to canonical raw orders.',
    30
  from counts

  union all
  select
    'INVOICE_GAPS',
    case when blocked_data = 0 and open_exceptions = 0 then 'OK' else 'BLOCKED' end,
    blocked_data::text,
    '0',
    'No order should be blocked by missing invoice detail or missing line items.',
    40
  from counts

  union all
  select
    'LINE_ITEM_COVERAGE',
    case when inbox_lines >= om_order_items then 'OK' else 'WARN' end,
    inbox_lines::text,
    om_order_items::text,
    'Order line view should cover all existing om_order_items plus any raw invoice fallback lines.',
    50
  from counts

  union all
  select
    'MAPPING_GATE',
    case when blocked_mapping = 0 then 'OK' else 'ACTION_REQUIRED' end,
    blocked_mapping::text,
    '0',
    'Orders blocked by SKU mapping must be resolved before internal order creation.',
    60
  from counts

  union all
  select
    'PAYMENT_REVIEW',
    case when review_payment = 0 then 'OK' else 'REVIEW' end,
    review_payment::text,
    '0',
    'Orders requiring account/payment review should not be silently released.',
    70
  from counts

  union all
  select
    'READY_TO_INTERNALISE',
    case when ready_to_internalise > 0 then 'OK' else 'INFO' end,
    ready_to_internalise::text,
    '>= 1 after mapping',
    'Orders become internal-order candidates only after data, mapping, payment, and stock gates pass.',
    80
  from counts

  union all
  select
    'LAST_SYNC',
    case when last_raw_order_sync is not null then 'OK' else 'WARN' end,
    coalesce(last_raw_order_sync::text, 'null'),
    'not null',
    'Last raw order sync timestamp is recorded.',
    90
  from counts
) x
order by sort_order;

create or replace view public.v_ecoflow_ordermentum_sku_mapping_workbench as
with line_stats as (
  select
    coalesce(nullif(trim(external_sku_code), ''), 'NO_SKU') as external_sku_code,
    coalesce(nullif(trim(external_product_name), ''), 'Unnamed Ordermentum item') as external_product_name,
    count(*)::bigint as line_count,
    count(distinct order_number)::bigint as order_count,
    coalesce(sum(quantity), 0)::numeric(12,4) as total_required_quantity,
    coalesce(sum(total), 0)::numeric(12,4) as total_sales_value,
    min(order_number)::text as first_seen_order_number,
    max(order_number)::text as latest_seen_order_number
  from public.v_ecoflow_ordermentum_order_lines
  group by
    coalesce(nullif(trim(external_sku_code), ''), 'NO_SKU'),
    coalesce(nullif(trim(external_product_name), ''), 'Unnamed Ordermentum item')
),
mapping_status as (
  select
    s.*,
    case
      when s.external_sku_code = 'NO_SKU' then 'MISSING_EXTERNAL_SKU'
      when exists (
        select 1
        from public.external_product_mappings m
        where m.provider = 'ORDERMENTUM'
          and m.external_product_code = s.external_sku_code
      ) then 'MAPPED'
      else 'UNMAPPED'
    end as mapping_status
  from line_stats s
)
select
  row_number() over (
    order by
      case mapping_status
        when 'UNMAPPED' then 1
        when 'MISSING_EXTERNAL_SKU' then 2
        when 'MAPPED' then 3
        else 9
      end,
      order_count desc,
      total_sales_value desc,
      external_sku_code
  )::integer as priority_rank,
  external_sku_code,
  external_product_name,
  line_count,
  order_count,
  total_required_quantity,
  total_sales_value,
  mapping_status,
  first_seen_order_number,
  latest_seen_order_number,
  case
    when mapping_status = 'MAPPED' then 'Ready'
    when mapping_status = 'MISSING_EXTERNAL_SKU' then 'Review source data'
    else 'Map to EcoFlow SKU'
  end as required_action
from mapping_status;

create or replace view public.v_ecoflow_ordermentum_daily_workbench as
select
  updated_business_day as business_day,
  count(*)::bigint as total_orders,
  count(*) filter (where release_gate_status = 'READY_TO_INTERNALISE')::bigint as ready_to_internalise,
  count(*) filter (where release_gate_status = 'BLOCKED_MAPPING')::bigint as blocked_mapping,
  count(*) filter (where release_gate_status = 'BLOCKED_DATA')::bigint as blocked_data,
  count(*) filter (where release_gate_status = 'REVIEW_PAYMENT')::bigint as review_payment,
  coalesce(sum(invoice_total), 0)::numeric(12,4) as invoice_total,
  coalesce(sum(total_due), 0)::numeric(12,4) as total_due,
  max(order_updated_at) as latest_order_update
from public.v_ecoflow_ordermentum_release_gate_v2
group by updated_business_day;

create or replace view public.v_ecoflow_ordermentum_internal_order_drafts as
select
  g.raw_order_id,
  g.external_order_id,
  g.order_number as external_order_number,
  g.invoice_number as external_invoice_number,
  ('ECO-' || regexp_replace(coalesce(g.order_number, g.external_order_number), '[^0-9A-Za-z]+', '', 'g'))::text as draft_internal_order_number,
  g.payment_status,
  g.invoice_total::numeric(12,4) as invoice_total,
  g.line_count,
  g.updated_business_day as business_day,
  g.release_gate_status,
  case
    when g.release_gate_status = 'READY_TO_INTERNALISE' then 'DRAFT_READY'
    else 'NOT_READY'
  end as draft_status,
  case
    when g.release_gate_status = 'READY_TO_INTERNALISE' then 'Can create internal order after final release approval'
    when g.release_gate_status = 'BLOCKED_MAPPING' then 'Resolve SKU mapping before drafting internal order'
    when g.release_gate_status = 'BLOCKED_DATA' then 'Resolve missing invoice or line data before drafting internal order'
    when g.release_gate_status = 'REVIEW_PAYMENT' then 'Account review required before drafting internal order'
    else 'Review release gate status'
  end as draft_note
from public.v_ecoflow_ordermentum_release_gate_v2 g;

commit;
