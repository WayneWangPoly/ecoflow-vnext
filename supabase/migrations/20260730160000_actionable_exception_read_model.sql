-- INTEL-DATA-004A: bounded current actionable-exception read model.
--
-- Grain: one row from public.v_ecoflow_ordermentum_ui_active_exceptions.
-- The source is a current active-workflow projection, not a durable exception
-- lifecycle ledger. Unsupported severity, SLA, ownership, impact, action,
-- snooze, resolution, notes and history fields remain explicitly unavailable.
--
-- This package is read-only. It does not acknowledge, assign, snooze, resolve,
-- dismiss, refresh or otherwise mutate an operational exception.

begin;

do $preflight$
declare
  v_missing text[] := array[]::text[];
  v_column text;
begin
  if to_regclass('public.v_ecoflow_ordermentum_ui_active_exceptions') is null then
    v_missing := array_append(v_missing,'public.v_ecoflow_ordermentum_ui_active_exceptions');
  else
    foreach v_column in array array[
      'raw_order_id',
      'external_order_id',
      'external_order_number',
      'external_invoice_number',
      'order_number',
      'invoice_number',
      'exception_type',
      'message',
      'status',
      'detected_at'
    ] loop
      if not exists(
        select 1
        from pg_catalog.pg_attribute
        where attrelid='public.v_ecoflow_ordermentum_ui_active_exceptions'::regclass
          and attname=v_column
          and attnum>0
          and not attisdropped
      ) then
        v_missing := array_append(
          v_missing,
          'public.v_ecoflow_ordermentum_ui_active_exceptions.'||v_column
        );
      end if;
    end loop;
  end if;

  if to_regprocedure('public.ecoflow_active_app_role()') is null then
    v_missing := array_append(v_missing,'public.ecoflow_active_app_role()');
  end if;

  if cardinality(v_missing)>0 then
    raise exception 'ACTIONABLE_EXCEPTION_READ_PREREQUISITES_MISSING: %',
      array_to_string(v_missing,', ');
  end if;
end;
$preflight$;

create or replace function analytics.get_actionable_exception_queue(
  p_limit integer default 100
)
returns table(
  exception_id text,
  source_key text,
  source_kind text,
  source_status text,
  title text,
  detail text,
  severity text,
  status text,
  detected_at timestamptz,
  updated_at timestamptz,
  due_at timestamptz,
  owner_team text,
  impact_unit_kind text,
  impact_value numeric,
  impact_display_value text,
  affected_count bigint,
  recommended_action text,
  handoff_workspace text,
  handoff_entity_kind text,
  handoff_entity_id text,
  snooze_until timestamptz,
  resolved_at timestamptz,
  resolved_by text,
  resolution_note text,
  notes jsonb,
  audit_history jsonb,
  lifecycle_capability text,
  sla_capability text,
  ownership_capability text,
  impact_capability text,
  action_capability text,
  history_capability text,
  read_at timestamptz,
  raw_order_id text,
  external_order_id text,
  external_order_number text,
  external_invoice_number text,
  order_number text,
  invoice_number text,
  exception_type text
)
language plpgsql
security invoker
set search_path=pg_catalog,analytics,public
as $$
declare
  v_role text := public.ecoflow_active_app_role();
  v_limit integer := coalesce(p_limit,100);
begin
  if auth.uid() is null
     or v_role not in ('OWNER','ADMIN','ACCOUNT','VIEWER') then
    raise exception using errcode='42501',
      message='ACTIONABLE_EXCEPTION_DESKTOP_ROLE_REQUIRED';
  end if;

  if v_limit<1 or v_limit>300 then
    raise exception using errcode='22023',
      message='ACTIONABLE_EXCEPTION_LIMIT_INVALID';
  end if;

  return query
  with source_rows as (
    select
      e.raw_order_id::text as raw_order_id,
      e.external_order_id::text as external_order_id,
      e.external_order_number::text as external_order_number,
      e.external_invoice_number::text as external_invoice_number,
      e.order_number::text as order_number,
      e.invoice_number::text as invoice_number,
      nullif(btrim(e.exception_type::text),'') as exception_type,
      nullif(btrim(e.message::text),'') as message,
      nullif(btrim(e.status::text),'') as source_status,
      e.detected_at::timestamptz as detected_at,
      coalesce(
        nullif(btrim(e.raw_order_id::text),''),
        nullif(btrim(e.external_order_id::text),''),
        nullif(btrim(e.order_number::text),''),
        nullif(btrim(e.external_order_number::text),'')
      ) as handoff_order_id
    from public.v_ecoflow_ordermentum_ui_active_exceptions e
  ), identified as (
    select
      'ORDERMENTUM_ACTIVE:'||md5(concat_ws('|',
        coalesce(s.raw_order_id,''),
        coalesce(s.external_order_id,''),
        coalesce(s.external_order_number,''),
        coalesce(s.external_invoice_number,''),
        coalesce(s.order_number,''),
        coalesce(s.invoice_number,''),
        coalesce(s.exception_type,''),
        coalesce(s.source_status,''),
        coalesce(s.detected_at::text,'')
      )) as exception_id,
      s.*
    from source_rows s
  )
  select
    i.exception_id,
    i.exception_id as source_key,
    'order'::text as source_kind,
    i.source_status,
    i.exception_type as title,
    i.message as detail,
    'unknown'::text as severity,
    coalesce(nullif(lower(i.source_status),''),'unknown') as status,
    i.detected_at,
    null::timestamptz as updated_at,
    null::timestamptz as due_at,
    null::text as owner_team,
    'unknown'::text as impact_unit_kind,
    null::numeric as impact_value,
    null::text as impact_display_value,
    null::bigint as affected_count,
    null::text as recommended_action,
    'orders'::text as handoff_workspace,
    case when i.handoff_order_id is null then null else 'order'::text end
      as handoff_entity_kind,
    i.handoff_order_id as handoff_entity_id,
    null::timestamptz as snooze_until,
    null::timestamptz as resolved_at,
    null::text as resolved_by,
    null::text as resolution_note,
    null::jsonb as notes,
    null::jsonb as audit_history,
    'CURRENT_ACTIVE_ONLY'::text as lifecycle_capability,
    'UNAVAILABLE'::text as sla_capability,
    'UNAVAILABLE'::text as ownership_capability,
    'UNAVAILABLE'::text as impact_capability,
    'UNAVAILABLE'::text as action_capability,
    'UNAVAILABLE'::text as history_capability,
    statement_timestamp() as read_at,
    i.raw_order_id,
    i.external_order_id,
    i.external_order_number,
    i.external_invoice_number,
    i.order_number,
    i.invoice_number,
    i.exception_type
  from identified i
  order by i.detected_at desc nulls last,i.exception_id
  limit v_limit;
end;
$$;

revoke all on function analytics.get_actionable_exception_queue(integer)
  from public,anon,authenticated,service_role;
grant execute on function analytics.get_actionable_exception_queue(integer)
  to authenticated;

comment on function analytics.get_actionable_exception_queue(integer) is
  'Bounded caller-rights read of current Ordermentum active exceptions for desktop roles. Current-active context only; no severity, SLA, ownership, impact, action, resolution or history claims and no operational writes.';

notify pgrst,'reload schema';

commit;
