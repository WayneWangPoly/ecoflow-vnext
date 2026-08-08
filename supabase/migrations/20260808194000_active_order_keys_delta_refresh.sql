-- Disk IO hotfix: remove write amplification from the active-order key cache.
--
-- The previous refresh used refreshed_at as a mark-and-sweep token. That made
-- every successful Ordermentum projection UPDATE every active cache row even
-- when membership had not changed. The cache is only a derived narrowing set,
-- so unchanged members do not need a write. Compute the desired set once, then
-- insert only newly-active keys and delete only keys that have left scope.
-- Commercial/order lifecycle authority remains unchanged.

begin;

do $preflight$
declare
  v_missing text[] := array[]::text[];
begin
  if to_regclass('public.ecoflow_ui_active_order_keys') is null then
    v_missing := array_append(v_missing, 'public.ecoflow_ui_active_order_keys');
  end if;
  if to_regclass('public.om_orders') is null then
    v_missing := array_append(v_missing, 'public.om_orders');
  end if;
  if to_regclass('public.ecoflow_ordermentum_source_presence') is null then
    v_missing := array_append(v_missing, 'public.ecoflow_ordermentum_source_presence');
  end if;

  if cardinality(v_missing) > 0 then
    raise exception 'ACTIVE_ORDER_KEYS_DELTA_REFRESH_PREREQUISITES_MISSING: %',
      array_to_string(v_missing, ', ');
  end if;
end;
$preflight$;

create or replace function public.ecoflow_refresh_ui_active_order_keys()
returns integer
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_count integer := 0;
begin
  if to_regclass('public.ecoflow_ui_active_order_keys') is null
     or to_regclass('public.om_orders') is null
     or to_regclass('public.ecoflow_ordermentum_source_presence') is null then
    return 0;
  end if;

  -- The cloud sync and full-history reconciliation may overlap. Serialise only
  -- this small derived-cache mutation so two refreshes cannot prune each
  -- other's desired set.
  perform pg_advisory_xact_lock(
    hashtextextended('ecoflow_refresh_ui_active_order_keys', 0)
  );

  with desired_keys as materialized (
    select distinct keys.key_value as order_key
    from public.om_orders o
    left join public.ecoflow_ordermentum_source_presence presence
      on presence.domain='ORDER'
     and presence.external_id=o.id::text
    cross join lateral (
      values
        (nullif(o.id::text, '')),
        (nullif(o.order_number::text, '')),
        (nullif(o.invoice_number::text, ''))
    ) as keys(key_value)
    where keys.key_value is not null
      and coalesce(presence.source_status, 'PRESENT') <> 'SOURCE_MISSING'
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
  ), inserted as (
    insert into public.ecoflow_ui_active_order_keys(order_key)
    select desired.order_key
    from desired_keys desired
    on conflict(order_key) do nothing
    returning order_key
  ), deleted as (
    delete from public.ecoflow_ui_active_order_keys existing
    where existing.order_key is not null
      and not exists (
        select 1
        from desired_keys desired
        where desired.order_key=existing.order_key
      )
    returning existing.order_key
  )
  select count(*)::integer
  into v_count
  from desired_keys;

  return v_count;
end;
$$;

revoke all on function public.ecoflow_refresh_ui_active_order_keys() from public, anon, authenticated;
grant execute on function public.ecoflow_refresh_ui_active_order_keys() to service_role;

-- Correct current membership once at deployment. Unchanged rows are not
-- rewritten; only membership deltas generate table/WAL/index writes.
select public.ecoflow_refresh_ui_active_order_keys();

notify pgrst, 'reload schema';
commit;
