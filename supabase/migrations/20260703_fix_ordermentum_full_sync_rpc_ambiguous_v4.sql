-- EcoFlow / Ordermentum full sync RPC ambiguity fix v4
-- Replaces raw order/invoice upsert RPCs with PL/pgSQL-safe variable/column handling.
-- Data-safe: no tables are dropped and no existing raw rows are deleted.

begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Keep the compatibility wrapper used by previous migrations.
create or replace function public.digest(data text, type text)
returns bytea
language sql
immutable
parallel safe
as $$
  select extensions.digest(data, type);
$$;

grant execute on function public.digest(text, text) to anon, authenticated, service_role;

create or replace function public.ecoflow_upsert_ordermentum_raw_order_v2(
  p_run_id uuid,
  p_payload jsonb,
  p_import_source text default 'ORDERMENTUM_API'
)
returns table(
  raw_order_id uuid,
  external_order_id text,
  external_order_number text,
  external_invoice_number text,
  changed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_external_order_id text;
  v_external_order_number text;
  v_external_invoice_number text;
  v_external_created_at timestamptz;
  v_external_updated_at timestamptz;
  v_payload_hash text;
  v_previous_hash text;
  v_raw_order_id uuid;
  v_changed boolean;
begin
  v_external_order_id := coalesce(
    p_payload->>'id',
    p_payload->>'orderId',
    p_payload->>'order_id',
    p_payload->>'uuid'
  );

  v_external_order_number := coalesce(
    p_payload->>'orderNumber',
    p_payload->>'order_number',
    p_payload->>'number',
    p_payload->>'orderNo',
    p_payload#>>'{order,number}'
  );

  v_external_invoice_number := coalesce(
    p_payload->>'invoiceNumber',
    p_payload->>'invoice_number',
    p_payload->>'invoiceNo',
    p_payload#>>'{invoice,number}',
    p_payload#>>'{invoice,invoiceNumber}'
  );

  v_external_created_at := nullif(coalesce(
    p_payload->>'createdAt',
    p_payload->>'created_at',
    p_payload->>'orderedAt',
    p_payload->>'date'
  ), '')::timestamptz;

  v_external_updated_at := nullif(coalesce(
    p_payload->>'updatedAt',
    p_payload->>'updated_at',
    p_payload->>'modifiedAt',
    p_payload->>'lastUpdatedAt'
  ), '')::timestamptz;

  if v_external_order_id is null and v_external_order_number is null then
    raise exception 'Cannot upsert Ordermentum raw order without id or order number';
  end if;

  v_payload_hash := encode(public.digest(coalesce(p_payload::text, ''), 'sha256'), 'hex');

  select r.payload_hash, r.id
    into v_previous_hash, v_raw_order_id
  from public.ordermentum_raw_orders as r
  where (v_external_order_id is not null and r.external_order_id = v_external_order_id)
     or (v_external_order_id is null and r.external_order_number = v_external_order_number)
  order by r.created_at asc
  limit 1;

  v_changed := coalesce(v_previous_hash, '') <> v_payload_hash;

  if v_raw_order_id is not null then
    update public.ordermentum_raw_orders as r
    set external_order_number = coalesce(v_external_order_number, r.external_order_number),
        external_invoice_number = coalesce(v_external_invoice_number, r.external_invoice_number),
        external_created_at = coalesce(v_external_created_at, r.external_created_at),
        external_updated_at = coalesce(v_external_updated_at, r.external_updated_at),
        raw_payload = coalesce(p_payload, '{}'::jsonb),
        payload_hash = v_payload_hash,
        import_source = coalesce(p_import_source, 'ORDERMENTUM_API'),
        last_seen_at = now(),
        last_synced_at = now(),
        updated_at = now()
    where r.id = v_raw_order_id;
  else
    insert into public.ordermentum_raw_orders (
      external_order_id,
      external_order_number,
      external_invoice_number,
      external_created_at,
      external_updated_at,
      raw_payload,
      payload_hash,
      import_source,
      first_seen_at,
      last_seen_at,
      last_synced_at,
      created_at,
      updated_at
    ) values (
      v_external_order_id,
      v_external_order_number,
      v_external_invoice_number,
      v_external_created_at,
      v_external_updated_at,
      coalesce(p_payload, '{}'::jsonb),
      v_payload_hash,
      coalesce(p_import_source, 'ORDERMENTUM_API'),
      now(),
      now(),
      now(),
      now(),
      now()
    )
    returning id into v_raw_order_id;
  end if;

  perform public.ecoflow_archive_ordermentum_api_payload(
    p_run_id,
    'ORDER',
    v_external_order_id,
    v_external_order_number,
    p_payload
  );

  return query select
    v_raw_order_id as raw_order_id,
    v_external_order_id as external_order_id,
    v_external_order_number as external_order_number,
    v_external_invoice_number as external_invoice_number,
    v_changed as changed;
end;
$$;

create or replace function public.ecoflow_upsert_ordermentum_raw_invoice_v2(
  p_run_id uuid,
  p_payload jsonb,
  p_external_order_id text default null,
  p_external_order_number text default null,
  p_import_source text default 'ORDERMENTUM_API'
)
returns table(
  raw_invoice_id uuid,
  external_invoice_number text,
  external_order_id text,
  external_order_number text,
  changed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_external_invoice_number text;
  v_external_order_id text;
  v_external_order_number text;
  v_total numeric(12,4);
  v_total_due numeric(12,4);
  v_payload_hash text;
  v_previous_hash text;
  v_raw_invoice_id uuid;
  v_changed boolean;
begin
  v_external_invoice_number := coalesce(
    p_payload->>'invoiceNumber',
    p_payload->>'invoice_number',
    p_payload->>'number',
    p_payload->>'invoiceNo',
    p_payload#>>'{invoice,number}'
  );

  v_external_order_id := coalesce(
    p_external_order_id,
    p_payload->>'orderId',
    p_payload->>'order_id',
    p_payload#>>'{order,id}'
  );

  v_external_order_number := coalesce(
    p_external_order_number,
    p_payload->>'orderNumber',
    p_payload->>'order_number',
    p_payload#>>'{order,number}'
  );

  if v_external_invoice_number is null then
    raise exception 'Cannot upsert Ordermentum raw invoice without invoice number';
  end if;

  v_total := nullif(coalesce(
    p_payload->>'total',
    p_payload->>'invoiceTotal',
    p_payload#>>'{invoice,total}'
  ), '')::numeric(12,4);

  v_total_due := nullif(coalesce(
    p_payload->>'totalDue',
    p_payload->>'total_due',
    p_payload#>>'{invoice,totalDue}'
  ), '')::numeric(12,4);

  v_payload_hash := encode(public.digest(coalesce(p_payload::text, ''), 'sha256'), 'hex');

  select ri.payload_hash, ri.id
    into v_previous_hash, v_raw_invoice_id
  from public.ordermentum_raw_invoices as ri
  where ri.external_invoice_number = v_external_invoice_number
  order by ri.created_at asc
  limit 1;

  v_changed := coalesce(v_previous_hash, '') <> v_payload_hash;

  if v_raw_invoice_id is not null then
    update public.ordermentum_raw_invoices as ri
    set external_order_id = coalesce(v_external_order_id, ri.external_order_id),
        external_order_number = coalesce(v_external_order_number, ri.external_order_number),
        total = coalesce(v_total, ri.total),
        total_due = coalesce(v_total_due, ri.total_due),
        raw_payload = coalesce(p_payload, '{}'::jsonb),
        payload_hash = v_payload_hash,
        import_source = coalesce(p_import_source, 'ORDERMENTUM_API'),
        last_synced_at = now(),
        updated_at = now()
    where ri.id = v_raw_invoice_id;
  else
    insert into public.ordermentum_raw_invoices (
      external_invoice_number,
      external_order_id,
      external_order_number,
      total,
      total_due,
      raw_payload,
      payload_hash,
      import_source,
      last_synced_at,
      created_at,
      updated_at
    ) values (
      v_external_invoice_number,
      v_external_order_id,
      v_external_order_number,
      v_total,
      v_total_due,
      coalesce(p_payload, '{}'::jsonb),
      v_payload_hash,
      coalesce(p_import_source, 'ORDERMENTUM_API'),
      now(),
      now(),
      now()
    )
    returning id into v_raw_invoice_id;
  end if;

  perform public.ecoflow_archive_ordermentum_api_payload(
    p_run_id,
    'INVOICE',
    v_external_invoice_number,
    v_external_invoice_number,
    p_payload
  );

  return query select
    v_raw_invoice_id as raw_invoice_id,
    v_external_invoice_number as external_invoice_number,
    v_external_order_id as external_order_id,
    v_external_order_number as external_order_number,
    v_changed as changed;
end;
$$;

grant execute on function public.ecoflow_upsert_ordermentum_raw_order_v2(uuid, jsonb, text) to anon, authenticated, service_role;
grant execute on function public.ecoflow_upsert_ordermentum_raw_invoice_v2(uuid, jsonb, text, text, text) to anon, authenticated, service_role;

commit;
