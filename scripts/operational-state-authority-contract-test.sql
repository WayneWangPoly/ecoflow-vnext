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

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

do $$
declare
  v_blocked boolean := false;
begin
  begin
    insert into public.ecoflow_day_state(business_day, scope, payload, updated_by)
    values ('2026-08-01', 'run-control', '{"activeRunCode":"ILLEGAL"}'::jsonb, 'Direct browser');
  exception when insufficient_privilege then
    v_blocked := true;
  end;
  perform public.test_assert(v_blocked, 'authenticated clients must not insert day state directly');
end;
$$;

do $$
declare
  v_result record;
  v_read record;
begin
  select * into v_result
  from public.ecoflow_apply_day_state_commands(
    '2026-08-01',
    jsonb_build_array(jsonb_build_object(
      'commandId', '10000000-0000-0000-0000-000000000001',
      'scope', 'run-control',
      'expectedRevision', 0,
      'payload', jsonb_build_object('activeRunCode', 'A')
    )),
    'Owner one'
  );
  perform public.test_assert(v_result.command_status = 'APPLIED', 'first command must apply');
  perform public.test_assert(v_result.revision = 1, 'first scope revision must be one');

  select * into v_read
  from public.ecoflow_read_day_state_scope('2026-08-01', 'run-control');
  perform public.test_assert(v_read.revision = 1, 'read RPC must return the authoritative revision');
  perform public.test_assert(v_read.payload ->> 'activeRunCode' = 'A', 'read RPC must return authoritative payload');

  select * into v_result
  from public.ecoflow_apply_day_state_commands(
    '2026-08-01',
    jsonb_build_array(jsonb_build_object(
      'commandId', '10000000-0000-0000-0000-000000000001',
      'scope', 'run-control',
      'expectedRevision', 0,
      'payload', jsonb_build_object('activeRunCode', 'A')
    )),
    'Owner one retry'
  );
  perform public.test_assert(v_result.command_status = 'REPLAYED', 'same command ID must replay');
  perform public.test_assert(v_result.revision = 1, 'replay must retain original result revision');
end;
$$;

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
    jsonb_build_array(jsonb_build_object(
      'commandId', '10000000-0000-0000-0000-000000000002',
      'scope', 'run-control',
      'expectedRevision', 0,
      'payload', jsonb_build_object('activeRunCode', 'B')
    )),
    'Owner two stale device'
  );
  perform public.test_assert(v_result.command_status = 'CONFLICT', 'stale expected revision must conflict');
  perform public.test_assert(v_result.revision = 1, 'conflict must return current revision');
  perform public.test_assert(v_result.payload ->> 'activeRunCode' = 'A', 'conflict must return current server payload');

  select * into v_result
  from public.ecoflow_apply_day_state_commands(
    '2026-08-01',
    jsonb_build_array(jsonb_build_object(
      'commandId', '10000000-0000-0000-0000-000000000003',
      'scope', 'run-control',
      'expectedRevision', 1,
      'payload', jsonb_build_object('activeRunCode', 'B')
    )),
    'Owner two refreshed device'
  );
  perform public.test_assert(v_result.command_status = 'APPLIED', 'refreshed expected revision must apply');
  perform public.test_assert(v_result.revision = 2, 'second write must increment only this scope');
end;
$$;

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
    jsonb_build_array(
      jsonb_build_object(
        'commandId', '20000000-0000-0000-0000-000000000001',
        'scope', 'run:B:release:ORDER-PENDING',
        'expectedRevision', 0,
        'payload', jsonb_build_object('releasedAt', '2026-08-01T08:00:00Z')
      ),
      jsonb_build_object(
        'commandId', '20000000-0000-0000-0000-000000000002',
        'scope', 'run:B:stop:ORDER-PENDING',
        'expectedRevision', 0,
        'payload', jsonb_build_object('status', 'PENDING', 'loaded', true)
      ),
      jsonb_build_object(
        'commandId', '20000000-0000-0000-0000-000000000003',
        'scope', 'run:B:release:ORDER-DONE',
        'expectedRevision', 0,
        'payload', jsonb_build_object('releasedAt', '2026-08-01T08:10:00Z')
      ),
      jsonb_build_object(
        'commandId', '20000000-0000-0000-0000-000000000004',
        'scope', 'run:B:stop:ORDER-DONE',
        'expectedRevision', 0,
        'payload', jsonb_build_object('status', 'DELIVERED', 'completedAt', '2026-08-01T11:00:00Z')
      )
    ),
    'Owner close preparation'
  );
  perform public.test_assert(v_count = 4, 'valid multi-scope batch must apply atomically');
end;
$$;

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
    jsonb_build_array(jsonb_build_object(
      'commandId', '30000000-0000-0000-0000-000000000001',
      'scope', 'run:A:stop:ORDER-DRIVER',
      'expectedRevision', 0,
      'payload', jsonb_build_object('status', 'ARRIVED')
    )),
    'Driver device'
  );
  perform public.test_assert(v_result.command_status = 'APPLIED', 'driver must write driver stop scope');

  begin
    perform *
    from public.ecoflow_apply_day_state_commands(
      '2026-08-02',
      jsonb_build_array(jsonb_build_object(
        'commandId', '30000000-0000-0000-0000-000000000002',
        'scope', 'run-control',
        'expectedRevision', 0,
        'payload', jsonb_build_object('activeRunCode', 'B')
      )),
      'Driver device'
    );
  exception when others then
    v_blocked := position('DAY_STATE_SCOPE_WRITE_FORBIDDEN' in sqlerrm) > 0;
  end;
  perform public.test_assert(v_blocked, 'driver must not write office run-control scope');
end;
$$;

reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004';

do $$
declare
  v_blocked boolean := false;
begin
  begin
    perform *
    from public.ecoflow_apply_day_state_commands(
      '2026-08-02',
      jsonb_build_array(jsonb_build_object(
        'commandId', '40000000-0000-0000-0000-000000000001',
        'scope', 'run:A:stop:ORDER-VIEWER',
        'expectedRevision', 0,
        'payload', jsonb_build_object('status', 'ARRIVED')
      )),
      'Viewer device'
    );
  exception when others then
    v_blocked := position('DAY_STATE_SCOPE_WRITE_FORBIDDEN' in sqlerrm) > 0;
  end;
  perform public.test_assert(v_blocked, 'viewer must not write operational state');
end;
$$;

reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

do $$
declare
  v_result record;
  v_count integer;
  v_terminal_count integer;
begin
  select * into v_result
  from public.ecoflow_close_business_day(
    '2026-08-01',
    '2026-08-03',
    0,
    'End-of-day reconciliation complete',
    '50000000-0000-0000-0000-000000000001',
    'Owner one'
  );
  perform public.test_assert(v_result.close_status = 'APPLIED', 'business day close must apply once');
  perform public.test_assert(v_result.carry_over_count = 2, 'only unresolved release and stop must carry');

  select count(*) into v_count
  from public.ecoflow_business_day_carry_over c
  where c.source_business_day = '2026-08-01'
    and c.target_business_day = '2026-08-03'
    and c.status = 'OPEN';
  perform public.test_assert(v_count = 2, 'explicit carry-over rows must exist');

  select count(*) into v_terminal_count
  from public.ecoflow_business_day_carry_over c
  where c.source_business_day = '2026-08-01'
    and c.source_scope like '%ORDER-DONE';
  perform public.test_assert(v_terminal_count = 0, 'terminal delivered order must not carry');

  select * into v_result
  from public.ecoflow_close_business_day(
    '2026-08-01',
    '2026-08-03',
    0,
    'End-of-day reconciliation complete',
    '50000000-0000-0000-0000-000000000001',
    'Owner one retry'
  );
  perform public.test_assert(v_result.close_status = 'REPLAYED', 'business day close command must be idempotent');
  perform public.test_assert(v_result.carry_over_count = 2, 'replay must retain carry-over result');
end;
$$;

do $$
declare
  v_state record;
  v_command_count integer;
begin
  select * into v_state
  from public.ecoflow_read_day_state_scope('2026-08-01', 'run-control');
  perform public.test_assert(v_state.revision = 2, 'server revision must survive all client attempts');
  perform public.test_assert(v_state.payload ->> 'activeRunCode' = 'B', 'newer authoritative payload must survive stale write');

  reset role;
  select count(*) into v_command_count from public.ecoflow_day_state_commands;
  perform public.test_assert(v_command_count = 7, 'only applied commands belong in the idempotency ledger');
end;
$$;

reset role;

drop function public.test_assert(boolean,text);

select 'Operational state authority contract passed.' as result;
