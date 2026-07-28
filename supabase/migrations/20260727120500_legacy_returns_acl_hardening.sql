-- Harden legacy delivery-return operations behind authenticated role-aware RPCs.
-- Forward-only: preserve deployed migration history and wrap the existing implementations.

begin;

do $preflight$
declare
  v_missing text[] := array[]::text[];
  v_name text;
begin
  foreach v_name in array array[
    'public.ecoflow_delivery_notification_settings',
    'public.ecoflow_delivery_notifications',
    'public.ecoflow_delivery_exceptions',
    'public.ecoflow_delivery_return_scans',
    'public.ecoflow_warehouse_return_zones',
    'public.ecoflow_delivery_return_inspection_lines'
  ]
  loop
    if to_regclass(v_name) is null then
      v_missing := array_append(v_missing, v_name);
    end if;
  end loop;

  foreach v_name in array array[
    'public.ecoflow_active_app_role()',
    'public.ecoflow_queue_delivery_notifications(text,text,text,text,integer,text,text,text,text,text,text,text,text,text)',
    'public.ecoflow_record_delivery_exception(text,text,text,integer,text,text,text,numeric,numeric,numeric,text,text,text,text,text,text)',
    'public.ecoflow_scan_delivery_return(text,text,text,text)',
    'public.ecoflow_driver_drop_return(uuid,text,text,text,double precision,double precision,numeric)',
    'public.ecoflow_record_return_inspection_item(uuid,text,text,numeric,text,text,text,text)',
    'public.ecoflow_complete_return_inspection(uuid,text,text)'
  ]
  loop
    if to_regprocedure(v_name) is null then
      v_missing := array_append(v_missing, v_name);
    end if;
  end loop;

  if cardinality(v_missing) > 0 then
    raise exception 'RETURNS_ACL_PREREQUISITES_MISSING: %', array_to_string(v_missing, ', ');
  end if;
end;
$preflight$;

alter function public.ecoflow_active_app_role()
  set search_path = pg_catalog, public;
revoke all on function public.ecoflow_active_app_role()
  from public, anon, authenticated;
grant execute on function public.ecoflow_active_app_role()
  to authenticated;

alter function public.ecoflow_queue_delivery_notifications(text,text,text,text,integer,text,text,text,text,text,text,text,text,text)
  rename to ecoflow_queue_delivery_notifications_acl_impl;
alter function public.ecoflow_record_delivery_exception(text,text,text,integer,text,text,text,numeric,numeric,numeric,text,text,text,text,text,text)
  rename to ecoflow_record_delivery_exception_acl_impl;
alter function public.ecoflow_scan_delivery_return(text,text,text,text)
  rename to ecoflow_scan_delivery_return_acl_impl;
alter function public.ecoflow_driver_drop_return(uuid,text,text,text,double precision,double precision,numeric)
  rename to ecoflow_driver_drop_return_acl_impl;
alter function public.ecoflow_record_return_inspection_item(uuid,text,text,numeric,text,text,text,text)
  rename to ecoflow_record_return_inspection_item_acl_impl;
alter function public.ecoflow_complete_return_inspection(uuid,text,text)
  rename to ecoflow_complete_return_inspection_acl_impl;

alter function public.ecoflow_queue_delivery_notifications_acl_impl(text,text,text,text,integer,text,text,text,text,text,text,text,text,text)
  set search_path = pg_catalog, public;
alter function public.ecoflow_queue_delivery_notifications_acl_impl(text,text,text,text,integer,text,text,text,text,text,text,text,text,text)
  set plpgsql.variable_conflict = use_column;
alter function public.ecoflow_record_delivery_exception_acl_impl(text,text,text,integer,text,text,text,numeric,numeric,numeric,text,text,text,text,text,text)
  set search_path = pg_catalog, public;
alter function public.ecoflow_record_delivery_exception_acl_impl(text,text,text,integer,text,text,text,numeric,numeric,numeric,text,text,text,text,text,text)
  set plpgsql.variable_conflict = use_column;
alter function public.ecoflow_scan_delivery_return_acl_impl(text,text,text,text)
  set search_path = pg_catalog, public;
alter function public.ecoflow_scan_delivery_return_acl_impl(text,text,text,text)
  set plpgsql.variable_conflict = use_column;
alter function public.ecoflow_driver_drop_return_acl_impl(uuid,text,text,text,double precision,double precision,numeric)
  set search_path = pg_catalog, public;
alter function public.ecoflow_driver_drop_return_acl_impl(uuid,text,text,text,double precision,double precision,numeric)
  set plpgsql.variable_conflict = use_column;
alter function public.ecoflow_record_return_inspection_item_acl_impl(uuid,text,text,numeric,text,text,text,text)
  set search_path = pg_catalog, public;
alter function public.ecoflow_record_return_inspection_item_acl_impl(uuid,text,text,numeric,text,text,text,text)
  set plpgsql.variable_conflict = use_column;
alter function public.ecoflow_complete_return_inspection_acl_impl(uuid,text,text)
  set search_path = pg_catalog, public;
alter function public.ecoflow_complete_return_inspection_acl_impl(uuid,text,text)
  set plpgsql.variable_conflict = use_column;

do $revoke_functions$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.ecoflow_touch_delivery_operations_updated_at()',
    'public.ecoflow_queue_delivery_notifications(text,text,text,text,integer,text,text,text,text,text,text,text,text,text)',
    'public.ecoflow_record_delivery_exception(text,text,text,integer,text,text,text,numeric,numeric,numeric,text,text,text,text,text,text)',
    'public.ecoflow_scan_delivery_return(text,text,text,text)',
    'public.ecoflow_driver_drop_return(uuid,text,text,text,double precision,double precision,numeric)',
    'public.ecoflow_record_return_inspection_item(uuid,text,text,numeric,text,text,text,text)',
    'public.ecoflow_complete_return_inspection(uuid,text,text)',
    'public.ecoflow_queue_delivery_notifications_acl_impl(text,text,text,text,integer,text,text,text,text,text,text,text,text,text)',
    'public.ecoflow_record_delivery_exception_acl_impl(text,text,text,integer,text,text,text,numeric,numeric,numeric,text,text,text,text,text,text)',
    'public.ecoflow_scan_delivery_return_acl_impl(text,text,text,text)',
    'public.ecoflow_driver_drop_return_acl_impl(uuid,text,text,text,double precision,double precision,numeric)',
    'public.ecoflow_record_return_inspection_item_acl_impl(uuid,text,text,numeric,text,text,text,text)',
    'public.ecoflow_complete_return_inspection_acl_impl(uuid,text,text)'
  ]
  loop
    if to_regprocedure(v_signature) is not null then
      execute format(
        'revoke all on function %s from public, anon, authenticated',
        v_signature
      );
    end if;
  end loop;
end;
$revoke_functions$;

create function public.ecoflow_queue_delivery_notifications(
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
returns table (
  notification_id uuid,
  audience text,
  channel text,
  notification_status text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text := public.ecoflow_active_app_role();
  v_actor text;
begin
  if v_role is null
     or auth.uid() is null
     or v_role not in ('DRIVER','OWNER','ADMIN') then
    raise exception using
      errcode = '42501',
      message = 'DELIVERY_NOTIFICATION_DRIVER_ROLE_REQUIRED';
  end if;

  v_actor := format('%s:%s',v_role,auth.uid()::text);

  return query
  select result.notification_id,result.audience,result.channel,result.notification_status
  from public.ecoflow_queue_delivery_notifications_acl_impl(
    p_event_key,p_business_day,p_order_id,p_order_number,p_stop_number,p_box_code,
    p_store_name,p_outcome,p_store_email,p_store_phone,p_pod1_path,p_pod2_path,
    p_internal_detail,v_actor
  ) result;
end;
$$;

create function public.ecoflow_record_delivery_exception(
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
returns table (
  exception_id uuid,
  return_code text,
  return_status text,
  outcome text,
  recorded_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text := public.ecoflow_active_app_role();
  v_actor text;
begin
  if v_role is null
     or auth.uid() is null
     or v_role not in ('DRIVER','OWNER','ADMIN') then
    raise exception using
      errcode = '42501',
      message = 'DELIVERY_EXCEPTION_DRIVER_ROLE_REQUIRED';
  end if;

  v_actor := format('%s:%s',v_role,auth.uid()::text);

  return query
  select
    result.exception_id,result.return_code,result.return_status,result.outcome,
    result.recorded_at
  from public.ecoflow_record_delivery_exception_acl_impl(
    p_business_day,p_order_id,p_order_number,p_stop_number,p_box_code,p_store_name,
    p_outcome,p_expected_cartons,p_delivered_cartons,p_return_cartons,p_reason,
    p_driver_note,p_pod2_path,p_store_email,p_store_phone,v_actor
  ) result;
end;
$$;

create function public.ecoflow_scan_delivery_return(
  p_return_code text,
  p_warehouse_location text default 'RETURNS-HOLD',
  p_scan_note text default null,
  p_scanned_by text default null
)
returns table (
  exception_id uuid,
  return_code text,
  store_name text,
  order_number text,
  return_cartons numeric,
  return_status text,
  warehouse_location text,
  warehouse_received_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text := public.ecoflow_active_app_role();
  v_actor text;
begin
  if v_role is null
     or auth.uid() is null
     or v_role not in ('WAREHOUSE','OWNER','ADMIN') then
    raise exception using
      errcode = '42501',
      message = 'RETURN_WAREHOUSE_ROLE_REQUIRED';
  end if;

  v_actor := format('%s:%s',v_role,auth.uid()::text);

  return query
  select result.exception_id,result.return_code,result.store_name,result.order_number,
    result.return_cartons,result.return_status,result.warehouse_location,
    result.warehouse_received_at
  from public.ecoflow_scan_delivery_return_acl_impl(
    p_return_code,p_warehouse_location,p_scan_note,v_actor
  ) result;
end;
$$;

create function public.ecoflow_driver_drop_return(
  p_exception_id uuid,
  p_zone_code text,
  p_note text default null,
  p_driver text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_accuracy_metres numeric default null
)
returns table (
  exception_id uuid,
  return_code text,
  store_name text,
  order_number text,
  return_cartons numeric,
  return_status text,
  warehouse_location text,
  driver_returned_at timestamptz,
  distance_metres numeric
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text := public.ecoflow_active_app_role();
  v_actor text;
begin
  if v_role is null
     or auth.uid() is null
     or v_role not in ('DRIVER','OWNER','ADMIN') then
    raise exception using
      errcode = '42501',
      message = 'RETURN_DRIVER_ROLE_REQUIRED';
  end if;

  v_actor := format('%s:%s',v_role,auth.uid()::text);

  return query
  select
    result.exception_id,result.return_code,result.store_name,result.order_number,
    result.return_cartons,result.return_status,result.warehouse_location,
    result.driver_returned_at,result.distance_metres
  from public.ecoflow_driver_drop_return_acl_impl(
    p_exception_id,p_zone_code,p_note,v_actor,p_latitude,p_longitude,
    p_accuracy_metres
  ) result;
end;
$$;

create function public.ecoflow_record_return_inspection_item(
  p_exception_id uuid,
  p_resolution text,
  p_barcode text default null,
  p_qty_packages numeric default 1,
  p_target_location text default null,
  p_manual_item text default null,
  p_note text default null,
  p_inspected_by text default null
)
returns table (
  inspection_line_id uuid,
  resolution text,
  sku text,
  units_processed numeric,
  target_location text,
  movement_id uuid,
  inspected_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text := public.ecoflow_active_app_role();
  v_actor text;
begin
  if v_role is null
     or auth.uid() is null
     or v_role not in ('WAREHOUSE','OWNER','ADMIN') then
    raise exception using
      errcode = '42501',
      message = 'RETURN_INSPECTION_WAREHOUSE_ROLE_REQUIRED';
  end if;

  v_actor := format('%s:%s',v_role,auth.uid()::text);

  return query
  select result.inspection_line_id,result.resolution,result.sku,
    result.units_processed,result.target_location,result.movement_id,
    result.inspected_at
  from public.ecoflow_record_return_inspection_item_acl_impl(
    p_exception_id,p_resolution,p_barcode,p_qty_packages,p_target_location,
    p_manual_item,p_note,v_actor
  ) result;
end;
$$;

create function public.ecoflow_complete_return_inspection(
  p_exception_id uuid,
  p_note text default null,
  p_inspected_by text default null
)
returns table (
  exception_id uuid,
  return_code text,
  return_status text,
  inspection_lines numeric,
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text := public.ecoflow_active_app_role();
  v_actor text;
begin
  if v_role is null
     or auth.uid() is null
     or v_role not in ('WAREHOUSE','OWNER','ADMIN') then
    raise exception using
      errcode = '42501',
      message = 'RETURN_INSPECTION_WAREHOUSE_ROLE_REQUIRED';
  end if;

  v_actor := format('%s:%s',v_role,auth.uid()::text);

  return query
  select result.exception_id,result.return_code,result.return_status,
    result.inspection_lines,result.completed_at
  from public.ecoflow_complete_return_inspection_acl_impl(
    p_exception_id,p_note,v_actor
  ) result;
end;
$$;

revoke all on function public.ecoflow_queue_delivery_notifications(text,text,text,text,integer,text,text,text,text,text,text,text,text,text)
  from public, anon, authenticated;
revoke all on function public.ecoflow_record_delivery_exception(text,text,text,integer,text,text,text,numeric,numeric,numeric,text,text,text,text,text,text)
  from public, anon, authenticated;
revoke all on function public.ecoflow_scan_delivery_return(text,text,text,text)
  from public, anon, authenticated;
revoke all on function public.ecoflow_driver_drop_return(uuid,text,text,text,double precision,double precision,numeric)
  from public, anon, authenticated;
revoke all on function public.ecoflow_record_return_inspection_item(uuid,text,text,numeric,text,text,text,text)
  from public, anon, authenticated;
revoke all on function public.ecoflow_complete_return_inspection(uuid,text,text)
  from public, anon, authenticated;

alter table public.ecoflow_delivery_notification_settings enable row level security;
alter table public.ecoflow_delivery_notifications enable row level security;
alter table public.ecoflow_delivery_exceptions enable row level security;
alter table public.ecoflow_delivery_return_scans enable row level security;
alter table public.ecoflow_warehouse_return_zones enable row level security;
alter table public.ecoflow_delivery_return_inspection_lines enable row level security;

do $drop_policies$
declare
  v_policy record;
begin
  for v_policy in
    select schemaname,tablename,policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'ecoflow_delivery_notification_settings',
        'ecoflow_delivery_notifications',
        'ecoflow_delivery_exceptions',
        'ecoflow_delivery_return_scans',
        'ecoflow_warehouse_return_zones',
        'ecoflow_delivery_return_inspection_lines'
      )
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      v_policy.policyname,v_policy.schemaname,v_policy.tablename
    );
  end loop;
end;
$drop_policies$;

revoke all on table public.ecoflow_delivery_notification_settings from public, anon, authenticated;
revoke all on table public.ecoflow_delivery_notifications from public, anon, authenticated;
revoke all on table public.ecoflow_delivery_exceptions from public, anon, authenticated;
revoke all on table public.ecoflow_delivery_return_scans from public, anon, authenticated;
revoke all on table public.ecoflow_warehouse_return_zones from public, anon, authenticated;
revoke all on table public.ecoflow_delivery_return_inspection_lines from public, anon, authenticated;

grant select,update on table public.ecoflow_delivery_notification_settings to service_role;
grant select,insert,update on table public.ecoflow_delivery_notifications to service_role;
grant select,insert,update on table public.ecoflow_delivery_exceptions to service_role;
grant select,insert on table public.ecoflow_delivery_return_scans to service_role;
grant select,insert,update on table public.ecoflow_warehouse_return_zones to service_role;
grant select,insert on table public.ecoflow_delivery_return_inspection_lines to service_role;

grant select (
  id,event_key,business_day,order_id,order_number,stop_number,box_code,store_name,
  delivery_outcome,audience,channel,recipient,subject,message_text,pod1_path,
  pod2_path,notification_status,provider_message_id,error_message,queued_by,
  queued_at,sent_at,updated_at
) on public.ecoflow_delivery_notifications to authenticated;

grant select (
  id,business_day,order_id,order_number,stop_number,box_code,store_name,outcome,
  expected_cartons,delivered_cartons,return_cartons,reason,driver_note,
  return_code,return_status,warehouse_location,recorded_by,recorded_at,
  warehouse_received_by,warehouse_received_at,driver_return_zone_code,
  driver_returned_by,driver_returned_at,inspection_note
) on public.ecoflow_delivery_exceptions to authenticated;

grant select (
  id,zone_code,zone_name,warehouse_location,latitude,longitude,radius_metres,
  active,created_at,updated_at
) on public.ecoflow_warehouse_return_zones to authenticated;

grant select (
  id,exception_id,resolution,barcode,sku,product_name,package_level,qty_packages,
  units_processed,target_location,movement_id,manual_item,inspection_note,
  inspected_by,inspected_at
) on public.ecoflow_delivery_return_inspection_lines to authenticated;

create policy ecoflow_delivery_notifications_office_read
on public.ecoflow_delivery_notifications
for select to authenticated
using (public.ecoflow_active_app_role() in ('OWNER','ADMIN','ACCOUNT'));

create policy ecoflow_delivery_exceptions_active_read
on public.ecoflow_delivery_exceptions
for select to authenticated
using (
  public.ecoflow_active_app_role()
  in ('OWNER','ADMIN','ACCOUNT','VIEWER','WAREHOUSE','DRIVER')
);

create policy ecoflow_warehouse_return_zones_operations_read
on public.ecoflow_warehouse_return_zones
for select to authenticated
using (
  active
  and public.ecoflow_active_app_role() in ('DRIVER','WAREHOUSE','OWNER','ADMIN')
);

create policy ecoflow_return_inspection_lines_warehouse_read
on public.ecoflow_delivery_return_inspection_lines
for select to authenticated
using (
  public.ecoflow_active_app_role() in ('WAREHOUSE','OWNER','ADMIN')
);

create or replace view public.v_ecoflow_delivery_notification_outbox
with (security_barrier = true, security_invoker = true)
as
select
  id,event_key,business_day,order_id,order_number,stop_number,box_code,store_name,
  delivery_outcome,audience,channel,recipient,subject,message_text,pod1_path,
  pod2_path,notification_status,provider_message_id,error_message,queued_by,
  queued_at,sent_at,updated_at
from public.ecoflow_delivery_notifications
order by queued_at desc;

create or replace view public.v_ecoflow_warehouse_return_zones
with (security_barrier = true, security_invoker = true)
as
select
  id,zone_code,zone_name,warehouse_location,latitude,longitude,radius_metres,
  active,created_at,updated_at
from public.ecoflow_warehouse_return_zones
where active
order by created_at;

create or replace view public.v_ecoflow_return_inspection_lines
with (security_barrier = true, security_invoker = true)
as
select
  l.id,l.exception_id,e.return_code,e.store_name,e.order_number,l.resolution,
  l.barcode,l.sku,l.product_name,l.package_level,l.qty_packages,
  l.units_processed,l.target_location,l.movement_id,l.manual_item,
  l.inspection_note,l.inspected_by,l.inspected_at
from public.ecoflow_delivery_return_inspection_lines l
join public.ecoflow_delivery_exceptions e on e.id = l.exception_id
order by l.inspected_at desc;

create or replace view public.v_ecoflow_open_delivery_returns
with (security_barrier = true, security_invoker = true)
as
select
  id,business_day,order_id,order_number,stop_number,box_code,store_name,outcome,
  expected_cartons,delivered_cartons,return_cartons,reason,driver_note,
  return_code,return_status,warehouse_location,recorded_by,recorded_at,
  warehouse_received_by,warehouse_received_at,driver_return_zone_code,
  driver_returned_by,driver_returned_at,inspection_note,
  case
    when return_status = 'WITH_DRIVER' then 'DRIVER_SCAN_RETURN_ZONE'
    when return_status in ('DROPPED_IN_RETURN_ZONE','RETURNED_TO_WAREHOUSE') then 'INSPECT_NEXT_SHIFT'
    when return_status = 'INSPECTION_HOLD' then 'FINISH_INSPECTION'
    else return_status
  end as warehouse_action
from public.ecoflow_delivery_exceptions
where return_code is not null
  and return_status in (
    'WITH_DRIVER','DROPPED_IN_RETURN_ZONE','RETURNED_TO_WAREHOUSE','INSPECTION_HOLD'
  )
order by
  case
    when return_status = 'WITH_DRIVER' then 0
    when return_status = 'DROPPED_IN_RETURN_ZONE' then 1
    else 2
  end,
  recorded_at desc;

create or replace view public.v_ecoflow_delivery_exception_summary
with (security_barrier = true, security_invoker = true)
as
select
  business_day,
  count(*)::numeric as exception_count,
  count(*) filter(where outcome = 'PARTIAL')::numeric as partial_count,
  count(*) filter(where outcome = 'MISSING_CARTON')::numeric as missing_carton_count,
  count(*) filter(where outcome = 'REFUSED')::numeric as refused_count,
  count(*) filter(where return_status = 'WITH_DRIVER')::numeric as returns_with_driver,
  count(*) filter(
    where return_status in (
      'DROPPED_IN_RETURN_ZONE','RETURNED_TO_WAREHOUSE','INSPECTION_HOLD'
    )
  )::numeric as returns_in_warehouse,
  max(recorded_at) as latest_exception_at
from public.ecoflow_delivery_exceptions
where public.ecoflow_active_app_role() in ('OWNER','ADMIN','ACCOUNT','VIEWER')
group by business_day;

revoke all on table public.v_ecoflow_delivery_notification_outbox from public, anon;
revoke all on table public.v_ecoflow_warehouse_return_zones from public, anon;
revoke all on table public.v_ecoflow_return_inspection_lines from public, anon;
revoke all on table public.v_ecoflow_open_delivery_returns from public, anon;
revoke all on table public.v_ecoflow_delivery_exception_summary from public, anon;

grant select on table public.v_ecoflow_delivery_notification_outbox to authenticated;
grant select on table public.v_ecoflow_warehouse_return_zones to authenticated;
grant select on table public.v_ecoflow_return_inspection_lines to authenticated;
grant select on table public.v_ecoflow_open_delivery_returns to authenticated;
grant select on table public.v_ecoflow_delivery_exception_summary to authenticated;

grant execute on function public.ecoflow_queue_delivery_notifications(text,text,text,text,integer,text,text,text,text,text,text,text,text,text)
  to authenticated;
grant execute on function public.ecoflow_record_delivery_exception(text,text,text,integer,text,text,text,numeric,numeric,numeric,text,text,text,text,text,text)
  to authenticated;
grant execute on function public.ecoflow_scan_delivery_return(text,text,text,text)
  to authenticated;
grant execute on function public.ecoflow_driver_drop_return(uuid,text,text,text,double precision,double precision,numeric)
  to authenticated;
grant execute on function public.ecoflow_record_return_inspection_item(uuid,text,text,numeric,text,text,text,text)
  to authenticated;
grant execute on function public.ecoflow_complete_return_inspection(uuid,text,text)
  to authenticated;

notify pgrst, 'reload schema';

commit;
