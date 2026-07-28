-- INTEL-DATA-002: governed order-demand and physical-fulfilment facts.
--
-- This migration is additive. It does not infer an actually fulfilled physical
-- SKU from the default Ordermentum mapping or from aggregated pick/day-state
-- data. Physical fulfilment exists only after an explicit, idempotent command
-- records it in the operational allocation ledger.
--
-- No production backfill is executed by this migration. The service-only
-- refresh function must be invoked separately after data-volume review.

begin;

do $preflight$
declare
  v_missing text[] := array[]::text[];
begin
  if to_regclass('analytics.metric_definition') is null then
    v_missing := array_append(v_missing, 'analytics.metric_definition');
  end if;
  if to_regclass('analytics.refresh_status') is null then
    v_missing := array_append(v_missing, 'analytics.refresh_status');
  end if;
  if to_regclass('analytics.dim_commercial_sku') is null then
    v_missing := array_append(v_missing, 'analytics.dim_commercial_sku');
  end if;
  if to_regclass('analytics.dim_physical_sku') is null then
    v_missing := array_append(v_missing, 'analytics.dim_physical_sku');
  end if;
  if to_regclass('public.v_ecoflow_ordermentum_order_lines') is null then
    v_missing := array_append(v_missing, 'public.v_ecoflow_ordermentum_order_lines');
  end if;
  if to_regclass('public.ecoflow_ordermentum_internal_orders') is null then
    v_missing := array_append(v_missing, 'public.ecoflow_ordermentum_internal_orders');
  end if;
  if to_regclass('public.ordermentum_raw_orders') is null then
    v_missing := array_append(v_missing, 'public.ordermentum_raw_orders');
  end if;
  if to_regclass('public.ecoflow_sku_barcode_confirmations') is null then
    v_missing := array_append(v_missing, 'public.ecoflow_sku_barcode_confirmations');
  end if;
  if to_regclass('public.skus') is null then
    v_missing := array_append(v_missing, 'public.skus');
  end if;
  if to_regprocedure('public.ecoflow_active_app_role()') is null then
    v_missing := array_append(v_missing, 'public.ecoflow_active_app_role()');
  end if;
  if to_regprocedure('gen_random_uuid()') is null then
    v_missing := array_append(v_missing, 'gen_random_uuid()');
  end if;

  if cardinality(v_missing) > 0 then
    raise exception 'ORDER_FULFILMENT_FACT_PREREQUISITES_MISSING: %',
      array_to_string(v_missing, ', ');
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- Operational authority: one explicit physical-SKU allocation for one source
-- commercial order line. Default mappings and pick summaries are not evidence
-- of actual fulfilment.
-- ---------------------------------------------------------------------------

create table public.ecoflow_order_fulfilment_allocations (
  id uuid primary key default gen_random_uuid(),
  source_event_key text not null unique,
  source_system text not null default 'ORDERMENTUM',
  source_order_key text not null,
  source_order_line_id text not null,
  source_order_line_key text not null,
  internal_order_id uuid not null
    references public.ecoflow_ordermentum_internal_orders(id) on delete restrict,
  commercial_sku_code text not null,
  commercial_product_name text not null,
  ordered_quantity numeric(14,4) not null,
  ordered_unit text not null,
  physical_sku_id uuid not null references public.skus(id) on delete restrict,
  physical_sku_code text not null,
  physical_product_name text not null,
  fulfilled_quantity numeric(14,4) not null,
  fulfilled_unit text not null,
  actual_unit_cost numeric(14,4),
  currency_code text not null default 'AUD',
  allocation_type text not null,
  substitution_reason text,
  approved_equivalence_context jsonb not null default '{}'::jsonb,
  warehouse_location_code text,
  allocation_status text not null default 'ACTIVE',
  occurred_at timestamptz not null,
  actor_user_id uuid,
  actor_label text,
  voided_at timestamptz,
  voided_by_user_id uuid,
  void_reason text,
  revision bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint order_fulfilment_event_key_not_blank
    check (btrim(source_event_key) <> ''),
  constraint order_fulfilment_source_order_not_blank
    check (btrim(source_order_key) <> ''),
  constraint order_fulfilment_source_line_not_blank
    check (
      btrim(source_order_line_id) <> ''
      and btrim(source_order_line_key) <> ''
    ),
  constraint order_fulfilment_commercial_snapshot_not_blank
    check (
      btrim(commercial_sku_code) <> ''
      and btrim(commercial_product_name) <> ''
    ),
  constraint order_fulfilment_physical_snapshot_not_blank
    check (
      btrim(physical_sku_code) <> ''
      and btrim(physical_product_name) <> ''
    ),
  constraint order_fulfilment_ordered_quantity_positive
    check (ordered_quantity > 0),
  constraint order_fulfilment_fulfilled_quantity_positive
    check (fulfilled_quantity > 0),
  constraint order_fulfilment_unit_not_blank
    check (btrim(ordered_unit) <> '' and btrim(fulfilled_unit) <> ''),
  constraint order_fulfilment_cost_nonnegative
    check (actual_unit_cost is null or actual_unit_cost >= 0),
  constraint order_fulfilment_currency_format
    check (currency_code ~ '^[A-Z]{3}$'),
  constraint order_fulfilment_allocation_type
    check (allocation_type in (
      'PRIMARY',
      'APPROVED_SUBSTITUTE',
      'TEMPORARY_SUBSTITUTE',
      'UNAPPROVED_SUBSTITUTE'
    )),
  constraint order_fulfilment_substitution_reason_required
    check (
      allocation_type = 'PRIMARY'
      or nullif(btrim(coalesce(substitution_reason, '')), '') is not null
    ),
  constraint order_fulfilment_status
    check (allocation_status in ('ACTIVE','VOIDED')),
  constraint order_fulfilment_void_state
    check (
      (
        allocation_status = 'ACTIVE'
        and voided_at is null
        and void_reason is null
      )
      or (
        allocation_status = 'VOIDED'
        and voided_at is not null
        and nullif(btrim(coalesce(void_reason, '')), '') is not null
      )
    ),
  constraint order_fulfilment_revision_positive check (revision > 0)
);

create index order_fulfilment_allocations_source_line
  on public.ecoflow_order_fulfilment_allocations(
    source_system,source_order_line_key,occurred_at
  );

create index order_fulfilment_allocations_physical_sku
  on public.ecoflow_order_fulfilment_allocations(
    physical_sku_id,occurred_at
  );

create index order_fulfilment_allocations_active
  on public.ecoflow_order_fulfilment_allocations(
    source_order_line_key,occurred_at
  )
  where allocation_status = 'ACTIVE';

alter table public.ecoflow_order_fulfilment_allocations enable row level security;

revoke all on table public.ecoflow_order_fulfilment_allocations
  from public,anon,authenticated,service_role;
grant select on table public.ecoflow_order_fulfilment_allocations to service_role;

create or replace function public.ecoflow_touch_order_fulfilment_allocation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := clock_timestamp();
  new.revision := old.revision + 1;
  return new;
end;
$$;

revoke all on function public.ecoflow_touch_order_fulfilment_allocation()
  from public,anon,authenticated,service_role;

create trigger touch_ecoflow_order_fulfilment_allocation
before update on public.ecoflow_order_fulfilment_allocations
for each row execute function public.ecoflow_touch_order_fulfilment_allocation();

create or replace function public.ecoflow_record_order_fulfilment_allocation(
  p_source_event_key text,
  p_external_order_id text,
  p_source_order_line_id text,
  p_physical_sku_id uuid,
  p_fulfilled_quantity numeric,
  p_fulfilled_unit text,
  p_allocation_type text,
  p_actual_unit_cost numeric default null,
  p_substitution_reason text default null,
  p_approved_equivalence_context jsonb default '{}'::jsonb,
  p_warehouse_location_code text default null,
  p_occurred_at timestamptz default clock_timestamp(),
  p_actor_user_id uuid default null,
  p_actor_label text default null
)
returns table(
  allocation_id uuid,
  replayed boolean,
  allocation_status text,
  revision bigint
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_existing public.ecoflow_order_fulfilment_allocations%rowtype;
  v_internal_order_id uuid;
  v_source_order_key text;
  v_source_line_id text;
  v_source_line_key text;
  v_commercial_sku_code text;
  v_commercial_product_name text;
  v_ordered_quantity numeric(14,4);
  v_ordered_unit text;
  v_source_line_status text;
  v_physical_sku_code text;
  v_physical_product_name text;
  v_fulfilled_unit text;
  v_allocation_type text;
  v_existing_active_quantity numeric(14,4);
  v_id uuid;
begin
  if nullif(btrim(coalesce(p_source_event_key, '')), '') is null then
    raise exception 'FULFILMENT_EVENT_KEY_REQUIRED';
  end if;
  if nullif(btrim(coalesce(p_external_order_id, '')), '') is null then
    raise exception 'FULFILMENT_EXTERNAL_ORDER_ID_REQUIRED';
  end if;
  if nullif(btrim(coalesce(p_source_order_line_id, '')), '') is null then
    raise exception 'FULFILMENT_SOURCE_LINE_ID_REQUIRED';
  end if;
  if p_physical_sku_id is null then
    raise exception 'FULFILMENT_PHYSICAL_SKU_REQUIRED';
  end if;
  if coalesce(p_fulfilled_quantity, 0) <= 0 then
    raise exception 'FULFILMENT_QUANTITY_MUST_BE_POSITIVE';
  end if;

  v_fulfilled_unit := upper(btrim(coalesce(p_fulfilled_unit, '')));
  if v_fulfilled_unit = '' then
    raise exception 'FULFILMENT_UNIT_REQUIRED';
  end if;

  v_allocation_type := upper(btrim(coalesce(p_allocation_type, '')));
  if v_allocation_type not in (
    'PRIMARY','APPROVED_SUBSTITUTE','TEMPORARY_SUBSTITUTE','UNAPPROVED_SUBSTITUTE'
  ) then
    raise exception 'FULFILMENT_ALLOCATION_TYPE_INVALID: %',v_allocation_type;
  end if;
  if v_allocation_type <> 'PRIMARY'
     and nullif(btrim(coalesce(p_substitution_reason, '')), '') is null then
    raise exception 'FULFILMENT_SUBSTITUTION_REASON_REQUIRED';
  end if;
  if p_actual_unit_cost is not null and p_actual_unit_cost < 0 then
    raise exception 'FULFILMENT_UNIT_COST_INVALID';
  end if;

  select a.*
  into v_existing
  from public.ecoflow_order_fulfilment_allocations a
  where a.source_event_key = btrim(p_source_event_key);

  if found then
    if v_existing.source_order_key is distinct from btrim(p_external_order_id)
       or v_existing.source_order_line_id is distinct from btrim(p_source_order_line_id)
       or v_existing.physical_sku_id is distinct from p_physical_sku_id
       or v_existing.fulfilled_quantity is distinct from p_fulfilled_quantity
       or v_existing.fulfilled_unit is distinct from v_fulfilled_unit
       or v_existing.allocation_type is distinct from v_allocation_type
       or v_existing.actual_unit_cost is distinct from p_actual_unit_cost
       or v_existing.substitution_reason is distinct from nullif(btrim(coalesce(p_substitution_reason,'')),'')
       or v_existing.approved_equivalence_context is distinct from coalesce(p_approved_equivalence_context,'{}'::jsonb)
       or v_existing.warehouse_location_code is distinct from nullif(btrim(coalesce(p_warehouse_location_code,'')),'') then
      raise exception 'FULFILMENT_EVENT_KEY_CONFLICT: %',btrim(p_source_event_key);
    end if;

    return query
    select v_existing.id,true,v_existing.allocation_status,v_existing.revision;
    return;
  end if;

  select
    io.id,
    l.external_order_id,
    l.line_id,
    l.sku,
    l.name,
    l.quantity,
    upper(btrim(coalesce(nullif(l.unit,''),nullif(l.uom,''),'UNSPECIFIED'))),
    bc.status
  into
    v_internal_order_id,
    v_source_order_key,
    v_source_line_id,
    v_commercial_sku_code,
    v_commercial_product_name,
    v_ordered_quantity,
    v_ordered_unit,
    v_source_line_status
  from public.v_ecoflow_ordermentum_order_lines l
  join public.ecoflow_ordermentum_internal_orders io
    on io.source_provider = 'ORDERMENTUM'
   and io.external_order_id = l.external_order_id
  left join public.ecoflow_sku_barcode_confirmations bc
    on bc.provider='ORDERMENTUM'
   and bc.external_sku_code=l.sku
  where l.external_order_id = btrim(p_external_order_id)
    and l.line_id = btrim(p_source_order_line_id)
  order by io.updated_at desc
  limit 1;

  if v_internal_order_id is null then
    raise exception 'FULFILMENT_INTERNALISED_SOURCE_LINE_NOT_FOUND: %:%',
      btrim(p_external_order_id),btrim(p_source_order_line_id);
  end if;
  if v_source_line_status='SERVICE_ITEM' then
    raise exception 'FULFILMENT_SERVICE_LINE_NOT_PHYSICAL: %:%',
      btrim(p_external_order_id),btrim(p_source_order_line_id);
  end if;
  if coalesce(v_ordered_quantity,0) <= 0 then
    raise exception 'FULFILMENT_SOURCE_ORDERED_QUANTITY_INVALID: %',
      coalesce(v_ordered_quantity,0);
  end if;
  if v_fulfilled_unit <> v_ordered_unit then
    raise exception 'FULFILMENT_UNIT_CONVERSION_REQUIRED: ordered %, fulfilled %',
      v_ordered_unit,v_fulfilled_unit;
  end if;

  select s.sku_code,coalesce(nullif(btrim(s.display_name),''),s.sku_code)
  into v_physical_sku_code,v_physical_product_name
  from public.skus s
  where s.id = p_physical_sku_id;

  if v_physical_sku_code is null then
    raise exception 'FULFILMENT_PHYSICAL_SKU_NOT_FOUND: %',p_physical_sku_id;
  end if;

  v_source_line_key := v_source_order_key || ':' || v_source_line_id;

  -- Serialise active quantity checks for this source line so concurrent service
  -- calls cannot both pass the ordered-quantity ceiling.
  perform pg_advisory_xact_lock(hashtext(v_source_line_key));

  select coalesce(sum(a.fulfilled_quantity),0)
  into v_existing_active_quantity
  from public.ecoflow_order_fulfilment_allocations a
  where a.source_system = 'ORDERMENTUM'
    and a.source_order_line_key = v_source_line_key
    and a.allocation_status = 'ACTIVE';

  if v_existing_active_quantity + p_fulfilled_quantity > v_ordered_quantity then
    raise exception 'FULFILMENT_QUANTITY_EXCEEDS_ORDERED: ordered %, active %, requested %',
      v_ordered_quantity,v_existing_active_quantity,p_fulfilled_quantity;
  end if;

  insert into public.ecoflow_order_fulfilment_allocations(
    source_event_key,
    source_system,
    source_order_key,
    source_order_line_id,
    source_order_line_key,
    internal_order_id,
    commercial_sku_code,
    commercial_product_name,
    ordered_quantity,
    ordered_unit,
    physical_sku_id,
    physical_sku_code,
    physical_product_name,
    fulfilled_quantity,
    fulfilled_unit,
    actual_unit_cost,
    currency_code,
    allocation_type,
    substitution_reason,
    approved_equivalence_context,
    warehouse_location_code,
    allocation_status,
    occurred_at,
    actor_user_id,
    actor_label
  )
  values(
    btrim(p_source_event_key),
    'ORDERMENTUM',
    v_source_order_key,
    v_source_line_id,
    v_source_line_key,
    v_internal_order_id,
    v_commercial_sku_code,
    v_commercial_product_name,
    v_ordered_quantity,
    v_ordered_unit,
    p_physical_sku_id,
    v_physical_sku_code,
    v_physical_product_name,
    p_fulfilled_quantity,
    v_fulfilled_unit,
    p_actual_unit_cost,
    'AUD',
    v_allocation_type,
    nullif(btrim(coalesce(p_substitution_reason,'')),''),
    coalesce(p_approved_equivalence_context,'{}'::jsonb),
    nullif(btrim(coalesce(p_warehouse_location_code,'')),''),
    'ACTIVE',
    coalesce(p_occurred_at,clock_timestamp()),
    p_actor_user_id,
    nullif(btrim(coalesce(p_actor_label,'')),'')
  )
  returning id into v_id;

  return query
  select v_id,false,'ACTIVE'::text,1::bigint;
end;
$$;

revoke all on function public.ecoflow_record_order_fulfilment_allocation(
  text,text,text,uuid,numeric,text,text,numeric,text,jsonb,text,timestamptz,uuid,text
) from public,anon,authenticated;
grant execute on function public.ecoflow_record_order_fulfilment_allocation(
  text,text,text,uuid,numeric,text,text,numeric,text,jsonb,text,timestamptz,uuid,text
) to service_role;

create or replace function public.ecoflow_void_order_fulfilment_allocation(
  p_allocation_id uuid,
  p_void_reason text,
  p_actor_user_id uuid default null
)
returns table(
  allocation_id uuid,
  allocation_status text,
  revision bigint
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.ecoflow_order_fulfilment_allocations%rowtype;
begin
  if p_allocation_id is null then
    raise exception 'FULFILMENT_ALLOCATION_ID_REQUIRED';
  end if;
  if nullif(btrim(coalesce(p_void_reason,'')),'') is null then
    raise exception 'FULFILMENT_VOID_REASON_REQUIRED';
  end if;

  select *
  into v_row
  from public.ecoflow_order_fulfilment_allocations
  where id = p_allocation_id
  for update;

  if not found then
    raise exception 'FULFILMENT_ALLOCATION_NOT_FOUND: %',p_allocation_id;
  end if;

  if v_row.allocation_status = 'VOIDED' then
    return query select v_row.id,v_row.allocation_status,v_row.revision;
    return;
  end if;

  update public.ecoflow_order_fulfilment_allocations
  set allocation_status='VOIDED',
      voided_at=clock_timestamp(),
      voided_by_user_id=p_actor_user_id,
      void_reason=btrim(p_void_reason)
  where id=p_allocation_id
  returning * into v_row;

  return query select v_row.id,v_row.allocation_status,v_row.revision;
end;
$$;

revoke all on function public.ecoflow_void_order_fulfilment_allocation(
  uuid,text,uuid
) from public,anon,authenticated;
grant execute on function public.ecoflow_void_order_fulfilment_allocation(
  uuid,text,uuid
) to service_role;

-- ---------------------------------------------------------------------------
-- Versioned analytics facts. These are not browser-readable projections.
-- ---------------------------------------------------------------------------

create table analytics.fact_order_line (
  order_line_fact_id bigint generated always as identity primary key,
  source_system text not null,
  source_order_key text not null,
  source_order_line_id text not null,
  source_order_line_key text not null,
  internal_order_id uuid,
  raw_order_id uuid,
  external_order_number text,
  invoice_number text,
  requested_delivery_date date,
  order_created_at timestamptz,
  order_updated_at timestamptz,
  order_status text,
  payment_status text,
  commercial_sku_dimension_id bigint
    references analytics.dim_commercial_sku(commercial_sku_dimension_id),
  source_commercial_sku_key text not null,
  commercial_sku_code text not null,
  commercial_product_name text not null,
  ordered_quantity numeric(14,4) not null,
  ordered_unit text not null,
  unit_price numeric(14,4),
  line_subtotal numeric(14,4),
  line_tax numeric(14,4),
  line_total numeric(14,4),
  line_type text not null,
  source_last_synced_at timestamptz,
  source_version_hash text not null,
  quality_status text not null,
  effective_from timestamptz not null,
  effective_to timestamptz,
  is_current boolean not null default true,
  first_observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  as_of_at timestamptz not null,
  constraint fact_order_line_source_key_not_blank check (
    btrim(source_order_key) <> ''
    and btrim(source_order_line_id) <> ''
    and btrim(source_order_line_key) <> ''
  ),
  constraint fact_order_line_commercial_not_blank check (
    btrim(source_commercial_sku_key) <> ''
    and btrim(commercial_sku_code) <> ''
    and btrim(commercial_product_name) <> ''
  ),
  constraint fact_order_line_quantity_positive check (ordered_quantity > 0),
  constraint fact_order_line_unit_not_blank check (btrim(ordered_unit) <> ''),
  constraint fact_order_line_type check (line_type in ('STOCK','SERVICE')),
  constraint fact_order_line_hash_format check (source_version_hash ~ '^[0-9a-f]{64}$'),
  constraint fact_order_line_quality check (
    quality_status in ('TRUSTED','DEGRADED','INVALID')
  ),
  constraint fact_order_line_effective_state check (
    (is_current and effective_to is null)
    or (not is_current and effective_to is not null and effective_to >= effective_from)
  ),
  constraint fact_order_line_observation_order check (
    last_observed_at >= first_observed_at
  )
);

create unique index fact_order_line_one_current
  on analytics.fact_order_line(source_system,source_order_line_key)
  where is_current;

create index fact_order_line_order
  on analytics.fact_order_line(source_system,source_order_key,is_current);

create index fact_order_line_delivery_date
  on analytics.fact_order_line(requested_delivery_date,is_current);

create table analytics.fact_fulfilment_line (
  fulfilment_line_fact_id bigint generated always as identity primary key,
  allocation_id uuid not null unique,
  source_system text not null,
  source_order_key text not null,
  source_order_line_id text not null,
  source_order_line_key text not null,
  internal_order_id uuid,
  commercial_sku_dimension_id bigint
    references analytics.dim_commercial_sku(commercial_sku_dimension_id),
  source_commercial_sku_key text not null,
  commercial_sku_code text not null,
  commercial_product_name text not null,
  physical_sku_dimension_id bigint
    references analytics.dim_physical_sku(physical_sku_dimension_id),
  source_physical_sku_key text not null,
  physical_sku_code text not null,
  physical_product_name text not null,
  fulfilled_quantity numeric(14,4) not null,
  fulfilled_unit text not null,
  actual_unit_cost numeric(14,4),
  currency_code text not null,
  allocation_type text not null,
  substitution_flag boolean not null,
  substitution_reason text,
  approved_equivalence_context jsonb not null,
  warehouse_location_code text,
  allocation_status text not null,
  occurred_at timestamptz not null,
  actor_user_id uuid,
  actor_label text,
  source_revision bigint not null,
  source_row_hash text not null,
  first_observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  as_of_at timestamptz not null,
  constraint fact_fulfilment_source_key_not_blank check (
    btrim(source_order_key) <> ''
    and btrim(source_order_line_id) <> ''
    and btrim(source_order_line_key) <> ''
  ),
  constraint fact_fulfilment_sku_not_blank check (
    btrim(commercial_sku_code) <> ''
    and btrim(physical_sku_code) <> ''
  ),
  constraint fact_fulfilment_quantity_positive check (fulfilled_quantity > 0),
  constraint fact_fulfilment_unit_not_blank check (btrim(fulfilled_unit) <> ''),
  constraint fact_fulfilment_cost_nonnegative check (
    actual_unit_cost is null or actual_unit_cost >= 0
  ),
  constraint fact_fulfilment_currency_format check (currency_code ~ '^[A-Z]{3}$'),
  constraint fact_fulfilment_allocation_type check (allocation_type in (
    'PRIMARY',
    'APPROVED_SUBSTITUTE',
    'TEMPORARY_SUBSTITUTE',
    'UNAPPROVED_SUBSTITUTE'
  )),
  constraint fact_fulfilment_substitution_consistency check (
    substitution_flag = (allocation_type <> 'PRIMARY')
  ),
  constraint fact_fulfilment_status check (
    allocation_status in ('ACTIVE','VOIDED')
  ),
  constraint fact_fulfilment_revision_positive check (source_revision > 0),
  constraint fact_fulfilment_hash_format check (source_row_hash ~ '^[0-9a-f]{64}$'),
  constraint fact_fulfilment_observation_order check (
    last_observed_at >= first_observed_at
  )
);

create index fact_fulfilment_source_line
  on analytics.fact_fulfilment_line(
    source_system,source_order_line_key,allocation_status
  );

create index fact_fulfilment_physical_sku
  on analytics.fact_fulfilment_line(
    physical_sku_dimension_id,occurred_at
  );

alter table analytics.fact_order_line enable row level security;
alter table analytics.fact_fulfilment_line enable row level security;

revoke all on table analytics.fact_order_line
  from public,anon,authenticated,service_role;
revoke all on table analytics.fact_fulfilment_line
  from public,anon,authenticated,service_role;
grant select on table analytics.fact_order_line to service_role;
grant select on table analytics.fact_fulfilment_line to service_role;

create or replace view analytics.v_order_fulfilment_coverage
with (security_barrier = true, security_invoker = true)
as
with fulfilled as (
  select
    source_system,
    source_order_line_key,
    sum(fulfilled_quantity) filter (
      where allocation_status='ACTIVE'
    )::numeric(14,4) as active_fulfilled_quantity,
    sum(fulfilled_quantity) filter (
      where allocation_status='ACTIVE' and substitution_flag
    )::numeric(14,4) as active_substituted_quantity,
    count(*) filter (
      where allocation_status='ACTIVE'
    )::integer as active_allocation_count,
    count(*) filter (
      where allocation_status='VOIDED'
    )::integer as voided_allocation_count,
    max(as_of_at) as fulfilment_as_of_at
  from analytics.fact_fulfilment_line
  group by source_system,source_order_line_key
)
select
  o.order_line_fact_id,
  o.source_system,
  o.source_order_key,
  o.source_order_line_id,
  o.source_order_line_key,
  o.external_order_number,
  o.invoice_number,
  o.requested_delivery_date,
  o.commercial_sku_code,
  o.commercial_product_name,
  o.ordered_quantity,
  o.ordered_unit,
  coalesce(f.active_fulfilled_quantity,0)::numeric(14,4)
    as active_fulfilled_quantity,
  coalesce(f.active_substituted_quantity,0)::numeric(14,4)
    as active_substituted_quantity,
  coalesce(f.active_allocation_count,0) as active_allocation_count,
  coalesce(f.voided_allocation_count,0) as voided_allocation_count,
  case
    when coalesce(f.active_fulfilled_quantity,0)=0 then 'MISSING'
    when f.active_fulfilled_quantity < o.ordered_quantity then 'PARTIAL'
    when f.active_fulfilled_quantity = o.ordered_quantity then 'FULL'
    else 'OVERFULFILLED'
  end as coverage_status,
  o.as_of_at as order_as_of_at,
  f.fulfilment_as_of_at
from analytics.fact_order_line o
left join fulfilled f
  on f.source_system=o.source_system
 and f.source_order_line_key=o.source_order_line_key
where o.is_current;

revoke all on table analytics.v_order_fulfilment_coverage
  from public,anon,authenticated;
grant select on table analytics.v_order_fulfilment_coverage to service_role;

-- ---------------------------------------------------------------------------
-- Controlled refresh. It is intentionally not called by the migration.
-- ---------------------------------------------------------------------------

create or replace function analytics.refresh_order_fulfilment_facts(
  p_as_of timestamptz default clock_timestamp()
)
returns table(
  dataset_key text,
  refreshed_row_count bigint,
  refresh_state text
)
language plpgsql
security definer
set search_path = pg_catalog,analytics,public
as $$
declare
  v_as_of timestamptz := coalesce(p_as_of,clock_timestamp());
  v_order_count bigint := 0;
  v_fulfilment_count bigint := 0;
  v_error text;
begin
  -- One controlled semantic refresh at a time.
  perform pg_advisory_xact_lock(hashtext('analytics.refresh_order_fulfilment_facts'));

  insert into analytics.refresh_status(
    dataset_key,source_system,source_object,status,last_started_at,freshness_sla,
    visible_to_roles,updated_at
  )
  values
    (
      'analytics.order_lines','ECOFLOW',
      'analytics.fact_order_line','REFRESHING',v_as_of,interval '15 minutes',
      array['OWNER','ADMIN','ACCOUNT','VIEWER','WAREHOUSE']::text[],v_as_of
    ),
    (
      'analytics.fulfilment_lines','ECOFLOW',
      'analytics.fact_fulfilment_line','REFRESHING',v_as_of,interval '5 minutes',
      array['OWNER','ADMIN','ACCOUNT','VIEWER','WAREHOUSE']::text[],v_as_of
    )
  on conflict on constraint refresh_status_pkey do update
  set status='REFRESHING',
      last_started_at=excluded.last_started_at,
      error_code=null,
      error_message=null,
      updated_at=excluded.updated_at;

  begin
    create temporary table if not exists pg_temp.ecoflow_order_fact_source(
      source_system text,
      source_order_key text,
      source_order_line_id text,
      source_order_line_key text,
      internal_order_id uuid,
      raw_order_id uuid,
      external_order_number text,
      invoice_number text,
      requested_delivery_date date,
      order_created_at timestamptz,
      order_updated_at timestamptz,
      order_status text,
      payment_status text,
      source_commercial_sku_key text,
      commercial_sku_code text,
      commercial_product_name text,
      ordered_quantity numeric(14,4),
      ordered_unit text,
      unit_price numeric(14,4),
      line_subtotal numeric(14,4),
      line_tax numeric(14,4),
      line_total numeric(14,4),
      line_type text,
      source_last_synced_at timestamptz,
      source_version_hash text,
      quality_status text
    ) on commit drop;

    truncate table pg_temp.ecoflow_order_fact_source;

    insert into pg_temp.ecoflow_order_fact_source
    select
      'ORDERMENTUM'::text,
      l.external_order_id,
      l.line_id,
      l.external_order_id || ':' || l.line_id,
      io.id,
      io.raw_order_id,
      coalesce(io.external_order_number,io.order_number,l.order_number),
      coalesce(io.invoice_number,l.invoice_number),
      case
        when coalesce(to_jsonb(r)->>'delivery_date','')
          ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
          then left(to_jsonb(r)->>'delivery_date',10)::date
        else null
      end,
      r.external_created_at,
      r.external_updated_at,
      r.status,
      coalesce(r.payment_status,io.payment_status,io.invoice_payment_status),
      l.sku,
      l.sku,
      l.name,
      l.quantity::numeric(14,4),
      upper(btrim(coalesce(nullif(l.unit,''),nullif(l.uom,''),'UNSPECIFIED'))),
      l.price::numeric(14,4),
      l.subtotal::numeric(14,4),
      coalesce(l.gst,l.tax)::numeric(14,4),
      l.total::numeric(14,4),
      case when bc.status='SERVICE_ITEM' then 'SERVICE' else 'STOCK' end,
      greatest(r.last_synced_at,io.last_synced_at),
      encode(
        digest(
          jsonb_build_array(
            l.external_order_id,
            l.line_id,
            coalesce(io.external_order_number,io.order_number,l.order_number),
            coalesce(io.invoice_number,l.invoice_number),
            case
              when coalesce(to_jsonb(r)->>'delivery_date','')
                ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
                then left(to_jsonb(r)->>'delivery_date',10)::date
              else null
            end,
            r.external_created_at,
            r.external_updated_at,
            r.status,
            coalesce(r.payment_status,io.payment_status,io.invoice_payment_status),
            l.sku,
            l.name,
            l.quantity,
            upper(btrim(coalesce(nullif(l.unit,''),nullif(l.uom,''),'UNSPECIFIED'))),
            l.price,
            l.subtotal,
            coalesce(l.gst,l.tax),
            l.total,
            case when bc.status='SERVICE_ITEM' then 'SERVICE' else 'STOCK' end
          )::text,
          'sha256'
        ),
        'hex'
      ),
      case
        when l.external_order_id is null
          or l.line_id is null
          or l.quantity is null
          or l.quantity <= 0
          or l.sku is null
          then 'INVALID'
        when r.last_synced_at is null
          or r.external_updated_at is null
          then 'DEGRADED'
        else 'TRUSTED'
      end
    from public.v_ecoflow_ordermentum_order_lines l
    join lateral (
      select i.*
      from public.ecoflow_ordermentum_internal_orders i
      where i.source_provider='ORDERMENTUM'
        and i.external_order_id=l.external_order_id
      order by i.updated_at desc
      limit 1
    ) io on true
    left join public.ordermentum_raw_orders r
      on r.id=io.raw_order_id
    left join public.ecoflow_sku_barcode_confirmations bc
      on bc.provider='ORDERMENTUM'
     and bc.external_sku_code=l.sku
    where l.external_order_id is not null
      and l.line_id is not null
      and l.sku is not null
      and l.quantity > 0;

    with latest as (
      select distinct on (source_commercial_sku_key)
        source_commercial_sku_key,
        commercial_sku_code,
        commercial_product_name,
        ordered_unit,
        order_updated_at
      from pg_temp.ecoflow_order_fact_source
      order by source_commercial_sku_key,order_updated_at desc nulls last
    )
    update analytics.dim_commercial_sku d
    set effective_to=v_as_of,
        is_current=false,
        updated_at=v_as_of
    from latest s
    where d.source_system='ORDERMENTUM'
      and d.source_commercial_sku_key=s.source_commercial_sku_key
      and d.is_current
      and (
        d.commercial_sku_code is distinct from s.commercial_sku_code
        or d.product_name is distinct from s.commercial_product_name
        or d.sales_unit is distinct from s.ordered_unit
      );

    with latest as (
      select distinct on (source_commercial_sku_key)
        source_commercial_sku_key,
        commercial_sku_code,
        commercial_product_name,
        ordered_unit,
        order_updated_at
      from pg_temp.ecoflow_order_fact_source
      order by source_commercial_sku_key,order_updated_at desc nulls last
    )
    insert into analytics.dim_commercial_sku(
      source_system,source_commercial_sku_key,commercial_sku_code,product_name,
      sales_unit,active,effective_from,is_current,source_updated_at,recorded_by
    )
    select
      'ORDERMENTUM',
      s.source_commercial_sku_key,
      s.commercial_sku_code,
      s.commercial_product_name,
      s.ordered_unit,
      true,
      v_as_of,
      true,
      s.order_updated_at,
      'analytics.refresh_order_fulfilment_facts'
    from latest s
    where not exists(
      select 1
      from analytics.dim_commercial_sku d
      where d.source_system='ORDERMENTUM'
        and d.source_commercial_sku_key=s.source_commercial_sku_key
        and d.is_current
    );

    update analytics.fact_order_line f
    set effective_to=v_as_of,
        is_current=false,
        last_observed_at=v_as_of,
        as_of_at=v_as_of
    from pg_temp.ecoflow_order_fact_source s
    where f.source_system=s.source_system
      and f.source_order_line_key=s.source_order_line_key
      and f.is_current
      and f.source_version_hash<>s.source_version_hash;

    update analytics.fact_order_line f
    set last_observed_at=v_as_of,
        as_of_at=v_as_of,
        source_last_synced_at=s.source_last_synced_at,
        quality_status=s.quality_status
    from pg_temp.ecoflow_order_fact_source s
    where f.source_system=s.source_system
      and f.source_order_line_key=s.source_order_line_key
      and f.is_current
      and f.source_version_hash=s.source_version_hash;

    insert into analytics.fact_order_line(
      source_system,source_order_key,source_order_line_id,source_order_line_key,
      internal_order_id,raw_order_id,external_order_number,invoice_number,
      requested_delivery_date,order_created_at,order_updated_at,order_status,
      payment_status,commercial_sku_dimension_id,source_commercial_sku_key,
      commercial_sku_code,commercial_product_name,ordered_quantity,ordered_unit,
      unit_price,line_subtotal,line_tax,line_total,line_type,source_last_synced_at,
      source_version_hash,quality_status,effective_from,effective_to,is_current,
      first_observed_at,last_observed_at,as_of_at
    )
    select
      s.source_system,s.source_order_key,s.source_order_line_id,
      s.source_order_line_key,s.internal_order_id,s.raw_order_id,
      s.external_order_number,s.invoice_number,s.requested_delivery_date,
      s.order_created_at,s.order_updated_at,s.order_status,s.payment_status,
      d.commercial_sku_dimension_id,s.source_commercial_sku_key,
      s.commercial_sku_code,s.commercial_product_name,s.ordered_quantity,
      s.ordered_unit,s.unit_price,s.line_subtotal,s.line_tax,s.line_total,
      s.line_type,s.source_last_synced_at,s.source_version_hash,s.quality_status,
      v_as_of,null,true,v_as_of,v_as_of,v_as_of
    from pg_temp.ecoflow_order_fact_source s
    left join analytics.dim_commercial_sku d
      on d.source_system='ORDERMENTUM'
     and d.source_commercial_sku_key=s.source_commercial_sku_key
     and d.is_current
    where not exists(
      select 1
      from analytics.fact_order_line f
      where f.source_system=s.source_system
        and f.source_order_line_key=s.source_order_line_key
        and f.is_current
        and f.source_version_hash=s.source_version_hash
    );

    create temporary table if not exists pg_temp.ecoflow_fulfilment_fact_source(
      allocation_id uuid,
      source_system text,
      source_order_key text,
      source_order_line_id text,
      source_order_line_key text,
      internal_order_id uuid,
      source_commercial_sku_key text,
      commercial_sku_code text,
      commercial_product_name text,
      source_physical_sku_key text,
      physical_sku_code text,
      physical_product_name text,
      fulfilled_quantity numeric(14,4),
      fulfilled_unit text,
      actual_unit_cost numeric(14,4),
      currency_code text,
      allocation_type text,
      substitution_flag boolean,
      substitution_reason text,
      approved_equivalence_context jsonb,
      warehouse_location_code text,
      allocation_status text,
      occurred_at timestamptz,
      actor_user_id uuid,
      actor_label text,
      source_revision bigint,
      source_row_hash text
    ) on commit drop;

    truncate table pg_temp.ecoflow_fulfilment_fact_source;

    insert into pg_temp.ecoflow_fulfilment_fact_source
    select
      a.id,a.source_system,a.source_order_key,a.source_order_line_id,
      a.source_order_line_key,a.internal_order_id,a.commercial_sku_code,
      a.commercial_sku_code,a.commercial_product_name,a.physical_sku_id::text,
      a.physical_sku_code,a.physical_product_name,a.fulfilled_quantity,
      a.fulfilled_unit,a.actual_unit_cost,a.currency_code,a.allocation_type,
      a.allocation_type<>'PRIMARY',a.substitution_reason,
      a.approved_equivalence_context,a.warehouse_location_code,
      a.allocation_status,a.occurred_at,a.actor_user_id,a.actor_label,a.revision,
      encode(
        digest(
          jsonb_build_array(
            a.id,a.source_order_line_key,a.physical_sku_id,a.physical_sku_code,
            a.fulfilled_quantity,a.fulfilled_unit,a.actual_unit_cost,
            a.currency_code,a.allocation_type,a.substitution_reason,
            a.approved_equivalence_context,a.warehouse_location_code,
            a.allocation_status,a.occurred_at,a.actor_user_id,a.actor_label,
            a.revision,a.voided_at,a.void_reason
          )::text,
          'sha256'
        ),
        'hex'
      )
    from public.ecoflow_order_fulfilment_allocations a;

    with latest as (
      select distinct on (source_physical_sku_key)
        source_physical_sku_key,physical_sku_code,physical_product_name,occurred_at
      from pg_temp.ecoflow_fulfilment_fact_source
      order by source_physical_sku_key,occurred_at desc
    )
    update analytics.dim_physical_sku d
    set effective_to=v_as_of,
        is_current=false,
        updated_at=v_as_of
    from latest s
    where d.source_system='ECOFLOW'
      and d.source_physical_sku_key=s.source_physical_sku_key
      and d.is_current
      and (
        d.physical_sku_code is distinct from s.physical_sku_code
        or d.product_name is distinct from s.physical_product_name
      );

    with latest as (
      select distinct on (source_physical_sku_key)
        source_physical_sku_key,physical_sku_code,physical_product_name,occurred_at
      from pg_temp.ecoflow_fulfilment_fact_source
      order by source_physical_sku_key,occurred_at desc
    )
    insert into analytics.dim_physical_sku(
      source_system,source_physical_sku_key,physical_sku_code,product_name,
      active,effective_from,is_current,source_updated_at,recorded_by
    )
    select
      'ECOFLOW',s.source_physical_sku_key,s.physical_sku_code,
      s.physical_product_name,true,v_as_of,true,s.occurred_at,
      'analytics.refresh_order_fulfilment_facts'
    from latest s
    where not exists(
      select 1
      from analytics.dim_physical_sku d
      where d.source_system='ECOFLOW'
        and d.source_physical_sku_key=s.source_physical_sku_key
        and d.is_current
    );

    insert into analytics.fact_fulfilment_line(
      allocation_id,source_system,source_order_key,source_order_line_id,
      source_order_line_key,internal_order_id,commercial_sku_dimension_id,
      source_commercial_sku_key,commercial_sku_code,commercial_product_name,
      physical_sku_dimension_id,source_physical_sku_key,physical_sku_code,
      physical_product_name,fulfilled_quantity,fulfilled_unit,actual_unit_cost,
      currency_code,allocation_type,substitution_flag,substitution_reason,
      approved_equivalence_context,warehouse_location_code,allocation_status,
      occurred_at,actor_user_id,actor_label,source_revision,source_row_hash,
      first_observed_at,last_observed_at,as_of_at
    )
    select
      s.allocation_id,s.source_system,s.source_order_key,s.source_order_line_id,
      s.source_order_line_key,s.internal_order_id,c.commercial_sku_dimension_id,
      s.source_commercial_sku_key,s.commercial_sku_code,
      s.commercial_product_name,p.physical_sku_dimension_id,
      s.source_physical_sku_key,s.physical_sku_code,s.physical_product_name,
      s.fulfilled_quantity,s.fulfilled_unit,s.actual_unit_cost,s.currency_code,
      s.allocation_type,s.substitution_flag,s.substitution_reason,
      s.approved_equivalence_context,s.warehouse_location_code,
      s.allocation_status,s.occurred_at,s.actor_user_id,s.actor_label,
      s.source_revision,s.source_row_hash,v_as_of,v_as_of,v_as_of
    from pg_temp.ecoflow_fulfilment_fact_source s
    left join analytics.dim_commercial_sku c
      on c.source_system='ORDERMENTUM'
     and c.source_commercial_sku_key=s.source_commercial_sku_key
     and c.is_current
    left join analytics.dim_physical_sku p
      on p.source_system='ECOFLOW'
     and p.source_physical_sku_key=s.source_physical_sku_key
     and p.is_current
    on conflict(allocation_id) do update
    set commercial_sku_dimension_id=excluded.commercial_sku_dimension_id,
        physical_sku_dimension_id=excluded.physical_sku_dimension_id,
        commercial_sku_code=excluded.commercial_sku_code,
        commercial_product_name=excluded.commercial_product_name,
        physical_sku_code=excluded.physical_sku_code,
        physical_product_name=excluded.physical_product_name,
        fulfilled_quantity=excluded.fulfilled_quantity,
        fulfilled_unit=excluded.fulfilled_unit,
        actual_unit_cost=excluded.actual_unit_cost,
        currency_code=excluded.currency_code,
        allocation_type=excluded.allocation_type,
        substitution_flag=excluded.substitution_flag,
        substitution_reason=excluded.substitution_reason,
        approved_equivalence_context=excluded.approved_equivalence_context,
        warehouse_location_code=excluded.warehouse_location_code,
        allocation_status=excluded.allocation_status,
        occurred_at=excluded.occurred_at,
        actor_user_id=excluded.actor_user_id,
        actor_label=excluded.actor_label,
        source_revision=excluded.source_revision,
        source_row_hash=excluded.source_row_hash,
        last_observed_at=v_as_of,
        as_of_at=v_as_of;

    select count(*) into v_order_count
    from analytics.fact_order_line
    where is_current;

    select count(*) into v_fulfilment_count
    from analytics.fact_fulfilment_line;

    update analytics.refresh_status rs
    set status='CURRENT',
        as_of_at=v_as_of,
        last_succeeded_at=v_as_of,
        row_count=v_order_count,
        error_code=null,
        error_message=null,
        updated_at=v_as_of
    where rs.dataset_key='analytics.order_lines';

    update analytics.refresh_status rs
    set status='CURRENT',
        as_of_at=v_as_of,
        last_succeeded_at=v_as_of,
        row_count=v_fulfilment_count,
        error_code=null,
        error_message=null,
        updated_at=v_as_of
    where rs.dataset_key='analytics.fulfilment_lines';

    return query values
      ('analytics.order_lines'::text,v_order_count,'CURRENT'::text),
      ('analytics.fulfilment_lines'::text,v_fulfilment_count,'CURRENT'::text);
  exception
    when others then
      v_error := sqlerrm;

      update analytics.refresh_status rs
      set status='FAILED',
          last_failed_at=clock_timestamp(),
          error_code=sqlstate,
          error_message=left(v_error,2000),
          updated_at=clock_timestamp()
      where rs.dataset_key in (
        'analytics.order_lines','analytics.fulfilment_lines'
      );

      return query values
        ('analytics.order_lines'::text,0::bigint,'FAILED'::text),
        ('analytics.fulfilment_lines'::text,0::bigint,'FAILED'::text);
  end;
end;
$$;

revoke all on function analytics.refresh_order_fulfilment_facts(timestamptz)
  from public,anon,authenticated;
grant execute on function analytics.refresh_order_fulfilment_facts(timestamptz)
  to service_role;

insert into analytics.refresh_status(
  dataset_key,source_system,source_object,status,freshness_sla,visible_to_roles
)
values
  (
    'analytics.order_lines','ECOFLOW','analytics.fact_order_line','NEVER',
    interval '15 minutes',
    array['OWNER','ADMIN','ACCOUNT','VIEWER','WAREHOUSE']::text[]
  ),
  (
    'analytics.fulfilment_lines','ECOFLOW','analytics.fact_fulfilment_line','NEVER',
    interval '5 minutes',
    array['OWNER','ADMIN','ACCOUNT','VIEWER','WAREHOUSE']::text[]
  )
on conflict(dataset_key) do nothing;

comment on table public.ecoflow_order_fulfilment_allocations is
  'Explicit, auditable physical-SKU fulfilment ledger. Default mappings and pick summaries are not treated as actual fulfilment.';
comment on table analytics.fact_order_line is
  'Versioned commercial demand fact at one accepted Ordermentum source line per version.';
comment on table analytics.fact_fulfilment_line is
  'One explicit physical-SKU allocation record projected from the operational fulfilment ledger.';
comment on view analytics.v_order_fulfilment_coverage is
  'Service-only comparison of current ordered quantity with active explicit physical fulfilment.';
comment on function analytics.refresh_order_fulfilment_facts(timestamptz) is
  'Service-only controlled refresh. Not invoked automatically by migration or browser clients.';

notify pgrst,'reload schema';

commit;
