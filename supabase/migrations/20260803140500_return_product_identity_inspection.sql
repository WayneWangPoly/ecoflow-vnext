-- Returned goods are inspected against published product identity before any
-- quantity can re-enter sellable stock. Return-code receipt and product-package
-- inspection remain separate auditable commands.

begin;

alter table public.ecoflow_delivery_exceptions
  drop constraint if exists ecoflow_delivery_exceptions_return_status_check;
alter table public.ecoflow_delivery_exceptions
  add constraint ecoflow_delivery_exceptions_return_status_check
  check (return_status in (
    'NOT_REQUIRED','WITH_DRIVER','RETURNED_TO_WAREHOUSE','INSPECTION_HOLD',
    'RESTOCKED','DISPOSED','MIXED_DISPOSITION','CANCELLED'
  ));

create table if not exists public.ecoflow_delivery_return_identity_inspections (
  id uuid primary key default gen_random_uuid(),
  command_id uuid not null unique,
  exception_id uuid not null references public.ecoflow_delivery_exceptions(id) on delete restrict,
  return_code text not null,
  product_barcode text not null,
  commercial_sku text,
  physical_sku text not null,
  product_name text not null,
  family_code text not null,
  family_name text not null,
  package_level text not null check (package_level in ('CARTON','SLEEVE','INNER','EACH')),
  units_per_barcode numeric not null check (units_per_barcode > 0 and units_per_barcode = trunc(units_per_barcode)),
  package_quantity numeric not null check (package_quantity > 0 and package_quantity = trunc(package_quantity)),
  goods_condition text not null check (goods_condition in ('SEALED','SALEABLE','OPENED','DAMAGED','CONTAMINATED','UNKNOWN')),
  disposition text not null check (disposition in ('RESTOCK','DISPOSE')),
  warehouse_location text not null,
  inspection_note text,
  stock_movement_recorded boolean not null default false,
  actor_user_id uuid not null,
  actor_role text not null,
  inspected_at timestamptz not null default clock_timestamp(),
  check (btrim(return_code) <> ''),
  check (btrim(product_barcode) <> ''),
  check (physical_sku = upper(btrim(physical_sku))),
  check (family_code = upper(btrim(family_code))),
  check (disposition <> 'RESTOCK' or goods_condition in ('SEALED','SALEABLE'))
);

create index if not exists idx_ecoflow_return_identity_exception
  on public.ecoflow_delivery_return_identity_inspections(exception_id, inspected_at desc);
create index if not exists idx_ecoflow_return_identity_barcode
  on public.ecoflow_delivery_return_identity_inspections(product_barcode, inspected_at desc);

alter table public.ecoflow_delivery_return_identity_inspections enable row level security;
revoke all on public.ecoflow_delivery_return_identity_inspections from public, anon, authenticated;

create or replace function public.ecoflow_read_return_identity_queue(
  p_search text default null,
  p_limit integer default 200
)
returns table(
  exception_id uuid,
  business_day text,
  order_id text,
  order_number text,
  stop_number integer,
  box_code text,
  store_name text,
  outcome text,
  return_cartons numeric,
  reason text,
  driver_note text,
  return_code text,
  return_status text,
  warehouse_location text,
  warehouse_action text,
  received_at timestamptz,
  inspected_packages numeric,
  restocked_packages numeric,
  disposed_packages numeric,
  latest_inspection_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_variable
declare
  v_role text := public.ecoflow_require_product_identity_role(false);
  v_search text := upper(nullif(btrim(coalesce(p_search, '')), ''));
begin
  return query
  select
    e.id,
    e.business_day,
    e.order_id,
    e.order_number,
    e.stop_number,
    e.box_code,
    e.store_name,
    e.outcome,
    e.return_cartons,
    e.reason,
    e.driver_note,
    e.return_code,
    e.return_status,
    e.warehouse_location,
    case
      when e.return_status = 'WITH_DRIVER' then 'SCAN_RETURN_CODE'
      when e.return_status in ('RETURNED_TO_WAREHOUSE','INSPECTION_HOLD') then 'SCAN_PRODUCT_BARCODE'
      when e.return_status = 'RESTOCKED' then 'COMPLETE_RESTOCKED'
      when e.return_status = 'DISPOSED' then 'COMPLETE_DISPOSED'
      when e.return_status = 'MIXED_DISPOSITION' then 'COMPLETE_MIXED'
      else e.return_status
    end,
    e.warehouse_received_at,
    coalesce(sum(i.package_quantity), 0)::numeric,
    coalesce(sum(i.package_quantity) filter (where i.disposition = 'RESTOCK'), 0)::numeric,
    coalesce(sum(i.package_quantity) filter (where i.disposition = 'DISPOSE'), 0)::numeric,
    max(i.inspected_at)
  from public.ecoflow_delivery_exceptions e
  left join public.ecoflow_delivery_return_identity_inspections i on i.exception_id = e.id
  where e.return_code is not null
    and e.return_status <> 'NOT_REQUIRED'
    and e.return_status <> 'CANCELLED'
    and (
      e.return_status in ('WITH_DRIVER','RETURNED_TO_WAREHOUSE','INSPECTION_HOLD')
      or e.updated_at >= clock_timestamp() - interval '14 days'
    )
    and (
      v_search is null
      or upper(e.return_code) like '%' || v_search || '%'
      or upper(coalesce(e.order_number, '')) like '%' || v_search || '%'
      or upper(coalesce(e.store_name, '')) like '%' || v_search || '%'
      or upper(coalesce(e.box_code, '')) like '%' || v_search || '%'
    )
  group by e.id
  order by
    case e.return_status
      when 'WITH_DRIVER' then 0
      when 'RETURNED_TO_WAREHOUSE' then 1
      when 'INSPECTION_HOLD' then 2
      else 3
    end,
    e.recorded_at desc
  limit greatest(1, least(coalesce(p_limit, 200), 1000));
end;
$$;

create or replace function public.ecoflow_read_return_identity_inspections(p_exception_id uuid)
returns table(
  inspection_id uuid,
  exception_id uuid,
  product_barcode text,
  commercial_sku text,
  physical_sku text,
  product_name text,
  family_code text,
  family_name text,
  package_level text,
  units_per_barcode numeric,
  package_quantity numeric,
  goods_condition text,
  disposition text,
  warehouse_location text,
  inspection_note text,
  stock_movement_recorded boolean,
  actor_role text,
  inspected_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_variable
declare
  v_role text := public.ecoflow_require_product_identity_role(false);
begin
  return query
  select i.id, i.exception_id, i.product_barcode, i.commercial_sku,
         i.physical_sku, i.product_name, i.family_code, i.family_name,
         i.package_level, i.units_per_barcode, i.package_quantity,
         i.goods_condition, i.disposition, i.warehouse_location,
         i.inspection_note, i.stock_movement_recorded, i.actor_role,
         i.inspected_at
  from public.ecoflow_delivery_return_identity_inspections i
  where i.exception_id = p_exception_id
  order by i.inspected_at desc;
end;
$$;

create or replace function public.ecoflow_receive_delivery_return(
  p_return_code text,
  p_warehouse_location text,
  p_note text,
  p_command_id uuid
)
returns table(
  exception_id uuid,
  return_code text,
  return_status text,
  warehouse_location text,
  received_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_variable
declare
  v_role text := public.ecoflow_require_product_identity_role(false);
  v_code text := upper(nullif(btrim(coalesce(p_return_code, '')), ''));
  v_location text := upper(coalesce(nullif(btrim(coalesce(p_warehouse_location, '')), ''), 'RETURNS-HOLD'));
  v_exception public.ecoflow_delivery_exceptions%rowtype;
  v_existing public.ecoflow_delivery_return_scans%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_command_id is null then raise exception 'RETURN_COMMAND_ID_REQUIRED'; end if;
  if v_code is null then raise exception 'RETURN_CODE_REQUIRED'; end if;

  select s.* into v_existing
  from public.ecoflow_delivery_return_scans s
  where s.scan_note = 'COMMAND:' || p_command_id::text
  limit 1;
  if found then
    select * into v_exception from public.ecoflow_delivery_exceptions where id = v_existing.exception_id;
    return query select v_exception.id, v_exception.return_code, v_exception.return_status,
      v_exception.warehouse_location, v_exception.warehouse_received_at;
    return;
  end if;

  select * into v_exception
  from public.ecoflow_delivery_exceptions e
  where upper(e.return_code) = v_code
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'RETURN_CODE_NOT_FOUND'; end if;
  if v_exception.return_status in ('RESTOCKED','DISPOSED','MIXED_DISPOSITION','CANCELLED','NOT_REQUIRED') then
    raise exception 'RETURN_ALREADY_CLOSED';
  end if;

  update public.ecoflow_delivery_exceptions
  set return_status = case when return_status = 'WITH_DRIVER' then 'RETURNED_TO_WAREHOUSE' else return_status end,
      warehouse_location = v_location,
      warehouse_received_by = coalesce(warehouse_received_by, auth.uid()::text),
      warehouse_received_at = coalesce(warehouse_received_at, v_now),
      updated_at = v_now
  where id = v_exception.id
  returning * into v_exception;

  insert into public.ecoflow_delivery_return_scans(
    exception_id, return_code, scan_action, warehouse_location,
    scan_note, scanned_by, scanned_at
  ) values (
    v_exception.id, v_exception.return_code, 'RETURNED_TO_WAREHOUSE',
    v_location, 'COMMAND:' || p_command_id::text || coalesce(' · ' || nullif(btrim(p_note), ''), ''),
    auth.uid()::text, v_now
  );

  return query select v_exception.id, v_exception.return_code, v_exception.return_status,
    v_exception.warehouse_location, v_exception.warehouse_received_at;
end;
$$;

create or replace function public.ecoflow_inspect_delivery_return_item(
  p_return_code text,
  p_product_barcode text,
  p_package_quantity numeric,
  p_goods_condition text,
  p_disposition text,
  p_warehouse_location text,
  p_note text,
  p_command_id uuid
)
returns table(
  inspection_id uuid,
  exception_id uuid,
  return_status text,
  physical_sku text,
  family_code text,
  package_quantity numeric,
  disposition text,
  stock_movement_recorded boolean,
  inspected_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_variable
declare
  v_role text := public.ecoflow_require_product_identity_role(false);
  v_code text := upper(nullif(btrim(coalesce(p_return_code, '')), ''));
  v_barcode text := nullif(btrim(coalesce(p_product_barcode, '')), '');
  v_condition text := upper(btrim(coalesce(p_goods_condition, 'UNKNOWN')));
  v_disposition text := upper(btrim(coalesce(p_disposition, '')));
  v_location text := upper(coalesce(nullif(btrim(coalesce(p_warehouse_location, '')), ''), 'RETURNS-HOLD'));
  v_exception public.ecoflow_delivery_exceptions%rowtype;
  v_inspection public.ecoflow_delivery_return_identity_inspections%rowtype;
  v_commercial_sku text;
  v_physical_sku text;
  v_product_name text;
  v_family_code text;
  v_family_name text;
  v_package_level text;
  v_units_per_barcode numeric;
  v_handled numeric;
  v_restock numeric;
  v_dispose numeric;
  v_final_status text;
  v_now timestamptz := clock_timestamp();
begin
  if p_command_id is null then raise exception 'RETURN_COMMAND_ID_REQUIRED'; end if;

  select * into v_inspection
  from public.ecoflow_delivery_return_identity_inspections
  where command_id = p_command_id;
  if found then
    select * into v_exception from public.ecoflow_delivery_exceptions where id = v_inspection.exception_id;
    return query select v_inspection.id, v_exception.id, v_exception.return_status,
      v_inspection.physical_sku, v_inspection.family_code, v_inspection.package_quantity,
      v_inspection.disposition, v_inspection.stock_movement_recorded, v_inspection.inspected_at;
    return;
  end if;

  if v_code is null then raise exception 'RETURN_CODE_REQUIRED'; end if;
  if v_barcode is null then raise exception 'PRODUCT_BARCODE_REQUIRED'; end if;
  if p_package_quantity is null or p_package_quantity <= 0 or p_package_quantity <> trunc(p_package_quantity) then
    raise exception 'WHOLE_RETURN_PACKAGE_QUANTITY_REQUIRED';
  end if;
  if v_condition not in ('SEALED','SALEABLE','OPENED','DAMAGED','CONTAMINATED','UNKNOWN') then
    raise exception 'RETURN_GOODS_CONDITION_REQUIRED';
  end if;
  if v_disposition not in ('RESTOCK','DISPOSE') then raise exception 'RETURN_DISPOSITION_REQUIRED'; end if;
  if v_disposition = 'RESTOCK' and v_condition not in ('SEALED','SALEABLE') then
    raise exception using errcode = '23514', message = 'UNSALEABLE_RETURN_CANNOT_RESTOCK';
  end if;
  if v_disposition = 'RESTOCK' and v_location = 'RETURNS-HOLD' then
    raise exception using errcode = '23514', message = 'RESTOCK_LOCATION_REQUIRED';
  end if;

  select * into v_exception
  from public.ecoflow_delivery_exceptions e
  where upper(e.return_code) = v_code
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'RETURN_CODE_NOT_FOUND'; end if;
  if v_exception.return_status = 'WITH_DRIVER' then raise exception 'RECEIVE_RETURN_CODE_BEFORE_PRODUCT_INSPECTION'; end if;
  if v_exception.return_status in ('RESTOCKED','DISPOSED','MIXED_DISPOSITION','CANCELLED','NOT_REQUIRED') then
    raise exception 'RETURN_ALREADY_CLOSED';
  end if;

  select s.commercial_sku, s.physical_sku, s.product_name,
         s.family_code, s.family_name, s.package_level, s.units_per_barcode
  into v_commercial_sku, v_physical_sku, v_product_name,
       v_family_code, v_family_name, v_package_level, v_units_per_barcode
  from public.ecoflow_validate_product_identity_scan(v_barcode, null, 'RETURN') s;

  insert into public.ecoflow_delivery_return_identity_inspections(
    command_id, exception_id, return_code, product_barcode,
    commercial_sku, physical_sku, product_name, family_code, family_name,
    package_level, units_per_barcode, package_quantity, goods_condition,
    disposition, warehouse_location, inspection_note,
    stock_movement_recorded, actor_user_id, actor_role, inspected_at
  ) values (
    p_command_id, v_exception.id, v_exception.return_code, v_barcode,
    v_commercial_sku, v_physical_sku, v_product_name, v_family_code, v_family_name,
    v_package_level, v_units_per_barcode, p_package_quantity, v_condition,
    v_disposition, v_location, nullif(btrim(coalesce(p_note, '')), ''),
    false, auth.uid(), v_role, v_now
  ) returning * into v_inspection;

  if v_disposition = 'RESTOCK' then
    perform * from public.ecoflow_record_barcode_scan(
      null,
      v_physical_sku,
      v_barcode,
      v_package_level,
      v_units_per_barcode,
      v_product_name,
      v_location,
      p_package_quantity,
      'MAP_AND_RECEIVE',
      'RETURN ' || v_exception.return_code || ' · ' || coalesce(nullif(btrim(p_note), ''), v_condition)
    );
    update public.ecoflow_delivery_return_identity_inspections
    set stock_movement_recorded = true
    where id = v_inspection.id
    returning * into v_inspection;
  end if;

  select
    coalesce(sum(i.package_quantity), 0),
    coalesce(sum(i.package_quantity) filter (where i.disposition = 'RESTOCK'), 0),
    coalesce(sum(i.package_quantity) filter (where i.disposition = 'DISPOSE'), 0)
  into v_handled, v_restock, v_dispose
  from public.ecoflow_delivery_return_identity_inspections i
  where i.exception_id = v_exception.id;

  v_final_status := case
    when v_handled < greatest(v_exception.return_cartons, 1) then 'INSPECTION_HOLD'
    when v_restock > 0 and v_dispose > 0 then 'MIXED_DISPOSITION'
    when v_restock > 0 then 'RESTOCKED'
    else 'DISPOSED'
  end;

  update public.ecoflow_delivery_exceptions
  set return_status = v_final_status,
      warehouse_location = v_location,
      warehouse_received_by = coalesce(warehouse_received_by, auth.uid()::text),
      warehouse_received_at = coalesce(warehouse_received_at, v_now),
      updated_at = v_now
  where id = v_exception.id
  returning * into v_exception;

  insert into public.ecoflow_delivery_return_scans(
    exception_id, return_code, scan_action, warehouse_location,
    scan_note, scanned_by, scanned_at
  ) values (
    v_exception.id,
    v_exception.return_code,
    case
      when v_final_status = 'RESTOCKED' then 'RESTOCKED'
      when v_final_status = 'DISPOSED' then 'DISPOSED'
      else 'INSPECTION_HOLD'
    end,
    v_location,
    'PRODUCT:' || v_barcode || ' · ' || v_condition || ' · ' || v_disposition || coalesce(' · ' || nullif(btrim(p_note), ''), ''),
    auth.uid()::text,
    v_now
  );

  return query select v_inspection.id, v_exception.id, v_exception.return_status,
    v_inspection.physical_sku, v_inspection.family_code, v_inspection.package_quantity,
    v_inspection.disposition, v_inspection.stock_movement_recorded, v_inspection.inspected_at;
end;
$$;

grant execute on function public.ecoflow_read_return_identity_queue(text, integer) to authenticated;
grant execute on function public.ecoflow_read_return_identity_inspections(uuid) to authenticated;
grant execute on function public.ecoflow_receive_delivery_return(text, text, text, uuid) to authenticated;
grant execute on function public.ecoflow_inspect_delivery_return_item(text, text, numeric, text, text, text, text, uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
