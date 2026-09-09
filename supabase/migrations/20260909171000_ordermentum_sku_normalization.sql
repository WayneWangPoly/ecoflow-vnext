-- #341: make release and internalisation identity use the same bounded
-- Ordermentum SKU normalization as Commercial promotion. Raw evidence remains
-- unchanged; every normalized collision fails closed.

begin;

create or replace function public.ecoflow_canonical_ordermentum_sku_code(p_code text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(upper(btrim(p_code)),'')
$$;

revoke all on function public.ecoflow_canonical_ordermentum_sku_code(text)
  from public,anon;
grant execute on function public.ecoflow_canonical_ordermentum_sku_code(text)
  to authenticated,service_role;

create or replace view public.v_ecoflow_ordermentum_sku_normalization_collisions
with (security_invoker=true)
as
with source_rows(source_namespace,normalized_code,raw_code,authority_target) as (
  select
    'EXTERNAL_PRODUCT_MAPPING'::text,
    public.ecoflow_canonical_ordermentum_sku_code(m.external_product_code),
    m.external_product_code::text,
    m.internal_sku_id::text
  from public.external_product_mappings m
  where m.provider='ORDERMENTUM'

  union all

  select
    'BARCODE_CONFIRMATION'::text,
    public.ecoflow_canonical_ordermentum_sku_code(bc.external_sku_code),
    bc.external_sku_code::text,
    bc.sku_id::text
  from public.ecoflow_sku_barcode_confirmations bc
  where bc.provider='ORDERMENTUM'

  union all

  select
    'RAW_ORDER_LINE'::text,
    public.ecoflow_canonical_ordermentum_sku_code(l.external_sku_code),
    l.external_sku_code::text,
    null::text
  from public.v_ecoflow_ordermentum_order_lines l
)
select
  source_namespace,
  normalized_code,
  count(distinct raw_code)::bigint as raw_code_count,
  count(distinct authority_target)::bigint as authority_target_count,
  array_agg(distinct raw_code order by raw_code) as raw_codes
from source_rows
where normalized_code is not null
group by source_namespace,normalized_code
having count(distinct raw_code)>1
    or count(distinct authority_target)>1;

revoke all on public.v_ecoflow_ordermentum_sku_normalization_collisions
  from public,anon;
grant select on public.v_ecoflow_ordermentum_sku_normalization_collisions
  to authenticated,service_role;

create or replace view public.v_ecoflow_ordermentum_barcode_confirmation_workbench as
with line_usage as (
  select
    l.external_sku_code,
    max(l.external_product_name) as external_product_name,
    count(distinct l.order_number)::bigint as order_count,
    count(*)::bigint as line_count,
    coalesce(sum(l.quantity),0)::numeric(12,4) as total_required_quantity,
    coalesce(sum(l.total),0)::numeric(12,4) as total_sales_value,
    string_agg(distinct nullif(coalesce(l.unit,l.uom,''),''),', ' order by nullif(coalesce(l.unit,l.uom,''),'')) as unit_summary
  from public.v_ecoflow_ordermentum_order_lines l
  group by l.external_sku_code
),
mapping_groups as (
  select
    public.ecoflow_canonical_ordermentum_sku_code(m.external_product_code) as normalized_code,
    (min(m.internal_sku_id::text))::uuid as internal_sku_id,
    count(*)::bigint as row_count,
    count(distinct m.internal_sku_id)::bigint as target_count
  from public.external_product_mappings m
  where m.provider='ORDERMENTUM'
    and public.ecoflow_canonical_ordermentum_sku_code(m.external_product_code) is not null
  group by public.ecoflow_canonical_ordermentum_sku_code(m.external_product_code)
),
valid_mappings as (
  select g.normalized_code,g.internal_sku_id
  from mapping_groups g
  where g.row_count=1 and g.target_count=1
    and not exists(
      select 1 from public.v_ecoflow_ordermentum_sku_normalization_collisions c
      where c.normalized_code=g.normalized_code
        and c.source_namespace in ('EXTERNAL_PRODUCT_MAPPING','RAW_ORDER_LINE')
    )
),
barcode_groups as (
  select
    public.ecoflow_canonical_ordermentum_sku_code(bc.external_sku_code) as normalized_code,
    count(*)::bigint as row_count
  from public.ecoflow_sku_barcode_confirmations bc
  where bc.provider='ORDERMENTUM'
    and public.ecoflow_canonical_ordermentum_sku_code(bc.external_sku_code) is not null
  group by public.ecoflow_canonical_ordermentum_sku_code(bc.external_sku_code)
),
valid_barcodes as (
  select
    g.normalized_code,
    bc.ordermentum_barcode_candidate,
    bc.warehouse_barcode,
    bc.status,
    bc.confirmed_at,
    bc.confirmed_by,
    bc.notes
  from barcode_groups g
  join public.ecoflow_sku_barcode_confirmations bc
    on bc.provider='ORDERMENTUM'
   and public.ecoflow_canonical_ordermentum_sku_code(bc.external_sku_code)=g.normalized_code
  where g.row_count=1
    and not exists(
      select 1 from public.v_ecoflow_ordermentum_sku_normalization_collisions c
      where c.normalized_code=g.normalized_code
        and c.source_namespace in ('BARCODE_CONFIRMATION','RAW_ORDER_LINE')
    )
),
base as (
  select
    lu.external_sku_code,
    lu.external_product_name,
    lu.order_count,
    lu.line_count,
    lu.total_required_quantity,
    lu.total_sales_value,
    lu.unit_summary,
    m.internal_sku_id as sku_id,
    coalesce(bc.ordermentum_barcode_candidate,ov.raw_json->>'barcode',op.raw_json->>'barcode') as ordermentum_barcode_candidate,
    bc.warehouse_barcode,
    coalesce(bc.status,'NEEDS_BARCODE') as barcode_status,
    bc.confirmed_at,
    bc.confirmed_by,
    bc.notes
  from line_usage lu
  left join valid_mappings m
    on m.normalized_code=public.ecoflow_canonical_ordermentum_sku_code(lu.external_sku_code)
  left join valid_barcodes bc
    on bc.normalized_code=public.ecoflow_canonical_ordermentum_sku_code(lu.external_sku_code)
  left join public.om_variants ov
    on ov.sku=lu.external_sku_code
  left join public.om_products op
    on op.sku=lu.external_sku_code
)
select
  row_number() over (
    order by
      case when b.barcode_status in ('CONFIRMED','SERVICE_ITEM') then 1 else 0 end,
      b.order_count desc,
      b.line_count desc,
      b.external_sku_code
  )::bigint as priority_rank,
  'ORDERMENTUM'::text as provider,
  b.external_sku_code,
  b.external_product_name,
  b.sku_id,
  b.order_count,
  b.line_count,
  b.total_required_quantity,
  b.total_sales_value,
  b.unit_summary,
  b.ordermentum_barcode_candidate,
  case
    when b.ordermentum_barcode_candidate is null then 'MISSING'
    when b.ordermentum_barcode_candidate ~* '^x[0-9a-f]{8}$' then 'ORDERMENTUM_INTERNAL_CODE'
    when b.ordermentum_barcode_candidate ~ '^[0-9]{8,14}$' then 'POSSIBLE_PACKAGING_BARCODE'
    else 'SUPPLIER_OR_PLATFORM_CODE'
  end as barcode_candidate_type,
  b.warehouse_barcode,
  b.barcode_status,
  case
    when b.barcode_status='CONFIRMED' then 'PASS_CONFIRMED'
    when b.barcode_status='SERVICE_ITEM' then 'PASS_SERVICE_ITEM'
    when b.barcode_status='IGNORED' then 'PASS_IGNORED'
    else 'BLOCKED_BARCODE'
  end as warehouse_gate_status,
  case
    when b.barcode_status='CONFIRMED' then 'Ready for warehouse barcode scan'
    when b.barcode_status='SERVICE_ITEM' then 'No warehouse barcode required'
    when b.ordermentum_barcode_candidate ~* '^x[0-9a-f]{8}$' then 'Confirm real packaging barcode; Ordermentum x-code is not warehouse barcode'
    when b.ordermentum_barcode_candidate is null then 'Add real packaging barcode'
    else 'Review candidate and confirm real packaging barcode'
  end as required_action,
  b.confirmed_at,
  b.confirmed_by,
  b.notes
from base b;

create or replace view public.v_ecoflow_ordermentum_release_gate_v3 as
with mapping_groups as (
  select
    public.ecoflow_canonical_ordermentum_sku_code(m.external_product_code) as normalized_code,
    (min(m.internal_sku_id::text))::uuid as internal_sku_id,
    count(*)::bigint as row_count,
    count(distinct m.internal_sku_id)::bigint as target_count
  from public.external_product_mappings m
  where m.provider='ORDERMENTUM'
    and public.ecoflow_canonical_ordermentum_sku_code(m.external_product_code) is not null
  group by public.ecoflow_canonical_ordermentum_sku_code(m.external_product_code)
),
valid_mappings as (
  select g.normalized_code,g.internal_sku_id
  from mapping_groups g
  where g.row_count=1 and g.target_count=1
    and not exists(
      select 1 from public.v_ecoflow_ordermentum_sku_normalization_collisions c
      where c.normalized_code=g.normalized_code
        and c.source_namespace in ('EXTERNAL_PRODUCT_MAPPING','RAW_ORDER_LINE')
    )
),
barcode_groups as (
  select
    public.ecoflow_canonical_ordermentum_sku_code(bc.external_sku_code) as normalized_code,
    count(*)::bigint as row_count
  from public.ecoflow_sku_barcode_confirmations bc
  where bc.provider='ORDERMENTUM'
    and public.ecoflow_canonical_ordermentum_sku_code(bc.external_sku_code) is not null
  group by public.ecoflow_canonical_ordermentum_sku_code(bc.external_sku_code)
),
valid_barcodes as (
  select g.normalized_code,bc.status
  from barcode_groups g
  join public.ecoflow_sku_barcode_confirmations bc
    on bc.provider='ORDERMENTUM'
   and public.ecoflow_canonical_ordermentum_sku_code(bc.external_sku_code)=g.normalized_code
  where g.row_count=1
    and not exists(
      select 1 from public.v_ecoflow_ordermentum_sku_normalization_collisions c
      where c.normalized_code=g.normalized_code
        and c.source_namespace in ('BARCODE_CONFIRMATION','RAW_ORDER_LINE')
    )
),
mapping_by_order as (
  select
    i.raw_order_id,
    i.order_number,
    i.invoice_number,
    count(l.*) filter(where m.internal_sku_id is null)::bigint as unmapped_line_count
  from public.v_ecoflow_ordermentum_inbox i
  left join public.v_ecoflow_ordermentum_order_lines l
    on l.invoice_number=i.invoice_number
  left join valid_mappings m
    on m.normalized_code=public.ecoflow_canonical_ordermentum_sku_code(l.external_sku_code)
  group by i.raw_order_id,i.order_number,i.invoice_number
),
barcode_by_order as (
  select
    i.raw_order_id,
    i.order_number,
    i.invoice_number,
    count(l.*) filter(
      where coalesce(bc.status,'NEEDS_BARCODE') not in ('CONFIRMED','SERVICE_ITEM','IGNORED')
    )::bigint as barcode_blocked_line_count,
    count(l.*) filter(where bc.status='CONFIRMED')::bigint as barcode_confirmed_line_count,
    count(l.*) filter(where bc.status='SERVICE_ITEM')::bigint as service_line_count
  from public.v_ecoflow_ordermentum_inbox i
  left join public.v_ecoflow_ordermentum_order_lines l
    on l.invoice_number=i.invoice_number
  left join valid_barcodes bc
    on bc.normalized_code=public.ecoflow_canonical_ordermentum_sku_code(l.external_sku_code)
  group by i.raw_order_id,i.order_number,i.invoice_number
)
select
  i.*,
  coalesce(m.unmapped_line_count,0)::bigint as unmapped_line_count,
  coalesce(b.barcode_blocked_line_count,0)::bigint as barcode_blocked_line_count,
  coalesce(b.barcode_confirmed_line_count,0)::bigint as barcode_confirmed_line_count,
  coalesce(b.service_line_count,0)::bigint as service_line_count,
  0::bigint as stock_shortage_count,
  case
    when i.invoice_detail_missing=true or i.line_items_missing=true then 'BLOCKED_DATA'
    when coalesce(m.unmapped_line_count,0)>0 then 'BLOCKED_MAPPING'
    else 'READY_TO_INTERNALISE'
  end as internalisation_status,
  case
    when i.invoice_detail_missing=true or i.line_items_missing=true then 'NOT_ELIGIBLE_DATA'
    when coalesce(m.unmapped_line_count,0)>0 then 'NOT_ELIGIBLE_MAPPING'
    when coalesce(i.payment_status,i.invoice_payment_status,'') in ('Paid','Processing','N/A','') then 'READY_FOR_ACCOUNT_RELEASE'
    else 'HOLD_PAYMENT_REVIEW'
  end as account_release_status,
  case
    when i.invoice_detail_missing=true or i.line_items_missing=true then 'NOT_ELIGIBLE_DATA'
    when coalesce(m.unmapped_line_count,0)>0 then 'NOT_ELIGIBLE_MAPPING'
    when coalesce(b.barcode_blocked_line_count,0)>0 then 'BLOCKED_BARCODE'
    else 'READY_FOR_WAREHOUSE_PRECHECK'
  end as warehouse_gate_status
from public.v_ecoflow_ordermentum_inbox i
left join mapping_by_order m on m.raw_order_id=i.raw_order_id
left join barcode_by_order b on b.raw_order_id=i.raw_order_id;

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
  if coalesce(p_limit,0)<=0 then
    raise exception 'p_limit must be greater than 0';
  end if;

  if p_dry_run then
    return query
    select
      d.raw_order_id,
      d.order_number::text,
      d.invoice_number::text,
      'DRY_RUN_ELIGIBLE'::text,
      null::uuid,
      d.account_release_status::text,
      d.warehouse_gate_status::text,
      d.line_count::bigint
    from public.v_ecoflow_ordermentum_internal_order_drafts_v3 d
    where d.creation_status='READY_TO_CREATE'
      and d.internalisation_status='READY_TO_INTERNALISE'
      and (p_include_payment_review=true or d.account_release_status<>'HOLD_PAYMENT_REVIEW')
    order by d.updated_business_day,d.order_number
    limit p_limit;
    return;
  end if;

  return query
  with candidates as (
    select
      d.raw_order_id,d.external_order_id,d.external_order_number,d.order_number,
      d.invoice_number,d.payment_status,d.invoice_payment_status,d.invoice_total,
      d.total_due,d.line_count,d.account_release_status,d.warehouse_gate_status,
      d.last_synced_at,d.updated_business_day
    from public.v_ecoflow_ordermentum_internal_order_drafts_v3 d
    where d.creation_status='READY_TO_CREATE'
      and d.internalisation_status='READY_TO_INTERNALISE'
      and (p_include_payment_review=true or d.account_release_status<>'HOLD_PAYMENT_REVIEW')
    order by d.updated_business_day,d.order_number
    limit p_limit
  ),
  upsert_orders as (
    insert into public.ecoflow_ordermentum_internal_orders(
      source_provider,raw_order_id,external_order_id,external_order_number,
      invoice_number,order_number,payment_status,invoice_payment_status,
      invoice_total,total_due,line_count,status,account_release_status,
      warehouse_gate_status,imported_at,last_synced_at
    )
    select
      'ORDERMENTUM',c.raw_order_id,c.external_order_id,c.external_order_number,
      c.invoice_number,c.order_number,c.payment_status,c.invoice_payment_status,
      c.invoice_total,c.total_due,c.line_count,'IMPORTED',c.account_release_status,
      c.warehouse_gate_status,now(),c.last_synced_at
    from candidates c
    on conflict(raw_order_id) do update set
      external_order_id=excluded.external_order_id,
      external_order_number=excluded.external_order_number,
      invoice_number=excluded.invoice_number,
      order_number=excluded.order_number,
      payment_status=excluded.payment_status,
      invoice_payment_status=excluded.invoice_payment_status,
      invoice_total=excluded.invoice_total,
      total_due=excluded.total_due,
      line_count=excluded.line_count,
      account_release_status=excluded.account_release_status,
      warehouse_gate_status=excluded.warehouse_gate_status,
      last_synced_at=excluded.last_synced_at,
      updated_at=now()
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
    where ol.internal_order_id=u.id
    returning ol.id
  ),
  mapping_groups as (
    select
      public.ecoflow_canonical_ordermentum_sku_code(m.external_product_code) as normalized_code,
      (min(m.internal_sku_id::text))::uuid as internal_sku_id,
      count(*)::bigint as row_count,
      count(distinct m.internal_sku_id)::bigint as target_count
    from public.external_product_mappings m
    where m.provider='ORDERMENTUM'
      and public.ecoflow_canonical_ordermentum_sku_code(m.external_product_code) is not null
    group by public.ecoflow_canonical_ordermentum_sku_code(m.external_product_code)
  ),
  valid_mappings as (
    select g.normalized_code,g.internal_sku_id
    from mapping_groups g
    where g.row_count=1 and g.target_count=1
      and not exists(
        select 1 from public.v_ecoflow_ordermentum_sku_normalization_collisions c
        where c.normalized_code=g.normalized_code
          and c.source_namespace in ('EXTERNAL_PRODUCT_MAPPING','RAW_ORDER_LINE')
      )
  ),
  barcode_groups as (
    select
      public.ecoflow_canonical_ordermentum_sku_code(bc.external_sku_code) as normalized_code,
      count(*)::bigint as row_count
    from public.ecoflow_sku_barcode_confirmations bc
    where bc.provider='ORDERMENTUM'
      and public.ecoflow_canonical_ordermentum_sku_code(bc.external_sku_code) is not null
    group by public.ecoflow_canonical_ordermentum_sku_code(bc.external_sku_code)
  ),
  valid_barcodes as (
    select g.normalized_code,bc.status,bc.warehouse_barcode
    from barcode_groups g
    join public.ecoflow_sku_barcode_confirmations bc
      on bc.provider='ORDERMENTUM'
     and public.ecoflow_canonical_ordermentum_sku_code(bc.external_sku_code)=g.normalized_code
    where g.row_count=1
      and not exists(
        select 1 from public.v_ecoflow_ordermentum_sku_normalization_collisions c
        where c.normalized_code=g.normalized_code
          and c.source_namespace in ('BARCODE_CONFIRMATION','RAW_ORDER_LINE')
      )
  ),
  line_source as (
    select
      u.id as internal_order_id,
      row_number() over(
        partition by u.id
        order by l.external_sku_code,l.external_product_name,l.source_line_id nulls last
      )::integer as line_index,
      l.external_sku_code,
      l.external_product_name,
      m.internal_sku_id,
      l.quantity,l.unit,l.uom,l.price,l.rate_price,l.subtotal,l.gst,l.tax,l.total,
      coalesce(bc.status,'NEEDS_BARCODE') as barcode_status,
      bc.warehouse_barcode,
      case when coalesce(bc.status,'NEEDS_BARCODE')='SERVICE_ITEM' then 'SERVICE' else 'STOCK' end as line_type
    from upsert_orders u
    join public.v_ecoflow_ordermentum_order_lines l
      on l.invoice_number=u.invoice_number
    left join valid_mappings m
      on m.normalized_code=public.ecoflow_canonical_ordermentum_sku_code(l.external_sku_code)
    left join valid_barcodes bc
      on bc.normalized_code=public.ecoflow_canonical_ordermentum_sku_code(l.external_sku_code)
  ),
  insert_lines as (
    insert into public.ecoflow_ordermentum_internal_order_lines(
      internal_order_id,line_index,external_sku_code,external_product_name,
      internal_sku_id,quantity,unit,uom,price,rate_price,subtotal,gst,tax,total,
      barcode_status,warehouse_barcode,line_type
    )
    select
      ls.internal_order_id,ls.line_index,ls.external_sku_code,ls.external_product_name,
      ls.internal_sku_id,ls.quantity,ls.unit,ls.uom,ls.price,ls.rate_price,
      ls.subtotal,ls.gst,ls.tax,ls.total,ls.barcode_status,ls.warehouse_barcode,
      ls.line_type
    from line_source ls
    returning internal_order_id
  )
  select
    u.raw_order_id,u.order_number::text,u.invoice_number::text,
    'CREATED_OR_UPDATED'::text,u.id,u.account_release_status::text,
    u.warehouse_gate_status::text,u.line_count::bigint
  from upsert_orders u
  order by u.order_number;
end;
$$;

revoke all on function public.ecoflow_internalise_ordermentum_orders(integer,boolean,boolean)
  from public,anon,authenticated;
grant execute on function public.ecoflow_internalise_ordermentum_orders(integer,boolean,boolean)
  to service_role;

comment on function public.ecoflow_canonical_ordermentum_sku_code(text) is
  'Bounded Ordermentum SKU identity comparator: uppercase after outer-space trim; blank is not an identity.';
comment on view public.v_ecoflow_ordermentum_sku_normalization_collisions is
  'Read-only fail-closed evidence for normalized raw-code or authority-target collisions; raw evidence is never rewritten.';

commit;
