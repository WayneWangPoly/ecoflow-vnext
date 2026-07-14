-- Order operations v2
--
-- Keep the complete Ordermentum mirror for audit, reporting and history, but
-- expose a small, explicit operational slice to the office, warehouse and
-- driver applications. Unknown source states are review-only: they are never
-- treated as releasable by default.

begin;

create or replace view public.v_ecoflow_order_operations_v2 as
with inbox_ranked as (
  select
    coalesce(
      nullif(order_number::text, ''),
      nullif(external_order_number::text, ''),
      nullif(external_order_id::text, ''),
      raw_order_id::text
    ) as operation_key,
    raw_order_id::text as raw_order_id,
    external_order_id::text as external_order_id,
    external_order_number::text as external_order_number,
    external_invoice_number::text as external_invoice_number,
    order_number::text as order_number,
    invoice_number::text as invoice_number,
    order_status::text as order_status,
    invoice_status::text as invoice_status,
    payment_status::text as payment_status,
    invoice_payment_status::text as invoice_payment_status,
    invoice_total::numeric as invoice_total,
    total_due::numeric as total_due,
    line_count::numeric as line_count,
    coalesce(invoice_detail_missing, false) as invoice_detail_missing,
    coalesce(line_items_missing, false) as line_items_missing,
    order_created_at::timestamptz as order_created_at,
    order_updated_at::timestamptz as order_updated_at,
    invoice_due_at::timestamptz as invoice_due_at,
    invoice_date::timestamptz as invoice_date,
    last_synced_at::timestamptz as last_synced_at,
    row_number() over (
      partition by coalesce(
        nullif(order_number::text, ''),
        nullif(external_order_number::text, ''),
        nullif(external_order_id::text, ''),
        raw_order_id::text
      )
      order by order_updated_at desc nulls last, last_synced_at desc nulls last
    ) as row_rank
  from public.v_ecoflow_ordermentum_inbox
), inbox as (
  select *
  from inbox_ranked
  where row_rank = 1
), draft_ranked as (
  select
    coalesce(
      nullif(order_number::text, ''),
      nullif(external_order_number::text, ''),
      nullif(external_order_id::text, ''),
      raw_order_id::text
    ) as operation_key,
    internal_order_id::text as internal_order_id,
    internalisation_status::text as internalisation_status,
    account_release_status::text as account_release_status,
    warehouse_gate_status::text as warehouse_gate_status,
    coalesce(unmapped_line_count, 0)::numeric as unmapped_line_count,
    coalesce(barcode_blocked_line_count, 0)::numeric as barcode_blocked_line_count,
    last_synced_at::timestamptz as internal_updated_at,
    row_number() over (
      partition by coalesce(
        nullif(order_number::text, ''),
        nullif(external_order_number::text, ''),
        nullif(external_order_id::text, ''),
        raw_order_id::text
      )
      order by last_synced_at desc nulls last
    ) as row_rank
  from public.v_ecoflow_ordermentum_internal_order_drafts_v3
), drafts as (
  select *
  from draft_ranked
  where row_rank = 1
), normalised as (
  select
    i.*,
    d.internal_order_id,
    d.internalisation_status,
    d.account_release_status,
    d.warehouse_gate_status,
    coalesce(d.unmapped_line_count, 0) as unmapped_line_count,
    coalesce(d.barcode_blocked_line_count, 0) as barcode_blocked_line_count,
    d.internal_updated_at,
    lower(trim(coalesce(i.order_status, ''))) as order_status_key,
    lower(trim(coalesce(i.invoice_status, ''))) as invoice_status_key,
    lower(trim(coalesce(d.internalisation_status, ''))) as internalisation_status_key,
    lower(trim(coalesce(d.warehouse_gate_status, ''))) as warehouse_gate_status_key,
    lower(trim(coalesce(d.account_release_status, ''))) as account_release_status_key,
    coalesce(i.invoice_due_at, i.invoice_date, i.order_updated_at, i.order_created_at) as source_business_at
  from inbox i
  left join drafts d using (operation_key)
), classified as (
  select
    n.*,
    (
      order_status_key in ('cancelled', 'canceled', 'void', 'voided')
      or invoice_status_key in ('cancelled', 'canceled', 'void', 'voided')
    ) as source_cancelled,
    (
      order_status_key in ('completed', 'complete', 'closed', 'delivered', 'fulfilled', 'finalised', 'finalized')
      or invoice_status_key in ('completed', 'complete', 'closed', 'delivered', 'fulfilled', 'finalised', 'finalized')
      or internalisation_status_key in ('completed', 'complete', 'closed', 'delivered', 'fulfilled', 'finalised', 'finalized')
      or warehouse_gate_status_key in ('completed', 'complete', 'closed', 'delivered', 'fulfilled', 'finalised', 'finalized')
    ) as source_completed,
    (
      order_status_key in (
        'new', 'pending', 'processing', 'confirmed', 'accepted', 'approved',
        'open', 'ready', 'paid', 'unpaid', 'in_progress', 'partially_fulfilled'
      )
    ) as source_explicitly_current,
    (
      coalesce(n.invoice_detail_missing, false)
      or coalesce(n.line_items_missing, false)
    ) as data_detail_blocked,
    (
      coalesce(n.unmapped_line_count, 0) > 0
      or coalesce(n.barcode_blocked_line_count, 0) > 0
    ) as data_mapping_blocked
  from normalised n
), operations as (
  select
    c.*,
    case
      when source_cancelled then 'CANCELLED'
      when source_completed then 'COMPLETED'
      when warehouse_gate_status_key in ('out_for_delivery', 'driver_assigned', 'on_route', 'en_route') then 'OUT_FOR_DELIVERY'
      when warehouse_gate_status_key in ('staged', 'packed', 'ready_for_delivery') then 'STAGED'
      when warehouse_gate_status_key in ('picking', 'pick_started') then 'PICKING'
      when nullif(internal_order_id, '') is not null then 'RELEASED'
      when data_detail_blocked or data_mapping_blocked then 'BLOCKED'
      when source_explicitly_current then 'UNRELEASED'
      when source_business_at >= now() - interval '45 days' then 'SOURCE_REVIEW'
      else 'HISTORY'
    end as fulfilment_status,
    case
      when data_detail_blocked then 'BLOCKED_DATA'
      when data_mapping_blocked then 'BLOCKED_MAPPING'
      else 'READY'
    end as data_quality_status,
    case
      when source_cancelled or source_completed then 'HISTORY'
      when nullif(internal_order_id, '') is not null then 'CURRENT'
      when source_explicitly_current then 'CURRENT'
      when source_business_at >= now() - interval '45 days' then 'REVIEW'
      else 'HISTORY'
    end as operational_scope
  from classified c
)
select
  operation_key,
  raw_order_id,
  external_order_id,
  external_order_number,
  external_invoice_number,
  coalesce(order_number, external_order_number, operation_key) as order_number,
  coalesce(invoice_number, external_invoice_number) as invoice_number,
  order_status as source_order_status,
  invoice_status as source_invoice_status,
  payment_status as source_payment_status,
  invoice_payment_status,
  internal_order_id,
  internalisation_status,
  account_release_status,
  warehouse_gate_status,
  fulfilment_status,
  data_quality_status,
  operational_scope,
  (
    operational_scope = 'CURRENT'
    and fulfilment_status = 'UNRELEASED'
    and data_quality_status = 'READY'
    and source_explicitly_current
    and nullif(internal_order_id, '') is null
    and account_release_status_key not in ('hold_payment_review', 'credit_hold', 'held')
  ) as release_eligible,
  case
    when source_cancelled then 'Cancelled in source system'
    when source_completed then 'Completed in source or fulfilment system'
    when fulfilment_status = 'SOURCE_REVIEW' then 'Recent source status is not recognised; review before release'
    when data_detail_blocked then 'Ordermentum invoice or line detail is incomplete'
    when data_mapping_blocked then 'SKU or barcode mapping is incomplete'
    when nullif(internal_order_id, '') is not null then 'Internal order already exists'
    when source_explicitly_current then 'Current Ordermentum order'
    else 'Historical Ordermentum record'
  end as classification_reason,
  coalesce(invoice_total, total_due, 0)::numeric as order_value,
  coalesce(line_count, 0)::numeric as line_count,
  unmapped_line_count,
  barcode_blocked_line_count,
  order_created_at as source_created_at,
  order_updated_at as source_updated_at,
  source_business_at,
  greatest(
    coalesce(order_updated_at, '1900-01-01'::timestamptz),
    coalesce(last_synced_at, '1900-01-01'::timestamptz),
    coalesce(internal_updated_at, '1900-01-01'::timestamptz)
  ) as observed_at
from operations;

grant select on public.v_ecoflow_order_operations_v2 to authenticated;

create or replace view public.v_ecoflow_order_operations_summary_v2 as
select
  count(*)::numeric as total_orders,
  count(*) filter (where operational_scope = 'CURRENT')::numeric as current_orders,
  count(*) filter (where operational_scope = 'REVIEW')::numeric as source_review_orders,
  count(*) filter (where release_eligible)::numeric as ready_to_release,
  count(*) filter (where data_quality_status <> 'READY' and operational_scope in ('CURRENT', 'REVIEW'))::numeric as blocked_orders,
  count(*) filter (where fulfilment_status in ('RELEASED', 'PICKING', 'STAGED', 'OUT_FOR_DELIVERY'))::numeric as in_progress_orders,
  count(*) filter (where fulfilment_status = 'COMPLETED')::numeric as completed_orders,
  count(*) filter (where fulfilment_status = 'CANCELLED')::numeric as cancelled_orders,
  coalesce(sum(order_value) filter (where operational_scope in ('CURRENT', 'REVIEW')), 0)::numeric as current_value,
  max(source_updated_at) as latest_source_update,
  max(observed_at) as last_observed_at
from public.v_ecoflow_order_operations_v2;

grant select on public.v_ecoflow_order_operations_summary_v2 to authenticated;

-- Keep the existing fast active-key mechanism, but populate it from the
-- explicit operations model rather than "everything not recognised as done".
create or replace function public.ecoflow_refresh_ui_active_order_keys()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from public.ecoflow_ui_active_order_keys;

  insert into public.ecoflow_ui_active_order_keys (order_key, refreshed_at)
  select distinct key_value, now()
  from public.v_ecoflow_order_operations_v2 o
  cross join lateral (
    values
      (o.raw_order_id),
      (o.external_order_id),
      (o.external_order_number),
      (o.order_number),
      (o.invoice_number)
  ) as keys(key_value)
  where o.operational_scope in ('CURRENT', 'REVIEW')
    and o.fulfilment_status not in ('COMPLETED', 'CANCELLED', 'HISTORY')
    and nullif(keys.key_value, '') is not null
  on conflict (order_key) do update set refreshed_at = excluded.refreshed_at;

  get diagnostics v_count = row_count;
  return v_count;
end
$$;

revoke all on function public.ecoflow_refresh_ui_active_order_keys() from public, anon, authenticated;
grant execute on function public.ecoflow_refresh_ui_active_order_keys() to service_role;

create or replace view public.v_ecoflow_ordermentum_ui_active_inbox as
select i.*
from public.v_ecoflow_ordermentum_inbox i
where i.raw_order_id::text in (select order_key from public.ecoflow_ui_active_order_keys)
   or i.external_order_id::text in (select order_key from public.ecoflow_ui_active_order_keys)
   or i.external_order_number::text in (select order_key from public.ecoflow_ui_active_order_keys)
   or i.order_number::text in (select order_key from public.ecoflow_ui_active_order_keys)
   or i.invoice_number::text in (select order_key from public.ecoflow_ui_active_order_keys);

grant select on public.v_ecoflow_ordermentum_ui_active_inbox to authenticated;

create or replace view public.v_ecoflow_ordermentum_ui_active_drafts as
select d.*
from public.v_ecoflow_ordermentum_internal_order_drafts_v3 d
where d.raw_order_id::text in (select order_key from public.ecoflow_ui_active_order_keys)
   or d.external_order_id::text in (select order_key from public.ecoflow_ui_active_order_keys)
   or d.external_order_number::text in (select order_key from public.ecoflow_ui_active_order_keys)
   or d.order_number::text in (select order_key from public.ecoflow_ui_active_order_keys)
   or d.invoice_number::text in (select order_key from public.ecoflow_ui_active_order_keys);

grant select on public.v_ecoflow_ordermentum_ui_active_drafts to authenticated;

create or replace view public.v_ecoflow_ordermentum_ui_active_order_lines as
select l.*
from public.v_ecoflow_ordermentum_order_lines l
where l.source_order_id::text in (select order_key from public.ecoflow_ui_active_order_keys)
   or l.order_number::text in (select order_key from public.ecoflow_ui_active_order_keys)
   or l.invoice_number::text in (select order_key from public.ecoflow_ui_active_order_keys);

grant select on public.v_ecoflow_ordermentum_ui_active_order_lines to authenticated;

create or replace view public.v_ecoflow_ordermentum_ui_active_om_orders as
select o.*
from public.om_orders o
where o.id::text in (select order_key from public.ecoflow_ui_active_order_keys)
   or o.order_number::text in (select order_key from public.ecoflow_ui_active_order_keys);

grant select on public.v_ecoflow_ordermentum_ui_active_om_orders to authenticated;

create or replace view public.v_ecoflow_ordermentum_ui_active_exceptions as
select e.*
from public.v_ecoflow_ordermentum_exceptions e
where e.raw_order_id::text in (select order_key from public.ecoflow_ui_active_order_keys)
   or e.external_order_id::text in (select order_key from public.ecoflow_ui_active_order_keys)
   or e.external_order_number::text in (select order_key from public.ecoflow_ui_active_order_keys)
   or e.order_number::text in (select order_key from public.ecoflow_ui_active_order_keys)
   or e.invoice_number::text in (select order_key from public.ecoflow_ui_active_order_keys)
   or e.external_invoice_number::text in (select order_key from public.ecoflow_ui_active_order_keys);

grant select on public.v_ecoflow_ordermentum_ui_active_exceptions to authenticated;

select public.ecoflow_refresh_ui_active_order_keys();

notify pgrst, 'reload schema';
commit;
