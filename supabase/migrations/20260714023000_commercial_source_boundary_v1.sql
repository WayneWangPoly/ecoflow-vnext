-- Ordermentum is the sole source of commercial truth.
-- EcoFlow mirrors commercial facts and owns only internal workflow, warehouse,
-- delivery, communication preferences, documents, security and audit records.

begin;

create table if not exists public.ecoflow_ordermentum_source_presence (
  domain text not null check (domain in ('ORDER','STORE','PRODUCT','VARIANT','INVOICE','PRICE_GROUP','STOCK_LOCATION')),
  external_id text not null,
  source_status text not null default 'PRESENT' check (source_status in ('PRESENT','SOURCE_MISSING')),
  source_reference text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  missing_since timestamptz,
  last_full_mirror_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  primary key (domain, external_id)
);

create index if not exists idx_ecoflow_source_presence_status
  on public.ecoflow_ordermentum_source_presence(domain, source_status, last_seen_at desc);

alter table public.ecoflow_ordermentum_source_presence enable row level security;
revoke all on public.ecoflow_ordermentum_source_presence from anon, authenticated;
grant select on public.ecoflow_ordermentum_source_presence to authenticated;
grant all on public.ecoflow_ordermentum_source_presence to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='ecoflow_ordermentum_source_presence'
      and policyname='ecoflow_source_presence_authenticated_read'
  ) then
    create policy ecoflow_source_presence_authenticated_read
      on public.ecoflow_ordermentum_source_presence for select to authenticated
      using (true);
  end if;
end $$;

create or replace function public.ecoflow_reject_commercial_mirror_write()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true)::jsonb->>'role', ''),
    current_user
  );
begin
  if v_role in ('service_role','postgres','supabase_admin') or current_user in ('postgres','supabase_admin') then
    return case when tg_op='DELETE' then old else new end;
  end if;
  raise exception 'ORDERMENTUM_SOURCE_OWNED: % is a read-only commercial mirror; change the source in Ordermentum and sync again', tg_table_name
    using errcode='42501';
end;
$$;

create or replace function public.ecoflow_guard_store_source_fields()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true)::jsonb->>'role', ''),
    current_user
  );
  v_old jsonb;
  v_new jsonb;
  v_key text;
  v_source_keys text[] := array[
    'store_name','name','retailer_name','retailer_id','ordermentum_id','external_id',
    'formatted_address','address','suburb','state','postcode','postal_code',
    'contact_phone','phone','delivery_instructions','delivery_note','price_group_id','price_tier','payment_terms'
  ];
begin
  if v_role in ('service_role','postgres','supabase_admin') or current_user in ('postgres','supabase_admin') then
    return case when tg_op='DELETE' then old else new end;
  end if;

  if tg_op in ('INSERT','DELETE') then
    raise exception 'ORDERMENTUM_SOURCE_OWNED: customer stores are created or removed in Ordermentum'
      using errcode='42501';
  end if;

  v_old := to_jsonb(old);
  v_new := to_jsonb(new);
  foreach v_key in array v_source_keys loop
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      raise exception 'ORDERMENTUM_SOURCE_OWNED: store field % must be changed in Ordermentum', v_key
        using errcode='42501';
    end if;
  end loop;
  return new;
end;
$$;

-- Protect raw mirrors, canonical Ordermentum projections and retired local
-- commercial substitutes. Service-role sync and projection remain allowed.
do $$
declare
  v_table text;
  v_trigger text;
begin
  foreach v_table in array array[
    'ordermentum_raw_orders',
    'ordermentum_raw_master_resources',
    'ordermentum_raw_master_resource_versions',
    'om_orders',
    'om_order_items',
    'om_invoices',
    'om_products',
    'om_variants',
    'om_purchasers',
    'om_price_groups',
    'om_stock_locations',
    'ecoflow_price_matrix_versions',
    'ecoflow_customer_payment_receipts',
    'ecoflow_customer_payment_allocations'
  ] loop
    if to_regclass(format('public.%I', v_table)) is not null then
      v_trigger := 'trg_' || v_table || '_source_owned';
      execute format('drop trigger if exists %I on public.%I', v_trigger, v_table);
      execute format(
        'create trigger %I before insert or update or delete on public.%I for each row execute function public.ecoflow_reject_commercial_mirror_write()',
        v_trigger, v_table
      );
      execute format('revoke insert, update, delete on table public.%I from authenticated, anon', v_table);
    end if;
  end loop;

  if to_regclass('public.ecoflow_store_sites') is not null then
    drop trigger if exists trg_ecoflow_store_sites_source_fields on public.ecoflow_store_sites;
    create trigger trg_ecoflow_store_sites_source_fields
      before insert or update or delete on public.ecoflow_store_sites
      for each row execute function public.ecoflow_guard_store_source_fields();
  end if;
end $$;

-- Remove browser execution rights from legacy local substitutes. Existing rows
-- remain queryable for audit but no longer influence mirrored commercial truth.
do $$
declare
  v_signature text;
begin
  for v_signature in
    select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'ecoflow_set_price_matrix_price',
        'ecoflow_bulk_adjust_price_matrix',
        'ecoflow_record_customer_payment'
      )
  loop
    execute format('revoke execute on function %s from authenticated, anon', v_signature);
  end loop;
end $$;

create or replace view public.v_ecoflow_data_ownership_contract_v1 as
select * from (values
  ('CUSTOMERS_STORES','ORDERMENTUM','SOURCE_MIRROR','Ordermentum','Names, addresses, phones, delivery instructions, price groups and payment terms','Retain history and mark SOURCE_MISSING'),
  ('PRODUCTS_SKUS_PRICES','ORDERMENTUM','SOURCE_MIRROR','Ordermentum','Products, variants, SKUs, source barcodes and selling prices','Retain historical order lines and mark inactive/missing'),
  ('ORDERS_LINES','ORDERMENTUM','SOURCE_MIRROR','Ordermentum','Commercial order, quantities, requested delivery, amount and cancellation','Retain audit copy and remove release eligibility'),
  ('INVOICES_PAYMENTS','ORDERMENTUM','SOURCE_MIRROR','Ordermentum','Invoice, GST, freight, surcharge, payment status, method and amount due','Retain statement history and flag source gap'),
  ('WAREHOUSE_STOCK','ECOFLOW','OPERATIONAL_RECORD','EcoFlow','Receiving, physical stock, racks, local barcode verification, pick, pack and stage','Reverse by auditable stock movement'),
  ('DELIVERY_POD','ECOFLOW','OPERATIONAL_RECORD','EcoFlow','Run release, route, driver progress, POD, failed delivery and returns','Preserve completed run and POD history'),
  ('OFFICE_WORKFLOW','ECOFLOW','OPERATIONAL_RECORD','EcoFlow','Internal order, release hold, collection note, statement document and communication preference','Close or supersede with audit'),
  ('SECURITY_AUDIT','ECOFLOW','OPERATIONAL_RECORD','EcoFlow','Users, roles, approvals, integration jobs and activity logs','Deactivate access; retain events')
) as ownership(domain, authoritative_system, ownership_mode, write_location, examples, deletion_rule);

grant select on public.v_ecoflow_data_ownership_contract_v1 to authenticated;
revoke all on public.v_ecoflow_data_ownership_contract_v1 from anon;

-- Read-only selling-price mirror. A historical EcoFlow override can remain in
-- the old table for audit, but it is deliberately ignored here.
do $$
begin
  if to_regclass('public.v_ecoflow_price_matrix_workbench') is not null then
    execute $view$
      create or replace view public.v_ecoflow_ordermentum_price_matrix_readonly_v1 as
      select
        sku,
        product_name,
        price_group_id,
        price_group_name,
        coalesce(source_base_price, effective_price, 0)::numeric as effective_price,
        source_base_price,
        false as has_override,
        null::uuid as matrix_version_id,
        null::integer as version_no,
        null::date as effective_from,
        null::text as change_reason,
        null::uuid as created_by,
        null::timestamptz as created_at,
        sku_last_synced_at
      from public.v_ecoflow_price_matrix_workbench
    $view$;
    grant select on public.v_ecoflow_ordermentum_price_matrix_readonly_v1 to authenticated;
    revoke all on public.v_ecoflow_ordermentum_price_matrix_readonly_v1 from anon;
  end if;
end $$;

-- Curated source mirrors: no raw payload is exposed to the UI.
do $$
begin
  if to_regclass('public.ordermentum_raw_master_resources') is not null then
    execute $stores$
      create or replace view public.v_ecoflow_ordermentum_store_mirror_v1 as
      select distinct on (external_id)
        external_id as store_id,
        coalesce(nullif(payload->>'name',''), nullif(payload->>'businessName',''), nullif(payload#>>'{retailer,name}','')) as store_name,
        coalesce(nullif(payload->>'address',''), nullif(payload->>'formattedAddress',''), nullif(payload#>>'{deliveryAddress,formatted}','')) as address,
        coalesce(nullif(payload->>'suburb',''), nullif(payload#>>'{deliveryAddress,suburb}','')) as suburb,
        coalesce(nullif(payload->>'phone',''), nullif(payload->>'contactPhone','')) as contact_phone,
        coalesce(nullif(payload->>'deliveryInstructions',''), nullif(payload->>'deliveryNote','')) as delivery_instructions,
        coalesce(nullif(payload->>'priceGroupId',''), nullif(payload#>>'{priceGroup,id}','')) as price_group_id,
        coalesce(nullif(payload->>'paymentTerms',''), nullif(payload->>'paymentTerm','')) as payment_terms,
        remote_updated_at,
        last_synced_at
      from public.ordermentum_raw_master_resources
      where resource_type in ('purchasers','purchaser_detail')
        and coalesce(is_deleted_or_missing,false)=false
      order by external_id, case when resource_type='purchaser_detail' then 0 else 1 end, last_synced_at desc
    $stores$;

    execute $catalog$
      create or replace view public.v_ecoflow_ordermentum_catalog_mirror_v1 as
      select distinct on (resource_type, external_id)
        resource_type,
        external_id,
        coalesce(nullif(payload->>'sku',''), nullif(payload->>'SKU',''), nullif(payload->>'itemCode',''), nullif(payload->>'code','')) as sku,
        coalesce(nullif(payload->>'name',''), nullif(payload->>'productName',''), nullif(payload#>>'{product,name}','')) as product_name,
        coalesce(nullif(payload->>'status',''), nullif(payload->>'productStatus','')) as source_status,
        coalesce(nullif(payload->>'barcode',''), nullif(payload->>'gtin','')) as source_barcode,
        public.ecoflow_om_safe_numeric(coalesce(payload->>'basePrice', payload->>'price')) as source_price,
        remote_updated_at,
        last_synced_at
      from public.ordermentum_raw_master_resources
      where resource_type in ('products','product_detail','variants')
        and coalesce(is_deleted_or_missing,false)=false
      order by resource_type, external_id, last_synced_at desc
    $catalog$;

    grant select on public.v_ecoflow_ordermentum_store_mirror_v1, public.v_ecoflow_ordermentum_catalog_mirror_v1 to authenticated;
    revoke all on public.v_ecoflow_ordermentum_store_mirror_v1, public.v_ecoflow_ordermentum_catalog_mirror_v1 from anon;
  end if;
end $$;

-- Finance statements are rebuilt from mirrored Ordermentum invoice truth. Local
-- legacy receipts do not reduce AR and cannot mark an invoice paid.
do $$
begin
  if to_regclass('public.v_ecoflow_order_financial_truth_v1') is not null then
    execute $accounts$
      create or replace view public.v_ecoflow_accounts_live_statement_lines as
      select
        f.retailer_id::text as store_id,
        f.store_name::text as store_name,
        f.source_order_id::text as internal_order_id,
        f.order_number::text as order_number,
        f.invoice_number::text as invoice_number,
        coalesce(f.invoice_date, f.financial_observed_at)::timestamptz as order_ts,
        f.invoice_due_at::timestamptz as due_at,
        coalesce(f.invoice_total,0)::numeric as invoice_value,
        greatest(coalesce(f.invoice_total,0)-coalesce(
          case when lower(coalesce(f.invoice_payment_status,''))='paid' then 0 else f.amount_due end,
          case when lower(coalesce(f.invoice_payment_status,''))='paid' then 0 else f.invoice_total end,
          0
        ),0)::numeric as allocated_amount,
        coalesce(
          case when lower(coalesce(f.invoice_payment_status,''))='paid' then 0 else f.amount_due end,
          case when lower(coalesce(f.invoice_payment_status,''))='paid' then 0 else f.invoice_total end,
          0
        )::numeric as outstanding_amount,
        greatest(current_date-coalesce(f.invoice_date::date,current_date),0)::numeric as age_days,
        case
          when coalesce(case when lower(coalesce(f.invoice_payment_status,''))='paid' then 0 else f.amount_due end,0)<=0 then 0
          when f.invoice_due_at is not null and f.invoice_due_at::date<current_date then (current_date-f.invoice_due_at::date)::numeric
          else 0::numeric
        end as overdue_days,
        case
          when lower(coalesce(f.invoice_payment_status,''))='paid' or coalesce(f.amount_due,0)<=0 then 'PAID'
          when f.invoice_due_at is not null and f.invoice_due_at<now() then 'OVERDUE'
          else 'OPEN'
        end::text as statement_status,
        f.source_order_status::text as order_status,
        o.account_release_status::text as account_release_status,
        o.warehouse_gate_status::text as warehouse_gate_status,
        case
          when lower(coalesce(f.invoice_payment_status,''))='paid' or coalesce(f.amount_due,0)<=0 then 'PAID'
          when f.invoice_due_at is not null and f.invoice_due_at<now()-interval '30 days' then 'OVERDUE_30_PLUS'
          when f.invoice_due_at is not null and f.invoice_due_at<now() then 'OVERDUE'
          when f.invoice_due_at is not null and f.invoice_due_at<=now()+interval '7 days' then 'DUE_THIS_WEEK'
          else 'OPEN'
        end::text as accounts_signal
      from public.v_ecoflow_order_financial_truth_v1 f
      left join public.v_ecoflow_order_operations_v3 o
        on o.external_order_id=f.source_order_id
        or o.order_number=f.order_number
        or (f.invoice_number is not null and o.invoice_number=f.invoice_number)
      where f.invoice_number is not null
    $accounts$;
    grant select on public.v_ecoflow_accounts_live_statement_lines to authenticated;
  end if;
end $$;

-- V4 adds source-presence state without conflating it with fulfilment. Missing
-- source orders are historical unless physical fulfilment is already active.
do $$
begin
  if to_regclass('public.v_ecoflow_order_operations_v3') is not null then
    execute $operations$
      create or replace view public.v_ecoflow_order_operations_v4 as
      select
        o.operation_key,
        o.raw_order_id,
        o.external_order_id,
        o.external_order_number,
        o.external_invoice_number,
        o.order_number,
        o.invoice_number,
        o.retailer_id,
        o.store_name,
        o.source_order_status,
        o.source_invoice_status,
        o.source_payment_status,
        o.invoice_payment_status,
        o.internal_order_id,
        o.internalisation_status,
        o.account_release_status,
        o.warehouse_gate_status,
        case
          when p.source_status='SOURCE_MISSING'
            and o.fulfilment_status not in ('RELEASED','PICKING','STAGED','OUT_FOR_DELIVERY') then 'HISTORY'
          else o.fulfilment_status
        end as fulfilment_status,
        case when p.source_status='SOURCE_MISSING' then 'BLOCKED_DATA' else o.data_quality_status end as data_quality_status,
        case
          when p.source_status='SOURCE_MISSING'
            and o.fulfilment_status in ('RELEASED','PICKING','STAGED','OUT_FOR_DELIVERY') then 'CURRENT'
          when p.source_status='SOURCE_MISSING' then 'HISTORY'
          else o.operational_scope
        end as operational_scope,
        case when p.source_status='SOURCE_MISSING' then false else o.release_eligible end as release_eligible,
        case
          when p.source_status='SOURCE_MISSING'
            and o.fulfilment_status in ('RELEASED','PICKING','STAGED','OUT_FOR_DELIVERY')
            then 'Ordermentum source record is missing while EcoFlow fulfilment is active · investigate before continuing'
          when p.source_status='SOURCE_MISSING'
            then 'Ordermentum source record is missing · retained as read-only history'
          else o.classification_reason
        end as classification_reason,
        o.order_value,
        o.line_count,
        o.unmapped_line_count,
        o.barcode_blocked_line_count,
        o.source_created_at,
        o.source_updated_at,
        o.source_business_at,
        o.requested_delivery_at,
        o.observed_at,
        o.order_subtotal,
        o.order_gst,
        o.order_total,
        o.invoice_subtotal,
        o.invoice_gst,
        o.surcharge_type,
        o.surcharge_rate,
        o.surcharge_amount,
        o.invoice_total,
        o.amount_due,
        o.invoice_order_variance,
        o.payment_method,
        o.payment_terms,
        o.reconciliation_status,
        o.invoice_date,
        o.invoice_due_at,
        o.unleashed_sync_status,
        coalesce(p.source_status,'PRESENT') as source_presence_status,
        p.last_seen_at as source_last_seen_at,
        p.missing_since as source_missing_since
      from public.v_ecoflow_order_operations_v3 o
      left join public.ecoflow_ordermentum_source_presence p
        on p.domain='ORDER'
       and p.external_id=coalesce(nullif(o.external_order_id,''),nullif(o.raw_order_id,''),nullif(o.external_order_number,''),o.order_number)
    $operations$;

    execute $summary$
      create or replace view public.v_ecoflow_order_operations_summary_v4 as
      select
        count(*)::numeric as total_orders,
        count(*) filter (where operational_scope='CURRENT')::numeric as current_orders,
        count(*) filter (where operational_scope='REVIEW')::numeric as source_review_orders,
        count(*) filter (where release_eligible)::numeric as ready_to_release,
        count(*) filter (where operational_scope in ('CURRENT','REVIEW') and (data_quality_status<>'READY' or fulfilment_status='SOURCE_REVIEW'))::numeric as blocked_orders,
        count(*) filter (where operational_scope='CURRENT' and fulfilment_status in ('RELEASED','PICKING','STAGED','OUT_FOR_DELIVERY'))::numeric as in_progress_orders,
        count(*) filter (where fulfilment_status='COMPLETED')::numeric as completed_orders,
        count(*) filter (where fulfilment_status='CANCELLED')::numeric as cancelled_orders,
        count(*) filter (where reconciliation_status='SURCHARGE_MATCHED')::numeric as surcharge_invoices,
        count(*) filter (where reconciliation_status in ('REVIEW','MISSING_INVOICE'))::numeric as finance_review_orders,
        count(*) filter (where source_presence_status='SOURCE_MISSING')::numeric as source_missing_orders,
        coalesce(sum(order_value) filter (where operational_scope in ('CURRENT','REVIEW')),0)::numeric as current_value,
        max(source_updated_at) as latest_source_update,
        max(observed_at) as last_observed_at
      from public.v_ecoflow_order_operations_v4
    $summary$;

    grant select on public.v_ecoflow_order_operations_v4, public.v_ecoflow_order_operations_summary_v4 to authenticated;
    revoke all on public.v_ecoflow_order_operations_v4, public.v_ecoflow_order_operations_summary_v4 from anon;
  end if;
end $$;

create or replace function public.ecoflow_refresh_ui_active_order_keys()
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  v_count integer := 0;
  v_view text;
begin
  delete from public.ecoflow_ui_active_order_keys;
  v_view := case
    when to_regclass('public.v_ecoflow_order_operations_v4') is not null then 'public.v_ecoflow_order_operations_v4'
    when to_regclass('public.v_ecoflow_order_operations_v3') is not null then 'public.v_ecoflow_order_operations_v3'
    else null
  end;
  if v_view is null then return 0; end if;

  execute format($sql$
    insert into public.ecoflow_ui_active_order_keys(order_key,refreshed_at)
    select distinct key_value,now()
    from %s o
    cross join lateral (values(o.raw_order_id),(o.external_order_id),(o.external_order_number),(o.order_number),(o.invoice_number)) keys(key_value)
    where o.operational_scope in ('CURRENT','REVIEW')
      and o.fulfilment_status not in ('COMPLETED','CANCELLED','HISTORY')
      and nullif(keys.key_value,'') is not null
    on conflict(order_key) do update set refreshed_at=excluded.refreshed_at
  $sql$, v_view);
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

revoke all on function public.ecoflow_refresh_ui_active_order_keys() from public, anon, authenticated;
grant execute on function public.ecoflow_refresh_ui_active_order_keys() to service_role;

-- Extend mirror health with explicit source-disappearance controls.
do $$
begin
  if to_regclass('public.v_ecoflow_ordermentum_mirror_health_v1') is not null then
    execute $health$
      create or replace view public.v_ecoflow_ordermentum_mirror_health_v2 as
      with presence as (
        select
          count(*) filter (where source_status='SOURCE_MISSING')::numeric as source_missing_records,
          count(*) filter (where domain='ORDER' and source_status='SOURCE_MISSING')::numeric as source_missing_orders
        from public.ecoflow_ordermentum_source_presence
      ), active_missing as (
        select count(*)::numeric as active_source_missing_orders
        from public.v_ecoflow_order_operations_v4
        where source_presence_status='SOURCE_MISSING' and operational_scope='CURRENT'
      )
      select
        case when h.overall_status='COMPLETE' and a.active_source_missing_orders=0 then 'COMPLETE' else 'DEGRADED' end as overall_status,
        h.raw_order_count,
        h.projected_order_count,
        h.order_projection_missing,
        h.raw_invoice_count,
        h.projected_invoice_count,
        h.invoice_projection_missing,
        h.recent_orders_missing_lines,
        h.recent_orders_missing_invoice_detail,
        h.unknown_recent_statuses,
        h.recent_finance_reviews,
        h.purchaser_count,
        h.product_count,
        h.variant_count,
        h.price_group_count,
        h.stock_location_count,
        h.latest_raw_order_sync,
        h.latest_master_sync,
        p.source_missing_records,
        p.source_missing_orders,
        a.active_source_missing_orders,
        now() as checked_at
      from public.v_ecoflow_ordermentum_mirror_health_v1 h
      cross join presence p
      cross join active_missing a
    $health$;
    grant select on public.v_ecoflow_ordermentum_mirror_health_v2 to authenticated;
    revoke all on public.v_ecoflow_ordermentum_mirror_health_v2 from anon;
  end if;
end $$;

select public.ecoflow_refresh_ui_active_order_keys();
notify pgrst, 'reload schema';
commit;
