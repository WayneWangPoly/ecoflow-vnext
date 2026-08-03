-- Compatibility guardrails: legacy barcode capture remains available as evidence,
-- but unpublished identity cannot receive stock or approve a stocktake.

begin;

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
set search_path = pg_catalog, public
as $$
#variable_conflict use_variable
declare
  v_role text := public.ecoflow_require_product_identity_role(false);
  v_sku text := upper(nullif(btrim(coalesce(p_sku, '')), ''));
  v_barcode text := nullif(btrim(coalesce(p_barcode, '')), '');
  v_package text := upper(btrim(coalesce(p_package_level, 'UNKNOWN')));
  v_mode text := upper(btrim(coalesce(p_action_mode, 'MAP_ONLY')));
  v_units numeric := coalesce(p_units_per_barcode, 1);
  v_qty numeric := coalesce(p_qty_observed, 1);
  v_event_id uuid;
  v_movement_id uuid;
  v_product text := nullif(btrim(coalesce(p_product_name, '')), '');
  v_status text := 'CAPTURED_UNVERIFIED';
  v_registry public.ecoflow_sku_barcode_registry%rowtype;
  v_physical public.ecoflow_physical_skus%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if v_sku is null or v_sku = 'UNKNOWN' then raise exception 'VALID_PHYSICAL_SKU_REQUIRED'; end if;
  if v_barcode is null then raise exception 'BARCODE_REQUIRED'; end if;
  if v_package not in ('CARTON','SLEEVE','EACH','INNER','UNKNOWN') then raise exception 'INVALID_PACKAGE_LEVEL'; end if;
  if v_mode not in ('MAP_ONLY','MAP_AND_COUNT','MAP_AND_RECEIVE') then raise exception 'INVALID_BARCODE_ACTION_MODE'; end if;
  if v_units <= 0 or v_units <> trunc(v_units) then raise exception 'WHOLE_UNITS_PER_BARCODE_REQUIRED'; end if;
  if v_qty < 0 or v_qty <> trunc(v_qty) then raise exception 'WHOLE_OBSERVED_PACKAGE_QUANTITY_REQUIRED'; end if;

  perform pg_advisory_xact_lock(hashtextextended('product-identity-barcode:' || v_barcode, 0));

  select * into v_physical
  from public.ecoflow_physical_skus p
  where p.physical_sku = v_sku
  for update;
  if not found then
    insert into public.ecoflow_physical_skus(
      physical_sku, product_name, brand, family_id, physical_status,
      revision, created_by, updated_by, updated_at
    ) values (
      v_sku, coalesce(v_product, v_sku), null, null, 'ACTIVE',
      1, auth.uid(), auth.uid(), v_now
    ) returning * into v_physical;
  end if;
  v_product := coalesce(v_product, v_physical.product_name, v_sku);

  select * into v_registry
  from public.ecoflow_sku_barcode_registry r
  where r.barcode = v_barcode
  for update;

  if found then
    if v_registry.physical_sku_id is not null and v_registry.physical_sku_id <> v_physical.id then
      raise exception using errcode = '23505', message = 'BARCODE_CAPTURE_CONFLICT',
        detail = 'The barcode is already linked to another Physical SKU and was not reassigned.';
    end if;
    if upper(coalesce(v_registry.sku, '')) <> v_sku then
      raise exception using errcode = '23505', message = 'BARCODE_CAPTURE_CONFLICT',
        detail = 'The barcode is already linked to another SKU and was not reassigned.';
    end if;
    if v_registry.mapping_state = 'VERIFIED'
       and (
         upper(coalesce(v_registry.package_level, 'UNKNOWN')) <> v_package
         or coalesce(v_registry.units_per_barcode, 1) <> v_units
       ) then
      raise exception using errcode = '23514', message = 'PACKAGING_CONVERSION_CONFLICT';
    end if;

    update public.ecoflow_sku_barcode_registry
    set physical_sku_id = coalesce(physical_sku_id, v_physical.id),
        product_name = coalesce(nullif(product_name, ''), v_product),
        fixed_shelf = coalesce(nullif(btrim(coalesce(p_shelf, '')), ''), fixed_shelf),
        source_session_id = coalesce(p_session_id, source_session_id),
        scan_count = scan_count + 1,
        last_scanned_at = v_now,
        note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), note),
        revision = revision + 1
    where id = v_registry.id
    returning * into v_registry;
  else
    insert into public.ecoflow_sku_barcode_registry(
      sku, barcode, package_level, units_per_barcode, product_name,
      fixed_shelf, source_session_id, scan_count, first_scanned_at,
      last_scanned_at, verified, note, physical_sku_id, mapping_state,
      barcode_status, revision
    ) values (
      v_sku, v_barcode, v_package, v_units, v_product,
      nullif(btrim(coalesce(p_shelf, '')), ''), p_session_id, 1, v_now,
      v_now, false, nullif(btrim(coalesce(p_note, '')), ''),
      v_physical.id, 'UNVERIFIED', 'ACTIVE', 1
    ) returning * into v_registry;
  end if;

  if v_mode = 'MAP_AND_RECEIVE' then
    if v_registry.mapping_state <> 'VERIFIED' or v_registry.barcode_status <> 'ACTIVE'
       or v_physical.family_id is null then
      raise exception using errcode = '23514', message = 'UNPUBLISHED_BARCODE_CANNOT_RECEIVE_STOCK';
    end if;
    insert into public.ecoflow_inventory_movements(
      sku, product_name, movement_type, quantity, to_location,
      reference_type, reference_id, action_note, source, moved_by, moved_at
    ) values (
      v_sku, v_product, 'RECEIVE', v_qty * v_units,
      coalesce(nullif(btrim(coalesce(p_shelf, '')), ''), 'RECEIVING'),
      'BARCODE_RECEIVING', v_barcode,
      nullif(btrim(coalesce(p_note, '')), ''),
      'VERIFIED_PRODUCT_IDENTITY', auth.uid(), v_now
    ) returning id into v_movement_id;
    v_status := 'VERIFIED_AND_RECEIVED';
  elsif v_registry.mapping_state = 'VERIFIED' then
    v_status := 'VERIFIED_CAPTURE';
  elsif v_mode = 'MAP_AND_COUNT' then
    v_status := 'CAPTURED_UNVERIFIED_COUNT_EVIDENCE';
  end if;

  if v_registry.mapping_state = 'VERIFIED' then
    insert into public.ecoflow_inventory_sku_controls(
      sku, product_name, fixed_shelf, primary_barcode, updated_by, updated_at
    ) values (
      v_sku, v_product, nullif(btrim(coalesce(p_shelf, '')), ''),
      v_barcode, auth.uid(), v_now
    )
    on conflict (sku) do update set
      product_name = coalesce(public.ecoflow_inventory_sku_controls.product_name, excluded.product_name),
      fixed_shelf = coalesce(public.ecoflow_inventory_sku_controls.fixed_shelf, excluded.fixed_shelf),
      primary_barcode = coalesce(public.ecoflow_inventory_sku_controls.primary_barcode, excluded.primary_barcode),
      updated_by = auth.uid(), updated_at = v_now;
  end if;

  insert into public.ecoflow_barcode_scan_events(
    session_id, sku, barcode, package_level, units_per_barcode,
    product_name, shelf, qty_observed, action_mode, scan_status,
    movement_id, scan_note, scanned_by, scanned_at
  ) values (
    p_session_id, v_sku, v_barcode, v_package, v_units,
    v_product, nullif(btrim(coalesce(p_shelf, '')), ''), v_qty,
    v_mode, v_status, v_movement_id,
    nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), v_now
  ) returning id into v_event_id;

  return query
  select e.id, e.sku, e.barcode, e.package_level,
         e.scan_status, e.movement_id, e.scanned_at
  from public.ecoflow_barcode_scan_events e
  where e.id = v_event_id;
end;
$$;

create or replace function public.ecoflow_guard_stocktake_identity_publication()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_variable
begin
  if new.session_status = 'APPROVED' and old.session_status <> 'APPROVED' then
    if exists (
      select 1
      from public.ecoflow_stocktake_observations o
      left join public.ecoflow_sku_barcode_registry r
        on r.barcode = o.barcode
       and r.mapping_state = 'VERIFIED'
       and r.barcode_status = 'ACTIVE'
      left join public.ecoflow_physical_skus p
        on p.id = r.physical_sku_id
       and p.physical_status = 'ACTIVE'
      left join public.ecoflow_sku_families f
        on f.id = p.family_id
       and f.family_status = 'ACTIVE'
      where o.session_id = new.id
        and (
          o.barcode is null
          or r.id is null
          or p.id is null
          or f.id is null
          or p.physical_sku <> upper(btrim(o.sku))
          or upper(r.package_level) <> upper(o.unit_level)
          or r.units_per_barcode <> o.units_per_package
        )
    ) then
      raise exception using errcode = '23514', message = 'STOCKTAKE_HAS_UNPUBLISHED_PRODUCT_IDENTITY',
        detail = 'All stocktake observations must use a published Barcode, Physical SKU, SKU Family and packaging conversion.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ecoflow_stocktake_identity_publication
  on public.ecoflow_stocktake_sessions;
create trigger trg_ecoflow_stocktake_identity_publication
before update of session_status on public.ecoflow_stocktake_sessions
for each row execute function public.ecoflow_guard_stocktake_identity_publication();

create or replace function public.ecoflow_read_business_day_close_state(p_business_day date)
returns table(
  business_day date,
  close_status text,
  revision bigint,
  next_business_day date,
  carry_over_count integer,
  command_id uuid,
  closed_at timestamptz,
  closed_by_label text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_variable
declare
  v_role text := public.ecoflow_active_app_role();
  v_row public.ecoflow_business_day_closes%rowtype;
begin
  if auth.uid() is null or v_role not in ('OWNER','ADMIN','ACCOUNT','VIEWER') then
    raise exception using errcode = '42501', message = 'DESKTOP_OPERATIONAL_ROLE_REQUIRED';
  end if;

  select * into v_row
  from public.ecoflow_business_day_closes c
  where c.business_day = p_business_day;

  if found then
    return query select v_row.business_day, 'CLOSED'::text, v_row.revision,
      v_row.next_business_day, v_row.carry_over_count, v_row.command_id,
      v_row.closed_at, v_row.closed_by_label;
  else
    return query select p_business_day, 'OPEN'::text, 0::bigint,
      null::date, 0, null::uuid, null::timestamptz, null::text;
  end if;
end;
$$;

revoke all on function public.ecoflow_record_barcode_scan(uuid,text,text,text,numeric,text,text,numeric,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.ecoflow_guard_stocktake_identity_publication()
  from public, anon, authenticated, service_role;
revoke all on function public.ecoflow_read_business_day_close_state(date)
  from public, anon, authenticated, service_role;

grant execute on function public.ecoflow_record_barcode_scan(uuid,text,text,text,numeric,text,text,numeric,text,text)
  to authenticated;
grant execute on function public.ecoflow_read_business_day_close_state(date)
  to authenticated;

notify pgrst, 'reload schema';

commit;
