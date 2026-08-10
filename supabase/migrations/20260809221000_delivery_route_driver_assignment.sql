-- TRANSFORM-006: make Driver assignment part of route authority.
--
-- A locked route is not just a sequence of stops. It is an office hand-off to
-- one active Driver account. The server derives the Driver label from the team
-- directory, prevents silent reassignment of a locked revision, and allows a
-- DRIVER role to read only the run assigned to auth.uid().

begin;

alter table public.ecoflow_delivery_route_snapshots
  add column if not exists assigned_driver_user_id uuid,
  add column if not exists assigned_driver_label text;

create index if not exists idx_ecoflow_delivery_route_assigned_driver
  on public.ecoflow_delivery_route_snapshots(assigned_driver_user_id,business_day desc,run_code)
  where route_status='LOCKED';

create or replace function public.ecoflow_active_dispatch_driver_label(
  p_user_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
#variable_conflict error
declare
  v_label text;
begin
  if p_user_id is null then raise exception 'DRIVER_ASSIGNMENT_REQUIRED'; end if;
  if to_regclass('public.v_ecoflow_team_members_secure') is null then
    raise exception 'DRIVER_DIRECTORY_UNAVAILABLE';
  end if;

  execute $q$
    select coalesce(nullif(btrim(display_name),''),nullif(btrim(email),''),user_id::text)
    from public.v_ecoflow_team_members_secure
    where user_id=$1
      and upper(coalesce(app_role,''))='DRIVER'
      and upper(coalesce(team_status,''))='ACTIVE'
    limit 1
  $q$ into v_label using p_user_id;

  if nullif(btrim(coalesce(v_label,'')),'') is null then
    raise exception 'ACTIVE_DRIVER_REQUIRED';
  end if;
  return v_label;
end;
$$;

revoke all on function public.ecoflow_active_dispatch_driver_label(uuid) from public,anon,authenticated;

create or replace function public.ecoflow_lock_delivery_route_snapshot_v2(
  p_business_day date,
  p_run_code text,
  p_assigned_driver_user_id uuid,
  p_snapshot jsonb
)
returns table(
  route_snapshot_id uuid,
  business_day date,
  run_code text,
  revision integer,
  snapshot jsonb,
  assigned_driver_user_id uuid,
  assigned_driver_label text,
  approved_by uuid,
  approved_at timestamptz
)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
#variable_conflict error
declare
  v_driver_label text;
  v_locked record;
  v_current_driver uuid;
begin
  if auth.uid() is null or public.ecoflow_active_app_role() not in ('OWNER','ADMIN','ACCOUNT') then
    raise exception using errcode='42501',message='OFFICE_ROUTE_APPROVAL_REQUIRED';
  end if;

  v_driver_label:=public.ecoflow_active_dispatch_driver_label(p_assigned_driver_user_id);

  -- v1 owns all route-shape validation, idempotence and the day/run advisory
  -- lock. Because advisory xact locks survive nested function return, the
  -- assignment check/update below is serialized in the same transaction.
  select * into v_locked
  from public.ecoflow_lock_delivery_route_snapshot(p_business_day,p_run_code,p_snapshot)
  limit 1;

  select r.assigned_driver_user_id into v_current_driver
  from public.ecoflow_delivery_route_snapshots r
  where r.id=v_locked.route_snapshot_id
  for update;

  if v_current_driver is not null and v_current_driver<>p_assigned_driver_user_id then
    raise exception 'ROUTE_ALREADY_LOCKED_DIFFERENT_DRIVER: office must unlock before changing Driver assignment';
  end if;

  update public.ecoflow_delivery_route_snapshots r
  set assigned_driver_user_id=p_assigned_driver_user_id,
      assigned_driver_label=v_driver_label
  where r.id=v_locked.route_snapshot_id
    and (r.assigned_driver_user_id is null or r.assigned_driver_user_id=p_assigned_driver_user_id);

  return query
  select r.id,r.business_day,r.run_code,r.revision,r.snapshot,
    r.assigned_driver_user_id,r.assigned_driver_label,r.approved_by,r.approved_at
  from public.ecoflow_delivery_route_snapshots r
  where r.id=v_locked.route_snapshot_id;
end;
$$;

create or replace function public.ecoflow_get_assigned_delivery_route_snapshot(
  p_business_day date,
  p_run_code text
)
returns table(
  route_snapshot_id uuid,
  business_day date,
  run_code text,
  revision integer,
  snapshot jsonb,
  assigned_driver_user_id uuid,
  assigned_driver_label text,
  approved_by uuid,
  approved_at timestamptz
)
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
#variable_conflict error
declare
  v_run_code text:=upper(btrim(coalesce(p_run_code,'')));
  v_role text;
  v_route public.ecoflow_delivery_route_snapshots%rowtype;
begin
  v_role:=public.ecoflow_active_app_role();
  if auth.uid() is null or v_role not in ('OWNER','ADMIN','ACCOUNT','WAREHOUSE','DRIVER') then
    raise exception using errcode='42501',message='DELIVERY_ROUTE_READ_REQUIRED';
  end if;
  if p_business_day is null then raise exception 'BUSINESS_DAY_REQUIRED'; end if;
  if v_run_code !~ '^[A-Z]+$' then raise exception 'VALID_RUN_CODE_REQUIRED'; end if;

  select r.* into v_route
  from public.ecoflow_delivery_route_snapshots r
  where r.business_day=p_business_day
    and r.run_code=v_run_code
    and r.route_status='LOCKED'
  limit 1;

  if not found then return; end if;

  if v_route.assigned_driver_user_id is null then
    raise exception 'ROUTE_DRIVER_ASSIGNMENT_REQUIRED: office must re-approve this route with an active Driver';
  end if;

  if v_role='DRIVER' and v_route.assigned_driver_user_id<>auth.uid() then
    raise exception using errcode='42501',message='DRIVER_ROUTE_ASSIGNMENT_REQUIRED';
  end if;

  return query
  select v_route.id,v_route.business_day,v_route.run_code,v_route.revision,v_route.snapshot,
    v_route.assigned_driver_user_id,v_route.assigned_driver_label,v_route.approved_by,v_route.approved_at;
end;
$$;

-- Retire the authenticated v1 APIs that could lock or read without assignment.
-- The v2 lock calls v1 internally under SECURITY DEFINER so there remains one
-- route-shape implementation without exposing an assignment bypass to clients.
revoke execute on function public.ecoflow_lock_delivery_route_snapshot(date,text,jsonb) from authenticated;
revoke execute on function public.ecoflow_get_locked_delivery_route_snapshot(date,text) from authenticated;

revoke all on function public.ecoflow_lock_delivery_route_snapshot_v2(date,text,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.ecoflow_get_assigned_delivery_route_snapshot(date,text) from public,anon,authenticated;
grant execute on function public.ecoflow_lock_delivery_route_snapshot_v2(date,text,uuid,jsonb) to authenticated;
grant execute on function public.ecoflow_get_assigned_delivery_route_snapshot(date,text) to authenticated;

comment on column public.ecoflow_delivery_route_snapshots.assigned_driver_user_id is
  'Server-validated ACTIVE DRIVER account assigned by office when this route revision is locked.';
comment on function public.ecoflow_lock_delivery_route_snapshot_v2(date,text,uuid,jsonb) is
  'Assignment-aware office approval boundary. Driver identity is resolved from the secure active team directory and cannot silently change on a locked revision.';
comment on function public.ecoflow_get_assigned_delivery_route_snapshot(date,text) is
  'Assignment-aware route read boundary. DRIVER may read only the active route assigned to auth.uid().';

notify pgrst,'reload schema';
commit;
