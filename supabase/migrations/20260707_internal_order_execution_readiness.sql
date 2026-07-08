-- Internal-order execution readiness probes.
-- These views let the app discover the real internal-order source objects before
-- destructive cancel/rebuild actions are wired. This keeps the workflow self-diagnosing.

drop view if exists public.v_ecoflow_internal_order_execution_queue;
drop view if exists public.v_ecoflow_internal_order_draft_dependencies;
drop view if exists public.v_ecoflow_internal_order_schema_probe;

create view public.v_ecoflow_internal_order_schema_probe as
select
  t.table_schema,
  t.table_name,
  t.table_type,
  count(c.column_name)::int as column_count,
  string_agg(c.column_name, ', ' order by c.ordinal_position) as columns
from information_schema.tables t
left join information_schema.columns c
  on c.table_schema = t.table_schema
 and c.table_name = t.table_name
where t.table_schema = 'public'
  and (
    t.table_name ilike '%internal%order%'
    or t.table_name ilike '%order%draft%'
    or t.table_name ilike '%legacy%review%'
    or t.table_name ilike '%pick%order%'
  )
group by t.table_schema, t.table_name, t.table_type
order by t.table_type, t.table_name;

grant select on public.v_ecoflow_internal_order_schema_probe to authenticated;

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
  exists (
    select 1 from information_schema.columns c
    where c.table_schema = object_schema and c.table_name = object_name and c.column_name = 'internal_order_id'
  ) as has_internal_order_id,
  exists (
    select 1 from information_schema.columns c
    where c.table_schema = object_schema and c.table_name = object_name and c.column_name = 'internalisation_status'
  ) as has_internalisation_status,
  exists (
    select 1 from information_schema.columns c
    where c.table_schema = object_schema and c.table_name = object_name and c.column_name = 'warehouse_gate_status'
  ) as has_warehouse_gate_status
from rewrite_deps
order by object_type, object_name;

grant select on public.v_ecoflow_internal_order_draft_dependencies to authenticated;

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
  case
    when d.decision = 'ARCHIVE_APPROVED' then 'NO_DESTRUCTIVE_ACTION_REQUIRED'
    when d.decision = 'CANCEL_DRAFT_REQUESTED' then 'NEEDS_INTERNAL_DRAFT_TABLE_CONFIRMATION'
    when d.decision = 'REBUILD_REQUESTED' then 'NEEDS_REBUILD_RPC_CONFIRMATION'
    else 'KEEP_REVIEW'
  end as execution_status,
  b.lifecycle_status,
  b.internalisation_status,
  b.warehouse_gate_status,
  b.invoice_total,
  b.lifecycle_updated_at
from public.ecoflow_legacy_internal_review_decisions d
left join public.v_ecoflow_order_lifecycle_board b on b.lifecycle_id = d.lifecycle_id
where d.decision in ('ARCHIVE_APPROVED','CANCEL_DRAFT_REQUESTED','REBUILD_REQUESTED')
order by d.decided_at desc;

grant select on public.v_ecoflow_internal_order_execution_queue to authenticated;

notify pgrst, 'reload schema';
