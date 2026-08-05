-- Dashboard read timeout hardening.
--
-- Interactive dashboard reads must not expand the historical Ordermentum,
-- inventory-intelligence and barcode-intelligence view stacks. Commercial and
-- warehouse tables remain authoritative. The only persisted derivative added
-- here is a current-exception snapshot refreshed after a successful order sync.

begin;

do $preflight$
declare
  v_missing text[] := array[]::text[];
begin
  if to_regclass('public.v_ecoflow_ordermentum_ui_active_exceptions') is null then
    v_missing := array_append(v_missing, 'public.v_ecoflow_ordermentum_ui_active_exceptions');
  end if;
  if to_regclass('public.ecoflow_ui_active_order_keys') is null then
    v_missing := array_append(v_missing, 'public.ecoflow_ui_active_order_keys');
  end if;
  if to_regclass('public.om_orders') is null then
    v_missing := array_append(v_missing, 'public.om_orders');
  end if;
  if to_regclass('public.ecoflow_inventory_movements') is null then
    v_missing := array_append(v_missing, 'public.ecoflow_inventory_movements');
  end if;
  if to_regclass('public.ecoflow_sku_barcode_registry') is null then
    v_missing := array_append(v_missing, 'public.ecoflow_sku_barcode_registry');
  end if;
  if to_regprocedure('public.ecoflow_refresh_ui_active_order_keys()') is null then
    v_missing := array_append(v_missing, 'public.ecoflow_refresh_ui_active_order_keys()');
  end if;
  if to_regprocedure('public.ecoflow_active_app_role()') is null then
    v_missing := array_append(v_missing, 'public.ecoflow_active_app_role()');
  end if;
  if to_regprocedure('analytics.get_actionable_exception_queue(integer)') is null then
    v_missing := array_append(v_missing, 'analytics.get_actionable_exception_queue(integer)');
  end if;
  if to_regprocedure(
    'analytics.apply_actionable_exception_lifecycle_command(uuid,text,text,text,timestamptz,text,text)'
  ) is null then
    v_missing := array_append(
      v_missing,
      'analytics.apply_actionable_exception_lifecycle_command(uuid,text,text,text,timestamptz,text,text)'
    );
  end if;
  if to_regprocedure(
    'analytics.apply_actionable_exception_lifecycle_command_unsnapshotted_20260730(uuid,text,text,text,timestamptz,text,text)'
  ) is null then
    v_missing := array_append(
      v_missing,
      'analytics.apply_actionable_exception_lifecycle_command_unsnapshotted_20260730(uuid,text,text,text,timestamptz,text,text)'
    );
  end if;

  if cardinality(v_missing) > 0 then
    raise exception 'DASHBOARD_TIMEOUT_HARDENING_PREREQUISITES_MISSING: %',
      array_to_string(v_missing, ', ');
  end if;
end;
$preflight$;

create table public.ecoflow_current_exception_snapshot (
  exception_id text primary key,
  raw_order_id text,
  external_order_id text,
  external_order_number text,
  external_invoice_number text,
  order_number text,
  invoice_number text,
  exception_type text,
  message text,
  status text,
  detected_at timestamptz,
  snapshot_refreshed_at timestamptz not null,
  constraint ecoflow_current_exception_snapshot_id
    check (exception_id ~ '^ORDERMENTUM_ACTIVE:[a-f0-9]{32}$')
);

create index ecoflow_current_exception_snapshot_detected_idx
  on public.ecoflow_current_exception_snapshot(detected_at desc, exception_id);

create table public.ecoflow_read_model_refresh_state (
  read_model text primary key,
  refreshed_at timestamptz not null,
  row_count bigint not null check (row_count >= 0)
);

alter table public.ecoflow_current_exception_snapshot enable row level security;
alter table public.ecoflow_read_model_refresh_state enable row level security;

revoke all on public.ecoflow_current_exception_snapshot from public, anon, authenticated;
revoke all on public.ecoflow_read_model_refresh_state from public, anon, authenticated;
grant select on public.ecoflow_current_exception_snapshot to authenticated;
grant select on public.ecoflow_read_model_refresh_state to authenticated;
grant all on public.ecoflow_current_exception_snapshot to service_role;
grant all on public.ecoflow_read_model_refresh_state to service_role;

create policy ecoflow_current_exception_snapshot_desktop_read
  on public.ecoflow_current_exception_snapshot
  for select to authenticated
  using (public.ecoflow_active_app_role() in ('OWNER', 'ADMIN', 'ACCOUNT', 'VIEWER'));

create policy ecoflow_read_model_refresh_state_desktop_read
  on public.ecoflow_read_model_refresh_state
  for select to authenticated
  using (public.ecoflow_active_app_role() in ('OWNER', 'ADMIN', 'ACCOUNT', 'VIEWER'));

create or replace function public.ecoflow_mark_dashboard_read_models_required()
returns timestamptz
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_required_at timestamptz := clock_timestamp();
begin
  insert into public.ecoflow_read_model_refresh_state(read_model, refreshed_at, row_count)
  values ('DASHBOARD_SOURCE_REQUIRED', v_required_at, 0)
  on conflict(read_model) do update set
    refreshed_at=greatest(
      public.ecoflow_read_model_refresh_state.refreshed_at,
      excluded.refreshed_at
    ),
    row_count=0;

  return v_required_at;
end;
$$;

revoke all on function public.ecoflow_mark_dashboard_read_models_required()
  from public, anon, authenticated;
grant execute on function public.ecoflow_mark_dashboard_read_models_required()
  to service_role;

create or replace function public.ecoflow_assert_current_exception_snapshot()
returns boolean
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
declare
  v_required_at timestamptz;
  v_refreshed_at timestamptz;
begin
  select s.refreshed_at into v_required_at
  from public.ecoflow_read_model_refresh_state s
  where s.read_model='DASHBOARD_SOURCE_REQUIRED';

  select s.refreshed_at into v_refreshed_at
  from public.ecoflow_read_model_refresh_state s
  where s.read_model='CURRENT_EXCEPTIONS';

  if v_required_at is null
     or v_refreshed_at is null
     or v_refreshed_at < v_required_at then
    raise exception using errcode='55000',
      message='ACTIONABLE_EXCEPTION_SNAPSHOT_STALE',
      detail='Current exceptions were not refreshed after the latest Ordermentum projection.',
      hint='Run ecoflow_refresh_dashboard_read_models with the service role.';
  end if;

  return true;
end;
$$;

revoke all on function public.ecoflow_assert_current_exception_snapshot()
  from public, anon, authenticated, service_role;
grant execute on function public.ecoflow_assert_current_exception_snapshot()
  to authenticated;

-- Preserve the expensive source projection under an explicit background-only
-- name. The public operational name is recreated below as the fast snapshot.
alter view public.v_ecoflow_ordermentum_ui_active_exceptions
  rename to v_ecoflow_ordermentum_ui_active_exceptions_live_v1;

revoke all on public.v_ecoflow_ordermentum_ui_active_exceptions_live_v1
  from public, anon, authenticated;
grant select on public.v_ecoflow_ordermentum_ui_active_exceptions_live_v1
  to service_role;

create or replace function public.ecoflow_refresh_current_exception_snapshot()
returns integer
language plpgsql
security definer
set search_path=pg_catalog,public
set statement_timeout='180s'
as $$
declare
  v_refresh_at timestamptz := clock_timestamp();
  v_count integer := 0;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('ecoflow_current_exception_snapshot', 0)
  );

  delete from public.ecoflow_current_exception_snapshot;

  insert into public.ecoflow_current_exception_snapshot(
    exception_id,
    raw_order_id,
    external_order_id,
    external_order_number,
    external_invoice_number,
    order_number,
    invoice_number,
    exception_type,
    message,
    status,
    detected_at,
    snapshot_refreshed_at
  )
  with source_rows as (
    select
      nullif(btrim(e.raw_order_id::text), '') as raw_order_id,
      nullif(btrim(e.external_order_id::text), '') as external_order_id,
      nullif(btrim(e.external_order_number::text), '') as external_order_number,
      nullif(btrim(e.external_invoice_number::text), '') as external_invoice_number,
      nullif(btrim(e.order_number::text), '') as order_number,
      nullif(btrim(e.invoice_number::text), '') as invoice_number,
      nullif(btrim(e.exception_type::text), '') as exception_type,
      nullif(btrim(e.message::text), '') as message,
      nullif(btrim(e.status::text), '') as status,
      e.detected_at::timestamptz as detected_at
    from public.v_ecoflow_ordermentum_ui_active_exceptions_live_v1 e
  ), identified as (
    select
      'ORDERMENTUM_ACTIVE:' || md5(concat_ws('|',
        coalesce(s.raw_order_id, ''),
        coalesce(s.external_order_id, ''),
        coalesce(s.external_order_number, ''),
        coalesce(s.external_invoice_number, ''),
        coalesce(s.order_number, ''),
        coalesce(s.invoice_number, ''),
        coalesce(s.exception_type, ''),
        coalesce(s.status, ''),
        coalesce(s.detected_at::text, '')
      )) as exception_id,
      s.*
    from source_rows s
  )
  select distinct on (i.exception_id)
    i.exception_id,
    i.raw_order_id,
    i.external_order_id,
    i.external_order_number,
    i.external_invoice_number,
    i.order_number,
    i.invoice_number,
    i.exception_type,
    i.message,
    i.status,
    i.detected_at,
    v_refresh_at
  from identified i
  order by i.exception_id, i.detected_at desc nulls last;

  get diagnostics v_count = row_count;

  insert into public.ecoflow_read_model_refresh_state(read_model, refreshed_at, row_count)
  values ('CURRENT_EXCEPTIONS', v_refresh_at, v_count)
  on conflict(read_model) do update set
    refreshed_at=excluded.refreshed_at,
    row_count=excluded.row_count;

  return v_count;
end;
$$;

revoke all on function public.ecoflow_refresh_current_exception_snapshot()
  from public, anon, authenticated;
grant execute on function public.ecoflow_refresh_current_exception_snapshot()
  to service_role;

create view public.v_ecoflow_ordermentum_ui_active_exceptions
with (security_invoker=true)
as
with freshness as materialized (
  select public.ecoflow_assert_current_exception_snapshot() as current
)
select
  s.raw_order_id,
  s.external_order_id,
  s.external_order_number,
  s.external_invoice_number,
  s.order_number,
  s.invoice_number,
  s.exception_type,
  s.message,
  s.status,
  s.detected_at
from freshness f
left join public.ecoflow_current_exception_snapshot s on true
where f.current
  and s.exception_id is not null;

grant select on public.v_ecoflow_ordermentum_ui_active_exceptions to authenticated;
revoke all on public.v_ecoflow_ordermentum_ui_active_exceptions from anon;

-- The queue RPC and the unsnapshotted lifecycle delegate are the two functions
-- that actually expand the live exception source. The public lifecycle command
-- is an idempotent replay wrapper and intentionally remains unchanged: new
-- commands reach the guarded delegate, while immutable replay results do not
-- depend on current source freshness.
do $recompile_source_consumers$
declare
  v_signature text;
  v_definition text;
  v_source text := 'from public.v_ecoflow_ordermentum_ui_active_exceptions e';
  v_replacement text := 'from public.ecoflow_current_exception_snapshot e';
  v_begin_source text := E'begin\n  if not analytics.';
  v_begin_replacement text := E'begin\n  perform public.ecoflow_assert_current_exception_snapshot();\n  if not analytics.';
begin
  foreach v_signature in array array[
    'analytics.get_actionable_exception_queue(integer)',
    'analytics.apply_actionable_exception_lifecycle_command_unsnapshotted_20260730(uuid,text,text,text,timestamptz,text,text)'
  ] loop
    select pg_get_functiondef(v_signature::regprocedure)
      into v_definition;

    if position(v_source in v_definition) = 0 then
      raise exception 'DASHBOARD_TIMEOUT_SOURCE_CONSUMER_NOT_FOUND: %', v_signature;
    end if;
    if position(v_begin_source in v_definition) = 0 then
      raise exception 'DASHBOARD_TIMEOUT_SOURCE_CONSUMER_BEGIN_NOT_FOUND: %', v_signature;
    end if;

    v_definition := replace(v_definition, v_source, v_replacement);
    v_definition := replace(v_definition, v_begin_source, v_begin_replacement);
    execute v_definition;
  end loop;
end;
$recompile_source_consumers$;

create or replace function public.ecoflow_get_dashboard_readiness_v1()
returns table(
  server_current_orders bigint,
  live_on_hand_units numeric,
  registered_barcodes bigint,
  active_exception_count bigint,
  exception_snapshot_refreshed_at timestamptz,
  calculated_at timestamptz
)
language plpgsql
stable
security definer
set search_path=pg_catalog,public
set statement_timeout='8s'
as $$
begin
  if public.ecoflow_active_app_role() not in ('OWNER', 'ADMIN', 'ACCOUNT', 'VIEWER') then
    raise exception using errcode='42501',
      message='DASHBOARD_DESKTOP_ROLE_REQUIRED';
  end if;

  perform public.ecoflow_assert_current_exception_snapshot();

  return query
  with current_orders as (
    select count(*)::bigint as value
    from public.om_orders o
    left join public.ecoflow_ordermentum_source_presence presence
      on presence.domain='ORDER'
     and presence.external_id=o.id::text
    where coalesce(presence.source_status, 'PRESENT') <> 'SOURCE_MISSING'
      and coalesce(o.cancelled, false)=false
      and o.cancelled_at is null
      and lower(trim(coalesce(nullif(o.order_status, ''), nullif(o.status, ''), ''))) not in (
        'cancelled', 'canceled', 'void', 'voided',
        'completed', 'complete', 'closed', 'delivered', 'fulfilled',
        'finalised', 'finalized'
      )
      and greatest(
        coalesce(o.delivery_date, '-infinity'::timestamptz),
        coalesce(o.due_at, '-infinity'::timestamptz),
        coalesce(o.updated_at, '-infinity'::timestamptz),
        coalesce(o.created_at, '-infinity'::timestamptz)
      ) >= now() - interval '60 days'
  ), live_inventory as (
    select coalesce(sum(case
      when m.movement_type in ('RECEIVE', 'ADJUST_IN', 'RETURN_IN') then m.quantity
      when m.movement_type in ('DISPATCH', 'ADJUST_OUT') then -m.quantity
      else 0
    end), 0)::numeric as value
    from public.ecoflow_inventory_movements m
  ), barcode_registry as (
    select count(*)::bigint as value
    from public.ecoflow_sku_barcode_registry
  ), exception_state as (
    select
      coalesce(max(s.row_count), 0)::bigint as row_count,
      max(s.refreshed_at) as refreshed_at
    from public.ecoflow_read_model_refresh_state s
    where s.read_model='CURRENT_EXCEPTIONS'
  )
  select
    o.value,
    i.value,
    b.value,
    e.row_count,
    e.refreshed_at,
    statement_timestamp()
  from current_orders o
  cross join live_inventory i
  cross join barcode_registry b
  cross join exception_state e;
end;
$$;

revoke all on function public.ecoflow_get_dashboard_readiness_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.ecoflow_get_dashboard_readiness_v1()
  to authenticated;

create or replace function public.ecoflow_refresh_dashboard_read_models()
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
set statement_timeout='180s'
as $$
declare
  v_active_keys integer;
  v_exceptions integer;
begin
  v_active_keys := public.ecoflow_refresh_ui_active_order_keys();
  v_exceptions := public.ecoflow_refresh_current_exception_snapshot();

  return jsonb_build_object(
    'active_order_keys', v_active_keys,
    'current_exceptions', v_exceptions,
    'refreshed_at', clock_timestamp()
  );
end;
$$;

revoke all on function public.ecoflow_refresh_dashboard_read_models()
  from public, anon, authenticated;
grant execute on function public.ecoflow_refresh_dashboard_read_models()
  to service_role;

-- Establish the first freshness checkpoint and populate the snapshot in one
-- migration transaction. Failure rolls everything back to the previous live
-- exception view and leaves all operational records unchanged.
select public.ecoflow_mark_dashboard_read_models_required();
select public.ecoflow_refresh_dashboard_read_models();

do $verify$
begin
  if to_regclass('public.v_ecoflow_ordermentum_ui_active_exceptions_live_v1') is null
     or to_regclass('public.v_ecoflow_ordermentum_ui_active_exceptions') is null
     or to_regclass('public.ecoflow_current_exception_snapshot') is null then
    raise exception 'DASHBOARD_TIMEOUT_HARDENING_RELATION_VERIFY_FAILED';
  end if;

  if to_regprocedure('public.ecoflow_get_dashboard_readiness_v1()') is null
     or to_regprocedure('public.ecoflow_mark_dashboard_read_models_required()') is null
     or to_regprocedure('public.ecoflow_assert_current_exception_snapshot()') is null
     or to_regprocedure('public.ecoflow_refresh_dashboard_read_models()') is null then
    raise exception 'DASHBOARD_TIMEOUT_HARDENING_FUNCTION_VERIFY_FAILED';
  end if;
end;
$verify$;

notify pgrst, 'reload schema';
commit;
