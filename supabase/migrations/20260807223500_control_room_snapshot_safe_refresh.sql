-- Repair Control Room read-model refresh on managed Supabase.
--
-- The initial dashboard timeout hardening used an unconditional DELETE inside a
-- service-role RPC. Production has safe-update protection enabled, so scheduled
-- refreshes fail with SQLSTATE 21000 (DELETE requires a WHERE clause) after the
-- source-required checkpoint has already advanced. This migration keeps the
-- same transactional snapshot semantics while satisfying the production guard,
-- then immediately refreshes the read models to clear any existing stale state.

begin;

do $preflight$
declare
  v_missing text[] := array[]::text[];
begin
  if to_regclass('public.ecoflow_current_exception_snapshot') is null then
    v_missing := array_append(v_missing, 'public.ecoflow_current_exception_snapshot');
  end if;
  if to_regclass('public.ecoflow_read_model_refresh_state') is null then
    v_missing := array_append(v_missing, 'public.ecoflow_read_model_refresh_state');
  end if;
  if to_regclass('public.v_ecoflow_ordermentum_ui_active_exceptions_live_v1') is null then
    v_missing := array_append(v_missing, 'public.v_ecoflow_ordermentum_ui_active_exceptions_live_v1');
  end if;
  if to_regprocedure('public.ecoflow_refresh_dashboard_read_models()') is null then
    v_missing := array_append(v_missing, 'public.ecoflow_refresh_dashboard_read_models()');
  end if;
  if to_regprocedure('public.ecoflow_assert_current_exception_snapshot()') is null then
    v_missing := array_append(v_missing, 'public.ecoflow_assert_current_exception_snapshot()');
  end if;

  if cardinality(v_missing) > 0 then
    raise exception 'CONTROL_ROOM_SNAPSHOT_SAFE_REFRESH_PREREQUISITES_MISSING: %',
      array_to_string(v_missing, ', ');
  end if;
end;
$preflight$;

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

  -- Managed Supabase production enables a safe-update guard. Keep an explicit
  -- predicate so the refresh remains a transactional replace without relying
  -- on a session-level bypass or weakening database safety globally.
  delete from public.ecoflow_current_exception_snapshot s
  where s.exception_id is not null;

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

-- Repair the currently stale production state in the same migration. If the
-- background source cannot be evaluated, the migration rolls back instead of
-- claiming the Control Room has recovered.
select public.ecoflow_refresh_dashboard_read_models();

do $verify$
begin
  perform public.ecoflow_assert_current_exception_snapshot();

  if not exists (
    select 1
    from public.ecoflow_read_model_refresh_state s
    where s.read_model='CURRENT_EXCEPTIONS'
  ) then
    raise exception 'CONTROL_ROOM_SNAPSHOT_SAFE_REFRESH_VERIFY_FAILED';
  end if;
end;
$verify$;

notify pgrst, 'reload schema';
commit;
