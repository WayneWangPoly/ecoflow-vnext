\set ON_ERROR_STOP on

-- The production repair must not be allowed to regress back to the synthetic
-- relation that masked the live failure.
DO $$
declare
  v_def text;
  v_reg regprocedure;
begin
  if to_regclass('public.ordermentum_stores') is not null then
    raise exception '007B fixture recreated stale public.ordermentum_stores';
  end if;

  foreach v_reg in array array[
    'public.ecoflow_read_account_hold_state_v1(text)'::regprocedure,
    'public.ecoflow_set_account_release_hold_v1(text,boolean,bigint,uuid,text,text)'::regprocedure,
    'public.ecoflow_record_accounts_statement_action(text,text,jsonb)'::regprocedure
  ] loop
    select pg_get_functiondef(v_reg) into v_def;
    if position('ecoflow_store_sites' in v_def)=0 then
      raise exception '007B repaired function % is not bound to ecoflow_store_sites',v_reg;
    end if;
    if position('ordermentum_stores' in v_def)>0 then
      raise exception '007B repaired function % retained stale ordermentum_stores',v_reg;
    end if;
  end loop;
end
$$;

-- OWNER: initial state is inactive/revision 0 and a hold applies as revision 1.
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

DO $$
declare
  r record;
begin
  select * into r from public.ecoflow_read_account_hold_state_v1('aaaaaaaa-0000-4000-8000-000000000001');
  if r.active is not false or r.revision <> 0 then
    raise exception '007B initial state mismatch: %', row_to_json(r);
  end if;

  select * into r
  from public.ecoflow_set_account_release_hold_v1(
    'aaaaaaaa-0000-4000-8000-000000000001', true, 0,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'fixture-device-owner',
    'Credit review required'
  );

  if r.accepted is not true or r.replayed is not false or r.status <> 'APPLIED'
     or r.active is not true or r.revision <> 1 then
    raise exception '007B OWNER apply mismatch: %', row_to_json(r);
  end if;
end
$$;

-- Exact replay is stable and does not advance revision.
DO $$
declare
  r record;
begin
  select * into r
  from public.ecoflow_set_account_release_hold_v1(
    'aaaaaaaa-0000-4000-8000-000000000001', true, 0,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'fixture-device-owner',
    'Credit review required'
  );

  if r.accepted is not true or r.replayed is not true or r.status <> 'REPLAYED'
     or r.active is not true or r.revision <> 1 then
    raise exception '007B replay mismatch: %', row_to_json(r);
  end if;
end
$$;

-- Reusing the same UUID for a different intent fails closed.
DO $$
declare
  caught boolean := false;
begin
  begin
    perform *
    from public.ecoflow_set_account_release_hold_v1(
      'aaaaaaaa-0000-4000-8000-000000000001', false, 0,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'fixture-device-owner',
      'Different intent'
    );
  exception when others then
    if sqlerrm = 'ACCOUNT_HOLD_IDEMPOTENCY_CONFLICT' then
      caught := true;
    else
      raise;
    end if;
  end;
  if not caught then
    raise exception '007B expected idempotency conflict';
  end if;
end
$$;

-- Stale revision returns a non-mutating CONFLICT with current authority.
DO $$
declare
  r record;
begin
  select * into r
  from public.ecoflow_set_account_release_hold_v1(
    'aaaaaaaa-0000-4000-8000-000000000001', false, 0,
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'fixture-device-owner',
    'Stale release attempt'
  );

  if r.accepted is not false or r.replayed is not false or r.status <> 'CONFLICT'
     or r.active is not true or r.revision <> 1 then
    raise exception '007B stale CAS mismatch: %', row_to_json(r);
  end if;
end
$$;

reset role;
DO $$
begin
  if (select count(*) from public.ecoflow_account_hold_commands) <> 1 then
    raise exception '007B replay/conflict must not duplicate audit rows';
  end if;
  if not exists (
    select 1
    from public.ecoflow_account_hold_commands c
    where c.command_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and c.actor_user_id = '11111111-1111-1111-1111-111111111111'
      and c.actor_role = 'OWNER'
      and c.device_id = 'fixture-device-owner'
      and c.reason = 'Credit review required'
      and (c.before_state ->> 'active')::boolean is false
      and (c.before_state ->> 'revision')::bigint = 0
      and (c.after_state ->> 'active')::boolean is true
      and (c.after_state ->> 'revision')::bigint = 1
  ) then
    raise exception '007B before/after audit evidence mismatch';
  end if;
end
$$;

-- ADMIN: release keeps a durable inactive row and advances revision.
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
DO $$
declare
  r record;
begin
  select * into r
  from public.ecoflow_set_account_release_hold_v1(
    'aaaaaaaa-0000-4000-8000-000000000001', false, 1,
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'fixture-device-admin',
    'Payment cleared'
  );

  if r.status <> 'APPLIED' or r.active is not false or r.revision <> 2 then
    raise exception '007B ADMIN release mismatch: %', row_to_json(r);
  end if;
end
$$;

reset role;
DO $$
begin
  if not exists (
    select 1 from public.ecoflow_account_release_holds h
    where h.store_id = 'aaaaaaaa-0000-4000-8000-000000000001'
      and h.active is false
      and h.revision = 2
      and h.hold_reason = 'Payment cleared'
      and h.source_action_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ) then
    raise exception '007B release must preserve durable inactive authority';
  end if;
end
$$;

-- ACCOUNT: apply is allowed and produces revision 3.
set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
DO $$
declare
  r record;
begin
  select * into r
  from public.ecoflow_set_account_release_hold_v1(
    'aaaaaaaa-0000-4000-8000-000000000001', true, 2,
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'fixture-device-account',
    'Manual account review'
  );
  if r.status <> 'APPLIED' or r.active is not true or r.revision <> 3 then
    raise exception '007B ACCOUNT apply mismatch: %', row_to_json(r);
  end if;

  select * into r
  from public.ecoflow_recover_account_hold_command_v1(
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  );
  if r.status <> 'REPLAYED' or r.command_id <> 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
     or r.revision <> 3 then
    raise exception '007B recovery mismatch: %', row_to_json(r);
  end if;
end
$$;

-- Recovery is actor-bound: another authorized actor cannot retrieve the command.
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
DO $$
declare
  n integer;
begin
  select count(*) into n
  from public.ecoflow_recover_account_hold_command_v1(
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  );
  if n <> 0 then
    raise exception '007B recovery leaked another actor command';
  end if;
end
$$;

-- Legacy hold mutation actions are explicitly closed, while statement actions survive.
DO $$
declare
  caught boolean := false;
  n integer;
begin
  begin
    perform * from public.ecoflow_record_accounts_statement_action(
      'aaaaaaaa-0000-4000-8000-000000000001', 'RELEASE_HOLD', '{"reason":"legacy bypass"}'::jsonb
    );
  exception when others then
    if sqlerrm = 'ACCOUNT_HOLD_COMMAND_REQUIRED' then
      caught := true;
    else
      raise;
    end if;
  end;
  if not caught then
    raise exception '007B legacy RELEASE_HOLD bypass remained open';
  end if;

  perform * from public.ecoflow_record_accounts_statement_action(
    'aaaaaaaa-0000-4000-8000-000000000001', 'STATEMENT_VIEWED', '{}'::jsonb
  );
  select count(*) into n
  from public.ecoflow_account_statement_actions
  where store_id = 'aaaaaaaa-0000-4000-8000-000000000001'
    and action_kind = 'STATEMENT_VIEWED';
  if n <> 1 then
    raise exception '007B statement-only legacy behavior regressed';
  end if;
end
$$;

-- Mandatory/bounded fields and unknown stores fail closed.
DO $$
declare
  caught boolean;
begin
  caught := false;
  begin
    perform * from public.ecoflow_set_account_release_hold_v1(
      'aaaaaaaa-0000-4000-8000-000000000002', true, 0,
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'fixture-device-owner', '   '
    );
  exception when others then
    if sqlerrm = 'ACCOUNT_HOLD_REASON_REQUIRED' then caught := true; else raise; end if;
  end;
  if not caught then raise exception '007B blank reason accepted'; end if;

  caught := false;
  begin
    perform * from public.ecoflow_set_account_release_hold_v1(
      'aaaaaaaa-0000-4000-8000-000000000002', true, 0,
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      repeat('x', 129), 'Bounded device test'
    );
  exception when others then
    if sqlerrm = 'ACCOUNT_HOLD_DEVICE_INVALID' then caught := true; else raise; end if;
  end;
  if not caught then raise exception '007B oversized device accepted'; end if;

  caught := false;
  begin
    perform * from public.ecoflow_set_account_release_hold_v1(
      'aaaaaaaa-0000-4000-8000-ffffffffffff', true, 0,
      '99999999-9999-4999-8999-999999999999',
      'fixture-device-owner', 'Unknown store test'
    );
  exception when others then
    if sqlerrm = 'ACCOUNT_HOLD_STORE_NOT_FOUND' then caught := true; else raise; end if;
  end;
  if not caught then raise exception '007B unknown store accepted'; end if;
end
$$;

-- Direct browser DML is impossible even for an authorized Accounts role.
DO $$
declare
  caught boolean := false;
begin
  begin
    insert into public.ecoflow_account_release_holds(store_id, active, revision)
    values ('aaaaaaaa-0000-4000-8000-000000000002', true, 1);
  exception when insufficient_privilege then
    caught := true;
  end;
  if not caught then
    raise exception '007B authenticated direct DML remained available';
  end if;
end
$$;

-- Non-command roles are denied by server authority.
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
DO $$
declare caught boolean := false;
begin
  begin
    perform * from public.ecoflow_read_account_hold_state_v1('aaaaaaaa-0000-4000-8000-000000000001');
  exception when others then
    if sqlerrm = 'ACCOUNT_HOLD_ROLE_FORBIDDEN' then caught := true; else raise; end if;
  end;
  if not caught then raise exception '007B VIEWER was not denied'; end if;
end
$$;

select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
DO $$
declare caught boolean := false;
begin
  begin
    perform * from public.ecoflow_set_account_release_hold_v1(
      'aaaaaaaa-0000-4000-8000-000000000002', true, 0,
      '12121212-1212-4212-8212-121212121212',
      'warehouse-device', 'Warehouse must be denied'
    );
  exception when others then
    if sqlerrm = 'ACCOUNT_HOLD_ROLE_FORBIDDEN' then caught := true; else raise; end if;
  end;
  if not caught then raise exception '007B WAREHOUSE was not denied'; end if;
end
$$;

select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', false);
DO $$
declare caught boolean := false;
begin
  begin
    perform * from public.ecoflow_set_account_release_hold_v1(
      'aaaaaaaa-0000-4000-8000-000000000002', true, 0,
      '13131313-1313-4313-8313-131313131313',
      'driver-device', 'Driver must be denied'
    );
  exception when others then
    if sqlerrm = 'ACCOUNT_HOLD_ROLE_FORBIDDEN' then caught := true; else raise; end if;
  end;
  if not caught then raise exception '007B DRIVER was not denied'; end if;
end
$$;

reset role;

-- anon has no execute privilege on command/read RPCs.
set role anon;
DO $$
declare caught boolean := false;
begin
  begin
    perform * from public.ecoflow_read_account_hold_state_v1('aaaaaaaa-0000-4000-8000-000000000001');
  exception when insufficient_privilege then
    caught := true;
  end;
  if not caught then raise exception '007B anon execute privilege remained available'; end if;
end
$$;
reset role;

DO $$
begin
  if (select count(*) from public.ecoflow_account_hold_commands) <> 3 then
    raise exception '007B expected exactly three accepted command audit rows';
  end if;
  if (
    select revision from public.ecoflow_account_release_holds
    where store_id = 'aaaaaaaa-0000-4000-8000-000000000001'
  ) <> 3 then
    raise exception '007B final revision mismatch';
  end if;
end
$$;

select 'TRANSFORM-007B account hold command contract: PASS' as result;
