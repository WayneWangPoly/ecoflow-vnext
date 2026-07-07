-- Package 4: Ordermentum -> Internal order -> Warehouse -> Driver lifecycle board.
-- This is a read-only control view for Owner/Accounts so completed Ordermentum orders do not re-enter release/pick flows.
-- All ids are normalised to text because upstream Supabase views can expose uuid and text columns side by side.
-- Uses UNION ALL + aggregation instead of FULL JOIN with OR conditions because Postgres cannot hash/merge join that predicate.

drop view if exists public.v_ecoflow_order_lifecycle_board;

create view public.v_ecoflow_order_lifecycle_board as
with inbox as (
  select
    coalesce(nullif(order_number::text, ''), nullif(external_order_number::text, ''), nullif(external_order_id::text, ''), raw_order_id::text) as lifecycle_key,
    raw_order_id::text as raw_order_id,
    external_order_id::text as external_order_id,
    external_order_number::text as external_order_number,
    external_invoice_number::text as external_invoice_number,
    order_number::text as order_number,
    invoice_number::text as invoice_number,
    order_status::text as order_status,
    invoice_status::text as invoice_status,
    payment_status::text as payment_status,
    invoice_payment_status::text as invoice_payment_status,
    invoice_total::numeric as invoice_total,
    total_due::numeric as total_due,
    line_count::numeric as line_count,
    invoice_detail_missing::boolean as invoice_detail_missing,
    line_items_missing::boolean as line_items_missing,
    order_updated_at::timestamptz as order_updated_at,
    last_synced_at::timestamptz as last_synced_at
  from public.v_ecoflow_ordermentum_inbox
), drafts as (
  select
    coalesce(nullif(order_number::text, ''), nullif(external_order_number::text, ''), nullif(external_order_id::text, ''), raw_order_id::text) as lifecycle_key,
    raw_order_id::text as raw_order_id,
    external_order_id::text as external_order_id,
    external_order_number::text as external_order_number,
    order_number::text as order_number,
    invoice_number::text as invoice_number,
    internalisation_status::text as internalisation_status,
    account_release_status::text as account_release_status,
    warehouse_gate_status::text as warehouse_gate_status,
    internal_order_id::text as internal_order_id,
    invoice_total::numeric as invoice_total,
    total_due::numeric as total_due,
    line_count::numeric as line_count,
    unmapped_line_count::numeric as unmapped_line_count,
    barcode_blocked_line_count::numeric as barcode_blocked_line_count,
    last_synced_at::timestamptz as last_synced_at
  from public.v_ecoflow_ordermentum_internal_order_drafts_v3
), combined as (
  select
    lifecycle_key,
    raw_order_id,
    external_order_id,
    external_order_number,
    external_invoice_number,
    order_number,
    invoice_number,
    order_status,
    invoice_status,
    payment_status,
    invoice_payment_status,
    invoice_total,
    total_due,
    line_count,
    invoice_detail_missing,
    line_items_missing,
    order_updated_at,
    last_synced_at,
    null::text as internalisation_status,
    null::text as account_release_status,
    null::text as warehouse_gate_status,
    null::text as internal_order_id,
    null::numeric as unmapped_line_count,
    null::numeric as barcode_blocked_line_count
  from inbox

  union all

  select
    lifecycle_key,
    raw_order_id,
    external_order_id,
    external_order_number,
    null::text as external_invoice_number,
    order_number,
    invoice_number,
    null::text as order_status,
    null::text as invoice_status,
    null::text as payment_status,
    null::text as invoice_payment_status,
    invoice_total,
    total_due,
    line_count,
    null::boolean as invoice_detail_missing,
    null::boolean as line_items_missing,
    null::timestamptz as order_updated_at,
    last_synced_at,
    internalisation_status,
    account_release_status,
    warehouse_gate_status,
    internal_order_id,
    unmapped_line_count,
    barcode_blocked_line_count
  from drafts
), rolled as (
  select
    lifecycle_key,
    max(raw_order_id) filter (where raw_order_id is not null and raw_order_id <> '') as raw_order_id,
    max(external_order_id) filter (where external_order_id is not null and external_order_id <> '') as external_order_id,
    max(external_order_number) filter (where external_order_number is not null and external_order_number <> '') as external_order_number,
    max(external_invoice_number) filter (where external_invoice_number is not null and external_invoice_number <> '') as external_invoice_number,
    max(order_number) filter (where order_number is not null and order_number <> '') as order_number,
    max(invoice_number) filter (where invoice_number is not null and invoice_number <> '') as invoice_number,
    max(order_status) filter (where order_status is not null and order_status <> '') as order_status,
    max(invoice_status) filter (where invoice_status is not null and invoice_status <> '') as invoice_status,
    max(payment_status) filter (where payment_status is not null and payment_status <> '') as payment_status,
    max(invoice_payment_status) filter (where invoice_payment_status is not null and invoice_payment_status <> '') as invoice_payment_status,
    max(internalisation_status) filter (where internalisation_status is not null and internalisation_status <> '') as internalisation_status,
    max(account_release_status) filter (where account_release_status is not null and account_release_status <> '') as account_release_status,
    max(warehouse_gate_status) filter (where warehouse_gate_status is not null and warehouse_gate_status <> '') as warehouse_gate_status,
    max(internal_order_id) filter (where internal_order_id is not null and internal_order_id <> '') as internal_order_id,
    max(invoice_total) filter (where invoice_total is not null) as invoice_total,
    max(total_due) filter (where total_due is not null) as total_due,
    max(line_count) filter (where line_count is not null) as line_count,
    bool_or(coalesce(invoice_detail_missing, false)) as invoice_detail_missing,
    bool_or(coalesce(line_items_missing, false)) as line_items_missing,
    max(coalesce(unmapped_line_count, 0)) as unmapped_line_count,
    max(coalesce(barcode_blocked_line_count, 0)) as barcode_blocked_line_count,
    max(order_updated_at) as order_updated_at,
    max(last_synced_at) as last_synced_at
  from combined
  group by lifecycle_key
), classified as (
  select
    *,
    (
      lower(coalesce(warehouse_gate_status, '')) in ('not_eligible_data','mapping_exception','not_eligible_mapping','unmapped','barcode_blocked')
      or lower(coalesce(internalisation_status, '')) in ('mapping_exception','blocked_mapping','unmapped','barcode_blocked')
      or coalesce(unmapped_line_count, 0) > 0
      or coalesce(barcode_blocked_line_count, 0) > 0
    ) as is_mapping_blocked,
    (
      coalesce(invoice_detail_missing, false)
      or coalesce(line_items_missing, false)
      or lower(coalesce(internalisation_status, '')) in ('blocked_data','not_eligible_data')
    ) as is_data_blocked
  from rolled
)
select
  coalesce(raw_order_id, external_order_id, order_number, external_order_number, lifecycle_key) as lifecycle_id,
  external_order_id,
  coalesce(order_number, external_order_number) as order_number,
  coalesce(invoice_number, external_invoice_number) as invoice_number,
  order_status as ordermentum_order_status,
  invoice_status as ordermentum_invoice_status,
  internalisation_status,
  account_release_status,
  warehouse_gate_status,
  internal_order_id,
  payment_status,
  invoice_payment_status,
  coalesce(invoice_total, total_due) as invoice_total,
  line_count,
  coalesce(unmapped_line_count, 0) as unmapped_line_count,
  coalesce(barcode_blocked_line_count, 0) as barcode_blocked_line_count,
  case
    when lower(coalesce(order_status, '')) in ('completed','complete','closed','delivered','fulfilled','finalised','finalized')
      or lower(coalesce(invoice_status, '')) in ('completed','complete','closed','delivered','fulfilled','finalised','finalized')
      or lower(coalesce(internalisation_status, '')) in ('completed','complete','closed','delivered','fulfilled','finalised','finalized')
      or lower(coalesce(warehouse_gate_status, '')) in ('completed','complete','closed','delivered','fulfilled','finalised','finalized')
      then 'COMPLETED'
    when nullif(internal_order_id, '') is not null and lower(coalesce(warehouse_gate_status, '')) in ('staged','packed','ready','ready_for_delivery') then 'STAGED'
    when nullif(internal_order_id, '') is not null and lower(coalesce(warehouse_gate_status, '')) in ('picking','pick_started') then 'PICKING'
    when nullif(internal_order_id, '') is not null then 'INTERNAL_ORDER_CREATED'
    when is_mapping_blocked then 'BLOCKED_MAPPING'
    when is_data_blocked then 'BLOCKED_DATA'
    else 'READY_TO_INTERNALISE'
  end as lifecycle_status,
  case
    when lower(coalesce(order_status, '')) in ('completed','complete','closed','delivered','fulfilled','finalised','finalized')
      or lower(coalesce(invoice_status, '')) in ('completed','complete','closed','delivered','fulfilled','finalised','finalized')
      or lower(coalesce(internalisation_status, '')) in ('completed','complete','closed','delivered','fulfilled','finalised','finalized')
      or lower(coalesce(warehouse_gate_status, '')) in ('completed','complete','closed','delivered','fulfilled','finalised','finalized')
      then false
    when is_mapping_blocked or is_data_blocked then false
    when nullif(internal_order_id, '') is not null then false
    else true
  end as can_internalise,
  greatest(
    coalesce(order_updated_at, '1900-01-01'::timestamptz),
    coalesce(last_synced_at, '1900-01-01'::timestamptz)
  ) as lifecycle_updated_at
from classified;

grant select on public.v_ecoflow_order_lifecycle_board to authenticated;
