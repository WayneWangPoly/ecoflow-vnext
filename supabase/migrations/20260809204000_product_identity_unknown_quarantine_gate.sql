-- TRANSFORM-005: finish canonical Product Identity authority across the
-- unknown-barcode receiving quarantine lifecycle.
--
-- Unknown physical goods may still be recorded in TEMP without changing stock,
-- but legacy ecoflow_sku_barcode_registry is no longer allowed to decide when a
-- barcode is mapped or convertible. Publication in canonical Product Identity is
-- the only path from UNKNOWN quarantine to a normal receiving line.

begin;

-- Keep the canonical staged-receiving implementation private, but preserve the
-- historical BARCODE_NOT_MAPPED error token expected by the current warehouse UI
-- when the canonical resolver reports UNKNOWN.
do $$
begin
  if to_regprocedure('public.ecoflow_stage_receiving_scan_canonical_20260809(uuid,text,numeric,text,text,text,timestamptz)') is null then
    alter function public.ecoflow_stage_receiving_scan_v2(uuid,text,numeric,text,text,text,timestamptz)
      rename to ecoflow_stage_receiving_scan_canonical_20260809;
  end if;
end $$;

revoke all on function public.ecoflow_stage_receiving_scan_canonical_20260809(uuid,text,numeric,text,text,text,timestamptz)
  from public, anon, authenticated;

create or replace function public.ecoflow_stage_receiving_scan_v2(
  p_batch_id uuid,
  p_barcode text,
  p_qty_packages numeric default 1,
  p_target_location text default null,
  p_note text default null,
  p_idempotency_key text default null,
  p_client_scanned_at timestamptz default now()
)
returns table(
  line_id uuid,
  batch_id uuid,
  sku text,
  product_name text,
  barcode text,
  package_level text,
  qty_packages numeric,
  units_received numeric,
  suggested_location text,
  confirmation_checked boolean,
  line_status text,
  scanned_at timestamptz
)
language plpgsql
security definer
set search_path=public
as $$
begin
  begin
    return query
    select *
    from public.ecoflow_stage_receiving_scan_canonical_20260809(
      p_batch_id,
      p_barcode,
      p_qty_packages,
      p_target_location,
      p_note,
      p_idempotency_key,
      p_client_scanned_at
    );
  exception when others then
    if position('CANONICAL_BARCODE_UNKNOWN' in sqlerrm)>0 then
      raise exception 'BARCODE_NOT_MAPPED: CANONICAL_BARCODE_UNKNOWN';
    end if;
    raise;
  end;
end;
$$;

revoke all on function public.ecoflow_stage_receiving_scan_v2(uuid,text,numeric,text,text,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.ecoflow_stage_receiving_scan_v2(uuid,text,numeric,text,text,text,timestamptz)
  to authenticated;

create or replace function public.ecoflow_stage_unknown_barcode_intake(
  p_batch_id uuid,
  p_barcode text,
  p_qty_packages numeric default 1,
  p_note text default null,
  p_idempotency_key text default null,
  p_client_scanned_at timestamptz default now()
)
returns table(
  intake_id uuid,
  batch_id uuid,
  barcode text,
  qty_packages numeric,
  target_location text,
  intake_status text,
  scanned_at timestamptz
)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_batch public.ecoflow_warehouse_receiving_batches%rowtype;
  v_barcode text:=nullif(trim(coalesce(p_barcode,'')),'');
  v_key text:=nullif(trim(coalesce(p_idempotency_key,'')),'');
  v_resolution record;
  v_id uuid;
begin
  if not public.ecoflow_can_manage_warehouse() then raise exception 'OWNER_ADMIN_OR_WAREHOUSE_REQUIRED'; end if;
  if p_batch_id is null then raise exception 'receiving batch is required'; end if;
  if v_barcode is null then raise exception 'barcode is required'; end if;
  if v_key is null then raise exception 'idempotency key is required'; end if;
  if coalesce(p_qty_packages,0)<=0 or p_qty_packages<>trunc(p_qty_packages) then
    raise exception 'package quantity must be a positive whole number';
  end if;

  select b.* into v_batch
  from public.ecoflow_warehouse_receiving_batches b
  where b.id=p_batch_id
  for update;
  if not found then raise exception 'receiving batch not found'; end if;
  if v_batch.batch_status not in ('SCANNING','READY_TO_POST') then
    raise exception 'receiving batch is not open: %',v_batch.batch_status;
  end if;

  select * into v_resolution
  from public.ecoflow_resolve_operational_barcode(v_barcode,null);

  if v_resolution.resolution_status='RESOLVED' then
    raise exception 'BARCODE_NOW_MAPPED: retry the normal receiving scan';
  end if;
  if v_resolution.resolution_status='RETIRED' then
    raise exception 'BARCODE_RETIRED: scan the current packaging code';
  end if;
  if v_resolution.resolution_status<>'UNKNOWN' then
    raise exception 'CANONICAL_BARCODE_RESOLUTION_INVALID';
  end if;

  insert into public.ecoflow_unknown_barcode_intakes(
    batch_id,barcode,qty_packages,target_location,intake_note,intake_status,
    idempotency_key,client_scanned_at,scanned_by,scanned_at
  ) values(
    p_batch_id,v_barcode,p_qty_packages,'TEMP',nullif(trim(coalesce(p_note,'')),''),
    'PENDING_MAPPING',v_key,p_client_scanned_at,auth.uid(),now()
  )
  on conflict(batch_id,idempotency_key) do update set
    intake_note=coalesce(excluded.intake_note,public.ecoflow_unknown_barcode_intakes.intake_note)
  returning id into v_id;

  update public.ecoflow_warehouse_receiving_batches
  set batch_status='SCANNING',updated_at=now()
  where id=p_batch_id;

  insert into public.ecoflow_warehouse_receiving_audit(batch_id,action,detail)
  values(p_batch_id,'UNKNOWN_BARCODE_QUARANTINED',v_barcode || ' · ' || p_qty_packages::text || ' packages · TEMP');

  return query
  select i.id,i.batch_id,i.barcode,i.qty_packages,i.target_location,i.intake_status,i.scanned_at
  from public.ecoflow_unknown_barcode_intakes i
  where i.id=v_id;
end;
$$;

create or replace function public.ecoflow_convert_unknown_barcode_intake(p_intake_id uuid)
returns table(
  intake_id uuid,
  converted_line_id uuid,
  batch_id uuid,
  sku text,
  product_name text,
  units_received numeric,
  suggested_location text,
  intake_status text
)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_intake public.ecoflow_unknown_barcode_intakes%rowtype;
  v_resolution record;
  v_line record;
begin
  if not public.ecoflow_can_manage_warehouse() then raise exception 'OWNER_ADMIN_OR_WAREHOUSE_REQUIRED'; end if;

  select i.* into v_intake
  from public.ecoflow_unknown_barcode_intakes i
  where i.id=p_intake_id
  for update;
  if not found then raise exception 'unknown barcode intake not found'; end if;

  if v_intake.intake_status='CONVERTED' and v_intake.converted_line_id is not null then
    return query
    select i.id,i.converted_line_id,i.batch_id,l.sku,l.product_name,l.units_received,l.suggested_location,i.intake_status
    from public.ecoflow_unknown_barcode_intakes i
    join public.ecoflow_warehouse_receiving_lines l on l.id=i.converted_line_id
    where i.id=p_intake_id;
    return;
  end if;
  if v_intake.intake_status='CANCELLED' then
    raise exception 'cancelled unknown barcode intake cannot be converted';
  end if;

  select * into v_resolution
  from public.ecoflow_resolve_operational_barcode(v_intake.barcode,null);

  if v_resolution.resolution_status='UNKNOWN' then
    raise exception 'BARCODE_STILL_UNMAPPED: publish the physical barcode in Product Identity first';
  end if;
  if v_resolution.resolution_status='RETIRED' then
    raise exception 'BARCODE_RETIRED: scan the current packaging code';
  end if;
  if v_resolution.resolution_status<>'RESOLVED' then
    raise exception 'CANONICAL_BARCODE_RESOLUTION_INVALID';
  end if;

  select scanned.* into v_line
  from public.ecoflow_stage_receiving_scan_v2(
    v_intake.batch_id,
    v_intake.barcode,
    v_intake.qty_packages,
    null,
    coalesce(v_intake.intake_note,'Converted from TEMP unknown-barcode intake'),
    'unknown-intake:' || v_intake.id::text,
    coalesce(v_intake.client_scanned_at,v_intake.scanned_at)
  ) scanned
  limit 1;

  update public.ecoflow_unknown_barcode_intakes
  set intake_status='CONVERTED',
      converted_line_id=v_line.line_id,
      converted_by=auth.uid(),
      converted_at=now(),
      updated_at=now()
  where id=p_intake_id;

  insert into public.ecoflow_warehouse_receiving_audit(batch_id,line_id,action,detail)
  values(v_intake.batch_id,v_line.line_id,'UNKNOWN_BARCODE_CONVERTED',v_intake.barcode || ' · ' || v_line.sku);

  return query
  select i.id,i.converted_line_id,i.batch_id,l.sku,l.product_name,l.units_received,l.suggested_location,i.intake_status
  from public.ecoflow_unknown_barcode_intakes i
  join public.ecoflow_warehouse_receiving_lines l on l.id=i.converted_line_id
  where i.id=p_intake_id;
end;
$$;

revoke all on function public.ecoflow_stage_unknown_barcode_intake(uuid,text,numeric,text,text,timestamptz)
  from public, anon, authenticated;
revoke all on function public.ecoflow_convert_unknown_barcode_intake(uuid)
  from public, anon, authenticated;
grant execute on function public.ecoflow_stage_unknown_barcode_intake(uuid,text,numeric,text,text,timestamptz)
  to authenticated;
grant execute on function public.ecoflow_convert_unknown_barcode_intake(uuid)
  to authenticated;

comment on function public.ecoflow_stage_unknown_barcode_intake(uuid,text,numeric,text,text,timestamptz)
  is 'Canonical Product Identity TEMP quarantine. UNKNOWN only; never mutates stock quantity.';
comment on function public.ecoflow_convert_unknown_barcode_intake(uuid)
  is 'Converts TEMP evidence only after canonical Product Identity publication.';

notify pgrst,'reload schema';
commit;