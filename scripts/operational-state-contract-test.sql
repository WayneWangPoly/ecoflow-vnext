\set ON_ERROR_STOP on

insert into auth.users(id,email) values
 ('22222222-2222-2222-2222-222222222222','driver@example.test'),
 ('33333333-3333-3333-3333-333333333333','warehouse@example.test'),
 ('44444444-4444-4444-4444-444444444444','account@example.test')
on conflict(id) do nothing;
insert into public.app_user_profiles(user_id,app_role,is_active,team_status) values
 ('22222222-2222-2222-2222-222222222222','DRIVER',true,'ACTIVE'),
 ('33333333-3333-3333-3333-333333333333','WAREHOUSE',true,'ACTIVE'),
 ('44444444-4444-4444-4444-444444444444','ACCOUNT',true,'ACTIVE')
on conflict(user_id) do update set app_role=excluded.app_role,is_active=true,team_status='ACTIVE';

-- Driver may update route execution, but not office route approval.
set role authenticated;
select set_config('request.jwt.claim.role','authenticated',false);
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
insert into public.ecoflow_day_state(business_day,scope,payload,updated_by)
values ('2026-07-11','shift','{"events":[]}','Driver'),
       ('2026-07-11','run:A:stop:O-1','{"status":"ARRIVED"}','Driver');
DO $$ begin
  begin
    insert into public.ecoflow_day_state(business_day,scope,payload,updated_by)
    values ('2026-07-11','run:A:meta','{"lockedAt":"x"}','Driver');
    raise exception 'driver was allowed to lock route';
  exception when insufficient_privilege then null; end;
end $$;

-- Warehouse may write task/stage but not driver route.
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
insert into public.ecoflow_day_state(business_day,scope,payload,updated_by)
values ('2026-07-11','run:A:task:SKU-1','{"status":"PICKED"}','Warehouse'),
       ('2026-07-11','run:A:stage:O-1','{"stagedAt":"2026-07-11T01:00:00Z"}','Warehouse');
DO $$ begin
  begin
    insert into public.ecoflow_day_state(business_day,scope,payload,updated_by)
    values ('2026-07-11','run:A:route','{"startedAt":"x"}','Warehouse');
    raise exception 'warehouse was allowed to start route';
  exception when insufficient_privilege then null; end;
end $$;

-- Account/office owns run control, release and route lock.
select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);
insert into public.ecoflow_day_state(business_day,scope,payload,updated_by)
values ('2026-07-11','run-control','{"activeRunCode":"B"}','Accounts'),
       ('2026-07-11','run:B:meta','{"lockedAt":"2026-07-11T02:00:00Z","stopOrder":["O-2"],"boxCodes":{"O-2":"A"}}','Accounts'),
       ('2026-07-11','run:B:release:O-2','{"releasedAt":"2026-07-11T02:00:00Z"}','Accounts');
DO $$ begin
  begin
    insert into public.ecoflow_day_state(business_day,scope,payload,updated_by)
    values ('2026-07-11','run:B:stop:O-2','{"status":"DELIVERED"}','Accounts');
    raise exception 'account was allowed to write driver stop state';
  exception when insufficient_privilege then null; end;
end $$;

DO $$ declare v_run text; v_locked text; begin
  select run_code,locked_at into v_run,v_locked from public.v_ecoflow_pick_handoff_meta where business_day='2026-07-11';
  if v_run<>'B' or v_locked is null then raise exception 'active Run B projection failed: %, %',v_run,v_locked; end if;
end $$;

-- Both POD proof types are accepted; the bucket is private.
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
insert into public.ecoflow_delivery_pod_proofs(business_day,order_id,proof_type,photo_path,captured_by)
values ('2026-07-11','O-2','POD1_DROP_POINT','2026-07-11/O-2/pod1.jpg','Driver'),
       ('2026-07-11','O-2','POD2_GOODS_PLACED','2026-07-11/O-2/pod2.jpg','Driver');
DO $$ declare v_count integer; v_public boolean; begin
  select count(*) into v_count from public.ecoflow_delivery_pod_proofs where order_id='O-2';
  if v_count<>2 then raise exception 'two typed POD proofs were not accepted'; end if;
  select public into v_public from storage.buckets where id='pod-photos';
  if v_public then raise exception 'POD bucket remained public'; end if;
end $$;

reset role;
select 'operational state auth and multi-run contract passed' as result;
