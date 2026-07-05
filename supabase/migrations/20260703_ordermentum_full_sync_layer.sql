-- EcoFlow / Ordermentum full sync control layer
-- Safe additive migration: creates sync audit tables, raw upsert RPCs, and dashboard views.

begin;

create extension if not exists pgcrypto;

-- Ensure sync state exists. Existing rows/columns are preserved.
create table if not exists public.ordermentum_api_sync_state (
  id text primary key,
  enabled boolean not null default false,
  sync_mode text not null default 'PAUSED',
  business_timezone text not null default 'Australia/Adelaide',
  order_cutoff_time time not null default '22:00:00',
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

insert into public.ordermentum_api_sync_state (id, enabled, sync_mode, business_timezone, order_cutoff_time)
values ('ORDERMENTUM', false, 'PAUSED', 'Australia/Adelaide', '22:00:00')
on conflict (id) do nothing;

alter table public.ordermentum_api_sync_state
  add column if not exists last_attempted_sync_at timestamptz,
  add column if not exists last_backfill_run_at timestamptz,
  add column if not exists last_incremental_run_at timestamptz,
  add column if not exists last_successful_backfill_at timestamptz,
  add column if not exists last_successful_incremental_at timestamptz,
  add column if not exists consecutive_failures integer not null default 0,
  add column if not exists default_window_days integer not null default 7,
  add column if not exists incremental_overlap_minutes integer not null default 15;

create table if not exists public.ordermentum_sync_runs_v2 (
  id uuid primary key default gen_random_uuid(),
  run_type text not null check (run_type in ('BACKFILL','INCREMENTAL','DETAIL_HYDRATION','MISSING_INVOICE_REFRESH','MANUAL_TEST')),
  status text not null default 'RUNNING' check (status in ('RUNNING','SUCCEEDED','PARTIAL','FAILED','CANCELLED')),
  window_from timestamptz,
  window_to timestamptz,
  page_size integer,
  max_pages integer,
  pages_attempted integer not null default 0,
  orders_seen integer not null default 0,
  orders_upserted integer not null default 0,
  orders_changed integer not null default 0,
  invoices_seen integer not null default 0,
  invoices_upserted integer not null default 0,
  detail_fetch_attempted integer not null default 0,
  detail_fetch_succeeded integer not null default 0,
  detail_fetch_failed integer not null default 0,
  rate_limited integer not null default 0,
  error_count integer not null default 0,
  last_error text,
  api_base_url text,
  auth_mode text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ordermentum_sync_runs_v2_run_type_started
  on public.ordermentum_sync_runs_v2 (run_type, started_at desc);

create index if not exists idx_ordermentum_sync_runs_v2_status_started
  on public.ordermentum_sync_runs_v2 (status, started_at desc);

create table if not exists public.ordermentum_sync_errors_v2 (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.ordermentum_sync_runs_v2(id) on delete set null,
  error_scope text not null,
  external_order_id text,
  external_order_number text,
  external_invoice_number text,
  http_status integer,
  error_message text not null,
  error_payload jsonb,
  retryable boolean not null default true,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_ordermentum_sync_errors_v2_run_id
  on public.ordermentum_sync_errors_v2 (run_id);

create index if not exists idx_ordermentum_sync_errors_v2_unresolved
  on public.ordermentum_sync_errors_v2 (created_at desc)
  where resolved_at is null;

-- Optional detailed raw API payload archive. This is intentionally separate from canonical raw orders.
create table if not exists public.ordermentum_raw_api_events_v2 (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.ordermentum_sync_runs_v2(id) on delete set null,
  event_type text not null,
  external_id text,
  external_number text,
  payload_hash text,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_ordermentum_raw_api_events_v2_run_id
  on public.ordermentum_raw_api_events_v2 (run_id);

create index if not exists idx_ordermentum_raw_api_events_v2_external
  on public.ordermentum_raw_api_events_v2 (event_type, external_id, external_number);

-- Start a sync run and record the attempted sync timestamp.
create or replace function public.ecoflow_start_ordermentum_sync_run(
  p_run_type text,
  p_window_from timestamptz default null,
  p_window_to timestamptz default null,
  p_page_size integer default null,
  p_max_pages integer default null,
  p_api_base_url text default null,
  p_auth_mode text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
begin
  insert into public.ordermentum_sync_runs_v2 (
    run_type,
    window_from,
    window_to,
    page_size,
    max_pages,
    api_base_url,
    auth_mode
  ) values (
    p_run_type,
    p_window_from,
    p_window_to,
    p_page_size,
    p_max_pages,
    p_api_base_url,
    p_auth_mode
  )
  returning id into v_run_id;

  update public.ordermentum_api_sync_state
  set last_attempted_sync_at = now(),
      updated_at = now()
  where id = 'ORDERMENTUM';

  return v_run_id;
end;
$$;

create or replace function public.ecoflow_record_ordermentum_sync_error(
  p_run_id uuid,
  p_error_scope text,
  p_error_message text,
  p_external_order_id text default null,
  p_external_order_number text default null,
  p_external_invoice_number text default null,
  p_http_status integer default null,
  p_error_payload jsonb default null,
  p_retryable boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_error_id uuid;
begin
  insert into public.ordermentum_sync_errors_v2 (
    run_id,
    error_scope,
    external_order_id,
    external_order_number,
    external_invoice_number,
    http_status,
    error_message,
    error_payload,
    retryable
  ) values (
    p_run_id,
    p_error_scope,
    p_external_order_id,
    p_external_order_number,
    p_external_invoice_number,
    p_http_status,
    left(coalesce(p_error_message, 'Unknown sync error'), 4000),
    p_error_payload,
    coalesce(p_retryable, true)
  )
  returning id into v_error_id;

  update public.ordermentum_sync_runs_v2
  set error_count = error_count + 1,
      last_error = left(coalesce(p_error_message, 'Unknown sync error'), 4000),
      updated_at = now()
  where id = p_run_id;

  return v_error_id;
end;
$$;

create or replace function public.ecoflow_finish_ordermentum_sync_run(
  p_run_id uuid,
  p_status text,
  p_pages_attempted integer default 0,
  p_orders_seen integer default 0,
  p_orders_upserted integer default 0,
  p_orders_changed integer default 0,
  p_invoices_seen integer default 0,
  p_invoices_upserted integer default 0,
  p_detail_fetch_attempted integer default 0,
  p_detail_fetch_succeeded integer default 0,
  p_detail_fetch_failed integer default 0,
  p_rate_limited integer default 0,
  p_high_watermark_updated_at timestamptz default null,
  p_last_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_type text;
  v_effective_status text;
begin
  select run_type into v_run_type
  from public.ordermentum_sync_runs_v2
  where id = p_run_id;

  v_effective_status := coalesce(p_status, 'SUCCEEDED');

  update public.ordermentum_sync_runs_v2
  set status = v_effective_status,
      pages_attempted = coalesce(p_pages_attempted, pages_attempted),
      orders_seen = coalesce(p_orders_seen, orders_seen),
      orders_upserted = coalesce(p_orders_upserted, orders_upserted),
      orders_changed = coalesce(p_orders_changed, orders_changed),
      invoices_seen = coalesce(p_invoices_seen, invoices_seen),
      invoices_upserted = coalesce(p_invoices_upserted, invoices_upserted),
      detail_fetch_attempted = coalesce(p_detail_fetch_attempted, detail_fetch_attempted),
      detail_fetch_succeeded = coalesce(p_detail_fetch_succeeded, detail_fetch_succeeded),
      detail_fetch_failed = coalesce(p_detail_fetch_failed, detail_fetch_failed),
      rate_limited = coalesce(p_rate_limited, rate_limited),
      last_error = p_last_error,
      finished_at = now(),
      updated_at = now()
  where id = p_run_id;

  update public.ordermentum_api_sync_state
  set last_successful_sync_at = case when v_effective_status in ('SUCCEEDED','PARTIAL') then now() else last_successful_sync_at end,
      high_watermark_updated_at = case
        when v_effective_status in ('SUCCEEDED','PARTIAL') and p_high_watermark_updated_at is not null
          then greatest(coalesce(high_watermark_updated_at, '-infinity'::timestamptz), p_high_watermark_updated_at)
        else high_watermark_updated_at
      end,
      last_backfill_run_at = case when v_run_type = 'BACKFILL' then now() else last_backfill_run_at end,
      last_incremental_run_at = case when v_run_type = 'INCREMENTAL' then now() else last_incremental_run_at end,
      last_successful_backfill_at = case when v_run_type = 'BACKFILL' and v_effective_status in ('SUCCEEDED','PARTIAL') then now() else last_successful_backfill_at end,
      last_successful_incremental_at = case when v_run_type = 'INCREMENTAL' and v_effective_status in ('SUCCEEDED','PARTIAL') then now() else last_successful_incremental_at end,
      consecutive_failures = case when v_effective_status in ('SUCCEEDED','PARTIAL') then 0 else consecutive_failures + 1 end,
      last_error = case when v_effective_status in ('SUCCEEDED','PARTIAL') then null else p_last_error end,
      updated_at = now()
  where id = 'ORDERMENTUM';
end;
$$;

create or replace function public.ecoflow_archive_ordermentum_api_payload(
  p_run_id uuid,
  p_event_type text,
  p_external_id text,
  p_external_number text,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.ordermentum_raw_api_events_v2 (
    run_id,
    event_type,
    external_id,
    external_number,
    payload_hash,
    payload
  ) values (
    p_run_id,
    p_event_type,
    p_external_id,
    p_external_number,
    encode(digest(coalesce(p_payload::text, ''), 'sha256'), 'hex'),
    coalesce(p_payload, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.ecoflow_upsert_ordermentum_raw_order_v2(
  p_run_id uuid,
  p_payload jsonb,
  p_import_source text default 'ORDERMENTUM_API'
)
returns table(
  raw_order_id uuid,
  external_order_id text,
  external_order_number text,
  external_invoice_number text,
  changed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_external_order_id text;
  v_external_order_number text;
  v_external_invoice_number text;
  v_external_created_at timestamptz;
  v_external_updated_at timestamptz;
  v_payload_hash text;
  v_previous_hash text;
  v_raw_order_id uuid;
  v_changed boolean;
begin
  v_external_order_id := coalesce(
    p_payload->>'id',
    p_payload->>'orderId',
    p_payload->>'order_id',
    p_payload->>'uuid'
  );

  v_external_order_number := coalesce(
    p_payload->>'orderNumber',
    p_payload->>'order_number',
    p_payload->>'number',
    p_payload->>'orderNo',
    p_payload#>>'{order,number}'
  );

  v_external_invoice_number := coalesce(
    p_payload->>'invoiceNumber',
    p_payload->>'invoice_number',
    p_payload->>'invoiceNo',
    p_payload#>>'{invoice,number}',
    p_payload#>>'{invoice,invoiceNumber}'
  );

  v_external_created_at := nullif(coalesce(
    p_payload->>'createdAt',
    p_payload->>'created_at',
    p_payload->>'orderedAt',
    p_payload->>'date'
  ), '')::timestamptz;

  v_external_updated_at := nullif(coalesce(
    p_payload->>'updatedAt',
    p_payload->>'updated_at',
    p_payload->>'modifiedAt',
    p_payload->>'lastUpdatedAt'
  ), '')::timestamptz;

  if v_external_order_id is null and v_external_order_number is null then
    raise exception 'Cannot upsert Ordermentum raw order without id or order number';
  end if;

  v_payload_hash := encode(digest(coalesce(p_payload::text, ''), 'sha256'), 'hex');

  select r.payload_hash, r.id
    into v_previous_hash, v_raw_order_id
  from public.ordermentum_raw_orders r
  where (v_external_order_id is not null and r.external_order_id = v_external_order_id)
     or (v_external_order_id is null and r.external_order_number = v_external_order_number)
  order by r.created_at asc
  limit 1;

  v_changed := coalesce(v_previous_hash, '') <> v_payload_hash;

  insert into public.ordermentum_raw_orders (
    external_order_id,
    external_order_number,
    external_invoice_number,
    external_created_at,
    external_updated_at,
    raw_payload,
    payload_hash,
    import_source,
    first_seen_at,
    last_seen_at,
    last_synced_at,
    created_at,
    updated_at
  ) values (
    v_external_order_id,
    v_external_order_number,
    v_external_invoice_number,
    v_external_created_at,
    v_external_updated_at,
    coalesce(p_payload, '{}'::jsonb),
    v_payload_hash,
    coalesce(p_import_source, 'ORDERMENTUM_API'),
    now(),
    now(),
    now(),
    now(),
    now()
  )
  on conflict (external_order_id) do update
    set external_order_number = coalesce(excluded.external_order_number, public.ordermentum_raw_orders.external_order_number),
        external_invoice_number = coalesce(excluded.external_invoice_number, public.ordermentum_raw_orders.external_invoice_number),
        external_created_at = coalesce(excluded.external_created_at, public.ordermentum_raw_orders.external_created_at),
        external_updated_at = coalesce(excluded.external_updated_at, public.ordermentum_raw_orders.external_updated_at),
        raw_payload = excluded.raw_payload,
        payload_hash = excluded.payload_hash,
        import_source = excluded.import_source,
        last_seen_at = now(),
        last_synced_at = now(),
        updated_at = now()
  returning id into v_raw_order_id;

  perform public.ecoflow_archive_ordermentum_api_payload(
    p_run_id,
    'ORDER',
    v_external_order_id,
    v_external_order_number,
    p_payload
  );

  return query select
    v_raw_order_id,
    v_external_order_id,
    v_external_order_number,
    v_external_invoice_number,
    v_changed;
end;
$$;

create or replace function public.ecoflow_upsert_ordermentum_raw_invoice_v2(
  p_run_id uuid,
  p_payload jsonb,
  p_external_order_id text default null,
  p_external_order_number text default null,
  p_import_source text default 'ORDERMENTUM_API'
)
returns table(
  raw_invoice_id uuid,
  external_invoice_number text,
  external_order_id text,
  external_order_number text,
  changed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_external_invoice_number text;
  v_external_order_id text;
  v_external_order_number text;
  v_total numeric(12,4);
  v_total_due numeric(12,4);
  v_payload_hash text;
  v_previous_hash text;
  v_raw_invoice_id uuid;
  v_changed boolean;
begin
  v_external_invoice_number := coalesce(
    p_payload->>'invoiceNumber',
    p_payload->>'invoice_number',
    p_payload->>'number',
    p_payload->>'invoiceNo',
    p_payload#>>'{invoice,number}'
  );

  v_external_order_id := coalesce(
    p_external_order_id,
    p_payload->>'orderId',
    p_payload->>'order_id',
    p_payload#>>'{order,id}'
  );

  v_external_order_number := coalesce(
    p_external_order_number,
    p_payload->>'orderNumber',
    p_payload->>'order_number',
    p_payload#>>'{order,number}'
  );

  if v_external_invoice_number is null then
    raise exception 'Cannot upsert Ordermentum raw invoice without invoice number';
  end if;

  v_total := nullif(coalesce(
    p_payload->>'total',
    p_payload->>'invoiceTotal',
    p_payload#>>'{invoice,total}'
  ), '')::numeric(12,4);

  v_total_due := nullif(coalesce(
    p_payload->>'totalDue',
    p_payload->>'total_due',
    p_payload#>>'{invoice,totalDue}'
  ), '')::numeric(12,4);

  v_payload_hash := encode(digest(coalesce(p_payload::text, ''), 'sha256'), 'hex');

  select ri.payload_hash, ri.id
    into v_previous_hash, v_raw_invoice_id
  from public.ordermentum_raw_invoices ri
  where ri.external_invoice_number = v_external_invoice_number
  order by ri.created_at asc
  limit 1;

  v_changed := coalesce(v_previous_hash, '') <> v_payload_hash;

  insert into public.ordermentum_raw_invoices (
    external_invoice_number,
    external_order_id,
    external_order_number,
    total,
    total_due,
    raw_payload,
    payload_hash,
    import_source,
    last_synced_at,
    created_at,
    updated_at
  ) values (
    v_external_invoice_number,
    v_external_order_id,
    v_external_order_number,
    v_total,
    v_total_due,
    coalesce(p_payload, '{}'::jsonb),
    v_payload_hash,
    coalesce(p_import_source, 'ORDERMENTUM_API'),
    now(),
    now(),
    now()
  )
  on conflict (external_invoice_number) do update
    set external_order_id = coalesce(excluded.external_order_id, public.ordermentum_raw_invoices.external_order_id),
        external_order_number = coalesce(excluded.external_order_number, public.ordermentum_raw_invoices.external_order_number),
        total = coalesce(excluded.total, public.ordermentum_raw_invoices.total),
        total_due = coalesce(excluded.total_due, public.ordermentum_raw_invoices.total_due),
        raw_payload = excluded.raw_payload,
        payload_hash = excluded.payload_hash,
        import_source = excluded.import_source,
        last_synced_at = now(),
        updated_at = now()
  returning id into v_raw_invoice_id;

  perform public.ecoflow_archive_ordermentum_api_payload(
    p_run_id,
    'INVOICE',
    v_external_invoice_number,
    v_external_invoice_number,
    p_payload
  );

  return query select
    v_raw_invoice_id,
    v_external_invoice_number,
    v_external_order_id,
    v_external_order_number,
    v_changed;
end;
$$;

create or replace view public.v_ecoflow_ordermentum_sync_dashboard_v2 as
with raw_stats as (
  select
    count(*)::bigint as raw_orders,
    min(external_created_at) as first_created_at,
    max(external_created_at) as last_created_at,
    min(external_updated_at) as first_updated_at,
    max(external_updated_at) as last_updated_at,
    max(last_synced_at) as last_raw_synced_at
  from public.ordermentum_raw_orders
),
run_stats as (
  select
    count(*)::bigint as total_runs,
    count(*) filter (where status = 'RUNNING')::bigint as running_runs,
    count(*) filter (where status = 'SUCCEEDED')::bigint as successful_runs,
    count(*) filter (where status = 'FAILED')::bigint as failed_runs,
    max(started_at) as latest_run_started_at,
    max(finished_at) as latest_run_finished_at,
    max(started_at) filter (where run_type = 'BACKFILL') as latest_backfill_started_at,
    max(started_at) filter (where run_type = 'INCREMENTAL') as latest_incremental_started_at
  from public.ordermentum_sync_runs_v2
),
error_stats as (
  select
    count(*) filter (where resolved_at is null)::bigint as unresolved_errors,
    max(created_at) filter (where resolved_at is null) as latest_unresolved_error_at
  from public.ordermentum_sync_errors_v2
),
health as (
  select
    coalesce(invoice_detail_missing, 0)::bigint as invoice_detail_missing,
    coalesce(line_items_missing, 0)::bigint as line_items_missing,
    coalesce(blocked_data, 0)::bigint as blocked_data,
    coalesce(blocked_mapping, 0)::bigint as blocked_mapping,
    coalesce(ready_to_release, 0)::bigint as ready_to_release
  from public.v_ecoflow_ordermentum_import_control
  limit 1
)
select
  s.id,
  s.enabled,
  s.sync_mode,
  s.business_timezone,
  s.order_cutoff_time,
  s.last_successful_sync_at,
  s.high_watermark_updated_at,
  s.last_attempted_sync_at,
  s.last_backfill_run_at,
  s.last_incremental_run_at,
  s.consecutive_failures,
  s.last_error,
  r.raw_orders,
  r.first_created_at,
  r.last_created_at,
  r.first_updated_at,
  r.last_updated_at,
  r.last_raw_synced_at,
  rs.total_runs,
  rs.running_runs,
  rs.successful_runs,
  rs.failed_runs,
  es.unresolved_errors,
  es.latest_unresolved_error_at,
  coalesce(h.invoice_detail_missing, 0)::bigint as invoice_detail_missing,
  coalesce(h.line_items_missing, 0)::bigint as line_items_missing,
  coalesce(h.blocked_data, 0)::bigint as blocked_data,
  coalesce(h.blocked_mapping, 0)::bigint as blocked_mapping,
  coalesce(h.ready_to_release, 0)::bigint as ready_to_release,
  case
    when s.sync_mode = 'PAUSED' then 'PAUSED'
    when rs.running_runs > 0 then 'RUNNING'
    when coalesce(es.unresolved_errors, 0) > 0 then 'REVIEW_ERRORS'
    when coalesce(h.invoice_detail_missing, 0) > 0 or coalesce(h.line_items_missing, 0) > 0 then 'DATA_GAPS'
    when s.high_watermark_updated_at is null then 'NEEDS_INITIAL_SYNC'
    else 'OK'
  end as sync_health_status
from public.ordermentum_api_sync_state s
cross join raw_stats r
cross join run_stats rs
cross join error_stats es
left join health h on true
where s.id = 'ORDERMENTUM';

create or replace view public.v_ecoflow_ordermentum_backfill_progress_v2 as
select
  s.id,
  s.sync_mode,
  s.backfill_from,
  s.backfill_to,
  s.next_backfill_from,
  s.next_backfill_to,
  s.last_successful_backfill_at,
  r.raw_orders,
  r.first_created_at,
  r.last_created_at,
  case
    when s.backfill_from is null or s.backfill_to is null then 'NOT_CONFIGURED'
    when s.next_backfill_from is null then 'NOT_STARTED'
    when s.next_backfill_from >= s.backfill_to then 'COMPLETE'
    else 'IN_PROGRESS'
  end as backfill_status,
  case
    when s.backfill_from is null or s.backfill_to is null or s.next_backfill_from is null then null
    else round(
      least(
        100,
        greatest(
          0,
          extract(epoch from (s.next_backfill_from - s.backfill_from))
          / nullif(extract(epoch from (s.backfill_to - s.backfill_from)), 0)
          * 100
        )
      )::numeric,
      2
    )
  end as progress_percent
from public.ordermentum_api_sync_state s
cross join (
  select
    count(*)::bigint as raw_orders,
    min(external_created_at) as first_created_at,
    max(external_created_at) as last_created_at
  from public.ordermentum_raw_orders
) r
where s.id = 'ORDERMENTUM';

create or replace view public.v_ecoflow_ordermentum_sync_runs_recent_v2 as
select
  id,
  run_type,
  status,
  window_from,
  window_to,
  page_size,
  max_pages,
  pages_attempted,
  orders_seen,
  orders_upserted,
  orders_changed,
  invoices_seen,
  invoices_upserted,
  detail_fetch_attempted,
  detail_fetch_succeeded,
  detail_fetch_failed,
  rate_limited,
  error_count,
  last_error,
  started_at,
  finished_at,
  round(extract(epoch from (coalesce(finished_at, now()) - started_at))::numeric, 2) as duration_seconds
from public.ordermentum_sync_runs_v2
order by started_at desc;

commit;
