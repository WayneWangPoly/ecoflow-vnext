begin;

-- EcoFlow keeps Ordermentum in Supabase as an operational current-state mirror,
-- not as a long-term raw history warehouse. Retain only the minimum previous
-- state needed for short-horizon audit/recovery while keeping current rows intact.
create or replace function public.ecoflow_prune_ordermentum_master_resource_versions()
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_deleted bigint := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('ecoflow-ordermentum-version-retention', 0));

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
    where resource_rank <= 1
      and changed_at >= now() - interval '7 days'
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
    where running_payload_bytes <= 2097152::bigint
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
  'Source-admin maintenance only. Keeps at most 1 previous version per Ordermentum resource, 7 days of history, and 2 MiB of live version payload globally.';

revoke all on function public.ecoflow_prune_ordermentum_master_resource_versions() from public;
revoke all on function public.ecoflow_prune_ordermentum_master_resource_versions() from anon;
revoke all on function public.ecoflow_prune_ordermentum_master_resource_versions() from authenticated;
grant execute on function public.ecoflow_prune_ordermentum_master_resource_versions() to service_role;

-- Apply the tighter logical bound immediately. Physical file compaction remains
-- an explicit maintenance action and is intentionally not hidden in a migration.
select public.ecoflow_prune_ordermentum_master_resource_versions();

commit;
