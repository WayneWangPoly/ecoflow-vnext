-- EcoFlow / Ordermentum internalisation + barcode gate v3
-- Purpose:
-- 1) Keep Ordermentum SKU mapping usable for internal order creation.
-- 2) Add a separate warehouse barcode confirmation gate so auto-created SKU drafts cannot enter pick wave blindly.
-- 3) Create a safe internal order staging layer independent of unknown legacy orders/order_lines schema.
-- 4) Provide an idempotent RPC to create/update internalised Ordermentum orders and lines.

begin;

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. Barcode confirmation layer
-- -----------------------------------------------------------------------------

create table if not exists public.ecoflow_sku_barcode_confirmations (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'ORDERMENTUM',
  external_sku_code text not null,
  sku_id uuid,
  ordermentum_barcode_candidate text,
  warehouse_barcode text,
  status text not null default 'NEEDS_BARCODE',
  notes text,
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ecoflow_sku_barcode_confirmations_status_chk check (
    status in ('NEEDS_BARCODE','CONFIRMED','ORDERMENTUM_CODE_ONLY','SERVICE_ITEM','IGNORED')
  ),
  constraint ecoflow_sku_barcode_confirmations_provider_external_uniq unique (provider, external_sku_code)
);

create index if not exists idx_ecoflow_sku_barcode_confirmations_sku_id
  on public.ecoflow_sku_barcode_confirmations (sku_id);

create index if not exists idx_ecoflow_sku_barcode_confirmations_status
  on public.ecoflow_sku_barcode_confirmations (status);

-- Keep updated_at current for future changes.
create or replace function public.ecoflow_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_ecoflow_sku_barcode_confirmations_touch on public.ecoflow_sku_barcode_confirmations;
create trigger trg_ecoflow_sku_barcode_confirmations_touch
before update on public.ecoflow_sku_barcode_confirmations
for each row execute function public.ecoflow_touch_updated_at();

-- Seed one barcode-control row per mapped Ordermentum SKU. This does NOT confirm
-- warehouse barcodes. Ordermentum's x-prefixed barcode values are treated only as
-- candidates / platform codes.
insert into public.ecoflow_sku_barcode_confirmations (
  provider,
  external_sku_code,
  sku_id,
  ordermentum_barcode_candidate,
  status,
  notes
)
select
  'ORDERMENTUM'::text as provider,
  src.external_sku_code,
  src.sku_id,
  src.ordermentum_barcode_candidate,
  case
    when src.external_sku_code = 'FC-01'
      or lower(coalesce(src.external_product_name, '')) like '%freight%'
      or lower(coalesce(src.external_product_name, '')) like '%delivery%'
      or lower(coalesce(src.external_product_name, '')) like '%shipping%'
      then 'SERVICE_ITEM'
    else 'NEEDS_BARCODE'
  end as status,
  'Seeded from Ordermentum SKU mapping. Warehouse barcode must be confirmed before warehouse release.'::text as notes
from (
  select
    m.external_product_code as external_sku_code,
    (min(m.internal_sku_id::text))::uuid as sku_id,
    max(coalesce(ov.raw_json->>'barcode', op.raw_json->>'barcode')) as ordermentum_barcode_candidate,
    max(coalesce(ov.name, op.name, l.external_product_name)) as external_product_name
  from public.external_product_mappings m
  left join public.om_variants ov
    on ov.sku = m.external_product_code
  left join public.om_products op
    on op.sku = m.external_product_code
  left join public.v_ecoflow_ordermentum_order_lines l
    on l.external_sku_code = m.external_product_code
  where m.provider = 'ORDERMENTUM'
    and m.external_product_code is not null
  group by m.external_product_code
) src
on conflict (provider, external_sku_code) do update set
  sku_id = coalesce(public.ecoflow_sku_barcode_confirmations.sku_id, excluded.sku_id),
  ordermentum_barcode_candidate = coalesce(public.ecoflow_sku_barcode_confirmations.ordermentum_barcode_candidate, excluded.ordermentum_barcode_candidate),
  notes = coalesce(public.ecoflow_sku_barcode_confirmations.notes, excluded.notes),
  updated_at = now();

-- Make obvious non-stock charge lines pass the warehouse barcode gate as service items.
update public.ecoflow_sku_barcode_confirmations bc
set
  status = 'SERVICE_ITEM',
  notes = coalesce(bc.notes, '') || case when coalesce(bc.notes, '') = '' then '' else ' ' end || 'Auto-marked as service/non-stock item.',
  updated_at = now()
from (
  select distinct
    l.external_sku_code,
    max(l.external_product_name) as external_product_name
  from public.v_ecoflow_ordermentum_order_lines l
  group by l.external_sku_code
) src
where bc.provider = 'ORDERMENTUM'
  and bc.external_sku_code = src.external_sku_code
  and bc.status <> 'CONFIRMED'
  and (
    src.external_sku_code = 'FC-01'
    or lower(coalesce(src.external_product_name, '')) like '%freight%'
    or lower(coalesce(src.external_product_name, '')) like '%delivery%'
    or lower(coalesce(src.external_product_name, '')) like '%shipping%'
  );

-- Confirm a real warehouse scan barcode for one Ordermentum SKU.
create or replace function public.ecoflow_confirm_ordermentum_barcode(
  p_external_sku_code text,
  p_warehouse_barcode text,
  p_confirmed_by text default null,
  p_notes text default null
)
returns table (
  external_sku_code text,
  previous_status text,
  new_status text,
  warehouse_barcode text
)
language plpgsql
security definer
as $$
declare
  v_previous_status text;
begin
  if nullif(trim(p_external_sku_code), '') is null then
    raise exception 'p_external_sku_code is required';
  end if;

  if nullif(trim(p_warehouse_barcode), '') is null then
    raise exception 'p_warehouse_barcode is required';
  end if;

  select bc.status
    into v_previous_status
  from public.ecoflow_sku_barcode_confirmations bc
  where bc.provider = 'ORDERMENTUM'
    and bc.external_sku_code = p_external_sku_code;

  insert into public.ecoflow_sku_barcode_confirmations (
    provider,
    external_sku_code,
    warehouse_barcode,
    status,
    confirmed_by,
    confirmed_at,
    notes
  ) values (
    'ORDERMENTUM',
    p_external_sku_code,
    trim(p_warehouse_barcode),
    'CONFIRMED',
    p_confirmed_by,
    now(),
    p_notes
  )
  on conflict (provider, external_sku_code) do update set
    warehouse_barcode = excluded.warehouse_barcode,
    status = 'CONFIRMED',
    confirmed_by = excluded.confirmed_by,
    confirmed_at = now(),
    notes = coalesce(excluded.notes, public.ecoflow_sku_barcode_confirmations.notes),
    updated_at = now();

  return query
  select
    p_external_sku_code::text,
    coalesce(v_previous_status, 'NEW')::text,
    'CONFIRMED'::text,
    trim(p_warehouse_barcode)::text;
end;
$$;

-- Mark a SKU as non-stock / service line. Example: freight charge.
create or replace function public.ecoflow_mark_ordermentum_service_item(
  p_external_sku_code text,
  p_notes text default null
)
returns table (
  external_sku_code text,
  previous_status text,
  new_status text
)
language plpgsql
security definer
as $$
declare
  v_previous_status text;
begin
  if nullif(trim(p_external_sku_code), '') is null then
    raise exception 'p_external_sku_code is required';
  end if;

  select bc.status
    into v_previous_status
  from public.ecoflow_sku_barcode_confirmations bc
  where bc.provider = 'ORDERMENTUM'
    and bc.external_sku_code = p_external_sku_code;

  insert into public.ecoflow_sku_barcode_confirmations (
    provider,
    external_sku_code,
    status,
    notes
  ) values (
    'ORDERMENTUM',
    p_external_sku_code,
    'SERVICE_ITEM',
    p_notes
  )
  on conflict (provider, external_sku_code) do update set
    status = 'SERVICE_ITEM',
    notes = coalesce(excluded.notes, public.ecoflow_sku_barcode_confirmations.notes),
    updated_at = now();

  return query
  select
    p_external_sku_code::text,
    coalesce(v_previous_status, 'NEW')::text,
    'SERVICE_ITEM'::text;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Workbench and gates
-- -----------------------------------------------------------------------------

drop view if exists public.v_ecoflow_ordermentum_internalisation_control cascade;
drop view if exists public.v_ecoflow_ordermentum_internal_order_drafts_v3 cascade;
drop view if exists public.v_ecoflow_ordermentum_warehouse_gate_queue cascade;
drop view if exists public.v_ecoflow_ordermentum_account_release_queue cascade;
drop view if exists public.v_ecoflow_ordermentum_release_gate_v3 cascade;
drop view if exists public.v_ecoflow_ordermentum_barcode_confirmation_workbench cascade;

create or replace view public.v_ecoflow_ordermentum_barcode_confirmation_workbench as
with line_usage as (
  select
    l.external_sku_code,
    max(l.external_product_name) as external_product_name,
    count(distinct l.order_number)::bigint as order_count,
    count(*)::bigint as line_count,
    coalesce(sum(l.quantity), 0)::numeric(12,4) as total_required_quantity,
    coalesce(sum(l.total), 0)::numeric(12,4) as total_sales_value,
    string_agg(distinct nullif(coalesce(l.unit, l.uom, ''), ''), ', ' order by nullif(coalesce(l.unit, l.uom, ''), '')) as unit_summary
  from public.v_ecoflow_ordermentum_order_lines l
  group by l.external_sku_code
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
    coalesce(bc.ordermentum_barcode_candidate, ov.raw_json->>'barcode', op.raw_json->>'barcode') as ordermentum_barcode_candidate,
    bc.warehouse_barcode,
    coalesce(bc.status, 'NEEDS_BARCODE') as barcode_status,
    bc.confirmed_at,
    bc.confirmed_by,
    bc.notes
  from line_usage lu
  left join public.external_product_mappings m
    on m.provider = 'ORDERMENTUM'
   and m.external_product_code = lu.external_sku_code
  left join public.ecoflow_sku_barcode_confirmations bc
    on bc.provider = 'ORDERMENTUM'
   and bc.external_sku_code = lu.external_sku_code
  left join public.om_variants ov
    on ov.sku = lu.external_sku_code
  left join public.om_products op
    on op.sku = lu.external_sku_code
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
    when b.barcode_status = 'CONFIRMED' then 'PASS_CONFIRMED'
    when b.barcode_status = 'SERVICE_ITEM' then 'PASS_SERVICE_ITEM'
    when b.barcode_status = 'IGNORED' then 'PASS_IGNORED'
    else 'BLOCKED_BARCODE'
  end as warehouse_gate_status,
  case
    when b.barcode_status = 'CONFIRMED' then 'Ready for warehouse barcode scan'
    when b.barcode_status = 'SERVICE_ITEM' then 'No warehouse barcode required'
    when b.ordermentum_barcode_candidate ~* '^x[0-9a-f]{8}$' then 'Confirm real packaging barcode; Ordermentum x-code is not warehouse barcode'
    when b.ordermentum_barcode_candidate is null then 'Add real packaging barcode'
    else 'Review candidate and confirm real packaging barcode'
  end as required_action,
  b.confirmed_at,
  b.confirmed_by,
  b.notes
from base b;

create or replace view public.v_ecoflow_ordermentum_release_gate_v3 as
with mapping_by_order as (
  select
    i.raw_order_id,
    i.order_number,
    i.invoice_number,
    count(l.*) filter (
      where m.internal_sku_id is null
    )::bigint as unmapped_line_count
  from public.v_ecoflow_ordermentum_inbox i
  left join public.v_ecoflow_ordermentum_order_lines l
    on l.invoice_number = i.invoice_number
  left join public.external_product_mappings m
    on m.provider = 'ORDERMENTUM'
   and m.external_product_code = l.external_sku_code
  group by i.raw_order_id, i.order_number, i.invoice_number
),
barcode_by_order as (
  select
    i.raw_order_id,
    i.order_number,
    i.invoice_number,
    count(l.*) filter (
      where coalesce(bc.status, 'NEEDS_BARCODE') not in ('CONFIRMED','SERVICE_ITEM','IGNORED')
    )::bigint as barcode_blocked_line_count,
    count(l.*) filter (where bc.status = 'CONFIRMED')::bigint as barcode_confirmed_line_count,
    count(l.*) filter (where bc.status = 'SERVICE_ITEM')::bigint as service_line_count
  from public.v_ecoflow_ordermentum_inbox i
  left join public.v_ecoflow_ordermentum_order_lines l
    on l.invoice_number = i.invoice_number
  left join public.ecoflow_sku_barcode_confirmations bc
    on bc.provider = 'ORDERMENTUM'
   and bc.external_sku_code = l.external_sku_code
  group by i.raw_order_id, i.order_number, i.invoice_number
)
select
  i.*,
  coalesce(m.unmapped_line_count, 0)::bigint as unmapped_line_count,
  coalesce(b.barcode_blocked_line_count, 0)::bigint as barcode_blocked_line_count,
  coalesce(b.barcode_confirmed_line_count, 0)::bigint as barcode_confirmed_line_count,
  coalesce(b.service_line_count, 0)::bigint as service_line_count,
  0::bigint as stock_shortage_count,
  case
    when i.invoice_detail_missing = true or i.line_items_missing = true then 'BLOCKED_DATA'
    when coalesce(m.unmapped_line_count, 0) > 0 then 'BLOCKED_MAPPING'
    else 'READY_TO_INTERNALISE'
  end as internalisation_status,
  case
    when i.invoice_detail_missing = true or i.line_items_missing = true then 'NOT_ELIGIBLE_DATA'
    when coalesce(m.unmapped_line_count, 0) > 0 then 'NOT_ELIGIBLE_MAPPING'
    when coalesce(i.payment_status, i.invoice_payment_status, '') in ('Paid','Processing','N/A','') then 'READY_FOR_ACCOUNT_RELEASE'
    else 'HOLD_PAYMENT_REVIEW'
  end as account_release_status,
  case
    when i.invoice_detail_missing = true or i.line_items_missing = true then 'NOT_ELIGIBLE_DATA'
    when coalesce(m.unmapped_line_count, 0) > 0 then 'NOT_ELIGIBLE_MAPPING'
    when coalesce(b.barcode_blocked_line_count, 0) > 0 then 'BLOCKED_BARCODE'
    else 'READY_FOR_WAREHOUSE_PRECHECK'
  end as warehouse_gate_status
from public.v_ecoflow_ordermentum_inbox i
left join mapping_by_order m
  on m.raw_order_id = i.raw_order_id
left join barcode_by_order b
  on b.raw_order_id = i.raw_order_id;

create or replace view public.v_ecoflow_ordermentum_account_release_queue as
select
  row_number() over (
    order by
      case when g.account_release_status = 'HOLD_PAYMENT_REVIEW' then 0 else 1 end,
      g.updated_business_day desc,
      g.order_number desc
  )::bigint as queue_rank,
  g.raw_order_id,
  g.order_number,
  g.invoice_number,
  g.payment_status,
  g.invoice_payment_status,
  g.invoice_total,
  g.total_due,
  g.line_count,
  g.internalisation_status,
  g.account_release_status,
  g.warehouse_gate_status,
  g.updated_business_day,
  case
    when g.account_release_status = 'HOLD_PAYMENT_REVIEW' then 'Account review required before warehouse release'
    when g.warehouse_gate_status = 'BLOCKED_BARCODE' then 'Internal order can be created; warehouse barcode confirmation still required'
    else 'Ready for account release review'
  end as required_action
from public.v_ecoflow_ordermentum_release_gate_v3 g
where g.internalisation_status = 'READY_TO_INTERNALISE';

create or replace view public.v_ecoflow_ordermentum_warehouse_gate_queue as
select
  row_number() over (
    order by
      case when g.warehouse_gate_status = 'BLOCKED_BARCODE' then 0 else 1 end,
      g.barcode_blocked_line_count desc,
      g.updated_business_day desc,
      g.order_number desc
  )::bigint as queue_rank,
  g.raw_order_id,
  g.order_number,
  g.invoice_number,
  g.line_count,
  g.barcode_blocked_line_count,
  g.barcode_confirmed_line_count,
  g.service_line_count,
  g.internalisation_status,
  g.account_release_status,
  g.warehouse_gate_status,
  case
    when g.warehouse_gate_status = 'BLOCKED_BARCODE' then 'Confirm warehouse barcodes before pick wave'
    when g.warehouse_gate_status = 'READY_FOR_WAREHOUSE_PRECHECK' then 'Barcode gate passed; stock and location checks still required'
    else 'Not eligible for warehouse release'
  end as required_action
from public.v_ecoflow_ordermentum_release_gate_v3 g
where g.internalisation_status = 'READY_TO_INTERNALISE';

-- -----------------------------------------------------------------------------
-- 3. Safe internal order staging layer
-- -----------------------------------------------------------------------------

create table if not exists public.ecoflow_ordermentum_internal_orders (
  id uuid primary key default gen_random_uuid(),
  source_provider text not null default 'ORDERMENTUM',
  raw_order_id uuid not null unique,
  external_order_id text,
  external_order_number text,
  invoice_number text,
  order_number text,
  payment_status text,
  invoice_payment_status text,
  invoice_total numeric(12,4),
  total_due numeric(12,4),
  line_count bigint,
  status text not null default 'IMPORTED',
  account_release_status text not null default 'WAITING_ACCOUNT_RELEASE',
  warehouse_gate_status text not null default 'BLOCKED_BARCODE',
  imported_at timestamptz not null default now(),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ecoflow_ordermentum_internal_orders_status
  on public.ecoflow_ordermentum_internal_orders (status);

create index if not exists idx_ecoflow_ordermentum_internal_orders_account_release
  on public.ecoflow_ordermentum_internal_orders (account_release_status);

create index if not exists idx_ecoflow_ordermentum_internal_orders_warehouse_gate
  on public.ecoflow_ordermentum_internal_orders (warehouse_gate_status);

drop trigger if exists trg_ecoflow_ordermentum_internal_orders_touch on public.ecoflow_ordermentum_internal_orders;
create trigger trg_ecoflow_ordermentum_internal_orders_touch
before update on public.ecoflow_ordermentum_internal_orders
for each row execute function public.ecoflow_touch_updated_at();

create table if not exists public.ecoflow_ordermentum_internal_order_lines (
  id uuid primary key default gen_random_uuid(),
  internal_order_id uuid not null references public.ecoflow_ordermentum_internal_orders(id) on delete cascade,
  line_index integer not null,
  external_sku_code text,
  external_product_name text,
  internal_sku_id uuid,
  quantity numeric(12,4),
  unit text,
  uom text,
  price numeric(12,4),
  rate_price numeric(12,4),
  subtotal numeric(12,4),
  gst numeric(12,4),
  tax numeric(12,4),
  total numeric(12,4),
  barcode_status text,
  warehouse_barcode text,
  line_type text not null default 'STOCK',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ecoflow_ordermentum_internal_order_lines_order_line_uniq unique (internal_order_id, line_index)
);

create index if not exists idx_ecoflow_ordermentum_internal_order_lines_order
  on public.ecoflow_ordermentum_internal_order_lines (internal_order_id);

create index if not exists idx_ecoflow_ordermentum_internal_order_lines_sku
  on public.ecoflow_ordermentum_internal_order_lines (external_sku_code);

drop trigger if exists trg_ecoflow_ordermentum_internal_order_lines_touch on public.ecoflow_ordermentum_internal_order_lines;
create trigger trg_ecoflow_ordermentum_internal_order_lines_touch
before update on public.ecoflow_ordermentum_internal_order_lines
for each row execute function public.ecoflow_touch_updated_at();

create or replace view public.v_ecoflow_ordermentum_internal_order_drafts_v3 as
select
  g.raw_order_id,
  g.external_order_id,
  g.external_order_number,
  g.order_number,
  g.invoice_number,
  g.payment_status,
  g.invoice_payment_status,
  g.invoice_total,
  g.total_due,
  g.line_count,
  g.total_units,
  g.internalisation_status,
  g.account_release_status,
  g.warehouse_gate_status,
  g.unmapped_line_count,
  g.barcode_blocked_line_count,
  g.barcode_confirmed_line_count,
  g.service_line_count,
  g.updated_business_day,
  g.last_synced_at,
  io.id as internal_order_id,
  io.status as internal_order_status,
  case
    when io.id is not null then 'ALREADY_INTERNALISED'
    when g.internalisation_status = 'READY_TO_INTERNALISE' then 'READY_TO_CREATE'
    else 'NOT_READY'
  end as creation_status,
  case
    when io.id is not null then 'Internal order already exists'
    when g.internalisation_status <> 'READY_TO_INTERNALISE' then 'Resolve data or SKU mapping blockers first'
    when g.warehouse_gate_status = 'BLOCKED_BARCODE' then 'Create internal order; hold warehouse release until barcode confirmation'
    else 'Create internal order; ready for account and warehouse precheck'
  end as required_action
from public.v_ecoflow_ordermentum_release_gate_v3 g
left join public.ecoflow_ordermentum_internal_orders io
  on io.raw_order_id = g.raw_order_id;

create or replace view public.v_ecoflow_ordermentum_internalisation_control as
select
  count(*)::bigint as total_orders,
  count(*) filter (where internalisation_status = 'BLOCKED_DATA')::bigint as blocked_data,
  count(*) filter (where internalisation_status = 'BLOCKED_MAPPING')::bigint as blocked_mapping,
  count(*) filter (where internalisation_status = 'READY_TO_INTERNALISE')::bigint as ready_to_internalise,
  count(*) filter (where account_release_status = 'HOLD_PAYMENT_REVIEW')::bigint as hold_payment_review,
  count(*) filter (where account_release_status = 'READY_FOR_ACCOUNT_RELEASE')::bigint as ready_for_account_release,
  count(*) filter (where warehouse_gate_status = 'BLOCKED_BARCODE')::bigint as blocked_barcode,
  count(*) filter (where warehouse_gate_status = 'READY_FOR_WAREHOUSE_PRECHECK')::bigint as ready_for_warehouse_precheck,
  (select count(*) from public.ecoflow_ordermentum_internal_orders)::bigint as internal_orders_created,
  (select count(*) from public.ecoflow_ordermentum_internal_order_lines)::bigint as internal_order_lines_created,
  coalesce(sum(invoice_total), 0)::numeric(12,4) as invoice_total,
  coalesce(sum(total_due), 0)::numeric(12,4) as total_due,
  max(last_synced_at) as last_synced_at
from public.v_ecoflow_ordermentum_release_gate_v3;

-- Idempotent internalisation RPC. Default is dry-run.
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
      d.raw_order_id,
      d.order_number::text,
      d.invoice_number::text,
      'DRY_RUN_ELIGIBLE'::text as action,
      null::uuid as internal_order_id,
      d.account_release_status::text,
      d.warehouse_gate_status::text,
      d.line_count::bigint
    from public.v_ecoflow_ordermentum_internal_order_drafts_v3 d
    where d.creation_status = 'READY_TO_CREATE'
      and d.internalisation_status = 'READY_TO_INTERNALISE'
      and (p_include_payment_review = true or d.account_release_status <> 'HOLD_PAYMENT_REVIEW')
    order by d.updated_business_day, d.order_number
    limit p_limit;

    return;
  end if;

  return query
  with candidates as (
    select
      d.raw_order_id,
      d.external_order_id,
      d.external_order_number,
      d.order_number,
      d.invoice_number,
      d.payment_status,
      d.invoice_payment_status,
      d.invoice_total,
      d.total_due,
      d.line_count,
      d.account_release_status,
      d.warehouse_gate_status,
      d.last_synced_at,
      d.updated_business_day
    from public.v_ecoflow_ordermentum_internal_order_drafts_v3 d
    where d.creation_status = 'READY_TO_CREATE'
      and d.internalisation_status = 'READY_TO_INTERNALISE'
      and (p_include_payment_review = true or d.account_release_status <> 'HOLD_PAYMENT_REVIEW')
    order by d.updated_business_day, d.order_number
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
    on conflict (raw_order_id) do update set
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
    returning internal_order_id
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

grant execute on function public.ecoflow_confirm_ordermentum_barcode(text, text, text, text) to service_role;
grant execute on function public.ecoflow_mark_ordermentum_service_item(text, text) to service_role;
grant execute on function public.ecoflow_internalise_ordermentum_orders(integer, boolean, boolean) to service_role;

commit;
