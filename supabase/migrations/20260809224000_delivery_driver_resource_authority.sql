-- TRANSFORM-006: resource-authoritative Driver operations.
--
-- Role checks alone are insufficient for delivery execution. A DRIVER may act
-- only on the LOCKED route assigned to auth.uid(), and order-scoped mutations
-- must target an order contained in that exact approved snapshot.
--
-- This forward migration keeps the proven historical primitives intact behind
-- private wrappers while tightening exception, notification, POD, location,
-- departure and shared-state read boundaries around the same route authority.

begin;

-- Resolve legacy and canonical route references onto one active route row.
-- Supported references: route snapshot UUID, snapshot.routeId, run code, and the
-- long-lived RUN-YYYYMMDD-X business route id used by DriverDepartureControl.
create or replace function public.ecoflow_authorize_delivery_resource(
  p_business_day date,
  p_route_reference text default null,
  p_order_id text default null
)
returns table(
  route_snapshot_id uuid,
  run_code text,
  assigned_driver_user_id uuid,
  assigned_driver_label text,
  snapshot jsonb
)
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
#variable_conflict error
declare
  v_role text:=public.ecoflow_active_app_role();
  v_ref text:=nullif(btrim(coalesce(p_route_reference,'')),'');
  v_order_id text:=nullif(btrim(coalesce(p_order_id,'')),'');
  v_route public.ecoflow_delivery_route_snapshots%rowtype;
  v_count integer:=0;
begin
  if auth.uid() is null or v_role not in ('OWNER','ADMIN','ACCOUNT','WAREHOUSE','DRIVER') then
    raise exception using errcode='42501',message='ACTIVE_DELIVERY_ROLE_REQUIRED';
  end if;
  if p_business_day is null then raise exception 'BUSINESS_DAY_REQUIRED'; end if;
  if v_ref is null and v_order_id is null then raise exception 'DELIVERY_RESOURCE_REFERENCE_REQUIRED'; end if;

  select count(*) into v_count
  from public.ecoflow_delivery_route_snapshots r
  where r.business_day=p_business_day
    and r.route_status='LOCKED'
    and (
      v_ref is null
      or r.id::text=v_ref
      or upper(r.run_code)=upper(v_ref)
      or coalesce(r.snapshot->>'routeId','')=v_ref
      or upper(v_ref)=('RUN-'||to_char(p_business_day,'YYYYMMDD')||'-'||r.run_code)
    )
    and (
      v_order_id is null
      or exists(
        select 1 from jsonb_array_elements(r.snapshot->'stops') s
        where nullif(btrim(coalesce(s->>'orderId','')),'')=v_order_id
      )
    );

  if v_count=0 then
    if v_role='DRIVER' then
      raise exception using errcode='42501',message='DRIVER_DELIVERY_RESOURCE_NOT_ASSIGNED_OR_NOT_FOUND';
    end if;
    raise exception 'LOCKED_DELIVERY_RESOURCE_NOT_FOUND';
  end if;
  if v_count<>1 then raise exception 'DELIVERY_RESOURCE_AMBIGUOUS'; end if;

  select r.* into strict v_route
  from public.ecoflow_delivery_route_snapshots r
  where r.business_day=p_business_day
    and r.route_status='LOCKED'
    and (
      v_ref is null
      or r.id::text=v_ref
      or upper(r.run_code)=upper(v_ref)
      or coalesce(r.snapshot->>'routeId','')=v_ref
      or upper(v_ref)=('RUN-'||to_char(p_business_day,'YYYYMMDD')||'-'||r.run_code)
    )
    and (
      v_order_id is null
      or exists(
        select 1 from jsonb_array_elements(r.snapshot->'stops') s
        where nullif(btrim(coalesce(s->>'orderId','')),'')=v_order_id
      )
    )
  limit 1;

  if v_route.assigned_driver_user_id is null then
    raise exception 'ROUTE_DRIVER_ASSIGNMENT_REQUIRED';
  end if;
  if v_role='DRIVER' and v_route.assigned_driver_user_id<>auth.uid() then
    raise exception using errcode='42501',message='DRIVER_DELIVERY_RESOURCE_ASSIGNMENT_REQUIRED';
  end if;

  return query select v_route.id,v_route.run_code,v_route.assigned_driver_user_id,
    v_route.assigned_driver_label,v_route.snapshot;
end;
$$;

revoke all on function public.ecoflow_authorize_delivery_resource(date,text,text)
  from public,anon,authenticated;
grant execute on function public.ecoflow_authorize_delivery_resource(date,text,text)
  to authenticated;

create or replace function public.ecoflow_delivery_resource_write_allowed(
  p_business_day date,
  p_order_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
declare
  v_role text:=public.ecoflow_active_app_role();
  v_dummy uuid;
begin
  if v_role not in ('OWNER','ADMIN','DRIVER') then return false; end if;
  select route_snapshot_id into v_dummy
  from public.ecoflow_authorize_delivery_resource(p_business_day,null,p_order_id)
  limit 1;
  return v_dummy is not null;
exception when others then
  return false;
end;
$$;

revoke all on function public.ecoflow_delivery_resource_write_allowed(date,text)
  from public,anon,authenticated;
grant execute on function public.ecoflow_delivery_resource_write_allowed(date,text)
  to authenticated;

create or replace function public.ecoflow_delivery_resource_read_allowed(
  p_business_day date,
  p_order_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
declare
  v_role text:=public.ecoflow_active_app_role();
  v_dummy uuid;
begin
  if v_role is null then return false; end if;
  if v_role<>'DRIVER' then return true; end if;
  select route_snapshot_id into v_dummy
  from public.ecoflow_authorize_delivery_resource(p_business_day,null,p_order_id)
  limit 1;
  return v_dummy is not null;
exception when others then
  return false;
end;
$$;

revoke all on function public.ecoflow_delivery_resource_read_allowed(date,text)
  from public,anon,authenticated;
grant execute on function public.ecoflow_delivery_resource_read_allowed(date,text)
  to authenticated;

create or replace function public.ecoflow_resolve_assigned_delivery_order_by_box(
  p_business_day date,
  p_box_code text
)
returns text
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
#variable_conflict error
declare
  v_role text:=public.ecoflow_active_app_role();
  v_box text:=upper(nullif(btrim(coalesce(p_box_code,'')),''));
  v_order_id text;
  v_count integer;
begin
  if auth.uid() is null or v_role not in ('OWNER','ADMIN','DRIVER') then
    raise exception using errcode='42501',message='DELIVERY_EXECUTION_ROLE_REQUIRED';
  end if;
  if p_business_day is null then raise exception 'BUSINESS_DAY_REQUIRED'; end if;
  if v_box is null then raise exception 'BOX_CODE_REQUIRED'; end if;

  select count(*),min(s->>'orderId') into v_count,v_order_id
  from public.ecoflow_delivery_route_snapshots r
  cross join lateral jsonb_array_elements(r.snapshot->'stops') s
  where r.business_day=p_business_day
    and r.route_status='LOCKED'
    and upper(coalesce(s->>'boxCode',''))=v_box
    and (v_role<>'DRIVER' or r.assigned_driver_user_id=auth.uid());

  if v_count=0 then
    raise exception using errcode='42501',message='ASSIGNED_DELIVERY_BOX_NOT_FOUND';
  end if;
  if v_count<>1 then raise exception 'DELIVERY_BOX_AMBIGUOUS'; end if;
  return v_order_id;
end;
$$;

revoke all on function public.ecoflow_resolve_assigned_delivery_order_by_box(date,text)
  from public,anon,authenticated;
grant execute on function public.ecoflow_resolve_assigned_delivery_order_by_box(date,text)
  to authenticated;

-- Shared-state reads: office/warehouse behaviour is unchanged, but DRIVER may
-- see only its assigned run plus run-control/shift when that active run belongs
-- to the same Driver. This closes direct REST/RPC read bypasses around DriverApp.
create or replace function public.ecoflow_can_read_day_scope(
  p_business_day date,
  p_scope text,
  p_payload jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
declare
  v_role text:=public.ecoflow_active_app_role();
  v_scope text:=nullif(btrim(coalesce(p_scope,'')),'');
  v_run_code text;
  v_active_run text;
begin
  if auth.uid() is null or v_role is null or p_business_day is null or v_scope is null then return false; end if;
  if v_role<>'DRIVER' then return true; end if;

  if v_scope ~ '^run:[A-Z]+:' then
    v_run_code:=split_part(v_scope,':',2);
  elsif v_scope='run-control' then
    v_run_code:=upper(nullif(btrim(coalesce(p_payload->>'activeRunCode','')),''));
  elsif v_scope='shift' then
    select upper(nullif(btrim(coalesce(d.payload->>'activeRunCode','')),''))
      into v_active_run
    from public.ecoflow_day_state d
    where d.business_day=p_business_day and d.scope='run-control'
    limit 1;
    v_run_code:=v_active_run;
  else
    return false;
  end if;

  if v_run_code is null then return false; end if;
  return exists(
    select 1 from public.ecoflow_delivery_route_snapshots r
    where r.business_day=p_business_day
      and r.run_code=v_run_code
      and r.route_status='LOCKED'
      and r.assigned_driver_user_id=auth.uid()
  );
end;
$$;

revoke all on function public.ecoflow_can_read_day_scope(date,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.ecoflow_can_read_day_scope(date,text,jsonb)
  to authenticated;

drop policy if exists ecoflow_day_state_active_read on public.ecoflow_day_state;
create policy ecoflow_day_state_active_read
on public.ecoflow_day_state for select to authenticated
using(public.ecoflow_can_read_day_scope(business_day,scope,payload));

create or replace function public.ecoflow_read_day_state(
  p_business_day date,
  p_after_change_seq bigint default 0,
  p_limit integer default 500
)
returns table(
  business_day date,
  scope text,
  payload jsonb,
  updated_by text,
  updated_at timestamptz,
  change_seq bigint,
  revision bigint
)
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
begin
  if auth.uid() is null or public.ecoflow_active_app_role() is null then
    raise exception using errcode='42501',message='ACTIVE_AUTHENTICATED_ROLE_REQUIRED';
  end if;
  return query
  select d.business_day,d.scope,d.payload,d.updated_by,d.updated_at,d.change_seq,d.revision
  from public.ecoflow_day_state d
  where d.business_day=p_business_day
    and d.change_seq>greatest(coalesce(p_after_change_seq,0),0)
    and public.ecoflow_can_read_day_scope(d.business_day,d.scope,d.payload)
  order by d.change_seq asc
  limit greatest(1,least(coalesce(p_limit,500),500));
end;
$$;

create or replace function public.ecoflow_read_day_state_scope(
  p_business_day date,
  p_scope text
)
returns table(
  business_day date,
  scope text,
  payload jsonb,
  updated_by text,
  updated_at timestamptz,
  change_seq bigint,
  revision bigint
)
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
begin
  if auth.uid() is null or public.ecoflow_active_app_role() is null then
    raise exception using errcode='42501',message='ACTIVE_AUTHENTICATED_ROLE_REQUIRED';
  end if;
  return query
  select d.business_day,d.scope,d.payload,d.updated_by,d.updated_at,d.change_seq,d.revision
  from public.ecoflow_day_state d
  where d.business_day=p_business_day
    and d.scope=nullif(btrim(coalesce(p_scope,'')),'')
    and public.ecoflow_can_read_day_scope(d.business_day,d.scope,d.payload)
  limit 1;
end;
$$;

revoke all on function public.ecoflow_read_day_state(date,bigint,integer) from public,anon,authenticated;
revoke all on function public.ecoflow_read_day_state_scope(date,text) from public,anon,authenticated;
grant execute on function public.ecoflow_read_day_state(date,bigint,integer) to authenticated;
grant execute on function public.ecoflow_read_day_state_scope(date,text) to authenticated;

-- POD rows are delivery resources, not generic Driver-writable evidence.
drop policy if exists ecoflow_pod_proofs_active_read on public.ecoflow_delivery_pod_proofs;
drop policy if exists ecoflow_pod_proofs_driver_write on public.ecoflow_delivery_pod_proofs;
drop policy if exists ecoflow_pod_proofs_driver_update on public.ecoflow_delivery_pod_proofs;
create policy ecoflow_pod_proofs_resource_read
on public.ecoflow_delivery_pod_proofs for select to authenticated
using(
  business_day ~ '^\d{4}-\d{2}-\d{2}$'
  and public.ecoflow_delivery_resource_read_allowed(business_day::date,order_id)
);
create policy ecoflow_pod_proofs_resource_insert
on public.ecoflow_delivery_pod_proofs for insert to authenticated
with check(
  business_day ~ '^\d{4}-\d{2}-\d{2}$'
  and public.ecoflow_delivery_resource_write_allowed(business_day::date,order_id)
);
create policy ecoflow_pod_proofs_resource_update
on public.ecoflow_delivery_pod_proofs for update to authenticated
using(
  business_day ~ '^\d{4}-\d{2}-\d{2}$'
  and public.ecoflow_delivery_resource_write_allowed(business_day::date,order_id)
)
with check(
  business_day ~ '^\d{4}-\d{2}-\d{2}$'
  and public.ecoflow_delivery_resource_write_allowed(business_day::date,order_id)
);

create or replace function public.ecoflow_can_write_assigned_pod_path(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
declare
  v_day_text text:=split_part(coalesce(p_name,''),'/',1);
  v_order_id text:=nullif(split_part(coalesce(p_name,''),'/',2),'');
begin
  if v_day_text !~ '^\d{4}-\d{2}-\d{2}$' or v_order_id is null then return false; end if;
  return public.ecoflow_delivery_resource_write_allowed(v_day_text::date,v_order_id);
exception when others then return false;
end;
$$;

create or replace function public.ecoflow_can_read_assigned_pod_path(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
declare
  v_day_text text:=split_part(coalesce(p_name,''),'/',1);
  v_order_id text:=nullif(split_part(coalesce(p_name,''),'/',2),'');
begin
  if v_day_text !~ '^\d{4}-\d{2}-\d{2}$' or v_order_id is null then return false; end if;
  return public.ecoflow_delivery_resource_read_allowed(v_day_text::date,v_order_id);
exception when others then return false;
end;
$$;

revoke all on function public.ecoflow_can_write_assigned_pod_path(text) from public,anon,authenticated;
revoke all on function public.ecoflow_can_read_assigned_pod_path(text) from public,anon,authenticated;
grant execute on function public.ecoflow_can_write_assigned_pod_path(text) to authenticated;
grant execute on function public.ecoflow_can_read_assigned_pod_path(text) to authenticated;

drop policy if exists ecoflow_pod_private_read on storage.objects;
drop policy if exists ecoflow_pod_private_insert on storage.objects;
drop policy if exists ecoflow_pod_private_update on storage.objects;
create policy ecoflow_pod_private_read on storage.objects for select to authenticated
using(bucket_id='pod-photos' and public.ecoflow_can_read_assigned_pod_path(name));
create policy ecoflow_pod_private_insert on storage.objects for insert to authenticated
with check(bucket_id='pod-photos' and public.ecoflow_can_write_assigned_pod_path(name));
create policy ecoflow_pod_private_update on storage.objects for update to authenticated
using(bucket_id='pod-photos' and public.ecoflow_can_write_assigned_pod_path(name))
with check(bucket_id='pod-photos' and public.ecoflow_can_write_assigned_pod_path(name));

-- Queue primitive: keep message/idempotency mechanics, but take identity,
-- recipient and POD resource facts from the approved stop rather than caller text.
alter function public.ecoflow_queue_delivery_notifications(
  text,text,text,text,integer,text,text,text,text,text,text,text,text,text
) rename to ecoflow_queue_delivery_notifications_pre_resource_authority_20260809;
revoke all on function public.ecoflow_queue_delivery_notifications_pre_resource_authority_20260809(
  text,text,text,text,integer,text,text,text,text,text,text,text,text,text
) from public,anon,authenticated;

create or replace function public.ecoflow_queue_delivery_notifications(
  p_event_key text,
  p_business_day text,
  p_order_id text,
  p_order_number text default null,
  p_stop_number integer default null,
  p_box_code text default null,
  p_store_name text default null,
  p_outcome text default 'DELIVERED',
  p_store_email text default null,
  p_store_phone text default null,
  p_pod1_path text default null,
  p_pod2_path text default null,
  p_internal_detail text default null,
  p_queued_by text default null
)
returns table(notification_id uuid,audience text,channel text,notification_status text)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
#variable_conflict error
declare
  v_day date;
  v_role text:=public.ecoflow_active_app_role();
  v_snapshot jsonb;
  v_stop jsonb;
  v_order_number text;
  v_stop_number integer;
  v_box_code text;
  v_store_name text;
  v_store_email text;
  v_store_phone text;
  v_contact_count integer:=0;
begin
  if auth.uid() is null or v_role not in ('OWNER','ADMIN','DRIVER') then
    raise exception using errcode='42501',message='DELIVERY_NOTIFICATION_ROLE_REQUIRED';
  end if;
  begin v_day:=p_business_day::date; exception when others then raise exception 'VALID_BUSINESS_DAY_REQUIRED'; end;

  select a.snapshot into v_snapshot
  from public.ecoflow_authorize_delivery_resource(v_day,null,p_order_id) a
  limit 1;
  select s into v_stop from jsonb_array_elements(v_snapshot->'stops') s where s->>'orderId'=p_order_id limit 1;
  if v_stop is null then raise exception 'AUTHORIZED_DELIVERY_STOP_NOT_FOUND'; end if;

  v_order_number:=nullif(btrim(coalesce(v_stop->>'orderNo','')),'');
  v_stop_number:=case when coalesce(v_stop->>'stopNumber','')~'^[0-9]+$' then (v_stop->>'stopNumber')::integer else null end;
  v_box_code:=nullif(btrim(coalesce(v_stop->>'boxCode','')),'');
  v_store_name:=nullif(btrim(coalesce(v_stop->>'store','')),'');
  v_store_phone:=nullif(btrim(coalesce(v_stop->>'phone','')),'');

  if to_regclass('public.ecoflow_delivery_notification_contacts') is not null and v_store_name is not null then
    select count(*),min(c.contact_email)
      into v_contact_count,v_store_email
    from public.ecoflow_delivery_notification_contacts c
    where c.enabled=true
      and upper(btrim(coalesce(c.store_name,'')))=upper(v_store_name)
      and nullif(btrim(coalesce(c.contact_email,'')),'') is not null;
    if v_contact_count<>1 then v_store_email:=null; end if;
  end if;

  if p_pod1_path is not null and p_pod1_path not like (p_business_day||'/'||p_order_id||'/%') then
    raise exception 'POD1_RESOURCE_PATH_MISMATCH';
  end if;
  if p_pod2_path is not null and p_pod2_path not like (p_business_day||'/'||p_order_id||'/%') then
    raise exception 'POD2_RESOURCE_PATH_MISMATCH';
  end if;

  return query
  select q.notification_id,q.audience,q.channel,q.notification_status
  from public.ecoflow_queue_delivery_notifications_pre_resource_authority_20260809(
    p_event_key,p_business_day,p_order_id,v_order_number,v_stop_number,v_box_code,v_store_name,
    p_outcome,v_store_email,v_store_phone,p_pod1_path,p_pod2_path,p_internal_detail,
    coalesce(nullif(btrim(coalesce(p_queued_by,'')),''),v_role)
  ) q;
end;
$$;

revoke all on function public.ecoflow_queue_delivery_notifications(
  text,text,text,text,integer,text,text,text,text,text,text,text,text,text
) from public,anon,authenticated;
grant execute on function public.ecoflow_queue_delivery_notifications(
  text,text,text,text,integer,text,text,text,text,text,text,text,text,text
) to authenticated;

-- Exception primitive: canonical stop identity/carton total comes from route snapshot.
alter function public.ecoflow_record_delivery_exception(
  text,text,text,integer,text,text,text,numeric,numeric,numeric,text,text,text,text,text,text
) rename to ecoflow_record_delivery_exception_pre_resource_authority_20260809;
revoke all on function public.ecoflow_record_delivery_exception_pre_resource_authority_20260809(
  text,text,text,integer,text,text,text,numeric,numeric,numeric,text,text,text,text,text,text
) from public,anon,authenticated;

create or replace function public.ecoflow_record_delivery_exception(
  p_business_day text,
  p_order_id text,
  p_order_number text default null,
  p_stop_number integer default null,
  p_box_code text default null,
  p_store_name text default null,
  p_outcome text default 'PARTIAL',
  p_expected_cartons numeric default 0,
  p_delivered_cartons numeric default 0,
  p_return_cartons numeric default 0,
  p_reason text default null,
  p_driver_note text default null,
  p_pod2_path text default null,
  p_store_email text default null,
  p_store_phone text default null,
  p_recorded_by text default null
)
returns table(exception_id uuid,return_code text,return_status text,outcome text,recorded_at timestamptz)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
#variable_conflict error
declare
  v_day date;
  v_role text:=public.ecoflow_active_app_role();
  v_snapshot jsonb;
  v_stop jsonb;
  v_expected numeric;
  v_delivered numeric:=greatest(coalesce(p_delivered_cartons,0),0);
  v_returning numeric:=greatest(coalesce(p_return_cartons,0),0);
begin
  if auth.uid() is null or v_role not in ('OWNER','ADMIN','DRIVER') then
    raise exception using errcode='42501',message='DELIVERY_EXCEPTION_ROLE_REQUIRED';
  end if;
  begin v_day:=p_business_day::date; exception when others then raise exception 'VALID_BUSINESS_DAY_REQUIRED'; end;
  select a.snapshot into v_snapshot from public.ecoflow_authorize_delivery_resource(v_day,null,p_order_id) a limit 1;
  select s into v_stop from jsonb_array_elements(v_snapshot->'stops') s where s->>'orderId'=p_order_id limit 1;
  if v_stop is null then raise exception 'AUTHORIZED_DELIVERY_STOP_NOT_FOUND'; end if;
  v_expected:=greatest(coalesce(nullif(v_stop->>'cartons','')::numeric,0),0);
  if v_delivered+v_returning>v_expected then raise exception 'DELIVERY_CARTON_BALANCE_EXCEEDED'; end if;

  return query
  select e.exception_id,e.return_code,e.return_status,e.outcome,e.recorded_at
  from public.ecoflow_record_delivery_exception_pre_resource_authority_20260809(
    p_business_day,p_order_id,v_stop->>'orderNo',(v_stop->>'stopNumber')::integer,
    v_stop->>'boxCode',v_stop->>'store',p_outcome,v_expected,v_delivered,v_returning,
    p_reason,p_driver_note,p_pod2_path,null,v_stop->>'phone',
    coalesce(nullif(btrim(coalesce(p_recorded_by,'')),''),v_role)
  ) e;
end;
$$;

revoke all on function public.ecoflow_record_delivery_exception(
  text,text,text,integer,text,text,text,numeric,numeric,numeric,text,text,text,text,text,text
) from public,anon,authenticated;
grant execute on function public.ecoflow_record_delivery_exception(
  text,text,text,integer,text,text,text,numeric,numeric,numeric,text,text,text,text,text,text
) to authenticated;

-- Location primitive: route/current-order must resolve to the actor's route.
alter function public.ecoflow_record_driver_location_sample(
  date,text,double precision,double precision,numeric,numeric,numeric,text,text,uuid,timestamptz,text,text,jsonb
) rename to ecoflow_record_driver_location_sample_pre_resource_authority_20260809;
revoke all on function public.ecoflow_record_driver_location_sample_pre_resource_authority_20260809(
  date,text,double precision,double precision,numeric,numeric,numeric,text,text,uuid,timestamptz,text,text,jsonb
) from public,anon,authenticated;

create or replace function public.ecoflow_record_driver_location_sample(
  p_business_day date,
  p_route_id text,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m numeric default null,
  p_speed_mps numeric default null,
  p_heading_degrees numeric default null,
  p_current_order_id text default null,
  p_sample_source text default 'AUTO_INTERVAL',
  p_client_sample_id uuid default extensions.gen_random_uuid(),
  p_captured_at timestamptz default now(),
  p_driver_label text default null,
  p_device_timezone text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table(
  location_id uuid,business_day date,route_id text,driver_user_id uuid,driver_label text,
  latitude double precision,longitude double precision,accuracy_m numeric,sample_source text,
  current_order_id text,captured_at timestamptz,received_at timestamptz
)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
#variable_conflict error
declare
  v_role text:=public.ecoflow_active_app_role();
  v_route record;
  v_route_id text;
begin
  if auth.uid() is null or v_role not in ('OWNER','ADMIN','DRIVER') then
    raise exception using errcode='42501',message='DRIVER_LOCATION_ROLE_REQUIRED';
  end if;
  select * into v_route
  from public.ecoflow_authorize_delivery_resource(p_business_day,p_route_id,p_current_order_id)
  limit 1;
  v_route_id:='RUN-'||to_char(p_business_day,'YYYYMMDD')||'-'||v_route.run_code;

  return query
  select l.location_id,l.business_day,l.route_id,l.driver_user_id,l.driver_label,
    l.latitude,l.longitude,l.accuracy_m,l.sample_source,l.current_order_id,l.captured_at,l.received_at
  from public.ecoflow_record_driver_location_sample_pre_resource_authority_20260809(
    p_business_day,v_route_id,p_latitude,p_longitude,p_accuracy_m,p_speed_mps,p_heading_degrees,
    p_current_order_id,p_sample_source,p_client_sample_id,p_captured_at,
    case when v_role='DRIVER' then v_route.assigned_driver_label else p_driver_label end,
    p_device_timezone,p_metadata
  ) l;
end;
$$;

revoke all on function public.ecoflow_record_driver_location_sample(
  date,text,double precision,double precision,numeric,numeric,numeric,text,text,uuid,timestamptz,text,text,jsonb
) from public,anon,authenticated;
grant execute on function public.ecoflow_record_driver_location_sample(
  date,text,double precision,double precision,numeric,numeric,numeric,text,text,uuid,timestamptz,text,text,jsonb
) to authenticated;

-- Departure primitive: declaration belongs to the route assigned to this Driver.
alter function public.ecoflow_record_driver_departure_acknowledgement(
  date,text,text,text,jsonb,boolean,text,text,text,jsonb
) rename to ecoflow_record_driver_departure_acknowledgement_pre_resource_authority_20260809;
revoke all on function public.ecoflow_record_driver_departure_acknowledgement_pre_resource_authority_20260809(
  date,text,text,text,jsonb,boolean,text,text,text,jsonb
) from public,anon,authenticated;

create or replace function public.ecoflow_record_driver_departure_acknowledgement(
  p_business_day date,
  p_route_id text,
  p_policy_version text,
  p_typed_name text,
  p_checks jsonb,
  p_location_consent boolean,
  p_declaration_text text,
  p_driver_label text default null,
  p_user_agent text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table(acknowledgement_id uuid,accepted_at timestamptz,policy_version text)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
#variable_conflict error
declare
  v_role text:=public.ecoflow_active_app_role();
  v_route record;
  v_route_id text;
begin
  if auth.uid() is null or v_role not in ('OWNER','ADMIN','DRIVER') then
    raise exception using errcode='42501',message='ACTIVE_DRIVER_ROLE_REQUIRED';
  end if;
  select * into v_route
  from public.ecoflow_authorize_delivery_resource(p_business_day,p_route_id,null)
  limit 1;
  v_route_id:='RUN-'||to_char(p_business_day,'YYYYMMDD')||'-'||v_route.run_code;

  return query
  select a.acknowledgement_id,a.accepted_at,a.policy_version
  from public.ecoflow_record_driver_departure_acknowledgement_pre_resource_authority_20260809(
    p_business_day,v_route_id,p_policy_version,p_typed_name,p_checks,p_location_consent,
    p_declaration_text,
    case when v_role='DRIVER' then v_route.assigned_driver_label else p_driver_label end,
    p_user_agent,p_metadata
  ) a;
end;
$$;

revoke all on function public.ecoflow_record_driver_departure_acknowledgement(
  date,text,text,text,jsonb,boolean,text,text,text,jsonb
) from public,anon,authenticated;
grant execute on function public.ecoflow_record_driver_departure_acknowledgement(
  date,text,text,text,jsonb,boolean,text,text,text,jsonb
) to authenticated;

comment on function public.ecoflow_authorize_delivery_resource(date,text,text) is
  'Canonical resource authorization for TRANSFORM-006. DRIVER access requires the exact LOCKED route assigned to auth.uid(); optional order id must be present in the approved snapshot.';
comment on function public.ecoflow_record_delivery_exception(
  text,text,text,integer,text,text,text,numeric,numeric,numeric,text,text,text,text,text,text
) is 'Assignment-aware delivery exception boundary; route stop identity and expected cartons are server-derived.';
comment on function public.ecoflow_queue_delivery_notifications(
  text,text,text,text,integer,text,text,text,text,text,text,text,text,text
) is 'Assignment-aware notification queue boundary; stop metadata and available recipient facts are server-derived.';

notify pgrst,'reload schema';
commit;
