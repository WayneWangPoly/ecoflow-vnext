-- Owner-facing store intelligence.
-- Ordermentum remains the order source, but EcoFlow gives the owner a better store view:
-- contribution, address readiness, price tier, delivery readiness, SKU mix and last-order signal.
-- Retailer IDs can be uuid or text depending on the imported source, so this view normalises
-- all retailer/store identifiers to text before grouping or fallback to UNKNOWN.

drop view if exists public.v_ecoflow_owner_store_sku_mix;
drop view if exists public.v_ecoflow_owner_store_performance;
drop view if exists public.v_ecoflow_owner_store_kpis;

create view public.v_ecoflow_owner_store_performance as
with order_fact as (
  select
    o.id as internal_order_id,
    o.order_number,
    o.invoice_number,
    o.external_order_id,
    coalesce(o.imported_at, o.last_synced_at, o.created_at, o.updated_at) as order_ts,
    coalesce(o.invoice_total, o.total_due, 0)::numeric as order_value,
    lower(coalesce(o.status, '')) as status_lc,
    nullif(om.retailer_id::text, '') as retailer_id,
    coalesce(nullif(om.retailer_name, ''), 'Unknown store') as om_store_name,
    om.delivery_date,
    om.due_at
  from public.ecoflow_ordermentum_internal_orders o
  left join public.om_orders om
    on om.id::text = o.external_order_id::text
    or om.order_number::text = o.order_number::text
), line_fact as (
  select
    f.retailer_id,
    f.om_store_name,
    f.internal_order_id,
    coalesce(nullif(l.external_sku_code, ''), 'UNKNOWN') as sku,
    coalesce(nullif(l.external_product_name, ''), 'Unknown product') as product_name,
    coalesce(l.quantity, 0)::numeric as qty,
    coalesce(l.total, l.subtotal, 0)::numeric as line_value,
    f.order_ts,
    f.status_lc
  from order_fact f
  left join public.ecoflow_ordermentum_internal_order_lines l on l.internal_order_id = f.internal_order_id
), order_store_rollup as (
  select
    coalesce(retailer_id, 'UNKNOWN') as store_id,
    count(distinct internal_order_id)::numeric as lifetime_orders,
    count(distinct internal_order_id) filter (where order_ts >= now() - interval '7 days')::numeric as orders_7d,
    count(distinct internal_order_id) filter (where order_ts >= now() - interval '30 days')::numeric as orders_30d,
    coalesce(sum(order_value) filter (where order_ts >= now() - interval '7 days'), 0)::numeric as revenue_7d,
    coalesce(sum(order_value) filter (where order_ts >= now() - interval '30 days'), 0)::numeric as revenue_30d,
    max(order_ts) as last_order_at,
    min(order_ts) as first_order_at,
    count(distinct internal_order_id) filter (where status_lc in ('legacy_cancelled','legacy_rebuild_superseded','cancelled','canceled'))::numeric as legacy_or_cancelled_orders,
    max(om_store_name) as om_store_name
  from order_fact
  group by coalesce(retailer_id, 'UNKNOWN')
), line_store_rollup as (
  select
    coalesce(retailer_id, 'UNKNOWN') as store_id,
    coalesce(sum(qty) filter (where order_ts >= now() - interval '30 days'), 0)::numeric as units_30d,
    count(distinct sku) filter (where order_ts >= now() - interval '30 days')::numeric as sku_count_30d
  from line_fact
  group by coalesce(retailer_id, 'UNKNOWN')
), site_rollup as (
  select
    coalesce(nullif(s.retailer_id::text, ''), 'UNKNOWN') as store_id,
    max(nullif(s.store_name, '')) as store_name,
    max(coalesce(nullif(s.formatted_address, ''), concat_ws(', ', nullif(s.street1, ''), nullif(s.street2, ''), nullif(s.suburb, ''), nullif(s.state, ''), nullif(s.postcode, '')))) as address,
    max(s.suburb) as suburb,
    max(s.state) as state,
    max(s.postcode) as postcode,
    max(s.contact_phone) as contact_phone,
    max(s.delivery_instructions) as delivery_instructions,
    max(s.price_group_id::text) as price_group_id,
    bool_or(coalesce(s.verified, false)) as verified
  from public.ecoflow_store_sites s
  group by coalesce(nullif(s.retailer_id::text, ''), 'UNKNOWN')
), store_keys as (
  select store_id from site_rollup
  union
  select store_id from order_store_rollup
), top_sku as (
  select distinct on (coalesce(retailer_id, 'UNKNOWN'))
    coalesce(retailer_id, 'UNKNOWN') as store_id,
    sku as top_sku_30d,
    max(product_name) as top_product_30d,
    sum(qty) as top_sku_units_30d,
    sum(line_value) as top_sku_revenue_30d
  from line_fact
  where order_ts >= now() - interval '30 days'
    and status_lc not in ('legacy_cancelled','legacy_rebuild_superseded','cancelled','canceled')
  group by coalesce(retailer_id, 'UNKNOWN'), sku
  order by coalesce(retailer_id, 'UNKNOWN'), sum(qty) desc, sum(line_value) desc
)
select
  k.store_id,
  coalesce(s.store_name, o.om_store_name, 'Unknown store') as store_name,
  s.address,
  s.suburb,
  s.state,
  s.postcode,
  s.contact_phone,
  s.delivery_instructions,
  s.price_group_id,
  coalesce(s.verified, false) as verified,
  coalesce(o.lifetime_orders, 0)::numeric as lifetime_orders,
  coalesce(o.orders_7d, 0)::numeric as orders_7d,
  coalesce(o.orders_30d, 0)::numeric as orders_30d,
  coalesce(o.revenue_7d, 0)::numeric as revenue_7d,
  coalesce(o.revenue_30d, 0)::numeric as revenue_30d,
  coalesce(l.units_30d, 0)::numeric as units_30d,
  coalesce(l.sku_count_30d, 0)::numeric as sku_count_30d,
  o.last_order_at,
  o.first_order_at,
  coalesce(o.legacy_or_cancelled_orders, 0)::numeric as legacy_or_cancelled_orders,
  coalesce(t.top_sku_30d, '—') as top_sku_30d,
  coalesce(t.top_product_30d, 'No product movement yet') as top_product_30d,
  coalesce(t.top_sku_units_30d, 0)::numeric as top_sku_units_30d,
  coalesce(t.top_sku_revenue_30d, 0)::numeric as top_sku_revenue_30d,
  case
    when k.store_id = 'UNKNOWN' then 'MISSING_STORE_MAPPING'
    when nullif(trim(coalesce(s.address, '')), '') is null then 'NEEDS_ADDRESS'
    when nullif(trim(coalesce(s.price_group_id, '')), '') is null then 'NEEDS_PRICE_TIER'
    when coalesce(s.verified, false) is false then 'NEEDS_VERIFICATION'
    when coalesce(o.orders_30d, 0) > 0 then 'ACTIVE'
    else 'QUIET'
  end as store_signal,
  dense_rank() over (order by coalesce(o.revenue_30d, 0) desc nulls last, coalesce(o.orders_30d, 0) desc nulls last) as revenue_rank_30d
from store_keys k
left join site_rollup s on s.store_id = k.store_id
left join order_store_rollup o on o.store_id = k.store_id
left join line_store_rollup l on l.store_id = k.store_id
left join top_sku t on t.store_id = k.store_id
order by revenue_rank_30d asc;

grant select on public.v_ecoflow_owner_store_performance to authenticated;

create view public.v_ecoflow_owner_store_kpis as
select
  count(*)::numeric as total_stores,
  count(*) filter (where orders_30d > 0)::numeric as active_stores_30d,
  count(*) filter (where store_signal in ('NEEDS_ADDRESS','MISSING_STORE_MAPPING'))::numeric as address_attention_stores,
  count(*) filter (where store_signal = 'NEEDS_PRICE_TIER')::numeric as price_tier_attention_stores,
  coalesce(sum(revenue_30d), 0)::numeric as revenue_30d,
  coalesce(sum(units_30d), 0)::numeric as units_30d,
  coalesce(avg(nullif(revenue_30d, 0)), 0)::numeric as avg_active_store_revenue_30d,
  (array_agg(store_name order by revenue_30d desc nulls last))[1] as top_store_30d,
  (array_agg(revenue_30d order by revenue_30d desc nulls last))[1] as top_store_revenue_30d,
  max(last_order_at) as latest_store_order_at
from public.v_ecoflow_owner_store_performance;

grant select on public.v_ecoflow_owner_store_kpis to authenticated;

create view public.v_ecoflow_owner_store_sku_mix as
with order_fact as (
  select
    o.id as internal_order_id,
    coalesce(o.imported_at, o.last_synced_at, o.created_at, o.updated_at) as order_ts,
    lower(coalesce(o.status, '')) as status_lc,
    nullif(om.retailer_id::text, '') as retailer_id,
    coalesce(nullif(s.store_name, ''), nullif(om.retailer_name, ''), 'Unknown store') as store_name
  from public.ecoflow_ordermentum_internal_orders o
  left join public.om_orders om on om.id::text = o.external_order_id::text or om.order_number::text = o.order_number::text
  left join public.ecoflow_store_sites s on s.retailer_id::text = om.retailer_id::text
)
select
  coalesce(f.retailer_id, 'UNKNOWN') as store_id,
  max(f.store_name) as store_name,
  coalesce(nullif(l.external_sku_code, ''), 'UNKNOWN') as sku,
  max(coalesce(nullif(l.external_product_name, ''), 'Unknown product')) as product_name,
  count(distinct f.internal_order_id)::numeric as order_count_30d,
  coalesce(sum(coalesce(l.quantity, 0)), 0)::numeric as units_30d,
  coalesce(sum(coalesce(l.total, l.subtotal, 0)), 0)::numeric as revenue_30d,
  max(f.order_ts) as last_sold_at
from order_fact f
join public.ecoflow_ordermentum_internal_order_lines l on l.internal_order_id = f.internal_order_id
where f.order_ts >= now() - interval '30 days'
  and f.status_lc not in ('legacy_cancelled','legacy_rebuild_superseded','cancelled','canceled')
group by coalesce(f.retailer_id, 'UNKNOWN'), coalesce(nullif(l.external_sku_code, ''), 'UNKNOWN')
order by store_name asc, units_30d desc;

grant select on public.v_ecoflow_owner_store_sku_mix to authenticated;

notify pgrst, 'reload schema';
