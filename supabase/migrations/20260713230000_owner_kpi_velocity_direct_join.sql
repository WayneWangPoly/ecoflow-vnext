-- With om_order_items fully projected, every order line carries the om order
-- uuid in source_order_id, so the per-line lateral OR-match against every
-- eligible order (added while the projection gap forced number-based
-- matching) is no longer needed. That lateral made v_ecoflow_owner_order_kpis
-- and v_ecoflow_owner_sku_velocity exceed the 8s statement timeout once the
-- line data arrived. Replace it with a direct equality join, keeping the
-- exact same output contract.

begin;

create or replace view public.v_ecoflow_owner_order_kpis
with (security_invoker = true)
as
with orders as (
  select
    coalesce(i.external_order_id::text, i.raw_order_id::text) as order_key,
    i.order_number::text as order_number,
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
    o.order_ts
  from public.v_ecoflow_ordermentum_order_lines l
  join eligible_orders o
    on o.order_key = l.source_order_id::text
  union all
  select
    coalesce(nullif(l.external_sku_code, ''), 'UNKNOWN') as sku,
    coalesce(nullif(l.external_product_name, ''), 'Unknown product') as product_name,
    coalesce(l.quantity, 0)::numeric as qty,
    coalesce(l.total, l.subtotal, coalesce(l.price, l.rate_price, 0) * coalesce(l.quantity, 0), 0)::numeric as line_value,
    o.order_ts
  from public.v_ecoflow_ordermentum_order_lines l
  join eligible_orders o
    on o.order_number = l.order_number::text
  where l.source_order_id is null
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
    coalesce(i.external_order_id::text, i.raw_order_id::text) as order_key,
    i.order_number::text as order_number,
    coalesce(i.order_created_at, i.first_seen_at, i.raw_created_at, i.order_updated_at, i.last_seen_at) as order_ts
  from public.v_ecoflow_ordermentum_inbox i
  where lower(coalesce(i.order_status, '')) not in ('cancelled','canceled','void','voided')
), matched_lines as (
  select l.external_sku_code, l.external_product_name, l.quantity, l.total, l.subtotal,
         l.price, l.rate_price, o.order_ts, o.order_key
  from public.v_ecoflow_ordermentum_order_lines l
  join orders o
    on o.order_key = l.source_order_id::text
  union all
  select l.external_sku_code, l.external_product_name, l.quantity, l.total, l.subtotal,
         l.price, l.rate_price, o.order_ts, o.order_key
  from public.v_ecoflow_ordermentum_order_lines l
  join orders o
    on o.order_number = l.order_number::text
  where l.source_order_id is null
), line_fact as (
  select
    coalesce(nullif(m.external_sku_code, ''), 'UNKNOWN') as sku,
    coalesce(nullif(m.external_product_name, ''), 'Unknown product') as product_name,
    coalesce(m.quantity, 0)::numeric as qty,
    coalesce(m.total, m.subtotal, coalesce(m.price, m.rate_price, 0) * coalesce(m.quantity, 0), 0)::numeric as line_value,
    coalesce(m.price, m.rate_price, 0)::numeric as unit_price,
    m.order_ts,
    m.order_key,
    coalesce(nullif(sm.carton_barcode_status, ''), nullif(sm.each_barcode_status, ''), 'UNKNOWN') as barcode_status,
    coalesce(nullif(sm.carton_barcode, ''), nullif(sm.each_barcode, '')) as warehouse_barcode
  from matched_lines m
  left join public.v_ecoflow_app_sku_master sm
    on upper(sm.external_sku_code::text) = upper(m.external_sku_code::text)
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

notify pgrst, 'reload schema';
commit;
