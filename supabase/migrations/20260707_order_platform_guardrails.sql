-- Guardrail views for the two order surfaces: Ordermentum Inbox and Orders Workflow.
-- These are read-only monitors so new orders, active lifecycle rows, completed history,
-- and legacy internal drafts can be checked without opening heavy UI tables.

drop view if exists public.v_ecoflow_order_platform_guardrails;
drop view if exists public.v_ecoflow_order_platform_latest_orders;

create view public.v_ecoflow_order_platform_guardrails as
select
  'ordermentum_raw_inbox'::text as check_name,
  count(*)::numeric as row_count,
  min(order_updated_at) as oldest_at,
  max(order_updated_at) as newest_at,
  null::numeric as total_value,
  'Raw retained Ordermentum inbox. Should grow historically, but should not drive active workflow directly.'::text as note
from public.v_ecoflow_ordermentum_inbox

union all

select
  'orders_active_workflow'::text as check_name,
  count(*)::numeric as row_count,
  min(lifecycle_updated_at) as oldest_at,
  max(lifecycle_updated_at) as newest_at,
  coalesce(sum(invoice_total), 0)::numeric as total_value,
  'Orders currently allowed into active owner/accounts workflow. Excludes completed history and legacy internal-draft review rows.'::text as note
from public.v_ecoflow_order_lifecycle_active

union all

select
  'legacy_internal_review'::text as check_name,
  count(*)::numeric as row_count,
  min(lifecycle_updated_at) as oldest_at,
  max(lifecycle_updated_at) as newest_at,
  coalesce(sum(invoice_total), 0)::numeric as total_value,
  'Internal drafts created in earlier test/research flows. Must not enter pick, route, or driver screens until reviewed.'::text as note
from public.v_ecoflow_order_lifecycle_legacy_internal_review

union all

select
  'completed_archive'::text as check_name,
  count(*)::numeric as row_count,
  min(lifecycle_updated_at) as oldest_at,
  max(lifecycle_updated_at) as newest_at,
  coalesce(sum(invoice_total), 0)::numeric as total_value,
  'Completed or historical imports kept out of active operations.'::text as note
from public.v_ecoflow_order_lifecycle_board
where lifecycle_status = 'COMPLETED';

grant select on public.v_ecoflow_order_platform_guardrails to authenticated;

create view public.v_ecoflow_order_platform_latest_orders as
select
  lifecycle_id,
  order_number,
  invoice_number,
  ordermentum_order_status,
  ordermentum_invoice_status,
  internalisation_status,
  warehouse_gate_status,
  internal_order_id,
  lifecycle_status,
  can_internalise,
  invoice_total,
  lifecycle_updated_at,
  case
    when lifecycle_status = 'COMPLETED' then 'ARCHIVE'
    when lifecycle_id in (select lifecycle_id from public.v_ecoflow_order_lifecycle_legacy_internal_review) then 'LEGACY_REVIEW'
    else 'ACTIVE'
  end as platform_bucket
from public.v_ecoflow_order_lifecycle_board
order by lifecycle_updated_at desc
limit 120;

grant select on public.v_ecoflow_order_platform_latest_orders to authenticated;
