\set ON_ERROR_STOP on

create or replace function pg_temp.execution_route_snapshot(p_run_code text,p_order_id text)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'version',1,
    'businessDay','2026-08-10',
    'runCode',p_run_code,
    'routeId','execution-'||lower(p_run_code),
    'routeLabel','Run '||p_run_code,
    'totalCartons',1,
    'readyStops',1,
    'warehousePoint',jsonb_build_object('x',0.08,'y',0.5),
    'geoProjected',false,
    'stops',jsonb_build_array(
      jsonb_build_object(
        'orderId',p_order_id,'stopNumber',1,'boxCode','A','store','Execution Cafe '||p_run_code,
        'address','10 King William Street, Adelaide SA 5000','suburb','Adelaide',
        'orderNo','ORD-'||p_run_code,'invoiceNo','INV-'||p_run_code,
        'cartons',1,'eta','10:00','lines',jsonb_build_array(
          jsonb_build_object('sku','CUP-12W','name','12oz Cup','qty',1,'unit','carton','location','A1')
        ),
        'warehouseReady',true,'orderStatus','STAGED','mapPoint',jsonb_build_object('x',0.4,'y',0.4)
      )
    )
  )
$$;

create or replace function pg_temp.command_batch(
  p_command_id uuid,
  p_scope text,
  p_expected_revision bigint,
  p_payload jsonb
)
returns jsonb
language sql
as $$
  select jsonb_build_array(jsonb_build_object(
    'commandId',p_command_id,
    'scope',p_scope,
    'expectedRevision',p_expected_revision,
    'payload',p_payload
  ))
$$;

-- Establish one dedicated run for Driver A and make it the active sequential run.
set app.test_role='ACCOUNT';
set app.test_user_id='33333333-3333-4333-8333-333333333333';

do $verify$
declare
  v_route uuid;
  v_status text;
begin
  select route_snapshot_id into v_route
  from public.ecoflow_lock_delivery_route_snapshot_v2(
    '2026-08-10','C','11111111-1111-4111-8111-111111111111',
    pg_temp.execution_route_snapshot('C','order-c')
  );
  if v_route is null then raise exception 'Driver A execution route C was not locked'; end if;

  select command_status into v_status
  from public.ecoflow_apply_day_state_commands(
    '2026-08-10',
    pg_temp.command_batch(
      '90000000-0000-4000-8000-000000000001','run-control',0,
      jsonb_build_object('activeRunCode','C')
    ),
    'Accounts User'
  );
  if v_status<>'APPLIED' then raise exception 'active Run C control was not applied'; end if;
end;
$verify$;

-- Driver A may mutate only assigned Run C. CAS/idempotency semantics are preserved.
set app.test_role='DRIVER';
set app.test_user_id='11111111-1111-4111-8111-111111111111';

do $verify$
declare
  v_status text;
  v_revision bigint;
  v_cross_run_denied boolean:=false;
  v_cross_stage_denied boolean:=false;
begin
  select command_status,revision into v_status,v_revision
  from public.ecoflow_apply_day_state_commands(
    '2026-08-10',
    pg_temp.command_batch(
      '90000000-0000-4000-8000-000000000010','run:C:stop:order-c',0,
      jsonb_build_object('status','ARRIVED','arrivedAt','2026-08-10T09:00:00+09:30')
    ),
    'Driver A'
  );
  if v_status<>'APPLIED' or v_revision<>1 then raise exception 'assigned Driver stop write did not apply revision 1'; end if;

  select command_status,revision into v_status,v_revision
  from public.ecoflow_apply_day_state_commands(
    '2026-08-10',
    pg_temp.command_batch(
      '90000000-0000-4000-8000-000000000010','run:C:stop:order-c',0,
      jsonb_build_object('status','ARRIVED','arrivedAt','2026-08-10T09:00:00+09:30')
    ),
    'Driver A'
  );
  if v_status<>'REPLAYED' or v_revision<>1 then raise exception 'assignment gate broke idempotent command replay'; end if;

  select command_status,revision into v_status,v_revision
  from public.ecoflow_apply_day_state_commands(
    '2026-08-10',
    pg_temp.command_batch(
      '90000000-0000-4000-8000-000000000011','run:C:stop:order-c',0,
      jsonb_build_object('status','DELIVERED')
    ),
    'Driver A'
  );
  if v_status<>'CONFLICT' or v_revision<>1 then raise exception 'assignment gate broke stale-revision conflict behavior'; end if;

  select command_status into v_status
  from public.ecoflow_apply_day_state_commands(
    '2026-08-10',
    pg_temp.command_batch(
      '90000000-0000-4000-8000-000000000012','run:C:route',0,
      jsonb_build_object('startedAt','2026-08-10T09:01:00+09:30','endedAt',null)
    ),
    'Driver A'
  );
  if v_status<>'APPLIED' then raise exception 'assigned Driver route write was rejected'; end if;

  select command_status into v_status
  from public.ecoflow_apply_day_state_commands(
    '2026-08-10',
    pg_temp.command_batch(
      '90000000-0000-4000-8000-000000000013','run:C:stage:order-c',0,
      jsonb_build_object('stagedAt','2026-08-10T08:55:00+09:30')
    ),
    'Driver A'
  );
  if v_status<>'APPLIED' then raise exception 'assigned Driver existing pick/stage capability regressed'; end if;

  select command_status into v_status
  from public.ecoflow_apply_day_state_commands(
    '2026-08-10',
    pg_temp.command_batch(
      '90000000-0000-4000-8000-000000000014','shift',0,
      jsonb_build_object('events',jsonb_build_array(jsonb_build_object('type','CLOCK_IN','at','2026-08-10T08:50:00+09:30')))
    ),
    'Driver A'
  );
  if v_status<>'APPLIED' then raise exception 'active assigned Driver shift write was rejected'; end if;

  begin
    perform * from public.ecoflow_apply_day_state_commands(
      '2026-08-10',
      pg_temp.command_batch(
        '90000000-0000-4000-8000-000000000015','run:B:stop:order-1',0,
        jsonb_build_object('status','ARRIVED')
      ),
      'Driver A'
    );
  exception when sqlstate '42501' then v_cross_run_denied:=true;
  end;
  if not v_cross_run_denied then raise exception 'Driver A wrote Driver B run stop state'; end if;

  begin
    perform * from public.ecoflow_apply_day_state_commands(
      '2026-08-10',
      pg_temp.command_batch(
        '90000000-0000-4000-8000-000000000016','run:B:stage:order-1',0,
        jsonb_build_object('stagedAt','2026-08-10T09:05:00+09:30')
      ),
      'Driver A'
    );
  exception when sqlstate '42501' then v_cross_stage_denied:=true;
  end;
  if not v_cross_stage_denied then raise exception 'Driver A wrote Driver B warehouse/pick scope through DRIVER permission'; end if;
end;
$verify$;

-- Driver B has the inverse run boundary and cannot use the global shift scope while Run C is active.
set app.test_user_id='22222222-2222-4222-8222-222222222222';

do $verify$
declare
  v_status text;
  v_cross_run_denied boolean:=false;
  v_shift_denied boolean:=false;
begin
  select command_status into v_status
  from public.ecoflow_apply_day_state_commands(
    '2026-08-10',
    pg_temp.command_batch(
      '90000000-0000-4000-8000-000000000020','run:B:stop:order-1',0,
      jsonb_build_object('status','ARRIVED')
    ),
    'Driver B'
  );
  if v_status<>'APPLIED' then raise exception 'Driver B could not write assigned Run B'; end if;

  begin
    perform * from public.ecoflow_apply_day_state_commands(
      '2026-08-10',
      pg_temp.command_batch(
        '90000000-0000-4000-8000-000000000021','run:C:stop:order-c',1,
        jsonb_build_object('status','DELIVERED')
      ),
      'Driver B'
    );
  exception when sqlstate '42501' then v_cross_run_denied:=true;
  end;
  if not v_cross_run_denied then raise exception 'Driver B wrote Driver A Run C'; end if;

  begin
    perform * from public.ecoflow_apply_day_state_commands(
      '2026-08-10',
      pg_temp.command_batch(
        '90000000-0000-4000-8000-000000000022','shift',1,
        jsonb_build_object('events',jsonb_build_array(jsonb_build_object('type','CLOCK_IN','at','2026-08-10T09:10:00+09:30')))
      ),
      'Driver B'
    );
  exception when sqlstate '42501' then v_shift_denied:=true;
  end;
  if not v_shift_denied then raise exception 'Driver B wrote global shift state while another Driver run was active'; end if;
end;
$verify$;

-- Existing role policy and primitive encapsulation remain intact.
set app.test_role='ACCOUNT';
set app.test_user_id='33333333-3333-4333-8333-333333333333';

do $verify$
declare
  v_role_denied boolean:=false;
begin
  begin
    perform * from public.ecoflow_apply_day_state_commands(
      '2026-08-10',
      pg_temp.command_batch(
        '90000000-0000-4000-8000-000000000030','run:C:stop:order-c',1,
        jsonb_build_object('status','DELIVERED')
      ),
      'Accounts User'
    );
  exception when others then
    if position('DAY_STATE_SCOPE_WRITE_FORBIDDEN' in sqlerrm)>0 then v_role_denied:=true; else raise; end if;
  end;
  if not v_role_denied then raise exception 'assignment wrapper accidentally broadened ACCOUNT stop-write permission'; end if;

  if has_function_privilege(
    'authenticated',
    'public.ecoflow_apply_day_state_commands_pre_driver_assignment_20260809(date,jsonb,text)',
    'EXECUTE'
  ) then raise exception 'authenticated retained direct execution of pre-assignment command primitive'; end if;

  if has_table_privilege('authenticated','public.ecoflow_day_state','INSERT') then
    raise exception 'authenticated regained direct day-state INSERT';
  end if;
  if has_table_privilege('authenticated','public.ecoflow_day_state','UPDATE') then
    raise exception 'authenticated regained direct day-state UPDATE';
  end if;
end;
$verify$;

reset app.test_role;
reset app.test_user_id;
