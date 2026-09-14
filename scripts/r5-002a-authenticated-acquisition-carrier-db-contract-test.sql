\set ON_ERROR_STOP on

begin;

insert into public.unleashed_sync_runs (
  run_type,
  status,
  reason,
  dry_run,
  resource_set,
  page_size,
  max_pages,
  metadata
) values (
  'BOUNDED_SNAPSHOT',
  'RUNNING',
  'R5-002 first atomic claim',
  false,
  array['stock_on_hand'],
  200,
  5,
  '{"request_key":"ECOFLOW-R5-002"}'::jsonb
);

do $contract$
begin
  begin
    insert into public.unleashed_sync_runs (
      run_type,
      status,
      reason,
      dry_run,
      resource_set,
      page_size,
      max_pages,
      metadata
    ) values (
      'BOUNDED_SNAPSHOT',
      'RUNNING',
      'R5-002 replay claim',
      false,
      array['stock_on_hand'],
      200,
      5,
      '{"request_key":"ECOFLOW-R5-002"}'::jsonb
    );
    raise exception 'R5_002_DUPLICATE_REQUEST_KEY_ACCEPTED';
  exception
    when unique_violation then null;
  end;
end;
$contract$;

do $contract$
begin
  if (select count(*) from public.unleashed_sync_runs where metadata ->> 'request_key' = 'ECOFLOW-R5-002') <> 1 then
    raise exception 'R5_002_ATOMIC_CLAIM_COUNT_INVALID';
  end if;
end;
$contract$;

rollback;
