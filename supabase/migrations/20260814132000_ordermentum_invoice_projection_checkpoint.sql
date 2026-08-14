-- Make raw-invoice projection incremental-first.
-- Candidate discovery must remain metadata-only; JSON payloads are loaded only
-- after the bounded pending batch is selected. The 475 MiB Complete Mirror
-- storage guard remains unchanged and is enforced by the application workflow.

begin;

alter table public.ordermentum_raw_master_resources
  add column if not exists invoice_projected_payload_hash text;

alter table public.ordermentum_raw_master_resources
  add column if not exists invoice_projected_at timestamptz;

comment on column public.ordermentum_raw_master_resources.invoice_projected_payload_hash is
  'Payload hash last successfully projected into om_invoices for this canonical raw invoice row.';
comment on column public.ordermentum_raw_master_resources.invoice_projected_at is
  'Timestamp when this raw invoice payload hash was successfully projected into om_invoices.';

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
  v_checkpointed integer;
  v_projected integer := 0;
  v_failed integer := 0;
  v_failures jsonb := '[]'::jsonb;
begin
  for v_rec in
    with canonical as materialized (
      -- Deliberately exclude payload here. DISTINCT/ORDER BY therefore operates
      -- only on compact metadata and cannot detoast every invoice JSON document.
      select distinct on (source.external_id)
        source.resource_type,
        source.external_id,
        source.payload_hash,
        source.invoice_projected_payload_hash,
        source.remote_updated_at,
        source.last_synced_at
      from public.ordermentum_raw_master_resources source
      where source.resource_type in ('invoices', 'invoice_detail')
        and public.ecoflow_om_safe_uuid(source.external_id) is not null
      order by
        source.external_id,
        case when source.resource_type = 'invoice_detail' then 0 else 1 end,
        coalesce(source.remote_updated_at, source.last_synced_at) desc nulls last
    ),
    pending as materialized (
      select
        canonical.resource_type,
        canonical.external_id,
        canonical.payload_hash,
        canonical.remote_updated_at,
        canonical.last_synced_at
      from canonical
      where canonical.invoice_projected_payload_hash is distinct from canonical.payload_hash
      order by
        coalesce(canonical.remote_updated_at, canonical.last_synced_at) asc nulls first,
        canonical.external_id
      limit greatest(coalesce(p_limit, 1000), 1)
    )
    select
      pending.resource_type,
      pending.external_id,
      pending.payload_hash,
      pending.remote_updated_at,
      pending.last_synced_at,
      source.payload
    from pending
    join public.ordermentum_raw_master_resources source
      on source.resource_type = pending.resource_type
     and source.external_id = pending.external_id
     and source.payload_hash = pending.payload_hash
    order by
      coalesce(pending.remote_updated_at, pending.last_synced_at) asc nulls first,
      pending.external_id
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

      -- external_id is the metadata identity used to choose the canonical row.
      -- Refuse to checkpoint a payload if its embedded invoice identity disagrees.
      if v_invoice_id <> public.ecoflow_om_safe_uuid(v_rec.external_id) then
        raise exception 'invoice payload id % does not match raw external_id %', v_invoice_id, v_rec.external_id;
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

      update public.ordermentum_raw_master_resources
      set
        invoice_projected_payload_hash = v_rec.payload_hash,
        invoice_projected_at = now()
      where resource_type = v_rec.resource_type
        and external_id = v_rec.external_id
        and payload_hash = v_rec.payload_hash;
      get diagnostics v_checkpointed = row_count;
      if v_checkpointed <> 1 then
        raise exception 'invoice projection checkpoint lost canonical raw row for %/%', v_rec.resource_type, v_rec.external_id;
      end if;

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

-- Production storage inventory for Complete Mirror evidence. This is read-only,
-- service-role-only, and uses catalog estimates rather than COUNT(*) scans.
create or replace function public.ecoflow_ordermentum_storage_inventory()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  with targets(relname) as (
    values
      ('ordermentum_raw_master_resources'::text),
      ('ordermentum_raw_master_resource_versions'::text),
      ('ordermentum_raw_orders'::text),
      ('om_invoices'::text),
      ('om_orders'::text),
      ('om_order_items'::text),
      ('ecoflow_ordermentum_order_catalog'::text),
      ('ordermentum_master_sync_runs'::text),
      ('ordermentum_sync_runs'::text)
  ),
  relations as (
    select
      c.oid,
      c.relname,
      greatest(coalesce(c.reltuples, 0), 0)::bigint as estimated_rows,
      pg_catalog.pg_relation_size(c.oid)::bigint as table_bytes,
      pg_catalog.pg_indexes_size(c.oid)::bigint as index_bytes,
      pg_catalog.pg_total_relation_size(c.oid)::bigint as total_bytes
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join targets t on t.relname = c.relname
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
  ),
  indexes as (
    select
      tbl.relname as table_name,
      idx.relname as index_name,
      pg_catalog.pg_relation_size(idx.oid)::bigint as index_bytes
    from pg_catalog.pg_index x
    join pg_catalog.pg_class tbl on tbl.oid = x.indrelid
    join pg_catalog.pg_class idx on idx.oid = x.indexrelid
    join relations r on r.oid = tbl.oid
  )
  select jsonb_build_object(
    'database_bytes', pg_catalog.pg_database_size(current_database())::bigint,
    'relations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'relation', relname,
        'estimated_rows', estimated_rows,
        'table_bytes', table_bytes,
        'index_bytes', index_bytes,
        'total_bytes', total_bytes
      ) order by total_bytes desc)
      from relations
    ), '[]'::jsonb),
    'indexes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'table', table_name,
        'index', index_name,
        'index_bytes', index_bytes
      ) order by index_bytes desc)
      from indexes
    ), '[]'::jsonb)
  );
$fn$;

revoke all on function public.ecoflow_ordermentum_storage_inventory() from public, anon, authenticated;
grant execute on function public.ecoflow_ordermentum_storage_inventory() to service_role;

-- Do not bulk-project inside the migration. Complete Mirror owns bounded runtime
-- projection and performs the production verification after deployment.
notify pgrst, 'reload schema';
commit;
