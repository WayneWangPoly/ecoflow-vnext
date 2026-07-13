-- 150 legacy raw orders (2025 history) have no lineItems key at all, and
-- jsonb_typeof on a missing key returns NULL, which poisoned the staleness
-- predicate so those orders were re-projected on every run and never
-- converged. Rebuild the gate as a null-safe "payload carries projectable
-- line items" check.

begin;

create or replace function public.ecoflow_project_ordermentum_raw_orders(p_limit integer default 1000)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_rec record;
  v_payload jsonb;
  v_order_id uuid;
  v_supplier_id uuid;
  v_invoice jsonb;
  v_invoice_id uuid;
  v_invoice_supplier_id uuid;
  v_line_ids uuid[];
  v_line_delta integer;
  v_orders_projected integer := 0;
  v_invoices_projected integer := 0;
  v_lines_projected integer := 0;
  v_orders_failed integer := 0;
  v_failures jsonb := '[]'::jsonb;
begin
  for v_rec in
    select
      r.id as raw_id,
      r.raw_payload,
      r.external_order_number,
      r.external_updated_at,
      r.last_synced_at,
      r.created_at
    from public.ordermentum_raw_orders r
    where public.ecoflow_om_safe_uuid(r.raw_payload->>'id') is not null
      and not exists (
        select 1
        from public.om_orders o
        where o.id = public.ecoflow_om_safe_uuid(r.raw_payload->>'id')
          and coalesce(o.updated_at, '-infinity'::timestamptz) >= coalesce(
            public.ecoflow_om_safe_ts(r.raw_payload->>'updatedAt'),
            r.external_updated_at,
            '-infinity'::timestamptz
          )
          and (
            -- Either the payload carries no projectable line items (missing
            -- key, empty array, or items without usable ids), or the items
            -- have already landed. jsonb_typeof of a missing key is NULL, so
            -- everything here must stay null-safe.
            not exists (
              select 1
              from jsonb_array_elements(
                case when jsonb_typeof(r.raw_payload->'lineItems') = 'array'
                  then r.raw_payload->'lineItems'
                  else '[]'::jsonb
                end
              ) li
              where public.ecoflow_om_safe_uuid(li->>'id') is not null
            )
            or exists (select 1 from public.om_order_items it where it.order_id = o.id)
          )
      )
    order by coalesce(r.external_updated_at, r.last_synced_at, r.created_at) asc
    limit greatest(coalesce(p_limit, 1000), 1)
  loop
    begin
      v_payload := v_rec.raw_payload;
      v_order_id := public.ecoflow_om_safe_uuid(v_payload->>'id');
      v_supplier_id := public.ecoflow_om_safe_uuid(v_payload->>'supplierId');
      if v_supplier_id is null then
        raise exception 'payload has no supplierId';
      end if;

      -- Project the embedded invoice first so om_orders.invoice_id never dangles.
      v_invoice := case when jsonb_typeof(v_payload->'invoice') = 'object' then v_payload->'invoice' else null end;
      v_invoice_id := public.ecoflow_om_safe_uuid(coalesce(v_invoice->>'id', v_payload->>'invoiceId'));
      v_invoice_supplier_id := coalesce(public.ecoflow_om_safe_uuid(v_invoice->>'supplierId'), v_supplier_id);

      if v_invoice is not null and v_invoice_id is not null and v_invoice_supplier_id is not null then
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
          v_invoice_supplier_id,
          public.ecoflow_om_safe_uuid(coalesce(v_invoice->>'purchaserId', v_payload->>'purchaserId')),
          public.ecoflow_om_safe_uuid(coalesce(v_invoice->>'retailerId', v_payload->>'retailerId')),
          nullif(v_invoice->>'number', ''),
          nullif(v_invoice->>'status', ''),
          nullif(v_invoice->>'invoiceStatus', ''),
          nullif(v_invoice->>'paymentStatus', ''),
          case when jsonb_typeof(v_invoice->'paymentMethod') = 'string' then nullif(v_invoice->>'paymentMethod', '') end,
          nullif(v_invoice->>'paymentTransactionId', ''),
          nullif(v_invoice->>'settlementReference', ''),
          nullif(v_invoice->>'reference', ''),
          public.ecoflow_om_safe_numeric(v_invoice->>'subtotal'),
          public.ecoflow_om_safe_numeric(v_invoice->>'surcharge'),
          public.ecoflow_om_safe_numeric(v_invoice->>'credit'),
          public.ecoflow_om_safe_numeric(v_invoice->>'total'),
          public.ecoflow_om_safe_numeric(v_invoice->>'totalCharge'),
          public.ecoflow_om_safe_numeric(v_invoice->>'totalDiscount'),
          public.ecoflow_om_safe_numeric(v_invoice->>'totalDue'),
          public.ecoflow_om_safe_numeric(v_invoice->>'totalFreight'),
          public.ecoflow_om_safe_numeric(v_invoice->>'totalGST'),
          public.ecoflow_om_safe_ts(v_invoice->>'date'),
          public.ecoflow_om_safe_ts(v_invoice->>'dueAt'),
          public.ecoflow_om_safe_ts(v_invoice->>'chargeAt'),
          public.ecoflow_om_safe_ts(v_invoice->>'paidAt'),
          public.ecoflow_om_safe_ts(v_invoice->>'paidSupplierAt'),
          v_invoice,
          coalesce(public.ecoflow_om_safe_ts(v_invoice->>'createdAt'), now()),
          coalesce(public.ecoflow_om_safe_ts(v_invoice->>'updatedAt'), now())
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
        v_invoices_projected := v_invoices_projected + 1;
      elsif v_invoice_id is not null
        and not exists (select 1 from public.om_invoices i where i.id = v_invoice_id) then
        v_invoice_id := null;
      end if;

      insert into public.om_orders (
        id, supplier_id, purchaser_id, retailer_id, invoice_id,
        order_number, invoice_number, status, order_status, payment_status,
        retailer_name, delivery_date, due_at,
        cancelled_at, cancelled, placed_by_retailer, customer_reference,
        subtotal, total_gst, total_freight, surcharge, total_discount,
        total, total_due, total_quantity, line_count,
        raw_json, created_at, updated_at
      ) values (
        v_order_id,
        v_supplier_id,
        public.ecoflow_om_safe_uuid(v_payload->>'purchaserId'),
        public.ecoflow_om_safe_uuid(v_payload->>'retailerId'),
        v_invoice_id,
        coalesce(nullif(v_payload->>'orderNumber', ''), nullif(v_payload->>'number', ''), v_rec.external_order_number),
        nullif(v_payload->>'invoiceNumber', ''),
        nullif(v_payload->>'status', ''),
        nullif(v_payload->>'orderStatus', ''),
        nullif(v_payload->>'paymentStatus', ''),
        coalesce(nullif(v_payload->>'retailerName', ''), nullif(v_payload->'purchaser'->>'name', '')),
        public.ecoflow_om_safe_ts(v_payload->>'deliveryDate'),
        public.ecoflow_om_safe_ts(v_payload->>'dueAt'),
        public.ecoflow_om_safe_ts(v_payload->>'cancelledAt'),
        coalesce(
          public.ecoflow_om_safe_bool(v_payload->>'cancelled'),
          public.ecoflow_om_safe_ts(v_payload->>'cancelledAt') is not null
        ),
        coalesce(public.ecoflow_om_safe_bool(v_payload->>'placedByRetailer'), false),
        nullif(v_payload->>'customerReference', ''),
        public.ecoflow_om_safe_numeric(v_payload->>'subtotal'),
        public.ecoflow_om_safe_numeric(v_payload->>'totalGST'),
        public.ecoflow_om_safe_numeric(v_payload->>'totalFreight'),
        public.ecoflow_om_safe_numeric(v_payload->>'surcharge'),
        public.ecoflow_om_safe_numeric(v_payload->>'totalDiscount'),
        public.ecoflow_om_safe_numeric(v_payload->>'total'),
        public.ecoflow_om_safe_numeric(v_payload->>'totalDue'),
        public.ecoflow_om_safe_numeric(v_payload->>'totalQuantity'),
        coalesce(
          public.ecoflow_om_safe_numeric(v_payload->>'lineCount')::integer,
          case when jsonb_typeof(v_payload->'lineItems') = 'array' then jsonb_array_length(v_payload->'lineItems') end
        ),
        v_payload - 'lineItems',
        coalesce(public.ecoflow_om_safe_ts(v_payload->>'createdAt'), now()),
        coalesce(public.ecoflow_om_safe_ts(v_payload->>'updatedAt'), now())
      )
      on conflict (id) do update set
        supplier_id = excluded.supplier_id,
        purchaser_id = excluded.purchaser_id,
        retailer_id = excluded.retailer_id,
        invoice_id = coalesce(excluded.invoice_id, om_orders.invoice_id),
        order_number = excluded.order_number,
        invoice_number = coalesce(excluded.invoice_number, om_orders.invoice_number),
        status = excluded.status,
        order_status = excluded.order_status,
        payment_status = excluded.payment_status,
        retailer_name = coalesce(excluded.retailer_name, om_orders.retailer_name),
        delivery_date = excluded.delivery_date,
        due_at = excluded.due_at,
        cancelled_at = excluded.cancelled_at,
        cancelled = excluded.cancelled,
        placed_by_retailer = excluded.placed_by_retailer,
        customer_reference = excluded.customer_reference,
        subtotal = excluded.subtotal,
        total_gst = excluded.total_gst,
        total_freight = excluded.total_freight,
        surcharge = excluded.surcharge,
        total_discount = excluded.total_discount,
        total = excluded.total,
        total_due = excluded.total_due,
        total_quantity = excluded.total_quantity,
        line_count = excluded.line_count,
        raw_json = excluded.raw_json,
        created_at = coalesce(om_orders.created_at, excluded.created_at),
        updated_at = excluded.updated_at;
      v_orders_projected := v_orders_projected + 1;

      if jsonb_typeof(v_payload->'lineItems') = 'array' then
        select coalesce(array_agg(public.ecoflow_om_safe_uuid(li->>'id')), '{}')
        into v_line_ids
        from jsonb_array_elements(v_payload->'lineItems') li
        where public.ecoflow_om_safe_uuid(li->>'id') is not null;

        delete from public.om_order_items it
        where it.order_id = v_order_id
          and not (it.id = any (v_line_ids));

        insert into public.om_order_items (
          id, order_id, product_id, variant_id,
          sku, name, quantity, price, rate_price,
          subtotal, gst, tax, total,
          unit, uom, packing_unit, batch_code, description, image_url,
          raw_json, created_at, updated_at
        )
        select
          public.ecoflow_om_safe_uuid(li->>'id'),
          v_order_id,
          public.ecoflow_om_safe_uuid(li->>'productId'),
          public.ecoflow_om_safe_uuid(li->>'variantId'),
          nullif(li->>'SKU', ''),
          coalesce(nullif(li->>'name', ''), 'Unknown item'),
          public.ecoflow_om_safe_numeric(li->>'quantity'),
          public.ecoflow_om_safe_numeric(li->>'price'),
          public.ecoflow_om_safe_numeric(li->>'ratePrice'),
          public.ecoflow_om_safe_numeric(li->>'subtotal'),
          public.ecoflow_om_safe_numeric(li->>'gst'),
          public.ecoflow_om_safe_numeric(li->>'tax'),
          public.ecoflow_om_safe_numeric(li->>'total'),
          nullif(li->>'unit', ''),
          nullif(li->>'uom', ''),
          public.ecoflow_om_safe_numeric(li->>'packingUnit')::integer,
          nullif(li->>'batchCode', ''),
          nullif(li->>'description', ''),
          coalesce(
            li->'image'->'data'->>'secure_url',
            li->'image'->>'secure_url',
            li->'product'->'image'->>'secure_url'
          ),
          li,
          coalesce(public.ecoflow_om_safe_ts(li->>'createdAt'), now()),
          coalesce(public.ecoflow_om_safe_ts(li->>'updatedAt'), now())
        from jsonb_array_elements(v_payload->'lineItems') li
        where public.ecoflow_om_safe_uuid(li->>'id') is not null
        on conflict (id) do update set
          order_id = excluded.order_id,
          product_id = excluded.product_id,
          variant_id = excluded.variant_id,
          sku = excluded.sku,
          name = excluded.name,
          quantity = excluded.quantity,
          price = excluded.price,
          rate_price = excluded.rate_price,
          subtotal = excluded.subtotal,
          gst = excluded.gst,
          tax = excluded.tax,
          total = excluded.total,
          unit = excluded.unit,
          uom = excluded.uom,
          packing_unit = excluded.packing_unit,
          batch_code = excluded.batch_code,
          description = excluded.description,
          image_url = excluded.image_url,
          raw_json = excluded.raw_json,
          updated_at = excluded.updated_at;
        get diagnostics v_line_delta = row_count;
        v_lines_projected := v_lines_projected + coalesce(v_line_delta, 0);
      end if;
    exception when others then
      v_orders_failed := v_orders_failed + 1;
      if jsonb_array_length(v_failures) < 20 then
        v_failures := v_failures || jsonb_build_object(
          'order_number', v_rec.external_order_number,
          'error', sqlerrm
        );
      end if;
    end;
  end loop;

  return jsonb_build_object(
    'projected_orders', v_orders_projected,
    'projected_invoices', v_invoices_projected,
    'projected_lines', v_lines_projected,
    'failed_orders', v_orders_failed,
    'failures', v_failures
  );
end
$fn$;

revoke all on function public.ecoflow_project_ordermentum_raw_orders(integer) from public, anon, authenticated;
grant execute on function public.ecoflow_project_ordermentum_raw_orders(integer) to service_role;

-- Settle any remainder; with the null-safe gate this now converges to zero.
select public.ecoflow_project_ordermentum_raw_orders(10000);

notify pgrst, 'reload schema';
commit;
