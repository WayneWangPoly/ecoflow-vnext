-- The lightweight cache refresh introduced for statement-timeout resilience
-- accidentally cached every canonical Ordermentum order and never removed stale
-- keys. That made the current-order UI indistinguishable from full history.
-- Rebuild the cache from cheap om_orders scalar fields only, while preserving the
-- same 60-day/current-review boundary used by the authoritative operations model.

begin;

create or replace function public.ecoflow_refresh_ui_active_order_keys()
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  v_count integer := 0;
  v_refresh_at timestamptz := clock_timestamp();
begin
  if to_regclass('public.ecoflow_ui_active_order_keys') is null
     or to_regclass('public.om_orders') is null then
    return 0;
  end if;

  insert into public.ecoflow_ui_active_order_keys(order_key, refreshed_at)
  select distinct keys.key_value, v_refresh_at
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
  on conflict(order_key) do update set
    refreshed_at=excluded.refreshed_at;

  -- Atomic prune: if the insert fails the transaction rolls back, so a failed
  -- refresh cannot empty the cache. Only keys not seen in this successful refresh
  -- are removed.
  delete from public.ecoflow_ui_active_order_keys
  where refreshed_at < v_refresh_at;

  select count(*)::integer
  into v_count
  from public.ecoflow_ui_active_order_keys;

  return v_count;
end;
$$;

revoke all on function public.ecoflow_refresh_ui_active_order_keys() from public, anon, authenticated;
grant execute on function public.ecoflow_refresh_ui_active_order_keys() to service_role;

-- Correct the production cache as part of deployment. The query is bounded to
-- scalar columns in om_orders and does not traverse the historical view stack.
select public.ecoflow_refresh_ui_active_order_keys();

notify pgrst, 'reload schema';
commit;
