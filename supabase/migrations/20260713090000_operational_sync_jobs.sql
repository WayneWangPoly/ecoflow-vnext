-- Durable operational job tracking for Ordermentum syncs.
-- Browser actions enqueue one auditable job; GitHub Actions updates the same row.
-- This migration is repair-safe against a partial manually created relation.

begin;

-- Remove projections first. If an earlier manual attempt accidentally used the
-- table name for a view, remove that non-table relation without touching tables.
drop view if exists public.v_ecoflow_operational_sync_jobs;
do $$
declare
  relation_kind "char";
begin
  select c.relkind into relation_kind
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'ecoflow_operational_sync_jobs';

  if relation_kind = 'v' then
    execute 'drop view public.ecoflow_operational_sync_jobs cascade';
  elsif relation_kind = 'm' then
    execute 'drop materialized view public.ecoflow_operational_sync_jobs cascade';
  end if;
end $$;

create table if not exists public.ecoflow_operational_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null default 'ORDERMENTUM_SYNC',
  mode text not null,
  reason text,
  status text not null default 'QUEUED',
  stage text not null default 'Queued',
  stage_number integer not null default 0,
  stage_total integer not null default 4,
  requested_by uuid,
  requested_by_email text,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  last_heartbeat_at timestamptz,
  completed_at timestamptz,
  records_seen integer not null default 0,
  records_upserted integer not null default 0,
  records_changed integer not null default 0,
  records_failed integer not null default 0,
  error_code text,
  error_message text,
  workflow_repository text,
  workflow_name text,
  workflow_ref text,
  workflow_run_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Repair an older/partial table definition without deleting any job history.
alter table public.ecoflow_operational_sync_jobs
  add column if not exists id uuid,
  add column if not exists job_type text not null default 'ORDERMENTUM_SYNC',
  add column if not exists mode text,
  add column if not exists reason text,
  add column if not exists status text not null default 'QUEUED',
  add column if not exists stage text not null default 'Queued',
  add column if not exists stage_number integer not null default 0,
  add column if not exists stage_total integer not null default 4,
  add column if not exists requested_by uuid,
  add column if not exists requested_by_email text,
  add column if not exists requested_at timestamptz not null default now(),
  add column if not exists started_at timestamptz,
  add column if not exists last_heartbeat_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists records_seen integer not null default 0,
  add column if not exists records_upserted integer not null default 0,
  add column if not exists records_changed integer not null default 0,
  add column if not exists records_failed integer not null default 0,
  add column if not exists error_code text,
  add column if not exists error_message text,
  add column if not exists workflow_repository text,
  add column if not exists workflow_name text,
  add column if not exists workflow_ref text,
  add column if not exists workflow_run_id text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.ecoflow_operational_sync_jobs
set
  id = coalesce(id, gen_random_uuid()),
  job_type = coalesce(nullif(job_type, ''), 'ORDERMENTUM_SYNC'),
  mode = coalesce(nullif(mode, ''), 'standard'),
  status = coalesce(nullif(status, ''), 'CANCELLED'),
  stage = coalesce(nullif(stage, ''), 'Recovered legacy job'),
  stage_number = greatest(coalesce(stage_number, 0), 0),
  stage_total = greatest(coalesce(stage_total, 4), 1),
  requested_at = coalesce(requested_at, created_at, now()),
  metadata = coalesce(metadata, '{}'::jsonb),
  created_at = coalesce(created_at, requested_at, now()),
  updated_at = coalesce(updated_at, requested_at, now());

-- Ensure legacy duplicate/null IDs cannot prevent a primary key repair.
with duplicate_ids as (
  select ctid, row_number() over (partition by id order by requested_at desc nulls last, ctid desc) as duplicate_rank
  from public.ecoflow_operational_sync_jobs
)
update public.ecoflow_operational_sync_jobs target
set id = gen_random_uuid()
from duplicate_ids duplicate
where target.ctid = duplicate.ctid and duplicate.duplicate_rank > 1;

alter table public.ecoflow_operational_sync_jobs
  alter column id set default gen_random_uuid(),
  alter column id set not null,
  alter column mode set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.ecoflow_operational_sync_jobs'::regclass
      and contype = 'p'
  ) then
    alter table public.ecoflow_operational_sync_jobs
      add constraint ecoflow_operational_sync_jobs_pkey primary key (id);
  end if;
end $$;

-- A manually created table may already contain multiple active rows for one
-- mode. Preserve the newest and close older duplicates before enforcing the
-- single-active-job invariant.
with ranked_active as (
  select
    ctid,
    row_number() over (
      partition by job_type, mode
      order by requested_at desc nulls last, created_at desc nulls last, ctid desc
    ) as active_rank
  from public.ecoflow_operational_sync_jobs
  where mode in ('orders_invoices','stores_only','sku_only','standard','catchup')
    and status in ('QUEUED','RUNNING')
)
update public.ecoflow_operational_sync_jobs target
set
  status = 'CANCELLED',
  stage = 'Superseded during migration repair',
  completed_at = coalesce(target.completed_at, now()),
  error_code = coalesce(target.error_code, 'DUPLICATE_ACTIVE_JOB_REPAIRED'),
  error_message = coalesce(target.error_message, 'An older duplicate active job was closed while the durable sync queue was installed.'),
  updated_at = now()
from ranked_active ranked
where target.ctid = ranked.ctid and ranked.active_rank > 1;

drop index if exists public.ecoflow_operational_sync_jobs_one_active_mode;
create unique index ecoflow_operational_sync_jobs_one_active_mode
  on public.ecoflow_operational_sync_jobs(job_type, mode)
  where mode in ('orders_invoices','stores_only','sku_only','standard','catchup')
    and status in ('QUEUED','RUNNING');

create index if not exists ecoflow_operational_sync_jobs_recent
  on public.ecoflow_operational_sync_jobs(requested_at desc);

create or replace function public.ecoflow_touch_operational_sync_job()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  if new.status = 'RUNNING' and new.started_at is null then new.started_at := now(); end if;
  if new.status in ('SUCCEEDED','PARTIAL','FAILED','CANCELLED') and new.completed_at is null then new.completed_at := now(); end if;
  return new;
end;
$$;

drop trigger if exists ecoflow_touch_operational_sync_job on public.ecoflow_operational_sync_jobs;
create trigger ecoflow_touch_operational_sync_job
before update on public.ecoflow_operational_sync_jobs
for each row execute function public.ecoflow_touch_operational_sync_job();

alter table public.ecoflow_operational_sync_jobs enable row level security;

revoke all on public.ecoflow_operational_sync_jobs from anon;
revoke insert, update, delete on public.ecoflow_operational_sync_jobs from authenticated;
grant select on public.ecoflow_operational_sync_jobs to authenticated;

drop policy if exists ecoflow_operational_sync_jobs_office_read on public.ecoflow_operational_sync_jobs;
create policy ecoflow_operational_sync_jobs_office_read
on public.ecoflow_operational_sync_jobs
for select to authenticated
using (public.ecoflow_active_app_role() in ('OWNER','ADMIN','ACCOUNT','VIEWER'));

create view public.v_ecoflow_operational_sync_jobs
with (security_invoker = true)
as
select
  id,
  job_type,
  mode,
  reason,
  status,
  stage,
  stage_number,
  stage_total,
  requested_by_email,
  requested_at,
  started_at,
  last_heartbeat_at,
  completed_at,
  records_seen,
  records_upserted,
  records_changed,
  records_failed,
  error_code,
  error_message,
  workflow_repository,
  workflow_name,
  workflow_ref,
  workflow_run_id,
  metadata,
  updated_at
from public.ecoflow_operational_sync_jobs;

grant select on public.v_ecoflow_operational_sync_jobs to authenticated;
revoke all on public.v_ecoflow_operational_sync_jobs from anon;

notify pgrst, 'reload schema';
commit;
