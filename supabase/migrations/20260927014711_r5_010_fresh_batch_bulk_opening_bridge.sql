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
