drop view if exists public.v_ecoflow_order_lifecycle_active;
drop view if exists public.v_ecoflow_order_lifecycle_legacy_internal_review;

create view public.v_ecoflow_order_lifecycle_legacy_internal_review as
select *
from public.v_ecoflow_order_lifecycle_board
where lifecycle_status = 'INTERNAL_ORDER_CREATED'
  and internal_order_id is not null
  and internal_order_id <> ''
  and lower(coalesce(internalisation_status, '')) in ('ready_to_internalise','ready','release_ready')
  and lower(coalesce(warehouse_gate_status, '')) in ('blocked_barcode','barcode_blocked');

grant select on public.v_ecoflow_order_lifecycle_legacy_internal_review to authenticated;

create view public.v_ecoflow_order_lifecycle_active as
select *
from public.v_ecoflow_order_lifecycle_board
where lifecycle_status <> 'COMPLETED'
  and not (
    lifecycle_status = 'INTERNAL_ORDER_CREATED'
    and internal_order_id is not null
    and internal_order_id <> ''
    and lower(coalesce(internalisation_status, '')) in ('ready_to_internalise','ready','release_ready')
    and lower(coalesce(warehouse_gate_status, '')) in ('blocked_barcode','barcode_blocked')
  );

grant select on public.v_ecoflow_order_lifecycle_active to authenticated;
