-- UNLEASHED-MIGRATION-002: bounded read-only Unleashed connector foundation.
-- Unleashed API credentials are never stored in PostgreSQL. These tables store
-- run evidence, page metadata, source identifiers, and optional raw API payload
-- snapshots written only by service-side connector code.

begin;

do $deps$
declare
  v_missing text[] := '{}';
begin
  if to_regprocedure('public.ecoflow_active_app_role()') is null then
    v_missing := array_append(v_missing, 'public.ecoflow_active_app_role()');
  end if;
  if to_regclass('public.app_user_profiles') is null then
    v_missing := array_append(v_missing, 'public.app_user_profiles');
  end if;
  if to_regclass('public.app_security_audit_events') is null then
    v_missing := array_append(v_missing, 'public.app_security_audit_events');
  end if;

  if array_length(v_missing, 1) is not null then
    raise exception 'UNLEASHED_READONLY_CONNECTOR_DEPENDENCIES_MISSING:%', array_to_string(v_missing, ',');
  end if;
end;
$deps$;

create table if not exists public.unleashed_sync_runs (
  id uuid primary key default gen_random_uuid(),
  run_type text not null,
  status text not null default 'PLANNED',
  reason text,
  requested_by uuid,
  requested_by_email text,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  last_heartbeat_at timestamptz,
  completed_at timestamptz,
  dry_run boolean not null default true,
  resource_set text[] not null default '{}'::text[],
  requested_modified_since text,
  page_size integer not null default 100,
  max_pages integer not null default 1,
  records_seen integer not null default 0,
  records_staged integer not null default 0,
  records_changed integer not null default 0,
  records_failed integer not null default 0,
  error_code text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unleashed_sync_runs_run_type_check
    check (run_type in ('PROBE','BOUNDED_SNAPSHOT')),
  constraint unleashed_sync_runs_status_check
    check (status in ('PLANNED','RUNNING','SUCCEEDED','PARTIAL','FAILED','CANCELLED')),
  constraint unleashed_sync_runs_page_size_check
    check (page_size between 1 and 200),
  constraint unleashed_sync_runs_max_pages_check
    check (max_pages between 1 and 20),
  constraint unleashed_sync_runs_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.unleashed_sync_batches (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.unleashed_sync_runs(id) on delete cascade,
  resource text not null,
  endpoint_path text not null,
  page_number integer not null default 1,
  page_size integer not null default 100,
  status text not null default 'RUNNING',
  requested_at timestamptz not null default now(),
  responded_at timestamptz,
  http_status integer,
  records_seen integer not null default 0,
  records_staged integer not null default 0,
  response_sha256 text,
  query_params jsonb not null default '{}'::jsonb,
  pagination jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unleashed_sync_batches_status_check
    check (status in ('RUNNING','SUCCEEDED','FAILED','SKIPPED')),
  constraint unleashed_sync_batches_page_check
    check (page_number >= 1 and page_size between 1 and 200),
  constraint unleashed_sync_batches_http_status_check
    check (http_status is null or http_status between 100 and 599),
  constraint unleashed_sync_batches_response_hash_check
    check (response_sha256 is null or response_sha256 ~ '^[0-9a-f]{64}$'),
  constraint unleashed_sync_batches_query_object_check
    check (jsonb_typeof(query_params) = 'object'),
  constraint unleashed_sync_batches_pagination_object_check
    check (jsonb_typeof(pagination) = 'object'),
  constraint unleashed_sync_batches_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.unleashed_raw_snapshots (
  id uuid primary key default gen_random_uuid(),
  resource text not null,
  external_key text not null,
  external_guid text,
  external_code text,
  external_number text,
  display_name text,
  source_last_modified_at timestamptz,
  payload jsonb not null,
  payload_sha256 text not null,
  payload_object_keys text[] not null default '{}'::text[],
  first_seen_run_id uuid references public.unleashed_sync_runs(id) on delete set null,
  last_seen_run_id uuid references public.unleashed_sync_runs(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  version_count integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unleashed_raw_snapshots_key_not_blank
    check (length(btrim(external_key)) > 0),
  constraint unleashed_raw_snapshots_payload_object_check
    check (jsonb_typeof(payload) = 'object'),
  constraint unleashed_raw_snapshots_payload_hash_check
    check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint unleashed_raw_snapshots_version_count_check
    check (version_count >= 1),
  constraint unleashed_raw_snapshots_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.unleashed_external_identities (
  id uuid primary key default gen_random_uuid(),
  resource text not null,
  external_key text not null,
  external_guid text,
  external_code text,
  external_number text,
  display_name text,
  linkage_status text not null default 'UNMAPPED',
  canonical_table text,
  canonical_id uuid,
  latest_payload_sha256 text,
  latest_source_last_modified_at timestamptz,
  first_seen_run_id uuid references public.unleashed_sync_runs(id) on delete set null,
  last_seen_run_id uuid references public.unleashed_sync_runs(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unleashed_external_identities_key_not_blank
    check (length(btrim(external_key)) > 0),
  constraint unleashed_external_identities_linkage_status_check
    check (linkage_status in ('UNMAPPED','MATCH_CANDIDATE','LINKED','CONFLICT','RETIRED')),
  constraint unleashed_external_identities_hash_check
    check (latest_payload_sha256 is null or latest_payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint unleashed_external_identities_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.unleashed_resource_cursors (
  resource text primary key,
  cursor_status text not null default 'READY',
  last_successful_run_id uuid references public.unleashed_sync_runs(id) on delete set null,
  last_successful_at timestamptz,
  last_successful_modified_since text,
  high_watermark_at timestamptz,
  next_modified_since timestamptz,
  last_error_code text,
  last_error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unleashed_resource_cursors_status_check
    check (cursor_status in ('READY','RUNNING','FAILED','DISABLED')),
  constraint unleashed_resource_cursors_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists unleashed_sync_batches_run_resource_page_uidx
  on public.unleashed_sync_batches(run_id, resource, page_number);
create index if not exists unleashed_sync_runs_recent_idx
  on public.unleashed_sync_runs(requested_at desc);
create index if not exists unleashed_sync_runs_status_idx
  on public.unleashed_sync_runs(status, requested_at desc);
create index if not exists unleashed_raw_snapshots_resource_modified_idx
  on public.unleashed_raw_snapshots(resource, source_last_modified_at desc nulls last);
create unique index if not exists unleashed_raw_snapshots_resource_key_uidx
  on public.unleashed_raw_snapshots(resource, external_key);
create unique index if not exists unleashed_external_identities_resource_key_uidx
  on public.unleashed_external_identities(resource, external_key);
create index if not exists unleashed_external_identities_linkage_idx
  on public.unleashed_external_identities(linkage_status, resource);

create or replace function public.unleashed_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.unleashed_touch_sync_run()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  if new.status = 'RUNNING' and new.started_at is null then
    new.started_at := now();
  end if;
  if new.status in ('SUCCEEDED','PARTIAL','FAILED','CANCELLED') and new.completed_at is null then
    new.completed_at := now();
  end if;
  return new;
end;
$$;

create or replace function public.unleashed_preserve_raw_snapshot_first_seen()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.first_seen_run_id := old.first_seen_run_id;
  new.first_seen_at := old.first_seen_at;
  if old.payload_sha256 is distinct from new.payload_sha256 then
    new.version_count := old.version_count + 1;
  else
    new.version_count := old.version_count;
  end if;
  new.last_seen_at := now();
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.unleashed_preserve_identity_first_seen()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.first_seen_run_id := old.first_seen_run_id;
  new.first_seen_at := old.first_seen_at;
  new.linkage_status := old.linkage_status;
  new.canonical_table := old.canonical_table;
  new.canonical_id := old.canonical_id;
  new.last_seen_at := now();
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists unleashed_touch_sync_run on public.unleashed_sync_runs;
create trigger unleashed_touch_sync_run
before update on public.unleashed_sync_runs
for each row execute function public.unleashed_touch_sync_run();

drop trigger if exists unleashed_touch_sync_batch on public.unleashed_sync_batches;
create trigger unleashed_touch_sync_batch
before update on public.unleashed_sync_batches
for each row execute function public.unleashed_touch_updated_at();

drop trigger if exists unleashed_preserve_raw_snapshot_first_seen on public.unleashed_raw_snapshots;
create trigger unleashed_preserve_raw_snapshot_first_seen
before update on public.unleashed_raw_snapshots
for each row execute function public.unleashed_preserve_raw_snapshot_first_seen();

drop trigger if exists unleashed_preserve_identity_first_seen on public.unleashed_external_identities;
create trigger unleashed_preserve_identity_first_seen
before update on public.unleashed_external_identities
for each row execute function public.unleashed_preserve_identity_first_seen();

drop trigger if exists unleashed_touch_resource_cursor on public.unleashed_resource_cursors;
create trigger unleashed_touch_resource_cursor
before update on public.unleashed_resource_cursors
for each row execute function public.unleashed_touch_updated_at();

alter table public.unleashed_sync_runs enable row level security;
alter table public.unleashed_sync_batches enable row level security;
alter table public.unleashed_raw_snapshots enable row level security;
alter table public.unleashed_external_identities enable row level security;
alter table public.unleashed_resource_cursors enable row level security;

revoke all on table public.unleashed_sync_runs from public, anon, authenticated;
revoke all on table public.unleashed_sync_batches from public, anon, authenticated;
revoke all on table public.unleashed_raw_snapshots from public, anon, authenticated;
revoke all on table public.unleashed_external_identities from public, anon, authenticated;
revoke all on table public.unleashed_resource_cursors from public, anon, authenticated;

grant select on table public.unleashed_sync_runs to authenticated;
grant select on table public.unleashed_sync_batches to authenticated;
grant select on table public.unleashed_external_identities to authenticated;
grant select on table public.unleashed_resource_cursors to authenticated;
grant select on table public.unleashed_raw_snapshots to authenticated;

grant select, insert, update, delete on table public.unleashed_sync_runs to service_role;
grant select, insert, update, delete on table public.unleashed_sync_batches to service_role;
grant select, insert, update, delete on table public.unleashed_raw_snapshots to service_role;
grant select, insert, update, delete on table public.unleashed_external_identities to service_role;
grant select, insert, update, delete on table public.unleashed_resource_cursors to service_role;

drop policy if exists unleashed_sync_runs_office_read on public.unleashed_sync_runs;
create policy unleashed_sync_runs_office_read
on public.unleashed_sync_runs
for select to authenticated
using (public.ecoflow_active_app_role() in ('OWNER','ADMIN','ACCOUNT','VIEWER'));

drop policy if exists unleashed_sync_batches_office_read on public.unleashed_sync_batches;
create policy unleashed_sync_batches_office_read
on public.unleashed_sync_batches
for select to authenticated
using (public.ecoflow_active_app_role() in ('OWNER','ADMIN','ACCOUNT','VIEWER'));

drop policy if exists unleashed_external_identities_office_read on public.unleashed_external_identities;
create policy unleashed_external_identities_office_read
on public.unleashed_external_identities
for select to authenticated
using (public.ecoflow_active_app_role() in ('OWNER','ADMIN','ACCOUNT','VIEWER','WAREHOUSE'));

drop policy if exists unleashed_resource_cursors_office_read on public.unleashed_resource_cursors;
create policy unleashed_resource_cursors_office_read
on public.unleashed_resource_cursors
for select to authenticated
using (public.ecoflow_active_app_role() in ('OWNER','ADMIN','ACCOUNT','VIEWER'));

drop policy if exists unleashed_raw_snapshots_owner_admin_read on public.unleashed_raw_snapshots;
create policy unleashed_raw_snapshots_owner_admin_read
on public.unleashed_raw_snapshots
for select to authenticated
using (public.ecoflow_active_app_role() in ('OWNER','ADMIN'));

drop view if exists public.v_ecoflow_unleashed_connector_health;
create view public.v_ecoflow_unleashed_connector_health
with (security_invoker = true)
as
select
  c.resource,
  c.cursor_status,
  c.last_successful_run_id,
  c.last_successful_at,
  c.last_successful_modified_since,
  c.high_watermark_at,
  c.next_modified_since,
  c.last_error_code,
  c.last_error_message,
  coalesce(s.snapshot_count, 0)::integer as snapshot_count,
  c.updated_at
from public.unleashed_resource_cursors c
left join (
  select resource, count(*) as snapshot_count
  from public.unleashed_raw_snapshots
  group by resource
) s on s.resource = c.resource;

drop view if exists public.v_ecoflow_unleashed_snapshot_catalog;
create view public.v_ecoflow_unleashed_snapshot_catalog
with (security_invoker = true)
as
select
  resource,
  external_key,
  external_guid,
  external_code,
  external_number,
  display_name,
  source_last_modified_at,
  payload_sha256,
  payload_object_keys,
  first_seen_at,
  last_seen_at,
  version_count,
  updated_at
from public.unleashed_raw_snapshots;

grant select on table public.v_ecoflow_unleashed_connector_health to authenticated;
grant select on table public.v_ecoflow_unleashed_snapshot_catalog to authenticated;
revoke all on table public.v_ecoflow_unleashed_connector_health from anon;
revoke all on table public.v_ecoflow_unleashed_snapshot_catalog from anon;

do $verify$
declare
  v_open bigint;
  v_role text;
  v_rel regclass;
begin
  foreach v_role in array array['anon','authenticated'] loop
    select count(*) into v_open
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r','p')
      and left(c.relname, length('unleashed_')) = 'unleashed_'
      and (
        has_table_privilege(v_role, c.oid, 'INSERT')
        or has_table_privilege(v_role, c.oid, 'UPDATE')
        or has_table_privilege(v_role, c.oid, 'DELETE')
        or has_table_privilege(v_role, c.oid, 'TRUNCATE')
        or has_table_privilege(v_role, c.oid, 'REFERENCES')
        or has_table_privilege(v_role, c.oid, 'TRIGGER')
        or has_table_privilege(v_role, c.oid, 'MAINTAIN')
        or has_any_column_privilege(v_role, c.oid, 'INSERT')
        or has_any_column_privilege(v_role, c.oid, 'UPDATE')
        or has_any_column_privilege(v_role, c.oid, 'REFERENCES')
      );

    if v_open <> 0 then
      raise exception 'UNLEASHED_READONLY_BROWSER_MUTATION_PRIVILEGE_OPEN:%:%', v_role, v_open;
    end if;

    if v_role = 'anon' then
      select count(*) into v_open
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('r','p')
        and left(c.relname, length('unleashed_')) = 'unleashed_'
        and has_table_privilege(v_role, c.oid, 'SELECT');

      if v_open <> 0 then
        raise exception 'UNLEASHED_READONLY_ANON_SELECT_OPEN:%', v_open;
      end if;
    end if;
  end loop;

  foreach v_rel in array array[
    'public.unleashed_sync_runs'::regclass,
    'public.unleashed_sync_batches'::regclass,
    'public.unleashed_raw_snapshots'::regclass,
    'public.unleashed_external_identities'::regclass,
    'public.unleashed_resource_cursors'::regclass
  ] loop
    if not has_table_privilege('service_role', v_rel, 'INSERT')
       or not has_table_privilege('service_role', v_rel, 'UPDATE')
       or not has_table_privilege('service_role', v_rel, 'DELETE') then
      raise exception 'UNLEASHED_READONLY_SERVICE_ROLE_STAGING_DAMAGED:%', v_rel::text;
    end if;
  end loop;
end;
$verify$;

notify pgrst, 'reload schema';
commit;
