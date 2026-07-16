begin;

create table if not exists public.ecoflow_ordermentum_mirror_status_snapshot (
  snapshot_key text primary key,
  overall_status text not null check (overall_status in ('COMPLETE','DEGRADED','FAILED')),
  verification_mode text not null,
  checked_at timestamptz not null default now(),
  raw_order_count numeric not null default 0,
  projected_order_count numeric not null default 0,
  order_projection_missing numeric not null default 0,
  raw_invoice_count numeric not null default 0,
  projected_invoice_count numeric not null default 0,
  invoice_projection_missing numeric not null default 0,
  purchaser_count numeric not null default 0,
  product_count numeric not null default 0,
  variant_count numeric not null default 0,
  price_group_count numeric not null default 0,
  stock_location_count numeric not null default 0,
  source_missing_records numeric not null default 0,
  source_missing_orders numeric not null default 0,
  active_source_missing_orders numeric not null default 0,
  recent_orders_missing_lines numeric not null default 0,
  recent_orders_missing_invoice_detail numeric not null default 0,
  unknown_recent_statuses numeric not null default 0,
  recent_finance_reviews numeric not null default 0,
  history_run_id uuid,
  history_pipeline_status text,
  history_stage text,
  history_next_page numeric,
  history_pages_completed numeric,
  history_summaries_seen numeric,
  history_catalog_complete boolean,
  history_heartbeat_at timestamptz,
  history_last_error text,
  catalog_total numeric not null default 0,
  catalog_present numeric not null default 0,
  catalog_source_missing numeric not null default 0,
  detail_complete numeric not null default 0,
  detail_pending numeric not null default 0,
  detail_failed numeric not null default 0,
  blockers jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb
);

alter table public.ecoflow_ordermentum_mirror_status_snapshot enable row level security;
revoke all on public.ecoflow_ordermentum_mirror_status_snapshot from anon, authenticated;
grant select on public.ecoflow_ordermentum_mirror_status_snapshot to authenticated;
grant all on public.ecoflow_ordermentum_mirror_status_snapshot to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='ecoflow_ordermentum_mirror_status_snapshot'
      and policyname='ecoflow_ordermentum_mirror_snapshot_authenticated_read'
  ) then
    create policy ecoflow_ordermentum_mirror_snapshot_authenticated_read
      on public.ecoflow_ordermentum_mirror_status_snapshot
      for select to authenticated
      using (true);
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
