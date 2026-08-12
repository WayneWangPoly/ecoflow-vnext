begin;

-- Keep retention scans bounded and aligned with the current mirror identity key.
create index if not exists idx_ordermentum_master_resource_versions_retention
  on public.ordermentum_raw_master_resource_versions
  (resource_type, external_id, changed_at desc, id desc);

create or replace function public.ecoflow_prune_ordermentum_master_resource_versions()
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_deleted bigint := 0;
begin
  -- Serialize pruning with version writers so the global payload budget remains a hard bound.
  lock table public.ordermentum_raw_master_resource_versions in share row exclusive mode;

  with resource_ranked as (
    select
      id,
      changed_at,
      pg_column_size(payload)::bigint as payload_bytes,
      row_number() over (
        partition by resource_type, external_id
        order by changed_at desc, id desc
      ) as resource_rank
    from public.ordermentum_raw_master_resource_versions
  ),
  retention_candidates as (
    select
      id,
      changed_at,
      payload_bytes
    from resource_ranked
    where resource_rank <= 3
      and changed_at >= now() - interval '30 days'
  ),
  budgeted as (
    select
      id,
      sum(payload_bytes) over (
        order by changed_at desc, id desc
        rows between unbounded preceding and current row
      ) as running_payload_bytes
    from retention_candidates
  ),
  keep as (
    select id
    from budgeted
    where running_payload_bytes <= 10485760::bigint
  )
  delete from public.ordermentum_raw_master_resource_versions as versions
  where not exists (
    select 1
    from keep
    where keep.id = versions.id
  );

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$;

comment on function public.ecoflow_prune_ordermentum_master_resource_versions() is
  'Source-admin maintenance only. Keeps at most 3 versions per Ordermentum resource, 30 days of history, and 10 MiB of live version payload globally.';

revoke all on function public.ecoflow_prune_ordermentum_master_resource_versions() from public;
revoke all on function public.ecoflow_prune_ordermentum_master_resource_versions() from anon;
revoke all on function public.ecoflow_prune_ordermentum_master_resource_versions() from authenticated;
grant execute on function public.ecoflow_prune_ordermentum_master_resource_versions() to service_role;

create or replace function public.ecoflow_ordermentum_storage_health()
returns table (
  database_bytes bigint,
  versions_table_bytes bigint,
  versions_rows bigint,
  versions_payload_bytes bigint
)
language sql
security definer
set search_path = pg_catalog, public
as $function$
  select
    pg_database_size(current_database())::bigint as database_bytes,
    pg_total_relation_size('public.ordermentum_raw_master_resource_versions'::regclass)::bigint as versions_table_bytes,
    count(*)::bigint as versions_rows,
    coalesce(sum(pg_column_size(payload)::bigint), 0)::bigint as versions_payload_bytes
  from public.ordermentum_raw_master_resource_versions;
$function$;

comment on function public.ecoflow_ordermentum_storage_health() is
  'Service-only storage guardrail used by the bounded Ordermentum mirror workflow.';

revoke all on function public.ecoflow_ordermentum_storage_health() from public;
revoke all on function public.ecoflow_ordermentum_storage_health() from anon;
revoke all on function public.ecoflow_ordermentum_storage_health() from authenticated;
grant execute on function public.ecoflow_ordermentum_storage_health() to service_role;

create or replace function public.ecoflow_enforce_ordermentum_master_version_retention()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  perform public.ecoflow_prune_ordermentum_master_resource_versions();
  return null;
end;
$function$;

revoke all on function public.ecoflow_enforce_ordermentum_master_version_retention() from public;
revoke all on function public.ecoflow_enforce_ordermentum_master_version_retention() from anon;
revoke all on function public.ecoflow_enforce_ordermentum_master_version_retention() from authenticated;

drop trigger if exists trg_ordermentum_master_resource_versions_retention
  on public.ordermentum_raw_master_resource_versions;

create trigger trg_ordermentum_master_resource_versions_retention
after insert on public.ordermentum_raw_master_resource_versions
for each statement
execute function public.ecoflow_enforce_ordermentum_master_version_retention();

comment on trigger trg_ordermentum_master_resource_versions_retention
  on public.ordermentum_raw_master_resource_versions is
  'Hard storage bound for full-JSON Ordermentum history; independent of pg_cron or application scheduling.';

commit;
