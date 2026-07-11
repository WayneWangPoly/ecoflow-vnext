\set ON_ERROR_STOP on

insert into auth.users(id,email)
values
  ('22222222-2222-2222-2222-222222222222','warehouse.one@example.test'),
  ('33333333-3333-3333-3333-333333333333','warehouse.two@example.test')
on conflict (id) do nothing;

insert into public.app_user_profiles(user_id,app_role,is_active,team_status)
values
  ('22222222-2222-2222-2222-222222222222','WAREHOUSE',true,'ACTIVE'),
  ('33333333-3333-3333-3333-333333333333','WAREHOUSE',true,'ACTIVE')
on conflict (user_id) do update
set app_role=excluded.app_role,is_active=true,team_status='ACTIVE';

do $$
declare
  v_day date := (now() at time zone 'Australia/Adelaide')::date;
  v_blocked boolean;
  v_count integer;
  v_status text;
begin
  perform set_config('request.jwt.claim.role','authenticated',false);
  perform set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);

  select c.claim_status into v_status
  from public.ecoflow_claim_pick_task(v_day,'CUP-12W','Warehouse One',30) c;
  if v_status <> 'CLAIMED' then raise exception 'first claim status %, expected CLAIMED',v_status; end if;

  perform * from public.ecoflow_record_pick_movement('CUP-12W',1,'carton','930000000001','claim owner pick');

  perform set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);

  v_blocked := false;
  begin
    perform * from public.ecoflow_record_pick_movement('CUP-12W',1,'carton','930000000001','unclaimed pick');
  exception when others then
    if position('PICK_TASK_CLAIM_REQUIRED' in sqlerrm)>0 then v_blocked := true; else raise; end if;
  end;
  if not v_blocked then raise exception 'stock deduction was allowed without this user owning the task'; end if;

  v_blocked := false;
  begin
    perform * from public.ecoflow_claim_pick_task(v_day,'CUP-12W','Warehouse Two',30);
  exception when others then
    if position('TASK_ALREADY_CLAIMED_BY' in sqlerrm)>0 then v_blocked := true; else raise; end if;
  end;
  if not v_blocked then raise exception 'second operator took an active claim'; end if;

  v_blocked := false;
  begin
    perform * from public.ecoflow_release_pick_task(v_day,'CUP-12W','not my task');
  exception when others then
    if position('TASK_RELEASE_NOT_ALLOWED' in sqlerrm)>0 then v_blocked := true; else raise; end if;
  end;
  if not v_blocked then raise exception 'non-owner released another operator claim'; end if;

  perform set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
  perform * from public.ecoflow_release_pick_task(v_day,'CUP-12W','handoff');

  perform set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
  select c.claim_status into v_status
  from public.ecoflow_claim_pick_task(v_day,'CUP-12W','Warehouse Two',30) c;
  if v_status <> 'CLAIMED' then raise exception 'handoff claim status %, expected CLAIMED',v_status; end if;

  perform * from public.ecoflow_record_pick_movement('CUP-12W',1,'carton','930000000001','new owner pick');

  update public.ecoflow_pick_task_claims
  set expires_at = now() - interval '1 minute'
  where business_day=v_day and task_key='CUP-12W';

  perform set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
  select c.claim_status into v_status
  from public.ecoflow_claim_pick_task(v_day,'CUP-12W','Warehouse One',30) c;
  if v_status <> 'TAKEN_OVER' then raise exception 'expired claim status %, expected TAKEN_OVER',v_status; end if;

  select count(*) into v_count
  from public.ecoflow_pick_task_claim_audit a
  where a.business_day=v_day and a.task_key='CUP-12W';
  if v_count < 4 then raise exception 'claim audit has only % rows',v_count; end if;
end;
$$;

select 'pick task claim contract passed' as result;
