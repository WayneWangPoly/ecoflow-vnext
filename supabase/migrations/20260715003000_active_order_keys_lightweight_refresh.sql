-- Active order keys are a derived UI acceleration cache, not commercial truth.
-- Rebuilding them through the multi-join order-operations views can exceed the
-- hosted statement timeout. Populate stable source keys directly from the
-- canonical Ordermentum order table instead. Lifecycle classification remains
-- authoritative in the order-operations views; this cache only narrows legacy
-- supporting views.

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
  cross join lateral (
    values
      (nullif(o.id::text, '')),
      (nullif(o.order_number::text, '')),
      (nullif(o.invoice_number::text, ''))
  ) as keys(key_value)
  where keys.key_value is not null
  on conflict(order_key) do update set
    refreshed_at=greatest(
      public.ecoflow_ui_active_order_keys.refreshed_at,
      excluded.refreshed_at
    );

  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

revoke all on function public.ecoflow_refresh_ui_active_order_keys() from public, anon, authenticated;
grant execute on function public.ecoflow_refresh_ui_active_order_keys() to service_role;

-- Deliberately do not execute the refresh inside the migration transaction.
-- The post-deployment mirror workflow invokes it after the schema is committed.
notify pgrst, 'reload schema';
commit;
