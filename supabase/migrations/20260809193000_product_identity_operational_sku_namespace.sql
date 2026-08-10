-- TRANSFORM-005 compatibility closure: canonical identity is internal, but the
-- deployed warehouse operational namespace is still the active Ordermentum SKU.
-- Keep identity authority canonical while preserving that operational key so
-- Receiving -> Inventory -> Pick and Returns remain connected end to end.

begin;

create or replace function public.ecoflow_operational_sku_code(p_commercial_sku_code text)
returns text
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
#variable_conflict error
declare
  v_internal text:=nullif(btrim(coalesce(p_commercial_sku_code,'')),'');
  v_external text;
  v_count integer;
begin
  if v_internal is null then return null; end if;
  select count(*),min(m.external_product_code::text)
  into v_count,v_external
  from public.skus s
  join public.external_product_mappings m on m.internal_sku_id=s.id
  where upper(s.sku_code::text)=upper(v_internal)
    and m.provider='ORDERMENTUM'
    and m.is_active;
  -- A unique active Ordermentum mapping is the deployed warehouse key. If the
  -- mapping itself is ambiguous, do not choose an arbitrary external code.
  return case when v_count=1 then v_external else v_internal end;
end;
$$;

revoke all on function public.ecoflow_operational_sku_code(text) from public,anon,authenticated;

-- Preserve the canonical staging implementation behind a private primitive and
-- normalize only its operational SKU/location compatibility in the same DB tx.
do $$
begin
  if to_regprocedure('public.ecoflow_stage_receiving_scan_v2_canonical_20260809(uuid,text,numeric,text,text,text,timestamptz)') is null then
    alter function public.ecoflow_stage_receiving_scan_v2(uuid,text,numeric,text,text,text,timestamptz)
      rename to ecoflow_stage_receiving_scan_v2_canonical_20260809;
  end if;
end $$;

revoke all on function public.ecoflow_stage_receiving_scan_v2_canonical_20260809(uuid,text,numeric,text,text,text,timestamptz)
  from public,anon,authenticated;

create function public.ecoflow_stage_receiving_scan_v2(
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
  v_line record;
  v_operational_sku text;
  v_location text;
begin
  if not public.ecoflow_can_manage_warehouse() then
    raise exception using errcode='42501',message='OWNER_ADMIN_OR_WAREHOUSE_REQUIRED';
  end if;

  select * into v_line
  from public.ecoflow_stage_receiving_scan_v2_canonical_20260809(
    p_batch_id,p_barcode,p_qty_packages,p_target_location,p_note,p_idempotency_key,p_client_scanned_at
  ) limit 1;

  v_operational_sku:=public.ecoflow_operational_sku_code(v_line.sku);
  v_location:=v_line.suggested_location;
  if nullif(btrim(coalesce(p_target_location,'')),'') is null
     and upper(coalesce(v_location,''))='TEMP'
     and v_operational_sku is not null then
    v_location:=coalesce(
      (select nullif(btrim(coalesce(c.fixed_shelf,'')),'') from public.ecoflow_inventory_sku_controls c where upper(c.sku)=upper(v_operational_sku) limit 1),
      (select nullif(btrim(coalesce(pp.default_shelf,'')),'') from public.ecoflow_sku_package_policies pp where upper(pp.sku)=upper(v_operational_sku) limit 1),
      v_location
    );
    if not exists(select 1 from public.ecoflow_warehouse_locations wl where upper(wl.location_code)=upper(v_location) and wl.status='ACTIVE') then
      v_location:=v_line.suggested_location;
    end if;
  end if;

  update public.ecoflow_warehouse_receiving_lines l
  set sku=coalesce(v_operational_sku,l.sku),suggested_location=coalesce(v_location,l.suggested_location),updated_at=now()
  where l.id=v_line.line_id;

  return query
  select l.id,l.batch_id,l.sku,l.product_name,l.barcode,l.package_level,l.qty_packages,
    l.units_received,l.suggested_location,l.confirmation_checked,l.line_status,l.scanned_at
  from public.ecoflow_warehouse_receiving_lines l where l.id=v_line.line_id;
end;
$$;

revoke all on function public.ecoflow_stage_receiving_scan_v2(uuid,text,numeric,text,text,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.ecoflow_stage_receiving_scan_v2(uuid,text,numeric,text,text,text,timestamptz)
  to authenticated;

-- Unknown-intake conversion was compiled against the previous stage function
-- OID/name. Recreate it so conversion always re-enters the public canonical+
-- namespace wrapper instead of the renamed private primitive.
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

revoke all on function public.ecoflow_convert_unknown_barcode_intake(uuid) from public,anon,authenticated;
grant execute on function public.ecoflow_convert_unknown_barcode_intake(uuid) to authenticated;

-- Return identity/quantity decision remains inside the canonical implementation;
-- normalize the resulting operational SKU atomically before exposing the result.
do $$
begin
  if to_regprocedure('public.ecoflow_record_return_inspection_item_canonical_20260809(uuid,text,text,numeric,text,text,text,text)') is null then
    alter function public.ecoflow_record_return_inspection_item(uuid,text,text,numeric,text,text,text,text)
      rename to ecoflow_record_return_inspection_item_canonical_20260809;
  end if;
end $$;

revoke all on function public.ecoflow_record_return_inspection_item_canonical_20260809(uuid,text,text,numeric,text,text,text,text)
  from public,anon,authenticated;

create function public.ecoflow_record_return_inspection_item(
  p_exception_id uuid,p_resolution text,p_barcode text default null,p_qty_packages numeric default 1,
  p_target_location text default null,p_manual_item text default null,p_note text default null,p_inspected_by text default null
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
  v_line record;
  v_operational_sku text;
begin
  if auth.uid() is null or public.ecoflow_active_app_role() not in ('WAREHOUSE','OWNER','ADMIN') then
    raise exception using errcode='42501',message='RETURN_INSPECTION_WAREHOUSE_ROLE_REQUIRED';
  end if;

  select * into v_line
  from public.ecoflow_record_return_inspection_item_canonical_20260809(
    p_exception_id,p_resolution,p_barcode,p_qty_packages,p_target_location,p_manual_item,p_note,p_inspected_by
  ) limit 1;

  if v_line.sku is not null then
    v_operational_sku:=public.ecoflow_operational_sku_code(v_line.sku);
    update public.ecoflow_delivery_return_inspection_lines l
      set sku=coalesce(v_operational_sku,l.sku)
      where l.id=v_line.inspection_line_id;
    if v_line.movement_id is not null then
      update public.ecoflow_inventory_movements m
        set sku=coalesce(v_operational_sku,m.sku)
        where m.id=v_line.movement_id;
    end if;
  end if;

  return query
  select l.id,l.resolution,l.sku,l.units_processed,l.target_location,l.movement_id,l.inspected_at
  from public.ecoflow_delivery_return_inspection_lines l where l.id=v_line.inspection_line_id;
end;
$$;

revoke all on function public.ecoflow_record_return_inspection_item(uuid,text,text,numeric,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.ecoflow_record_return_inspection_item(uuid,text,text,numeric,text,text,text,text)
  to authenticated;

comment on function public.ecoflow_operational_sku_code(text) is
  'Preserves the unique active Ordermentum warehouse SKU key while canonical Product Identity remains internal authority.';

notify pgrst,'reload schema';
commit;
