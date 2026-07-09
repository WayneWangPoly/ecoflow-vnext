-- Store statement and reorder pressure views.
-- These are owner-facing operating reports: statement exposure, overdue/open invoices,
-- store reorder watch, and data gaps that make EcoFlow more useful than Ordermentum alone.

drop view if exists public.v_ecoflow_owner_store_experience_gaps;
drop view if exists public.v_ecoflow_owner_store_reorder_watch;
drop view if exists public.v_ecoflow_owner_store_statement_summary;
drop view if exists public.v_ecoflow_owner_store_statement;

create view public.v_ecoflow_owner_store_statement as
with order_fact as (
  select
    o.id as internal_order_id,
    coalesce(nullif(om.retailer_id::text, ''), 'UNKNOWN') as store_id,
    coalesce(nullif(s.store_name, ''), nullif(om.retailer_name, ''), 'Unknown store') as store_name,
    o.order_number,
    o.invoice_number,
    coalesce(o.imported_at, o.last_synced_at, o.created_at, o.updated_at) as order_ts,
    coalesce(om.due_at, coalesce(o.imported_at, o.last_synced_at, o.created_at, o.updated_at) + interval '14 days') as due_at,
    coalesce(o.invoice_total, o.total_due, 0)::numeric as invoice_value,
    lower(coalesce(o.status, '')) as status_lc,
    coalesce(nullif(o.status, ''), 'UNKNOWN') as order_status,
    coalesce(nullif(o.account_release_status, ''), 'UNKNOWN') as account_release_status,
    coalesce(nullif(o.warehouse_gate_status, ''), 'UNKNOWN') as warehouse_gate_status
  from public.ecoflow_ordermentum_internal_orders o
  left join public.om_orders om on om.id::text = o.external_order_id::text or om.order_number::text = o.order_number::text
  left join public.ecoflow_store_sites s on s.retailer_id::text = om.retailer_id::text
)
select
  *,
  greatest(0, floor(extract(epoch from (now() - order_ts)) / 86400))::numeric as age_days,
  greatest(0, floor(extract(epoch from (now() - due_at)) / 86400))::numeric as overdue_days,
  case
    when status_lc in ('legacy_cancelled','legacy_rebuild_superseded','cancelled','canceled') then 'VOID_OR_CANCELLED'
    when status_lc in ('completed','closed','delivered','paid') then 'CLOSED'
    when due_at < now() then 'OVERDUE'
    else 'OPEN'
  end as statement_status
from order_fact
order by order_ts desc;

grant select on public.v_ecoflow_owner_store_statement to authenticated;

create view public.v_ecoflow_owner_store_statement_summary as
select
  store_id,
  max(store_name) as store_name,
  count(*)::numeric as invoice_count,
  count(*) filter (where statement_status in ('OPEN','OVERDUE'))::numeric as open_invoice_count,
  count(*) filter (where statement_status = 'OVERDUE')::numeric as overdue_invoice_count,
  coalesce(sum(invoice_value), 0)::numeric as total_statement_value,
  coalesce(sum(invoice_value) filter (where statement_status in ('OPEN','OVERDUE')), 0)::numeric as open_statement_value,
  coalesce(sum(invoice_value) filter (where statement_status = 'OVERDUE'), 0)::numeric as overdue_statement_value,
  coalesce(sum(invoice_value) filter (where order_ts >= now() - interval '30 days'), 0)::numeric as statement_value_30d,
  max(order_ts) as latest_invoice_at,
  max(overdue_days) filter (where statement_status = 'OVERDUE')::numeric as worst_overdue_days,
  case
    when count(*) filter (where statement_status = 'OVERDUE') > 0 then 'OVERDUE_ATTENTION'
    when count(*) filter (where statement_status = 'OPEN') > 0 then 'OPEN_BALANCE'
    when count(*) = 0 then 'NO_STATEMENT'
    else 'CLEAR'
  end as statement_signal
from public.v_ecoflow_owner_store_statement
where statement_status <> 'VOID_OR_CANCELLED'
group by store_id
order by open_statement_value desc, overdue_statement_value desc;

grant select on public.v_ecoflow_owner_store_statement_summary to authenticated;

create view public.v_ecoflow_owner_store_reorder_watch as
with sku_mix as (
  select *
  from public.v_ecoflow_owner_store_sku_mix
), ranked as (
  select
    m.*,
    p.price_group_id,
    p.delivery_instructions,
    p.store_signal,
    p.revenue_30d as store_revenue_30d,
    dense_rank() over (partition by m.store_id order by m.units_30d desc, m.revenue_30d desc) as store_sku_rank,
    dense_rank() over (order by m.units_30d desc, m.revenue_30d desc) as global_velocity_rank
  from sku_mix m
  left join public.v_ecoflow_owner_store_performance p on p.store_id = m.store_id
)
select
  *,
  case
    when units_30d >= 24 and last_sold_at >= now() - interval '10 days' then 'HIGH_REORDER_PRESSURE'
    when units_30d >= 12 and last_sold_at >= now() - interval '21 days' then 'WATCH_REORDER'
    when last_sold_at < now() - interval '30 days' then 'SLOWING'
    else 'NORMAL'
  end as reorder_signal,
  case
    when delivery_instructions is null or trim(delivery_instructions) = '' then 'NEEDS_DELIVERY_NOTE'
    when price_group_id is null or trim(price_group_id) = '' then 'NEEDS_PRICE_TIER'
    else 'READY'
  end as action_hint
from ranked
where store_sku_rank <= 6
order by
  case
    when units_30d >= 24 and last_sold_at >= now() - interval '10 days' then 0
    when units_30d >= 12 and last_sold_at >= now() - interval '21 days' then 1
    else 2
  end,
  global_velocity_rank asc;

grant select on public.v_ecoflow_owner_store_reorder_watch to authenticated;

create view public.v_ecoflow_owner_store_experience_gaps as
select
  p.store_id,
  p.store_name,
  p.address,
  p.suburb,
  p.price_group_id,
  p.delivery_instructions,
  p.orders_30d,
  p.revenue_30d,
  p.store_signal,
  coalesce(s.statement_signal, 'NO_STATEMENT') as statement_signal,
  coalesce(s.open_statement_value, 0)::numeric as open_statement_value,
  coalesce(s.overdue_statement_value, 0)::numeric as overdue_statement_value,
  case
    when p.store_signal in ('NEEDS_ADDRESS','MISSING_STORE_MAPPING') then 'FIX_ADDRESS_OR_MAPPING'
    when p.store_signal = 'NEEDS_PRICE_TIER' then 'SET_PRICE_TIER'
    when p.delivery_instructions is null or trim(p.delivery_instructions) = '' then 'ADD_DELIVERY_INSTRUCTIONS'
    when coalesce(s.statement_signal, '') = 'OVERDUE_ATTENTION' then 'REVIEW_STATEMENT'
    when p.store_signal = 'NEEDS_VERIFICATION' then 'VERIFY_STORE'
    else 'READY'
  end as owner_action
from public.v_ecoflow_owner_store_performance p
left join public.v_ecoflow_owner_store_statement_summary s on s.store_id = p.store_id
where p.store_signal not in ('ACTIVE','QUIET')
   or p.delivery_instructions is null
   or trim(coalesce(p.delivery_instructions, '')) = ''
   or coalesce(s.statement_signal, '') = 'OVERDUE_ATTENTION'
order by p.revenue_30d desc nulls last, p.orders_30d desc nulls last;

grant select on public.v_ecoflow_owner_store_experience_gaps to authenticated;

notify pgrst, 'reload schema';
