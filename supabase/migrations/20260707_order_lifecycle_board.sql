-- Package 4: Ordermentum -> Internal order -> Warehouse -> Driver lifecycle board.
-- This is a read-only control view for Owner/Accounts so completed Ordermentum orders do not re-enter release/pick flows.

drop view if exists public.v_ecoflow_order_lifecycle_board;

create view public.v_ecoflow_order_lifecycle_board as
select
  coalesce(i.raw_order_id, d.raw_order_id, i.external_order_id, d.external_order_id, i.order_number, d.order_number) as lifecycle_id,
  coalesce(i.external_order_id, d.external_order_id) as external_order_id,
  coalesce(i.order_number, i.external_order_number, d.order_number, d.external_order_number) as order_number,
  coalesce(i.invoice_number, i.external_invoice_number, d.invoice_number) as invoice_number,
  i.order_status as ordermentum_order_status,
  i.invoice_status as ordermentum_invoice_status,
  d.internalisation_status,
  d.account_release_status,
  d.warehouse_gate_status,
  d.internal_order_id,
  i.payment_status,
  i.invoice_payment_status,
  coalesce(i.invoice_total, d.invoice_total, i.total_due, d.total_due) as invoice_total,
  coalesce(i.line_count, d.line_count) as line_count,
  coalesce(d.unmapped_line_count, 0) as unmapped_line_count,
  coalesce(d.barcode_blocked_line_count, 0) as barcode_blocked_line_count,
  case
    when lower(coalesce(i.order_status, '')) in ('completed','complete','closed','delivered','fulfilled','finalised','finalized')
      or lower(coalesce(i.invoice_status, '')) in ('completed','complete','closed','delivered','fulfilled','finalised','finalized')
      or lower(coalesce(d.internalisation_status, '')) in ('completed','complete','closed','delivered','fulfilled','finalised','finalized')
      or lower(coalesce(d.warehouse_gate_status, '')) in ('completed','complete','closed','delivered','fulfilled','finalised','finalized')
      then 'COMPLETED'
    when coalesce(d.internal_order_id, '') <> '' and lower(coalesce(d.warehouse_gate_status, '')) in ('staged','packed','ready','ready_for_delivery') then 'STAGED'
    when coalesce(d.internal_order_id, '') <> '' and lower(coalesce(d.warehouse_gate_status, '')) in ('picking','pick_started') then 'PICKING'
    when coalesce(d.internal_order_id, '') <> '' then 'INTERNAL_ORDER_CREATED'
    when coalesce(i.invoice_detail_missing, false) or coalesce(i.line_items_missing, false) then 'BLOCKED_DATA'
    when coalesce(d.unmapped_line_count, 0) > 0 or coalesce(d.barcode_blocked_line_count, 0) > 0 then 'BLOCKED_MAPPING'
    else 'READY_TO_INTERNALISE'
  end as lifecycle_status,
  case
    when lower(coalesce(i.order_status, '')) in ('completed','complete','closed','delivered','fulfilled','finalised','finalized')
      or lower(coalesce(i.invoice_status, '')) in ('completed','complete','closed','delivered','fulfilled','finalised','finalized')
      or lower(coalesce(d.internalisation_status, '')) in ('completed','complete','closed','delivered','fulfilled','finalised','finalized')
      or lower(coalesce(d.warehouse_gate_status, '')) in ('completed','complete','closed','delivered','fulfilled','finalised','finalized')
      then false
    when coalesce(i.invoice_detail_missing, false) or coalesce(i.line_items_missing, false) then false
    when coalesce(d.unmapped_line_count, 0) > 0 or coalesce(d.barcode_blocked_line_count, 0) > 0 then false
    when coalesce(d.internal_order_id, '') <> '' then false
    else true
  end as can_internalise,
  greatest(
    coalesce(i.order_updated_at, '1900-01-01'::timestamptz),
    coalesce(i.last_synced_at, '1900-01-01'::timestamptz),
    coalesce(d.last_synced_at, '1900-01-01'::timestamptz)
  ) as lifecycle_updated_at
from public.v_ecoflow_ordermentum_inbox i
full join public.v_ecoflow_ordermentum_internal_order_drafts_v3 d
  on d.external_order_id = i.external_order_id
  or d.order_number = i.order_number
  or d.order_number = i.external_order_number;

grant select on public.v_ecoflow_order_lifecycle_board to authenticated;
