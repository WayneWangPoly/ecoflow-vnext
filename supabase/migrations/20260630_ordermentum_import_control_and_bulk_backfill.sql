-- EcoFlow Ordermentum bulk import control layer
-- Safe migration: creates additive control tables, invoice raw table, indexes, and read-only views.
-- No existing Ordermentum staging data or EcoFlow fulfilment data is deleted or overwritten.

create table if not exists public.ordermentum_api_sync_state (
  id text primary key default 'ORDERMENTUM',
  enabled boolean not null default false,
  sync_mode text not null default 'PAUSED' check (sync_mode in ('PAUSED','BACKFILL','INCREMENTAL','WEBHOOK','MANUAL')),
  business_timezone text not null default 'Australia/Adelaide',
  order_cutoff_time time not null default '22:00',
  last_successful_sync_at timestamptz,
  high_watermark_updated_at timestamptz,
  backfill_from timestamptz,
  backfill_to timestamptz,
  next_backfill_from timestamptz,
  next_backfill_to timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

insert into public.ordermentum_api_sync_state (id, enabled, sync_mode)
values ('ORDERMENTUM', false, 'PAUSED')
on conflict (id) do nothing;

create table if not exists public.ordermentum_api_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check (job_type in ('BACKFILL_WINDOW','INCREMENTAL_WINDOW','MISSING_INVOICE_REFRESH','MANUAL_WINDOW','WEBHOOK_EVENT')),
  source text not null default 'ORDERMENTUM_API',
  window_start timestamptz,
  window_end timestamptz,
  cursor_value text,
  status text not null default 'QUEUED' check (status in ('QUEUED','STARTED','COMPLETED','FAILED','PARTIAL','RATE_LIMITED','SKIPPED')),
  attempts integer not null default 0,
  next_run_at timestamptz,
  fetched_count integer not null default 0,
  created_count integer not null default 0,
  updated_count integer not null default 0,
  unchanged_count integer not null default 0,
  failed_count integer not null default 0,
  rate_limited_count integer not null default 0,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ordermentum_api_jobs_status_next_run
  on public.ordermentum_api_jobs(status, next_run_at);

create index if not exists idx_ordermentum_api_jobs_window
  on public.ordermentum_api_jobs(window_start, window_end);

create table if not exists public.ordermentum_import_errors (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.ordermentum_api_jobs(id),
  batch_id uuid references public.ordermentum_sync_batches(id),
  external_order_id text,
  external_order_number text,
  external_invoice_number text,
  error_stage text not null,
  error_code text,
  error_message text,
  retry_after_seconds integer,
  raw_payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ordermentum_import_errors_job
  on public.ordermentum_import_errors(job_id);

create index if not exists idx_ordermentum_import_errors_external_order
  on public.ordermentum_import_errors(external_order_id);

-- Give PostgREST / REST upsert a concrete unique constraint to target.
-- PostgreSQL unique constraints allow multiple NULL values, so this remains safe for legacy partial rows.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'uq_ordermentum_raw_orders_external_order_id_full'
      and conrelid = 'public.ordermentum_raw_orders'::regclass
  ) then
    alter table public.ordermentum_raw_orders
      add constraint uq_ordermentum_raw_orders_external_order_id_full unique (external_order_id);
  end if;
exception
  when duplicate_table then null;
  when duplicate_object then null;
end $$;

create table if not exists public.ordermentum_raw_invoices (
  id uuid primary key default gen_random_uuid(),
  external_invoice_id text,
  external_invoice_number text not null,
  external_order_id text,
  external_order_number text,
  payment_status text,
  invoice_status text,
  invoice_date timestamptz,
  due_at timestamptz,
  total numeric,
  total_due numeric,
  payload_hash text not null,
  raw_payload jsonb not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_synced_at timestamptz not null default now(),
  latest_job_id uuid references public.ordermentum_api_jobs(id),
  latest_batch_id uuid references public.ordermentum_sync_batches(id),
  import_source text not null default 'ORDERMENTUM_API',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_ordermentum_raw_invoices_number
  on public.ordermentum_raw_invoices(external_invoice_number);

create index if not exists idx_ordermentum_raw_invoices_order_number
  on public.ordermentum_raw_invoices(external_order_number);

create index if not exists idx_ordermentum_raw_invoices_last_synced
  on public.ordermentum_raw_invoices(last_synced_at);

create or replace view public.v_ecoflow_ordermentum_invoice_gap_queue as
select
  inbox.raw_order_id,
  inbox.external_order_id,
  inbox.external_order_number,
  inbox.external_invoice_number,
  inbox.order_number,
  inbox.invoice_number,
  inbox.order_status,
  inbox.payment_status,
  inbox.order_created_at,
  inbox.order_updated_at,
  inbox.updated_business_day,
  raw_invoice.id as raw_invoice_id,
  case
    when inbox.invoice_detail_missing = true and raw_invoice.id is null then 'FETCH_REQUIRED'
    when inbox.invoice_detail_missing = true and raw_invoice.id is not null then 'RAW_CAPTURED_NOT_PARSED'
    else 'CLOSED'
  end as gap_status,
  raw_invoice.last_synced_at as invoice_raw_last_synced_at
from public.v_ecoflow_ordermentum_inbox inbox
left join public.ordermentum_raw_invoices raw_invoice
  on raw_invoice.external_invoice_number = inbox.invoice_number
where inbox.invoice_detail_missing = true;

create or replace view public.v_ecoflow_ordermentum_import_control as
select
  state.enabled,
  state.sync_mode,
  state.business_timezone,
  state.order_cutoff_time,
  state.last_successful_sync_at,
  state.high_watermark_updated_at,
  state.backfill_from,
  state.backfill_to,
  state.next_backfill_from,
  state.next_backfill_to,
  state.last_error,
  health.raw_orders,
  health.invoice_detail_missing,
  health.line_items_missing,
  health.first_order_created_at,
  health.last_order_created_at,
  health.first_order_updated_at,
  health.last_order_updated_at,
  health.last_synced_at,
  coalesce(summary.ready_to_release, 0) as ready_to_release,
  coalesce(summary.review_payment, 0) as review_payment,
  coalesce(summary.blocked_data, 0) as blocked_data,
  coalesce(summary.blocked_mapping, 0) as blocked_mapping,
  coalesce(summary.blocked_stock, 0) as blocked_stock,
  (select count(*) from public.ordermentum_api_jobs where status in ('QUEUED','STARTED','RATE_LIMITED')) as open_api_jobs,
  (select max(created_at) from public.ordermentum_import_errors) as latest_import_error_at
from public.ordermentum_api_sync_state state
cross join public.v_ecoflow_ordermentum_sync_health health
left join public.v_ecoflow_ordermentum_release_summary_v2 summary on true
where state.id = 'ORDERMENTUM';

create or replace view public.v_ecoflow_ordermentum_internal_order_drafts as
select
  gate.raw_order_id,
  gate.external_order_id,
  gate.external_order_number,
  gate.external_invoice_number,
  gate.order_number,
  gate.invoice_number,
  gate.payment_status,
  gate.invoice_total,
  gate.total_due,
  gate.line_count,
  gate.required_quantity,
  gate.operational_release_status,
  gate.can_create_internal_order,
  jsonb_agg(
    jsonb_build_object(
      'lineId', line.line_id,
      'externalSkuCode', line.sku,
      'externalProductName', line.name,
      'quantity', line.quantity,
      'unit', coalesce(line.unit, line.uom),
      'price', line.price,
      'total', line.total
    ) order by line.name, line.sku
  ) filter (where line.line_id is not null) as draft_lines
from public.v_ecoflow_ordermentum_release_gate_v2 gate
left join public.v_ecoflow_ordermentum_order_lines line
  on line.external_order_id = gate.external_order_id
where gate.can_create_internal_order = true
group by
  gate.raw_order_id,
  gate.external_order_id,
  gate.external_order_number,
  gate.external_invoice_number,
  gate.order_number,
  gate.invoice_number,
  gate.payment_status,
  gate.invoice_total,
  gate.total_due,
  gate.line_count,
  gate.required_quantity,
  gate.operational_release_status,
  gate.can_create_internal_order;

create or replace view public.v_ecoflow_ordermentum_daily_workbench as
with today as (
  select (now() at time zone 'Australia/Adelaide')::date as business_day
)
select
  inbox.*,
  case
    when inbox.received_business_day = today.business_day then 'NEW_TODAY'
    when inbox.updated_business_day = today.business_day then 'UPDATED_TODAY'
    when coalesce(gate.operational_release_status, 'BLOCKED_DATA') not in ('READY_TO_RELEASE')
      and inbox.updated_business_day < today.business_day then 'CARRY_OVER'
    else 'ALL'
  end as daily_bucket,
  gate.operational_release_status,
  gate.operational_blockers,
  gate.can_create_internal_order
from public.v_ecoflow_ordermentum_inbox inbox
cross join today
left join public.v_ecoflow_ordermentum_release_gate_v2 gate
  on gate.external_order_id = inbox.external_order_id;
