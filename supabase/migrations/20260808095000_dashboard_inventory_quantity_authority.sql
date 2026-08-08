-- Control Room inventory truth hardening.
--
-- A numeric zero is only a trustworthy stock quantity after an INITIAL
-- stocktake has been explicitly approved. Before that point the system may
-- know warehouse locations and barcode identities, but it does not yet have
-- an authoritative opening quantity. Dashboard Readiness v2 makes that
-- distinction explicit without changing inventory movements or stocktake
-- posting authority.

begin;

do $preflight$
declare
  v_missing text[] := array[]::text[];
begin
  if to_regclass('public.om_orders') is null then
    v_missing := array_append(v_missing, 'public.om_orders');
  end if;
  if to_regclass('public.ecoflow_ordermentum_source_presence') is null then
    v_missing := array_append(v_missing, 'public.ecoflow_ordermentum_source_presence');
  end if;
  if to_regclass('public.ecoflow_inventory_movements') is null then
    v_missing := array_append(v_missing, 'public.ecoflow_inventory_movements');
  end if;
  if to_regclass('public.ecoflow_sku_barcode_registry') is null then
    v_missing := array_append(v_missing, 'public.ecoflow_sku_barcode_registry');
  end if;
  if to_regclass('public.ecoflow_read_model_refresh_state') is null then
    v_missing := array_append(v_missing, 'public.ecoflow_read_model_refresh_state');
  end if;
  if to_regclass('public.ecoflow_stocktake_sessions') is null then
    v_missing := array_append(v_missing, 'public.ecoflow_stocktake_sessions');
  end if;
  if to_regprocedure('public.ecoflow_active_app_role()') is null then
    v_missing := array_append(v_missing, 'public.ecoflow_active_app_role()');
  end if;
  if to_regprocedure('public.ecoflow_assert_current_exception_snapshot()') is null then
    v_missing := array_append(v_missing, 'public.ecoflow_assert_current_exception_snapshot()');
  end if;

  if cardinality(v_missing) > 0 then
    raise exception 'DASHBOARD_INVENTORY_AUTHORITY_PREREQUISITES_MISSING: %',
      array_to_string(v_missing, ', ');
  end if;
end;
$preflight$;

create or replace function public.ecoflow_get_dashboard_readiness_v2()
returns table(
  server_current_orders bigint,
  live_on_hand_units numeric,
  registered_barcodes bigint,
  active_exception_count bigint,
  exception_snapshot_refreshed_at timestamptz,
  inventory_quantity_commissioned boolean,
  initial_stocktake_approved_at timestamptz,
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
  ), quantity_authority as (
    select
      count(*) > 0 as commissioned,
      max(s.approved_at) as approved_at
    from public.ecoflow_stocktake_sessions s
    where s.session_type='INITIAL'
      and s.session_status='APPROVED'
      and s.approved_at is not null
  )
  select
    o.value,
    i.value,
    b.value,
    e.row_count,
    e.refreshed_at,
    q.commissioned,
    q.approved_at,
    statement_timestamp()
  from current_orders o
  cross join live_inventory i
  cross join barcode_registry b
  cross join exception_state e
  cross join quantity_authority q;
end;
$$;

revoke all on function public.ecoflow_get_dashboard_readiness_v2()
  from public, anon, authenticated, service_role;
grant execute on function public.ecoflow_get_dashboard_readiness_v2()
  to authenticated;

comment on function public.ecoflow_get_dashboard_readiness_v2() is
  'Bounded Control Room summary. inventory_quantity_commissioned is true only after an APPROVED INITIAL stocktake; numeric zero before that point must not be presented as authoritative stock.';

commit;
