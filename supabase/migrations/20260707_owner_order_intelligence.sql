-- Owner-facing order intelligence views.
-- These views are read-only reporting surfaces for the Orders page: order KPIs,
-- SKU velocity, daily trend, and workflow status mix. They use the confirmed
-- internal-order source tables instead of rendering raw Ordermentum history.

drop view if exists public.v_ecoflow_owner_order_status_report;
drop view if exists public.v_ecoflow_owner_daily_order_report;
drop view if exists public.v_ecoflow_owner_sku_velocity;
drop view if exists public.v_ecoflow_owner_order_kpis;

create view public.v_ecoflow_owner_order_kpis as
with orders as (
  select
    o.*,
    coalesce(o.imported_at, o.last_synced_at, o.created_at, o.updated_at) as order_ts,
    coalesce(o.invoice_total, o.total_due, 0)::numeric as order_value,
    lower(coalesce(o.status, '')) as status_lc,
    lower(coalesce(o.account_release_status, '')) as account_lc,
    lower(coalesce(o.warehouse_gate_status, '')) as gate_lc
  from public.ecoflow_ordermentum_internal_orders o
), lines as (
  select
    l.*,
    o.order_ts,
    o.status_lc,
    coalesce(l.quantity, 0)::numeric as qty,
    coalesce(l.total, l.subtotal, 0)::numeric as line_value
  from public.ecoflow_ordermentum_internal_order_lines l
  join orders o on o.id = l.internal_order_id
), ranked_skus as (
  select
    coalesce(nullif(l.external_sku_code, ''), 'UNKNOWN') as sku,
    max(coalesce(nullif(l.external_product_name, ''), 'Unknown product')) as product_name,
    sum(l.qty) filter (where l.order_ts >= now() - interval '30 days') as qty_30d,
    sum(l.line_value) filter (where l.order_ts >= now() - interval '30 days') as revenue_30d
  from lines l
  where l.status_lc not in ('legacy_cancelled','legacy_rebuild_superseded','cancelled','canceled')
  group by coalesce(nullif(l.external_sku_code, ''), 'UNKNOWN')
  order by sum(l.qty) filter (where l.order_ts >= now() - interval '30 days') desc nulls last
  limit 1
)
select
  count(*) filter (where status_lc not in ('legacy_cancelled','legacy_rebuild_superseded','cancelled','canceled','completed','closed','delivered'))::numeric as active_internal_orders,
  count(*) filter (where order_ts >= now() - interval '7 days')::numeric as orders_7d,
  count(*) filter (where order_ts >= now() - interval '30 days')::numeric as orders_30d,
  coalesce(sum(order_value) filter (where order_ts >= now() - interval '7 days'), 0)::numeric as revenue_7d,
  coalesce(sum(order_value) filter (where order_ts >= now() - interval '30 days'), 0)::numeric as revenue_30d,
  coalesce(avg(order_value) filter (where order_ts >= now() - interval '30 days'), 0)::numeric as avg_order_value_30d,
  (select count(*) from public.v_ecoflow_order_lifecycle_legacy_internal_review)::numeric as legacy_review_orders,
  (select count(*) from public.v_ecoflow_order_lifecycle_active)::numeric as lifecycle_active_orders,
  coalesce((select sum(qty) from lines where order_ts >= now() - interval '30 days'), 0)::numeric as units_30d,
  (select sku from ranked_skus) as top_sku_30d,
  (select product_name from ranked_skus) as top_product_30d,
  (select coalesce(qty_30d, 0) from ranked_skus) as top_sku_units_30d,
  max(order_ts) as latest_order_at
from orders;

grant select on public.v_ecoflow_owner_order_kpis to authenticated;

create view public.v_ecoflow_owner_sku_velocity as
with line_fact as (
  select
    coalesce(nullif(l.external_sku_code, ''), 'UNKNOWN') as sku,
    coalesce(nullif(l.external_product_name, ''), 'Unknown product') as product_name,
    coalesce(l.quantity, 0)::numeric as qty,
    coalesce(l.total, l.subtotal, 0)::numeric as line_value,
    coalesce(l.price, l.rate_price, 0)::numeric as unit_price,
    coalesce(nullif(l.barcode_status, ''), 'UNKNOWN') as barcode_status,
    nullif(l.warehouse_barcode, '') as warehouse_barcode,
    coalesce(o.imported_at, o.last_synced_at, o.created_at, o.updated_at, l.created_at) as order_ts,
    o.id as internal_order_id,
    lower(coalesce(o.status, '')) as order_status
  from public.ecoflow_ordermentum_internal_order_lines l
  join public.ecoflow_ordermentum_internal_orders o on o.id = l.internal_order_id
)
select
  sku,
  max(product_name) as product_name,
  count(distinct internal_order_id)::numeric as order_count,
  coalesce(sum(qty), 0)::numeric as total_units,
  coalesce(sum(line_value), 0)::numeric as total_revenue,
  coalesce(sum(qty) filter (where order_ts >= now() - interval '7 days'), 0)::numeric as units_7d,
  coalesce(sum(line_value) filter (where order_ts >= now() - interval '7 days'), 0)::numeric as revenue_7d,
  coalesce(sum(qty) filter (where order_ts >= now() - interval '30 days'), 0)::numeric as units_30d,
  coalesce(sum(line_value) filter (where order_ts >= now() - interval '30 days'), 0)::numeric as revenue_30d,
  coalesce(avg(nullif(unit_price, 0)), 0)::numeric as avg_unit_price,
  max(order_ts) as last_sold_at,
  count(*) filter (where warehouse_barcode is null or barcode_status not in ('CONFIRMED','READY','OK'))::numeric as barcode_attention_lines,
  max(barcode_status) as latest_barcode_status,
  max(warehouse_barcode) as warehouse_barcode,
  dense_rank() over (order by coalesce(sum(qty) filter (where order_ts >= now() - interval '30 days'), 0) desc, coalesce(sum(line_value) filter (where order_ts >= now() - interval '30 days'), 0) desc) as velocity_rank
from line_fact
where order_status not in ('legacy_cancelled','legacy_rebuild_superseded','cancelled','canceled')
group by sku
order by velocity_rank asc, revenue_30d desc
limit 120;

grant select on public.v_ecoflow_owner_sku_velocity to authenticated;

create view public.v_ecoflow_owner_daily_order_report as
with orders as (
  select
    date_trunc('day', coalesce(o.imported_at, o.last_synced_at, o.created_at, o.updated_at))::date as order_day,
    o.id,
    coalesce(o.invoice_total, o.total_due, 0)::numeric as order_value,
    lower(coalesce(o.status, '')) as status_lc
  from public.ecoflow_ordermentum_internal_orders o
  where coalesce(o.imported_at, o.last_synced_at, o.created_at, o.updated_at) >= current_date - interval '60 days'
), lines as (
  select
    o.order_day,
    coalesce(nullif(l.external_sku_code, ''), 'UNKNOWN') as sku,
    coalesce(l.quantity, 0)::numeric as qty
  from orders o
  join public.ecoflow_ordermentum_internal_order_lines l on l.internal_order_id = o.id
)
select
  o.order_day,
  count(distinct o.id)::numeric as order_count,
  count(distinct o.id) filter (where o.status_lc not in ('legacy_cancelled','legacy_rebuild_superseded','cancelled','canceled','completed','closed','delivered'))::numeric as active_order_count,
  count(distinct o.id) filter (where o.status_lc in ('legacy_cancelled','legacy_rebuild_superseded','cancelled','canceled'))::numeric as cancelled_or_legacy_count,
  coalesce(sum(o.order_value), 0)::numeric as revenue,
  coalesce((select sum(l.qty) from lines l where l.order_day = o.order_day), 0)::numeric as units,
  coalesce((select count(distinct l.sku) from lines l where l.order_day = o.order_day), 0)::numeric as sku_count
from orders o
group by o.order_day
order by o.order_day desc;

grant select on public.v_ecoflow_owner_daily_order_report to authenticated;

create view public.v_ecoflow_owner_order_status_report as
select
  coalesce(nullif(o.status, ''), 'UNKNOWN') as status,
  coalesce(nullif(o.account_release_status, ''), 'UNKNOWN') as account_release_status,
  coalesce(nullif(o.warehouse_gate_status, ''), 'UNKNOWN') as warehouse_gate_status,
  count(*)::numeric as order_count,
  coalesce(sum(coalesce(o.invoice_total, o.total_due, 0)), 0)::numeric as total_value,
  min(coalesce(o.imported_at, o.last_synced_at, o.created_at, o.updated_at)) as oldest_at,
  max(coalesce(o.imported_at, o.last_synced_at, o.created_at, o.updated_at)) as newest_at
from public.ecoflow_ordermentum_internal_orders o
group by coalesce(nullif(o.status, ''), 'UNKNOWN'), coalesce(nullif(o.account_release_status, ''), 'UNKNOWN'), coalesce(nullif(o.warehouse_gate_status, ''), 'UNKNOWN')
order by order_count desc;

grant select on public.v_ecoflow_owner_order_status_report to authenticated;

notify pgrst, 'reload schema';
