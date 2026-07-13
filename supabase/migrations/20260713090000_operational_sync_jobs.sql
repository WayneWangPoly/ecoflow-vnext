-- Durable operational job tracking for Ordermentum syncs.
-- Browser actions enqueue one auditable job; GitHub Actions updates the same row.

begin;

create table if not exists public.ecoflow_operational_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null default 'ORDERMENTUM_SYNC' check (job_type in ('ORDERMENTUM_SYNC')),
  mode text not null check (mode in ('orders_invoices','stores_only','sku_only','standard','catchup')),
  reason text,
  status text not null default 'QUEUED' check (status in ('QUEUED','RUNNING','SUCCEEDED','PARTIAL','FAILED','CANCELLED')),
  stage text not null default 'Queued',
  stage_number integer not null default 0 check (stage_number >= 0),
  stage_total integer not null default 4 check (stage_total >= 1),
  requested_by uuid,
  requested_by_email text,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  last_heartbeat_at timestamptz,
  completed_at timestamptz,
  records_seen integer not null default 0 check (records_seen >= 0),
  records_upserted integer not null default 0 check (records_upserted >= 0),
  records_changed integer not null default 0 check (records_changed >= 0),
  records_failed integer not null default 0 check (records_failed >= 0),
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

create unique index if not exists ecoflow_operational_sync_jobs_one_active_mode
  on public.ecoflow_operational_sync_jobs(job_type,mode)
  where status in ('QUEUED','RUNNING');

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

create policy ecoflow_operational_sync_jobs_office_read
on public.ecoflow_operational_sync_jobs
for select to authenticated
using (public.ecoflow_active_app_role() in ('OWNER','ADMIN','ACCOUNT','VIEWER'));

create or replace view public.v_ecoflow_operational_sync_jobs
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
