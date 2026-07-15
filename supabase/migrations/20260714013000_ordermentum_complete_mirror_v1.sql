-- Ordermentum complete mirror v1
--
-- Phase one makes source completeness the non-negotiable platform boundary:
-- keep full Ordermentum payloads, project every supported invoice fact, expose
-- order and invoice money separately, and classify only recognised source
-- states as current work. Financial reconciliation never fabricates fulfilment.

begin;

create or replace function public.ecoflow_project_ordermentum_raw_invoices(p_limit integer default 1000)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_rec record;
  v_payload jsonb;
  v_invoice jsonb;
  v_invoice_id uuid;
  v_supplier_id uuid;
  v_payment_method text;
  v_projected integer := 0;
  v_failed integer := 0;
  v_failures jsonb := '[]'::jsonb;
begin
  for v_rec in
    select
      r.resource_type,
      r.external_id,
      r.payload,
      r.remote_updated_at,
      r.last_synced_at
    from public.ordermentum_raw_master_resources r
    where r.resource_type in ('invoices', 'invoice_detail')
      and public.ecoflow_om_safe_uuid(coalesce(
        r.payload->>'id',
        r.payload->>'invoiceId',
        r.payload#>>'{invoice,id}'
      )) is not null
      and not exists (
        select 1
        from public.om_invoices i
        where i.id = public.ecoflow_om_safe_uuid(coalesce(
          r.payload->>'id',
          r.payload->>'invoiceId',
          r.payload#>>'{invoice,id}'
        ))
          and to_jsonb(i.raw_json) = case
            when jsonb_typeof(r.payload->'invoice') = 'object' then r.payload->'invoice'
            else r.payload
          end
      )
    order by coalesce(r.remote_updated_at, r.last_synced_at) asc nulls first
    limit greatest(coalesce(p_limit, 1000), 1)
  loop
    begin
      v_payload := v_rec.payload;
      v_invoice := case
        when jsonb_typeof(v_payload->'invoice') = 'object' then v_payload->'invoice'
        else v_payload
      end;
      v_invoice_id := public.ecoflow_om_safe_uuid(coalesce(
        v_invoice->>'id',
        v_invoice->>'invoiceId',
        v_payload->>'invoiceId'
      ));
      v_supplier_id := public.ecoflow_om_safe_uuid(coalesce(
        v_invoice->>'supplierId',
        v_payload->>'supplierId'
      ));

      if v_invoice_id is null then
        raise exception 'invoice payload has no valid UUID id';
      end if;
      if v_supplier_id is null then
        raise exception 'invoice payload has no valid supplierId';
      end if;

      v_payment_method := case
        when jsonb_typeof(v_invoice->'paymentMethod') = 'string'
          then nullif(v_invoice->>'paymentMethod', '')
        when jsonb_typeof(v_invoice->'paymentMethod') = 'object'
          then coalesce(
            nullif(v_invoice#>>'{paymentMethod,name}', ''),
            nullif(v_invoice#>>'{paymentMethod,type}', ''),
            nullif(v_invoice#>>'{paymentMethod,label}', '')
          )
        else coalesce(
          nullif(v_invoice->>'invoicePaymentMethod', ''),
          nullif(v_invoice->>'currentPaymentMethod', '')
        )
      end;

      insert into public.om_invoices (
        id, supplier_id, purchaser_id, retailer_id,
        number, status, invoice_status, payment_status, payment_method,
        payment_transaction_id, settlement_reference, reference,
        subtotal, surcharge, credit, total, total_charge, total_discount,
        total_due, total_freight, total_gst,
        date, due_at, charge_at, paid_at, paid_supplier_at,
        raw_json, created_at, updated_at
      ) values (
        v_invoice_id,
        v_supplier_id,
        public.ecoflow_om_safe_uuid(coalesce(v_invoice->>'purchaserId', v_payload->>'purchaserId')),
        public.ecoflow_om_safe_uuid(coalesce(v_invoice->>'retailerId', v_payload->>'retailerId')),
        nullif(coalesce(v_invoice->>'number', v_invoice->>'invoiceNumber'), ''),
        nullif(v_invoice->>'status', ''),
        nullif(coalesce(v_invoice->>'invoiceStatus', v_invoice->>'status'), ''),
        nullif(v_invoice->>'paymentStatus', ''),
        v_payment_method,
        nullif(v_invoice->>'paymentTransactionId', ''),
        nullif(v_invoice->>'settlementReference', ''),
        nullif(v_invoice->>'reference', ''),
        public.ecoflow_om_safe_numeric(coalesce(v_invoice->>'subtotal', v_invoice->>'subTotal')),
        public.ecoflow_om_safe_numeric(coalesce(
          v_invoice->>'surcharge',
          v_invoice->>'surchargeAmount',
          v_invoice->>'cardSurcharge'
        )),
        public.ecoflow_om_safe_numeric(v_invoice->>'credit'),
        public.ecoflow_om_safe_numeric(coalesce(v_invoice->>'total', v_invoice->>'invoiceTotal')),
        public.ecoflow_om_safe_numeric(coalesce(v_invoice->>'totalCharge', v_invoice->>'invoiceTotal')),
        public.ecoflow_om_safe_numeric(v_invoice->>'totalDiscount'),
        public.ecoflow_om_safe_numeric(coalesce(v_invoice->>'totalDue', v_invoice->>'amountDue')),
        public.ecoflow_om_safe_numeric(coalesce(v_invoice->>'totalFreight', v_invoice->>'freight')),
        public.ecoflow_om_safe_numeric(coalesce(v_invoice->>'totalGST', v_invoice->>'gstTotal')),
        public.ecoflow_om_safe_ts(coalesce(v_invoice->>'date', v_invoice->>'invoiceDate')),
        public.ecoflow_om_safe_ts(coalesce(v_invoice->>'dueAt', v_invoice->>'dueDate')),
        public.ecoflow_om_safe_ts(v_invoice->>'chargeAt'),
        public.ecoflow_om_safe_ts(v_invoice->>'paidAt'),
        public.ecoflow_om_safe_ts(v_invoice->>'paidSupplierAt'),
        v_invoice,
        coalesce(public.ecoflow_om_safe_ts(v_invoice->>'createdAt'), now()),
        coalesce(
          public.ecoflow_om_safe_ts(v_invoice->>'updatedAt'),
          v_rec.remote_updated_at,
          v_rec.last_synced_at,
          now()
        )
      )
      on conflict (id) do update set
        supplier_id = excluded.supplier_id,
        purchaser_id = excluded.purchaser_id,
        retailer_id = excluded.retailer_id,
        number = excluded.number,
        status = excluded.status,
        invoice_status = excluded.invoice_status,
        payment_status = excluded.payment_status,
        payment_method = excluded.payment_method,
        payment_transaction_id = excluded.payment_transaction_id,
        settlement_reference = excluded.settlement_reference,
        reference = excluded.reference,
        subtotal = excluded.subtotal,
        surcharge = excluded.surcharge,
        credit = excluded.credit,
        total = excluded.total,
        total_charge = excluded.total_charge,
        total_discount = excluded.total_discount,
        total_due = excluded.total_due,
        total_freight = excluded.total_freight,
        total_gst = excluded.total_gst,
        date = excluded.date,
        due_at = excluded.due_at,
        charge_at = excluded.charge_at,
        paid_at = excluded.paid_at,
        paid_supplier_at = excluded.paid_supplier_at,
        raw_json = excluded.raw_json,
        updated_at = excluded.updated_at;

      v_projected := v_projected + 1;
    exception when others then
      v_failed := v_failed + 1;
      v_failures := v_failures || jsonb_build_array(jsonb_build_object(
        'resource_type', v_rec.resource_type,
        'external_id', v_rec.external_id,
        'error', sqlerrm
      ));
    end;
  end loop;

  return jsonb_build_object(
    'projected_invoices', v_projected,
    'failed_invoices', v_failed,
    'failures', v_failures
  );
end
$fn$;

revoke all on function public.ecoflow_project_ordermentum_raw_invoices(integer) from public, anon, authenticated;
grant execute on function public.ecoflow_project_ordermentum_raw_invoices(integer) to service_role;

create or replace view public.v_ecoflow_order_financial_truth_v1 as
with joined as (
  select
    o.id::text as source_order_id,
    o.order_number::text as order_number,
    coalesce(i.number::text, o.invoice_number::text) as invoice_number,
    o.retailer_id::text as retailer_id,
    o.retailer_name::text as store_name,
    o.order_status::text as source_order_status,
    o.payment_status::text as source_order_payment_status,
    i.status::text as source_invoice_status,
    i.payment_status::text as invoice_payment_status,
    coalesce(
      nullif(i.payment_method::text, ''),
      nullif(i.raw_json#>>'{paymentMethod,name}', ''),
      nullif(i.raw_json#>>'{paymentMethod,type}', ''),
      nullif(i.raw_json->>'invoicePaymentMethod', ''),
      nullif(i.raw_json->>'currentPaymentMethod', '')
    ) as payment_method,
    coalesce(
      nullif(i.raw_json->>'paymentTerms', ''),
      nullif(i.raw_json->>'paymentTerm', ''),
      nullif(i.raw_json->>'terms', '')
    ) as payment_terms,
    o.subtotal::numeric as order_subtotal,
    o.total_gst::numeric as order_gst,
    o.total_freight::numeric as order_freight,
    o.total_discount::numeric as order_discount,
    o.total::numeric as order_total,
    i.subtotal::numeric as invoice_subtotal,
    i.total_gst::numeric as invoice_gst,
    coalesce(i.surcharge, o.surcharge, 0)::numeric as surcharge_amount,
    i.credit::numeric as credit_amount,
    i.total_freight::numeric as invoice_freight,
    i.total_discount::numeric as invoice_discount,
    coalesce(i.total, i.total_charge, i.total_due)::numeric as invoice_total,
    i.total_due::numeric as amount_due,
    i.date::timestamptz as invoice_date,
    i.due_at::timestamptz as invoice_due_at,
    i.paid_at::timestamptz as paid_at,
    coalesce(
      nullif(i.raw_json->>'unleashedStatus', ''),
      nullif(i.raw_json->>'syncStatus', ''),
      nullif(i.raw_json#>>'{integrations,unleashed,status}', '')
    ) as unleashed_sync_status,
    greatest(
      coalesce(o.updated_at, '1900-01-01'::timestamptz),
      coalesce(i.updated_at, '1900-01-01'::timestamptz)
    ) as financial_observed_at
  from public.om_orders o
  left join lateral (
    select invoice.*
    from public.om_invoices invoice
    where invoice.id = o.invoice_id
       or (nullif(o.invoice_number::text, '') is not null and invoice.number::text = o.invoice_number::text)
    order by
      case when invoice.id = o.invoice_id then 0 else 1 end,
      invoice.updated_at desc nulls last
    limit 1
  ) i on true
), calculated as (
  select
    j.*,
    case
      when coalesce(j.surcharge_amount, 0) > 0
        and lower(coalesce(j.payment_method, '')) similar to '%(credit|debit|card)%'
        then 'CARD'
      when coalesce(j.surcharge_amount, 0) > 0 then 'OTHER'
      else 'NONE'
    end as surcharge_type,
    case
      when coalesce(j.order_total, 0) > 0 and coalesce(j.surcharge_amount, 0) > 0
        then round(j.surcharge_amount / j.order_total, 6)
      else 0::numeric
    end as surcharge_rate,
    case
      when j.invoice_number is null or j.invoice_total is null then 'MISSING_INVOICE'
      when abs(j.invoice_total - coalesce(j.order_total, 0)) <= 0.02
        and abs(coalesce(j.surcharge_amount, 0)) <= 0.02 then 'MATCHED'
      when abs(j.invoice_total - (coalesce(j.order_total, 0) + coalesce(j.surcharge_amount, 0))) <= 0.02
        then 'SURCHARGE_MATCHED'
      else 'REVIEW'
    end as reconciliation_status
  from joined j
)
select
  source_order_id,
  order_number,
  invoice_number,
  retailer_id,
  store_name,
  source_order_status,
  source_order_payment_status,
  source_invoice_status,
  invoice_payment_status,
  payment_method,
  payment_terms,
  order_subtotal,
  order_gst,
  order_freight,
  order_discount,
  order_total,
  invoice_subtotal,
  invoice_gst,
  surcharge_type,
  surcharge_rate,
  surcharge_amount,
  credit_amount,
  invoice_freight,
  invoice_discount,
  invoice_total,
  amount_due,
  case
    when invoice_total is null or order_total is null then null
    else invoice_total - order_total
  end as invoice_order_variance,
  reconciliation_status,
  invoice_date,
  invoice_due_at,
  paid_at,
  unleashed_sync_status,
  financial_observed_at
from calculated;

grant select on public.v_ecoflow_order_financial_truth_v1 to authenticated;
revoke all on public.v_ecoflow_order_financial_truth_v1 from anon;

create or replace view public.v_ecoflow_order_operations_v3 as
select
  o.operation_key,
  o.raw_order_id,
  o.external_order_id,
  o.external_order_number,
  o.external_invoice_number,
  o.order_number,
  o.invoice_number,
  o.retailer_id,
  coalesce(f.store_name, o.store_name) as store_name,
  o.source_order_status,
  o.source_invoice_status,
  o.source_payment_status,
  o.invoice_payment_status,
  o.internal_order_id,
  o.internalisation_status,
  o.account_release_status,
  o.warehouse_gate_status,
  case
    when lower(coalesce(o.source_order_status, '')) = 'placed'
      and o.fulfilment_status = 'SOURCE_REVIEW'
      then 'UNRELEASED'
    else o.fulfilment_status
  end as fulfilment_status,
  o.data_quality_status,
  case
    when lower(coalesce(o.source_order_status, '')) = 'placed'
      and o.operational_scope = 'REVIEW'
      then 'CURRENT'
    else o.operational_scope
  end as operational_scope,
  (
    o.release_eligible
    or (
      lower(coalesce(o.source_order_status, '')) = 'placed'
      and o.source_business_at >= now() - interval '60 days'
      and o.data_quality_status = 'READY'
      and nullif(o.internal_order_id, '') is null
      and lower(coalesce(o.account_release_status, '')) not in ('hold_payment_review', 'credit_hold', 'held')
    )
  ) as release_eligible,
  case
    when lower(coalesce(o.source_order_status, '')) = 'placed'
      and o.operational_scope = 'REVIEW'
      then 'Current Ordermentum order · placed'
    else o.classification_reason
  end as classification_reason,
  coalesce(f.invoice_total, f.order_total, o.order_value)::numeric as order_value,
  o.line_count,
  o.unmapped_line_count,
  o.barcode_blocked_line_count,
  o.source_created_at,
  o.source_updated_at,
  o.source_business_at,
  o.requested_delivery_at,
  greatest(o.observed_at, coalesce(f.financial_observed_at, '1900-01-01'::timestamptz)) as observed_at,
  f.order_subtotal,
  f.order_gst,
  f.order_total,
  f.invoice_subtotal,
  f.invoice_gst,
  f.surcharge_type,
  f.surcharge_rate,
  f.surcharge_amount,
  f.invoice_total,
  f.amount_due,
  f.invoice_order_variance,
  f.payment_method,
  f.payment_terms,
  f.reconciliation_status,
  f.invoice_date,
  f.invoice_due_at,
  f.unleashed_sync_status
from public.v_ecoflow_order_operations_v2 o
left join public.v_ecoflow_order_financial_truth_v1 f
  on f.source_order_id = o.external_order_id
  or f.order_number = o.order_number
  or (f.invoice_number is not null and f.invoice_number = o.invoice_number);

grant select on public.v_ecoflow_order_operations_v3 to authenticated;
revoke all on public.v_ecoflow_order_operations_v3 from anon;

create or replace view public.v_ecoflow_order_operations_summary_v3 as
select
  count(*)::numeric as total_orders,
  count(*) filter (where operational_scope = 'CURRENT')::numeric as current_orders,
  count(*) filter (where operational_scope = 'REVIEW')::numeric as source_review_orders,
  count(*) filter (where release_eligible)::numeric as ready_to_release,
  count(*) filter (
    where operational_scope in ('CURRENT', 'REVIEW')
      and (data_quality_status <> 'READY' or fulfilment_status = 'SOURCE_REVIEW')
  )::numeric as blocked_orders,
  count(*) filter (
    where operational_scope = 'CURRENT'
      and fulfilment_status in ('RELEASED', 'PICKING', 'STAGED', 'OUT_FOR_DELIVERY')
  )::numeric as in_progress_orders,
  count(*) filter (where fulfilment_status = 'COMPLETED')::numeric as completed_orders,
  count(*) filter (where fulfilment_status = 'CANCELLED')::numeric as cancelled_orders,
  count(*) filter (where reconciliation_status = 'SURCHARGE_MATCHED')::numeric as surcharge_invoices,
  count(*) filter (where reconciliation_status in ('REVIEW', 'MISSING_INVOICE'))::numeric as finance_review_orders,
  coalesce(sum(order_value) filter (where operational_scope in ('CURRENT', 'REVIEW')), 0)::numeric as current_value,
  max(source_updated_at) as latest_source_update,
  max(observed_at) as last_observed_at
from public.v_ecoflow_order_operations_v3;

grant select on public.v_ecoflow_order_operations_summary_v3 to authenticated;
revoke all on public.v_ecoflow_order_operations_summary_v3 from anon;

create or replace view public.v_ecoflow_ordermentum_mirror_health_v1 as
with raw_orders as (
  select
    count(*)::numeric as raw_order_count,
    max(last_synced_at) as latest_raw_order_sync
  from public.ordermentum_raw_orders
), projected_orders as (
  select count(*)::numeric as projected_order_count
  from public.om_orders
), order_gaps as (
  select count(*)::numeric as order_projection_missing
  from public.ordermentum_raw_orders r
  where nullif(r.external_order_id::text, '') is not null
    and not exists (
      select 1 from public.om_orders o where o.id::text = r.external_order_id::text
    )
), raw_master as (
  select
    count(distinct external_id) filter (where resource_type in ('invoices', 'invoice_detail'))::numeric as raw_invoice_count,
    count(distinct external_id) filter (where resource_type in ('purchasers', 'purchaser_detail'))::numeric as purchaser_count,
    count(distinct external_id) filter (where resource_type in ('products', 'product_detail'))::numeric as product_count,
    count(distinct external_id) filter (where resource_type in ('variants', 'variant_detail'))::numeric as variant_count,
    count(distinct external_id) filter (where resource_type in ('price_groups', 'price_group_detail'))::numeric as price_group_count,
    count(distinct external_id) filter (where resource_type in ('stock_locations', 'stock_location_detail'))::numeric as stock_location_count,
    max(last_synced_at) as latest_master_sync
  from public.ordermentum_raw_master_resources
), invoice_gaps as (
  select count(*)::numeric as invoice_projection_missing
  from public.ordermentum_raw_master_resources r
  where r.resource_type in ('invoices', 'invoice_detail')
    and public.ecoflow_om_safe_uuid(coalesce(
      r.payload->>'id',
      r.payload->>'invoiceId',
      r.payload#>>'{invoice,id}'
    )) is not null
    and not exists (
      select 1
      from public.om_invoices i
      where i.id = public.ecoflow_om_safe_uuid(coalesce(
        r.payload->>'id',
        r.payload->>'invoiceId',
        r.payload#>>'{invoice,id}'
      ))
    )
), projected_invoices as (
  select count(*)::numeric as projected_invoice_count
  from public.om_invoices
), detail_health as (
  select
    count(*) filter (
      where coalesce(line_items_missing, false)
        and coalesce(order_updated_at, last_seen_at) >= now() - interval '90 days'
    )::numeric as recent_orders_missing_lines,
    count(*) filter (
      where coalesce(invoice_detail_missing, false)
        and coalesce(order_updated_at, last_seen_at) >= now() - interval '90 days'
    )::numeric as recent_orders_missing_invoice_detail
  from public.v_ecoflow_ordermentum_inbox
), classification_health as (
  select
    count(*) filter (
      where operational_scope = 'REVIEW' and fulfilment_status = 'SOURCE_REVIEW'
    )::numeric as unknown_recent_statuses,
    count(*) filter (
      where source_business_at >= now() - interval '90 days'
        and reconciliation_status in ('REVIEW', 'MISSING_INVOICE')
    )::numeric as recent_finance_reviews
  from public.v_ecoflow_order_operations_v3
)
select
  case
    when ro.raw_order_count = 0 then 'FAILED'
    when og.order_projection_missing > 0
      or rm.raw_invoice_count = 0
      or ig.invoice_projection_missing > 0
      or dh.recent_orders_missing_lines > 0
      or dh.recent_orders_missing_invoice_detail > 0
      or ch.unknown_recent_statuses > 0
      or ch.recent_finance_reviews > 0
      or rm.purchaser_count = 0
      or (rm.product_count + rm.variant_count) = 0
      or rm.price_group_count = 0
      then 'DEGRADED'
    else 'COMPLETE'
  end as overall_status,
  ro.raw_order_count,
  po.projected_order_count,
  og.order_projection_missing,
  rm.raw_invoice_count,
  pi.projected_invoice_count,
  ig.invoice_projection_missing,
  dh.recent_orders_missing_lines,
  dh.recent_orders_missing_invoice_detail,
  ch.unknown_recent_statuses,
  ch.recent_finance_reviews,
  rm.purchaser_count,
  rm.product_count,
  rm.variant_count,
  rm.price_group_count,
  rm.stock_location_count,
  ro.latest_raw_order_sync,
  rm.latest_master_sync,
  now() as checked_at
from raw_orders ro
cross join projected_orders po
cross join order_gaps og
cross join raw_master rm
cross join invoice_gaps ig
cross join projected_invoices pi
cross join detail_health dh
cross join classification_health ch;

grant select on public.v_ecoflow_ordermentum_mirror_health_v1 to authenticated;
revoke all on public.v_ecoflow_ordermentum_mirror_health_v1 from anon;

create or replace function public.ecoflow_refresh_ui_active_order_keys()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from public.ecoflow_ui_active_order_keys;

  insert into public.ecoflow_ui_active_order_keys (order_key, refreshed_at)
  select distinct key_value, now()
  from public.v_ecoflow_order_operations_v3 o
  cross join lateral (
    values
      (o.raw_order_id),
      (o.external_order_id),
      (o.external_order_number),
      (o.order_number),
      (o.invoice_number)
  ) as keys(key_value)
  where o.operational_scope in ('CURRENT', 'REVIEW')
    and o.fulfilment_status not in ('COMPLETED', 'CANCELLED', 'HISTORY')
    and nullif(keys.key_value, '') is not null
  on conflict (order_key) do update set refreshed_at = excluded.refreshed_at;

  get diagnostics v_count = row_count;
  return v_count;
end
$$;

revoke all on function public.ecoflow_refresh_ui_active_order_keys() from public, anon, authenticated;
grant execute on function public.ecoflow_refresh_ui_active_order_keys() to service_role;

-- Data projection and active-key refresh are intentionally executed by the
-- post-deployment complete-mirror workflow in bounded RPC batches. Running them
-- inside the migration transaction exceeds production statement_timeout and can
-- invoke a superseded refresh function before later corrective migrations apply.

notify pgrst, 'reload schema';
commit;
