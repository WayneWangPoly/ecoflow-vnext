create or replace function public.test_assert(p_condition boolean, p_message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce(p_condition, false) then
    raise exception 'ASSERTION FAILED: %', p_message;
  end if;
end;
$$;

grant execute on function public.test_assert(boolean,text) to authenticated;

-- Owner: direct table writes are blocked, RPC apply/replay/read are authoritative.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

do $$
declare
  v_blocked boolean := false;
  v_result record;
  v_read record;
begin
  begin
    insert into public.ecoflow_day_state(business_day, scope, payload, updated_by)
    values ('2026-08-01', 'run-control', '{"activeRunCode":"ILLEGAL"}'::jsonb, 'Direct browser');
  exception when insufficient_privilege then
    v_blocked := true;
  end;
  perform public.test_assert(v_blocked, 'authenticated clients must not insert day state directly');

  select * into v_result
  from public.ecoflow_apply_day_state_commands(
    '2026-08-01',
    '[{"commandId":"10000000-0000-0000-0000-000000000001","scope":"run-control","expectedRevision":0,"payload":{"activeRunCode":"A"}}]'::jsonb,
    'Owner one'
  );
  perform public.test_assert(v_result.command_status = 'APPLIED', 'first command must apply');
  perform public.test_assert(v_result.revision = 1, 'first scope revision must be one');

  select * into v_read
  from public.ecoflow_read_day_state_scope('2026-08-01', 'run-control');
  perform public.test_assert(v_read.revision = 1, 'read RPC must return revision');
  perform public.test_assert(v_read.payload ->> 'activeRunCode' = 'A', 'read RPC must return payload');

  select * into v_result
  from public.ecoflow_apply_day_state_commands(
    '2026-08-01',
    '[{"commandId":"10000000-0000-0000-0000-000000000001","scope":"run-control","expectedRevision":0,"payload":{"activeRunCode":"A"}}]'::jsonb,
    'Owner one retry'
  );
  perform public.test_assert(v_result.command_status = 'REPLAYED', 'same command ID must replay');
  perform public.test_assert(v_result.revision = 1, 'replay must preserve result revision');
end;
$$;

-- A second owner cannot overwrite the newer scope with a stale revision.
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';

do $$
declare
  v_result record;
begin
  select * into v_result
  from public.ecoflow_apply_day_state_commands(
    '2026-08-01',
    '[{"commandId":"10000000-0000-0000-0000-000000000002","scope":"run-control","expectedRevision":0,"payload":{"activeRunCode":"B"}}]'::jsonb,
    'Owner two stale device'
  );
  perform public.test_assert(v_result.command_status = 'CONFLICT', 'stale revision must conflict');
  perform public.test_assert(v_result.revision = 1, 'conflict must return current revision');
  perform public.test_assert(v_result.payload ->> 'activeRunCode' = 'A', 'conflict must return server payload');

  select * into v_result
  from public.ecoflow_apply_day_state_commands(
    '2026-08-01',
    '[{"commandId":"10000000-0000-0000-0000-000000000003","scope":"run-control","expectedRevision":1,"payload":{"activeRunCode":"B"}}]'::jsonb,
    'Owner two refreshed device'
  );
  perform public.test_assert(v_result.command_status = 'APPLIED', 'refreshed revision must apply');
  perform public.test_assert(v_result.revision = 2, 'second write must increment scope revision');
end;
$$;

-- Prepare one unresolved and one terminal delivery for Business Day Close.
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.ecoflow_apply_day_state_commands(
    '2026-08-01',
    '[
      {"commandId":"20000000-0000-0000-0000-000000000001","scope":"run:B:release:ORDER-PENDING","expectedRevision":0,"payload":{"releasedAt":"2026-08-01T08:00:00Z"}},
      {"commandId":"20000000-0000-0000-0000-000000000002","scope":"run:B:stop:ORDER-PENDING","expectedRevision":0,"payload":{"status":"PENDING","loaded":true}},
      {"commandId":"20000000-0000-0000-0000-000000000003","scope":"run:B:release:ORDER-DONE","expectedRevision":0,"payload":{"releasedAt":"2026-08-01T08:10:00Z"}},
      {"commandId":"20000000-0000-0000-0000-000000000004","scope":"run:B:stop:ORDER-DONE","expectedRevision":0,"payload":{"status":"DELIVERED","completedAt":"2026-08-01T11:00:00Z"}}
    ]'::jsonb,
    'Owner close preparation'
  );
  perform public.test_assert(v_count = 4, 'multi-scope batch must apply atomically');
end;
$$;

-- Driver may write driver scopes but not office run control.
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';

do $$
declare
  v_result record;
  v_blocked boolean := false;
begin
  select * into v_result
  from public.ecoflow_apply_day_state_commands(
    '2026-08-02',
    '[{"commandId":"30000000-0000-0000-0000-000000000001","scope":"run:A:stop:ORDER-DRIVER","expectedRevision":0,"payload":{"status":"ARRIVED"}}]'::jsonb,
    'Driver device'
  );
  perform public.test_assert(v_result.command_status = 'APPLIED', 'driver must write stop scope');

  begin
    perform * from public.ecoflow_apply_day_state_commands(
      '2026-08-02',
      '[{"commandId":"30000000-0000-0000-0000-000000000002","scope":"run-control","expectedRevision":0,"payload":{"activeRunCode":"B"}}]'::jsonb,
      'Driver device'
    );
  exception when others then
    v_blocked := position('DAY_STATE_SCOPE_WRITE_FORBIDDEN' in sqlerrm) > 0;
  end;
  perform public.test_assert(v_blocked, 'driver must not write run-control');
end;
$$;

-- Viewer cannot write any operational scope.
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004';

do $$
declare
  v_blocked boolean := false;
begin
  begin
    perform * from public.ecoflow_apply_day_state_commands(
      '2026-08-02',
      '[{"commandId":"40000000-0000-0000-0000-000000000001","scope":"run:A:stop:ORDER-VIEWER","expectedRevision":0,"payload":{"status":"ARRIVED"}}]'::jsonb,
      'Viewer device'
    );
  exception when others then
    v_blocked := position('DAY_STATE_SCOPE_WRITE_FORBIDDEN' in sqlerrm) > 0;
  end;
  perform public.test_assert(v_blocked, 'viewer must not write state');
end;
$$;

-- Owner close creates explicit carry-over records and is idempotent.
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

do $$
declare
  v_result record;
  v_count integer;
  v_terminal_count integer;
  v_state record;
begin
  select * into v_result
  from public.ecoflow_close_business_day(
    '2026-08-01', '2026-08-03', 0,
    'End-of-day reconciliation complete',
    '50000000-0000-0000-0000-000000000001',
    'Owner one'
  );
  perform public.test_assert(v_result.close_status = 'APPLIED', 'day close must apply once');
  perform public.test_assert(v_result.carry_over_count = 2, 'only unresolved release and stop carry');

  select count(*) into v_count
  from public.ecoflow_business_day_carry_over c
  where c.source_business_day = '2026-08-01'
    and c.target_business_day = '2026-08-03'
    and c.status = 'OPEN';
  perform public.test_assert(v_count = 2, 'explicit carry-over records must exist');

  select count(*) into v_terminal_count
  from public.ecoflow_business_day_carry_over c
  where c.source_business_day = '2026-08-01'
    and c.source_scope like '%ORDER-DONE';
  perform public.test_assert(v_terminal_count = 0, 'terminal order must not carry');

  select * into v_result
  from public.ecoflow_close_business_day(
    '2026-08-01', '2026-08-03', 0,
    'End-of-day reconciliation complete',
    '50000000-0000-0000-0000-000000000001',
    'Owner one retry'
  );
  perform public.test_assert(v_result.close_status = 'REPLAYED', 'day close must replay');
  perform public.test_assert(v_result.carry_over_count = 2, 'replay must preserve result');

  select * into v_state
  from public.ecoflow_read_day_state_scope('2026-08-01', 'run-control');
  perform public.test_assert(v_state.revision = 2, 'latest scope revision must survive stale attempts');
  perform public.test_assert(v_state.payload ->> 'activeRunCode' = 'B', 'latest server payload must survive');
end;
$$;

reset role;

do $$
declare
  v_command_count integer;
begin
  select count(*) into v_command_count from public.ecoflow_day_state_commands;
  perform public.test_assert(v_command_count = 7, 'only applied commands enter idempotency ledger');
end;
$$;

drop function public.test_assert(boolean,text);

select 'Operational state authority contract passed.' as result;
