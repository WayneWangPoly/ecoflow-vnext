-- EcoFlow Ordermentum operational readiness views
-- Safe migration: creates or replaces read-only views only. No existing data is changed.

create or replace view public.v_ecoflow_ordermentum_order_lines as
select
  o.id::text as external_order_id,
  o.order_number,
  o.invoice_number,
  li.id::text as line_id,
  li.product_id::text as product_id,
  li.variant_id::text as variant_id,
  coalesce(nullif(li.sku, ''), 'OM-LINE-' || left(li.id::text, 8)) as sku,
  coalesce(nullif(li.name, ''), 'Ordermentum line item') as name,
  coalesce(li.quantity, 0) as quantity,
  li.unit,
  li.uom,
  li.packing_unit,
  li.price,
  li.rate_price,
  li.subtotal,
  li.gst,
  li.tax,
  li.total
from public.om_order_items li
join public.om_orders o
  on o.id = li.order_id;

create or replace view public.v_ecoflow_ordermentum_release_queue as
select
  inbox.raw_order_id,
  inbox.external_order_id,
  inbox.external_order_number,
  inbox.external_invoice_number,
  inbox.order_number,
  inbox.invoice_number,
  inbox.order_status,
  inbox.payment_status,
  inbox.order_created_at,
  inbox.order_updated_at,
  inbox.received_business_day,
  inbox.updated_business_day,
  inbox.invoice_total,
  inbox.total_due,
  inbox.is_outstanding,
  inbox.line_count,
  inbox.total_units,
  inbox.invoice_detail_missing,
  inbox.line_items_missing,
  case
    when inbox.invoice_detail_missing or inbox.line_items_missing then 'BLOCKED_DATA'
    when inbox.payment_status is null or upper(inbox.payment_status) in ('N/A', 'UNKNOWN') then 'REVIEW_PAYMENT'
    else 'READY_TO_RELEASE'
  end as release_status,
  concat_ws(', ',
    case when inbox.invoice_detail_missing then 'invoice detail missing' end,
    case when inbox.line_items_missing then 'line items missing' end,
    case when inbox.payment_status is null or upper(inbox.payment_status) in ('N/A', 'UNKNOWN') then 'payment status review' end
  ) as release_blockers,
  case when inbox.invoice_detail_missing or inbox.line_items_missing then false else true end as can_create_internal_order,
  inbox.last_synced_at
from public.v_ecoflow_ordermentum_inbox inbox;

create or replace view public.v_ecoflow_ordermentum_readiness_summary as
select
  count(*) as total_orders,
  count(*) filter (where release_status = 'READY_TO_RELEASE') as ready_to_release,
  count(*) filter (where release_status = 'REVIEW_PAYMENT') as review_payment,
  count(*) filter (where release_status = 'BLOCKED_DATA') as blocked_data,
  count(*) filter (where invoice_detail_missing) as invoice_detail_missing,
  count(*) filter (where line_items_missing) as line_items_missing,
  coalesce(sum(invoice_total), 0) as invoice_total,
  coalesce(sum(total_due), 0) as total_due,
  max(order_updated_at) as latest_order_update,
  max(last_synced_at) as last_synced_at
from public.v_ecoflow_ordermentum_release_queue;
