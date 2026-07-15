-- Production enables a safe-update guard that rejects DELETE without a WHERE
-- clause. Refresh the derived UI key set with a timestamped mark-and-sweep
-- instead of clearing the table first.

begin;

create or replace function public.ecoflow_refresh_ui_active_order_keys()
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  v_count integer := 0;
  v_view text;
  v_refresh_at timestamptz := clock_timestamp();
begin
  if to_regclass('public.ecoflow_ui_active_order_keys') is null then return 0; end if;

  v_view := case
    when to_regclass('public.v_ecoflow_order_operations_v5') is not null then 'public.v_ecoflow_order_operations_v5'
    when to_regclass('public.v_ecoflow_order_operations_v4') is not null then 'public.v_ecoflow_order_operations_v4'
    when to_regclass('public.v_ecoflow_order_operations_v3') is not null then 'public.v_ecoflow_order_operations_v3'
    else null
  end;
  if v_view is null then return 0; end if;

  execute format($sql$
    insert into public.ecoflow_ui_active_order_keys(order_key,refreshed_at)
    select distinct key_value,$1
    from %s o
    cross join lateral (
      values
        (o.raw_order_id),
        (o.external_order_id),
        (o.external_order_number),
        (o.order_number),
        (o.invoice_number)
    ) keys(key_value)
    where o.operational_scope in ('CURRENT','REVIEW')
      and o.fulfilment_status not in ('COMPLETED','CANCELLED','HISTORY')
      and (
        coalesce(to_jsonb(o)->>'source_presence_status','PRESENT')<>'SOURCE_MISSING'
        or o.fulfilment_status in ('RELEASED','PICKING','STAGED','OUT_FOR_DELIVERY')
      )
      and nullif(keys.key_value,'') is not null
    on conflict(order_key) do update set
      refreshed_at=greatest(ecoflow_ui_active_order_keys.refreshed_at,excluded.refreshed_at)
  $sql$, v_view)
  using v_refresh_at;

  get diagnostics v_count=row_count;

  -- This predicate is both semantically correct and compatible with the
  -- production safe-update guard. Only keys not marked by this refresh leave
  -- the active UI set.
  delete from public.ecoflow_ui_active_order_keys
  where refreshed_at is null
     or refreshed_at < v_refresh_at;

  return v_count;
end;
$$;

revoke all on function public.ecoflow_refresh_ui_active_order_keys() from public, anon, authenticated;
grant execute on function public.ecoflow_refresh_ui_active_order_keys() to service_role;

select public.ecoflow_refresh_ui_active_order_keys();
notify pgrst, 'reload schema';
commit;
