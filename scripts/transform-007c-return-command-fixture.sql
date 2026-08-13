\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
create schema if not exists auth;

do $$
begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end
$$;

grant usage on schema public,auth to authenticated;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
grant execute on function auth.uid() to authenticated;

create or replace function public.ecoflow_active_app_role()
returns text
language sql
stable
security definer
set search_path=pg_catalog,public
as $$
  select nullif(current_setting('app.test_role',true),'')
$$;
grant execute on function public.ecoflow_active_app_role() to authenticated;

create table public.ecoflow_delivery_exceptions(
  id uuid primary key,
  business_day text not null,
  order_id text not null,
  order_number text,
  store_name text,
  outcome text not null,
  return_code text unique,
  return_status text not null,
  warehouse_location text,
  recorded_at timestamptz not null default clock_timestamp(),
  warehouse_received_at timestamptz,
  driver_returned_at timestamptz,
  inspection_completed_by text,
  inspection_completed_at timestamptz,
  inspection_note text,
  updated_at timestamptz not null default clock_timestamp()
);

create table public.ecoflow_inventory_movements(
  id uuid primary key default gen_random_uuid(),
  sku text not null,
  product_name text,
  movement_type text not null,
  quantity numeric not null,
  from_location text,
  to_location text,
  reference_type text,
  reference_id text,
  store_id text,
  action_note text,
  source text not null,
  moved_by uuid,
  moved_at timestamptz not null default clock_timestamp()
);

create table public.ecoflow_delivery_return_inspection_lines(
  id uuid primary key default gen_random_uuid(),
  exception_id uuid not null references public.ecoflow_delivery_exceptions(id),
  resolution text not null,
  barcode text,
  sku text,
  product_name text,
  package_level text,
  qty_packages numeric not null,
  units_per_package numeric not null,
  units_processed numeric not null,
  target_location text,
  movement_id uuid references public.ecoflow_inventory_movements(id),
  manual_item text,
  inspection_note text,
  inspected_by text,
  inspected_at timestamptz not null default clock_timestamp()
);

create table public.ecoflow_delivery_return_scans(
  id uuid primary key default gen_random_uuid(),
  exception_id uuid not null references public.ecoflow_delivery_exceptions(id),
  return_code text not null,
  scan_action text not null,
  warehouse_location text,
  scan_note text,
  scanned_by text,
  scanned_at timestamptz not null default clock_timestamp()
);

create table public.ecoflow_sku_barcode_registry(
  id uuid primary key default gen_random_uuid(),
  sku text not null,
  barcode text not null,
  package_level text,
  units_per_barcode numeric not null default 1,
  product_name text,
  fixed_shelf text,
  is_active boolean not null default true,
  last_scanned_at timestamptz
);

create table public.ecoflow_warehouse_locations(
  id uuid primary key default gen_random_uuid(),
  location_code text not null unique,
  status text not null default 'ACTIVE'
);

-- Model the already-governed inventory mutation command used by 007C RESTOCK.
create or replace function public.ecoflow_record_inventory_movement(
  p_sku text,p_movement_type text,p_quantity numeric,p_from_location text default null,
  p_to_location text default null,p_reference_type text default null,
  p_reference_id text default null,p_store_id text default null,p_note text default null,
  p_source text default 'INVENTORY_CONTROL'
)
returns table(
  movement_id uuid,sku text,movement_type text,quantity numeric,
  from_location text,to_location text,moved_at timestamptz
)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_id uuid:=gen_random_uuid();
  v_role text:=public.ecoflow_active_app_role();
begin
  if auth.uid() is null or v_role not in('OWNER','ADMIN','WAREHOUSE') then
    raise exception using errcode='42501',message='OWNER_ADMIN_OR_WAREHOUSE_REQUIRED';
  end if;
  if upper(coalesce(p_movement_type,''))<>'RETURN_IN' then raise exception 'fixture only permits RETURN_IN'; end if;
  if p_quantity is null or p_quantity<=0 then raise exception 'movement quantity invalid'; end if;
  if nullif(btrim(coalesce(p_to_location,'')),'') is null then raise exception 'RETURN_IN requires location'; end if;

  insert into public.ecoflow_inventory_movements(
    id,sku,product_name,movement_type,quantity,from_location,to_location,
    reference_type,reference_id,store_id,action_note,source,moved_by,moved_at
  ) values(
    v_id,p_sku,'Fixture product','RETURN_IN',p_quantity,p_from_location,p_to_location,
    p_reference_type,p_reference_id,p_store_id,p_note,p_source,auth.uid(),clock_timestamp()
  );

  return query select m.id,m.sku,m.movement_type,m.quantity,m.from_location,m.to_location,m.moved_at
  from public.ecoflow_inventory_movements m where m.id=v_id;
end;
$$;
grant execute on function public.ecoflow_record_inventory_movement(text,text,numeric,text,text,text,text,text,text,text)
  to authenticated;

-- Legacy browser mutation entry points exist before 007C and must be retired.
create or replace function public.ecoflow_record_return_inspection_item(
  uuid,text,text,numeric,text,text,text,text
) returns void language plpgsql security definer as $$begin null; end$$;
create or replace function public.ecoflow_complete_return_inspection(uuid,text,text)
returns void language plpgsql security definer as $$begin null; end$$;
grant execute on function public.ecoflow_record_return_inspection_item(uuid,text,text,numeric,text,text,text,text)
  to authenticated;
grant execute on function public.ecoflow_complete_return_inspection(uuid,text,text)
  to authenticated;

-- Deliberately broad old grants prove 007C closes command-owned direct DML.
grant select,insert,update,delete,truncate,trigger,maintain
  on public.ecoflow_delivery_exceptions,public.ecoflow_delivery_return_inspection_lines
  to authenticated;

grant select on public.ecoflow_sku_barcode_registry,public.ecoflow_warehouse_locations,
  public.ecoflow_inventory_movements,public.ecoflow_delivery_return_scans
  to authenticated;

grant select,insert,update on public.ecoflow_delivery_exceptions to service_role;
grant select,insert on public.ecoflow_delivery_return_inspection_lines,
  public.ecoflow_delivery_return_scans to service_role;
grant select,insert on public.ecoflow_inventory_movements to service_role;

insert into public.ecoflow_warehouse_locations(location_code,status)
values('A1','ACTIVE'),('BLOCKED-1','INACTIVE');

insert into public.ecoflow_sku_barcode_registry(
  sku,barcode,package_level,units_per_barcode,product_name,fixed_shelf,is_active,last_scanned_at
) values('SKU-RESTOCK','BC-RESTOCK','CARTON',10,'Restock Product','A1',true,clock_timestamp());

insert into public.ecoflow_delivery_exceptions(
  id,business_day,order_id,order_number,store_name,outcome,return_code,return_status,
  warehouse_location,warehouse_received_at,driver_returned_at
) values
('11111111-1111-4111-8111-111111111111','2026-08-13','ORD-1','1001','Driver Case','REFUSED','RET-DRIVER','WITH_DRIVER',null,null,null),
('22222222-2222-4222-8222-222222222222','2026-08-13','ORD-2','1002','Restock Case','DAMAGED','RET-RESTOCK','RETURNED_TO_WAREHOUSE','RETURNS-HOLD',clock_timestamp(),null),
('33333333-3333-4333-8333-333333333333','2026-08-13','ORD-3','1003','Dispose Case','DAMAGED','RET-DISPOSE','DROPPED_IN_RETURN_ZONE','RETURNS-HOLD',null,clock_timestamp()),
('44444444-4444-4444-8444-444444444444','2026-08-13','ORD-4','1004','Empty Inspection','WRONG_GOODS','RET-EMPTY','INSPECTION_HOLD','RETURNS-HOLD',clock_timestamp(),null),
('55555555-5555-4555-8555-555555555555','2026-08-13','ORD-5','1005','Physical Revision','PARTIAL','RET-PHYSICAL','WITH_DRIVER',null,null,null),
('66666666-6666-4666-8666-666666666666','2026-08-13','ORD-6','1006','Validation Case','DAMAGED','RET-VALIDATE','RETURNED_TO_WAREHOUSE','RETURNS-HOLD',clock_timestamp(),null);
