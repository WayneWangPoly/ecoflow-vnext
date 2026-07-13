-- Durable operational job tracking for Ordermentum syncs.
-- Browser actions enqueue one auditable job; GitHub Actions updates the same row.
-- This migration is intentionally repair-safe because production may contain an
-- earlier manually created object with the same name.

begin;

-- Remove the projection first so an older column layout cannot block repair.
drop view if exists public.v_ecoflow_operational_sync_jobs;

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

-- A partial table may have nullable legacy rows. Keep them visible for audit but
-- only enforce the active-job index on rows with a recognised mode/status.
drop index if exists public.ecoflow_operational_sync_jobs_one_active_mode;
create unique index ecoflow_operational_sync_jobs_one_active_mode
  on public.ecoflow_operational_sync_jobs(job_type,mode)
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
revoke insert,update,delete on public.ecoflow_operational_sync_jobs from authenticated;
grant select on public.ecoflow_operational_sync_jobs to authenticated;

drop policy if exists ecoflow_operational_sync_jobs_office_read on public.ecoflow_operational_sync_jobs;
create policy ecoflow_operational_sync_jobs_office_read
on public.ecoflow_operational_sync_jobs
for select to authenticated
using (public.ecoflow_active_app_role() in ('OWNER','ADMIN','ACCOUNT','VIEWER'));

create view public.v_ecoflow_operational_sync_jobs
with (security_invoker=true)
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
