-- Resumable Ordermentum history pipeline.
--
-- Full history is catalogued page-by-page and order detail is reconciled from a
-- durable queue. Cancelling a runner never discards completed pages or detail.
-- Schema migrations never execute the pipeline itself.

begin;

create table if not exists public.ecoflow_ordermentum_history_runs (
  id uuid primary key default gen_random_uuid(),
  pipeline_key text not null default 'ORDER_HISTORY_V2',
  status text not null default 'RUNNING'
    check (status in ('RUNNING','PAUSED','FAILED','CANCELLED','COMPLETE')),
  stage text not null default 'CATALOG'
    check (stage in ('CATALOG','DETAILS','READY_TO_FINALISE','COMPLETE')),
  window_from timestamptz not null,
  window_to timestamptz not null,
  next_page integer not null default 1 check (next_page > 0),
  page_size integer not null default 50 check (page_size between 1 and 200),
  pages_completed integer not null default 0,
  summaries_seen integer not null default 0,
  details_attempted integer not null default 0,
  details_succeeded integer not null default 0,
  details_failed integer not null default 0,
  details_skipped integer not null default 0,
  catalog_complete boolean not null default false,
  started_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  completed_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_ecoflow_ordermentum_history_runs_latest
  on public.ecoflow_ordermentum_history_runs(pipeline_key, started_at desc);

create table if not exists public.ecoflow_ordermentum_order_catalog (
  order_key text primary key,
  external_order_id text,
  external_order_number text,
  invoice_number text,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  summary_payload jsonb not null default '{}'::jsonb,
  summary_hash text,
  source_status text not null default 'PRESENT'
    check (source_status in ('PRESENT','SOURCE_MISSING')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_full_seen_run_id uuid references public.ecoflow_ordermentum_history_runs(id) on delete set null,
  detail_status text not null default 'PENDING'
    check (detail_status in ('PENDING','IN_PROGRESS','COMPLETE','FAILED')),
  detail_source_updated_at timestamptz,
  detail_synced_at timestamptz,
  detail_attempts integer not null default 0,
  detail_claim_token uuid,
  detail_claimed_at timestamptz,
  next_retry_at timestamptz,
  last_detail_error text
);

create index if not exists idx_ecoflow_ordermentum_catalog_external_id
  on public.ecoflow_ordermentum_order_catalog(external_order_id)
  where external_order_id is not null;

create index if not exists idx_ecoflow_ordermentum_catalog_detail_queue
  on public.ecoflow_ordermentum_order_catalog(detail_status, next_retry_at, source_updated_at desc)
  where source_status='PRESENT';

create index if not exists idx_ecoflow_ordermentum_catalog_seen_run
  on public.ecoflow_ordermentum_order_catalog(last_full_seen_run_id, source_status);

alter table public.ecoflow_ordermentum_history_runs enable row level security;
alter table public.ecoflow_ordermentum_order_catalog enable row level security;
revoke all on public.ecoflow_ordermentum_history_runs from anon, authenticated;
revoke all on public.ecoflow_ordermentum_order_catalog from anon, authenticated;
grant all on public.ecoflow_ordermentum_history_runs to service_role;
grant all on public.ecoflow_ordermentum_order_catalog to service_role;

create or replace function public.ecoflow_ordermentum_raw_row_has_detail(p_row jsonb)
returns boolean
language sql
immutable
set search_path=public
as $$
  select
    jsonb_typeof(p_row#>'{payload,items}')='array'
    or jsonb_typeof(p_row#>'{payload,lines}')='array'
    or jsonb_typeof(p_row#>'{payload,orderItems}')='array'
    or jsonb_typeof(p_row#>'{payload,lineItems}')='array'
    or jsonb_typeof(p_row#>'{payload,order,items}')='array'
    or jsonb_typeof(p_row#>'{raw_payload,items}')='array'
    or jsonb_typeof(p_row#>'{raw_payload,lines}')='array'
    or jsonb_typeof(p_row#>'{raw_json,items}')='array'
    or jsonb_typeof(p_row#>'{raw_json,lines}')='array'
    or jsonb_typeof(p_row->'items')='array'
    or jsonb_typeof(p_row->'lines')='array'
    or jsonb_typeof(p_row->'orderItems')='array'
    or jsonb_typeof(p_row->'lineItems')='array'
$$;

create or replace function public.ecoflow_upsert_ordermentum_catalog_page(
  p_run_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_rows integer := 0;
  v_bootstrapped integer := 0;
begin
  if p_rows is null or jsonb_typeof(p_rows)<>'array' then
    raise exception 'p_rows must be a JSON array' using errcode='22023';
  end if;

  insert into public.ecoflow_ordermentum_order_catalog (
    order_key,
    external_order_id,
    external_order_number,
    invoice_number,
    source_created_at,
    source_updated_at,
    summary_payload,
    summary_hash,
    source_status,
    first_seen_at,
    last_seen_at,
    last_full_seen_run_id,
    detail_status,
    next_retry_at,
    last_detail_error
  )
  select
    x.order_key,
    nullif(x.external_order_id,''),
    nullif(x.external_order_number,''),
    nullif(x.invoice_number,''),
    x.source_created_at,
    x.source_updated_at,
    coalesce(x.summary_payload,'{}'::jsonb),
    nullif(x.summary_hash,''),
    'PRESENT',
    now(),
    now(),
    p_run_id,
    'PENDING',
    null,
    null
  from jsonb_to_recordset(p_rows) as x(
    order_key text,
    external_order_id text,
    external_order_number text,
    invoice_number text,
    source_created_at timestamptz,
    source_updated_at timestamptz,
    summary_payload jsonb,
    summary_hash text
  )
  where nullif(x.order_key,'') is not null
  on conflict(order_key) do update set
    external_order_id=coalesce(excluded.external_order_id,public.ecoflow_ordermentum_order_catalog.external_order_id),
    external_order_number=coalesce(excluded.external_order_number,public.ecoflow_ordermentum_order_catalog.external_order_number),
    invoice_number=coalesce(excluded.invoice_number,public.ecoflow_ordermentum_order_catalog.invoice_number),
    source_created_at=coalesce(excluded.source_created_at,public.ecoflow_ordermentum_order_catalog.source_created_at),
    source_updated_at=coalesce(excluded.source_updated_at,public.ecoflow_ordermentum_order_catalog.source_updated_at),
    summary_payload=excluded.summary_payload,
    summary_hash=excluded.summary_hash,
    source_status='PRESENT',
    last_seen_at=now(),
    last_full_seen_run_id=p_run_id,
    detail_status=case
      when public.ecoflow_ordermentum_order_catalog.detail_status='COMPLETE'
       and coalesce(public.ecoflow_ordermentum_order_catalog.detail_source_updated_at,'-infinity'::timestamptz)
           >= coalesce(excluded.source_updated_at,'-infinity'::timestamptz)
        then 'COMPLETE'
      else 'PENDING'
    end,
    next_retry_at=case
      when public.ecoflow_ordermentum_order_catalog.detail_status='COMPLETE'
       and coalesce(public.ecoflow_ordermentum_order_catalog.detail_source_updated_at,'-infinity'::timestamptz)
           >= coalesce(excluded.source_updated_at,'-infinity'::timestamptz)
        then public.ecoflow_ordermentum_order_catalog.next_retry_at
      else null
    end,
    detail_attempts=case
      when public.ecoflow_ordermentum_order_catalog.detail_status='COMPLETE'
       and coalesce(public.ecoflow_ordermentum_order_catalog.detail_source_updated_at,'-infinity'::timestamptz)
           >= coalesce(excluded.source_updated_at,'-infinity'::timestamptz)
        then public.ecoflow_ordermentum_order_catalog.detail_attempts
      when public.ecoflow_ordermentum_order_catalog.last_full_seen_run_id is distinct from p_run_id
        then 0
      else public.ecoflow_ordermentum_order_catalog.detail_attempts
    end,
    detail_claim_token=case
      when public.ecoflow_ordermentum_order_catalog.detail_status='COMPLETE'
       and coalesce(public.ecoflow_ordermentum_order_catalog.detail_source_updated_at,'-infinity'::timestamptz)
           >= coalesce(excluded.source_updated_at,'-infinity'::timestamptz)
        then public.ecoflow_ordermentum_order_catalog.detail_claim_token
      else null
    end,
    detail_claimed_at=case
      when public.ecoflow_ordermentum_order_catalog.detail_status='COMPLETE'
       and coalesce(public.ecoflow_ordermentum_order_catalog.detail_source_updated_at,'-infinity'::timestamptz)
           >= coalesce(excluded.source_updated_at,'-infinity'::timestamptz)
        then public.ecoflow_ordermentum_order_catalog.detail_claimed_at
      else null
    end,
    last_detail_error=case
      when public.ecoflow_ordermentum_order_catalog.detail_status='COMPLETE'
       and coalesce(public.ecoflow_ordermentum_order_catalog.detail_source_updated_at,'-infinity'::timestamptz)
           >= coalesce(excluded.source_updated_at,'-infinity'::timestamptz)
        then public.ecoflow_ordermentum_order_catalog.last_detail_error
      else null
    end;

  get diagnostics v_rows=row_count;

  -- Preserve the hours of detail already imported by earlier runs. This generic
  -- bootstrap inspects the complete raw row as JSON, so it does not depend on a
  -- production-only raw payload column name.
  if to_regclass('public.ordermentum_raw_orders') is not null then
    execute $bootstrap$
      update public.ecoflow_ordermentum_order_catalog c
      set
        detail_status='COMPLETE',
        detail_source_updated_at=coalesce(
          nullif(to_jsonb(r)->>'external_updated_at','')::timestamptz,
          nullif(to_jsonb(r)->>'last_synced_at','')::timestamptz,
          c.source_updated_at
        ),
        detail_synced_at=coalesce(
          nullif(to_jsonb(r)->>'last_synced_at','')::timestamptz,
          now()
        ),
        next_retry_at=null,
        last_detail_error=null
      from public.ordermentum_raw_orders r
      where c.last_full_seen_run_id=$1
        and c.order_key in (
          select x.order_key
          from jsonb_to_recordset($2) as x(order_key text)
        )
        and (
          nullif(to_jsonb(r)->>'external_order_id','')=c.external_order_id
          or nullif(to_jsonb(r)->>'external_order_number','')=c.external_order_number
        )
        and public.ecoflow_ordermentum_raw_row_has_detail(to_jsonb(r))
        and coalesce(
          nullif(to_jsonb(r)->>'external_updated_at','')::timestamptz,
          nullif(to_jsonb(r)->>'last_synced_at','')::timestamptz,
          '-infinity'::timestamptz
        ) >= coalesce(c.source_updated_at,'-infinity'::timestamptz)
    $bootstrap$ using p_run_id,p_rows;
    get diagnostics v_bootstrapped=row_count;
  end if;

  return jsonb_build_object(
    'catalog_rows_upserted',v_rows,
    'existing_details_reused',v_bootstrapped
  );
end;
$$;

create or replace function public.ecoflow_finalise_ordermentum_catalog_scan(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_missing integer := 0;
  v_present integer := 0;
begin
  update public.ecoflow_ordermentum_order_catalog
  set source_status='SOURCE_MISSING'
  where last_full_seen_run_id is distinct from p_run_id
    and source_status<>'SOURCE_MISSING';
  get diagnostics v_missing=row_count;

  select count(*)::integer into v_present
  from public.ecoflow_ordermentum_order_catalog
  where last_full_seen_run_id=p_run_id
    and source_status='PRESENT';

  update public.ecoflow_ordermentum_history_runs
  set
    catalog_complete=true,
    stage='DETAILS',
    status='RUNNING',
    heartbeat_at=now(),
    last_error=null
  where id=p_run_id;

  return jsonb_build_object(
    'present_catalog_orders',v_present,
    'source_missing_catalog_orders',v_missing
  );
end;
$$;

create or replace function public.ecoflow_claim_ordermentum_detail_batch(
  p_run_id uuid,
  p_claim_token uuid,
  p_limit integer default 20,
  p_max_attempts integer default 5
)
returns table(
  order_key text,
  external_order_id text,
  external_order_number text,
  invoice_number text,
  source_updated_at timestamptz,
  detail_attempts integer
)
language plpgsql
security definer
set search_path=public
as $$
begin
  return query
  with candidates as (
    select c.order_key
    from public.ecoflow_ordermentum_order_catalog c
    where c.source_status='PRESENT'
      and c.external_order_id is not null
      and c.detail_status in ('PENDING','FAILED')
      and c.detail_attempts < greatest(coalesce(p_max_attempts,5),1)
      and (c.next_retry_at is null or c.next_retry_at<=now())
    order by c.source_updated_at desc nulls last,c.order_key
    for update skip locked
    limit greatest(coalesce(p_limit,20),1)
  ), claimed as (
    update public.ecoflow_ordermentum_order_catalog c
    set
      detail_status='IN_PROGRESS',
      detail_claim_token=p_claim_token,
      detail_claimed_at=now(),
      detail_attempts=c.detail_attempts+1,
      last_full_seen_run_id=coalesce(c.last_full_seen_run_id,p_run_id)
    from candidates q
    where c.order_key=q.order_key
    returning
      c.order_key,
      c.external_order_id,
      c.external_order_number,
      c.invoice_number,
      c.source_updated_at,
      c.detail_attempts
  )
  select * from claimed;
end;
$$;

create or replace view public.v_ecoflow_ordermentum_history_pipeline_v1 as
with latest as (
  select r.*
  from public.ecoflow_ordermentum_history_runs r
  where r.pipeline_key='ORDER_HISTORY_V2'
  order by r.started_at desc
  limit 1
), catalog as (
  select
    count(*)::numeric as catalog_total,
    count(*) filter (where source_status='PRESENT')::numeric as catalog_present,
    count(*) filter (where source_status='SOURCE_MISSING')::numeric as catalog_source_missing,
    count(*) filter (where source_status='PRESENT' and detail_status='COMPLETE')::numeric as detail_complete,
    count(*) filter (where source_status='PRESENT' and detail_status in ('PENDING','IN_PROGRESS'))::numeric as detail_pending,
    count(*) filter (where source_status='PRESENT' and detail_status='FAILED')::numeric as detail_failed
  from public.ecoflow_ordermentum_order_catalog
)
select
  l.id as history_run_id,
  l.status as history_pipeline_status,
  l.stage as history_stage,
  l.window_from as history_window_from,
  l.window_to as history_window_to,
  l.next_page as history_next_page,
  l.page_size as history_page_size,
  l.pages_completed as history_pages_completed,
  l.summaries_seen as history_summaries_seen,
  l.details_attempted as history_details_attempted,
  l.details_succeeded as history_details_succeeded,
  l.details_failed as history_details_failed,
  l.details_skipped as history_details_skipped,
  l.catalog_complete as history_catalog_complete,
  l.started_at as history_started_at,
  l.heartbeat_at as history_heartbeat_at,
  l.completed_at as history_completed_at,
  l.last_error as history_last_error,
  c.*
from latest l
cross join catalog c;

grant select on public.v_ecoflow_ordermentum_history_pipeline_v1 to authenticated;
revoke all on public.v_ecoflow_ordermentum_history_pipeline_v1 from anon;

do $$
begin
  if to_regclass('public.v_ecoflow_ordermentum_mirror_health_v2') is not null then
    execute $view$
      create or replace view public.v_ecoflow_ordermentum_mirror_health_v3 as
      select
        case
          when h.overall_status='COMPLETE'
           and p.history_pipeline_status='COMPLETE'
           and coalesce(p.detail_pending,0)=0
           and coalesce(p.detail_failed,0)=0
            then 'COMPLETE'
          else 'DEGRADED'
        end as overall_status,
        h.raw_order_count,
        h.projected_order_count,
        h.order_projection_missing,
        h.raw_invoice_count,
        h.projected_invoice_count,
        h.invoice_projection_missing,
        h.recent_orders_missing_lines,
        h.recent_orders_missing_invoice_detail,
        h.unknown_recent_statuses,
        h.recent_finance_reviews,
        h.purchaser_count,
        h.product_count,
        h.variant_count,
        h.price_group_count,
        h.stock_location_count,
        h.latest_raw_order_sync,
        h.latest_master_sync,
        h.source_missing_records,
        h.source_missing_orders,
        h.active_source_missing_orders,
        p.history_run_id,
        p.history_pipeline_status,
        p.history_stage,
        p.history_window_from,
        p.history_window_to,
        p.history_next_page,
        p.history_page_size,
        p.history_pages_completed,
        p.history_summaries_seen,
        p.history_details_attempted,
        p.history_details_succeeded,
        p.history_details_failed,
        p.history_details_skipped,
        p.history_catalog_complete,
        p.history_started_at,
        p.history_heartbeat_at,
        p.history_completed_at,
        p.history_last_error,
        p.catalog_total,
        p.catalog_present,
        p.catalog_source_missing,
        p.detail_complete,
        p.detail_pending,
        p.detail_failed,
        now() as checked_at
      from public.v_ecoflow_ordermentum_mirror_health_v2 h
      left join public.v_ecoflow_ordermentum_history_pipeline_v1 p on true
    $view$;
    grant select on public.v_ecoflow_ordermentum_mirror_health_v3 to authenticated;
    revoke all on public.v_ecoflow_ordermentum_mirror_health_v3 from anon;
  end if;
end $$;

revoke all on function public.ecoflow_ordermentum_raw_row_has_detail(jsonb) from public,anon,authenticated;
revoke all on function public.ecoflow_upsert_ordermentum_catalog_page(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.ecoflow_finalise_ordermentum_catalog_scan(uuid) from public,anon,authenticated;
revoke all on function public.ecoflow_claim_ordermentum_detail_batch(uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.ecoflow_upsert_ordermentum_catalog_page(uuid,jsonb) to service_role;
grant execute on function public.ecoflow_finalise_ordermentum_catalog_scan(uuid) to service_role;
grant execute on function public.ecoflow_claim_ordermentum_detail_batch(uuid,uuid,integer,integer) to service_role;

notify pgrst,'reload schema';
commit;
