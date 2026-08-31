\set ON_ERROR_STOP on

begin;

do $$
declare
  v_run_id uuid;
  v_deleted bigint;
  v_retention_days integer;
  v_cutoff timestamptz;
begin
  if to_regprocedure('public.purge_expired_unleashed_raw_snapshots(integer)') is null then
    raise exception 'Unleashed raw snapshot purge function is missing';
  end if;

  if has_function_privilege('anon', 'public.purge_expired_unleashed_raw_snapshots(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.purge_expired_unleashed_raw_snapshots(integer)', 'EXECUTE') then
    raise exception 'browser roles unexpectedly have Unleashed raw purge authority';
  end if;

  if not has_function_privilege('service_role', 'public.purge_expired_unleashed_raw_snapshots(integer)', 'EXECUTE') then
    raise exception 'service_role purge authority is missing';
  end if;

  insert into public.unleashed_sync_runs (run_type, status, reason, dry_run, resource_set, page_size, max_pages)
  values ('BOUNDED_SNAPSHOT', 'SUCCEEDED', 'retention-contract', false, array['products'], 1, 1)
  returning id into v_run_id;

  insert into public.unleashed_external_identities (
    resource, external_key, external_code, latest_payload_sha256,
    first_seen_run_id, last_seen_run_id, first_seen_at, last_seen_at
  ) values (
    'products', 'code:RETENTION-OLD', 'RETENTION-OLD', repeat('a', 64),
    v_run_id, v_run_id, now() - interval '20 days', now() - interval '20 days'
  );

  insert into public.unleashed_raw_snapshots (
    resource, external_key, external_code, payload, payload_sha256,
    first_seen_run_id, last_seen_run_id, first_seen_at, last_seen_at
  ) values
  (
    'products', 'code:RETENTION-OLD', 'RETENTION-OLD', '{"ProductCode":"RETENTION-OLD"}'::jsonb, repeat('a', 64),
    v_run_id, v_run_id, now() - interval '20 days', now() - interval '20 days'
  ),
  (
    'products', 'code:RETENTION-RECENT', 'RETENTION-RECENT', '{"ProductCode":"RETENTION-RECENT"}'::jsonb, repeat('b', 64),
    v_run_id, v_run_id, now() - interval '13 days', now() - interval '13 days'
  );

  select deleted_count, retention_days, cutoff_at
  into v_deleted, v_retention_days, v_cutoff
  from public.purge_expired_unleashed_raw_snapshots(1);

  if v_deleted <> 1 or v_retention_days <> 14 then
    raise exception 'unexpected purge result: deleted %, retention %', v_deleted, v_retention_days;
  end if;

  if exists (select 1 from public.unleashed_raw_snapshots where external_key = 'code:RETENTION-OLD') then
    raise exception 'expired raw snapshot was not purged';
  end if;

  if not exists (select 1 from public.unleashed_raw_snapshots where external_key = 'code:RETENTION-RECENT') then
    raise exception 'recent raw snapshot was purged before the 14-day horizon';
  end if;

  if not exists (select 1 from public.unleashed_external_identities where external_key = 'code:RETENTION-OLD') then
    raise exception 'raw purge deleted durable external identity/hash evidence';
  end if;

  if not exists (select 1 from public.unleashed_sync_runs where id = v_run_id) then
    raise exception 'raw purge deleted durable connector run history';
  end if;

  begin
    perform * from public.purge_expired_unleashed_raw_snapshots(5001);
    raise exception 'purge accepted an unsafe batch size';
  exception
    when sqlstate '22023' then
      null;
  end;
end
$$;

rollback;

select 'UNLEASHED-MIGRATION-002 raw retention DB contract: PASS' as result;
