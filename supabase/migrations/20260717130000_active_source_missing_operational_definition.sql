-- A retained SOURCE_MISSING order is historical by default. It becomes an
-- operational blocker only when EcoFlow has already created an internal order
-- whose fulfilment workflow has not reached a terminal state.
--
-- The lightweight complete-mirror verifier previously inferred "active" from
-- recent commercial timestamps alone. A recently deleted Ordermentum record
-- therefore appeared both as a non-blocking retained-history warning and as a
-- blocking active order. Keep the definition aligned with the established
-- operations contract without evaluating the full order-operations view stack.

begin;

create or replace function public.ecoflow_count_active_source_missing_orders()
returns integer
language sql
stable
security definer
set search_path=public
as $$
  with active_internal_order_keys as (
    select distinct aliases.order_key
    from public.v_ecoflow_ordermentum_internal_order_drafts_v3 d
    cross join lateral (
      values
        (nullif(d.raw_order_id::text, '')),
        (nullif(d.external_order_id::text, '')),
        (nullif(d.external_order_number::text, '')),
        (nullif(d.order_number::text, '')),
        (nullif(d.invoice_number::text, ''))
    ) aliases(order_key)
    where d.internal_order_id is not null
      and aliases.order_key is not null
      and lower(trim(coalesce(d.internalisation_status::text, ''))) not in (
        'completed', 'complete', 'closed', 'delivered', 'fulfilled',
        'finalised', 'finalized', 'cancelled', 'canceled', 'void', 'voided'
      )
      and lower(trim(coalesce(d.warehouse_gate_status::text, ''))) not in (
        'completed', 'complete', 'closed', 'delivered', 'fulfilled',
        'finalised', 'finalized', 'cancelled', 'canceled', 'void', 'voided'
      )
  )
  select count(distinct presence.external_id)::integer
  from public.ecoflow_ordermentum_source_presence presence
  join active_internal_order_keys active
    on active.order_key=presence.external_id
  where presence.domain='ORDER'
    and presence.source_status='SOURCE_MISSING'
$$;

revoke all on function public.ecoflow_count_active_source_missing_orders() from public, anon, authenticated;
grant execute on function public.ecoflow_count_active_source_missing_orders() to service_role;

notify pgrst, 'reload schema';
commit;
