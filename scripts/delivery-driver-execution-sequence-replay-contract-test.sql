\set ON_ERROR_STOP on

-- Independent idempotency regression: after a later accepted sequence revision,
-- replaying an older command must return that older command's stop_order and a
-- snapshot rendered from the same order. It must never mix historical revision
-- metadata with the newest route snapshot.

create or replace function pg_temp.replay_route_snapshot(p_run_code text)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'version',1,
    'businessDay','2026-08-11',
    'runCode',p_run_code,
    'routeId','run-'||lower(p_run_code)||'-replay',
    'routeLabel','Run '||p_run_code||' replay',
    'totalCartons',3,
    'readyStops',3,
    'warehousePoint',jsonb_build_object('x',0.08,'y',0.5),
    'geoProjected',false,
    'stops',jsonb_build_array(
      jsonb_build_object('orderId','replay-order-1','stopNumber',1,'boxCode','A','store','Replay One','address','1 Replay Rd','suburb','Adelaide','orderNo','R-1','invoiceNo','RI-1','cartons',1,'eta','09:00','lines','[]'::jsonb,'warehouseReady',true,'orderStatus','STAGED','mapPoint',jsonb_build_object('x',0.3,'y',0.4)),
      jsonb_build_object('orderId','replay-order-2','stopNumber',2,'boxCode','B','store','Replay Two','address','2 Replay Rd','suburb','Adelaide','orderNo','R-2','invoiceNo','RI-2','cartons',1,'eta','09:30','lines','[]'::jsonb,'warehouseReady',true,'orderStatus','STAGED','mapPoint',jsonb_build_object('x',0.5,'y',0.5)),
      jsonb_build_object('orderId','replay-order-3','stopNumber',3,'boxCode','C','store','Replay Three','address','3 Replay Rd','suburb','Adelaide','orderNo','R-3','invoiceNo','RI-3','cartons',1,'eta','10:00','lines','[]'::jsonb,'warehouseReady',true,'orderStatus','STAGED','mapPoint',jsonb_build_object('x',0.7,'y',0.6))
    )
  )
$$;

set app.test_role='ACCOUNT';
set app.test_user_id='33333333-3333-4333-8333-333333333333';

select *
from public.ecoflow_lock_delivery_route_snapshot_v2(
  '2026-08-11','F','11111111-1111-4111-8111-111111111111',pg_temp.replay_route_snapshot('F')
);

set app.test_role='DRIVER';
set app.test_user_id='11111111-1111-4111-8111-111111111111';

do $historical_replay$
declare
  v_first record;
  v_second record;
  v_replay record;
  v_latest record;
begin
  select * into v_first
  from public.ecoflow_reorder_delivery_route_execution(
    '2026-08-11','F',0,'20000000-0000-4000-8000-000000000001',
    array['replay-order-2','replay-order-1','replay-order-3']::text[]
  );
  if v_first.sequence_revision<>1 or v_first.command_status<>'APPLIED' then
    raise exception 'first replay fixture reorder was not applied';
  end if;

  select * into v_second
  from public.ecoflow_reorder_delivery_route_execution(
    '2026-08-11','F',1,'20000000-0000-4000-8000-000000000002',
    array['replay-order-2','replay-order-3','replay-order-1']::text[]
  );
  if v_second.sequence_revision<>2 or v_second.command_status<>'APPLIED' then
    raise exception 'second replay fixture reorder was not applied';
  end if;

  select * into v_latest
  from public.ecoflow_get_delivery_route_execution_sequence('2026-08-11','F');
  if v_latest.sequence_revision<>2 or v_latest.snapshot->'stops'->1->>'orderId'<>'replay-order-3' then
    raise exception 'latest execution authority did not advance to revision 2';
  end if;

  select * into v_replay
  from public.ecoflow_reorder_delivery_route_execution(
    '2026-08-11','F',0,'20000000-0000-4000-8000-000000000001',
    array['replay-order-2','replay-order-1','replay-order-3']::text[]
  );

  if v_replay.command_status<>'REPLAYED' or v_replay.sequence_revision<>1 then
    raise exception 'historical command did not replay its original revision';
  end if;
  if v_replay.stop_order<>array['replay-order-2','replay-order-1','replay-order-3']::text[] then
    raise exception 'historical command replay stop_order drifted';
  end if;
  if v_replay.snapshot->'stops'->0->>'orderId'<>'replay-order-2'
     or v_replay.snapshot->'stops'->1->>'orderId'<>'replay-order-1'
     or v_replay.snapshot->'stops'->2->>'orderId'<>'replay-order-3' then
    raise exception 'historical command replay snapshot mixed in a newer execution sequence';
  end if;
  if v_replay.snapshot->'stops'->0->>'eta'<>'09:00'
     or v_replay.snapshot->'stops'->1->>'eta'<>'09:30'
     or v_replay.snapshot->'stops'->1->>'boxCode'<>'A' then
    raise exception 'historical replay did not preserve positional ETA + immutable dispatch facts';
  end if;

  -- Replaying history must not roll back current authority.
  select * into v_latest
  from public.ecoflow_get_delivery_route_execution_sequence('2026-08-11','F');
  if v_latest.sequence_revision<>2
     or v_latest.stop_order<>array['replay-order-2','replay-order-3','replay-order-1']::text[] then
    raise exception 'historical replay mutated latest sequence authority';
  end if;
end;
$historical_replay$;

reset app.test_role;
reset app.test_user_id;
