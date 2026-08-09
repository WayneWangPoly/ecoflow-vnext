-- Production-shaped legacy delivery operations needed to prove the TRANSFORM-006
-- forward resource-authority migration. Loaded after route/assignment authority.

create schema if not exists storage;

create table if not exists storage.objects(
  id uuid primary key default extensions.gen_random_uuid(),
  bucket_id text not null,
  name text not null,
  owner_id uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique(bucket_id,name)
);
alter table storage.objects enable row level security;
grant select,insert,update on storage.objects to authenticated;

create table public.ecoflow_delivery_pod_proofs(
  id uuid primary key default extensions.gen_random_uuid(),
  business_day text not null,
  order_id text not null,
  order_number text,
  stop_number integer,
  box_code text,
  store_name text,
  proof_type text not null,
  photo_path text not null,
  captured_at timestamptz not null default now(),
  captured_by text,
  unique(business_day,order_id,proof_type)
);
alter table public.ecoflow_delivery_pod_proofs enable row level security;
grant select,insert,update on public.ecoflow_delivery_pod_proofs to authenticated;

create policy ecoflow_pod_proofs_active_read on public.ecoflow_delivery_pod_proofs
for select to authenticated using(public.ecoflow_active_app_role() is not null);
create policy ecoflow_pod_proofs_driver_write on public.ecoflow_delivery_pod_proofs
for insert to authenticated with check(public.ecoflow_active_app_role() in ('DRIVER','OWNER','ADMIN'));
create policy ecoflow_pod_proofs_driver_update on public.ecoflow_delivery_pod_proofs
for update to authenticated using(public.ecoflow_active_app_role() in ('DRIVER','OWNER','ADMIN'))
with check(public.ecoflow_active_app_role() in ('DRIVER','OWNER','ADMIN'));

create policy ecoflow_pod_private_read on storage.objects for select to authenticated
using(bucket_id='pod-photos' and public.ecoflow_active_app_role() is not null);
create policy ecoflow_pod_private_insert on storage.objects for insert to authenticated
with check(bucket_id='pod-photos' and public.ecoflow_active_app_role() in ('DRIVER','OWNER','ADMIN'));
create policy ecoflow_pod_private_update on storage.objects for update to authenticated
using(bucket_id='pod-photos' and public.ecoflow_active_app_role() in ('DRIVER','OWNER','ADMIN'))
with check(bucket_id='pod-photos' and public.ecoflow_active_app_role() in ('DRIVER','OWNER','ADMIN'));

create table public.ecoflow_delivery_notification_contacts(
  store_key text primary key,
  retailer_id text,
  store_name text not null,
  contact_email text,
  contact_name text,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.ecoflow_delivery_notification_contacts(store_key,store_name,contact_email,enabled) values
  ('EXECUTION-CAFE-C','Execution Cafe C','route-c@example.test',true),
  ('EXECUTION-CAFE-B','Execution Cafe B','route-b@example.test',true)
on conflict(store_key) do nothing;

create table public.ecoflow_test_notification_calls(
  id bigserial primary key,
  event_key text,
  business_day text,
  order_id text,
  order_number text,
  stop_number integer,
  box_code text,
  store_name text,
  store_email text,
  store_phone text,
  pod1_path text,
  pod2_path text,
  queued_by text
);

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
declare v_id uuid:=extensions.gen_random_uuid();
begin
  insert into public.ecoflow_test_notification_calls(
    event_key,business_day,order_id,order_number,stop_number,box_code,store_name,
    store_email,store_phone,pod1_path,pod2_path,queued_by
  ) values(
    p_event_key,p_business_day,p_order_id,p_order_number,p_stop_number,p_box_code,p_store_name,
    p_store_email,p_store_phone,p_pod1_path,p_pod2_path,p_queued_by
  );
  return query select v_id,'CUSTOMER'::text,'EMAIL'::text,'PENDING'::text;
end;
$$;
grant execute on function public.ecoflow_queue_delivery_notifications(
  text,text,text,text,integer,text,text,text,text,text,text,text,text,text
) to anon,authenticated;

create table public.ecoflow_test_exception_calls(
  id bigserial primary key,
  business_day text,
  order_id text,
  order_number text,
  stop_number integer,
  box_code text,
  store_name text,
  expected_cartons numeric,
  delivered_cartons numeric,
  return_cartons numeric,
  store_email text,
  store_phone text,
  recorded_by text
);

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
declare v_id uuid:=extensions.gen_random_uuid(); v_now timestamptz:=now();
begin
  insert into public.ecoflow_test_exception_calls(
    business_day,order_id,order_number,stop_number,box_code,store_name,
    expected_cartons,delivered_cartons,return_cartons,store_email,store_phone,recorded_by
  ) values(
    p_business_day,p_order_id,p_order_number,p_stop_number,p_box_code,p_store_name,
    p_expected_cartons,p_delivered_cartons,p_return_cartons,p_store_email,p_store_phone,p_recorded_by
  );
  return query select v_id,null::text,null::text,p_outcome,v_now;
end;
$$;
grant execute on function public.ecoflow_record_delivery_exception(
  text,text,text,integer,text,text,text,numeric,numeric,numeric,text,text,text,text,text,text
) to anon,authenticated;

create table public.ecoflow_test_location_calls(
  id uuid primary key default extensions.gen_random_uuid(),
  business_day date,
  route_id text,
  driver_user_id uuid,
  driver_label text,
  current_order_id text,
  sample_source text,
  latitude double precision,
  longitude double precision,
  captured_at timestamptz default now()
);

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
declare v_id uuid:=extensions.gen_random_uuid(); v_now timestamptz:=coalesce(p_captured_at,now());
begin
  insert into public.ecoflow_test_location_calls(
    id,business_day,route_id,driver_user_id,driver_label,current_order_id,sample_source,latitude,longitude,captured_at
  ) values(v_id,p_business_day,p_route_id,auth.uid(),p_driver_label,p_current_order_id,p_sample_source,p_latitude,p_longitude,v_now);
  return query select v_id,p_business_day,p_route_id,auth.uid(),p_driver_label,p_latitude,p_longitude,
    p_accuracy_m,p_sample_source,p_current_order_id,v_now,now();
end;
$$;
grant execute on function public.ecoflow_record_driver_location_sample(
  date,text,double precision,double precision,numeric,numeric,numeric,text,text,uuid,timestamptz,text,text,jsonb
) to authenticated;

create table public.ecoflow_test_departure_calls(
  id uuid primary key default extensions.gen_random_uuid(),
  business_day date,
  route_id text,
  driver_user_id uuid,
  driver_label text,
  policy_version text,
  accepted_at timestamptz default now()
);

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
declare v_id uuid:=extensions.gen_random_uuid(); v_now timestamptz:=now();
begin
  insert into public.ecoflow_test_departure_calls(id,business_day,route_id,driver_user_id,driver_label,policy_version,accepted_at)
  values(v_id,p_business_day,p_route_id,auth.uid(),p_driver_label,p_policy_version,v_now);
  return query select v_id,v_now,p_policy_version;
end;
$$;
grant execute on function public.ecoflow_record_driver_departure_acknowledgement(
  date,text,text,text,jsonb,boolean,text,text,text,jsonb
) to authenticated;
