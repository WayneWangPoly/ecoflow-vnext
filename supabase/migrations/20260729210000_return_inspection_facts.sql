-- INTEL-DATA-005: governed return-inspection line facts.
--
-- Grain: one durable ecoflow_delivery_return_inspection_lines row.
-- Parent delivery-return state is current case context only; this fact does not
-- claim a complete case-status event history and case-level durations are not
-- additive across inspection lines.
--
-- Free-text notes, manual item descriptions, customer contacts, POD paths and
-- returns-zone coordinates are intentionally excluded. This migration creates
-- schema only and does not refresh or backfill production facts.

begin;

do $preflight$
declare
  v_missing text[] := array[]::text[];
  v_name text;
begin
  foreach v_name in array array[
    'analytics.refresh_status',
    'analytics.dim_physical_sku',
    'analytics.dim_commercial_sku',
    'analytics.dim_warehouse_location',
    'analytics.dim_exception_type',
    'public.ecoflow_delivery_return_inspection_lines',
    'public.ecoflow_delivery_exceptions',
    'public.ecoflow_inventory_movements',
    'public.ecoflow_warehouse_locations'
  ] loop
    if to_regclass(v_name) is null then
      v_missing := array_append(v_missing,v_name);
    end if;
  end loop;

  foreach v_name in array array[
    'analytics.ecoflow_try_date(text)',
    'analytics.ecoflow_ensure_warehouse_location_dimension(text,text,timestamptz)',
    'gen_random_uuid()'
  ] loop
    if to_regprocedure(v_name) is null then
      v_missing := array_append(v_missing,v_name);
    end if;
  end loop;

  if cardinality(v_missing)>0 then
    raise exception 'RETURN_INSPECTION_FACT_PREREQUISITES_MISSING: %',
      array_to_string(v_missing,', ');
  end if;
end;
$preflight$;

create or replace function analytics.ecoflow_return_try_uuid(p_value text)
returns uuid
language plpgsql
immutable
security invoker
set search_path=pg_catalog
as $$
begin
  if p_value is null or btrim(p_value)='' then return null; end if;
  return btrim(p_value)::uuid;
exception when others then
  return null;
end;
$$;
revoke all on function analytics.ecoflow_return_try_uuid(text)
  from public,anon,authenticated,service_role;

insert into analytics.dim_exception_type(
  source_system,source_exception_type_key,exception_code,exception_name,
  category,default_severity,active,effective_from,is_current,recorded_by
)
select
  'ECOFLOW','DELIVERY_RETURN_OUTCOME:'||v.code,v.code,v.name,
  'DELIVERY_RETURN',v.severity,true,clock_timestamp(),true,
  'INTEL-DATA-005'
from (values
  ('PARTIAL','Partial delivery','WARN'),
  ('MISSING_CARTON','Missing carton','ERROR'),
  ('REFUSED','Delivery refused','WARN'),
  ('DAMAGED','Damaged goods','ERROR'),
  ('WRONG_GOODS','Wrong goods','ERROR'),
  ('FAILED','Failed delivery','ERROR')
) as v(code,name,severity)
where not exists(
  select 1
  from analytics.dim_exception_type d
  where d.source_system='ECOFLOW'
    and d.source_exception_type_key='DELIVERY_RETURN_OUTCOME:'||v.code
    and d.is_current
);

create table analytics.fact_return_inspection(
  return_inspection_fact_id bigint generated always as identity primary key,
  source_system text not null default 'ECOFLOW',
  source_inspection_line_id uuid not null,
  source_exception_id uuid not null,
  source_inspection_key text not null,
  business_day date,
  source_order_id text not null,
  order_number_observed text,
  store_name_observed text,
  return_code_observed text,
  delivery_outcome text not null,
  exception_type_dimension_id bigint
    references analytics.dim_exception_type(exception_type_dimension_id),
  return_case_status_observed text not null,
  return_case_recorded_at timestamptz not null,
  driver_returned_at_observed timestamptz,
  warehouse_received_at_observed timestamptz,
  inspection_completed_at_observed timestamptz,
  case_context_status text not null,
  resolution text not null,
  source_sku_code text,
  product_name_observed text,
  physical_sku_dimension_id bigint
    references analytics.dim_physical_sku(physical_sku_dimension_id),
  commercial_sku_dimension_id bigint
    references analytics.dim_commercial_sku(commercial_sku_dimension_id),
  sku_identity_status text not null,
  barcode_evidence_status text not null,
  manual_item_present boolean not null default false,
  package_level text,
  qty_packages numeric not null,
  units_per_package numeric not null,
  source_units_processed numeric not null,
  base_units_processed numeric,
  quantity_basis_status text not null,
  target_location_code text,
  warehouse_location_dimension_id bigint
    references analytics.dim_warehouse_location(warehouse_location_dimension_id),
  location_resolution_status text not null,
  restock_movement_id uuid,
  restock_movement_status text not null,
  inspected_actor_role text,
  inspected_actor_user_id uuid,
  actor_resolution_status text not null,
  inspected_at timestamptz not null,
  source_last_modified_at timestamptz not null,
  history_completeness text not null,
  quality_status text not null,
  quality_detail text,
  source_row_hash text not null,
  first_observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  as_of_at timestamptz not null,
  constraint return_inspection_source_key_not_blank check(
    btrim(source_inspection_key)<>'' and btrim(source_order_id)<>''
  ),
  constraint return_inspection_delivery_outcome check(delivery_outcome in(
    'PARTIAL','MISSING_CARTON','REFUSED','DAMAGED','WRONG_GOODS','FAILED'
  )),
  constraint return_inspection_case_status check(return_case_status_observed in(
    'NOT_REQUIRED','WITH_DRIVER','DROPPED_IN_RETURN_ZONE','RETURNED_TO_WAREHOUSE',
    'INSPECTION_HOLD','RESTOCKED','SUPPLIER_CLAIM','DISPOSED',
    'MIXED_RESOLUTION','CANCELLED'
  )),
  constraint return_inspection_case_context check(case_context_status in(
    'OPEN_CURRENT_CONTEXT','COMPLETED_CURRENT_CONTEXT','CANCELLED_CURRENT_CONTEXT'
  )),
  constraint return_inspection_resolution check(resolution in(
    'RESTOCK','SUPPLIER_CLAIM','DISPOSE'
  )),
  constraint return_inspection_sku_identity check(sku_identity_status in(
    'PHYSICAL_RESOLVED','COMMERCIAL_ONLY','AMBIGUOUS_CROSS_DOMAIN','AMBIGUOUS',
    'UNRESOLVED_MAPPED_SKU','UNRESOLVED_MANUAL_ITEM','MISSING_IDENTITY'
  )),
  constraint return_inspection_barcode_evidence check(barcode_evidence_status in(
    'BARCODE_WITH_MAPPED_SKU','BARCODE_WITHOUT_SKU','NO_BARCODE_MANUAL_ITEM',
    'NO_ITEM_EVIDENCE'
  )),
  constraint return_inspection_quantity_basis check(quantity_basis_status in(
    'MAPPED_PACKAGE_TO_BASE','MANUAL_NATIVE_QUANTITY','INCONSISTENT_SOURCE'
  )),
  constraint return_inspection_location_resolution check(
    location_resolution_status in('RESOLVED','UNRESOLVED_REQUIRED','NOT_APPLICABLE')
  ),
  constraint return_inspection_restock_movement check(restock_movement_status in(
    'LINKED_RETURN_IN','MISSING_REQUIRED_MOVEMENT','INVALID_LINKED_MOVEMENT',
    'UNEXPECTED_MOVEMENT','NOT_APPLICABLE'
  )),
  constraint return_inspection_actor_resolution check(actor_resolution_status in(
    'RESOLVED_ROLE_USER','ROLE_ONLY','UNRESOLVED'
  )),
  constraint return_inspection_history check(
    history_completeness='IMMUTABLE_LINE_CURRENT_CASE_CONTEXT'
  ),
  constraint return_inspection_quality check(quality_status in(
    'TRUSTED','DEGRADED','INVALID'
  )),
  constraint return_inspection_base_units_nonnegative check(
    base_units_processed is null or base_units_processed>=0
  ),
  constraint return_inspection_restock_semantics check(
    (resolution='RESTOCK' and restock_movement_status in(
      'LINKED_RETURN_IN','MISSING_REQUIRED_MOVEMENT','INVALID_LINKED_MOVEMENT'
    ))
    or
    (resolution<>'RESTOCK' and restock_movement_status in(
      'UNEXPECTED_MOVEMENT','NOT_APPLICABLE'
    ))
  ),
  constraint return_inspection_location_semantics check(
    (resolution='RESTOCK' and location_resolution_status in(
      'RESOLVED','UNRESOLVED_REQUIRED'
    ))
    or
    (resolution<>'RESTOCK' and location_resolution_status='NOT_APPLICABLE')
  ),
  constraint return_inspection_hash check(source_row_hash~'^[0-9a-f]{64}$'),
  constraint return_inspection_observation_order check(
    last_observed_at>=first_observed_at
  ),
  unique(source_inspection_line_id),
  unique(source_inspection_key)
);

create index return_inspection_exception_time
  on analytics.fact_return_inspection(source_exception_id,inspected_at);
create index return_inspection_day_resolution
  on analytics.fact_return_inspection(business_day,resolution,quality_status);
create index return_inspection_sku_time
  on analytics.fact_return_inspection(source_sku_code,inspected_at);
create index return_inspection_case_status
  on analytics.fact_return_inspection(return_case_status_observed,inspected_at);

alter table analytics.fact_return_inspection enable row level security;
revoke all on table analytics.fact_return_inspection
  from public,anon,authenticated,service_role;
grant select on table analytics.fact_return_inspection to service_role;

create or replace view analytics.v_return_inspection_quality
with(security_barrier=true,security_invoker=true)
as
select
  business_day,
  resolution,
  package_level,
  sku_identity_status,
  restock_movement_status,
  location_resolution_status,
  case_context_status,
  quality_status,
  count(*)::bigint as inspection_line_count,
  sum(qty_packages)::numeric as native_package_quantity,
  coalesce(sum(base_units_processed) filter(
    where base_units_processed is not null
  ),0)::numeric as mapped_base_units_processed,
  count(*) filter(where manual_item_present)::bigint as manual_item_line_count,
  min(inspected_at) as first_inspected_at,
  max(inspected_at) as latest_inspected_at,
  max(as_of_at) as as_of_at
from analytics.fact_return_inspection
group by
  business_day,resolution,package_level,sku_identity_status,
  restock_movement_status,location_resolution_status,case_context_status,
  quality_status;

revoke all on table analytics.v_return_inspection_quality
  from public,anon,authenticated;
grant select on table analytics.v_return_inspection_quality to service_role;

create or replace function analytics.refresh_return_inspection_facts(
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
  v_count bigint := 0;
  v_error text;
  v_sqlstate text;
begin
  perform pg_advisory_xact_lock(
    hashtext('analytics.refresh_return_inspection_facts')
  );

  insert into analytics.refresh_status(
    dataset_key,source_system,source_object,status,last_started_at,
    freshness_sla,visible_to_roles,updated_at
  ) values(
    'analytics.return_inspections','ECOFLOW',
    'analytics.fact_return_inspection','REFRESHING',v_as_of,
    interval '15 minutes',
    array['OWNER','ADMIN','ACCOUNT','VIEWER','WAREHOUSE']::text[],v_as_of
  )
  on conflict on constraint refresh_status_pkey do update
  set status='REFRESHING',last_started_at=excluded.last_started_at,
      error_code=null,error_message=null,updated_at=excluded.updated_at;

  begin
    drop table if exists pg_temp.return_inspection_source;
    create temporary table pg_temp.return_inspection_source on commit drop as
    select
      l.id as source_inspection_line_id,
      l.exception_id as source_exception_id,
      'RETURN_INSPECTION:'||l.id::text as source_inspection_key,
      analytics.ecoflow_try_date(e.business_day) as business_day,
      btrim(e.order_id) as source_order_id,
      nullif(btrim(coalesce(e.order_number,'')),'') as order_number_observed,
      nullif(btrim(coalesce(e.store_name,'')),'') as store_name_observed,
      nullif(btrim(coalesce(e.return_code,'')),'') as return_code_observed,
      upper(btrim(e.outcome)) as delivery_outcome,
      et.exception_type_dimension_id,
      upper(btrim(e.return_status)) as return_case_status_observed,
      e.recorded_at as return_case_recorded_at,
      e.driver_returned_at as driver_returned_at_observed,
      e.warehouse_received_at as warehouse_received_at_observed,
      e.inspection_completed_at as inspection_completed_at_observed,
      case
        when upper(btrim(e.return_status))='CANCELLED'
          then 'CANCELLED_CURRENT_CONTEXT'
        when upper(btrim(e.return_status)) in(
          'RESTOCKED','SUPPLIER_CLAIM','DISPOSED','MIXED_RESOLUTION'
        ) then 'COMPLETED_CURRENT_CONTEXT'
        else 'OPEN_CURRENT_CONTEXT'
      end as case_context_status,
      upper(btrim(l.resolution)) as resolution,
      nullif(upper(btrim(coalesce(l.sku,''))),'') as source_sku_code,
      nullif(btrim(coalesce(l.product_name,'')),'') as product_name_observed,
      case when p.match_count=1 then p.dimension_id end
        as physical_sku_dimension_id,
      case when c.match_count=1 then c.dimension_id end
        as commercial_sku_dimension_id,
      case
        when p.match_count=1 and c.match_count=0 then 'PHYSICAL_RESOLVED'
        when p.match_count=0 and c.match_count=1 then 'COMMERCIAL_ONLY'
        when p.match_count=1 and c.match_count=1 then 'AMBIGUOUS_CROSS_DOMAIN'
        when p.match_count>1 or c.match_count>1 then 'AMBIGUOUS'
        when nullif(btrim(coalesce(l.sku,'')),'') is not null
          then 'UNRESOLVED_MAPPED_SKU'
        when nullif(btrim(coalesce(l.manual_item,'')),'') is not null
          then 'UNRESOLVED_MANUAL_ITEM'
        else 'MISSING_IDENTITY'
      end as sku_identity_status,
      case
        when nullif(btrim(coalesce(l.barcode,'')),'') is not null
         and nullif(btrim(coalesce(l.sku,'')),'') is not null
          then 'BARCODE_WITH_MAPPED_SKU'
        when nullif(btrim(coalesce(l.barcode,'')),'') is not null
          then 'BARCODE_WITHOUT_SKU'
        when nullif(btrim(coalesce(l.manual_item,'')),'') is not null
          then 'NO_BARCODE_MANUAL_ITEM'
        else 'NO_ITEM_EVIDENCE'
      end as barcode_evidence_status,
      nullif(btrim(coalesce(l.manual_item,'')),'') is not null
        as manual_item_present,
      nullif(lower(btrim(coalesce(l.package_level,''))),'') as package_level,
      l.qty_packages,
      l.units_per_package,
      l.units_processed as source_units_processed,
      case
        when nullif(btrim(coalesce(l.sku,'')),'') is not null
         and l.qty_packages>0 and l.units_per_package>0
         and l.units_processed=l.qty_packages*l.units_per_package
          then l.units_processed
        else null
      end as base_units_processed,
      case
        when l.qty_packages<=0 or l.units_per_package<=0
          or l.units_processed<=0
          or l.units_processed<>l.qty_packages*l.units_per_package
          then 'INCONSISTENT_SOURCE'
        when nullif(btrim(coalesce(l.sku,'')),'') is not null
          then 'MAPPED_PACKAGE_TO_BASE'
        else 'MANUAL_NATIVE_QUANTITY'
      end as quantity_basis_status,
      nullif(btrim(coalesce(l.target_location,'')),'') as target_location_code,
      loc.warehouse_location_dimension_id,
      case
        when upper(btrim(l.resolution))<>'RESTOCK' then 'NOT_APPLICABLE'
        when loc.warehouse_location_dimension_id is not null then 'RESOLVED'
        else 'UNRESOLVED_REQUIRED'
      end as location_resolution_status,
      l.movement_id as restock_movement_id,
      case
        when upper(btrim(l.resolution))='RESTOCK' and l.movement_id is null
          then 'MISSING_REQUIRED_MOVEMENT'
        when upper(btrim(l.resolution))='RESTOCK' and m.id is null
          then 'INVALID_LINKED_MOVEMENT'
        when upper(btrim(l.resolution))='RESTOCK'
         and upper(btrim(coalesce(m.movement_type,'')))='RETURN_IN'
         and upper(btrim(coalesce(m.reference_type,'')))='DELIVERY_RETURN'
         and m.reference_id=e.id::text
         and upper(btrim(coalesce(m.sku,'')))=upper(btrim(coalesce(l.sku,'')))
         and m.quantity=l.units_processed
         and nullif(btrim(coalesce(m.to_location,'')),'')
             is not distinct from nullif(btrim(coalesce(l.target_location,'')),'')
          then 'LINKED_RETURN_IN'
        when upper(btrim(l.resolution))='RESTOCK'
          then 'INVALID_LINKED_MOVEMENT'
        when l.movement_id is not null then 'UNEXPECTED_MOVEMENT'
        else 'NOT_APPLICABLE'
      end as restock_movement_status,
      case
        when l.inspected_by ~ '^[A-Z]+:'
          then split_part(l.inspected_by,':',1)
        when nullif(btrim(coalesce(l.inspected_by,'')),'') is not null
          then upper(btrim(l.inspected_by))
        else null
      end as inspected_actor_role,
      analytics.ecoflow_return_try_uuid(split_part(coalesce(l.inspected_by,''),':',2))
        as inspected_actor_user_id,
      case
        when l.inspected_by ~ '^[A-Z]+:'
         and analytics.ecoflow_return_try_uuid(
           split_part(l.inspected_by,':',2)
         ) is not null then 'RESOLVED_ROLE_USER'
        when nullif(btrim(coalesce(l.inspected_by,'')),'') is not null
          then 'ROLE_ONLY'
        else 'UNRESOLVED'
      end as actor_resolution_status,
      l.inspected_at,
      greatest(l.inspected_at,e.updated_at) as source_last_modified_at,
      'IMMUTABLE_LINE_CURRENT_CASE_CONTEXT'::text as history_completeness,
      case
        when analytics.ecoflow_try_date(e.business_day) is null
          or nullif(btrim(coalesce(e.order_id,'')),'') is null
          or l.qty_packages<=0 or l.units_per_package<=0
          or l.units_processed<=0
          or l.units_processed<>l.qty_packages*l.units_per_package
          or (
            nullif(btrim(coalesce(l.sku,'')),'') is null
            and nullif(btrim(coalesce(l.manual_item,'')),'') is null
          ) then 'INVALID'
        when (
          nullif(btrim(coalesce(l.sku,'')),'') is not null
          and p.match_count<>1
        )
          or nullif(btrim(coalesce(l.sku,'')),'') is null
          or (
            upper(btrim(l.resolution))='RESTOCK'
            and (
              l.movement_id is null or m.id is null
              or upper(btrim(coalesce(m.movement_type,'')))<>'RETURN_IN'
              or upper(btrim(coalesce(m.reference_type,'')))<>'DELIVERY_RETURN'
              or m.reference_id<>e.id::text
              or upper(btrim(coalesce(m.sku,'')))
                 <>upper(btrim(coalesce(l.sku,'')))
              or m.quantity<>l.units_processed
              or nullif(btrim(coalesce(m.to_location,'')),'')
                 is distinct from nullif(btrim(coalesce(l.target_location,'')),'')
            )
          )
          or (
            upper(btrim(l.resolution))='RESTOCK'
            and loc.warehouse_location_dimension_id is null
          )
          or (
            upper(btrim(l.resolution))<>'RESTOCK'
            and l.movement_id is not null
          )
          or nullif(btrim(coalesce(l.inspected_by,'')),'') is null
          then 'DEGRADED'
        else 'TRUSTED'
      end as quality_status,
      case
        when analytics.ecoflow_try_date(e.business_day) is null
          then 'INVALID_BUSINESS_DAY'
        when nullif(btrim(coalesce(e.order_id,'')),'') is null
          then 'SOURCE_ORDER_ID_MISSING'
        when l.qty_packages<=0 then 'QTY_PACKAGES_NOT_POSITIVE'
        when l.units_per_package<=0 then 'UNITS_PER_PACKAGE_NOT_POSITIVE'
        when l.units_processed<=0 then 'UNITS_PROCESSED_NOT_POSITIVE'
        when l.units_processed<>l.qty_packages*l.units_per_package
          then 'QUANTITY_ARITHMETIC_MISMATCH'
        when nullif(btrim(coalesce(l.sku,'')),'') is null
         and nullif(btrim(coalesce(l.manual_item,'')),'') is null
          then 'ITEM_IDENTITY_MISSING'
        when upper(btrim(l.resolution))='RESTOCK' and l.movement_id is null
          then 'RESTOCK_MOVEMENT_MISSING'
        when upper(btrim(l.resolution))='RESTOCK' and (
          m.id is null
          or upper(btrim(coalesce(m.movement_type,'')))<>'RETURN_IN'
          or upper(btrim(coalesce(m.reference_type,'')))<>'DELIVERY_RETURN'
          or m.reference_id<>e.id::text
          or upper(btrim(coalesce(m.sku,'')))
             <>upper(btrim(coalesce(l.sku,'')))
          or m.quantity<>l.units_processed
          or nullif(btrim(coalesce(m.to_location,'')),'')
             is distinct from nullif(btrim(coalesce(l.target_location,'')),'')
        ) then 'RESTOCK_MOVEMENT_INVALID'
        when upper(btrim(l.resolution))<>'RESTOCK' and l.movement_id is not null
          then 'NON_RESTOCK_HAS_MOVEMENT'
        when upper(btrim(l.resolution))='RESTOCK'
         and loc.warehouse_location_dimension_id is null
          then 'RESTOCK_LOCATION_UNRESOLVED'
        when nullif(btrim(coalesce(l.sku,'')),'') is not null
         and p.match_count<>1 then 'PHYSICAL_SKU_DIMENSION_UNRESOLVED'
        when nullif(btrim(coalesce(l.sku,'')),'') is null
          then 'MANUAL_ITEM_NOT_DIMENSIONAL'
        when nullif(btrim(coalesce(l.inspected_by,'')),'') is null
          then 'INSPECTOR_UNRESOLVED'
        else null
      end as quality_detail,
      encode(digest(jsonb_build_array(
        l.id,l.exception_id,e.business_day,e.order_id,e.order_number,e.store_name,
        e.return_code,e.outcome,e.return_status,e.recorded_at,e.driver_returned_at,
        e.warehouse_received_at,e.inspection_completed_at,l.resolution,l.barcode,
        l.sku,l.product_name,l.package_level,l.qty_packages,l.units_per_package,
        l.units_processed,l.target_location,l.movement_id,
        nullif(btrim(coalesce(l.manual_item,'')),'') is not null,
        l.inspected_by,l.inspected_at
      )::text,'sha256'),'hex') as source_row_hash
    from public.ecoflow_delivery_return_inspection_lines l
    join public.ecoflow_delivery_exceptions e on e.id=l.exception_id
    left join public.ecoflow_inventory_movements m on m.id=l.movement_id
    left join analytics.dim_exception_type et
      on et.source_system='ECOFLOW'
     and et.source_exception_type_key=
       'DELIVERY_RETURN_OUTCOME:'||upper(btrim(e.outcome))
     and et.is_current
    left join lateral(
      select count(*)::integer as match_count,
        min(d.physical_sku_dimension_id) as dimension_id
      from analytics.dim_physical_sku d
      where d.is_current
        and d.physical_sku_code=upper(btrim(coalesce(l.sku,'')))
    ) p on true
    left join lateral(
      select count(*)::integer as match_count,
        min(d.commercial_sku_dimension_id) as dimension_id
      from analytics.dim_commercial_sku d
      where d.is_current
        and d.commercial_sku_code=upper(btrim(coalesce(l.sku,'')))
    ) c on true
    left join lateral(
      select case
        when upper(btrim(l.resolution))='RESTOCK'
         and nullif(btrim(coalesce(l.target_location,'')),'') is not null
          then analytics.ecoflow_ensure_warehouse_location_dimension(
            null,l.target_location,v_as_of
          )
        else null
      end as warehouse_location_dimension_id
    ) loc on true;

    insert into analytics.fact_return_inspection(
      source_inspection_line_id,source_exception_id,source_inspection_key,
      business_day,source_order_id,order_number_observed,store_name_observed,
      return_code_observed,delivery_outcome,exception_type_dimension_id,
      return_case_status_observed,return_case_recorded_at,
      driver_returned_at_observed,warehouse_received_at_observed,
      inspection_completed_at_observed,case_context_status,resolution,
      source_sku_code,product_name_observed,physical_sku_dimension_id,
      commercial_sku_dimension_id,sku_identity_status,barcode_evidence_status,
      manual_item_present,package_level,qty_packages,units_per_package,
      source_units_processed,base_units_processed,quantity_basis_status,
      target_location_code,warehouse_location_dimension_id,
      location_resolution_status,restock_movement_id,restock_movement_status,
      inspected_actor_role,inspected_actor_user_id,actor_resolution_status,
      inspected_at,source_last_modified_at,history_completeness,quality_status,
      quality_detail,source_row_hash,first_observed_at,last_observed_at,as_of_at
    )
    select
      s.source_inspection_line_id,s.source_exception_id,s.source_inspection_key,
      s.business_day,s.source_order_id,s.order_number_observed,
      s.store_name_observed,s.return_code_observed,s.delivery_outcome,
      s.exception_type_dimension_id,s.return_case_status_observed,
      s.return_case_recorded_at,s.driver_returned_at_observed,
      s.warehouse_received_at_observed,s.inspection_completed_at_observed,
      s.case_context_status,s.resolution,s.source_sku_code,
      s.product_name_observed,s.physical_sku_dimension_id,
      s.commercial_sku_dimension_id,s.sku_identity_status,
      s.barcode_evidence_status,s.manual_item_present,s.package_level,
      s.qty_packages,s.units_per_package,s.source_units_processed,
      s.base_units_processed,s.quantity_basis_status,s.target_location_code,
      s.warehouse_location_dimension_id,s.location_resolution_status,
      s.restock_movement_id,s.restock_movement_status,s.inspected_actor_role,
      s.inspected_actor_user_id,s.actor_resolution_status,s.inspected_at,
      s.source_last_modified_at,s.history_completeness,s.quality_status,
      s.quality_detail,s.source_row_hash,v_as_of,v_as_of,v_as_of
    from pg_temp.return_inspection_source s
    on conflict on constraint fact_return_inspection_source_inspection_line_id_key
    do update set
      source_exception_id=excluded.source_exception_id,
      source_inspection_key=excluded.source_inspection_key,
      business_day=excluded.business_day,
      source_order_id=excluded.source_order_id,
      order_number_observed=excluded.order_number_observed,
      store_name_observed=excluded.store_name_observed,
      return_code_observed=excluded.return_code_observed,
      delivery_outcome=excluded.delivery_outcome,
      exception_type_dimension_id=excluded.exception_type_dimension_id,
      return_case_status_observed=excluded.return_case_status_observed,
      return_case_recorded_at=excluded.return_case_recorded_at,
      driver_returned_at_observed=excluded.driver_returned_at_observed,
      warehouse_received_at_observed=excluded.warehouse_received_at_observed,
      inspection_completed_at_observed=excluded.inspection_completed_at_observed,
      case_context_status=excluded.case_context_status,
      resolution=excluded.resolution,
      source_sku_code=excluded.source_sku_code,
      product_name_observed=excluded.product_name_observed,
      physical_sku_dimension_id=excluded.physical_sku_dimension_id,
      commercial_sku_dimension_id=excluded.commercial_sku_dimension_id,
      sku_identity_status=excluded.sku_identity_status,
      barcode_evidence_status=excluded.barcode_evidence_status,
      manual_item_present=excluded.manual_item_present,
      package_level=excluded.package_level,
      qty_packages=excluded.qty_packages,
      units_per_package=excluded.units_per_package,
      source_units_processed=excluded.source_units_processed,
      base_units_processed=excluded.base_units_processed,
      quantity_basis_status=excluded.quantity_basis_status,
      target_location_code=excluded.target_location_code,
      warehouse_location_dimension_id=excluded.warehouse_location_dimension_id,
      location_resolution_status=excluded.location_resolution_status,
      restock_movement_id=excluded.restock_movement_id,
      restock_movement_status=excluded.restock_movement_status,
      inspected_actor_role=excluded.inspected_actor_role,
      inspected_actor_user_id=excluded.inspected_actor_user_id,
      actor_resolution_status=excluded.actor_resolution_status,
      inspected_at=excluded.inspected_at,
      source_last_modified_at=excluded.source_last_modified_at,
      history_completeness=excluded.history_completeness,
      quality_status=excluded.quality_status,
      quality_detail=excluded.quality_detail,
      source_row_hash=excluded.source_row_hash,
      last_observed_at=v_as_of,
      as_of_at=v_as_of;

    select count(*) into v_count
    from analytics.fact_return_inspection;

    update analytics.refresh_status
    set status='CURRENT',as_of_at=v_as_of,last_succeeded_at=v_as_of,
        row_count=v_count,error_code=null,error_message=null,
        details=jsonb_build_object(
          'grain','one durable return inspection line',
          'case_context','current-state observation only',
          'free_text_excluded',true,
          'automatic_backfill',false
        ),updated_at=v_as_of
    where dataset_key='analytics.return_inspections';

    return query select 'analytics.return_inspections'::text,v_count,'CURRENT'::text;
  exception when others then
    get stacked diagnostics v_error=message_text,v_sqlstate=returned_sqlstate;
    update analytics.refresh_status
    set status='FAILED',last_failed_at=v_as_of,error_code=v_sqlstate,
        error_message=left(v_error,2000),updated_at=v_as_of
    where dataset_key='analytics.return_inspections';
    return query select 'analytics.return_inspections'::text,0::bigint,'FAILED'::text;
  end;
end;
$$;

revoke all on function analytics.refresh_return_inspection_facts(timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function analytics.refresh_return_inspection_facts(timestamptz)
  to service_role;

insert into analytics.refresh_status(
  dataset_key,source_system,source_object,status,freshness_sla,visible_to_roles,
  details
) values(
  'analytics.return_inspections','ECOFLOW',
  'analytics.fact_return_inspection','NEVER',interval '15 minutes',
  array['OWNER','ADMIN','ACCOUNT','VIEWER','WAREHOUSE']::text[],
  jsonb_build_object(
    'grain','one durable return inspection line',
    'case_context','current-state observation only',
    'automatic_backfill',false
  )
)
on conflict on constraint refresh_status_pkey do nothing;

comment on table analytics.fact_return_inspection is
  'One durable return inspection line. Parent case fields are current context and are not additive case-history facts.';
comment on function analytics.refresh_return_inspection_facts(timestamptz) is
  'Service-only projection. Does not mutate operational returns, inventory or delivery state.';

notify pgrst,'reload schema';

commit;
