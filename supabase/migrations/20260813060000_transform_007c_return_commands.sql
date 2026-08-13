-- TRANSFORM-007C: authoritative Returns disposition and close commands.
--
-- Contract:
--   * ecoflow_delivery_exceptions remains the return-case authority;
--   * every case mutation carries a monotonic revision, including legacy physical
--     warehouse-receipt updates, so CAS cannot be bypassed by an older page;
--   * inspected dispositions and close are available only through command RPCs;
--   * UUID command id + request fingerprint provide idempotent replay and reject
--     a reused id with different intent;
--   * actor identity/role come from auth, never client-supplied text;
--   * RESTOCK must create and reference a governed RETURN_IN inventory movement;
--   * non-restock dispositions are explicit and cannot fabricate a movement;
--   * accepted commands append immutable before/after audit evidence.

begin;

do $preflight$
declare
  v_missing text[]:=array[]::text[];
  v_name text;
begin
  foreach v_name in array array[
    'public.ecoflow_delivery_exceptions',
    'public.ecoflow_delivery_return_inspection_lines',
    'public.ecoflow_delivery_return_scans',
    'public.ecoflow_inventory_movements',
    'public.ecoflow_sku_barcode_registry',
    'public.ecoflow_warehouse_locations'
  ] loop
    if to_regclass(v_name) is null then
      v_missing:=array_append(v_missing,v_name);
    end if;
  end loop;

  foreach v_name in array array[
    'public.ecoflow_active_app_role()',
    'public.ecoflow_record_inventory_movement(text,text,numeric,text,text,text,text,text,text,text)',
    'public.ecoflow_record_return_inspection_item(uuid,text,text,numeric,text,text,text,text)',
    'public.ecoflow_complete_return_inspection(uuid,text,text)'
  ] loop
    if to_regprocedure(v_name) is null then
      v_missing:=array_append(v_missing,v_name);
    end if;
  end loop;

  if cardinality(v_missing)>0 then
    raise exception 'TRANSFORM_007C_PREREQUISITES_MISSING:%',array_to_string(v_missing,', ');
  end if;
end;
$preflight$;

-- Revision belongs to the existing return authority instead of a parallel state
-- table. Existing cases start at revision 0; every subsequent UPDATE advances it.
alter table public.ecoflow_delivery_exceptions
  add column if not exists revision bigint;
update public.ecoflow_delivery_exceptions set revision=0 where revision is null;
alter table public.ecoflow_delivery_exceptions
  alter column revision set default 0,
  alter column revision set not null;
alter table public.ecoflow_delivery_exceptions
  drop constraint if exists ecoflow_delivery_exceptions_revision_nonnegative;
alter table public.ecoflow_delivery_exceptions
  add constraint ecoflow_delivery_exceptions_revision_nonnegative check(revision>=0);

create or replace function public.ecoflow_bump_return_revision_v1()
returns trigger
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
begin
  new.revision:=old.revision+1;
  return new;
end;
$$;

revoke all on function public.ecoflow_bump_return_revision_v1()
  from public,anon,authenticated,service_role;

drop trigger if exists trg_delivery_exceptions_007c_revision
  on public.ecoflow_delivery_exceptions;
create trigger trg_delivery_exceptions_007c_revision
before update on public.ecoflow_delivery_exceptions
for each row execute function public.ecoflow_bump_return_revision_v1();

create table public.ecoflow_return_commands(
  command_id uuid primary key,
  exception_id uuid not null references public.ecoflow_delivery_exceptions(id),
  command_type text not null check(command_type in('RECORD_DISPOSITION','CLOSE_RETURN')),
  disposition text check(disposition in('RESTOCK','SUPPLIER_CLAIM','DISPOSE')),
  expected_revision bigint not null check(expected_revision>=0),
  result_revision bigint not null,
  actor_user_id uuid not null,
  actor_role text not null check(actor_role in('OWNER','ADMIN','WAREHOUSE')),
  device_id text not null,
  note text not null,
  evidence jsonb not null,
  request_fingerprint text not null,
  inspection_line_id uuid references public.ecoflow_delivery_return_inspection_lines(id),
  inventory_movement_id uuid references public.ecoflow_inventory_movements(id),
  before_state jsonb not null,
  after_state jsonb not null,
  occurred_at timestamptz not null default clock_timestamp(),
  constraint ecoflow_return_commands_revision_step check(result_revision=expected_revision+1),
  constraint ecoflow_return_commands_device_bounded check(char_length(device_id) between 1 and 128),
  constraint ecoflow_return_commands_note_bounded check(char_length(note) between 1 and 1000),
  constraint ecoflow_return_commands_evidence_object check(
    jsonb_typeof(evidence)='object' and evidence<>'{}'::jsonb and octet_length(evidence::text)<=12000
  ),
  constraint ecoflow_return_commands_shape check(
    (command_type='RECORD_DISPOSITION' and disposition is not null and inspection_line_id is not null)
    or (command_type='CLOSE_RETURN' and disposition is null and inspection_line_id is null)
  ),
  constraint ecoflow_return_commands_movement_shape check(
    (command_type='RECORD_DISPOSITION' and disposition='RESTOCK' and inventory_movement_id is not null)
    or (coalesce(disposition,'')<>'RESTOCK' and inventory_movement_id is null)
  )
);

create index ecoflow_return_commands_exception_time_idx
  on public.ecoflow_return_commands(exception_id,occurred_at desc);

alter table public.ecoflow_return_commands enable row level security;
revoke all on table public.ecoflow_return_commands
  from public,anon,authenticated,service_role;
grant select on table public.ecoflow_return_commands to service_role;

create or replace function public.ecoflow_block_return_command_mutation_v1()
returns trigger
language plpgsql
security invoker
set search_path=pg_catalog
as $$
begin
  raise exception 'RETURN_COMMAND_AUDIT_APPEND_ONLY';
end;
$$;
revoke all on function public.ecoflow_block_return_command_mutation_v1()
  from public,anon,authenticated,service_role;

drop trigger if exists trg_return_commands_append_only on public.ecoflow_return_commands;
create trigger trg_return_commands_append_only
before update or delete on public.ecoflow_return_commands
for each row execute function public.ecoflow_block_return_command_mutation_v1();

-- Canonical command-state projection validates the actual restock movement
-- binding instead of treating a non-null movement_id as sufficient proof.
create or replace view public.v_ecoflow_return_command_state_v1 as
select
  e.id as exception_id,
  e.return_code,
  e.business_day,
  e.order_id,
  e.order_number,
  e.store_name,
  e.outcome,
  e.return_status,
  e.warehouse_location,
  e.revision,
  e.recorded_at,
  e.warehouse_received_at,
  e.driver_returned_at,
  e.inspection_completed_at,
  e.updated_at,
  (e.return_status in(
    'DROPPED_IN_RETURN_ZONE','RETURNED_TO_WAREHOUSE','INSPECTION_HOLD',
    'RESTOCKED','SUPPLIER_CLAIM','DISPOSED','MIXED_RESOLUTION'
  )) as physically_received,
  case
    when e.return_status='WITH_DRIVER' then 'REPORTED'
    when e.return_status in('DROPPED_IN_RETURN_ZONE','RETURNED_TO_WAREHOUSE') then 'RECEIVED'
    when e.return_status='INSPECTION_HOLD' then 'INSPECTED'
    else 'CLOSED'
  end as lifecycle_stage,
  coalesce(ix.inspection_line_count,0) as inspection_line_count,
  coalesce(ix.dispositions,array[]::text[]) as dispositions,
  coalesce(ix.inventory_consequence_status,'MISSING') as inventory_consequence_status,
  ix.latest_inventory_movement_id
from public.ecoflow_delivery_exceptions e
left join lateral(
  select
    count(*)::bigint as inspection_line_count,
    array_agg(distinct l.resolution order by l.resolution) as dispositions,
    (array_agg(l.movement_id order by l.inspected_at desc) filter(where l.movement_id is not null))[1]
      as latest_inventory_movement_id,
    case
      when count(*)=0 then 'MISSING'
      when count(*) filter(
        where l.resolution='RESTOCK' and (
          l.movement_id is null
          or not exists(
            select 1 from public.ecoflow_inventory_movements m
            where m.id=l.movement_id
              and m.movement_type='RETURN_IN'
              and m.reference_type='DELIVERY_RETURN'
              and m.reference_id=e.id::text
              and upper(btrim(m.sku))=upper(btrim(coalesce(l.sku,'')))
              and m.quantity=l.units_processed
              and nullif(btrim(coalesce(m.to_location,'')),'')
                  is not distinct from nullif(btrim(coalesce(l.target_location,'')),'')
          )
        )
      )>0 then 'INVALID'
      when count(*) filter(where l.resolution<>'RESTOCK' and l.movement_id is not null)>0 then 'INVALID'
      else 'EXPLICIT'
    end as inventory_consequence_status
  from public.ecoflow_delivery_return_inspection_lines l
  where l.exception_id=e.id
) ix on true
where e.return_code is not null;

revoke all on table public.v_ecoflow_return_command_state_v1
  from public,anon,authenticated;
grant select on table public.v_ecoflow_return_command_state_v1 to service_role;

create or replace function public.ecoflow_read_return_state_v1(p_return_id text)
returns table(
  exception_id uuid,
  return_code text,
  return_status text,
  lifecycle_stage text,
  physically_received boolean,
  revision bigint,
  inspection_line_count bigint,
  dispositions text[],
  inventory_consequence_status text,
  latest_inventory_movement_id uuid,
  warehouse_location text,
  updated_at timestamptz,
  inspection_completed_at timestamptz
)
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
declare
  v_actor_id uuid:=auth.uid();
  v_actor_role text:=public.ecoflow_active_app_role();
  v_return_id text:=nullif(btrim(coalesce(p_return_id,'')),'');
begin
  if v_actor_id is null then raise exception 'RETURN_COMMAND_AUTH_REQUIRED'; end if;
  if v_actor_role is null or v_actor_role not in('OWNER','ADMIN','WAREHOUSE') then
    raise exception using errcode='42501',message='RETURN_COMMAND_ROLE_FORBIDDEN';
  end if;
  if v_return_id is null or char_length(v_return_id)>180 then
    raise exception 'RETURN_COMMAND_RETURN_ID_INVALID';
  end if;

  return query
  select s.exception_id,s.return_code,s.return_status,s.lifecycle_stage,
    s.physically_received,s.revision,s.inspection_line_count,s.dispositions,
    s.inventory_consequence_status,s.latest_inventory_movement_id,
    s.warehouse_location,s.updated_at,s.inspection_completed_at
  from public.v_ecoflow_return_command_state_v1 s
  where s.exception_id::text=v_return_id or s.return_code=v_return_id
  limit 1;
end;
$$;

create or replace function public.ecoflow_record_return_disposition_v1(
  p_return_id text,
  p_disposition text,
  p_barcode text,
  p_qty_packages numeric,
  p_target_location text,
  p_manual_item text,
  p_expected_revision bigint,
  p_idempotency_key uuid,
  p_device_id text,
  p_note text,
  p_evidence jsonb
)
returns table(
  accepted boolean,replayed boolean,status text,command_id uuid,command_type text,
  exception_id uuid,return_code text,return_status text,revision bigint,
  lifecycle_stage text,inspection_line_id uuid,inventory_movement_id uuid,
  inventory_consequence_status text,occurred_at timestamptz
)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
#variable_conflict error
declare
  v_actor_id uuid:=auth.uid();
  v_actor_role text:=public.ecoflow_active_app_role();
  v_return_id text:=nullif(btrim(coalesce(p_return_id,'')),'');
  v_disposition text:=upper(nullif(btrim(coalesce(p_disposition,'')),''));
  v_barcode text:=nullif(btrim(coalesce(p_barcode,'')),'');
  v_target_location text:=nullif(btrim(coalesce(p_target_location,'')),'');
  v_manual_item text:=nullif(btrim(coalesce(p_manual_item,'')),'');
  v_device_id text:=nullif(btrim(coalesce(p_device_id,'')),'');
  v_note text:=nullif(btrim(coalesce(p_note,'')),'');
  v_evidence jsonb:=coalesce(p_evidence,'{}'::jsonb);
  v_qty numeric:=coalesce(p_qty_packages,0);
  v_exception public.ecoflow_delivery_exceptions%rowtype;
  v_registry public.ecoflow_sku_barcode_registry%rowtype;
  v_existing public.ecoflow_return_commands%rowtype;
  v_fingerprint text;
  v_units numeric;
  v_units_per_package numeric:=1;
  v_sku text;
  v_product_name text;
  v_package_level text;
  v_inspection_line_id uuid;
  v_movement_id uuid;
  v_before jsonb;
  v_after jsonb;
  v_applied_at timestamptz;
  v_state record;
begin
  if v_actor_id is null then raise exception 'RETURN_COMMAND_AUTH_REQUIRED'; end if;
  if v_actor_role is null or v_actor_role not in('OWNER','ADMIN','WAREHOUSE') then
    raise exception using errcode='42501',message='RETURN_COMMAND_ROLE_FORBIDDEN';
  end if;
  if v_return_id is null or char_length(v_return_id)>180 then raise exception 'RETURN_COMMAND_RETURN_ID_INVALID'; end if;
  if v_disposition not in('RESTOCK','SUPPLIER_CLAIM','DISPOSE') then raise exception 'RETURN_DISPOSITION_INVALID'; end if;
  if v_qty<=0 then raise exception 'RETURN_DISPOSITION_QUANTITY_INVALID'; end if;
  if p_expected_revision is null or p_expected_revision<0 then raise exception 'RETURN_COMMAND_REVISION_INVALID'; end if;
  if p_idempotency_key is null then raise exception 'RETURN_COMMAND_IDEMPOTENCY_REQUIRED'; end if;
  if v_device_id is null or char_length(v_device_id)>128 then raise exception 'RETURN_COMMAND_DEVICE_INVALID'; end if;
  if v_note is null or char_length(v_note)>1000 then raise exception 'RETURN_COMMAND_NOTE_REQUIRED'; end if;
  if jsonb_typeof(v_evidence)<>'object' or v_evidence='{}'::jsonb or octet_length(v_evidence::text)>12000 then
    raise exception 'RETURN_COMMAND_EVIDENCE_REQUIRED';
  end if;
  if v_disposition='RESTOCK' and v_barcode is null then raise exception 'RETURN_RESTOCK_BARCODE_REQUIRED'; end if;
  if v_disposition='RESTOCK' and v_target_location is null then raise exception 'RETURN_RESTOCK_LOCATION_REQUIRED'; end if;
  if v_disposition<>'RESTOCK' and v_barcode is null and v_manual_item is null then
    raise exception 'RETURN_DISPOSITION_ITEM_EVIDENCE_REQUIRED';
  end if;

  select e.* into v_exception
  from public.ecoflow_delivery_exceptions e
  where e.id::text=v_return_id or e.return_code=v_return_id
  limit 1;
  if not found then raise exception 'RETURN_COMMAND_NOT_FOUND'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ecoflow_return_command:'||p_idempotency_key::text,0)
  );

  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_object(
    'returnId',v_exception.id,'commandType','RECORD_DISPOSITION',
    'disposition',v_disposition,'barcode',v_barcode,'qtyPackages',v_qty,
    'targetLocation',v_target_location,'manualItem',v_manual_item,
    'expectedRevision',p_expected_revision,'deviceId',v_device_id,
    'note',v_note,'evidence',v_evidence
  )::text);

  select c.* into v_existing from public.ecoflow_return_commands c
  where c.command_id=p_idempotency_key;
  if found then
    if v_existing.actor_user_id<>v_actor_id or v_existing.request_fingerprint<>v_fingerprint then
      raise exception 'RETURN_COMMAND_IDEMPOTENCY_CONFLICT';
    end if;
    return query select true,true,'REPLAYED'::text,v_existing.command_id,
      v_existing.command_type,v_existing.exception_id,
      nullif(v_existing.after_state->>'returnCode',''),
      nullif(v_existing.after_state->>'returnStatus',''),v_existing.result_revision,
      nullif(v_existing.after_state->>'lifecycleStage',''),
      v_existing.inspection_line_id,v_existing.inventory_movement_id,
      nullif(v_existing.after_state->>'inventoryConsequenceStatus',''),v_existing.occurred_at;
    return;
  end if;

  select e.* into v_exception from public.ecoflow_delivery_exceptions e
  where e.id=v_exception.id for update;

  if v_exception.revision<>p_expected_revision then
    select * into v_state from public.v_ecoflow_return_command_state_v1 s where s.exception_id=v_exception.id;
    return query select false,false,'CONFLICT'::text,p_idempotency_key,
      'RECORD_DISPOSITION'::text,v_state.exception_id,v_state.return_code,
      v_state.return_status,v_state.revision,v_state.lifecycle_stage,null::uuid,
      null::uuid,v_state.inventory_consequence_status,null::timestamptz;
    return;
  end if;

  if v_exception.return_status not in('DROPPED_IN_RETURN_ZONE','RETURNED_TO_WAREHOUSE','INSPECTION_HOLD') then
    raise exception 'RETURN_DISPOSITION_PHYSICAL_RECEIPT_REQUIRED';
  end if;

  if v_barcode is not null then
    select r.* into v_registry
    from public.ecoflow_sku_barcode_registry r
    where r.barcode=v_barcode and r.is_active
    order by r.last_scanned_at desc nulls last,r.id
    limit 1;
  end if;

  if v_disposition='RESTOCK' and v_registry.id is null then raise exception 'RETURN_RESTOCK_MAPPED_BARCODE_REQUIRED'; end if;
  if v_registry.id is null and v_manual_item is null then raise exception 'RETURN_DISPOSITION_MAPPED_OR_MANUAL_ITEM_REQUIRED'; end if;

  if v_disposition='RESTOCK' and not exists(
    select 1 from public.ecoflow_warehouse_locations l
    where upper(btrim(l.location_code))=upper(v_target_location) and l.status='ACTIVE'
  ) then
    raise exception 'RETURN_RESTOCK_LOCATION_INVALID';
  end if;

  if v_registry.id is not null then
    v_sku:=v_registry.sku;
    v_product_name:=v_registry.product_name;
    v_package_level:=v_registry.package_level;
    v_units_per_package:=greatest(coalesce(v_registry.units_per_barcode,1),1);
    v_units:=v_qty*v_units_per_package;
  else
    v_units:=v_qty;
  end if;

  select to_jsonb(s) into v_before from public.v_ecoflow_return_command_state_v1 s
  where s.exception_id=v_exception.id;

  if v_disposition='RESTOCK' then
    select m.movement_id into v_movement_id
    from public.ecoflow_record_inventory_movement(
      v_sku,'RETURN_IN',v_units,null,v_target_location,'DELIVERY_RETURN',
      v_exception.id::text,null,v_note,'RETURN_INSPECTION_007C'
    ) m;
    if v_movement_id is null then raise exception 'RETURN_RESTOCK_MOVEMENT_NOT_CREATED'; end if;
  end if;

  insert into public.ecoflow_delivery_return_inspection_lines(
    exception_id,resolution,barcode,sku,product_name,package_level,qty_packages,
    units_per_package,units_processed,target_location,movement_id,manual_item,
    inspection_note,inspected_by,inspected_at
  ) values(
    v_exception.id,v_disposition,v_barcode,v_sku,v_product_name,v_package_level,
    v_qty,v_units_per_package,v_units,
    case when v_disposition='RESTOCK' then v_target_location else null end,
    v_movement_id,case when v_registry.id is null then v_manual_item else null end,
    v_note,format('%s:%s',v_actor_role,v_actor_id::text),clock_timestamp()
  ) returning id into v_inspection_line_id;

  update public.ecoflow_delivery_exceptions e
  set return_status='INSPECTION_HOLD',inspection_note=v_note,updated_at=clock_timestamp()
  where e.id=v_exception.id;

  select * into v_state from public.v_ecoflow_return_command_state_v1 s where s.exception_id=v_exception.id;
  if v_state.revision<>p_expected_revision+1 then raise exception 'RETURN_COMMAND_REVISION_STEP_INVALID'; end if;
  if v_disposition='RESTOCK' and v_state.inventory_consequence_status<>'EXPLICIT' then
    raise exception 'RETURN_RESTOCK_MOVEMENT_BINDING_INVALID';
  end if;

  v_applied_at:=clock_timestamp();
  select to_jsonb(s) into v_after from public.v_ecoflow_return_command_state_v1 s
  where s.exception_id=v_exception.id;

  insert into public.ecoflow_return_commands(
    command_id,exception_id,command_type,disposition,expected_revision,result_revision,
    actor_user_id,actor_role,device_id,note,evidence,request_fingerprint,
    inspection_line_id,inventory_movement_id,before_state,after_state,occurred_at
  ) values(
    p_idempotency_key,v_exception.id,'RECORD_DISPOSITION',v_disposition,
    p_expected_revision,v_state.revision,v_actor_id,v_actor_role,v_device_id,
    v_note,v_evidence,v_fingerprint,v_inspection_line_id,v_movement_id,
    v_before,v_after,v_applied_at
  );

  return query select true,false,'APPLIED'::text,p_idempotency_key,
    'RECORD_DISPOSITION'::text,v_state.exception_id,v_state.return_code,
    v_state.return_status,v_state.revision,v_state.lifecycle_stage,
    v_inspection_line_id,v_movement_id,v_state.inventory_consequence_status,v_applied_at;
end;
$$;

create or replace function public.ecoflow_close_return_v1(
  p_return_id text,
  p_expected_revision bigint,
  p_idempotency_key uuid,
  p_device_id text,
  p_note text,
  p_evidence jsonb
)
returns table(
  accepted boolean,replayed boolean,status text,command_id uuid,command_type text,
  exception_id uuid,return_code text,return_status text,revision bigint,
  lifecycle_stage text,inspection_line_id uuid,inventory_movement_id uuid,
  inventory_consequence_status text,occurred_at timestamptz
)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
#variable_conflict error
declare
  v_actor_id uuid:=auth.uid();
  v_actor_role text:=public.ecoflow_active_app_role();
  v_return_id text:=nullif(btrim(coalesce(p_return_id,'')),'');
  v_device_id text:=nullif(btrim(coalesce(p_device_id,'')),'');
  v_note text:=nullif(btrim(coalesce(p_note,'')),'');
  v_evidence jsonb:=coalesce(p_evidence,'{}'::jsonb);
  v_exception public.ecoflow_delivery_exceptions%rowtype;
  v_existing public.ecoflow_return_commands%rowtype;
  v_fingerprint text;
  v_distinct bigint;
  v_resolution text;
  v_before jsonb;
  v_after jsonb;
  v_applied_at timestamptz;
  v_state record;
begin
  if v_actor_id is null then raise exception 'RETURN_COMMAND_AUTH_REQUIRED'; end if;
  if v_actor_role is null or v_actor_role not in('OWNER','ADMIN','WAREHOUSE') then
    raise exception using errcode='42501',message='RETURN_COMMAND_ROLE_FORBIDDEN';
  end if;
  if v_return_id is null or char_length(v_return_id)>180 then raise exception 'RETURN_COMMAND_RETURN_ID_INVALID'; end if;
  if p_expected_revision is null or p_expected_revision<0 then raise exception 'RETURN_COMMAND_REVISION_INVALID'; end if;
  if p_idempotency_key is null then raise exception 'RETURN_COMMAND_IDEMPOTENCY_REQUIRED'; end if;
  if v_device_id is null or char_length(v_device_id)>128 then raise exception 'RETURN_COMMAND_DEVICE_INVALID'; end if;
  if v_note is null or char_length(v_note)>1000 then raise exception 'RETURN_COMMAND_NOTE_REQUIRED'; end if;
  if jsonb_typeof(v_evidence)<>'object' or v_evidence='{}'::jsonb or octet_length(v_evidence::text)>12000 then
    raise exception 'RETURN_COMMAND_EVIDENCE_REQUIRED';
  end if;

  select e.* into v_exception from public.ecoflow_delivery_exceptions e
  where e.id::text=v_return_id or e.return_code=v_return_id limit 1;
  if not found then raise exception 'RETURN_COMMAND_NOT_FOUND'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ecoflow_return_command:'||p_idempotency_key::text,0)
  );
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_object(
    'returnId',v_exception.id,'commandType','CLOSE_RETURN',
    'expectedRevision',p_expected_revision,'deviceId',v_device_id,
    'note',v_note,'evidence',v_evidence
  )::text);

  select c.* into v_existing from public.ecoflow_return_commands c where c.command_id=p_idempotency_key;
  if found then
    if v_existing.actor_user_id<>v_actor_id or v_existing.request_fingerprint<>v_fingerprint then
      raise exception 'RETURN_COMMAND_IDEMPOTENCY_CONFLICT';
    end if;
    return query select true,true,'REPLAYED'::text,v_existing.command_id,
      v_existing.command_type,v_existing.exception_id,
      nullif(v_existing.after_state->>'returnCode',''),
      nullif(v_existing.after_state->>'returnStatus',''),v_existing.result_revision,
      nullif(v_existing.after_state->>'lifecycleStage',''),null::uuid,null::uuid,
      nullif(v_existing.after_state->>'inventoryConsequenceStatus',''),v_existing.occurred_at;
    return;
  end if;

  select e.* into v_exception from public.ecoflow_delivery_exceptions e
  where e.id=v_exception.id for update;
  if v_exception.revision<>p_expected_revision then
    select * into v_state from public.v_ecoflow_return_command_state_v1 s where s.exception_id=v_exception.id;
    return query select false,false,'CONFLICT'::text,p_idempotency_key,'CLOSE_RETURN'::text,
      v_state.exception_id,v_state.return_code,v_state.return_status,v_state.revision,
      v_state.lifecycle_stage,null::uuid,null::uuid,v_state.inventory_consequence_status,
      null::timestamptz;
    return;
  end if;

  if v_exception.return_status<>'INSPECTION_HOLD' then raise exception 'RETURN_CLOSE_INSPECTION_REQUIRED'; end if;

  select * into v_state from public.v_ecoflow_return_command_state_v1 s where s.exception_id=v_exception.id;
  if v_state.inspection_line_count=0 then raise exception 'RETURN_CLOSE_DISPOSITION_REQUIRED'; end if;
  if v_state.inventory_consequence_status<>'EXPLICIT' then raise exception 'RETURN_CLOSE_CONSEQUENCE_REQUIRED'; end if;

  select count(distinct l.resolution) into v_distinct
  from public.ecoflow_delivery_return_inspection_lines l where l.exception_id=v_exception.id;
  if v_distinct>1 then v_resolution:='MIXED_RESOLUTION';
  else
    select case l.resolution when 'RESTOCK' then 'RESTOCKED'
      when 'SUPPLIER_CLAIM' then 'SUPPLIER_CLAIM' when 'DISPOSE' then 'DISPOSED' end
    into v_resolution
    from public.ecoflow_delivery_return_inspection_lines l
    where l.exception_id=v_exception.id limit 1;
  end if;
  if v_resolution is null then raise exception 'RETURN_CLOSE_CONSEQUENCE_REQUIRED'; end if;

  select to_jsonb(s) into v_before from public.v_ecoflow_return_command_state_v1 s
  where s.exception_id=v_exception.id;
  v_applied_at:=clock_timestamp();

  update public.ecoflow_delivery_exceptions e
  set return_status=v_resolution,inspection_note=v_note,
      inspection_completed_by=format('%s:%s',v_actor_role,v_actor_id::text),
      inspection_completed_at=v_applied_at,updated_at=v_applied_at
  where e.id=v_exception.id;

  insert into public.ecoflow_delivery_return_scans(
    exception_id,return_code,scan_action,warehouse_location,scan_note,scanned_by,scanned_at
  ) values(
    v_exception.id,coalesce(v_exception.return_code,'NO-RET-CODE'),v_resolution,
    v_exception.warehouse_location,v_note,
    format('%s:%s',v_actor_role,v_actor_id::text),v_applied_at
  );

  select * into v_state from public.v_ecoflow_return_command_state_v1 s where s.exception_id=v_exception.id;
  if v_state.revision<>p_expected_revision+1 then raise exception 'RETURN_COMMAND_REVISION_STEP_INVALID'; end if;
  if v_state.lifecycle_stage<>'CLOSED' or v_state.inventory_consequence_status<>'EXPLICIT' then
    raise exception 'RETURN_CLOSE_AUTHORITATIVE_STATE_INVALID';
  end if;
  select to_jsonb(s) into v_after from public.v_ecoflow_return_command_state_v1 s
  where s.exception_id=v_exception.id;

  insert into public.ecoflow_return_commands(
    command_id,exception_id,command_type,disposition,expected_revision,result_revision,
    actor_user_id,actor_role,device_id,note,evidence,request_fingerprint,
    inspection_line_id,inventory_movement_id,before_state,after_state,occurred_at
  ) values(
    p_idempotency_key,v_exception.id,'CLOSE_RETURN',null,p_expected_revision,
    v_state.revision,v_actor_id,v_actor_role,v_device_id,v_note,v_evidence,
    v_fingerprint,null,null,v_before,v_after,v_applied_at
  );

  return query select true,false,'APPLIED'::text,p_idempotency_key,'CLOSE_RETURN'::text,
    v_state.exception_id,v_state.return_code,v_state.return_status,v_state.revision,
    v_state.lifecycle_stage,null::uuid,null::uuid,v_state.inventory_consequence_status,
    v_applied_at;
end;
$$;

create or replace function public.ecoflow_recover_return_command_v1(p_idempotency_key uuid)
returns table(
  accepted boolean,replayed boolean,status text,command_id uuid,command_type text,
  exception_id uuid,return_code text,return_status text,revision bigint,
  lifecycle_stage text,inspection_line_id uuid,inventory_movement_id uuid,
  inventory_consequence_status text,occurred_at timestamptz
)
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
declare
  v_actor_id uuid:=auth.uid();
  v_actor_role text:=public.ecoflow_active_app_role();
begin
  if v_actor_id is null then raise exception 'RETURN_COMMAND_AUTH_REQUIRED'; end if;
  if v_actor_role is null or v_actor_role not in('OWNER','ADMIN','WAREHOUSE') then
    raise exception using errcode='42501',message='RETURN_COMMAND_ROLE_FORBIDDEN';
  end if;
  if p_idempotency_key is null then raise exception 'RETURN_COMMAND_IDEMPOTENCY_REQUIRED'; end if;

  return query
  select true,true,'REPLAYED'::text,c.command_id,c.command_type,c.exception_id,
    nullif(c.after_state->>'returnCode',''),nullif(c.after_state->>'returnStatus',''),
    c.result_revision,nullif(c.after_state->>'lifecycleStage',''),
    c.inspection_line_id,c.inventory_movement_id,
    nullif(c.after_state->>'inventoryConsequenceStatus',''),c.occurred_at
  from public.ecoflow_return_commands c
  where c.command_id=p_idempotency_key and c.actor_user_id=v_actor_id;
end;
$$;

-- Retire only the legacy inspection/closure mutation entry points. Driver drop
-- and warehouse physical-receipt RPCs remain available and their UPDATEs now
-- advance revision automatically through the trigger above.
revoke execute on function public.ecoflow_record_return_inspection_item(uuid,text,text,numeric,text,text,text,text)
  from authenticated;
revoke execute on function public.ecoflow_complete_return_inspection(uuid,text,text)
  from authenticated;

-- Reassert direct-table denial for command-owned state.
revoke insert,update,delete,truncate,trigger,maintain
  on table public.ecoflow_delivery_exceptions,
           public.ecoflow_delivery_return_inspection_lines,
           public.ecoflow_return_commands
  from public,anon,authenticated;

revoke all on function public.ecoflow_read_return_state_v1(text) from public,anon;
revoke all on function public.ecoflow_record_return_disposition_v1(text,text,text,numeric,text,text,bigint,uuid,text,text,jsonb) from public,anon;
revoke all on function public.ecoflow_close_return_v1(text,bigint,uuid,text,text,jsonb) from public,anon;
revoke all on function public.ecoflow_recover_return_command_v1(uuid) from public,anon;

grant execute on function public.ecoflow_read_return_state_v1(text) to authenticated;
grant execute on function public.ecoflow_record_return_disposition_v1(text,text,text,numeric,text,text,bigint,uuid,text,text,jsonb) to authenticated;
grant execute on function public.ecoflow_close_return_v1(text,bigint,uuid,text,text,jsonb) to authenticated;
grant execute on function public.ecoflow_recover_return_command_v1(uuid) to authenticated;

comment on function public.ecoflow_record_return_disposition_v1(text,text,text,numeric,text,text,bigint,uuid,text,text,jsonb) is
  'TRANSFORM-007C CAS/idempotent inspected disposition command. RESTOCK creates a governed RETURN_IN movement.';
comment on function public.ecoflow_close_return_v1(text,bigint,uuid,text,text,jsonb) is
  'TRANSFORM-007C CAS/idempotent return closure command. Closure requires explicit valid consequences.';

notify pgrst,'reload schema';
commit;
