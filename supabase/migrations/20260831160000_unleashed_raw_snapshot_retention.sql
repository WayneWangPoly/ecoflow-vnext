-- UNLEASHED-MIGRATION-002
-- Bound raw Unleashed observation retention without deleting durable run history
-- or stable external identity/hash evidence.
--
-- Raw JSON is diagnostic/mapping evidence, not a system-of-record copy. The
-- declared retention horizon is 14 days from last_seen_at. Purge execution is
-- deliberately manual/service-role-only so production deletion remains an
-- explicit, auditable operator action.

create index if not exists unleashed_raw_snapshots_retention_idx
  on public.unleashed_raw_snapshots (last_seen_at, id);

create or replace function public.purge_expired_unleashed_raw_snapshots(
  p_batch_size integer default 500
)
returns table (
  deleted_count bigint,
  retention_days integer,
  cutoff_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff timestamptz := now() - interval '14 days';
begin
  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 5000 then
    raise exception 'INVALID_UNLEASHED_PURGE_BATCH_SIZE'
      using errcode = '22023';
  end if;

  return query
  with victims as (
    select snapshot.id
    from public.unleashed_raw_snapshots as snapshot
    where snapshot.last_seen_at < v_cutoff
    order by snapshot.last_seen_at asc, snapshot.id asc
    limit p_batch_size
    for update skip locked
  ),
  deleted as (
    delete from public.unleashed_raw_snapshots as snapshot
    using victims
    where snapshot.id = victims.id
    returning snapshot.id
  )
  select count(*)::bigint, 14, v_cutoff
  from deleted;
end;
$$;

revoke all on function public.purge_expired_unleashed_raw_snapshots(integer) from public;
revoke all on function public.purge_expired_unleashed_raw_snapshots(integer) from anon;
revoke all on function public.purge_expired_unleashed_raw_snapshots(integer) from authenticated;
grant execute on function public.purge_expired_unleashed_raw_snapshots(integer) to service_role;

comment on function public.purge_expired_unleashed_raw_snapshots(integer) is
  'Service-role-only bounded purge for Unleashed raw JSON older than the declared 14-day retention horizon. Deletes raw snapshots only; connector runs and external identity/hash rows are retained.';

comment on table public.unleashed_raw_snapshots is
  'Bounded Unleashed raw observation staging. Raw JSON older than 14 days from last_seen_at is purge-eligible via the service-role-only purge_expired_unleashed_raw_snapshots function; durable run and identity/hash evidence remains separate.';
