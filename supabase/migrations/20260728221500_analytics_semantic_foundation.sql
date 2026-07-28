-- Establish the governed EcoFlow analytics semantic foundation.
-- Additive and read-only for browser roles: no operational state is moved or mutated here.

begin;

do $preflight$
declare
  v_missing text[] := array[]::text[];
begin
  if to_regprocedure('public.ecoflow_active_app_role()') is null then
    v_missing := array_append(v_missing, 'public.ecoflow_active_app_role()');
  end if;

  if to_regprocedure('gen_random_uuid()') is null then
    v_missing := array_append(v_missing, 'gen_random_uuid()');
  end if;

  if cardinality(v_missing) > 0 then
    raise exception 'ANALYTICS_FOUNDATION_PREREQUISITES_MISSING: %',
      array_to_string(v_missing, ', ');
  end if;
end;
$preflight$;

create schema if not exists analytics;

revoke all on schema analytics from public, anon, authenticated;
grant usage on schema analytics to authenticated, service_role;

alter default privileges in schema analytics revoke all on tables from public, anon, authenticated;
alter default privileges in schema analytics revoke all on sequences from public, anon, authenticated;
alter default privileges in schema analytics revoke execute on functions from public, anon, authenticated;
alter default privileges in schema analytics grant all on tables to service_role;
alter default privileges in schema analytics grant usage, select on sequences to service_role;
alter default privileges in schema analytics grant execute on functions to service_role;

create or replace function analytics.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, analytics
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

revoke all on function analytics.touch_updated_at() from public, anon, authenticated;
grant execute on function analytics.touch_updated_at() to service_role;

create table analytics.metric_definition (
  metric_key text not null,
  metric_version integer not null default 1,
  display_name text not null,
  business_definition text not null,
  formula_description text not null,
  grain_key text not null,
  date_basis text not null,
  unit_kind text not null,
  dimension_keys text[] not null default '{}'::text[],
  exclusions text[] not null default '{}'::text[],
  source_objects text[] not null default '{}'::text[],
  freshness_sla interval not null default interval '15 minutes',
  data_owner text not null,
  quality_policy text not null default 'FAIL_CLOSED',
  display_format jsonb not null default '{}'::jsonb,
  status text not null default 'DRAFT',
  effective_from timestamptz not null default clock_timestamp(),
  effective_to timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (metric_key, metric_version),
  constraint metric_definition_key_format
    check (metric_key ~ '^[a-z][a-z0-9_]*$'),
  constraint metric_definition_version_positive
    check (metric_version > 0),
  constraint metric_definition_unit_kind
    check (unit_kind in (
      'COUNT','CURRENCY','PERCENT','RATIO','DURATION','DISTANCE','QUANTITY'
    )),
  constraint metric_definition_quality_policy
    check (quality_policy in ('FAIL_CLOSED','DEGRADED_WITH_LAST_TRUSTED','INFORMATIONAL')),
  constraint metric_definition_status
    check (status in ('DRAFT','ACTIVE','DEPRECATED')),
  constraint metric_definition_freshness_positive
    check (freshness_sla > interval '0 seconds'),
  constraint metric_definition_effective_range
    check (effective_to is null or effective_to > effective_from),
  constraint metric_definition_active_sources
    check (status <> 'ACTIVE' or cardinality(source_objects) > 0)
);

create unique index metric_definition_one_active_version
  on analytics.metric_definition(metric_key)
  where status = 'ACTIVE';

create table analytics.refresh_status (
  dataset_key text primary key,
  source_system text not null,
  source_object text not null,
  status text not null default 'NEVER',
  as_of_at timestamptz,
  last_started_at timestamptz,
  last_succeeded_at timestamptz,
  last_failed_at timestamptz,
  freshness_sla interval not null default interval '15 minutes',
  row_count bigint,
  error_code text,
  error_message text,
  visible_to_roles text[] not null default array[
    'OWNER','ADMIN','ACCOUNT','VIEWER','WAREHOUSE','DRIVER'
  ]::text[],
  details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default clock_timestamp(),
  constraint refresh_status_key_format
    check (dataset_key ~ '^[a-z][a-z0-9_.-]*$'),
  constraint refresh_status_state
    check (status in ('NEVER','REFRESHING','CURRENT','STALE','DEGRADED','FAILED')),
  constraint refresh_status_freshness_positive
    check (freshness_sla > interval '0 seconds'),
  constraint refresh_status_row_count_nonnegative
    check (row_count is null or row_count >= 0),
  constraint refresh_status_visible_roles
    check (
      cardinality(visible_to_roles) > 0
      and visible_to_roles <@ array[
        'OWNER','ADMIN','ACCOUNT','VIEWER','WAREHOUSE','DRIVER'
      ]::text[]
    ),
  constraint refresh_status_current_has_as_of
    check (status not in ('CURRENT','STALE','DEGRADED') or as_of_at is not null)
);

create table analytics.data_quality_status (
  issue_id uuid primary key default gen_random_uuid(),
  issue_key text not null unique,
  dataset_key text not null,
  severity text not null,
  status text not null default 'OPEN',
  issue_type text not null,
  entity_type text,
  entity_key text,
  title text not null,
  detail text not null,
  business_impact text,
  recommended_action text,
  owner_team text,
  visible_to_roles text[] not null default array[
    'OWNER','ADMIN','ACCOUNT','VIEWER'
  ]::text[],
  first_detected_at timestamptz not null default clock_timestamp(),
  last_detected_at timestamptz not null default clock_timestamp(),
  occurrence_count bigint not null default 1,
  snoozed_until timestamptz,
  resolved_at timestamptz,
  resolution_code text,
  details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default clock_timestamp(),
  constraint data_quality_issue_key_format
    check (issue_key ~ '^[a-zA-Z0-9_.:-]+$'),
  constraint data_quality_severity
    check (severity in ('INFO','WARN','ERROR','CRITICAL')),
  constraint data_quality_status_state
    check (status in ('OPEN','ACKNOWLEDGED','SNOOZED','RESOLVED')),
  constraint data_quality_occurrence_positive
    check (occurrence_count > 0),
  constraint data_quality_visible_roles
    check (
      cardinality(visible_to_roles) > 0
      and visible_to_roles <@ array[
        'OWNER','ADMIN','ACCOUNT','VIEWER','WAREHOUSE','DRIVER'
      ]::text[]
    ),
  constraint data_quality_detection_order
    check (last_detected_at >= first_detected_at),
  constraint data_quality_resolution_state
    check (
      (status = 'RESOLVED' and resolved_at is not null)
      or (status <> 'RESOLVED' and resolved_at is null)
    ),
  constraint data_quality_snooze_state
    check (
      (status = 'SNOOZED' and snoozed_until is not null)
      or status <> 'SNOOZED'
    )
);

create table analytics.dim_date (
  date_key date primary key,
  business_day_key text not null unique,
  calendar_year integer not null,
  calendar_quarter integer not null,
  calendar_month integer not null,
  calendar_month_name text not null,
  iso_week integer not null,
  iso_day_of_week integer not null,
  day_name text not null,
  is_weekend boolean not null,
  financial_year_ending integer not null,
  financial_quarter integer not null,
  constraint dim_date_business_key_matches
    check (business_day_key = to_char(date_key, 'YYYY-MM-DD')),
  constraint dim_date_month_range check (calendar_month between 1 and 12),
  constraint dim_date_quarter_range check (calendar_quarter between 1 and 4),
  constraint dim_date_iso_day_range check (iso_day_of_week between 1 and 7),
  constraint dim_date_financial_quarter_range check (financial_quarter between 1 and 4)
);

create table analytics.dim_customer (
  customer_dimension_id bigint generated always as identity primary key,
  source_system text not null,
  source_customer_key text not null,
  customer_code text,
  customer_name text not null,
  customer_status text,
  default_price_tier text,
  effective_from timestamptz not null,
  effective_to timestamptz,
  is_current boolean not null default true,
  source_updated_at timestamptz,
  recorded_at timestamptz not null default clock_timestamp(),
  recorded_by text not null default 'SYSTEM',
  updated_at timestamptz not null default clock_timestamp(),
  constraint dim_customer_source_key_not_blank check (btrim(source_customer_key) <> ''),
  constraint dim_customer_name_not_blank check (btrim(customer_name) <> ''),
  constraint dim_customer_effective_state check (
    (is_current and effective_to is null)
    or (not is_current and effective_to is not null and effective_to > effective_from)
  ),
  unique (source_system, source_customer_key, effective_from)
);

create unique index dim_customer_one_current
  on analytics.dim_customer(source_system, source_customer_key)
  where is_current;

create table analytics.dim_store (
  store_dimension_id bigint generated always as identity primary key,
  source_system text not null,
  source_store_key text not null,
  customer_dimension_id bigint references analytics.dim_customer(customer_dimension_id),
  store_code text,
  store_name text not null,
  suburb text,
  state_code text,
  postcode text,
  active boolean not null default true,
  effective_from timestamptz not null,
  effective_to timestamptz,
  is_current boolean not null default true,
  source_updated_at timestamptz,
  recorded_at timestamptz not null default clock_timestamp(),
  recorded_by text not null default 'SYSTEM',
  updated_at timestamptz not null default clock_timestamp(),
  constraint dim_store_source_key_not_blank check (btrim(source_store_key) <> ''),
  constraint dim_store_name_not_blank check (btrim(store_name) <> ''),
  constraint dim_store_effective_state check (
    (is_current and effective_to is null)
    or (not is_current and effective_to is not null and effective_to > effective_from)
  ),
  unique (source_system, source_store_key, effective_from)
);

create unique index dim_store_one_current
  on analytics.dim_store(source_system, source_store_key)
  where is_current;

create table analytics.dim_supplier (
  supplier_dimension_id bigint generated always as identity primary key,
  source_system text not null,
  source_supplier_key text not null,
  supplier_code text,
  supplier_name text not null,
  active boolean not null default true,
  effective_from timestamptz not null,
  effective_to timestamptz,
  is_current boolean not null default true,
  source_updated_at timestamptz,
  recorded_at timestamptz not null default clock_timestamp(),
  recorded_by text not null default 'SYSTEM',
  updated_at timestamptz not null default clock_timestamp(),
  constraint dim_supplier_source_key_not_blank check (btrim(source_supplier_key) <> ''),
  constraint dim_supplier_name_not_blank check (btrim(supplier_name) <> ''),
  constraint dim_supplier_effective_state check (
    (is_current and effective_to is null)
    or (not is_current and effective_to is not null and effective_to > effective_from)
  ),
  unique (source_system, source_supplier_key, effective_from)
);

create unique index dim_supplier_one_current
  on analytics.dim_supplier(source_system, source_supplier_key)
  where is_current;

create table analytics.dim_brand (
  brand_dimension_id bigint generated always as identity primary key,
  source_system text not null,
  source_brand_key text not null,
  brand_name text not null,
  active boolean not null default true,
  effective_from timestamptz not null,
  effective_to timestamptz,
  is_current boolean not null default true,
  source_updated_at timestamptz,
  recorded_at timestamptz not null default clock_timestamp(),
  recorded_by text not null default 'SYSTEM',
  updated_at timestamptz not null default clock_timestamp(),
  constraint dim_brand_source_key_not_blank check (btrim(source_brand_key) <> ''),
  constraint dim_brand_name_not_blank check (btrim(brand_name) <> ''),
  constraint dim_brand_effective_state check (
    (is_current and effective_to is null)
    or (not is_current and effective_to is not null and effective_to > effective_from)
  ),
  unique (source_system, source_brand_key, effective_from)
);

create unique index dim_brand_one_current
  on analytics.dim_brand(source_system, source_brand_key)
  where is_current;

create table analytics.dim_commercial_sku (
  commercial_sku_dimension_id bigint generated always as identity primary key,
  source_system text not null,
  source_commercial_sku_key text not null,
  commercial_sku_code text not null,
  product_name text not null,
  category text,
  sales_unit text,
  sales_unit_quantity numeric,
  active boolean not null default true,
  effective_from timestamptz not null,
  effective_to timestamptz,
  is_current boolean not null default true,
  source_updated_at timestamptz,
  recorded_at timestamptz not null default clock_timestamp(),
  recorded_by text not null default 'SYSTEM',
  updated_at timestamptz not null default clock_timestamp(),
  constraint dim_commercial_sku_source_key_not_blank
    check (btrim(source_commercial_sku_key) <> ''),
  constraint dim_commercial_sku_code_not_blank
    check (btrim(commercial_sku_code) <> ''),
  constraint dim_commercial_sku_name_not_blank
    check (btrim(product_name) <> ''),
  constraint dim_commercial_sku_quantity_positive
    check (sales_unit_quantity is null or sales_unit_quantity > 0),
  constraint dim_commercial_sku_effective_state check (
    (is_current and effective_to is null)
    or (not is_current and effective_to is not null and effective_to > effective_from)
  ),
  unique (source_system, source_commercial_sku_key, effective_from)
);

create unique index dim_commercial_sku_one_current
  on analytics.dim_commercial_sku(source_system, source_commercial_sku_key)
  where is_current;

create table analytics.dim_physical_sku (
  physical_sku_dimension_id bigint generated always as identity primary key,
  source_system text not null,
  source_physical_sku_key text not null,
  physical_sku_code text not null,
  product_name text not null,
  supplier_dimension_id bigint references analytics.dim_supplier(supplier_dimension_id),
  brand_dimension_id bigint references analytics.dim_brand(brand_dimension_id),
  primary_barcode text,
  package_level text,
  units_per_package numeric,
  active boolean not null default true,
  effective_from timestamptz not null,
  effective_to timestamptz,
  is_current boolean not null default true,
  source_updated_at timestamptz,
  recorded_at timestamptz not null default clock_timestamp(),
  recorded_by text not null default 'SYSTEM',
  updated_at timestamptz not null default clock_timestamp(),
  constraint dim_physical_sku_source_key_not_blank
    check (btrim(source_physical_sku_key) <> ''),
  constraint dim_physical_sku_code_not_blank
    check (btrim(physical_sku_code) <> ''),
  constraint dim_physical_sku_name_not_blank
    check (btrim(product_name) <> ''),
  constraint dim_physical_sku_units_positive
    check (units_per_package is null or units_per_package > 0),
  constraint dim_physical_sku_effective_state check (
    (is_current and effective_to is null)
    or (not is_current and effective_to is not null and effective_to > effective_from)
  ),
  unique (source_system, source_physical_sku_key, effective_from)
);

create unique index dim_physical_sku_one_current
  on analytics.dim_physical_sku(source_system, source_physical_sku_key)
  where is_current;

create table analytics.bridge_commercial_physical_sku (
  commercial_sku_dimension_id bigint not null
    references analytics.dim_commercial_sku(commercial_sku_dimension_id),
  physical_sku_dimension_id bigint not null
    references analytics.dim_physical_sku(physical_sku_dimension_id),
  relationship_type text not null,
  fulfilment_priority integer,
  approved_reason text,
  effective_from timestamptz not null,
  effective_to timestamptz,
  is_current boolean not null default true,
  approved_by text not null default 'SYSTEM',
  recorded_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (
    commercial_sku_dimension_id,
    physical_sku_dimension_id,
    effective_from
  ),
  constraint bridge_commercial_physical_relationship
    check (relationship_type in (
      'PRIMARY','APPROVED_SUBSTITUTE','TEMPORARY_SUBSTITUTE','BLOCKED'
    )),
  constraint bridge_commercial_physical_priority_positive
    check (fulfilment_priority is null or fulfilment_priority > 0),
  constraint bridge_commercial_physical_effective_state check (
    (is_current and effective_to is null)
    or (not is_current and effective_to is not null and effective_to > effective_from)
  )
);

create unique index bridge_commercial_physical_one_current
  on analytics.bridge_commercial_physical_sku(
    commercial_sku_dimension_id,
    physical_sku_dimension_id
  )
  where is_current;

create table analytics.dim_warehouse_location (
  warehouse_location_dimension_id bigint generated always as identity primary key,
  source_system text not null,
  source_location_key text not null,
  location_code text not null,
  zone_code text,
  rack_code text,
  location_type text,
  active boolean not null default true,
  effective_from timestamptz not null,
  effective_to timestamptz,
  is_current boolean not null default true,
  source_updated_at timestamptz,
  recorded_at timestamptz not null default clock_timestamp(),
  recorded_by text not null default 'SYSTEM',
  updated_at timestamptz not null default clock_timestamp(),
  constraint dim_warehouse_location_source_key_not_blank
    check (btrim(source_location_key) <> ''),
  constraint dim_warehouse_location_code_not_blank
    check (btrim(location_code) <> ''),
  constraint dim_warehouse_location_effective_state check (
    (is_current and effective_to is null)
    or (not is_current and effective_to is not null and effective_to > effective_from)
  ),
  unique (source_system, source_location_key, effective_from)
);

create unique index dim_warehouse_location_one_current
  on analytics.dim_warehouse_location(source_system, source_location_key)
  where is_current;

create table analytics.dim_driver (
  driver_dimension_id bigint generated always as identity primary key,
  source_system text not null,
  source_driver_key text not null,
  display_name text not null,
  active boolean not null default true,
  effective_from timestamptz not null,
  effective_to timestamptz,
  is_current boolean not null default true,
  source_updated_at timestamptz,
  recorded_at timestamptz not null default clock_timestamp(),
  recorded_by text not null default 'SYSTEM',
  updated_at timestamptz not null default clock_timestamp(),
  constraint dim_driver_source_key_not_blank check (btrim(source_driver_key) <> ''),
  constraint dim_driver_name_not_blank check (btrim(display_name) <> ''),
  constraint dim_driver_effective_state check (
    (is_current and effective_to is null)
    or (not is_current and effective_to is not null and effective_to > effective_from)
  ),
  unique (source_system, source_driver_key, effective_from)
);

create unique index dim_driver_one_current
  on analytics.dim_driver(source_system, source_driver_key)
  where is_current;

create table analytics.dim_route (
  route_dimension_id bigint generated always as identity primary key,
  source_system text not null,
  source_route_key text not null,
  route_code text not null,
  route_name text,
  active boolean not null default true,
  effective_from timestamptz not null,
  effective_to timestamptz,
  is_current boolean not null default true,
  source_updated_at timestamptz,
  recorded_at timestamptz not null default clock_timestamp(),
  recorded_by text not null default 'SYSTEM',
  updated_at timestamptz not null default clock_timestamp(),
  constraint dim_route_source_key_not_blank check (btrim(source_route_key) <> ''),
  constraint dim_route_code_not_blank check (btrim(route_code) <> ''),
  constraint dim_route_effective_state check (
    (is_current and effective_to is null)
    or (not is_current and effective_to is not null and effective_to > effective_from)
  ),
  unique (source_system, source_route_key, effective_from)
);

create unique index dim_route_one_current
  on analytics.dim_route(source_system, source_route_key)
  where is_current;

create table analytics.dim_order_source (
  order_source_dimension_id bigint generated always as identity primary key,
  source_system text not null,
  source_order_source_key text not null,
  source_code text not null,
  source_name text not null,
  active boolean not null default true,
  effective_from timestamptz not null,
  effective_to timestamptz,
  is_current boolean not null default true,
  recorded_at timestamptz not null default clock_timestamp(),
  recorded_by text not null default 'SYSTEM',
  updated_at timestamptz not null default clock_timestamp(),
  constraint dim_order_source_source_key_not_blank
    check (btrim(source_order_source_key) <> ''),
  constraint dim_order_source_code_not_blank check (btrim(source_code) <> ''),
  constraint dim_order_source_name_not_blank check (btrim(source_name) <> ''),
  constraint dim_order_source_effective_state check (
    (is_current and effective_to is null)
    or (not is_current and effective_to is not null and effective_to > effective_from)
  ),
  unique (source_system, source_order_source_key, effective_from)
);

create unique index dim_order_source_one_current
  on analytics.dim_order_source(source_system, source_order_source_key)
  where is_current;

create table analytics.dim_exception_type (
  exception_type_dimension_id bigint generated always as identity primary key,
  source_system text not null,
  source_exception_type_key text not null,
  exception_code text not null,
  exception_name text not null,
  category text not null,
  default_severity text not null,
  active boolean not null default true,
  effective_from timestamptz not null,
  effective_to timestamptz,
  is_current boolean not null default true,
  recorded_at timestamptz not null default clock_timestamp(),
  recorded_by text not null default 'SYSTEM',
  updated_at timestamptz not null default clock_timestamp(),
  constraint dim_exception_type_source_key_not_blank
    check (btrim(source_exception_type_key) <> ''),
  constraint dim_exception_type_code_not_blank check (btrim(exception_code) <> ''),
  constraint dim_exception_type_name_not_blank check (btrim(exception_name) <> ''),
  constraint dim_exception_type_severity
    check (default_severity in ('INFO','WARN','ERROR','CRITICAL')),
  constraint dim_exception_type_effective_state check (
    (is_current and effective_to is null)
    or (not is_current and effective_to is not null and effective_to > effective_from)
  ),
  unique (source_system, source_exception_type_key, effective_from)
);

create unique index dim_exception_type_one_current
  on analytics.dim_exception_type(source_system, source_exception_type_key)
  where is_current;

insert into analytics.dim_date (
  date_key,
  business_day_key,
  calendar_year,
  calendar_quarter,
  calendar_month,
  calendar_month_name,
  iso_week,
  iso_day_of_week,
  day_name,
  is_weekend,
  financial_year_ending,
  financial_quarter
)
select
  d::date,
  to_char(d, 'YYYY-MM-DD'),
  extract(year from d)::integer,
  extract(quarter from d)::integer,
  extract(month from d)::integer,
  to_char(d, 'FMMonth'),
  extract(week from d)::integer,
  extract(isodow from d)::integer,
  to_char(d, 'FMDay'),
  extract(isodow from d)::integer in (6,7),
  case
    when extract(month from d)::integer >= 7
      then extract(year from d)::integer + 1
    else extract(year from d)::integer
  end,
  (
    (
      extract(month from d)::integer + 5
    ) % 12 / 3
  )::integer + 1
from generate_series(
  date '2020-01-01',
  date '2040-12-31',
  interval '1 day'
) d
on conflict (date_key) do nothing;

insert into analytics.metric_definition (
  metric_key,metric_version,display_name,business_definition,formula_description,
  grain_key,date_basis,unit_kind,dimension_keys,exclusions,source_objects,
  freshness_sla,data_owner,quality_policy,status
)
values
  (
    'revenue',1,'Revenue',
    'Accepted sales value attributed to the selected business date.',
    'Sum accepted order-line sales value after exclusions.',
    'order_line','requested_delivery_date','CURRENCY',
    array['date','customer','store','commercial_sku','order_source'],
    array['cancelled_order_lines'],
    array['analytics.fact_order_line'],
    interval '15 minutes','Commercial','FAIL_CLOSED','DRAFT'
  ),
  (
    'gross_margin',1,'Gross Margin',
    'Sales value less the historical cost of the physical items actually fulfilled.',
    'Revenue minus fulfilled quantity multiplied by historical physical unit cost.',
    'fulfilment_line','requested_delivery_date','CURRENCY',
    array['date','customer','store','commercial_sku','physical_sku','supplier','brand'],
    array['cancelled_order_lines','unpriced_cost_rows'],
    array['analytics.fact_order_line','analytics.fact_fulfilment_line'],
    interval '15 minutes','Commercial','FAIL_CLOSED','DRAFT'
  ),
  (
    'fill_rate',1,'Fill Rate',
    'The proportion of ordered quantity that was fulfilled.',
    'Fulfilled quantity divided by ordered quantity at order-line grain.',
    'order_line','requested_delivery_date','PERCENT',
    array['date','customer','store','commercial_sku'],
    array['cancelled_order_lines','zero_quantity_lines'],
    array['analytics.fact_order_line','analytics.fact_fulfilment_line'],
    interval '5 minutes','Operations','FAIL_CLOSED','DRAFT'
  ),
  (
    'on_time_delivery_rate',1,'On-time Delivery Rate',
    'The proportion of eligible delivery stops completed by the promised time.',
    'On-time completed stops divided by eligible completed stops.',
    'delivery_stop','requested_delivery_date','PERCENT',
    array['date','customer','store','route','driver'],
    array['cancelled_stops','customer_rescheduled_stops'],
    array['analytics.fact_delivery_stop'],
    interval '5 minutes','Delivery','DEGRADED_WITH_LAST_TRUSTED','DRAFT'
  ),
  (
    'stockout_risk_count',1,'Stockout Risk',
    'The number of current commercial SKU demand positions without sufficient approved physical coverage.',
    'Count commercial SKU positions below the configured coverage threshold.',
    'commercial_sku_snapshot','snapshot_date','COUNT',
    array['date','commercial_sku','physical_sku','supplier','brand','warehouse_location'],
    array['inactive_commercial_skus'],
    array['analytics.fact_daily_inventory_snapshot'],
    interval '15 minutes','Warehouse','FAIL_CLOSED','DRAFT'
  ),
  (
    'dead_stock_value',1,'Dead Stock Value',
    'Historical inventory cost for active stock with no qualifying demand or movement inside the configured window.',
    'Sum on-hand quantity multiplied by historical unit cost for dead-stock positions.',
    'physical_sku_location_snapshot','snapshot_date','CURRENCY',
    array['date','physical_sku','supplier','brand','warehouse_location'],
    array['quarantined_stock','supplier_owned_stock'],
    array['analytics.fact_daily_inventory_snapshot','analytics.fact_inventory_movement'],
    interval '1 day','Warehouse','FAIL_CLOSED','DRAFT'
  ),
  (
    'substitution_rate',1,'Substitution Rate',
    'The proportion of fulfilled quantity supplied by a non-primary approved physical SKU.',
    'Substituted fulfilled quantity divided by total fulfilled quantity.',
    'fulfilment_line','requested_delivery_date','PERCENT',
    array['date','customer','commercial_sku','physical_sku','supplier','brand'],
    array['cancelled_order_lines'],
    array['analytics.fact_fulfilment_line'],
    interval '5 minutes','Operations','FAIL_CLOSED','DRAFT'
  ),
  (
    'lines_picked_per_hour',1,'Lines Picked per Hour',
    'Completed pick lines per productive warehouse labour hour.',
    'Completed pick lines divided by measured productive pick duration.',
    'warehouse_shift','business_day','RATIO',
    array['date','driver','warehouse_location'],
    array['training_sessions','cancelled_pick_tasks'],
    array['analytics.fact_inventory_movement'],
    interval '15 minutes','Warehouse','INFORMATIONAL','DRAFT'
  ),
  (
    'inventory_days_of_cover',1,'Inventory Days of Cover',
    'Estimated days that approved physical stock can cover recent commercial demand.',
    'Available approved physical units divided by configured daily demand velocity.',
    'commercial_sku_snapshot','snapshot_date','DURATION',
    array['date','commercial_sku','physical_sku','supplier','brand'],
    array['inactive_commercial_skus','unmapped_physical_skus'],
    array['analytics.fact_daily_inventory_snapshot','analytics.fact_order_line'],
    interval '1 day','Purchasing','FAIL_CLOSED','DRAFT'
  ),
  (
    'customer_concentration',1,'Customer Concentration',
    'The selected customer share of total accepted revenue.',
    'Customer accepted revenue divided by total accepted revenue for the same period.',
    'customer_period','requested_delivery_date','PERCENT',
    array['date','customer','store'],
    array['cancelled_order_lines'],
    array['analytics.fact_order_line'],
    interval '1 hour','Commercial','FAIL_CLOSED','DRAFT'
  )
on conflict (metric_key,metric_version) do nothing;

insert into analytics.refresh_status (
  dataset_key,source_system,source_object,status,freshness_sla,visible_to_roles
)
values
  (
    'ordermentum.orders','ORDERMENTUM','public.ordermentum_raw_orders','NEVER',
    interval '15 minutes',array['OWNER','ADMIN','ACCOUNT','VIEWER']::text[]
  ),
  (
    'operational.orders','ECOFLOW','public.v_ecoflow_order_operations_v5','NEVER',
    interval '5 minutes',array['OWNER','ADMIN','ACCOUNT','VIEWER','WAREHOUSE']::text[]
  ),
  (
    'operational.inventory','ECOFLOW','public.v_ecoflow_inventory_recent_movements','NEVER',
    interval '5 minutes',array['OWNER','ADMIN','VIEWER','WAREHOUSE']::text[]
  ),
  (
    'operational.delivery','ECOFLOW','public.ecoflow_day_state','NEVER',
    interval '5 minutes',array['OWNER','ADMIN','ACCOUNT','VIEWER','DRIVER']::text[]
  ),
  (
    'analytics.semantic','ECOFLOW','analytics','NEVER',
    interval '15 minutes',
    array['OWNER','ADMIN','ACCOUNT','VIEWER','WAREHOUSE','DRIVER']::text[]
  )
on conflict (dataset_key) do nothing;

do $enable_rls$
declare
  v_table text;
begin
  foreach v_table in array array[
    'metric_definition',
    'refresh_status',
    'data_quality_status',
    'dim_date',
    'dim_customer',
    'dim_store',
    'dim_supplier',
    'dim_brand',
    'dim_commercial_sku',
    'dim_physical_sku',
    'bridge_commercial_physical_sku',
    'dim_warehouse_location',
    'dim_driver',
    'dim_route',
    'dim_order_source',
    'dim_exception_type'
  ]
  loop
    execute format('alter table analytics.%I enable row level security',v_table);
  end loop;
end;
$enable_rls$;

create policy analytics_metric_definition_read
on analytics.metric_definition
for select to authenticated
using (
  public.ecoflow_active_app_role() in (
    'OWNER','ADMIN','ACCOUNT','VIEWER','WAREHOUSE','DRIVER'
  )
  and (
    status = 'ACTIVE'
    or public.ecoflow_active_app_role() in ('OWNER','ADMIN')
  )
);

create policy analytics_refresh_status_read
on analytics.refresh_status
for select to authenticated
using (
  public.ecoflow_active_app_role() = any(visible_to_roles)
  or public.ecoflow_active_app_role() in ('OWNER','ADMIN')
);

create policy analytics_data_quality_status_read
on analytics.data_quality_status
for select to authenticated
using (
  public.ecoflow_active_app_role() = any(visible_to_roles)
  or public.ecoflow_active_app_role() in ('OWNER','ADMIN')
);

revoke all on all tables in schema analytics from public, anon, authenticated;
revoke all on all sequences in schema analytics from public, anon, authenticated;

grant all on all tables in schema analytics to service_role;
grant usage, select on all sequences in schema analytics to service_role;

grant select on analytics.metric_definition to authenticated;
grant select on analytics.refresh_status to authenticated;
grant select on analytics.data_quality_status to authenticated;

do $touch_triggers$
declare
  v_table text;
  v_trigger text;
begin
  foreach v_table in array array[
    'metric_definition',
    'refresh_status',
    'data_quality_status',
    'dim_customer',
    'dim_store',
    'dim_supplier',
    'dim_brand',
    'dim_commercial_sku',
    'dim_physical_sku',
    'bridge_commercial_physical_sku',
    'dim_warehouse_location',
    'dim_driver',
    'dim_route',
    'dim_order_source',
    'dim_exception_type'
  ]
  loop
    v_trigger := format('touch_%s_updated_at',v_table);
    execute format('drop trigger if exists %I on analytics.%I',v_trigger,v_table);
    execute format(
      'create trigger %I before update on analytics.%I '
      'for each row execute function analytics.touch_updated_at()',
      v_trigger,v_table
    );
  end loop;
end;
$touch_triggers$;

create or replace view public.v_ecoflow_analytics_metric_catalog
with (security_barrier = true, security_invoker = true)
as
select
  metric_key,
  metric_version,
  display_name,
  business_definition,
  formula_description,
  grain_key,
  date_basis,
  unit_kind,
  dimension_keys,
  exclusions,
  source_objects,
  freshness_sla,
  data_owner,
  quality_policy,
  display_format,
  status,
  effective_from,
  effective_to,
  updated_at
from analytics.metric_definition
order by metric_key,metric_version desc;

create or replace view public.v_ecoflow_analytics_refresh_status
with (security_barrier = true, security_invoker = true)
as
select
  dataset_key,
  source_system,
  source_object,
  status,
  as_of_at,
  last_started_at,
  last_succeeded_at,
  last_failed_at,
  freshness_sla,
  row_count,
  error_code,
  error_message,
  details,
  updated_at
from analytics.refresh_status
order by dataset_key;

create or replace view public.v_ecoflow_analytics_data_quality
with (security_barrier = true, security_invoker = true)
as
select
  issue_id,
  issue_key,
  dataset_key,
  severity,
  status,
  issue_type,
  entity_type,
  entity_key,
  title,
  detail,
  business_impact,
  recommended_action,
  owner_team,
  first_detected_at,
  last_detected_at,
  occurrence_count,
  snoozed_until,
  resolved_at,
  resolution_code,
  details,
  updated_at
from analytics.data_quality_status
order by
  case severity
    when 'CRITICAL' then 4
    when 'ERROR' then 3
    when 'WARN' then 2
    else 1
  end desc,
  last_detected_at desc;

create or replace view public.v_ecoflow_analytics_health
with (security_barrier = true, security_invoker = true)
as
with role_context as (
  select public.ecoflow_active_app_role() as app_role
),
refresh_rollup as (
  select
    count(*)::integer as visible_dataset_count,
    count(*) filter (where status = 'FAILED')::integer as failed_dataset_count,
    count(*) filter (where status in ('STALE','DEGRADED'))::integer as degraded_dataset_count,
    count(*) filter (where status = 'REFRESHING')::integer as refreshing_dataset_count,
    count(*) filter (where status = 'NEVER')::integer as never_refreshed_count,
    max(as_of_at) as latest_as_of_at,
    max(updated_at) as latest_refresh_status_at
  from analytics.refresh_status
),
quality_rollup as (
  select
    count(*) filter (
      where status in ('OPEN','ACKNOWLEDGED','SNOOZED')
    )::integer as open_quality_count,
    count(*) filter (
      where status in ('OPEN','ACKNOWLEDGED','SNOOZED')
        and severity = 'CRITICAL'
    )::integer as critical_quality_count,
    count(*) filter (
      where status in ('OPEN','ACKNOWLEDGED','SNOOZED')
        and severity = 'ERROR'
    )::integer as error_quality_count,
    max(last_detected_at) as latest_quality_at
  from analytics.data_quality_status
)
select
  case
    when refresh_rollup.failed_dataset_count > 0
      or quality_rollup.critical_quality_count > 0 then 'FAILED'
    when refresh_rollup.degraded_dataset_count > 0
      or quality_rollup.error_quality_count > 0 then 'DEGRADED'
    when refresh_rollup.refreshing_dataset_count > 0 then 'REFRESHING'
    when refresh_rollup.never_refreshed_count > 0 then 'NOT_READY'
    else 'CURRENT'
  end as overall_status,
  refresh_rollup.visible_dataset_count,
  refresh_rollup.failed_dataset_count,
  refresh_rollup.degraded_dataset_count,
  refresh_rollup.refreshing_dataset_count,
  refresh_rollup.never_refreshed_count,
  quality_rollup.open_quality_count,
  quality_rollup.critical_quality_count,
  quality_rollup.error_quality_count,
  refresh_rollup.latest_as_of_at,
  greatest(
    refresh_rollup.latest_refresh_status_at,
    quality_rollup.latest_quality_at
  ) as latest_status_at
from role_context
cross join refresh_rollup
cross join quality_rollup
where role_context.app_role in (
  'OWNER','ADMIN','ACCOUNT','VIEWER','WAREHOUSE','DRIVER'
);

revoke all on table public.v_ecoflow_analytics_metric_catalog from public, anon;
revoke all on table public.v_ecoflow_analytics_refresh_status from public, anon;
revoke all on table public.v_ecoflow_analytics_data_quality from public, anon;
revoke all on table public.v_ecoflow_analytics_health from public, anon;

grant select on table public.v_ecoflow_analytics_metric_catalog to authenticated;
grant select on table public.v_ecoflow_analytics_refresh_status to authenticated;
grant select on table public.v_ecoflow_analytics_data_quality to authenticated;
grant select on table public.v_ecoflow_analytics_health to authenticated;

comment on schema analytics is
  'Governed, read-only semantic layer for EcoFlow operational intelligence.';
comment on table analytics.metric_definition is
  'Versioned business metric registry. Draft definitions do not claim data availability.';
comment on table analytics.refresh_status is
  'Dataset freshness and source health; missing data must not be converted to a silent zero.';
comment on table analytics.data_quality_status is
  'Role-visible, actionable data-quality findings separate from operational exceptions.';
comment on table analytics.dim_commercial_sku is
  'Customer-facing commercial demand identity, distinct from physical stock.';
comment on table analytics.dim_physical_sku is
  'Concrete supplier/brand stock identity actually held, scanned and fulfilled.';
comment on table analytics.bridge_commercial_physical_sku is
  'Effective-dated approved relationship between commercial demand and physical fulfilment items.';

notify pgrst, 'reload schema';

commit;
