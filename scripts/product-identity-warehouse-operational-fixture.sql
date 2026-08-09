-- Minimal production-shaped fixture for TRANSFORM-005 operational barcode authority.
create schema if not exists auth;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;

create or replace function auth.uid() returns uuid language sql stable as $$
  select '11111111-1111-4111-8111-111111111111'::uuid
$$;

create or replace function public.ecoflow_active_app_role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('app.test_role',true),''),'OWNER')::text
$$;

create or replace function public.ecoflow_can_manage_warehouse() returns boolean language sql stable as $$
  select auth.uid() is not null and public.ecoflow_active_app_role() in ('OWNER','ADMIN','WAREHOUSE')
$$;

create table public.skus(
  id uuid primary key,
  sku_code text not null unique,
  display_name text,
  category text,
  setup_status text
);

create table public.external_product_mappings(
  id uuid primary key default extensions.gen_random_uuid(),
  provider text not null,
  external_product_code text not null,
  internal_sku_id uuid references public.skus(id),
  default_unit_level text,
  confidence text,
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique(provider,external_product_code)
);

create table public.ecoflow_sku_master_overrides(
  external_sku_code text primary key,
  internal_sku_id uuid,
  classification text,
  is_service_item boolean not null default false,
  preferred_pick_level text,
  status text,
  notes text
);

create table public.ecoflow_sku_barcode_registry(
  id uuid primary key default extensions.gen_random_uuid(),
  sku text not null,
  barcode text not null unique,
  package_level text not null,
  units_per_barcode numeric not null default 1,
  product_name text,
  fixed_shelf text,
  source_session_id uuid,
  scan_count integer not null default 1,
  first_scanned_at timestamptz not null default now(),
  last_scanned_at timestamptz not null default now(),
  verified boolean not null default false,
  note text,
  is_active boolean not null default true,
  valid_from timestamptz not null default now(),
  retired_at timestamptz,
  retired_by uuid,
  retirement_reason text,
  replaced_by_barcode_id uuid,
  packaging_version text,
  updated_at timestamptz not null default now()
);

create table public.ecoflow_barcode_scan_events(
  id uuid primary key default extensions.gen_random_uuid(),
  session_id uuid,
  sku text,
  barcode text,
  package_level text,
  units_per_barcode numeric,
  product_name text,
  shelf text,
  qty_observed numeric,
  action_mode text,
  scan_status text,
  movement_id uuid,
  scan_note text,
  scanned_by uuid,
  scanned_at timestamptz not null default now()
);

create table public.ecoflow_inventory_sku_controls(
  sku text primary key,
  product_name text,
  fixed_shelf text,
  primary_barcode text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table public.ecoflow_sku_package_policies(
  sku text primary key,
  product_name text,
  package_mode text not null default 'UNKNOWN',
  default_shelf text,
  policy_note text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table public.ecoflow_inventory_movements(
  id uuid primary key default extensions.gen_random_uuid(),
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
  source text,
  moved_by uuid,
  moved_at timestamptz not null default now()
);

create table public.ecoflow_warehouse_locations(
  id uuid primary key default extensions.gen_random_uuid(),
  location_code text not null unique,
  status text not null default 'ACTIVE',
  sort_order integer not null default 0
);

create table public.ecoflow_warehouse_location_items(
  id uuid primary key default extensions.gen_random_uuid(),
  location_id uuid not null references public.ecoflow_warehouse_locations(id),
  sku text not null,
  product_name text,
  source_barcode text,
  unit_level text not null default 'unknown',
  quantity numeric not null default 0,
  status text not null default 'ACTIVE',
  last_movement_at timestamptz,
  last_note text,
  updated_at timestamptz not null default now(),
  unique(location_id,sku,unit_level)
);

create table public.ecoflow_warehouse_movements(
  id uuid primary key default extensions.gen_random_uuid(),
  movement_type text not null,
  location_id uuid references public.ecoflow_warehouse_locations(id),
  from_location_id uuid references public.ecoflow_warehouse_locations(id),
  to_location_id uuid references public.ecoflow_warehouse_locations(id),
  sku text,
  product_name text,
  barcode text,
  unit_level text,
  quantity numeric,
  note text,
  actor_user_id uuid,
  reference_type text,
  reference_id text,
  created_at timestamptz not null default now()
);

create table public.ecoflow_warehouse_receiving_batches(
  id uuid primary key default extensions.gen_random_uuid(),
  batch_no text not null unique default ('RCV-'||upper(substr(extensions.gen_random_uuid()::text,1,8))),
  supplier_name text,
  supplier_order_ref text,
  invoice_ref text,
  batch_status text not null default 'SCANNING',
  batch_note text,
  created_by uuid,
  completed_by uuid,
  completed_at timestamptz,
  cancelled_by uuid,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ecoflow_warehouse_receiving_lines(
  id uuid primary key default extensions.gen_random_uuid(),
  batch_id uuid not null references public.ecoflow_warehouse_receiving_batches(id),
  sku text not null,
  product_name text,
  barcode text not null,
  package_level text not null,
  qty_packages numeric not null,
  units_per_package numeric not null,
  units_received numeric not null,
  suggested_location text,
  confirmation_checked boolean not null default false,
  line_status text not null default 'WAITING_CONFIRM',
  movement_id uuid,
  line_note text,
  idempotency_key text,
  client_scanned_at timestamptz,
  scanned_by uuid,
  scanned_at timestamptz not null default now(),
  confirmed_by uuid,
  confirmed_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index uq_receiving_line_idempotency on public.ecoflow_warehouse_receiving_lines(batch_id,idempotency_key) where idempotency_key is not null;

create table public.ecoflow_warehouse_receiving_audit(
  id uuid primary key default extensions.gen_random_uuid(),
  batch_id uuid not null references public.ecoflow_warehouse_receiving_batches(id),
  line_id uuid references public.ecoflow_warehouse_receiving_lines(id),
  action text not null,
  detail text,
  actor_user_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.ecoflow_unknown_barcode_intakes(
  id uuid primary key default extensions.gen_random_uuid(),
  batch_id uuid not null references public.ecoflow_warehouse_receiving_batches(id),
  barcode text not null,
  qty_packages numeric not null,
  target_location text not null default 'TEMP',
  intake_note text,
  intake_status text not null default 'PENDING_MAPPING',
  idempotency_key text not null,
  client_scanned_at timestamptz,
  scanned_by uuid,
  scanned_at timestamptz not null default now(),
  converted_line_id uuid references public.ecoflow_warehouse_receiving_lines(id),
  converted_by uuid,
  converted_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(batch_id,idempotency_key)
);

create table public.ecoflow_delivery_exceptions(
  id uuid primary key default extensions.gen_random_uuid(),
  return_code text,
  return_status text,
  store_name text,
  order_number text,
  warehouse_location text,
  inspection_note text
);

create table public.ecoflow_delivery_return_inspection_lines(
  id uuid primary key default extensions.gen_random_uuid(),
  exception_id uuid not null references public.ecoflow_delivery_exceptions(id),
  resolution text not null,
  barcode text,
  sku text,
  product_name text,
  package_level text,
  qty_packages numeric,
  units_per_package numeric,
  units_processed numeric,
  target_location text,
  movement_id uuid,
  manual_item text,
  inspection_note text,
  inspected_by text,
  inspected_at timestamptz not null default now()
);

create or replace function public.ecoflow_start_warehouse_receiving_batch(
  p_supplier_name text default null,p_supplier_order_ref text default null,p_invoice_ref text default null,p_note text default null
)
returns table(batch_id uuid,batch_no text,batch_status text,created_at timestamptz)
language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if not public.ecoflow_can_manage_warehouse() then raise exception 'OWNER_ADMIN_OR_WAREHOUSE_REQUIRED'; end if;
  insert into public.ecoflow_warehouse_receiving_batches(supplier_name,supplier_order_ref,invoice_ref,batch_note,created_by)
  values(p_supplier_name,p_supplier_order_ref,p_invoice_ref,p_note,auth.uid()) returning id into v_id;
  return query select b.id,b.batch_no,b.batch_status,b.created_at from public.ecoflow_warehouse_receiving_batches b where b.id=v_id;
end $$;

create or replace function public.ecoflow_record_barcode_scan(
  p_session_id uuid,p_sku text,p_barcode text,p_package_level text default 'UNKNOWN',p_units_per_barcode numeric default 1,
  p_product_name text default null,p_shelf text default null,p_qty_observed numeric default null,p_action_mode text default 'MAP_ONLY',p_note text default null
)
returns table(event_id uuid,sku text,barcode text,package_level text,scan_status text,movement_id uuid,scanned_at timestamptz)
language plpgsql security definer set search_path=public as $$
begin raise exception 'fixture legacy barcode scan should be replaced'; end $$;

create or replace function public.ecoflow_record_pick_movement(
  p_sku text,p_quantity numeric,p_unit_level text default 'carton',p_barcode text default null,p_note text default null
)
returns table(location_code text,sku text,picked_quantity numeric,remaining_quantity numeric)
language plpgsql security definer set search_path=public as $$
declare v_row record; v_left numeric:=p_quantity; v_take numeric;
begin
  if not public.ecoflow_can_manage_warehouse() then raise exception 'OWNER_ADMIN_OR_WAREHOUSE_REQUIRED'; end if;
  for v_row in
    select i.id,i.sku,i.quantity,l.location_code
    from public.ecoflow_warehouse_location_items i join public.ecoflow_warehouse_locations l on l.id=i.location_id
    where upper(i.sku)=upper(p_sku) and i.status='ACTIVE' and i.quantity>0 and i.unit_level=p_unit_level
    order by l.sort_order,i.id for update of i
  loop
    exit when v_left<=0;
    v_take:=least(v_left,v_row.quantity);
    update public.ecoflow_warehouse_location_items set quantity=quantity-v_take,status=case when quantity-v_take<=0 then 'ZEROED' else 'ACTIVE' end where id=v_row.id;
    v_left:=v_left-v_take;
    return query select v_row.location_code,v_row.sku,v_take,v_row.quantity-v_take;
  end loop;
  if v_left>0 then raise exception 'STOCK_SHORTAGE'; end if;
end $$;

insert into public.skus(id,sku_code,display_name,category,setup_status) values
  ('aaaaaaaa-0000-4000-8000-000000000001','COM-CUP-12','12oz White Cup','Cups','active');
insert into public.external_product_mappings(provider,external_product_code,internal_sku_id,default_unit_level,confidence,is_active) values
  ('ORDERMENTUM','CUP-12W','aaaaaaaa-0000-4000-8000-000000000001','carton','VERIFIED',true);
insert into public.ecoflow_sku_master_overrides(external_sku_code,internal_sku_id,classification,is_service_item,status) values
  ('CUP-12W','aaaaaaaa-0000-4000-8000-000000000001','PRODUCT',false,'ACTIVE');

-- Deliberate legacy false authority. The operational gate must ignore it.
insert into public.ecoflow_sku_barcode_registry(sku,barcode,package_level,units_per_barcode,product_name,fixed_shelf,is_active)
values('CUP-12W','LEGACY-FAKE-001','CARTON',999,'Legacy fake mapping','A1',true);

insert into public.ecoflow_warehouse_locations(location_code,status,sort_order) values
  ('A1','ACTIVE',1),('TEMP','ACTIVE',999),('RETURNS-HOLD','ACTIVE',1000);
