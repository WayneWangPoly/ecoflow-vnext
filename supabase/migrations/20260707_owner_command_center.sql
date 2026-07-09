-- Owner command centre.
-- This is the executive dashboard layer that combines Orders, Stores and Accounts
-- into one compact owner home screen.

-- Dependent dashboard views are safe to recreate.
drop view if exists public.v_ecoflow_owner_command_attention cascade;
drop view if exists public.v_ecoflow_owner_command_kpis cascade;

create view public.v_ecoflow_owner_command_kpis as
select
  coalesce((select revenue_30d from public.v_ecoflow_owner_order_kpis), 0)::numeric as order_revenue_30d,
  coalesce((select orders_30d from public.v_ecoflow_owner_order_kpis), 0)::numeric as orders_30d,
  coalesce((select units_30d from public.v_ecoflow_owner_order_kpis), 0)::numeric as units_30d,
  coalesce((select active_internal_orders from public.v_ecoflow_owner_order_kpis), 0)::numeric as active_internal_orders,
  coalesce((select lifecycle_active_orders from public.v_ecoflow_owner_order_kpis), 0)::numeric as lifecycle_active_orders,
  coalesce((select legacy_review_orders from public.v_ecoflow_owner_order_kpis), 0)::numeric as legacy_review_orders,
  (select top_sku_30d from public.v_ecoflow_owner_order_kpis) as top_sku_30d,
  (select top_product_30d from public.v_ecoflow_owner_order_kpis) as top_product_30d,
  coalesce((select top_sku_units_30d from public.v_ecoflow_owner_order_kpis), 0)::numeric as top_sku_units_30d,
  coalesce((select active_stores_30d from public.v_ecoflow_owner_store_kpis), 0)::numeric as active_stores_30d,
  coalesce((select total_stores from public.v_ecoflow_owner_store_kpis), 0)::numeric as total_stores,
  coalesce((select address_attention_stores from public.v_ecoflow_owner_store_kpis), 0)::numeric as address_attention_stores,
  coalesce((select price_tier_attention_stores from public.v_ecoflow_owner_store_kpis), 0)::numeric as price_tier_attention_stores,
  (select top_store_30d from public.v_ecoflow_owner_store_kpis) as top_store_30d,
  coalesce((select top_store_revenue_30d from public.v_ecoflow_owner_store_kpis), 0)::numeric as top_store_revenue_30d,
  coalesce((select open_ar_value from public.v_ecoflow_accounts_ar_kpis), 0)::numeric as open_ar_value,
  coalesce((select overdue_ar_value from public.v_ecoflow_accounts_ar_kpis), 0)::numeric as overdue_ar_value,
  coalesce((select urgent_customers from public.v_ecoflow_accounts_ar_kpis), 0)::numeric as urgent_customers,
  coalesce((select held_customers from public.v_ecoflow_accounts_ar_kpis), 0)::numeric as held_customers,
  coalesce((select worst_overdue_days from public.v_ecoflow_accounts_ar_kpis), 0)::numeric as worst_overdue_days,
  coalesce((select count(*) from public.v_ecoflow_owner_store_reorder_watch where reorder_signal in ('HIGH_REORDER_PRESSURE','WATCH_REORDER')), 0)::numeric as reorder_pressure_rows,
  coalesce((select sum(barcode_attention_lines) from public.v_ecoflow_owner_sku_velocity), 0)::numeric as barcode_attention_lines,
  greatest(
    coalesce((select latest_order_at from public.v_ecoflow_owner_order_kpis), '1970-01-01'::timestamptz),
    coalesce((select latest_store_order_at from public.v_ecoflow_owner_store_kpis), '1970-01-01'::timestamptz),
    coalesce((select latest_invoice_at from public.v_ecoflow_accounts_ar_kpis), '1970-01-01'::timestamptz)
  ) as latest_activity_at;

grant select on public.v_ecoflow_owner_command_kpis to authenticated;

create view public.v_ecoflow_owner_command_attention as
select
  10::integer as priority,
  'Accounts'::text as area,
  q.accounts_priority::text as signal,
  q.store_name::text as title,
  concat(q.next_action, ' · overdue ', q.overdue_invoice_count, ' invoice(s) · worst ', coalesce(q.worst_overdue_days, 0), ' days')::text as detail,
  coalesce(q.overdue_statement_value, q.open_statement_value, 0)::numeric as value_numeric,
  q.store_id::text as reference_id,
  'Open Accounts'::text as action_hint
from public.v_ecoflow_accounts_followup_queue q
where q.accounts_priority in ('ON_HOLD','URGENT_COLLECTION','COLLECTION','SEND_STATEMENT')

union all

select
  20::integer as priority,
  'Stores'::text as area,
  g.owner_action::text as signal,
  g.store_name::text as title,
  concat(coalesce(g.suburb, 'Suburb pending'), ' · ', coalesce(g.store_signal, 'UNKNOWN'), ' · open ', coalesce(g.open_statement_value, 0))::text as detail,
  coalesce(g.revenue_30d, 0)::numeric as value_numeric,
  g.store_id::text as reference_id,
  'Open Stores'::text as action_hint
from public.v_ecoflow_owner_store_experience_gaps g
where g.owner_action <> 'READY'

union all

select
  30::integer as priority,
  'Reorder'::text as area,
  r.reorder_signal::text as signal,
  concat(r.store_name, ' · ', r.sku)::text as title,
  concat(r.product_name, ' · ', r.units_30d, ' units in 30d · ', coalesce(r.action_hint, 'READY'))::text as detail,
  coalesce(r.revenue_30d, 0)::numeric as value_numeric,
  concat(r.store_id, ':', r.sku)::text as reference_id,
  'Review Reorder'::text as action_hint
from public.v_ecoflow_owner_store_reorder_watch r
where r.reorder_signal in ('HIGH_REORDER_PRESSURE','WATCH_REORDER')

union all

select
  40::integer as priority,
  'SKU'::text as area,
  'BARCODE_ATTENTION'::text as signal,
  concat(s.sku, ' · ', s.product_name)::text as title,
  concat(s.barcode_attention_lines, ' line(s) need barcode cleanup · ', s.units_30d, ' units in 30d')::text as detail,
  coalesce(s.revenue_30d, 0)::numeric as value_numeric,
  s.sku::text as reference_id,
  'Open Orders'::text as action_hint
from public.v_ecoflow_owner_sku_velocity s
where coalesce(s.barcode_attention_lines, 0) > 0

union all

select
  50::integer as priority,
  'Orders'::text as area,
  'LEGACY_REVIEW'::text as signal,
  'Legacy internal orders need review'::text as title,
  concat(legacy_review_orders, ' legacy order(s) waiting for archive, cancel or rebuild')::text as detail,
  legacy_review_orders::numeric as value_numeric,
  'legacy-review'::text as reference_id,
  'Open Orders'::text as action_hint
from public.v_ecoflow_owner_order_kpis
where coalesce(legacy_review_orders, 0) > 0

order by priority asc, value_numeric desc nulls last;

grant select on public.v_ecoflow_owner_command_attention to authenticated;

notify pgrst, 'reload schema';
