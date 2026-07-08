-- Confirm the real internal-order execution source and add an audited executor.
-- The actual internal order identity is public.ecoflow_ordermentum_internal_orders.id.
-- lifecycle internal_order_id points at that id, so cancel/rebuild can now be targeted safely.

create table if not exists public.ecoflow_legacy_internal_review_executions (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid references public.ecoflow_legacy_internal_review_decisions(id) on delete set null,
  lifecycle_id text not null,
  internal_order_id text,
  decision text not null,
  execution_status text not null,
  affected_rows integer not null default 0,
  before_snapshot jsonb,
  after_snapshot jsonb,
  error_message text,
  executed_by uuid default auth.uid(),
  executed_at timestamptz not null default now()
);

create index if not exists idx_legacy_review_executions_lifecycle on public.ecoflow_legacy_internal_review_executions(lifecycle_id);
create index if not exists idx_legacy_review_executions_status on public.ecoflow_legacy_internal_review_executions(execution_status);
create index if not exists idx_legacy_review_executions_executed_at on public.ecoflow_legacy_internal_review_executions(executed_at desc);

grant select, insert on public.ecoflow_legacy_internal_review_executions to authenticated;

drop view if exists public.v_ecoflow_internal_order_draft_dependencies;

create view public.v_ecoflow_internal_order_draft_dependencies as
with target_view as (
  select c.oid
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'v_ecoflow_ordermentum_internal_order_drafts_v3'
  limit 1
), rewrite_deps as (
  select distinct ref.oid, ref_ns.nspname as object_schema, ref.relname as object_name, ref.relkind
  from target_view target
  join pg_rewrite r on r.ev_class = target.oid
  join pg_depend d on d.objid = r.oid
  join pg_class ref on ref.oid = d.refobjid
  join pg_namespace ref_ns on ref_ns.oid = ref.relnamespace
  where ref_ns.nspname = 'public'
    and ref.relname <> 'v_ecoflow_ordermentum_internal_order_drafts_v3'
), candidates as (
  select * from rewrite_deps
  union
  select c.oid, n.nspname as object_schema, c.relname as object_name, c.relkind
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('ecoflow_ordermentum_internal_orders', 'ecoflow_ordermentum_internal_order_lines')
)
select
  object_schema,
  object_name,
  case relkind
    when 'r' then 'table'
    when 'p' then 'partitioned table'
    when 'v' then 'view'
    when 'm' then 'materialized view'
    when 'f' then 'foreign table'
    else relkind::text
  end as object_type,
  (
    exists (select 1 from information_schema.columns c where c.table_schema = object_schema and c.table_name = object_name and c.column_name = 'internal_order_id')
    or (object_name = 'ecoflow_ordermentum_internal_orders' and exists (select 1 from information_schema.columns c where c.table_schema = object_schema and c.table_name = object_name and c.column_name = 'id'))
  ) as has_internal_order_id,
  (
    exists (select 1 from information_schema.columns c where c.table_schema = object_schema and c.table_name = object_name and c.column_name = 'internalisation_status')
    or exists (select 1 from information_schema.columns c where c.table_schema = object_schema and c.table_name = object_name and c.column_name = 'status')
  ) as has_internalisation_status,
  exists (
    select 1 from information_schema.columns c
    where c.table_schema = object_schema and c.table_name = object_name and c.column_name = 'warehouse_gate_status'
  ) as has_warehouse_gate_status,
  case
    when object_name = 'ecoflow_ordermentum_internal_orders' then 'id'
    when exists (select 1 from information_schema.columns c where c.table_schema = object_schema and c.table_name = object_name and c.column_name = 'internal_order_id') then 'internal_order_id'
    else null
  end as identity_column,
  case
    when exists (select 1 from information_schema.columns c where c.table_schema = object_schema and c.table_name = object_name and c.column_name = 'internalisation_status') then 'internalisation_status'
    when exists (select 1 from information_schema.columns c where c.table_schema = object_schema and c.table_name = object_name and c.column_name = 'status') then 'status'
    else null
  end as status_column,
  case
    when object_name = 'ecoflow_ordermentum_internal_orders' then 'CONFIRMED_EXECUTION_SOURCE'
    when object_name = 'ecoflow_ordermentum_internal_order_lines' then 'LINE_SOURCE_ONLY'
    when relkind = 'v' then 'READ_MODEL'
    else 'REFERENCE'
  end as execution_role
from candidates
order by
  case when object_name = 'ecoflow_ordermentum_internal_orders' then 0 else 1 end,
  object_type,
  object_name;

grant select on public.v_ecoflow_internal_order_draft_dependencies to authenticated;

create or replace function public.ecoflow_execute_legacy_internal_review_decision(p_lifecycle_id text)
returns table (
  execution_id uuid,
  lifecycle_id text,
  decision text,
  execution_status text,
  affected_rows integer,
  executed_at timestamptz,
  error_message text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_decision public.ecoflow_legacy_internal_review_decisions%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_status text;
  v_error text;
  v_rows integer := 0;
  v_execution_id uuid;
begin
  select * into v_decision
  from public.ecoflow_legacy_internal_review_decisions d
  where d.lifecycle_id = p_lifecycle_id
  order by d.decided_at desc
  limit 1;

  if not found then
    raise exception 'legacy review decision not found for lifecycle_id %', p_lifecycle_id;
  end if;

  select to_jsonb(o) into v_before
  from public.ecoflow_ordermentum_internal_orders o
  where o.id::text = v_decision.internal_order_id
  limit 1;

  if v_decision.decision = 'ARCHIVE_APPROVED' then
    v_status := 'ARCHIVED_NO_TABLE_MUTATION';
    v_rows := 0;
    v_after := v_before;
  elsif v_before is null then
    v_status := 'SOURCE_INTERNAL_ORDER_NOT_FOUND';
    v_error := 'No row in ecoflow_ordermentum_internal_orders for internal_order_id=' || coalesce(v_decision.internal_order_id, 'null');
  elsif v_decision.decision = 'CANCEL_DRAFT_REQUESTED' then
    begin
      update public.ecoflow_ordermentum_internal_orders o
      set
        status = 'LEGACY_CANCELLED',
        account_release_status = 'LEGACY_CANCELLED',
        warehouse_gate_status = 'LEGACY_CANCELLED',
        updated_at = now()
      where o.id::text = v_decision.internal_order_id
      returning to_jsonb(o) into v_after;
      get diagnostics v_rows = row_count;
      v_status := case when v_rows > 0 then 'CANCELLED_LEGACY_DRAFT' else 'SOURCE_INTERNAL_ORDER_NOT_FOUND' end;
    exception when others then
      v_status := 'EXECUTION_FAILED';
      v_error := sqlerrm;
      v_rows := 0;
      v_after := v_before;
    end;
  elsif v_decision.decision = 'REBUILD_REQUESTED' then
    begin
      update public.ecoflow_ordermentum_internal_orders o
      set
        status = 'REBUILD_REQUESTED',
        account_release_status = 'REBUILD_REQUESTED',
        warehouse_gate_status = 'REBUILD_REQUESTED',
        updated_at = now()
      where o.id::text = v_decision.internal_order_id
      returning to_jsonb(o) into v_after;
      get diagnostics v_rows = row_count;
      v_status := case when v_rows > 0 then 'OLD_DRAFT_HELD_FOR_REBUILD' else 'SOURCE_INTERNAL_ORDER_NOT_FOUND' end;
    exception when others then
      v_status := 'EXECUTION_FAILED';
      v_error := sqlerrm;
      v_rows := 0;
      v_after := v_before;
    end;
  else
    v_status := 'KEEP_REVIEW_NO_EXECUTION';
    v_rows := 0;
    v_after := v_before;
  end if;

  insert into public.ecoflow_legacy_internal_review_executions (
    decision_id,
    lifecycle_id,
    internal_order_id,
    decision,
    execution_status,
    affected_rows,
    before_snapshot,
    after_snapshot,
    error_message,
    executed_by,
    executed_at
  ) values (
    v_decision.id,
    v_decision.lifecycle_id,
    v_decision.internal_order_id,
    v_decision.decision,
    v_status,
    v_rows,
    v_before,
    v_after,
    v_error,
    auth.uid(),
    now()
  ) returning id into v_execution_id;

  return query
  select
    e.id,
    e.lifecycle_id,
    e.decision,
    e.execution_status,
    e.affected_rows,
    e.executed_at,
    e.error_message
  from public.ecoflow_legacy_internal_review_executions e
  where e.id = v_execution_id;
end;
$$;

grant execute on function public.ecoflow_execute_legacy_internal_review_decision(text) to authenticated;

drop view if exists public.v_ecoflow_internal_order_execution_queue;

create view public.v_ecoflow_internal_order_execution_queue as
select
  d.id,
  d.lifecycle_id,
  d.order_number,
  d.invoice_number,
  d.internal_order_id,
  d.decision,
  d.decision_note,
  d.decided_at,
  coalesce(e.execution_status,
    case
      when d.decision = 'ARCHIVE_APPROVED' then 'PENDING_ARCHIVE_ACK'
      when d.decision = 'CANCEL_DRAFT_REQUESTED' then 'READY_TO_CANCEL_SOURCE_DRAFT'
      when d.decision = 'REBUILD_REQUESTED' then 'READY_TO_HOLD_FOR_REBUILD'
      else 'KEEP_REVIEW'
    end
  ) as execution_status,
  coalesce(e.affected_rows, 0) as affected_rows,
  e.executed_at,
  e.error_message,
  b.lifecycle_status,
  b.internalisation_status,
  b.warehouse_gate_status,
  b.invoice_total,
  b.lifecycle_updated_at
from public.ecoflow_legacy_internal_review_decisions d
left join lateral (
  select *
  from public.ecoflow_legacy_internal_review_executions x
  where x.lifecycle_id = d.lifecycle_id
  order by x.executed_at desc
  limit 1
) e on true
left join public.v_ecoflow_order_lifecycle_board b on b.lifecycle_id = d.lifecycle_id
where d.decision in ('ARCHIVE_APPROVED','CANCEL_DRAFT_REQUESTED','REBUILD_REQUESTED')
order by d.decided_at desc;

grant select on public.v_ecoflow_internal_order_execution_queue to authenticated;

notify pgrst, 'reload schema';
