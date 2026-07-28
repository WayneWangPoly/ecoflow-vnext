-- INTEL-DATA-003: inventory movements and daily location snapshots.
--
-- EcoFlow currently has two distinct inventory quantity domains:
--   1. ecoflow_inventory_movements: global/base operational units.
--   2. ecoflow_warehouse_movements + location items: package-level quantities.
--
-- They are intentionally projected side by side and are never summed across
-- domains without an explicit conversion. Global-ledger completeness is not
-- assumed because some historic/legacy pick implementations are not available
-- in the repository migration history. The daily snapshot therefore captures
-- current warehouse location balances, not a reconstructed ledger balance.
--
-- This migration creates schema only. It does not refresh or backfill facts.

begin;

do $preflight$
declare
  v_missing text[] := array[]::text[];
begin
  if to_regclass('analytics.refresh_status') is null then
    v_missing := array_append(v_missing,'analytics.refresh_status');
  end if;
  if to_regclass('analytics.dim_physical_sku') is null then
    v_missing := array_append(v_missing,'analytics.dim_physical_sku');
  end if;
  if to_regclass('analytics.dim_commercial_sku') is null then
    v_missing := array_append(v_missing,'analytics.dim_commercial_sku');
  end if;
  if to_regclass('analytics.dim_warehouse_location') is null then
    v_missing := array_append(v_missing,'analytics.dim_warehouse_location');
  end if;
  if to_regclass('public.ecoflow_inventory_movements') is null then
    v_missing := array_append(v_missing,'public.ecoflow_inventory_movements');
  end if;
  if to_regclass('public.ecoflow_warehouse_movements') is null then
    v_missing := array_append(v_missing,'public.ecoflow_warehouse_movements');
  end if;
  if to_regclass('public.ecoflow_warehouse_location_items') is null then
    v_missing := array_append(v_missing,'public.ecoflow_warehouse_location_items');
  end if;
  if to_regclass('public.ecoflow_warehouse_locations') is null then
    v_missing := array_append(v_missing,'public.ecoflow_warehouse_locations');
  end if;
  if to_regclass('public.ecoflow_sku_barcode_registry') is null then
    v_missing := array_append(v_missing,'public.ecoflow_sku_barcode_registry');
  end if;
  if to_regprocedure('gen_random_uuid()') is null then
    v_missing := array_append(v_missing,'gen_random_uuid()');
  end if;

  if cardinality(v_missing)>0 then
    raise exception 'INVENTORY_FACT_PREREQUISITES_MISSING: %',
      array_to_string(v_missing,', ');
  end if;
end;
$preflight$;

create table analytics.fact_inventory_movement (
  inventory_movement_fact_id bigint generated always as identity primary key,
  source_domain text not null,
  source_movement_id uuid not null,
  source_movement_key text not null,
  source_sku_code text,
  product_name text,
  physical_sku_dimension_id bigint
    references analytics.dim_physical_sku(physical_sku_dimension_id),
  commercial_sku_dimension_id bigint
    references analytics.dim_commercial_sku(commercial_sku_dimension_id),
  sku_identity_status text not null,
  movement_type text not null,
  movement_direction text not null,
  native_quantity numeric,
  signed_quantity numeric,
  native_unit_level text not null,
  from_location_key text,
  from_location_code text,
  from_location_dimension_id bigint
    references analytics.dim_warehouse_location(warehouse_location_dimension_id),
  to_location_key text,
  to_location_code text,
  to_location_dimension_id bigint
    references analytics.dim_warehouse_location(warehouse_location_dimension_id),
  barcode text,
  reference_type text,
  reference_id text,
  source_label text,
  store_id text,
  note text,
  actor_user_id uuid,
  occurred_at timestamptz,
  paired_reference_status text not null,
  quality_status text not null,
  quality_detail text,
  source_row_hash text not null,
  first_observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  as_of_at timestamptz not null,
  constraint fact_inventory_movement_domain check (
    source_domain in ('GLOBAL_BASE','LOCATION_PACKAGE')
  ),
  constraint fact_inventory_movement_key_not_blank check (
    btrim(source_movement_key)<>''
  ),
  constraint fact_inventory_movement_identity check (
    sku_identity_status in (
      'PHYSICAL_RESOLVED','COMMERCIAL_RESOLVED',
      'AMBIGUOUS_CROSS_DOMAIN','AMBIGUOUS','UNRESOLVED'
    )
  ),
  constraint fact_inventory_movement_direction check (
    movement_direction in ('IN','OUT','TRANSFER','UNKNOWN')
  ),
  constraint fact_inventory_movement_unit_not_blank check (
    btrim(native_unit_level)<>''
  ),
  constraint fact_inventory_movement_pair_status check (
    paired_reference_status in (
      'PAIRED_REFERENCE','UNPAIRED_REFERENCE','NOT_APPLICABLE'
    )
  ),
  constraint fact_inventory_movement_quality check (
    quality_status in ('TRUSTED','DEGRADED','INVALID')
  ),
  constraint fact_inventory_movement_hash check (
    source_row_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint fact_inventory_movement_observation_order check (
    last_observed_at>=first_observed_at
  ),
  unique(source_domain,source_movement_id),
  unique(source_movement_key)
);

create index fact_inventory_movement_sku_time
  on analytics.fact_inventory_movement(source_sku_code,occurred_at);
create index fact_inventory_movement_domain_type
  on analytics.fact_inventory_movement(source_domain,movement_type,occurred_at);
create index fact_inventory_movement_reference
  on analytics.fact_inventory_movement(reference_type,reference_id);

create table analytics.fact_daily_inventory_snapshot (
  inventory_snapshot_fact_id bigint generated always as identity primary key,
  snapshot_date date not null,
  snapshot_at timestamptz not null,
  snapshot_timezone text not null default 'Australia/Adelaide',
  source_item_id uuid not null,
  source_location_id uuid not null,
  source_location_key text not null,
  location_code text not null,
  warehouse_location_dimension_id bigint
    references analytics.dim_warehouse_location(warehouse_location_dimension_id),
  source_sku_code text not null,
  product_name text,
  physical_sku_dimension_id bigint
    references analytics.dim_physical_sku(physical_sku_dimension_id),
  commercial_sku_dimension_id bigint
    references analytics.dim_commercial_sku(commercial_sku_dimension_id),
  sku_identity_status text not null,
  source_barcode text,
  unit_level text not null,
  native_quantity numeric not null,
  base_units_per_native numeric,
  base_equivalent_quantity numeric,
  conversion_status text not null,
  item_status text not null,
  last_movement_at timestamptz,
  source_updated_at timestamptz,
  reconciliation_status text not null default 'NOT_ESTABLISHED',
  quality_status text not null,
  quality_detail text,
  source_row_hash text not null,
  first_observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  as_of_at timestamptz not null,
  constraint fact_inventory_snapshot_location_key check (
    btrim(source_location_key)<>'' and btrim(location_code)<>''
  ),
  constraint fact_inventory_snapshot_sku check (btrim(source_sku_code)<>''),
  constraint fact_inventory_snapshot_unit check (btrim(unit_level)<>''),
  constraint fact_inventory_snapshot_identity check (
    sku_identity_status in (
      'PHYSICAL_RESOLVED','COMMERCIAL_RESOLVED',
      'AMBIGUOUS_CROSS_DOMAIN','AMBIGUOUS','UNRESOLVED'
    )
  ),
  constraint fact_inventory_snapshot_conversion check (
    conversion_status in (
      'CONVERTED_ACTIVE_BARCODE','MISSING_BARCODE',
      'BARCODE_NOT_ACTIVE','UNIT_LEVEL_MISMATCH','UNKNOWN_UNIT'
    )
  ),
  constraint fact_inventory_snapshot_reconciliation check (
    reconciliation_status='NOT_ESTABLISHED'
  ),
  constraint fact_inventory_snapshot_quality check (
    quality_status in ('TRUSTED','DEGRADED','INVALID')
  ),
  constraint fact_inventory_snapshot_hash check (
    source_row_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint fact_inventory_snapshot_observation_order check (
    last_observed_at>=first_observed_at
  ),
  unique(snapshot_date,source_item_id)
);

create index fact_daily_inventory_snapshot_sku_date
  on analytics.fact_daily_inventory_snapshot(source_sku_code,snapshot_date);
create index fact_daily_inventory_snapshot_location_date
  on analytics.fact_daily_inventory_snapshot(location_code,snapshot_date);
create index fact_daily_inventory_snapshot_quality
  on analytics.fact_daily_inventory_snapshot(snapshot_date,quality_status,conversion_status);

alter table analytics.fact_inventory_movement enable row level security;
alter table analytics.fact_daily_inventory_snapshot enable row level security;

revoke all on table analytics.fact_inventory_movement
  from public,anon,authenticated,service_role;
revoke all on table analytics.fact_daily_inventory_snapshot
  from public,anon,authenticated,service_role;
grant select on table analytics.fact_inventory_movement to service_role;
grant select on table analytics.fact_daily_inventory_snapshot to service_role;

create or replace view analytics.v_inventory_movement_quality
with (security_barrier=true,security_invoker=true)
as
select
  source_domain,
  movement_type,
  native_unit_level,
  movement_direction,
  quality_status,
  paired_reference_status,
  count(*)::bigint as movement_count,
  min(occurred_at) as first_movement_at,
  max(occurred_at) as latest_movement_at,
  max(as_of_at) as as_of_at
from analytics.fact_inventory_movement
group by
  source_domain,movement_type,native_unit_level,movement_direction,
  quality_status,paired_reference_status;

create or replace view analytics.v_daily_inventory_snapshot_quality
with (security_barrier=true,security_invoker=true)
as
select
  snapshot_date,
  count(*)::bigint as snapshot_row_count,
  count(*) filter(where quality_status='TRUSTED')::bigint as trusted_row_count,
  count(*) filter(where quality_status='DEGRADED')::bigint as degraded_row_count,
  count(*) filter(where quality_status='INVALID')::bigint as invalid_row_count,
  count(*) filter(
    where conversion_status='CONVERTED_ACTIVE_BARCODE'
  )::bigint as converted_row_count,
  count(*) filter(
    where conversion_status<>'CONVERTED_ACTIVE_BARCODE'
  )::bigint as unconverted_row_count,
  coalesce(sum(base_equivalent_quantity) filter(
    where quality_status='TRUSTED'
      and conversion_status='CONVERTED_ACTIVE_BARCODE'
  ),0)::numeric as trusted_base_equivalent_quantity,
  bool_and(conversion_status='CONVERTED_ACTIVE_BARCODE')
    as all_rows_convertible,
  max(snapshot_at) as snapshot_at,
  max(as_of_at) as as_of_at
from analytics.fact_daily_inventory_snapshot
group by snapshot_date;

revoke all on table analytics.v_inventory_movement_quality
  from public,anon,authenticated;
revoke all on table analytics.v_daily_inventory_snapshot_quality
  from public,anon,authenticated;
grant select on table analytics.v_inventory_movement_quality to service_role;
grant select on table analytics.v_daily_inventory_snapshot_quality to service_role;

create or replace function analytics.refresh_inventory_movement_and_snapshot_facts(
  p_as_of timestamptz default clock_timestamp()
)
returns table(
  refreshed_dataset_key text,
  refreshed_row_count bigint,
  refresh_state text
)
language plpgsql
security definer
set search_path=pg_catalog,analytics,public
as $$
declare
  v_as_of timestamptz := coalesce(p_as_of,clock_timestamp());
  v_snapshot_date date := (coalesce(p_as_of,clock_timestamp())
    at time zone 'Australia/Adelaide')::date;
  v_movement_count bigint := 0;
  v_snapshot_count bigint := 0;
  v_error text;
begin
  perform pg_advisory_xact_lock(
    hashtext('analytics.refresh_inventory_movement_and_snapshot_facts')
  );

  insert into analytics.refresh_status(
    dataset_key,source_system,source_object,status,last_started_at,
    freshness_sla,visible_to_roles,updated_at
  )
  values
    (
      'analytics.inventory_movements','ECOFLOW',
      'analytics.fact_inventory_movement','REFRESHING',v_as_of,
      interval '5 minutes',
      array['OWNER','ADMIN','ACCOUNT','VIEWER','WAREHOUSE']::text[],v_as_of
    ),
    (
      'analytics.daily_inventory_snapshot','ECOFLOW',
      'analytics.fact_daily_inventory_snapshot','REFRESHING',v_as_of,
      interval '1 day',
      array['OWNER','ADMIN','ACCOUNT','VIEWER','WAREHOUSE']::text[],v_as_of
    )
  on conflict on constraint refresh_status_pkey do update
  set status='REFRESHING',
      last_started_at=excluded.last_started_at,
      error_code=null,
      error_message=null,
      updated_at=excluded.updated_at;

  begin
    create temporary table if not exists pg_temp.inventory_movement_source(
      source_domain text,
      source_movement_id uuid,
      source_movement_key text,
      source_sku_code text,
      product_name text,
      movement_type text,
      movement_direction text,
      native_quantity numeric,
      signed_quantity numeric,
      native_unit_level text,
      from_location_key text,
      from_location_code text,
      to_location_key text,
      to_location_code text,
      barcode text,
      reference_type text,
      reference_id text,
      source_label text,
      store_id text,
      note text,
      actor_user_id uuid,
      occurred_at timestamptz,
      paired_reference_status text,
      quality_status text,
      quality_detail text,
      source_row_hash text
    ) on commit drop;

    truncate table pg_temp.inventory_movement_source;

    insert into pg_temp.inventory_movement_source
    select
      'GLOBAL_BASE',
      m.id,
      'GLOBAL_BASE:'||m.id::text,
      nullif(upper(btrim(coalesce(m.sku,''))),''),
      m.product_name,
      upper(btrim(coalesce(m.movement_type,'UNKNOWN'))),
      case upper(btrim(coalesce(m.movement_type,'')))
        when 'RECEIVE' then 'IN'
        when 'ADJUST_IN' then 'IN'
        when 'RETURN_IN' then 'IN'
        when 'DISPATCH' then 'OUT'
        when 'ADJUST_OUT' then 'OUT'
        when 'PUTAWAY' then 'TRANSFER'
        else 'UNKNOWN'
      end,
      m.quantity,
      case upper(btrim(coalesce(m.movement_type,'')))
        when 'RECEIVE' then m.quantity
        when 'ADJUST_IN' then m.quantity
        when 'RETURN_IN' then m.quantity
        when 'DISPATCH' then -m.quantity
        when 'ADJUST_OUT' then -m.quantity
        when 'PUTAWAY' then 0
        else null
      end,
      'BASE_UNIT',
      null,
      m.from_location,
      null,
      m.to_location,
      null,
      m.reference_type,
      m.reference_id,
      m.source,
      m.store_id,
      m.action_note,
      m.moved_by,
      m.moved_at,
      case
        when nullif(btrim(coalesce(m.reference_type,'')),'') is null
          or nullif(btrim(coalesce(m.reference_id,'')),'') is null
          then 'NOT_APPLICABLE'
        when exists(
          select 1
          from public.ecoflow_warehouse_movements w
          where w.reference_type=m.reference_type
            and w.reference_id=m.reference_id
        ) then 'PAIRED_REFERENCE'
        else 'UNPAIRED_REFERENCE'
      end,
      case
        when nullif(btrim(coalesce(m.sku,'')),'') is null
          or m.quantity is null or m.quantity<=0 then 'INVALID'
        when upper(btrim(coalesce(m.movement_type,''))) not in (
          'RECEIVE','ADJUST_IN','RETURN_IN','DISPATCH','ADJUST_OUT','PUTAWAY'
        ) then 'DEGRADED'
        else 'TRUSTED'
      end,
      case
        when nullif(btrim(coalesce(m.sku,'')),'') is null then 'SKU_MISSING'
        when m.quantity is null or m.quantity<=0 then 'QUANTITY_NOT_POSITIVE'
        when upper(btrim(coalesce(m.movement_type,''))) not in (
          'RECEIVE','ADJUST_IN','RETURN_IN','DISPATCH','ADJUST_OUT','PUTAWAY'
        ) then 'UNKNOWN_MOVEMENT_DIRECTION'
        else null
      end,
      encode(digest(jsonb_build_array(
        m.id,m.sku,m.product_name,m.movement_type,m.quantity,m.from_location,
        m.to_location,m.reference_type,m.reference_id,m.store_id,m.action_note,
        m.source,m.moved_by,m.moved_at
      )::text,'sha256'),'hex')
    from public.ecoflow_inventory_movements m;

    insert into pg_temp.inventory_movement_source
    select
      'LOCATION_PACKAGE',
      w.id,
      'LOCATION_PACKAGE:'||w.id::text,
      nullif(upper(btrim(coalesce(w.sku,''))),''),
      w.product_name,
      upper(btrim(coalesce(w.movement_type,'UNKNOWN'))),
      case upper(btrim(coalesce(w.movement_type,'')))
        when 'RECEIVE' then 'IN'
        when 'RETURN_IN' then 'IN'
        when 'RESTOCK' then 'IN'
        when 'ADJUST_IN' then 'IN'
        when 'PICK' then 'OUT'
        when 'DISPATCH' then 'OUT'
        when 'ISSUE' then 'OUT'
        when 'CUSTOMER_ISSUE' then 'OUT'
        when 'DISPOSE' then 'OUT'
        when 'ADJUST_OUT' then 'OUT'
        when 'PUTAWAY' then 'TRANSFER'
        when 'MOVE' then 'TRANSFER'
        when 'TRANSFER' then 'TRANSFER'
        else 'UNKNOWN'
      end,
      w.quantity,
      case upper(btrim(coalesce(w.movement_type,'')))
        when 'RECEIVE' then w.quantity
        when 'RETURN_IN' then w.quantity
        when 'RESTOCK' then w.quantity
        when 'ADJUST_IN' then w.quantity
        when 'PICK' then -w.quantity
        when 'DISPATCH' then -w.quantity
        when 'ISSUE' then -w.quantity
        when 'CUSTOMER_ISSUE' then -w.quantity
        when 'DISPOSE' then -w.quantity
        when 'ADJUST_OUT' then -w.quantity
        when 'PUTAWAY' then 0
        when 'MOVE' then 0
        when 'TRANSFER' then 0
        else null
      end,
      lower(btrim(coalesce(nullif(w.unit_level,''),'unknown'))),
      w.location_id::text,
      fl.location_code,
      w.to_location_id::text,
      tl.location_code,
      w.barcode,
      w.reference_type,
      w.reference_id,
      'WAREHOUSE_LOCATION_LEDGER',
      null,
      w.note,
      w.actor_user_id,
      w.created_at,
      case
        when nullif(btrim(coalesce(w.reference_type,'')),'') is null
          or nullif(btrim(coalesce(w.reference_id,'')),'') is null
          then 'NOT_APPLICABLE'
        when exists(
          select 1
          from public.ecoflow_inventory_movements m
          where m.reference_type=w.reference_type
            and m.reference_id=w.reference_id
        ) then 'PAIRED_REFERENCE'
        else 'UNPAIRED_REFERENCE'
      end,
      case
        when nullif(btrim(coalesce(w.sku,'')),'') is null
          or w.quantity is null or w.quantity<=0 then 'INVALID'
        when lower(btrim(coalesce(nullif(w.unit_level,''),'unknown')))='unknown'
          or upper(btrim(coalesce(w.movement_type,''))) not in (
            'RECEIVE','RETURN_IN','RESTOCK','ADJUST_IN','PICK','DISPATCH',
            'ISSUE','CUSTOMER_ISSUE','DISPOSE','ADJUST_OUT',
            'PUTAWAY','MOVE','TRANSFER'
          ) then 'DEGRADED'
        else 'TRUSTED'
      end,
      case
        when nullif(btrim(coalesce(w.sku,'')),'') is null then 'SKU_MISSING'
        when w.quantity is null or w.quantity<=0 then 'QUANTITY_NOT_POSITIVE'
        when lower(btrim(coalesce(nullif(w.unit_level,''),'unknown')))='unknown'
          then 'UNKNOWN_NATIVE_UNIT'
        when upper(btrim(coalesce(w.movement_type,''))) not in (
          'RECEIVE','RETURN_IN','RESTOCK','ADJUST_IN','PICK','DISPATCH',
          'ISSUE','CUSTOMER_ISSUE','DISPOSE','ADJUST_OUT',
          'PUTAWAY','MOVE','TRANSFER'
        ) then 'UNKNOWN_MOVEMENT_DIRECTION'
        else null
      end,
      encode(digest(jsonb_build_array(
        w.id,w.movement_type,w.location_id,w.to_location_id,w.sku,
        w.product_name,w.barcode,w.unit_level,w.quantity,w.note,
        w.actor_user_id,w.created_at,w.reference_type,w.reference_id
      )::text,'sha256'),'hex')
    from public.ecoflow_warehouse_movements w
    left join public.ecoflow_warehouse_locations fl on fl.id=w.location_id
    left join public.ecoflow_warehouse_locations tl on tl.id=w.to_location_id;

    insert into analytics.fact_inventory_movement(
      source_domain,source_movement_id,source_movement_key,source_sku_code,
      product_name,physical_sku_dimension_id,commercial_sku_dimension_id,
      sku_identity_status,movement_type,movement_direction,native_quantity,
      signed_quantity,native_unit_level,from_location_key,from_location_code,
      from_location_dimension_id,to_location_key,to_location_code,
      to_location_dimension_id,barcode,reference_type,reference_id,source_label,
      store_id,note,actor_user_id,occurred_at,paired_reference_status,
      quality_status,quality_detail,source_row_hash,first_observed_at,
      last_observed_at,as_of_at
    )
    select
      s.source_domain,s.source_movement_id,s.source_movement_key,
      s.source_sku_code,s.product_name,
      case when p.match_count=1 then p.dimension_id end,
      case when c.match_count=1 then c.dimension_id end,
      case
        when p.match_count=1 and c.match_count=0 then 'PHYSICAL_RESOLVED'
        when p.match_count=0 and c.match_count=1 then 'COMMERCIAL_RESOLVED'
        when p.match_count=1 and c.match_count=1 then 'AMBIGUOUS_CROSS_DOMAIN'
        when p.match_count>1 or c.match_count>1 then 'AMBIGUOUS'
        else 'UNRESOLVED'
      end,
      s.movement_type,s.movement_direction,s.native_quantity,
      s.signed_quantity,s.native_unit_level,s.from_location_key,
      s.from_location_code,fd.warehouse_location_dimension_id,
      s.to_location_key,s.to_location_code,td.warehouse_location_dimension_id,
      s.barcode,s.reference_type,s.reference_id,s.source_label,s.store_id,
      s.note,s.actor_user_id,s.occurred_at,s.paired_reference_status,
      s.quality_status,s.quality_detail,s.source_row_hash,v_as_of,v_as_of,v_as_of
    from pg_temp.inventory_movement_source s
    left join lateral(
      select count(*)::integer as match_count,
        min(d.physical_sku_dimension_id) as dimension_id
      from analytics.dim_physical_sku d
      where d.is_current and d.physical_sku_code=s.source_sku_code
    ) p on true
    left join lateral(
      select count(*)::integer as match_count,
        min(d.commercial_sku_dimension_id) as dimension_id
      from analytics.dim_commercial_sku d
      where d.is_current and d.commercial_sku_code=s.source_sku_code
    ) c on true
    left join analytics.dim_warehouse_location fd
      on fd.is_current
     and (
       (s.from_location_key is not null
        and fd.source_location_key=s.from_location_key)
       or (s.from_location_key is null
        and fd.location_code=s.from_location_code)
     )
    left join analytics.dim_warehouse_location td
      on td.is_current
     and (
       (s.to_location_key is not null
        and td.source_location_key=s.to_location_key)
       or (s.to_location_key is null
        and td.location_code=s.to_location_code)
     )
    on conflict on constraint fact_inventory_movement_source_domain_source_movement_id_key
    do update set
      source_sku_code=excluded.source_sku_code,
      product_name=excluded.product_name,
      physical_sku_dimension_id=excluded.physical_sku_dimension_id,
      commercial_sku_dimension_id=excluded.commercial_sku_dimension_id,
      sku_identity_status=excluded.sku_identity_status,
      movement_type=excluded.movement_type,
      movement_direction=excluded.movement_direction,
      native_quantity=excluded.native_quantity,
      signed_quantity=excluded.signed_quantity,
      native_unit_level=excluded.native_unit_level,
      from_location_key=excluded.from_location_key,
      from_location_code=excluded.from_location_code,
      from_location_dimension_id=excluded.from_location_dimension_id,
      to_location_key=excluded.to_location_key,
      to_location_code=excluded.to_location_code,
      to_location_dimension_id=excluded.to_location_dimension_id,
      barcode=excluded.barcode,
      reference_type=excluded.reference_type,
      reference_id=excluded.reference_id,
      source_label=excluded.source_label,
      store_id=excluded.store_id,
      note=excluded.note,
      actor_user_id=excluded.actor_user_id,
      occurred_at=excluded.occurred_at,
      paired_reference_status=excluded.paired_reference_status,
      quality_status=excluded.quality_status,
      quality_detail=excluded.quality_detail,
      source_row_hash=excluded.source_row_hash,
      last_observed_at=v_as_of,
      as_of_at=v_as_of;

    insert into analytics.dim_warehouse_location(
      source_system,source_location_key,location_code,zone_code,rack_code,
      location_type,active,effective_from,is_current,source_updated_at,recorded_by
    )
    select
      'ECOFLOW',l.id::text,l.location_code,l.location_category,l.rack_id,
      case
        when l.bin_code is not null then 'BIN'
        when l.rack_id is not null then 'SHELF'
        else 'AREA'
      end,
      l.status='ACTIVE',v_as_of,true,l.updated_at,
      'analytics.refresh_inventory_movement_and_snapshot_facts'
    from public.ecoflow_warehouse_locations l
    where not exists(
      select 1 from analytics.dim_warehouse_location d
      where d.source_system='ECOFLOW'
        and d.source_location_key=l.id::text
        and d.is_current
    );

    create temporary table if not exists pg_temp.inventory_snapshot_source(
      source_item_id uuid,
      source_location_id uuid,
      source_location_key text,
      location_code text,
      source_sku_code text,
      product_name text,
      source_barcode text,
      unit_level text,
      native_quantity numeric,
      base_units_per_native numeric,
      base_equivalent_quantity numeric,
      conversion_status text,
      item_status text,
      last_movement_at timestamptz,
      source_updated_at timestamptz,
      quality_status text,
      quality_detail text,
      source_row_hash text
    ) on commit drop;

    truncate table pg_temp.inventory_snapshot_source;

    insert into pg_temp.inventory_snapshot_source
    select
      i.id,i.location_id,i.location_id::text,l.location_code,
      upper(btrim(i.sku)),i.product_name,i.source_barcode,
      lower(btrim(coalesce(nullif(i.unit_level,''),'unknown'))),i.quantity,
      case
        when lower(btrim(coalesce(nullif(i.unit_level,''),'unknown')))='unknown'
          then null
        when nullif(btrim(coalesce(i.source_barcode,'')),'') is null then null
        when r.id is null then null
        when not r.is_active then null
        when lower(r.package_level)
          <> lower(btrim(coalesce(nullif(i.unit_level,''),'unknown'))) then null
        else r.units_per_barcode
      end,
      case
        when lower(btrim(coalesce(nullif(i.unit_level,''),'unknown')))='unknown'
          then null
        when nullif(btrim(coalesce(i.source_barcode,'')),'') is null then null
        when r.id is null or not r.is_active then null
        when lower(r.package_level)
          <> lower(btrim(coalesce(nullif(i.unit_level,''),'unknown'))) then null
        else i.quantity*r.units_per_barcode
      end,
      case
        when lower(btrim(coalesce(nullif(i.unit_level,''),'unknown')))='unknown'
          then 'UNKNOWN_UNIT'
        when nullif(btrim(coalesce(i.source_barcode,'')),'') is null
          then 'MISSING_BARCODE'
        when r.id is null or not r.is_active then 'BARCODE_NOT_ACTIVE'
        when lower(r.package_level)
          <> lower(btrim(coalesce(nullif(i.unit_level,''),'unknown')))
          then 'UNIT_LEVEL_MISMATCH'
        else 'CONVERTED_ACTIVE_BARCODE'
      end,
      coalesce(nullif(upper(btrim(i.status)),''),'UNKNOWN'),
      i.last_movement_at,i.updated_at,
      case
        when i.quantity<0 or nullif(btrim(coalesce(i.sku,'')),'') is null
          or nullif(btrim(coalesce(l.location_code,'')),'') is null then 'INVALID'
        when lower(btrim(coalesce(nullif(i.unit_level,''),'unknown')))='unknown'
          or nullif(btrim(coalesce(i.source_barcode,'')),'') is null
          or r.id is null or not r.is_active
          or lower(r.package_level)
            <> lower(btrim(coalesce(nullif(i.unit_level,''),'unknown')))
          then 'DEGRADED'
        else 'TRUSTED'
      end,
      case
        when i.quantity<0 then 'NEGATIVE_LOCATION_BALANCE'
        when nullif(btrim(coalesce(i.sku,'')),'') is null then 'SKU_MISSING'
        when nullif(btrim(coalesce(l.location_code,'')),'') is null
          then 'LOCATION_MISSING'
        when lower(btrim(coalesce(nullif(i.unit_level,''),'unknown')))='unknown'
          then 'UNKNOWN_NATIVE_UNIT'
        when nullif(btrim(coalesce(i.source_barcode,'')),'') is null
          then 'BARCODE_MISSING'
        when r.id is null or not r.is_active then 'BARCODE_NOT_ACTIVE'
        when lower(r.package_level)
          <> lower(btrim(coalesce(nullif(i.unit_level,''),'unknown')))
          then 'UNIT_LEVEL_MISMATCH'
        else null
      end,
      encode(digest(jsonb_build_array(
        i.id,i.location_id,l.location_code,i.sku,i.product_name,
        i.source_barcode,i.unit_level,i.quantity,i.status,
        i.last_movement_at,i.updated_at
      )::text,'sha256'),'hex')
    from public.ecoflow_warehouse_location_items i
    join public.ecoflow_warehouse_locations l on l.id=i.location_id
    left join public.ecoflow_sku_barcode_registry r
      on r.barcode=i.source_barcode
     and upper(r.sku)=upper(i.sku);

    delete from analytics.fact_daily_inventory_snapshot f
    where f.snapshot_date=v_snapshot_date
      and not exists(
        select 1 from pg_temp.inventory_snapshot_source s
        where s.source_item_id=f.source_item_id
      );

    insert into analytics.fact_daily_inventory_snapshot(
      snapshot_date,snapshot_at,snapshot_timezone,source_item_id,
      source_location_id,source_location_key,location_code,
      warehouse_location_dimension_id,source_sku_code,product_name,
      physical_sku_dimension_id,commercial_sku_dimension_id,
      sku_identity_status,source_barcode,unit_level,native_quantity,
      base_units_per_native,base_equivalent_quantity,conversion_status,
      item_status,last_movement_at,source_updated_at,reconciliation_status,
      quality_status,quality_detail,source_row_hash,first_observed_at,
      last_observed_at,as_of_at
    )
    select
      v_snapshot_date,v_as_of,'Australia/Adelaide',s.source_item_id,
      s.source_location_id,s.source_location_key,s.location_code,
      ld.warehouse_location_dimension_id,s.source_sku_code,s.product_name,
      case when p.match_count=1 then p.dimension_id end,
      case when c.match_count=1 then c.dimension_id end,
      case
        when p.match_count=1 and c.match_count=0 then 'PHYSICAL_RESOLVED'
        when p.match_count=0 and c.match_count=1 then 'COMMERCIAL_RESOLVED'
        when p.match_count=1 and c.match_count=1 then 'AMBIGUOUS_CROSS_DOMAIN'
        when p.match_count>1 or c.match_count>1 then 'AMBIGUOUS'
        else 'UNRESOLVED'
      end,
      s.source_barcode,s.unit_level,s.native_quantity,
      s.base_units_per_native,s.base_equivalent_quantity,s.conversion_status,
      s.item_status,s.last_movement_at,s.source_updated_at,'NOT_ESTABLISHED',
      s.quality_status,s.quality_detail,s.source_row_hash,v_as_of,v_as_of,v_as_of
    from pg_temp.inventory_snapshot_source s
    left join analytics.dim_warehouse_location ld
      on ld.source_system='ECOFLOW'
     and ld.source_location_key=s.source_location_key
     and ld.is_current
    left join lateral(
      select count(*)::integer as match_count,
        min(d.physical_sku_dimension_id) as dimension_id
      from analytics.dim_physical_sku d
      where d.is_current and d.physical_sku_code=s.source_sku_code
    ) p on true
    left join lateral(
      select count(*)::integer as match_count,
        min(d.commercial_sku_dimension_id) as dimension_id
      from analytics.dim_commercial_sku d
      where d.is_current and d.commercial_sku_code=s.source_sku_code
    ) c on true
    on conflict on constraint fact_daily_inventory_snapshot_snapshot_date_source_item_id_key
    do update set
      snapshot_at=excluded.snapshot_at,
      source_location_id=excluded.source_location_id,
      source_location_key=excluded.source_location_key,
      location_code=excluded.location_code,
      warehouse_location_dimension_id=excluded.warehouse_location_dimension_id,
      source_sku_code=excluded.source_sku_code,
      product_name=excluded.product_name,
      physical_sku_dimension_id=excluded.physical_sku_dimension_id,
      commercial_sku_dimension_id=excluded.commercial_sku_dimension_id,
      sku_identity_status=excluded.sku_identity_status,
      source_barcode=excluded.source_barcode,
      unit_level=excluded.unit_level,
      native_quantity=excluded.native_quantity,
      base_units_per_native=excluded.base_units_per_native,
      base_equivalent_quantity=excluded.base_equivalent_quantity,
      conversion_status=excluded.conversion_status,
      item_status=excluded.item_status,
      last_movement_at=excluded.last_movement_at,
      source_updated_at=excluded.source_updated_at,
      quality_status=excluded.quality_status,
      quality_detail=excluded.quality_detail,
      source_row_hash=excluded.source_row_hash,
      last_observed_at=v_as_of,
      as_of_at=v_as_of;

    select count(*) into v_movement_count
    from analytics.fact_inventory_movement;
    select count(*) into v_snapshot_count
    from analytics.fact_daily_inventory_snapshot
    where snapshot_date=v_snapshot_date;

    update analytics.refresh_status r
    set status='CURRENT',as_of_at=v_as_of,last_succeeded_at=v_as_of,
        row_count=v_movement_count,error_code=null,error_message=null,
        updated_at=v_as_of
    where r.dataset_key='analytics.inventory_movements';

    update analytics.refresh_status r
    set status='CURRENT',as_of_at=v_as_of,last_succeeded_at=v_as_of,
        row_count=v_snapshot_count,error_code=null,error_message=null,
        updated_at=v_as_of
    where r.dataset_key='analytics.daily_inventory_snapshot';

    return query values
      ('analytics.inventory_movements'::text,v_movement_count,'CURRENT'::text),
      ('analytics.daily_inventory_snapshot'::text,v_snapshot_count,'CURRENT'::text);
  exception when others then
    v_error:=sqlerrm;
    update analytics.refresh_status r
    set status='FAILED',last_failed_at=clock_timestamp(),error_code=sqlstate,
        error_message=left(v_error,2000),updated_at=clock_timestamp()
    where r.dataset_key in (
      'analytics.inventory_movements','analytics.daily_inventory_snapshot'
    );
    return query values
      ('analytics.inventory_movements'::text,0::bigint,'FAILED'::text),
      ('analytics.daily_inventory_snapshot'::text,0::bigint,'FAILED'::text);
  end;
end;
$$;

revoke all on function analytics.refresh_inventory_movement_and_snapshot_facts(
  timestamptz
) from public,anon,authenticated;
grant execute on function analytics.refresh_inventory_movement_and_snapshot_facts(
  timestamptz
) to service_role;

insert into analytics.refresh_status(
  dataset_key,source_system,source_object,status,freshness_sla,visible_to_roles
)
values
  (
    'analytics.inventory_movements','ECOFLOW',
    'analytics.fact_inventory_movement','NEVER',interval '5 minutes',
    array['OWNER','ADMIN','ACCOUNT','VIEWER','WAREHOUSE']::text[]
  ),
  (
    'analytics.daily_inventory_snapshot','ECOFLOW',
    'analytics.fact_daily_inventory_snapshot','NEVER',interval '1 day',
    array['OWNER','ADMIN','ACCOUNT','VIEWER','WAREHOUSE']::text[]
  )
on conflict on constraint refresh_status_pkey do nothing;

comment on table analytics.fact_inventory_movement is
  'Observed global/base and location/package inventory ledger rows. Domains remain separate and global completeness is not assumed.';
comment on table analytics.fact_daily_inventory_snapshot is
  'Daily Adelaide-date snapshot of current location balances. Base equivalents require an active matching barcode conversion.';
comment on function analytics.refresh_inventory_movement_and_snapshot_facts(timestamptz) is
  'Service-only controlled refresh. The migration does not invoke it or backfill production inventory.';

notify pgrst,'reload schema';

commit;
