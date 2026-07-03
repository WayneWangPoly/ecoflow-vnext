begin;

-- Ensure a stable named constraint for raw_order_id upsert conflict handling.
do $$
begin
  if to_regclass('public.ecoflow_ordermentum_internal_orders') is null then
    raise exception 'Table public.ecoflow_ordermentum_internal_orders does not exist. Run the internalisation barcode gate migration first.';
  end if;

  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'ecoflow_ordermentum_internal_orders'
      and c.conname = 'ecoflow_ordermentum_internal_orders_raw_order_id_key'
  ) then
    alter table public.ecoflow_ordermentum_internal_orders
      add constraint ecoflow_ordermentum_internal_orders_raw_order_id_key unique (raw_order_id);
  end if;
end $$;

-- Replace only the internalisation RPC. This fixes PL/pgSQL ambiguity between
-- RETURNS TABLE column raw_order_id and the table column raw_order_id.
drop function if exists public.ecoflow_internalise_ordermentum_orders(integer, boolean, boolean);

create or replace function public.ecoflow_internalise_ordermentum_orders(
  p_limit integer default 25,
  p_dry_run boolean default true,
  p_include_payment_review boolean default true
)
returns table (
  raw_order_id uuid,
  order_number text,
  invoice_number text,
  action text,
  internal_order_id uuid,
  account_release_status text,
  warehouse_gate_status text,
  line_count bigint
)
language plpgsql
security definer
as $$
begin
  if coalesce(p_limit, 0) <= 0 then
    raise exception 'p_limit must be greater than 0';
  end if;

  if p_dry_run then
    return query
    select
      draft.raw_order_id,
      draft.order_number::text,
      draft.invoice_number::text,
      'DRY_RUN_ELIGIBLE'::text as action,
      null::uuid as internal_order_id,
      draft.account_release_status::text,
      draft.warehouse_gate_status::text,
      draft.line_count::bigint
    from public.v_ecoflow_ordermentum_internal_order_drafts_v3 draft
    where draft.creation_status = 'READY_TO_CREATE'
      and draft.internalisation_status = 'READY_TO_INTERNALISE'
      and (p_include_payment_review = true or draft.account_release_status <> 'HOLD_PAYMENT_REVIEW')
    order by draft.updated_business_day, draft.order_number
    limit p_limit;

    return;
  end if;

  return query
  with candidates as (
    select
      draft.raw_order_id,
      draft.external_order_id,
      draft.external_order_number,
      draft.order_number,
      draft.invoice_number,
      draft.payment_status,
      draft.invoice_payment_status,
      draft.invoice_total,
      draft.total_due,
      draft.line_count,
      draft.account_release_status,
      draft.warehouse_gate_status,
      draft.last_synced_at,
      draft.updated_business_day
    from public.v_ecoflow_ordermentum_internal_order_drafts_v3 draft
    where draft.creation_status = 'READY_TO_CREATE'
      and draft.internalisation_status = 'READY_TO_INTERNALISE'
      and (p_include_payment_review = true or draft.account_release_status <> 'HOLD_PAYMENT_REVIEW')
    order by draft.updated_business_day, draft.order_number
    limit p_limit
  ),
  upsert_orders as (
    insert into public.ecoflow_ordermentum_internal_orders (
      source_provider,
      raw_order_id,
      external_order_id,
      external_order_number,
      invoice_number,
      order_number,
      payment_status,
      invoice_payment_status,
      invoice_total,
      total_due,
      line_count,
      status,
      account_release_status,
      warehouse_gate_status,
      imported_at,
      last_synced_at
    )
    select
      'ORDERMENTUM'::text,
      c.raw_order_id,
      c.external_order_id,
      c.external_order_number,
      c.invoice_number,
      c.order_number,
      c.payment_status,
      c.invoice_payment_status,
      c.invoice_total,
      c.total_due,
      c.line_count,
      'IMPORTED'::text,
      c.account_release_status,
      c.warehouse_gate_status,
      now(),
      c.last_synced_at
    from candidates c
    on conflict on constraint ecoflow_ordermentum_internal_orders_raw_order_id_key do update set
      external_order_id = excluded.external_order_id,
      external_order_number = excluded.external_order_number,
      invoice_number = excluded.invoice_number,
      order_number = excluded.order_number,
      payment_status = excluded.payment_status,
      invoice_payment_status = excluded.invoice_payment_status,
      invoice_total = excluded.invoice_total,
      total_due = excluded.total_due,
      line_count = excluded.line_count,
      account_release_status = excluded.account_release_status,
      warehouse_gate_status = excluded.warehouse_gate_status,
      last_synced_at = excluded.last_synced_at,
      updated_at = now()
    returning
      public.ecoflow_ordermentum_internal_orders.id,
      public.ecoflow_ordermentum_internal_orders.raw_order_id,
      public.ecoflow_ordermentum_internal_orders.order_number,
      public.ecoflow_ordermentum_internal_orders.invoice_number,
      public.ecoflow_ordermentum_internal_orders.account_release_status,
      public.ecoflow_ordermentum_internal_orders.warehouse_gate_status,
      public.ecoflow_ordermentum_internal_orders.line_count
  ),
  delete_existing_lines as (
    delete from public.ecoflow_ordermentum_internal_order_lines ol
    using upsert_orders u
    where ol.internal_order_id = u.id
    returning ol.id
  ),
  line_source as (
    select
      u.id as internal_order_id,
      row_number() over (
        partition by u.id
        order by l.external_sku_code, l.external_product_name, l.source_line_id nulls last
      )::integer as line_index,
      l.external_sku_code,
      l.external_product_name,
      m.internal_sku_id as internal_sku_id,
      l.quantity,
      l.unit,
      l.uom,
      l.price,
      l.rate_price,
      l.subtotal,
      l.gst,
      l.tax,
      l.total,
      coalesce(bc.status, 'NEEDS_BARCODE') as barcode_status,
      bc.warehouse_barcode,
      case when coalesce(bc.status, 'NEEDS_BARCODE') = 'SERVICE_ITEM' then 'SERVICE' else 'STOCK' end as line_type
    from upsert_orders u
    join public.v_ecoflow_ordermentum_order_lines l
      on l.invoice_number = u.invoice_number
    left join public.external_product_mappings m
      on m.provider = 'ORDERMENTUM'
     and m.external_product_code = l.external_sku_code
    left join public.ecoflow_sku_barcode_confirmations bc
      on bc.provider = 'ORDERMENTUM'
     and bc.external_sku_code = l.external_sku_code
  ),
  insert_lines as (
    insert into public.ecoflow_ordermentum_internal_order_lines (
      internal_order_id,
      line_index,
      external_sku_code,
      external_product_name,
      internal_sku_id,
      quantity,
      unit,
      uom,
      price,
      rate_price,
      subtotal,
      gst,
      tax,
      total,
      barcode_status,
      warehouse_barcode,
      line_type
    )
    select
      ls.internal_order_id,
      ls.line_index,
      ls.external_sku_code,
      ls.external_product_name,
      ls.internal_sku_id,
      ls.quantity,
      ls.unit,
      ls.uom,
      ls.price,
      ls.rate_price,
      ls.subtotal,
      ls.gst,
      ls.tax,
      ls.total,
      ls.barcode_status,
      ls.warehouse_barcode,
      ls.line_type
    from line_source ls
    returning public.ecoflow_ordermentum_internal_order_lines.internal_order_id
  )
  select
    u.raw_order_id,
    u.order_number::text,
    u.invoice_number::text,
    'CREATED_OR_UPDATED'::text as action,
    u.id as internal_order_id,
    u.account_release_status::text,
    u.warehouse_gate_status::text,
    u.line_count::bigint
  from upsert_orders u
  order by u.order_number;
end;
$$;

grant execute on function public.ecoflow_internalise_ordermentum_orders(integer, boolean, boolean) to service_role;

commit;
