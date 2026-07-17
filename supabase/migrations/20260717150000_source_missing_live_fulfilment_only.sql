-- A source-missing Ordermentum record blocks mirror completion only when its
-- EcoFlow workflow has progressed into real fulfilment. Pre-release drafts such
-- as READY_TO_INTERNALISE / BLOCKED_BARCODE remain retained operational history,
-- but they are not picking, staged, on-route or otherwise being fulfilled.

begin;

create or replace function public.ecoflow_active_source_missing_order_details()
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  with active as (
    select distinct on (presence.external_id)
      presence.external_id as source_external_id,
      presence.source_reference,
      coalesce(
        nullif(d.order_number::text, ''),
        nullif(d.external_order_number::text, ''),
        nullif(presence.source_reference, ''),
        presence.external_id
      ) as order_number,
      d.internal_order_id::text as internal_order_id,
      nullif(d.internalisation_status::text, '') as internalisation_status,
      nullif(d.warehouse_gate_status::text, '') as warehouse_gate_status,
      d.last_synced_at
    from public.ecoflow_ordermentum_source_presence presence
    join public.v_ecoflow_ordermentum_internal_order_drafts_v3 d
      on presence.external_id in (
        nullif(d.raw_order_id::text, ''),
        nullif(d.external_order_id::text, ''),
        nullif(d.external_order_number::text, ''),
        nullif(d.order_number::text, ''),
        nullif(d.invoice_number::text, '')
      )
    where presence.domain='ORDER'
      and presence.source_status='SOURCE_MISSING'
      and d.internal_order_id is not null
      and (
        lower(trim(coalesce(d.warehouse_gate_status::text, ''))) in (
          'picking', 'pick_started',
          'staged', 'packed', 'ready_for_delivery',
          'out_for_delivery', 'driver_assigned', 'on_route', 'en_route'
        )
        or lower(trim(coalesce(d.internalisation_status::text, ''))) in (
          'released', 'internalised', 'internalized', 'active',
          'in_fulfilment', 'in_fulfillment',
          'picking', 'staged', 'out_for_delivery'
        )
      )
    order by presence.external_id, d.last_synced_at desc nulls last
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'source_external_id', source_external_id,
        'source_reference', source_reference,
        'order_number', order_number,
        'internal_order_id', internal_order_id,
        'internalisation_status', internalisation_status,
        'warehouse_gate_status', warehouse_gate_status,
        'last_synced_at', last_synced_at
      )
      order by order_number, source_external_id
    ),
    '[]'::jsonb
  )
  from active
$$;

create or replace function public.ecoflow_count_active_source_missing_orders()
returns integer
language sql
stable
security definer
set search_path=public
as $$
  select jsonb_array_length(public.ecoflow_active_source_missing_order_details())
$$;

revoke all on function public.ecoflow_active_source_missing_order_details() from public, anon, authenticated;
revoke all on function public.ecoflow_count_active_source_missing_orders() from public, anon, authenticated;
grant execute on function public.ecoflow_active_source_missing_order_details() to service_role;
grant execute on function public.ecoflow_count_active_source_missing_orders() to service_role;

notify pgrst, 'reload schema';
commit;
