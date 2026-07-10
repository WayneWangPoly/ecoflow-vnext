-- Warehouse backend hardening.
-- One controlled receiving path, idempotent scans, barcode lifecycle history,
-- auditable cancellation, cloud warehouse layouts, and ledger/map synchronisation.

begin;

-- ---------------------------------------------------------------------------
-- Shared role checks
-- ---------------------------------------------------------------------------

create or replace function public.ecoflow_can_edit_warehouse_layout()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_user_profiles p
    where p.user_id = auth.uid()
      and p.is_active = true
      and p.team_status = 'ACTIVE'
      and p.app_role in ('OWNER','ADMIN')
  );
$$;

grant execute on function public.ecoflow_can_edit_warehouse_layout() to authenticated;

-- ---------------------------------------------------------------------------
-- Barcode lifecycle: keep history instead of silently remapping old codes
-- ---------------------------------------------------------------------------

alter table public.ecoflow_sku_barcode_registry
  add column if not exists is_active boolean not null default true,
  add column if not exists valid_from timestamptz,
  add column if not exists retired_at timestamptz,
  add column if not exists retired_by uuid,
  add column if not exists retirement_reason text,
  add column if not exists replaced_by_barcode_id uuid,
  add column if not exists packaging_version text,
  add column if not exists updated_at timestamptz not null default now();

update public.ecoflow_sku_barcode_registry
set valid_from = coalesce(valid_from, first_scanned_at, now())
where valid_from is null;

alter table public.ecoflow_sku_barcode_registry
  alter column valid_from set default now(),
  alter column valid_from set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ecoflow_barcode_registry_replacement_fk'
      and conrelid = 'public.ecoflow_sku_barcode_registry'::regclass
  ) then
    alter table public.ecoflow_sku_barcode_registry
      add constraint ecoflow_barcode_registry_replacement_fk
      foreign key (replaced_by_barcode_id)
      references public.ecoflow_sku_barcode_registry(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists idx_barcode_registry_active_sku
  on public.ecoflow_sku_barcode_registry(sku, package_level)
  where is_active;
create index if not exists idx_barcode_registry_retired_at
  on public.ecoflow_sku_barcode_registry(retired_at desc)
  where not is_active;

revoke insert, update, delete on public.ecoflow_sku_barcode_registry from anon, authenticated;
revoke insert, update, delete on public.ecoflow_barcode_scan_events from anon, authenticated;
revoke insert, update, delete on public.ecoflow_sku_package_policies from anon, authenticated;
grant select on public.ecoflow_sku_barcode_registry to authenticated;
grant select on public.ecoflow_barcode_scan_events to authenticated;
grant select on public.ecoflow_sku_package_policies to authenticated;

create or replace function public.ecoflow_record_barcode_scan(
  p_session_id uuid,
  p_sku text,
  p_barcode text,
  p_package_level text default 'UNKNOWN',
  p_units_per_barcode numeric default 1,
  p_product_name text default null,
  p_shelf text default null,
  p_qty_observed numeric default null,
  p_action_mode text default 'MAP_ONLY',
  p_note text default null
)
returns table (
  event_id uuid,
  sku text,
  barcode text,
  package_level text,
  scan_status text,
  movement_id uuid,
  scanned_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sku text := upper(nullif(trim(coalesce(p_sku, '')), ''));
  v_barcode text := nullif(trim(coalesce(p_barcode, '')), '');
  v_package text := upper(trim(coalesce(p_package_level, 'UNKNOWN')));
  v_mode text := upper(trim(coalesce(p_action_mode, 'MAP_ONLY')));
  v_units numeric := coalesce(p_units_per_barcode, 1);
  v_qty numeric := coalesce(p_qty_observed, 1);
  v_event_id uuid;
  v_product text;
  v_status text;
  v_existing public.ecoflow_sku_barcode_registry%rowtype;
  v_policy text;
begin
  if not public.ecoflow_can_manage_warehouse() then
    raise exception 'OWNER_ADMIN_OR_WAREHOUSE_REQUIRED';
  end if;
  if v_sku is null or v_sku = 'UNKNOWN' then raise exception 'valid SKU is required'; end if;
  if v_barcode is null then raise exception 'barcode is required'; end if;
  if v_package not in ('CARTON','SLEEVE','EACH','INNER') then raise exception 'valid package level is required'; end if;
  if v_mode not in ('MAP_ONLY','MAP_AND_COUNT') then
    raise exception 'BARCODE_SETUP_CANNOT_RECEIVE_STOCK: use the controlled Receive batch';
  end if;
  if v_units <= 0 or v_units <> trunc(v_units) then raise exception 'units per barcode must be a positive whole number'; end if;
  if v_qty <= 0 or v_qty <> trunc(v_qty) then raise exception 'observed package count must be a positive whole number'; end if;

  select p.package_mode into v_policy
  from public.ecoflow_sku_package_policies p
  where p.sku = v_sku;

  if v_policy = 'CARTON_ONLY' and v_package <> 'CARTON' then raise exception 'package level conflicts with CARTON_ONLY policy'; end if;
  if v_policy = 'SLEEVE_ONLY' and v_package <> 'SLEEVE' then raise exception 'package level conflicts with SLEEVE_ONLY policy'; end if;
  if v_policy = 'EACH_ONLY' and v_package <> 'EACH' then raise exception 'package level conflicts with UNIT/BOTTLE policy'; end if;
  if v_policy = 'INNER_ONLY' and v_package <> 'INNER' then raise exception 'package level conflicts with INNER_ONLY policy'; end if;
  if v_policy = 'CARTON_AND_SLEEVE' and v_package not in ('CARTON','SLEEVE') then raise exception 'package level conflicts with CARTON_AND_SLEEVE policy'; end if;

  select * into v_existing
  from public.ecoflow_sku_barcode_registry r
  where r.barcode = v_barcode
  for update;

  if found then
    if not v_existing.is_active then
      raise exception 'BARCODE_RETIRED: create or scan the new packaging code';
    end if;
    if upper(v_existing.sku) <> v_sku or upper(v_existing.package_level) <> v_package then
      raise exception 'BARCODE_CONFLICT: active code already belongs to % %', v_existing.sku, v_existing.package_level;
    end if;
  end if;

  select product_name into v_product
  from public.v_ecoflow_owner_sku_velocity
  where sku = v_sku
  limit 1;
  v_product := coalesce(nullif(trim(coalesce(p_product_name, '')), ''), v_product, 'Unknown product');

  if found then
    update public.ecoflow_sku_barcode_registry
    set units_per_barcode = v_units,
        product_name = coalesce(v_product, product_name),
        fixed_shelf = coalesce(nullif(trim(coalesce(p_shelf, '')), ''), fixed_shelf),
        source_session_id = coalesce(p_session_id, source_session_id),
        scan_count = scan_count + 1,
        last_scanned_at = now(),
        note = coalesce(nullif(trim(coalesce(p_note, '')), ''), note),
        updated_at = now()
    where id = v_existing.id;
  else
    insert into public.ecoflow_sku_barcode_registry(
      sku, barcode, package_level, units_per_barcode, product_name, fixed_shelf,
      source_session_id, scan_count, first_scanned_at, last_scanned_at,
      verified, note, is_active, valid_from, updated_at
    ) values (
      v_sku, v_barcode, v_package, v_units, v_product,
      nullif(trim(coalesce(p_shelf, '')), ''), p_session_id, 1, now(), now(),
      false, nullif(trim(coalesce(p_note, '')), ''), true, now(), now()
    );
  end if;

  insert into public.ecoflow_inventory_sku_controls(
    sku, product_name, fixed_shelf, primary_barcode, updated_by, updated_at
  ) values (
    v_sku, v_product, nullif(trim(coalesce(p_shelf, '')), ''), v_barcode, auth.uid(), now()
  )
  on conflict (sku) do update set
    product_name = coalesce(public.ecoflow_inventory_sku_controls.product_name, excluded.product_name),
    fixed_shelf = coalesce(excluded.fixed_shelf, public.ecoflow_inventory_sku_controls.fixed_shelf),
    primary_barcode = coalesce(public.ecoflow_inventory_sku_controls.primary_barcode, excluded.primary_barcode),
    updated_by = auth.uid(),
    updated_at = now();

  v_status := case when v_mode = 'MAP_AND_COUNT' then 'MAPPED_AND_COUNTED' else 'MAPPED' end;

  insert into public.ecoflow_barcode_scan_events(
    session_id, sku, barcode, package_level, units_per_barcode, product_name, shelf,
    qty_observed, action_mode, scan_status, movement_id, scan_note, scanned_by, scanned_at
  ) values (
    p_session_id, v_sku, v_barcode, v_package, v_units, v_product,
    nullif(trim(coalesce(p_shelf, '')), ''), v_qty, v_mode, v_status,
    null, nullif(trim(coalesce(p_note, '')), ''), auth.uid(), now()
  ) returning id into v_event_id;

  return query
  select e.id, e.sku, e.barcode, e.package_level, e.scan_status, e.movement_id, e.scanned_at
  from public.ecoflow_barcode_scan_events e
  where e.id = v_event_id;
end;
$$;

grant execute on function public.ecoflow_record_barcode_scan(uuid,text,text,text,numeric,text,text,numeric,text,text) to authenticated;
revoke execute on function public.ecoflow_record_barcode_scan(uuid,text,text,text,numeric,text,text,numeric,text,text) from anon;

create or replace function public.ecoflow_retire_barcode_mapping(
  p_barcode text,
  p_reason text,
  p_replacement_barcode text default null
)
returns table (
  barcode text,
  sku text,
  package_level text,
  retired_at timestamptz,
  replacement_barcode text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := nullif(trim(coalesce(p_barcode, '')), '');
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_replacement text := nullif(trim(coalesce(p_replacement_barcode, '')), '');
  v_current public.ecoflow_sku_barcode_registry%rowtype;
  v_next public.ecoflow_sku_barcode_registry%rowtype;
begin
  if not public.ecoflow_can_edit_warehouse_layout() then raise exception 'OWNER_OR_ADMIN_REQUIRED'; end if;
  if v_code is null then raise exception 'barcode is required'; end if;
  if v_reason is null then raise exception 'retirement reason is required'; end if;

  select * into v_current
  from public.ecoflow_sku_barcode_registry
  where barcode = v_code
  for update;
  if not found then raise exception 'barcode not found: %', v_code; end if;
  if not v_current.is_active then raise exception 'barcode is already retired'; end if;

  if v_replacement is not null then
    select * into v_next
    from public.ecoflow_sku_barcode_registry
    where barcode = v_replacement and is_active
    limit 1;
    if not found then raise exception 'active replacement barcode not found: %', v_replacement; end if;
    if upper(v_next.sku) <> upper(v_current.sku) then raise exception 'replacement barcode must belong to the same SKU'; end if;
  end if;

  update public.ecoflow_sku_barcode_registry
  set is_active = false,
      retired_at = now(),
      retired_by = auth.uid(),
      retirement_reason = v_reason,
      replaced_by_barcode_id = v_next.id,
      updated_at = now()
  where id = v_current.id;

  update public.ecoflow_inventory_sku_controls
  set primary_barcode = case when v_next.id is not null then v_next.barcode else null end,
      updated_by = auth.uid(),
      updated_at = now()
  where sku = v_current.sku and primary_barcode = v_current.barcode;

  return query
  select v_current.barcode, v_current.sku, v_current.package_level, now(), v_next.barcode;
end;
$$;

grant execute on function public.ecoflow_retire_barcode_mapping(text,text,text) to authenticated;
revoke execute on function public.ecoflow_retire_barcode_mapping(text,text,text) from anon;

-- Legacy direct stock paths remain callable only to return a clear migration message.
create or replace function public.ecoflow_receive_by_barcode(
  p_barcode text,
  p_qty_packages numeric default 1,
  p_to_location text default null,
  p_note text default null
)
returns table (
  movement_id uuid,
  sku text,
  barcode text,
  package_level text,
  packages numeric,
  units_received numeric,
  to_location text,
  moved_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'DIRECT_RECEIVE_DISABLED: use a staged warehouse receiving batch';
end;
$$;

grant execute on function public.ecoflow_receive_by_barcode(text,numeric,text,text) to authenticated;
revoke execute on function public.ecoflow_receive_by_barcode(text,numeric,text,text) from anon;

create or replace function public.ecoflow_record_receive_movement(
  p_location_code text,
  p_barcode text,
  p_quantity numeric,
  p_note text default null,
  p_sku text default null,
  p_product_name text default null,
  p_unit_level text default 'carton'
)
returns table(location_code text, sku text, quantity numeric)
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'DIRECT_RECEIVE_DISABLED: use a staged warehouse receiving batch';
end;
$$;

grant execute on function public.ecoflow_record_receive_movement(text,text,numeric,text,text,text,text) to authenticated;
revoke execute on function public.ecoflow_record_receive_movement(text,text,numeric,text,text,text,text) from anon;

-- Reject any new RECEIVE ledger entry that does not originate from the controlled batch.
create or replace function public.ecoflow_enforce_controlled_receive_source()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.movement_type = 'RECEIVE'
     and coalesce(new.source, '') not in ('WAREHOUSE_RECEIVING_BATCH','SYSTEM_BACKFILL','MIGRATION') then
    raise exception 'DIRECT_RECEIVE_DISABLED: use a staged warehouse receiving batch';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ecoflow_controlled_receive_source on public.ecoflow_inventory_movements;
create trigger trg_ecoflow_controlled_receive_source
before insert or update on public.ecoflow_inventory_movements
for each row execute function public.ecoflow_enforce_controlled_receive_source();

-- ---------------------------------------------------------------------------
-- Idempotent, auditable staged receiving
-- ---------------------------------------------------------------------------

alter table public.ecoflow_warehouse_receiving_lines
  add column if not exists idempotency_key text,
  add column if not exists client_scanned_at timestamptz;

alter table public.ecoflow_warehouse_receiving_batches
  add column if not exists cancelled_by uuid,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_reason text;

alter table public.ecoflow_warehouse_movements
  add column if not exists reference_type text,
  add column if not exists reference_id text;

create unique index if not exists uq_receiving_line_idempotency
  on public.ecoflow_warehouse_receiving_lines(batch_id, idempotency_key)
  where idempotency_key is not null;
create unique index if not exists uq_inventory_receiving_line_reference
  on public.ecoflow_inventory_movements(reference_type, reference_id)
  where reference_type = 'WAREHOUSE_RECEIVING_LINE';
create unique index if not exists uq_warehouse_receiving_line_reference
  on public.ecoflow_warehouse_movements(reference_type, reference_id)
  where reference_type = 'WAREHOUSE_RECEIVING_LINE';

create table if not exists public.ecoflow_warehouse_receiving_audit (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.ecoflow_warehouse_receiving_batches(id) on delete cascade,
  line_id uuid references public.ecoflow_warehouse_receiving_lines(id) on delete set null,
  action text not null,
  detail text,
  actor_user_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists idx_receiving_audit_batch
  on public.ecoflow_warehouse_receiving_audit(batch_id, created_at desc);

grant select on public.ecoflow_warehouse_receiving_audit to authenticated;
revoke insert, update, delete on public.ecoflow_warehouse_receiving_audit from anon, authenticated;
revoke insert, update, delete on public.ecoflow_warehouse_receiving_batches from anon, authenticated;
revoke insert, update, delete on public.ecoflow_warehouse_receiving_lines from anon, authenticated;
grant select on public.ecoflow_warehouse_receiving_batches to authenticated;
grant select on public.ecoflow_warehouse_receiving_lines to authenticated;

create or replace function public.ecoflow_start_warehouse_receiving_batch(
  p_supplier_name text default null,
  p_supplier_order_ref text default null,
  p_invoice_ref text default null,
  p_note text default null
)
returns table (batch_id uuid,batch_no text,batch_status text,created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.ecoflow_can_manage_warehouse() then raise exception 'OWNER_ADMIN_OR_WAREHOUSE_REQUIRED'; end if;
  insert into public.ecoflow_warehouse_receiving_batches(
    supplier_name,supplier_order_ref,invoice_ref,batch_note,created_by,created_at,updated_at
  ) values (
    nullif(trim(coalesce(p_supplier_name,'')),''),
    nullif(trim(coalesce(p_supplier_order_ref,'')),''),
    nullif(trim(coalesce(p_invoice_ref,'')),''),
    nullif(trim(coalesce(p_note,'')),''),
    auth.uid(),now(),now()
  ) returning id into v_id;
  insert into public.ecoflow_warehouse_receiving_audit(batch_id,action,detail)
  values (v_id,'BATCH_STARTED',nullif(trim(coalesce(p_note,'')),''));
  return query
  select b.id,b.batch_no,b.batch_status,b.created_at
  from public.ecoflow_warehouse_receiving_batches b
  where b.id=v_id;
end;
$$;

grant execute on function public.ecoflow_start_warehouse_receiving_batch(text,text,text,text) to authenticated;
revoke execute on function public.ecoflow_start_warehouse_receiving_batch(text,text,text,text) from anon;

create or replace function public.ecoflow_stage_receiving_scan_v2(
  p_batch_id uuid,
  p_barcode text,
  p_qty_packages numeric default 1,
  p_target_location text default null,
  p_note text default null,
  p_idempotency_key text default null,
  p_client_scanned_at timestamptz default null
)
returns table (
  line_id uuid,batch_id uuid,sku text,product_name text,barcode text,
  package_level text,qty_packages numeric,units_received numeric,
  suggested_location text,confirmation_checked boolean,line_status text,scanned_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid := p_batch_id;
  v_barcode text := nullif(trim(coalesce(p_barcode,'')),'');
  v_packages numeric := coalesce(p_qty_packages,1);
  v_key text := nullif(trim(coalesce(p_idempotency_key,'')),'');
  v_registry public.ecoflow_sku_barcode_registry%rowtype;
  v_units numeric;
  v_location text;
  v_location_row public.ecoflow_warehouse_locations%rowtype;
  v_id uuid;
  v_batch public.ecoflow_warehouse_receiving_batches%rowtype;
begin
  if not public.ecoflow_can_manage_warehouse() then raise exception 'OWNER_ADMIN_OR_WAREHOUSE_REQUIRED'; end if;
  if v_barcode is null then raise exception 'barcode is required'; end if;
  if v_key is null then raise exception 'idempotency key is required'; end if;
  if v_packages <= 0 or v_packages <> trunc(v_packages) then raise exception 'package quantity must be a positive whole number'; end if;

  if v_batch_id is null then
    select s.batch_id into v_batch_id
    from public.ecoflow_start_warehouse_receiving_batch(null,null,null,'Auto receiving batch') s
    limit 1;
  end if;

  select * into v_batch
  from public.ecoflow_warehouse_receiving_batches
  where id = v_batch_id
  for update;
  if not found then raise exception 'receiving batch not found'; end if;
  if v_batch.batch_status not in ('SCANNING','READY_TO_POST') then
    raise exception 'receiving batch is not open: %', v_batch.batch_status;
  end if;

  select l.id into v_id
  from public.ecoflow_warehouse_receiving_lines l
  where l.batch_id = v_batch_id and l.idempotency_key = v_key
  limit 1;

  if v_id is not null then
    return query
    select l.id,l.batch_id,l.sku,l.product_name,l.barcode,l.package_level,l.qty_packages,
           l.units_received,l.suggested_location,l.confirmation_checked,l.line_status,l.scanned_at
    from public.ecoflow_warehouse_receiving_lines l where l.id=v_id;
    return;
  end if;

  select * into v_registry
  from public.ecoflow_sku_barcode_registry
  where barcode = v_barcode and is_active
  limit 1;
  if not found then
    if exists(select 1 from public.ecoflow_sku_barcode_registry where barcode=v_barcode and not is_active) then
      raise exception 'BARCODE_RETIRED: scan the current packaging code';
    end if;
    raise exception 'barcode is not mapped yet: %', v_barcode;
  end if;

  v_units := v_packages * v_registry.units_per_barcode;
  v_location := coalesce(
    nullif(trim(coalesce(p_target_location,'')),''),
    nullif(trim(coalesce(v_registry.fixed_shelf,'')),''),
    (select nullif(trim(coalesce(c.fixed_shelf,'')),'') from public.ecoflow_inventory_sku_controls c where c.sku=v_registry.sku limit 1),
    (select nullif(trim(coalesce(p.default_shelf,'')),'') from public.ecoflow_sku_package_policies p where p.sku=v_registry.sku limit 1),
    'TEMP'
  );

  select * into v_location_row
  from public.ecoflow_warehouse_locations
  where upper(location_code)=upper(v_location) and status='ACTIVE'
  limit 1;

  if not found then
    if nullif(trim(coalesce(p_target_location,'')),'') is not null then
      raise exception 'active warehouse location not found: %', p_target_location;
    end if;
    select * into v_location_row
    from public.ecoflow_warehouse_locations
    where upper(location_code)='TEMP' and status='ACTIVE'
    limit 1;
    if not found then raise exception 'TEMP warehouse location is not configured'; end if;
    v_location := v_location_row.location_code;
  else
    v_location := v_location_row.location_code;
  end if;

  begin
    insert into public.ecoflow_warehouse_receiving_lines(
      batch_id,sku,product_name,barcode,package_level,qty_packages,units_per_package,
      units_received,suggested_location,line_note,idempotency_key,client_scanned_at,
      scanned_by,scanned_at,updated_at
    ) values (
      v_batch_id,v_registry.sku,v_registry.product_name,v_barcode,v_registry.package_level,
      v_packages,v_registry.units_per_barcode,v_units,v_location,
      nullif(trim(coalesce(p_note,'')),''),v_key,p_client_scanned_at,auth.uid(),now(),now()
    ) returning id into v_id;
  exception when unique_violation then
    select l.id into v_id
    from public.ecoflow_warehouse_receiving_lines l
    where l.batch_id=v_batch_id and l.idempotency_key=v_key
    limit 1;
  end;

  update public.ecoflow_warehouse_receiving_batches
  set batch_status='SCANNING',updated_at=now()
  where id=v_batch_id;

  insert into public.ecoflow_warehouse_receiving_audit(batch_id,line_id,action,detail)
  values (v_batch_id,v_id,'LINE_SCANNED',v_registry.sku || ' · ' || v_location || ' · ' || v_packages::text || ' packages');

  return query
  select l.id,l.batch_id,l.sku,l.product_name,l.barcode,l.package_level,l.qty_packages,
         l.units_received,l.suggested_location,l.confirmation_checked,l.line_status,l.scanned_at
  from public.ecoflow_warehouse_receiving_lines l where l.id=v_id;
end;
$$;

grant execute on function public.ecoflow_stage_receiving_scan_v2(uuid,text,numeric,text,text,text,timestamptz) to authenticated;
revoke execute on function public.ecoflow_stage_receiving_scan_v2(uuid,text,numeric,text,text,text,timestamptz) from anon;

-- Old clients must update instead of using a non-idempotent scan endpoint.
create or replace function public.ecoflow_stage_receiving_scan(
  p_batch_id uuid,p_barcode text,p_qty_packages numeric default 1,
  p_target_location text default null,p_note text default null
)
returns table (
  line_id uuid,batch_id uuid,sku text,product_name text,barcode text,
  package_level text,qty_packages numeric,units_received numeric,
  suggested_location text,confirmation_checked boolean,line_status text,scanned_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'CLIENT_UPDATE_REQUIRED: use ecoflow_stage_receiving_scan_v2 with an idempotency key';
end;
$$;

grant execute on function public.ecoflow_stage_receiving_scan(uuid,text,numeric,text,text) to authenticated;
revoke execute on function public.ecoflow_stage_receiving_scan(uuid,text,numeric,text,text) from anon;

create or replace function public.ecoflow_confirm_warehouse_receiving_line(
  p_line_id uuid,p_confirmed boolean default true,p_note text default null
)
returns table (line_id uuid,batch_id uuid,confirmation_checked boolean,line_status text,updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
begin
  if not public.ecoflow_can_manage_warehouse() then raise exception 'OWNER_ADMIN_OR_WAREHOUSE_REQUIRED'; end if;
  select l.batch_id into v_batch_id
  from public.ecoflow_warehouse_receiving_lines l
  join public.ecoflow_warehouse_receiving_batches b on b.id=l.batch_id
  where l.id=p_line_id and b.batch_status in ('SCANNING','READY_TO_POST')
  for update of l;
  if v_batch_id is null then raise exception 'open receiving line not found'; end if;

  update public.ecoflow_warehouse_receiving_lines
  set confirmation_checked=coalesce(p_confirmed,true),
      line_status=case when coalesce(p_confirmed,true) then 'CONFIRMED' else 'WAITING_CONFIRM' end,
      line_note=coalesce(nullif(trim(coalesce(p_note,'')),''),line_note),
      confirmed_by=case when coalesce(p_confirmed,true) then auth.uid() else null end,
      confirmed_at=case when coalesce(p_confirmed,true) then now() else null end,
      updated_at=now()
  where id=p_line_id and line_status in ('WAITING_CONFIRM','CONFIRMED');

  update public.ecoflow_warehouse_receiving_batches b
  set batch_status=case
        when exists(select 1 from public.ecoflow_warehouse_receiving_lines l where l.batch_id=b.id and l.line_status in ('WAITING_CONFIRM','CONFIRMED'))
         and not exists(select 1 from public.ecoflow_warehouse_receiving_lines l where l.batch_id=b.id and l.line_status in ('WAITING_CONFIRM','CONFIRMED') and not l.confirmation_checked)
        then 'READY_TO_POST' else 'SCANNING' end,
      updated_at=now()
  where b.id=v_batch_id;

  insert into public.ecoflow_warehouse_receiving_audit(batch_id,line_id,action,detail)
  values (v_batch_id,p_line_id,case when coalesce(p_confirmed,true) then 'LINE_CONFIRMED' else 'LINE_REOPENED' end,nullif(trim(coalesce(p_note,'')),''));

  return query
  select l.id,l.batch_id,l.confirmation_checked,l.line_status,l.updated_at
  from public.ecoflow_warehouse_receiving_lines l where l.id=p_line_id;
end;
$$;

grant execute on function public.ecoflow_confirm_warehouse_receiving_line(uuid,boolean,text) to authenticated;
revoke execute on function public.ecoflow_confirm_warehouse_receiving_line(uuid,boolean,text) from anon;

create or replace function public.ecoflow_complete_warehouse_receiving_batch(
  p_batch_id uuid,p_note text default null
)
returns table (batch_id uuid,batch_no text,posted_lines numeric,posted_units numeric,batch_status text,completed_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unconfirmed integer;
  v_line record;
  v_inventory_movement_id uuid;
  v_warehouse_movement_id uuid;
  v_location public.ecoflow_warehouse_locations%rowtype;
  v_unit_level text;
  v_batch public.ecoflow_warehouse_receiving_batches%rowtype;
begin
  if not public.ecoflow_can_manage_warehouse() then raise exception 'OWNER_ADMIN_OR_WAREHOUSE_REQUIRED'; end if;

  select * into v_batch
  from public.ecoflow_warehouse_receiving_batches
  where id=p_batch_id
  for update;
  if not found then raise exception 'receiving batch not found'; end if;

  if v_batch.batch_status='POSTED' then
    return query
    select b.id,b.batch_no,
      coalesce(count(l.id) filter(where l.line_status='POSTED'),0)::numeric,
      coalesce(sum(l.units_received) filter(where l.line_status='POSTED'),0)::numeric,
      b.batch_status,b.completed_at
    from public.ecoflow_warehouse_receiving_batches b
    left join public.ecoflow_warehouse_receiving_lines l on l.batch_id=b.id
    where b.id=p_batch_id
    group by b.id,b.batch_no,b.batch_status,b.completed_at;
    return;
  end if;

  if v_batch.batch_status='CANCELLED' then raise exception 'cancelled receiving batch cannot be posted'; end if;

  select count(*) into v_unconfirmed
  from public.ecoflow_warehouse_receiving_lines
  where batch_id=p_batch_id
    and line_status in ('WAITING_CONFIRM','CONFIRMED')
    and not confirmation_checked;
  if v_unconfirmed>0 then raise exception 'all scanned receiving lines must be confirmed before completion'; end if;
  if not exists(select 1 from public.ecoflow_warehouse_receiving_lines where batch_id=p_batch_id and confirmation_checked and movement_id is null) then
    raise exception 'no confirmed receiving lines to post';
  end if;

  for v_line in
    select * from public.ecoflow_warehouse_receiving_lines
    where batch_id=p_batch_id and confirmation_checked and movement_id is null and line_status='CONFIRMED'
    order by scanned_at asc
  loop
    select * into v_location
    from public.ecoflow_warehouse_locations
    where upper(location_code)=upper(v_line.suggested_location) and status='ACTIVE'
    limit 1;
    if not found then raise exception 'active warehouse location not found: %', v_line.suggested_location; end if;

    select m.id into v_inventory_movement_id
    from public.ecoflow_inventory_movements m
    where m.reference_type='WAREHOUSE_RECEIVING_LINE' and m.reference_id=v_line.id::text
    limit 1;

    if v_inventory_movement_id is null then
      insert into public.ecoflow_inventory_movements(
        sku,product_name,movement_type,quantity,to_location,reference_type,reference_id,
        action_note,source,moved_by,moved_at
      ) values (
        v_line.sku,v_line.product_name,'RECEIVE',v_line.units_received,v_location.location_code,
        'WAREHOUSE_RECEIVING_LINE',v_line.id::text,
        coalesce(nullif(trim(coalesce(p_note,'')),''),v_line.line_note),
        'WAREHOUSE_RECEIVING_BATCH',auth.uid(),now()
      ) returning id into v_inventory_movement_id;
    end if;

    v_unit_level := case upper(coalesce(v_line.package_level,'UNKNOWN'))
      when 'CARTON' then 'carton'
      when 'SLEEVE' then 'sleeve'
      when 'EACH' then 'each'
      else 'unknown' end;

    insert into public.ecoflow_warehouse_location_items(
      location_id,sku,product_name,source_barcode,unit_level,quantity,status,last_movement_at,last_note,created_at,updated_at
    ) values (
      v_location.id,v_line.sku,v_line.product_name,v_line.barcode,v_unit_level,v_line.units_received,
      'ACTIVE',now(),coalesce(nullif(trim(coalesce(p_note,'')),''),v_line.line_note),now(),now()
    )
    on conflict (location_id,sku,unit_level) do update set
      quantity=public.ecoflow_warehouse_location_items.quantity+excluded.quantity,
      product_name=coalesce(excluded.product_name,public.ecoflow_warehouse_location_items.product_name),
      source_barcode=coalesce(excluded.source_barcode,public.ecoflow_warehouse_location_items.source_barcode),
      status='ACTIVE',last_movement_at=now(),last_note=excluded.last_note,updated_at=now();

    select m.id into v_warehouse_movement_id
    from public.ecoflow_warehouse_movements m
    where m.reference_type='WAREHOUSE_RECEIVING_LINE' and m.reference_id=v_line.id::text
    limit 1;

    if v_warehouse_movement_id is null then
      insert into public.ecoflow_warehouse_movements(
        movement_type,location_id,to_location_id,sku,product_name,barcode,unit_level,
        quantity,note,actor_user_id,created_at,reference_type,reference_id
      ) values (
        'RECEIVE',v_location.id,v_location.id,v_line.sku,v_line.product_name,v_line.barcode,
        v_unit_level,v_line.units_received,coalesce(nullif(trim(coalesce(p_note,'')),''),v_line.line_note),
        auth.uid(),now(),'WAREHOUSE_RECEIVING_LINE',v_line.id::text
      ) returning id into v_warehouse_movement_id;
    end if;

    update public.ecoflow_warehouse_receiving_lines
    set movement_id=v_inventory_movement_id,line_status='POSTED',updated_at=now()
    where id=v_line.id;
  end loop;

  update public.ecoflow_warehouse_receiving_batches
  set batch_status='POSTED',completed_by=auth.uid(),completed_at=now(),
      batch_note=coalesce(nullif(trim(coalesce(p_note,'')),''),batch_note),updated_at=now()
  where id=p_batch_id;

  insert into public.ecoflow_warehouse_receiving_audit(batch_id,action,detail)
  values (p_batch_id,'BATCH_POSTED',nullif(trim(coalesce(p_note,'')),''));

  return query
  select b.id,b.batch_no,
    coalesce(count(l.id) filter(where l.line_status='POSTED'),0)::numeric,
    coalesce(sum(l.units_received) filter(where l.line_status='POSTED'),0)::numeric,
    b.batch_status,b.completed_at
  from public.ecoflow_warehouse_receiving_batches b
  left join public.ecoflow_warehouse_receiving_lines l on l.batch_id=b.id
  where b.id=p_batch_id
  group by b.id,b.batch_no,b.batch_status,b.completed_at;
end;
$$;

grant execute on function public.ecoflow_complete_warehouse_receiving_batch(uuid,text) to authenticated;
revoke execute on function public.ecoflow_complete_warehouse_receiving_batch(uuid,text) from anon;

create or replace function public.ecoflow_cancel_warehouse_receiving_batch(
  p_batch_id uuid,p_reason text
)
returns table (batch_id uuid,batch_no text,batch_status text,cancelled_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := nullif(trim(coalesce(p_reason,'')),'');
  v_batch public.ecoflow_warehouse_receiving_batches%rowtype;
begin
  if not public.ecoflow_can_manage_warehouse() then raise exception 'OWNER_ADMIN_OR_WAREHOUSE_REQUIRED'; end if;
  if v_reason is null then raise exception 'cancellation reason is required'; end if;

  select * into v_batch
  from public.ecoflow_warehouse_receiving_batches
  where id=p_batch_id
  for update;
  if not found then raise exception 'receiving batch not found'; end if;
  if v_batch.batch_status='POSTED' then raise exception 'posted receiving batch cannot be cancelled'; end if;
  if v_batch.batch_status='CANCELLED' then
    return query select b.id,b.batch_no,b.batch_status,b.cancelled_at from public.ecoflow_warehouse_receiving_batches b where b.id=p_batch_id;
    return;
  end if;
  if exists(select 1 from public.ecoflow_warehouse_receiving_lines where batch_id=p_batch_id and movement_id is not null) then
    raise exception 'batch with posted movement cannot be cancelled';
  end if;

  update public.ecoflow_warehouse_receiving_lines
  set line_status='CANCELLED',updated_at=now()
  where batch_id=p_batch_id and line_status in ('WAITING_CONFIRM','CONFIRMED');

  update public.ecoflow_warehouse_receiving_batches
  set batch_status='CANCELLED',cancelled_by=auth.uid(),cancelled_at=now(),cancel_reason=v_reason,updated_at=now()
  where id=p_batch_id;

  insert into public.ecoflow_warehouse_receiving_audit(batch_id,action,detail)
  values (p_batch_id,'BATCH_CANCELLED',v_reason);

  return query
  select b.id,b.batch_no,b.batch_status,b.cancelled_at
  from public.ecoflow_warehouse_receiving_batches b where b.id=p_batch_id;
end;
$$;

grant execute on function public.ecoflow_cancel_warehouse_receiving_batch(uuid,text) to authenticated;
revoke execute on function public.ecoflow_cancel_warehouse_receiving_batch(uuid,text) from anon;

-- ---------------------------------------------------------------------------
-- Owner-managed cloud layout configuration
-- ---------------------------------------------------------------------------

create table if not exists public.ecoflow_warehouse_layouts (
  site_code text primary key,
  layout_json jsonb not null default '{}'::jsonb,
  layout_version integer not null default 1,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint ecoflow_warehouse_layout_json_object check (jsonb_typeof(layout_json)='object')
);

alter table public.ecoflow_warehouse_layouts enable row level security;

drop policy if exists ecoflow_warehouse_layout_read on public.ecoflow_warehouse_layouts;
create policy ecoflow_warehouse_layout_read on public.ecoflow_warehouse_layouts
for select using (public.ecoflow_can_read_warehouse());

drop policy if exists ecoflow_warehouse_layout_owner_write on public.ecoflow_warehouse_layouts;
create policy ecoflow_warehouse_layout_owner_write on public.ecoflow_warehouse_layouts
for all using (public.ecoflow_can_edit_warehouse_layout())
with check (public.ecoflow_can_edit_warehouse_layout());

revoke insert,update,delete on public.ecoflow_warehouse_layouts from anon,authenticated;
grant select on public.ecoflow_warehouse_layouts to authenticated;

create or replace function public.ecoflow_save_warehouse_layout(
  p_site_code text,p_layout_json jsonb,p_expected_version integer default null
)
returns table (site_code text,layout_json jsonb,layout_version integer,updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site text := upper(coalesce(nullif(trim(coalesce(p_site_code,'')),''),'SITE-01'));
  v_current integer;
begin
  if not public.ecoflow_can_edit_warehouse_layout() then raise exception 'OWNER_OR_ADMIN_REQUIRED'; end if;
  if p_layout_json is null or jsonb_typeof(p_layout_json)<>'object' then raise exception 'layout must be a JSON object'; end if;

  select l.layout_version into v_current
  from public.ecoflow_warehouse_layouts l
  where l.site_code=v_site
  for update;

  if found and p_expected_version is not null and p_expected_version<>v_current then
    raise exception 'LAYOUT_VERSION_CONFLICT: expected %, current %',p_expected_version,v_current;
  end if;

  insert into public.ecoflow_warehouse_layouts(site_code,layout_json,layout_version,updated_by,updated_at)
  values (v_site,p_layout_json,1,auth.uid(),now())
  on conflict (site_code) do update set
    layout_json=excluded.layout_json,
    layout_version=public.ecoflow_warehouse_layouts.layout_version+1,
    updated_by=auth.uid(),updated_at=now();

  return query
  select l.site_code,l.layout_json,l.layout_version,l.updated_at
  from public.ecoflow_warehouse_layouts l where l.site_code=v_site;
end;
$$;

grant execute on function public.ecoflow_save_warehouse_layout(text,jsonb,integer) to authenticated;
revoke execute on function public.ecoflow_save_warehouse_layout(text,jsonb,integer) from anon;

-- Views use active mappings only; retired mappings remain queryable in history.
drop view if exists public.v_ecoflow_barcode_registry_history cascade;
create view public.v_ecoflow_barcode_registry_history as
select id,sku,product_name,barcode,package_level,units_per_barcode,fixed_shelf,
       is_active,valid_from,retired_at,retirement_reason,replaced_by_barcode_id,
       packaging_version,first_scanned_at,last_scanned_at,scan_count,verified,note,updated_at
from public.ecoflow_sku_barcode_registry
order by sku,is_active desc,valid_from desc;
grant select on public.v_ecoflow_barcode_registry_history to authenticated;

-- Refresh the app lookup to exclude retired packaging codes.
drop view if exists public.v_ecoflow_receiving_barcode_lookup cascade;
create view public.v_ecoflow_receiving_barcode_lookup as
select
  r.barcode,
  r.sku,
  coalesce(r.product_name,c.product_name,'Unknown product') as product_name,
  lower(case when r.package_level='EACH' then 'each' when r.package_level='SLEEVE' then 'sleeve' when r.package_level='CARTON' then 'carton' else 'unknown' end) as unit_level,
  coalesce(r.fixed_shelf,c.fixed_shelf,p.default_shelf) as fixed_location,
  r.package_level as pick_level,
  p.package_mode as classification,
  case when r.is_active then 'ACTIVE' else 'RETIRED' end as barcode_status,
  coalesce(c.status,'ACTIVE') as sku_status
from public.ecoflow_sku_barcode_registry r
left join public.ecoflow_inventory_sku_controls c on c.sku=r.sku
left join public.ecoflow_sku_package_policies p on p.sku=r.sku
where r.is_active;
grant select on public.v_ecoflow_receiving_barcode_lookup to authenticated;

notify pgrst, 'reload schema';

commit;
