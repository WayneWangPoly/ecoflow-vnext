-- Prefer full invoice detail over summary payloads during projection.
-- One canonical raw payload per invoice prevents summary/detail oscillation.

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
    from (
      select ranked.*
      from (
        select
          source.*,
          row_number() over (
            partition by public.ecoflow_om_safe_uuid(coalesce(
              source.payload->>'id',
              source.payload->>'invoiceId',
              source.payload#>>'{invoice,id}'
            ))
            order by
              case when source.resource_type = 'invoice_detail' then 0 else 1 end,
              coalesce(source.remote_updated_at, source.last_synced_at) desc nulls last
          ) as payload_rank
        from public.ordermentum_raw_master_resources source
        where source.resource_type in ('invoices', 'invoice_detail')
      ) ranked
      where ranked.payload_rank = 1
    ) r
    where public.ecoflow_om_safe_uuid(coalesce(
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

select public.ecoflow_project_ordermentum_raw_invoices(10000);
notify pgrst, 'reload schema';
commit;
