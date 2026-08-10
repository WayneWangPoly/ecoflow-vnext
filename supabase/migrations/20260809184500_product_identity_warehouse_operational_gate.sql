-- TRANSFORM-005: make published Product Identity the only barcode authority used by
-- operational warehouse mutations. Legacy barcode tables remain read-compatible
-- evidence/location sources, but can no longer create or decide physical identity.
--
-- Invariants:
--   * canonical barcode resolution is read-only;
--   * UNKNOWN / RETIRED / commercial-family ambiguity fail closed;
--   * receiving scans stage only and never change quantity;
--   * quantity changes remain explicit receive-post, pick, or return-restock actions;
--   * existing warehouse role gates and receiving idempotency remain in force.

begin;

-- ---------------------------------------------------------------------------
-- One server-side operational resolver: physical barcode -> published physical
-- identity -> Commercial SKU family contract. p_expected_sku supplies order/
-- stocktake context; NULL is allowed only when the family maps to exactly one
-- active Commercial SKU.
-- ---------------------------------------------------------------------------

create or replace function public.ecoflow_resolve_operational_barcode(
  p_barcode text,
  p_expected_sku text default null
)
returns table(
  resolution_status text,
  barcode text,
  binding_id uuid,
  physical_sku_id uuid,
  physical_sku_code text,
  physical_name text,
  family_id uuid,
  family_code text,
  package_level text,
  units_in_base_unit numeric,
  commercial_sku_id uuid,
  commercial_sku_code text,
  commercial_name text,
  substitution_policy text,
  read_at timestamptz
)
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
#variable_conflict error
declare
  v_code text:=nullif(btrim(coalesce(p_barcode,'')),'');
  v_expected text:=nullif(btrim(coalesce(p_expected_sku,'')),'');
  v_binding_id uuid;
  v_physical_id uuid;
  v_physical_code text;
  v_physical_name text;
  v_family_id uuid;
  v_family_code text;
  v_package_level text;
  v_units numeric;
  v_commercial_id uuid;
  v_commercial_code text;
  v_commercial_name text;
  v_policy text;
  v_candidates integer:=0;
begin
  if auth.uid() is null or public.ecoflow_active_app_role() not in ('OWNER','ADMIN','WAREHOUSE') then
    raise exception using errcode='42501',message='WAREHOUSE_IDENTITY_READ_REQUIRED';
  end if;
  if v_code is null then raise exception 'BARCODE_REQUIRED'; end if;

  select b.id,p.id,p.physical_sku_code,p.display_name,f.id,f.family_code,pk.package_level,pk.units_in_base_unit
  into v_binding_id,v_physical_id,v_physical_code,v_physical_name,v_family_id,v_family_code,v_package_level,v_units
  from public.ecoflow_physical_barcode_bindings b
  join public.ecoflow_physical_skus p
    on p.id=b.physical_sku_id and p.identity_status='ACTIVE'
  join public.ecoflow_sku_families f
    on f.id=p.family_id and f.identity_status='ACTIVE'
  join public.ecoflow_physical_sku_packages pk
    on pk.id=b.package_id and pk.identity_status='ACTIVE'
  where b.barcode=v_code and b.identity_status='ACTIVE'
  limit 1;

  if v_binding_id is null then
    if exists(
      select 1 from public.ecoflow_physical_barcode_bindings b
      where b.barcode=v_code and b.identity_status='ACTIVE'
    ) then
      raise exception 'CANONICAL_BARCODE_INTEGRITY_ERROR: active binding has no active physical/package/family identity';
    end if;
    if exists(
      select 1 from public.ecoflow_physical_barcode_bindings b
      where b.barcode=v_code and b.identity_status='RETIRED'
    ) then
      return query select 'RETIRED'::text,v_code,null::uuid,null::uuid,null::text,null::text,
        null::uuid,null::text,null::text,null::numeric,null::uuid,null::text,null::text,null::text,statement_timestamp();
    else
      return query select 'UNKNOWN'::text,v_code,null::uuid,null::uuid,null::text,null::text,
        null::uuid,null::text,null::text,null::numeric,null::uuid,null::text,null::text,null::text,statement_timestamp();
    end if;
    return;
  end if;

  if v_expected is null then
    select count(*)::integer into v_candidates
    from public.ecoflow_commercial_family_links l
    join public.skus s on s.id=l.commercial_sku_id
    where l.family_id=v_family_id and l.identity_status='ACTIVE';

    if v_candidates=1 then
      select s.id,s.sku_code::text,s.display_name::text,l.substitution_policy::text
      into v_commercial_id,v_commercial_code,v_commercial_name,v_policy
      from public.ecoflow_commercial_family_links l
      join public.skus s on s.id=l.commercial_sku_id
      where l.family_id=v_family_id and l.identity_status='ACTIVE'
      limit 1;
    elsif v_candidates=0 then
      return query select 'COMMERCIAL_UNMAPPED'::text,v_code,v_binding_id,v_physical_id,v_physical_code,v_physical_name,
        v_family_id,v_family_code,v_package_level,v_units,null::uuid,null::text,null::text,null::text,statement_timestamp();
      return;
    else
      return query select 'COMMERCIAL_AMBIGUOUS'::text,v_code,v_binding_id,v_physical_id,v_physical_code,v_physical_name,
        v_family_id,v_family_code,v_package_level,v_units,null::uuid,null::text,null::text,null::text,statement_timestamp();
      return;
    end if;
  else
    select count(*)::integer into v_candidates
    from public.ecoflow_commercial_family_links l
    join public.skus s on s.id=l.commercial_sku_id
    where l.family_id=v_family_id
      and l.identity_status='ACTIVE'
      and (
        upper(s.sku_code::text)=upper(v_expected)
        or exists(
          select 1
          from public.external_product_mappings m
          where m.internal_sku_id=s.id
            and m.provider='ORDERMENTUM'
            and m.is_active
            and upper(m.external_product_code)=upper(v_expected)
        )
      );

    if v_candidates<>1 then
      return query select
        case when v_candidates=0 then 'COMMERCIAL_MISMATCH' else 'COMMERCIAL_AMBIGUOUS' end::text,
        v_code,v_binding_id,v_physical_id,v_physical_code,v_physical_name,
        v_family_id,v_family_code,v_package_level,v_units,null::uuid,null::text,null::text,null::text,statement_timestamp();
      return;
    end if;

    select s.id,s.sku_code::text,s.display_name::text,l.substitution_policy::text
    into v_commercial_id,v_commercial_code,v_commercial_name,v_policy
    from public.ecoflow_commercial_family_links l
    join public.skus s on s.id=l.commercial_sku_id
    where l.family_id=v_family_id
      and l.identity_status='ACTIVE'
      and (
        upper(s.sku_code::text)=upper(v_expected)
        or exists(
          select 1
          from public.external_product_mappings m
          where m.internal_sku_id=s.id
            and m.provider='ORDERMENTUM'
            and m.is_active
            and upper(m.external_product_code)=upper(v_expected)
        )
      )
    limit 1;
  end if;

  return query select 'RESOLVED'::text,v_code,v_binding_id,v_physical_id,v_physical_code,v_physical_name,
    v_family_id,v_family_code,v_package_level,v_units,v_commercial_id,v_commercial_code,v_commercial_name,v_policy,statement_timestamp();
end;
$$;

revoke all on function public.ecoflow_resolve_operational_barcode(text,text) from public,anon,authenticated;
grant execute on function public.ecoflow_resolve_operational_barcode(text,text) to authenticated;

-- ---------------------------------------------------------------------------
-- Legacy barcode scan RPC becomes canonical validation + append-only evidence.
-- It no longer writes ecoflow_sku_barcode_registry or primary_barcode.
-- MAP_AND_COUNT records an observation only; it never changes stock quantity.
-- ---------------------------------------------------------------------------

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
returns table(
  event_id uuid,sku text,barcode text,package_level text,scan_status text,movement_id uuid,scanned_at timestamptz
)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
#variable_conflict error
declare
  v_identity record;
  v_mode text:=upper(btrim(coalesce(p_action_mode,'MAP_ONLY')));
  v_level text:=upper(btrim(coalesce(p_package_level,'UNKNOWN')));
  v_units numeric:=coalesce(p_units_per_barcode,1);
  v_qty numeric:=coalesce(p_qty_observed,1);
  v_event uuid;
  v_status text;
begin
  if not public.ecoflow_can_manage_warehouse() then
    raise exception using errcode='42501',message='OWNER_ADMIN_OR_WAREHOUSE_REQUIRED';
  end if;
  if v_mode not in ('MAP_ONLY','MAP_AND_COUNT') then
    raise exception 'BARCODE_SETUP_CANNOT_RECEIVE_STOCK: use the controlled Receive batch';
  end if;
  if v_qty<=0 or v_qty<>trunc(v_qty) then raise exception 'observed package count must be a positive whole number'; end if;

  select * into v_identity
  from public.ecoflow_resolve_operational_barcode(p_barcode,p_sku)
  limit 1;

  if v_identity.resolution_status='UNKNOWN' then
    raise exception 'CANONICAL_BARCODE_UNKNOWN: commission and publish this physical barcode in Product Identity first';
  elsif v_identity.resolution_status='RETIRED' then
    raise exception 'BARCODE_RETIRED: scan the current published packaging code';
  elsif v_identity.resolution_status<>'RESOLVED' then
    raise exception 'CANONICAL_BARCODE_%: barcode does not resolve to the selected Commercial SKU family',v_identity.resolution_status;
  end if;

  if v_level<>upper(v_identity.package_level) then
    raise exception 'CANONICAL_PACKAGE_LEVEL_MISMATCH: published package is %, scanned as %',v_identity.package_level,v_level;
  end if;
  if v_units<>v_identity.units_in_base_unit then
    raise exception 'CANONICAL_PACKAGE_UNITS_MISMATCH: published units are %, observed setup says %',v_identity.units_in_base_unit,v_units;
  end if;

  v_status:=case when v_mode='MAP_AND_COUNT' then 'CANONICAL_VALIDATED_COUNT_OBSERVED' else 'CANONICAL_VALIDATED' end;

  insert into public.ecoflow_barcode_scan_events(
    session_id,sku,barcode,package_level,units_per_barcode,product_name,shelf,
    qty_observed,action_mode,scan_status,movement_id,scan_note,scanned_by,scanned_at
  ) values(
    p_session_id,v_identity.commercial_sku_code,v_identity.barcode,v_identity.package_level,
    v_identity.units_in_base_unit,coalesce(v_identity.commercial_name,v_identity.physical_name),
    nullif(btrim(coalesce(p_shelf,'')),''),v_qty,v_mode,v_status,null,
    nullif(btrim(coalesce(p_note,'')),''),auth.uid(),now()
  ) returning id into v_event;

  return query
  select e.id,e.sku,e.barcode,e.package_level,e.scan_status,e.movement_id,e.scanned_at
  from public.ecoflow_barcode_scan_events e where e.id=v_event;
end;
$$;

revoke all on function public.ecoflow_record_barcode_scan(uuid,text,text,text,numeric,text,text,numeric,text,text)
  from public,anon,authenticated;
grant execute on function public.ecoflow_record_barcode_scan(uuid,text,text,text,numeric,text,text,numeric,text,text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Receiving: idempotent replay stays first-class, but a new staged line is
-- derived only from published physical identity + its Commercial family link.
-- No quantity mutation occurs here.
-- ---------------------------------------------------------------------------

create or replace function public.ecoflow_stage_receiving_scan_v2(
  p_batch_id uuid,
  p_barcode text,
  p_qty_packages numeric default 1,
  p_target_location text default null,
  p_note text default null,
  p_idempotency_key text default null,
  p_client_scanned_at timestamptz default null
)
returns table(
  line_id uuid,batch_id uuid,sku text,product_name text,barcode text,
  package_level text,qty_packages numeric,units_received numeric,
  suggested_location text,confirmation_checked boolean,line_status text,scanned_at timestamptz
)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
#variable_conflict error
declare
  v_batch_id uuid:=p_batch_id;
  v_barcode text:=nullif(btrim(coalesce(p_barcode,'')),'');
  v_packages numeric:=coalesce(p_qty_packages,1);
  v_key text:=nullif(btrim(coalesce(p_idempotency_key,'')),'');
  v_identity record;
  v_units numeric;
  v_location text;
  v_location_row public.ecoflow_warehouse_locations%rowtype;
  v_id uuid;
  v_batch public.ecoflow_warehouse_receiving_batches%rowtype;
begin
  if not public.ecoflow_can_manage_warehouse() then
    raise exception using errcode='42501',message='OWNER_ADMIN_OR_WAREHOUSE_REQUIRED';
  end if;
  if v_barcode is null then raise exception 'barcode is required'; end if;
  if v_key is null then raise exception 'idempotency key is required'; end if;
  if v_packages<=0 or v_packages<>trunc(v_packages) then raise exception 'package quantity must be a positive whole number'; end if;

  if v_batch_id is null then
    select s.batch_id into v_batch_id
    from public.ecoflow_start_warehouse_receiving_batch(null,null,null,'Auto receiving batch') s limit 1;
  end if;

  select b.* into v_batch
  from public.ecoflow_warehouse_receiving_batches b
  where b.id=v_batch_id for update;
  if not found then raise exception 'receiving batch not found'; end if;
  if v_batch.batch_status not in ('SCANNING','READY_TO_POST') then
    raise exception 'receiving batch is not open: %',v_batch.batch_status;
  end if;

  select l.id into v_id
  from public.ecoflow_warehouse_receiving_lines l
  where l.batch_id=v_batch_id and l.idempotency_key=v_key limit 1;
  if v_id is not null then
    return query
    select l.id,l.batch_id,l.sku,l.product_name,l.barcode,l.package_level,l.qty_packages,
      l.units_received,l.suggested_location,l.confirmation_checked,l.line_status,l.scanned_at
    from public.ecoflow_warehouse_receiving_lines l where l.id=v_id;
    return;
  end if;

  select * into v_identity
  from public.ecoflow_resolve_operational_barcode(v_barcode,null) limit 1;
  if v_identity.resolution_status='UNKNOWN' then
    raise exception 'CANONICAL_BARCODE_UNKNOWN: barcode is not mapped yet: %',v_barcode;
  elsif v_identity.resolution_status='RETIRED' then
    raise exception 'BARCODE_RETIRED: scan the current published packaging code';
  elsif v_identity.resolution_status='COMMERCIAL_UNMAPPED' then
    raise exception 'CANONICAL_COMMERCIAL_UNMAPPED: publish the Commercial SKU family contract before receiving';
  elsif v_identity.resolution_status='COMMERCIAL_AMBIGUOUS' then
    raise exception 'CANONICAL_COMMERCIAL_AMBIGUOUS: receiving requires one Commercial SKU contract for this family';
  elsif v_identity.resolution_status<>'RESOLVED' then
    raise exception 'CANONICAL_BARCODE_RESOLUTION_FAILED: %',v_identity.resolution_status;
  end if;

  v_units:=v_packages*v_identity.units_in_base_unit;
  v_location:=coalesce(
    nullif(btrim(coalesce(p_target_location,'')),''),
    (select nullif(btrim(coalesce(c.fixed_shelf,'')),'') from public.ecoflow_inventory_sku_controls c where upper(c.sku)=upper(v_identity.commercial_sku_code) limit 1),
    (select nullif(btrim(coalesce(pp.default_shelf,'')),'') from public.ecoflow_sku_package_policies pp where upper(pp.sku)=upper(v_identity.commercial_sku_code) limit 1),
    'TEMP'
  );

  select wl.* into v_location_row
  from public.ecoflow_warehouse_locations wl
  where upper(wl.location_code)=upper(v_location) and wl.status='ACTIVE' limit 1;
  if not found then
    if nullif(btrim(coalesce(p_target_location,'')),'') is not null then
      raise exception 'active warehouse location not found: %',p_target_location;
    end if;
    select wl.* into v_location_row
    from public.ecoflow_warehouse_locations wl
    where upper(wl.location_code)='TEMP' and wl.status='ACTIVE' limit 1;
    if not found then raise exception 'TEMP warehouse location is not configured'; end if;
  end if;
  v_location:=v_location_row.location_code;

  begin
    insert into public.ecoflow_warehouse_receiving_lines(
      batch_id,sku,product_name,barcode,package_level,qty_packages,units_per_package,
      units_received,suggested_location,line_note,idempotency_key,client_scanned_at,
      scanned_by,scanned_at,updated_at
    ) values(
      v_batch_id,v_identity.commercial_sku_code,coalesce(v_identity.commercial_name,v_identity.physical_name),
      v_identity.barcode,v_identity.package_level,v_packages,v_identity.units_in_base_unit,
      v_units,v_location,nullif(btrim(coalesce(p_note,'')),''),v_key,p_client_scanned_at,
      auth.uid(),now(),now()
    ) returning id into v_id;
  exception when unique_violation then
    select l.id into v_id from public.ecoflow_warehouse_receiving_lines l
    where l.batch_id=v_batch_id and l.idempotency_key=v_key limit 1;
  end;

  update public.ecoflow_warehouse_receiving_batches b
  set batch_status='SCANNING',updated_at=now() where b.id=v_batch_id;
  insert into public.ecoflow_warehouse_receiving_audit(batch_id,line_id,action,detail)
  values(v_batch_id,v_id,'LINE_SCANNED_CANONICAL',
    v_identity.commercial_sku_code||' · '||v_identity.physical_sku_code||' · '||v_location||' · '||v_packages::text||' packages');

  return query
  select l.id,l.batch_id,l.sku,l.product_name,l.barcode,l.package_level,l.qty_packages,
    l.units_received,l.suggested_location,l.confirmation_checked,l.line_status,l.scanned_at
  from public.ecoflow_warehouse_receiving_lines l where l.id=v_id;
end;
$$;

revoke all on function public.ecoflow_stage_receiving_scan_v2(uuid,text,numeric,text,text,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.ecoflow_stage_receiving_scan_v2(uuid,text,numeric,text,text,text,timestamptz)
  to authenticated;

-- Unknown intake remains evidence-only. A published barcode is never allowed to
-- fall back to the quarantine authority; conversion re-enters canonical receiving.
create or replace function public.ecoflow_stage_unknown_barcode_intake(
  p_batch_id uuid,p_barcode text,p_qty_packages numeric default 1,p_note text default null,
  p_idempotency_key text default null,p_client_scanned_at timestamptz default now()
)
returns table(
  intake_id uuid,batch_id uuid,barcode text,qty_packages numeric,target_location text,intake_status text,scanned_at timestamptz
)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
#variable_conflict error
declare
  v_batch public.ecoflow_warehouse_receiving_batches%rowtype;
  v_barcode text:=nullif(btrim(coalesce(p_barcode,'')),'');
  v_key text:=nullif(btrim(coalesce(p_idempotency_key,'')),'');
  v_identity record;
  v_id uuid;
begin
  if not public.ecoflow_can_manage_warehouse() then raise exception using errcode='42501',message='OWNER_ADMIN_OR_WAREHOUSE_REQUIRED'; end if;
  if p_batch_id is null then raise exception 'receiving batch is required'; end if;
  if v_barcode is null then raise exception 'barcode is required'; end if;
  if v_key is null then raise exception 'idempotency key is required'; end if;
  if coalesce(p_qty_packages,0)<=0 or p_qty_packages<>trunc(p_qty_packages) then raise exception 'package quantity must be a positive whole number'; end if;

  select b.* into v_batch from public.ecoflow_warehouse_receiving_batches b where b.id=p_batch_id for update;
  if not found then raise exception 'receiving batch not found'; end if;
  if v_batch.batch_status not in ('SCANNING','READY_TO_POST') then raise exception 'receiving batch is not open: %',v_batch.batch_status; end if;

  select * into v_identity from public.ecoflow_resolve_operational_barcode(v_barcode,null) limit 1;
  if v_identity.resolution_status='RESOLVED' then
    raise exception 'BARCODE_NOW_MAPPED: retry the normal receiving scan';
  elsif v_identity.resolution_status='RETIRED' then
    raise exception 'BARCODE_RETIRED: scan the current published packaging code';
  elsif v_identity.resolution_status<>'UNKNOWN' then
    raise exception 'CANONICAL_IDENTITY_CONTRACT_REQUIRED: %',v_identity.resolution_status;
  end if;

  insert into public.ecoflow_unknown_barcode_intakes(
    batch_id,barcode,qty_packages,target_location,intake_note,intake_status,
    idempotency_key,client_scanned_at,scanned_by,scanned_at
  ) values(
    p_batch_id,v_barcode,p_qty_packages,'TEMP',nullif(btrim(coalesce(p_note,'')),''),'PENDING_MAPPING',
    v_key,p_client_scanned_at,auth.uid(),now()
  ) on conflict on constraint uq_unknown_barcode_intake_idempotency do update set
    intake_note=coalesce(excluded.intake_note,public.ecoflow_unknown_barcode_intakes.intake_note)
  returning id into v_id;

  update public.ecoflow_warehouse_receiving_batches b set batch_status='SCANNING',updated_at=now() where b.id=p_batch_id;
  insert into public.ecoflow_warehouse_receiving_audit(batch_id,action,detail)
  values(p_batch_id,'UNKNOWN_BARCODE_QUARANTINED',v_barcode||' · '||p_qty_packages::text||' packages · TEMP');

  return query select i.id,i.batch_id,i.barcode,i.qty_packages,i.target_location,i.intake_status,i.scanned_at
  from public.ecoflow_unknown_barcode_intakes i where i.id=v_id;
end;
$$;

create or replace function public.ecoflow_convert_unknown_barcode_intake(p_intake_id uuid)
returns table(
  intake_id uuid,converted_line_id uuid,batch_id uuid,sku text,product_name text,
  units_received numeric,suggested_location text,intake_status text
)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
#variable_conflict error
declare
  v_intake public.ecoflow_unknown_barcode_intakes%rowtype;
  v_identity record;
  v_line record;
begin
  if not public.ecoflow_can_manage_warehouse() then raise exception using errcode='42501',message='OWNER_ADMIN_OR_WAREHOUSE_REQUIRED'; end if;
  select i.* into v_intake from public.ecoflow_unknown_barcode_intakes i where i.id=p_intake_id for update;
  if not found then raise exception 'unknown barcode intake not found'; end if;

  if v_intake.intake_status='CONVERTED' and v_intake.converted_line_id is not null then
    return query
    select i.id,i.converted_line_id,i.batch_id,l.sku,l.product_name,l.units_received,l.suggested_location,i.intake_status
    from public.ecoflow_unknown_barcode_intakes i join public.ecoflow_warehouse_receiving_lines l on l.id=i.converted_line_id
    where i.id=p_intake_id;
    return;
  end if;
  if v_intake.intake_status='CANCELLED' then raise exception 'cancelled unknown barcode intake cannot be converted'; end if;

  select * into v_identity from public.ecoflow_resolve_operational_barcode(v_intake.barcode,null) limit 1;
  if v_identity.resolution_status<>'RESOLVED' then
    raise exception 'CANONICAL_BARCODE_NOT_READY_FOR_CONVERSION: %',v_identity.resolution_status;
  end if;

  select scanned.* into v_line
  from public.ecoflow_stage_receiving_scan_v2(
    v_intake.batch_id,v_intake.barcode,v_intake.qty_packages,null,
    coalesce(v_intake.intake_note,'Converted from TEMP unknown-barcode intake'),
    'unknown-intake:'||v_intake.id::text,coalesce(v_intake.client_scanned_at,v_intake.scanned_at)
  ) scanned limit 1;

  update public.ecoflow_unknown_barcode_intakes i
  set intake_status='CONVERTED',converted_line_id=v_line.line_id,converted_by=auth.uid(),converted_at=now()
  where i.id=p_intake_id;
  insert into public.ecoflow_warehouse_receiving_audit(batch_id,line_id,action,detail)
  values(v_intake.batch_id,v_line.line_id,'UNKNOWN_BARCODE_CONVERTED_CANONICAL',v_intake.barcode||' · '||v_line.sku);

  return query
  select i.id,i.converted_line_id,i.batch_id,l.sku,l.product_name,l.units_received,l.suggested_location,i.intake_status
  from public.ecoflow_unknown_barcode_intakes i join public.ecoflow_warehouse_receiving_lines l on l.id=i.converted_line_id
  where i.id=p_intake_id;
end;
$$;

revoke all on function public.ecoflow_stage_unknown_barcode_intake(uuid,text,numeric,text,text,timestamptz)
  from public,anon,authenticated;
revoke all on function public.ecoflow_convert_unknown_barcode_intake(uuid)
  from public,anon,authenticated;
grant execute on function public.ecoflow_stage_unknown_barcode_intake(uuid,text,numeric,text,text,timestamptz) to authenticated;
grant execute on function public.ecoflow_convert_unknown_barcode_intake(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Pick: preserve the proven stock-deduction implementation and its locking/
-- quantity behaviour, but put canonical identity validation in front of it.
-- The preserved implementation is private to the function owner.
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regprocedure('public.ecoflow_record_pick_movement_precanonical_20260809(text,numeric,text,text,text)') is null then
    alter function public.ecoflow_record_pick_movement(text,numeric,text,text,text)
      rename to ecoflow_record_pick_movement_precanonical_20260809;
  end if;
end $$;

revoke all on function public.ecoflow_record_pick_movement_precanonical_20260809(text,numeric,text,text,text)
  from public,anon,authenticated;

create function public.ecoflow_record_pick_movement(
  p_sku text,p_quantity numeric,p_unit_level text default 'carton',p_barcode text default null,p_note text default null
)
returns table(location_code text,sku text,picked_quantity numeric,remaining_quantity numeric)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
#variable_conflict error
declare
  v_identity record;
  v_unit text:=upper(btrim(coalesce(p_unit_level,'')));
begin
  if not public.ecoflow_can_manage_warehouse() then raise exception using errcode='42501',message='OWNER_ADMIN_OR_WAREHOUSE_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_barcode,'')),'') is null then raise exception 'CANONICAL_BARCODE_REQUIRED_FOR_PICK'; end if;

  select * into v_identity from public.ecoflow_resolve_operational_barcode(p_barcode,p_sku) limit 1;
  if v_identity.resolution_status='UNKNOWN' then raise exception 'CANONICAL_BARCODE_UNKNOWN: pick blocked'; end if;
  if v_identity.resolution_status='RETIRED' then raise exception 'BARCODE_RETIRED: pick blocked'; end if;
  if v_identity.resolution_status<>'RESOLVED' then
    raise exception 'CANONICAL_PICK_IDENTITY_MISMATCH: %',v_identity.resolution_status;
  end if;
  if v_unit not in ('UNKNOWN',upper(v_identity.package_level)) then
    raise exception 'CANONICAL_PICK_PACKAGE_MISMATCH: scanned % package for % pick',v_identity.package_level,p_unit_level;
  end if;

  return query
  select r.location_code,r.sku,r.picked_quantity,r.remaining_quantity
  from public.ecoflow_record_pick_movement_precanonical_20260809(
    p_sku,p_quantity,p_unit_level,v_identity.barcode,p_note
  ) r;
end;
$$;

revoke all on function public.ecoflow_record_pick_movement(text,numeric,text,text,text)
  from public,anon,authenticated;
grant execute on function public.ecoflow_record_pick_movement(text,numeric,text,text,text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Returns: RESTOCK quantity derives only from canonical package units. A barcode
-- supplied for any inspection action must be canonical; manual description with
-- no barcode remains allowed for non-restock claim/disposal evidence.
-- ---------------------------------------------------------------------------

create or replace function public.ecoflow_record_return_inspection_item(
  p_exception_id uuid,
  p_resolution text,
  p_barcode text default null,
  p_qty_packages numeric default 1,
  p_target_location text default null,
  p_manual_item text default null,
  p_note text default null,
  p_inspected_by text default null
)
returns table(
  inspection_line_id uuid,resolution text,sku text,units_processed numeric,
  target_location text,movement_id uuid,inspected_at timestamptz
)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
#variable_conflict error
declare
  v_role text:=public.ecoflow_active_app_role();
  v_action text:=upper(btrim(coalesce(p_resolution,'')));
  v_exception public.ecoflow_delivery_exceptions%rowtype;
  v_identity record;
  v_packages numeric:=coalesce(p_qty_packages,1);
  v_units numeric:=0;
  v_location text;
  v_movement uuid;
  v_line uuid;
  v_actor text;
  v_code text:=nullif(btrim(coalesce(p_barcode,'')),'');
begin
  if auth.uid() is null or v_role not in ('WAREHOUSE','OWNER','ADMIN') then
    raise exception using errcode='42501',message='RETURN_INSPECTION_WAREHOUSE_ROLE_REQUIRED';
  end if;
  if v_action not in ('RESTOCK','SUPPLIER_CLAIM','DISPOSE') then raise exception 'invalid return resolution'; end if;
  if v_packages<=0 or v_packages<>trunc(v_packages) then raise exception 'quantity must be a positive whole number'; end if;

  select e.* into v_exception from public.ecoflow_delivery_exceptions e where e.id=p_exception_id for update;
  if not found then raise exception 'return item not found'; end if;
  if v_exception.return_status not in ('DROPPED_IN_RETURN_ZONE','RETURNED_TO_WAREHOUSE','INSPECTION_HOLD') then
    raise exception 'return must be physically in the returns area before inspection';
  end if;

  if v_code is not null then
    select * into v_identity from public.ecoflow_resolve_operational_barcode(v_code,null) limit 1;
    if v_identity.resolution_status='UNKNOWN' then raise exception 'CANONICAL_BARCODE_UNKNOWN: return inspection blocked'; end if;
    if v_identity.resolution_status='RETIRED' then raise exception 'BARCODE_RETIRED: return inspection blocked'; end if;
    if v_identity.resolution_status<>'RESOLVED' then raise exception 'CANONICAL_RETURN_IDENTITY_BLOCKED: %',v_identity.resolution_status; end if;
  end if;

  if v_action='RESTOCK' and v_code is null then raise exception 'CANONICAL_BARCODE_REQUIRED_FOR_RESTOCK'; end if;
  if v_code is null and nullif(btrim(coalesce(p_manual_item,'')),'') is null then raise exception 'scan a barcode or describe the returned item'; end if;

  if v_code is not null then
    v_units:=v_packages*v_identity.units_in_base_unit;
    v_location:=coalesce(
      nullif(btrim(coalesce(p_target_location,'')),''),
      (select nullif(btrim(coalesce(c.fixed_shelf,'')),'') from public.ecoflow_inventory_sku_controls c where upper(c.sku)=upper(v_identity.commercial_sku_code) limit 1),
      (select nullif(btrim(coalesce(pp.default_shelf,'')),'') from public.ecoflow_sku_package_policies pp where upper(pp.sku)=upper(v_identity.commercial_sku_code) limit 1)
    );
  else
    v_units:=v_packages;
    v_location:=nullif(btrim(coalesce(p_target_location,'')),'');
  end if;

  if v_action='RESTOCK' and v_location is null then raise exception 'restock location is required'; end if;

  if v_action='RESTOCK' then
    insert into public.ecoflow_inventory_movements(
      sku,product_name,movement_type,quantity,to_location,reference_type,reference_id,
      action_note,source,moved_by,moved_at
    ) values(
      v_identity.commercial_sku_code,coalesce(v_identity.commercial_name,v_identity.physical_name),
      'RETURN_IN',v_units,v_location,'DELIVERY_RETURN',p_exception_id::text,
      nullif(btrim(coalesce(p_note,'')),''),'RETURN_INSPECTION',auth.uid(),now()
    ) returning id into v_movement;
  end if;

  v_actor:=format('%s:%s',v_role,auth.uid()::text);
  insert into public.ecoflow_delivery_return_inspection_lines(
    exception_id,resolution,barcode,sku,product_name,package_level,qty_packages,
    units_per_package,units_processed,target_location,movement_id,manual_item,
    inspection_note,inspected_by
  ) values(
    p_exception_id,v_action,v_code,
    case when v_code is null then null else v_identity.commercial_sku_code end,
    case when v_code is null then null else coalesce(v_identity.commercial_name,v_identity.physical_name) end,
    case when v_code is null then null else v_identity.package_level end,
    v_packages,case when v_code is null then 1 else v_identity.units_in_base_unit end,
    v_units,v_location,v_movement,nullif(btrim(coalesce(p_manual_item,'')),''),
    nullif(btrim(coalesce(p_note,'')),''),v_actor
  ) returning id into v_line;

  update public.ecoflow_delivery_exceptions e set return_status='INSPECTION_HOLD' where e.id=p_exception_id;

  return query
  select l.id,l.resolution,l.sku,l.units_processed,l.target_location,l.movement_id,l.inspected_at
  from public.ecoflow_delivery_return_inspection_lines l where l.id=v_line;
end;
$$;

revoke all on function public.ecoflow_record_return_inspection_item(uuid,text,text,numeric,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.ecoflow_record_return_inspection_item(uuid,text,text,numeric,text,text,text,text)
  to authenticated;

comment on function public.ecoflow_resolve_operational_barcode(text,text) is
  'Single warehouse barcode authority: published physical identity plus active Commercial SKU family contract. Read-only.';
comment on function public.ecoflow_record_barcode_scan(uuid,text,text,text,numeric,text,text,numeric,text,text) is
  'Compatibility scan evidence only. Never creates barcode identity and never changes inventory quantity.';
comment on function public.ecoflow_stage_receiving_scan_v2(uuid,text,numeric,text,text,text,timestamptz) is
  'Stages canonical receiving identity only. Quantity changes only when the receiving batch is explicitly posted.';
comment on function public.ecoflow_record_pick_movement(text,numeric,text,text,text) is
  'Canonical barcode/family validation gate in front of the existing warehouse stock deduction implementation.';
comment on function public.ecoflow_record_return_inspection_item(uuid,text,text,numeric,text,text,text,text) is
  'Return inspection uses canonical physical barcode authority; only explicit RESTOCK changes quantity.';

notify pgrst,'reload schema';
commit;
