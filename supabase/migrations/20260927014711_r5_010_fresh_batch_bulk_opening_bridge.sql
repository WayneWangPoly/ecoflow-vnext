-- ECOFLOW-R5-010 — Fresh Batch Bulk Opening Bridge
--
-- Server-authoritative PREVIEW/APPLY bridge for migration opening balances from
-- the latest SEALED ADL1 Unleashed inventory reference.
--
-- This migration itself creates no opening balance. Inventory authority is
-- created only by ecoflow_apply_r5_010_bulk_opening(), after a manifest-bound
-- Owner/Admin acknowledgement. The APPLY path reuses the incumbent INITIAL
-- stocktake approval machinery and records UNLEASHED_MIGRATION_REFERENCE
-- provenance separately from physical counts.

begin;

do $deps$
begin
  if to_regclass('public.ecoflow_unleashed_inventory_reference_batches') is null
     or to_regclass('public.ecoflow_unleashed_inventory_reference_rows') is null
     or to_regclass('public.ecoflow_stocktake_sessions') is null
     or to_regclass('public.ecoflow_stocktake_observations') is null
     or to_regclass('public.ecoflow_stocktake_location_progress') is null
     or to_regclass('public.ecoflow_warehouse_locations') is null
     or to_regclass('public.ecoflow_warehouse_location_items') is null
     or to_regclass('public.ecoflow_warehouse_movements') is null
     or to_regclass('public.ecoflow_inventory_movements') is null
     or to_regprocedure('public.ecoflow_submit_stocktake_session(uuid,text,uuid)') is null
     or to_regprocedure('public.ecoflow_approve_stocktake_session(uuid,bigint,text,uuid)') is null
     or to_regprocedure('public.ecoflow_active_app_role()') is null then
    raise exception 'R5_010_DEPENDENCIES_MISSING';
  end if;
end;
$deps$;

alter table public.ecoflow_warehouse_locations
  add column if not exists location_semantics text not null default 'PHYSICAL';

do $constraint$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname='ecoflow_warehouse_locations_location_semantics_check'
      and conrelid='public.ecoflow_warehouse_locations'::regclass
  ) then
    alter table public.ecoflow_warehouse_locations
      add constraint ecoflow_warehouse_locations_location_semantics_check
      check (location_semantics in ('PHYSICAL','MIGRATION_HOLDING'));
  end if;
end;
$constraint$;

insert into public.ecoflow_warehouse_locations (
  location_code,rack_id,rack_title,side,display_level,category,zone,
  location_type,status,sort_order,location_semantics
) values (
  'MIGRATION-UNASSIGNED','MIGRATION','Migration holding','front',
  'Migration holding · location not yet physically assigned',
  'Migration','ADL1_MIGRATION','AREA','ACTIVE',9900,'MIGRATION_HOLDING'
)
on conflict (location_code) do update set
  rack_id=excluded.rack_id,
  rack_title=excluded.rack_title,
  side=excluded.side,
  display_level=excluded.display_level,
  category=excluded.category,
  zone=excluded.zone,
  location_type=excluded.location_type,
  status=excluded.status,
  sort_order=excluded.sort_order,
  location_semantics='MIGRATION_HOLDING',
  updated_at=clock_timestamp();

alter table public.ecoflow_stocktake_observations
  add column if not exists evidence_type text not null default 'PHYSICAL_COUNT',
  add column if not exists source_reference_batch_id uuid,
  add column if not exists source_reference_row_id uuid,
  add column if not exists source_row_sha256 text,
  add column if not exists source_manifest_sha256 text,
  add column if not exists source_command_id uuid;

do $constraint$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname='ecoflow_stocktake_observation_evidence_type_check'
      and conrelid='public.ecoflow_stocktake_observations'::regclass
  ) then
    alter table public.ecoflow_stocktake_observations
      add constraint ecoflow_stocktake_observation_evidence_type_check
      check (evidence_type in ('PHYSICAL_COUNT','UNLEASHED_MIGRATION_REFERENCE'));
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname='ecoflow_stocktake_migration_reference_provenance_check'
      and conrelid='public.ecoflow_stocktake_observations'::regclass
  ) then
    alter table public.ecoflow_stocktake_observations
      add constraint ecoflow_stocktake_migration_reference_provenance_check
      check (
        evidence_type<>'UNLEASHED_MIGRATION_REFERENCE'
        or (
          source_reference_batch_id is not null
          and source_reference_row_id is not null
          and source_row_sha256 ~ '^[0-9a-f]{64}$'
          and source_manifest_sha256 ~ '^[0-9a-f]{64}$'
          and source_command_id is not null
        )
      );
  end if;
end;
$constraint$;

create unique index if not exists ecoflow_stocktake_migration_reference_row_once
  on public.ecoflow_stocktake_observations(source_reference_row_id)
  where evidence_type='UNLEASHED_MIGRATION_REFERENCE';

create table if not exists public.ecoflow_r5_010_opening_commands (
  command_id uuid primary key,
  actor_user_id uuid not null,
  actor_role text not null check (actor_role in ('OWNER','ADMIN')),
  reference_batch_id uuid not null,
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  request_payload_sha256 text not null check (request_payload_sha256 ~ '^[0-9a-f]{64}$'),
  stocktake_session_id uuid not null references public.ecoflow_stocktake_sessions(id) on delete restrict,
  selected_row_count integer not null check (selected_row_count>=0),
  positive_row_count integer not null check (positive_row_count>=0),
  zero_row_count integer not null check (zero_row_count>=0),
  positive_qty_total numeric not null check (positive_qty_total>=0),
  result jsonb not null check (jsonb_typeof(result)='object'),
  created_at timestamptz not null default clock_timestamp()
);

create table if not exists public.ecoflow_r5_010_inventory_movement_provenance (
  inventory_movement_id uuid primary key references public.ecoflow_inventory_movements(id) on delete restrict,
  reference_batch_id uuid not null,
  reference_row_id uuid not null,
  source_row_sha256 text not null check (source_row_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  command_id uuid not null,
  actor_user_id uuid not null,
  evidence_type text not null check (evidence_type='UNLEASHED_MIGRATION_REFERENCE'),
  created_at timestamptz not null default clock_timestamp(),
  unique(reference_row_id,inventory_movement_id)
);

create table if not exists public.ecoflow_r5_010_warehouse_movement_provenance (
  warehouse_movement_id uuid primary key references public.ecoflow_warehouse_movements(id) on delete restrict,
  reference_batch_id uuid not null,
  reference_row_id uuid not null,
  source_row_sha256 text not null check (source_row_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  command_id uuid not null,
  actor_user_id uuid not null,
  evidence_type text not null check (evidence_type='UNLEASHED_MIGRATION_REFERENCE'),
  created_at timestamptz not null default clock_timestamp(),
  unique(reference_row_id,warehouse_movement_id)
);

alter table public.ecoflow_r5_010_opening_commands enable row level security;
alter table public.ecoflow_r5_010_inventory_movement_provenance enable row level security;
alter table public.ecoflow_r5_010_warehouse_movement_provenance enable row level security;

revoke all on public.ecoflow_r5_010_opening_commands from public,anon,authenticated,service_role;
revoke all on public.ecoflow_r5_010_inventory_movement_provenance from public,anon,authenticated,service_role;
revoke all on public.ecoflow_r5_010_warehouse_movement_provenance from public,anon,authenticated,service_role;

grant select on public.ecoflow_r5_010_opening_commands to authenticated;
grant select on public.ecoflow_r5_010_inventory_movement_provenance to authenticated;
grant select on public.ecoflow_r5_010_warehouse_movement_provenance to authenticated;

drop policy if exists ecoflow_r5_010_opening_commands_read on public.ecoflow_r5_010_opening_commands;
create policy ecoflow_r5_010_opening_commands_read
  on public.ecoflow_r5_010_opening_commands
  for select to authenticated
  using ((select public.ecoflow_active_app_role()) in ('OWNER','ADMIN'));

drop policy if exists ecoflow_r5_010_inventory_provenance_read on public.ecoflow_r5_010_inventory_movement_provenance;
create policy ecoflow_r5_010_inventory_provenance_read
  on public.ecoflow_r5_010_inventory_movement_provenance
  for select to authenticated
  using ((select public.ecoflow_active_app_role()) in ('OWNER','ADMIN'));

drop policy if exists ecoflow_r5_010_warehouse_provenance_read on public.ecoflow_r5_010_warehouse_movement_provenance;
create policy ecoflow_r5_010_warehouse_provenance_read
  on public.ecoflow_r5_010_warehouse_movement_provenance
  for select to authenticated
  using ((select public.ecoflow_active_app_role()) in ('OWNER','ADMIN'));

create or replace function public.ecoflow_r5_010_prevent_audit_mutation()
returns trigger
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
begin
  raise exception 'R5_010_AUDIT_IMMUTABLE';
end;
$$;

drop trigger if exists ecoflow_r5_010_opening_commands_immutable on public.ecoflow_r5_010_opening_commands;
create trigger ecoflow_r5_010_opening_commands_immutable
before update or delete on public.ecoflow_r5_010_opening_commands
for each row execute function public.ecoflow_r5_010_prevent_audit_mutation();

drop trigger if exists ecoflow_r5_010_inventory_provenance_immutable on public.ecoflow_r5_010_inventory_movement_provenance;
create trigger ecoflow_r5_010_inventory_provenance_immutable
before update or delete on public.ecoflow_r5_010_inventory_movement_provenance
for each row execute function public.ecoflow_r5_010_prevent_audit_mutation();

drop trigger if exists ecoflow_r5_010_warehouse_provenance_immutable on public.ecoflow_r5_010_warehouse_movement_provenance;
create trigger ecoflow_r5_010_warehouse_provenance_immutable
before update or delete on public.ecoflow_r5_010_warehouse_movement_provenance
for each row execute function public.ecoflow_r5_010_prevent_audit_mutation();

-- One SKU/unit write lock shared by receiving, stocktake approval and transfer
-- because all quantity authority converges on ecoflow_warehouse_location_items.
create or replace function public.ecoflow_lock_warehouse_sku_write()
returns trigger
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
declare
  v_new_key text;
  v_old_key text;
begin
  v_new_key := 'warehouse-sku-write:'||upper(btrim(new.sku))||':'||lower(btrim(new.unit_level));
  if tg_op='UPDATE' then
    v_old_key := 'warehouse-sku-write:'||upper(btrim(old.sku))||':'||lower(btrim(old.unit_level));
    if v_old_key<>v_new_key then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(least(v_old_key,v_new_key),0));
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(greatest(v_old_key,v_new_key),0));
      return new;
    end if;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_new_key,0));
  return new;
end;
$$;

drop trigger if exists ecoflow_warehouse_location_items_sku_write_lock
  on public.ecoflow_warehouse_location_items;
create trigger ecoflow_warehouse_location_items_sku_write_lock
before insert or update on public.ecoflow_warehouse_location_items
for each row execute function public.ecoflow_lock_warehouse_sku_write();

-- Attach immutable source provenance to every inventory movement produced by
-- stocktake approval from R5-010 migration-reference observations.
create or replace function public.ecoflow_r5_010_capture_inventory_movement_provenance()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_session_id uuid;
  v_obs public.ecoflow_stocktake_observations%rowtype;
  v_location text;
begin
  if new.reference_type<>'OPENING_STOCKTAKE'
     or new.source<>'STOCKTAKE_APPROVAL'
     or new.reference_id is null
     or new.reference_id !~ '^STOCKTAKE:[0-9a-fA-F-]{36}$' then
    return new;
  end if;

  v_session_id := substring(new.reference_id from 11)::uuid;
  v_location := coalesce(new.to_location,new.from_location);

  select o.* into v_obs
  from public.ecoflow_stocktake_observations o
  where o.session_id=v_session_id
    and o.evidence_type='UNLEASHED_MIGRATION_REFERENCE'
    and upper(o.sku)=upper(new.sku)
    and o.location_code=v_location
  order by o.observed_at,o.id
  limit 1;

  if not found then return new; end if;

  insert into public.ecoflow_r5_010_inventory_movement_provenance(
    inventory_movement_id,reference_batch_id,reference_row_id,source_row_sha256,
    manifest_sha256,command_id,actor_user_id,evidence_type
  ) values (
    new.id,v_obs.source_reference_batch_id,v_obs.source_reference_row_id,
    v_obs.source_row_sha256,v_obs.source_manifest_sha256,v_obs.source_command_id,
    coalesce(new.moved_by,v_obs.observed_by),'UNLEASHED_MIGRATION_REFERENCE'
  );
  return new;
end;
$$;

drop trigger if exists ecoflow_r5_010_inventory_movement_provenance_capture
  on public.ecoflow_inventory_movements;
create trigger ecoflow_r5_010_inventory_movement_provenance_capture
after insert on public.ecoflow_inventory_movements
for each row execute function public.ecoflow_r5_010_capture_inventory_movement_provenance();

create or replace function public.ecoflow_r5_010_capture_warehouse_movement_provenance()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_session_id uuid;
  v_obs public.ecoflow_stocktake_observations%rowtype;
begin
  if new.transfer_reference is null
     or new.transfer_reference !~ '^STOCKTAKE:[0-9a-fA-F-]{36}$' then
    return new;
  end if;

  v_session_id := substring(new.transfer_reference from 11)::uuid;
  select o.* into v_obs
  from public.ecoflow_stocktake_observations o
  where o.session_id=v_session_id
    and o.evidence_type='UNLEASHED_MIGRATION_REFERENCE'
    and upper(o.sku)=upper(new.sku)
    and o.location_id=coalesce(new.to_location_id,new.location_id,new.from_location_id)
  order by o.observed_at,o.id
  limit 1;

  if not found then return new; end if;

  insert into public.ecoflow_r5_010_warehouse_movement_provenance(
    warehouse_movement_id,reference_batch_id,reference_row_id,source_row_sha256,
    manifest_sha256,command_id,actor_user_id,evidence_type
  ) values (
    new.id,v_obs.source_reference_batch_id,v_obs.source_reference_row_id,
    v_obs.source_row_sha256,v_obs.source_manifest_sha256,v_obs.source_command_id,
    coalesce(new.actor_user_id,v_obs.observed_by),'UNLEASHED_MIGRATION_REFERENCE'
  );
  return new;
end;
$$;

drop trigger if exists ecoflow_r5_010_warehouse_movement_provenance_capture
  on public.ecoflow_warehouse_movements;
create trigger ecoflow_r5_010_warehouse_movement_provenance_capture
after insert on public.ecoflow_warehouse_movements
for each row execute function public.ecoflow_r5_010_capture_warehouse_movement_provenance();

create or replace function public.ecoflow_preview_r5_010_bulk_opening(
  p_expected_reference_batch_id uuid,
  p_reference_row_ids uuid[] default null,
  p_location_code text default 'MIGRATION-UNASSIGNED'
)
returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := public.ecoflow_active_app_role();
  v_batch public.ecoflow_unleashed_inventory_reference_batches%rowtype;
  v_location public.ecoflow_warehouse_locations%rowtype;
  v_rows jsonb;
  v_manifest text;
  v_requested_count integer;
  v_selected_count integer;
  v_executable_count integer;
  v_positive_count integer;
  v_zero_count integer;
  v_positive_qty numeric;
  v_ready_count integer;
  v_ready_positive_count integer;
  v_ready_zero_count integer;
  v_pending_product integer;
  v_ambiguous_product integer;
  v_pending_warehouse integer;
  v_ambiguous_warehouse integer;
  v_pending_identity integer;
  v_already_initialized integer;
begin
  if v_actor is null then raise exception 'R5_010_AUTH_REQUIRED'; end if;
  if v_role not in ('OWNER','ADMIN') then
    raise exception using errcode='42501',message='R5_010_OWNER_OR_ADMIN_REQUIRED';
  end if;
  if p_expected_reference_batch_id is null then
    raise exception 'R5_010_EXPECTED_REFERENCE_BATCH_REQUIRED';
  end if;

  select * into v_batch
  from public.ecoflow_unleashed_inventory_reference_batches
  where batch_status='SEALED'
  order by sealed_at desc nulls last,created_at desc,id desc
  limit 1;
  if not found
     or p_expected_reference_batch_id<>'9a1b323c-46fb-4478-87d0-94573819fe1c'::uuid
     or v_batch.id<>p_expected_reference_batch_id
     or v_batch.source_row_count<>428 then
    raise exception 'R5_010_LATEST_SEALED_REFERENCE_MISMATCH';
  end if;

  select * into v_location
  from public.ecoflow_warehouse_locations
  where upper(location_code)=upper(btrim(coalesce(p_location_code,'')))
    and status='ACTIVE'
  limit 1;
  if not found then raise exception 'R5_010_ACTIVE_LOCATION_REQUIRED'; end if;
  if upper(v_location.location_code)<>'MIGRATION-UNASSIGNED'
     or v_location.location_semantics<>'MIGRATION_HOLDING' then
    raise exception 'R5_010_MIGRATION_HOLDING_LOCATION_REQUIRED';
  end if;

  v_requested_count := case
    when p_reference_row_ids is null then null
    else coalesce(cardinality(p_reference_row_ids),0)
  end;

  select
    count(*) filter (where readiness_status='READY_FOR_LOCATION_EVIDENCE')::integer,
    count(*) filter (where readiness_status='READY_FOR_LOCATION_EVIDENCE' and qty_on_hand>0)::integer,
    count(*) filter (where readiness_status='READY_FOR_LOCATION_EVIDENCE' and qty_on_hand=0)::integer,
    count(*) filter (where readiness_status='PENDING_PRODUCT_MAPPING')::integer,
    count(*) filter (where readiness_status='AMBIGUOUS_PRODUCT_MAPPING')::integer,
    count(*) filter (where readiness_status='PENDING_WAREHOUSE_MAPPING')::integer,
    count(*) filter (where readiness_status='AMBIGUOUS_WAREHOUSE_MAPPING')::integer,
    count(*) filter (where readiness_status='PENDING_PHYSICAL_IDENTITY')::integer
  into v_ready_count,v_ready_positive_count,v_ready_zero_count,v_pending_product,v_ambiguous_product,
       v_pending_warehouse,v_ambiguous_warehouse,v_pending_identity
  from public.v_ecoflow_unleashed_inventory_reference_rows
  where batch_id=v_batch.id
    and source_warehouse_code='ADL1';

  select count(*)::integer into v_already_initialized
  from public.ecoflow_stocktake_observations o
  where o.evidence_type='UNLEASHED_MIGRATION_REFERENCE'
    and o.source_reference_batch_id=v_batch.id;

  with candidate as (
    select
      v.reference_row_id,
      v.batch_id,
      v.source_product_code,
      v.source_warehouse_code,
      v.qty_on_hand,
      v.source_row_sha256,
      v.source_set_sha256,
      v.source_run_id,
      v.commercial_sku_id,
      v.commercial_sku_code,
      v.preferred_physical_sku_context_id as physical_sku_id,
      p.physical_sku_code,
      p.display_name as physical_sku_name,
      pkg.package_count,
      pkg.package_id,
      pkg.units_per_package,
      bc.barcode_count,
      bc.barcode,
      coalesce(duplicate_guard.batch_physical_sku_count,0) as batch_physical_sku_count,
      coalesce(balance.current_carton_qty,0) as current_qty,
      coalesce(balance.live_balance_row_count,0) as live_balance_row_count,
      not exists (
        select 1 from public.ecoflow_stocktake_observations o
        where o.evidence_type='UNLEASHED_MIGRATION_REFERENCE'
          and o.source_reference_row_id=v.reference_row_id
      ) as not_initialized
    from public.v_ecoflow_unleashed_inventory_reference_rows v
    left join public.ecoflow_physical_skus p
      on p.id=v.preferred_physical_sku_context_id
     and p.identity_status='ACTIVE'
    left join lateral (
      select
        count(*)::integer as package_count,
        (array_agg(pp.id order by pp.id))[1] as package_id,
        (array_agg(pp.units_in_base_unit order by pp.id))[1] as units_per_package
      from public.ecoflow_physical_sku_packages pp
      where pp.physical_sku_id=v.preferred_physical_sku_context_id
        and pp.identity_status='ACTIVE'
        and upper(pp.package_level)='CARTON'
    ) pkg on true
    left join lateral (
      select
        count(*)::integer as barcode_count,
        (array_agg(b.barcode order by b.id))[1] as barcode
      from public.ecoflow_physical_barcode_bindings b
      where b.physical_sku_id=v.preferred_physical_sku_context_id
        and b.package_id=pkg.package_id
        and b.identity_status='ACTIVE'
    ) bc on true
    left join lateral (
      select count(*)::integer as batch_physical_sku_count
      from public.v_ecoflow_unleashed_inventory_reference_rows d
      where d.batch_id=v_batch.id
        and d.source_warehouse_code='ADL1'
        and upper(coalesce(d.warehouse_code,''))='MAIN'
        and d.reference_quantity_scope='UNLEASHED_WAREHOUSE_TOTAL'
        and d.readiness_status='READY_FOR_LOCATION_EVIDENCE'
        and d.preferred_physical_sku_context_id=v.preferred_physical_sku_context_id
    ) duplicate_guard on true
    left join lateral (
      select
        coalesce(sum(i.quantity) filter (where lower(i.unit_level)='carton'),0) as current_carton_qty,
        count(*) filter (where i.quantity<>0)::integer as live_balance_row_count
      from public.ecoflow_warehouse_location_items i
      where upper(i.sku)=upper(p.physical_sku_code)
        and i.status<>'ZEROED'
    ) balance on true
    where v.batch_id=v_batch.id
      and v.source_warehouse_code='ADL1'
      and upper(coalesce(v.warehouse_code,''))='MAIN'
      and v.reference_quantity_scope='UNLEASHED_WAREHOUSE_TOTAL'
      and v.readiness_status='READY_FOR_LOCATION_EVIDENCE'
      and v.product_mapping_count=1
      and v.product_mapping_status='MATCHED'
      and v.warehouse_mapping_count=1
      and v.warehouse_mapping_status='MATCHED'
      and v.physical_identity_link_count=1
      and v.substitution_policy='PROHIBITED'
      and v.qty_on_hand>=0
      and v.qty_on_hand=trunc(v.qty_on_hand)
      and coalesce(v.source_available_formula_delta,999999)=0
      and (p_reference_row_ids is null or v.reference_row_id=any(p_reference_row_ids))
      and (
        p_reference_row_ids is not null
        or not exists (
          select 1 from public.ecoflow_stocktake_observations opened
          where opened.evidence_type='UNLEASHED_MIGRATION_REFERENCE'
            and opened.source_reference_row_id=v.reference_row_id
        )
      )
  ),
  shaped as (
    select *,
      (
        not_initialized
        and physical_sku_id is not null
        and nullif(btrim(coalesce(physical_sku_code,'')),'') is not null
        and batch_physical_sku_count=1
        and package_count=1
        and package_id is not null
        and units_per_package is not null
        and units_per_package>0
        and units_per_package=trunc(units_per_package)
        and barcode_count=1
        and nullif(btrim(coalesce(barcode,'')),'') is not null
        and live_balance_row_count=0
      ) as executable
    from candidate
  ),
  agg as (
    select
      count(*)::integer as selected_count,
      count(*) filter (where executable)::integer as executable_count,
      count(*) filter (where executable and qty_on_hand>0)::integer as positive_count,
      count(*) filter (where executable and qty_on_hand=0)::integer as zero_count,
      coalesce(sum(qty_on_hand) filter (where executable and qty_on_hand>0),0) as positive_qty,
      coalesce(jsonb_agg(
        jsonb_build_object(
          'referenceRowId',reference_row_id,
          'referenceBatchId',batch_id,
          'sourceProductCode',source_product_code,
          'sourceWarehouseCode',source_warehouse_code,
          'sourceQtyOnHand',qty_on_hand,
          'sourceRowSha256',source_row_sha256,
          'sourceSetSha256',source_set_sha256,
          'sourceRunId',source_run_id,
          'commercialSkuId',commercial_sku_id,
          'commercialSkuCode',commercial_sku_code,
          'physicalSkuId',physical_sku_id,
          'physicalSkuCode',physical_sku_code,
          'physicalSkuName',physical_sku_name,
          'packageId',package_id,
          'packageLevel','CARTON',
          'unitsPerPackage',units_per_package,
          'barcode',barcode,
          'locationCode',v_location.location_code,
          'locationSemantics',v_location.location_semantics,
          'currentWarehouseCartonQty',current_qty,
          'liveWarehouseBalanceRowCount',live_balance_row_count,
          'alreadyInitialized',not not_initialized,
          'executable',executable,
          'blockReason',case
            when not not_initialized then 'ALREADY_INITIALIZED'
            when physical_sku_id is null or nullif(btrim(coalesce(physical_sku_code,'')),'') is null
              then 'ACTIVE_PHYSICAL_SKU_REQUIRED'
            when batch_physical_sku_count<>1 then 'DUPLICATE_BATCH_PHYSICAL_SKU'
            when package_count<>1 then 'CARTON_PACKAGE_IDENTITY_NOT_UNIQUE'
            when barcode_count<>1 then 'CARTON_BARCODE_IDENTITY_NOT_UNIQUE'
            when live_balance_row_count<>0 then 'LIVE_WAREHOUSE_BALANCE_ALREADY_EXISTS'
            else null
          end
        )
        order by source_product_code,reference_row_id
      ),'[]'::jsonb) as rows
    from shaped
  )
  select
    selected_count,executable_count,positive_count,zero_count,positive_qty,rows
  into
    v_selected_count,v_executable_count,v_positive_count,v_zero_count,v_positive_qty,v_rows
  from agg;

  v_manifest := pg_catalog.encode(
    extensions.digest(
      pg_catalog.jsonb_build_object(
        'referenceBatchId',v_batch.id,
        'sourceSetSha256',v_batch.source_set_sha256,
        'locationCode',v_location.location_code,
        'rows',coalesce((
          select jsonb_agg(x order by x->>'sourceProductCode',x->>'referenceRowId')
          from jsonb_array_elements(v_rows) x
          where coalesce((x->>'executable')::boolean,false)
        ),'[]'::jsonb)
      )::text,
      'sha256'
    ),
    'hex'
  );

  return jsonb_build_object(
    'referenceBatchId',v_batch.id,
    'referenceBatchStatus',v_batch.batch_status,
    'referenceBatchRevision',v_batch.revision,
    'sourceRunId',v_batch.source_run_id,
    'sourceSetSha256',v_batch.source_set_sha256,
    'declaredSourceRowCount',v_batch.source_row_count,
    'readyRowCount',v_ready_count,
    'readyPositiveRowCount',v_ready_positive_count,
    'readyZeroRowCount',v_ready_zero_count,
    'pendingProductMappingCount',v_pending_product,
    'ambiguousProductMappingCount',v_ambiguous_product,
    'pendingWarehouseMappingCount',v_pending_warehouse,
    'ambiguousWarehouseMappingCount',v_ambiguous_warehouse,
    'pendingPhysicalIdentityCount',v_pending_identity,
    'alreadyInitializedCount',v_already_initialized,
    'requestedRowCount',v_requested_count,
    'selectedRowCount',v_selected_count,
    'executableRowCount',v_executable_count,
    'positiveRowCount',v_positive_count,
    'zeroRowCount',v_zero_count,
    'positiveQtyOnHandTotal',v_positive_qty,
    'locationCode',v_location.location_code,
    'locationSemantics',v_location.location_semantics,
    'manifestSha256',v_manifest,
    'rows',v_rows,
    'canApply',
      v_executable_count>0
      and v_executable_count=v_selected_count
      and (v_requested_count is null or v_requested_count=v_selected_count),
    'authorityEffect','NONE'
  );
end;
$$;

create or replace function public.ecoflow_apply_r5_010_bulk_opening(
  p_reference_batch_id uuid,
  p_manifest_sha256 text,
  p_command_id uuid,
  p_reason text,
  p_acknowledged boolean,
  p_reference_row_ids uuid[] default null,
  p_location_code text default 'MIGRATION-UNASSIGNED'
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := public.ecoflow_active_app_role();
  v_existing public.ecoflow_r5_010_opening_commands%rowtype;
  v_preview jsonb;
  v_preview_after_lock jsonb;
  v_payload jsonb;
  v_payload_hash text;
  v_row jsonb;
  v_session_id uuid;
  v_session_status text;
  v_session_revision bigint;
  v_internal_command uuid;
  v_location public.ecoflow_warehouse_locations%rowtype;
  v_observation_id uuid;
  v_adjustment_count integer;
  v_approved_at timestamptz;
  v_result jsonb;
  v_inserted integer := 0;
  v_positive integer := 0;
  v_zero integer := 0;
  v_positive_qty numeric := 0;
begin
  if v_actor is null then raise exception 'R5_010_AUTH_REQUIRED'; end if;
  if v_role not in ('OWNER','ADMIN') then
    raise exception using errcode='42501',message='R5_010_OWNER_OR_ADMIN_REQUIRED';
  end if;
  if p_command_id is null then raise exception 'R5_010_COMMAND_ID_REQUIRED'; end if;
  if p_reference_batch_id is null then raise exception 'R5_010_REFERENCE_BATCH_REQUIRED'; end if;
  if p_manifest_sha256 is null or p_manifest_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'R5_010_VALID_MANIFEST_REQUIRED';
  end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then
    raise exception 'R5_010_REASON_REQUIRED';
  end if;
  if coalesce(p_acknowledged,false) is not true then
    raise exception 'R5_010_EXPLICIT_ACKNOWLEDGEMENT_REQUIRED';
  end if;

  v_payload := jsonb_build_object(
    'referenceBatchId',p_reference_batch_id,
    'manifestSha256',p_manifest_sha256,
    'referenceRowIds',p_reference_row_ids,
    'locationCode',upper(btrim(coalesce(p_location_code,''))),
    'reason',left(btrim(p_reason),2000),
    'acknowledged',true
  );
  v_payload_hash := pg_catalog.encode(extensions.digest(v_payload::text,'sha256'),'hex');

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('r5-010-command:'||p_command_id::text,0)
  );

  select * into v_existing
  from public.ecoflow_r5_010_opening_commands
  where command_id=p_command_id;
  if found then
    if v_existing.actor_user_id<>v_actor
       or v_existing.reference_batch_id<>p_reference_batch_id
       or v_existing.manifest_sha256<>p_manifest_sha256
       or v_existing.request_payload_sha256<>v_payload_hash then
      raise exception 'R5_010_COMMAND_REPLAY_MISMATCH';
    end if;
    return v_existing.result;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('r5-010-batch:'||p_reference_batch_id::text,0)
  );

  v_preview := public.ecoflow_preview_r5_010_bulk_opening(
    p_reference_batch_id,p_reference_row_ids,p_location_code
  );

  if coalesce((v_preview->>'canApply')::boolean,false) is not true
     or v_preview->>'manifestSha256'<>p_manifest_sha256 then
    raise exception 'R5_010_PREVIEW_MANIFEST_MISMATCH_OR_NOT_EXECUTABLE';
  end if;

  -- Lock all selected SKU/unit keys in canonical order before the final recheck.
  for v_row in
    select value
    from jsonb_array_elements(v_preview->'rows')
    where coalesce((value->>'executable')::boolean,false)
    order by value->>'physicalSkuCode',value->>'referenceRowId'
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'warehouse-sku-write:'||upper(v_row->>'physicalSkuCode')||':carton',0
      )
    );
  end loop;

  v_preview_after_lock := public.ecoflow_preview_r5_010_bulk_opening(
    p_reference_batch_id,p_reference_row_ids,p_location_code
  );
  if coalesce((v_preview_after_lock->>'canApply')::boolean,false) is not true
     or v_preview_after_lock->>'manifestSha256'<>p_manifest_sha256
     or v_preview_after_lock->'rows'<>v_preview->'rows' then
    raise exception 'R5_010_STATE_CHANGED_AFTER_PREVIEW';
  end if;

  select * into v_location
  from public.ecoflow_warehouse_locations
  where upper(location_code)=upper(v_preview_after_lock->>'locationCode')
    and status='ACTIVE'
  for update;
  if not found then raise exception 'R5_010_LOCATION_DISAPPEARED'; end if;

  v_internal_command := extensions.gen_random_uuid();
  select session_id,session_status,revision
  into v_session_id,v_session_status,v_session_revision
  from public.ecoflow_start_stocktake_session(
    'INITIAL',
    left('R5-010 Unleashed migration opening '||substring(p_manifest_sha256 from 1 for 12),160),
    null,
    v_actor,
    false,
    left(
      'R5-010 UNLEASHED_MIGRATION_REFERENCE; batch='||p_reference_batch_id::text||
      '; manifest='||p_manifest_sha256||'; '||btrim(p_reason),
      2000
    ),
    v_internal_command
  );

  for v_row in
    select value
    from jsonb_array_elements(v_preview_after_lock->'rows')
    where coalesce((value->>'executable')::boolean,false)
    order by value->>'sourceProductCode',value->>'referenceRowId'
  loop
    v_internal_command := extensions.gen_random_uuid();
    insert into public.ecoflow_stocktake_observations(
      session_id,location_id,location_code,sku,product_name,barcode,
      unit_level,units_per_package,quantity_packages,note,exception_codes,
      review_status,command_id,observed_by,evidence_type,
      source_reference_batch_id,source_reference_row_id,source_row_sha256,
      source_manifest_sha256,source_command_id
    ) values (
      v_session_id,v_location.id,v_location.location_code,
      v_row->>'physicalSkuCode',v_row->>'physicalSkuName',v_row->>'barcode',
      'carton',(v_row->>'unitsPerPackage')::numeric,(v_row->>'sourceQtyOnHand')::numeric,
      left(
        'R5-010 UNLEASHED_MIGRATION_REFERENCE; sourceProduct='||
        (v_row->>'sourceProductCode')||'; sourceQtyOnHand='||
        (v_row->>'sourceQtyOnHand')||'; no physical count asserted.',
        2000
      ),
      '{}'::text[],'ACCEPTED',v_internal_command,v_actor,
      'UNLEASHED_MIGRATION_REFERENCE',
      p_reference_batch_id,(v_row->>'referenceRowId')::uuid,
      v_row->>'sourceRowSha256',p_manifest_sha256,p_command_id
    )
    returning id into v_observation_id;

    v_inserted := v_inserted+1;
    if (v_row->>'sourceQtyOnHand')::numeric>0 then
      v_positive := v_positive+1;
      v_positive_qty := v_positive_qty+(v_row->>'sourceQtyOnHand')::numeric;
    else
      v_zero := v_zero+1;
    end if;
  end loop;

  if v_inserted=0 then raise exception 'R5_010_EMPTY_EXECUTION_WAVE'; end if;

  insert into public.ecoflow_stocktake_location_progress(
    session_id,location_id,location_code,progress_status,observation_count,
    exception_count,completed_by,completed_at,revision,updated_at
  ) values (
    v_session_id,v_location.id,v_location.location_code,'COMPLETE',v_inserted,
    0,v_actor,clock_timestamp(),1,clock_timestamp()
  )
  on conflict(session_id,location_id) do update set
    progress_status='COMPLETE',
    observation_count=excluded.observation_count,
    exception_count=0,
    completed_by=v_actor,
    completed_at=clock_timestamp(),
    revision=public.ecoflow_stocktake_location_progress.revision+1,
    updated_at=clock_timestamp();

  v_internal_command := extensions.gen_random_uuid();
  select session_id,session_status,revision
  into v_session_id,v_session_status,v_session_revision
  from public.ecoflow_submit_stocktake_session(
    v_session_id,
    left('R5-010 manifest-bound migration reference wave ready for immediate governed approval.',2000),
    v_internal_command
  );
  if v_session_status<>'REVIEW' then
    raise exception 'R5_010_STOCKTAKE_REVIEW_REQUIRED';
  end if;

  v_internal_command := extensions.gen_random_uuid();
  select session_id,session_status,revision,adjustment_count,approved_at
  into v_session_id,v_session_status,v_session_revision,v_adjustment_count,v_approved_at
  from public.ecoflow_approve_stocktake_session(
    v_session_id,
    v_session_revision,
    left(
      'R5-010 UNLEASHED_MIGRATION_REFERENCE; batch='||p_reference_batch_id::text||
      '; manifest='||p_manifest_sha256||'; command='||p_command_id::text||
      '; '||btrim(p_reason),
      2000
    ),
    v_internal_command
  );
  if v_session_status<>'APPROVED' then
    raise exception 'R5_010_STOCKTAKE_APPROVAL_FAILED';
  end if;

  if v_adjustment_count<>v_positive then
    raise exception 'R5_010_OPENING_MOVEMENT_COUNT_MISMATCH';
  end if;

  if (
    select count(*)
    from public.ecoflow_r5_010_inventory_movement_provenance p
    where p.command_id=p_command_id
  )<>v_positive then
    raise exception 'R5_010_INVENTORY_PROVENANCE_COUNT_MISMATCH';
  end if;

  if (
    select count(*)
    from public.ecoflow_r5_010_warehouse_movement_provenance p
    where p.command_id=p_command_id
  )<>v_positive then
    raise exception 'R5_010_WAREHOUSE_PROVENANCE_COUNT_MISMATCH';
  end if;

  v_result := jsonb_build_object(
    'commandId',p_command_id,
    'referenceBatchId',p_reference_batch_id,
    'manifestSha256',p_manifest_sha256,
    'stocktakeSessionId',v_session_id,
    'stocktakeSessionStatus',v_session_status,
    'stocktakeSessionRevision',v_session_revision,
    'selectedRowCount',v_inserted,
    'positiveRowCount',v_positive,
    'zeroRowCount',v_zero,
    'positiveQtyOnHandTotal',v_positive_qty,
    'openingMovementCount',v_adjustment_count,
    'locationCode',v_location.location_code,
    'locationSemantics',v_location.location_semantics,
    'evidenceType','UNLEASHED_MIGRATION_REFERENCE',
    'authorityEffect','OPENING_INVENTORY_CREATED',
    'approvedAt',v_approved_at
  );

  insert into public.ecoflow_r5_010_opening_commands(
    command_id,actor_user_id,actor_role,reference_batch_id,manifest_sha256,
    request_payload_sha256,stocktake_session_id,selected_row_count,
    positive_row_count,zero_row_count,positive_qty_total,result
  ) values (
    p_command_id,v_actor,v_role,p_reference_batch_id,p_manifest_sha256,
    v_payload_hash,v_session_id,v_inserted,v_positive,v_zero,v_positive_qty,v_result
  );

  insert into public.app_security_audit_events(
    actor_user_id,actor_role,action,target_type,target_id,before_data,after_data
  ) values (
    v_actor,v_role,'R5_010_BULK_OPENING_APPLIED',
    'ecoflow_unleashed_inventory_reference_batches',p_reference_batch_id::text,
    jsonb_build_object(
      'manifestSha256',p_manifest_sha256,
      'selectedRowCount',v_inserted,
      'locationCode',v_location.location_code
    ),
    v_result
  );

  return v_result;
end;
$$;

revoke all on function public.ecoflow_r5_010_prevent_audit_mutation()
  from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_lock_warehouse_sku_write()
  from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_r5_010_capture_inventory_movement_provenance()
  from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_r5_010_capture_warehouse_movement_provenance()
  from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_preview_r5_010_bulk_opening(uuid,uuid[],text)
  from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_apply_r5_010_bulk_opening(uuid,text,uuid,text,boolean,uuid[],text)
  from public,anon,authenticated,service_role;

grant execute on function public.ecoflow_preview_r5_010_bulk_opening(uuid,uuid[],text)
  to authenticated;
grant execute on function public.ecoflow_apply_r5_010_bulk_opening(uuid,text,uuid,text,boolean,uuid[],text)
  to authenticated;

comment on column public.ecoflow_warehouse_locations.location_semantics is
  'PHYSICAL locations assert a real warehouse position. MIGRATION_HOLDING is governed non-physical holding authority and must not be presented as a physical bin.';
comment on column public.ecoflow_stocktake_observations.evidence_type is
  'PHYSICAL_COUNT for real counts; UNLEASHED_MIGRATION_REFERENCE for R5-010 reference-based opening evidence. The latter never asserts a physical count.';
comment on function public.ecoflow_preview_r5_010_bulk_opening(uuid,uuid[],text) is
  'Owner/Admin read-only latest-SEALED ADL1 opening preview. Returns a deterministic executable manifest and unresolved blockers without inventory mutation.';
comment on function public.ecoflow_apply_r5_010_bulk_opening(uuid,text,uuid,text,boolean,uuid[],text) is
  'Owner/Admin manifest-bound exactly-once opening APPLY. Revalidates after shared SKU locks, materializes UNLEASHED_MIGRATION_REFERENCE evidence, and reuses INITIAL stocktake approval for inventory authority.';

notify pgrst,'reload schema';
commit;