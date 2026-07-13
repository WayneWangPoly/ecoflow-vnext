-- Owner sales intelligence must measure customer orders when they enter
-- Ordermentum. Internalisation is a later operational gate and must not erase
-- revenue, units or SKU velocity from the Owner report.

begin;

-- These views have downstream inventory and dashboard dependencies in
-- production. Replace them in place with the exact same public column contract.
create or replace view public.v_ecoflow_owner_order_kpis
with (security_invoker = true)
as
with orders as (
  select
    i.raw_order_id::text as raw_order_id,
    i.external_order_id::text as external_order_id,
    i.external_order_number::text as external_order_number,
    i.order_number::text as order_number,
    i.invoice_number::text as invoice_number,
    coalesce(i.order_created_at, i.first_seen_at, i.raw_created_at, i.order_updated_at, i.last_seen_at) as order_ts,
    coalesce(i.invoice_total, i.order_items_total, i.total_due, 0)::numeric as order_value,
    lower(coalesce(i.order_status, '')) as status_lc
  from public.v_ecoflow_ordermentum_inbox i
), eligible_orders as (
  select *
  from orders
  where status_lc not in ('cancelled','canceled','void','voided')
), line_fact as (
  select
    coalesce(nullif(l.external_sku_code, ''), 'UNKNOWN') as sku,
    coalesce(nullif(l.external_product_name, ''), 'Unknown product') as product_name,
    coalesce(l.quantity, 0)::numeric as qty,
    coalesce(l.total, l.subtotal, coalesce(l.price, l.rate_price, 0) * coalesce(l.quantity, 0), 0)::numeric as line_value,
    matched.order_ts
  from public.v_ecoflow_ordermentum_order_lines l
  join lateral (
    select o.order_ts
    from eligible_orders o
    where
      (l.source_order_id is not null and l.source_order_id::text in (o.raw_order_id, o.external_order_id))
      or (l.order_number is not null and l.order_number::text in (o.order_number, o.external_order_number))
      or (l.invoice_number is not null and l.invoice_number::text = o.invoice_number)
    order by o.order_ts desc nulls last
    limit 1
  ) matched on true
), ranked_skus as (
  select
    sku,
    max(product_name) as product_name,
    coalesce(sum(qty) filter (where order_ts >= now() - interval '30 days'), 0)::numeric as qty_30d,
    coalesce(sum(line_value) filter (where order_ts >= now() - interval '30 days'), 0)::numeric as revenue_30d
  from line_fact
  group by sku
  order by qty_30d desc, revenue_30d desc
  limit 1
)
select
  (select count(*) from public.v_ecoflow_order_lifecycle_active)::numeric as active_internal_orders,
  count(*) filter (where order_ts >= now() - interval '7 days')::numeric as orders_7d,
  count(*) filter (where order_ts >= now() - interval '30 days')::numeric as orders_30d,
  coalesce(sum(order_value) filter (where order_ts >= now() - interval '7 days'), 0)::numeric as revenue_7d,
  coalesce(sum(order_value) filter (where order_ts >= now() - interval '30 days'), 0)::numeric as revenue_30d,
  coalesce(avg(order_value) filter (where order_ts >= now() - interval '30 days'), 0)::numeric as avg_order_value_30d,
  (select count(*) from public.v_ecoflow_order_lifecycle_legacy_internal_review)::numeric as legacy_review_orders,
  (select count(*) from public.v_ecoflow_order_lifecycle_active)::numeric as lifecycle_active_orders,
  coalesce((select sum(qty) from line_fact where order_ts >= now() - interval '30 days'), 0)::numeric as units_30d,
  (select sku from ranked_skus) as top_sku_30d,
  (select product_name from ranked_skus) as top_product_30d,
  (select qty_30d from ranked_skus) as top_sku_units_30d,
  max(order_ts) as latest_order_at
from eligible_orders;

grant select on public.v_ecoflow_owner_order_kpis to authenticated;
revoke all on public.v_ecoflow_owner_order_kpis from anon;

create or replace view public.v_ecoflow_owner_sku_velocity
with (security_invoker = true)
as
with orders as (
  select
    i.raw_order_id::text as raw_order_id,
    i.external_order_id::text as external_order_id,
    i.external_order_number::text as external_order_number,
    i.order_number::text as order_number,
    i.invoice_number::text as invoice_number,
    coalesce(i.order_created_at, i.first_seen_at, i.raw_created_at, i.order_updated_at, i.last_seen_at) as order_ts,
    lower(coalesce(i.order_status, '')) as status_lc
  from public.v_ecoflow_ordermentum_inbox i
  where lower(coalesce(i.order_status, '')) not in ('cancelled','canceled','void','voided')
), line_fact as (
  select
    coalesce(nullif(l.external_sku_code, ''), 'UNKNOWN') as sku,
    coalesce(nullif(l.external_product_name, ''), 'Unknown product') as product_name,
    coalesce(l.quantity, 0)::numeric as qty,
    coalesce(l.total, l.subtotal, coalesce(l.price, l.rate_price, 0) * coalesce(l.quantity, 0), 0)::numeric as line_value,
    coalesce(l.price, l.rate_price, 0)::numeric as unit_price,
    matched.order_ts,
    matched.order_key,
    coalesce(nullif(sm.carton_barcode_status, ''), nullif(sm.each_barcode_status, ''), 'UNKNOWN') as barcode_status,
    coalesce(nullif(sm.carton_barcode, ''), nullif(sm.each_barcode, '')) as warehouse_barcode
  from public.v_ecoflow_ordermentum_order_lines l
  join lateral (
    select
      o.order_ts,
      coalesce(o.raw_order_id, o.external_order_id, o.order_number, o.external_order_number, o.invoice_number) as order_key
    from orders o
    where
      (l.source_order_id is not null and l.source_order_id::text in (o.raw_order_id, o.external_order_id))
      or (l.order_number is not null and l.order_number::text in (o.order_number, o.external_order_number))
      or (l.invoice_number is not null and l.invoice_number::text = o.invoice_number)
    order by o.order_ts desc nulls last
    limit 1
  ) matched on true
  left join public.v_ecoflow_app_sku_master sm
    on upper(sm.external_sku_code::text) = upper(l.external_sku_code::text)
)
select
  sku,
  max(product_name) as product_name,
  count(distinct order_key)::numeric as order_count,
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
  dense_rank() over (
    order by
      coalesce(sum(qty) filter (where order_ts >= now() - interval '30 days'), 0) desc,
      coalesce(sum(line_value) filter (where order_ts >= now() - interval '30 days'), 0) desc
  ) as velocity_rank
from line_fact
group by sku
order by velocity_rank asc, revenue_30d desc
limit 120;

grant select on public.v_ecoflow_owner_sku_velocity to authenticated;
revoke all on public.v_ecoflow_owner_sku_velocity from anon;

create or replace view public.v_ecoflow_owner_daily_order_report
with (security_invoker = true)
as
with orders as (
  select
    date_trunc('day', coalesce(i.order_created_at, i.first_seen_at, i.raw_created_at, i.order_updated_at, i.last_seen_at))::date as order_day,
    coalesce(i.raw_order_id::text, i.external_order_id::text, i.order_number::text, i.external_order_number::text) as order_key,
    coalesce(i.invoice_total, i.order_items_total, i.total_due, 0)::numeric as order_value,
    coalesce(i.total_units, 0)::numeric as total_units,
    lower(coalesce(i.order_status, '')) as status_lc
  from public.v_ecoflow_ordermentum_inbox i
  where coalesce(i.order_created_at, i.first_seen_at, i.raw_created_at, i.order_updated_at, i.last_seen_at) >= current_date - interval '60 days'
), eligible as (
  select * from orders where status_lc not in ('cancelled','canceled','void','voided')
)
select
  order_day,
  count(distinct order_key)::numeric as order_count,
  count(distinct order_key)::numeric as active_order_count,
  0::numeric as cancelled_or_legacy_count,
  coalesce(sum(order_value), 0)::numeric as revenue,
  coalesce(sum(total_units), 0)::numeric as units,
  0::numeric as sku_count
from eligible
group by order_day
order by order_day desc;

grant select on public.v_ecoflow_owner_daily_order_report to authenticated;
revoke all on public.v_ecoflow_owner_daily_order_report from anon;

create or replace view public.v_ecoflow_owner_order_status_report
with (security_invoker = true)
as
select
  coalesce(nullif(l.lifecycle_status, ''), 'UNKNOWN') as status,
  coalesce(nullif(l.internalisation_status, ''), 'UNKNOWN') as account_release_status,
  coalesce(nullif(l.warehouse_gate_status, ''), 'UNKNOWN') as warehouse_gate_status,
  count(*)::numeric as order_count,
  coalesce(sum(coalesce(l.invoice_total, 0)), 0)::numeric as total_value,
  min(l.lifecycle_updated_at) as oldest_at,
  max(l.lifecycle_updated_at) as newest_at
from public.v_ecoflow_order_lifecycle_active l
group by
  coalesce(nullif(l.lifecycle_status, ''), 'UNKNOWN'),
  coalesce(nullif(l.internalisation_status, ''), 'UNKNOWN'),
  coalesce(nullif(l.warehouse_gate_status, ''), 'UNKNOWN')
order by order_count desc;

grant select on public.v_ecoflow_owner_order_status_report to authenticated;
revoke all on public.v_ecoflow_owner_order_status_report from anon;

notify pgrst, 'reload schema';
commit;
