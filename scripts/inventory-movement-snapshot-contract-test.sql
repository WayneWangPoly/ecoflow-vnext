\set ON_ERROR_STOP on

begin;

create or replace function public.ecoflow_inventory_fact_expect_denied(
  p_sql text
)
returns void
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
begin
  execute p_sql;
  raise exception 'EXPECTED_DENIAL_NOT_RAISED: %',p_sql;
exception
  when insufficient_privilege then null;
end;
$$;

revoke all on function public.ecoflow_inventory_fact_expect_denied(text)
  from public,anon,authenticated;
grant execute on function public.ecoflow_inventory_fact_expect_denied(text)
  to service_role;

do $structure$
begin
  if to_regclass('analytics.fact_inventory_movement') is null
     or to_regclass('analytics.fact_daily_inventory_snapshot') is null
     or to_regclass('analytics.v_inventory_movement_quality') is null
     or to_regclass('analytics.v_daily_inventory_snapshot_quality') is null then
    raise exception 'inventory fact objects are incomplete';
  end if;

  if to_regprocedure(
    'analytics.refresh_inventory_movement_and_snapshot_facts(timestamptz)'
  ) is null then
    raise exception 'inventory refresh function is missing';
  end if;

  if not (
    select relrowsecurity
    from pg_class
    where oid='analytics.fact_inventory_movement'::regclass
  ) or not (
    select relrowsecurity
    from pg_class
    where oid='analytics.fact_daily_inventory_snapshot'::regclass
  ) then
    raise exception 'inventory fact RLS is incomplete';
  end if;

  if has_table_privilege('authenticated','analytics.fact_inventory_movement','SELECT')
     or has_table_privilege(
       'authenticated','analytics.fact_daily_inventory_snapshot','SELECT'
     ) then
    raise exception 'browser role can read raw inventory facts';
  end if;

  if not has_table_privilege(
      'service_role','analytics.fact_inventory_movement','SELECT'
    )
    or not has_table_privilege(
      'service_role','analytics.fact_daily_inventory_snapshot','SELECT'
    )
    or has_table_privilege(
      'service_role','analytics.fact_inventory_movement','INSERT'
    )
    or has_table_privilege(
      'service_role','analytics.fact_inventory_movement','UPDATE'
    )
    or has_table_privilege(
      'service_role','analytics.fact_daily_inventory_snapshot','INSERT'
    )
    or has_table_privilege(
      'service_role','analytics.fact_daily_inventory_snapshot','UPDATE'
    ) then
    raise exception 'service role can bypass the controlled inventory refresh';
  end if;

  if has_function_privilege(
      'authenticated',
      'analytics.refresh_inventory_movement_and_snapshot_facts(timestamptz)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'analytics.refresh_inventory_movement_and_snapshot_facts(timestamptz)',
      'EXECUTE'
    ) then
    raise exception 'inventory refresh execution grants are incorrect';
  end if;

  if exists(
    select 1 from analytics.metric_definition
    where metric_key in (
      'inventory_on_hand','stockout_risk','days_cover','inventory_adjustments'
    ) and status<>'DRAFT'
  ) then
    raise exception 'inventory package activated a KPI before reconciliation';
  end if;
end;
$structure$;

do $no_auto_refresh$
begin
  if exists(select 1 from analytics.fact_inventory_movement)
     or exists(select 1 from analytics.fact_daily_inventory_snapshot) then
    raise exception 'inventory facts were populated by migration';
  end if;

  if exists(
    select 1 from analytics.refresh_status
    where dataset_key in (
      'analytics.inventory_movements','analytics.daily_inventory_snapshot'
    ) and status<>'NEVER'
  ) then
    raise exception 'inventory refresh status did not start at NEVER';
  end if;
end;
$no_auto_refresh$;

insert into public.ecoflow_warehouse_locations(
  id,location_code,rack_id,rack_title,side,display_level,status,sort_order
)
values
  (
    '71000000-0000-0000-0000-000000000001',
    'INV-A1','INV-A','Inventory test A','front','Bottom','ACTIVE',1001
  ),
  (
    '71000000-0000-0000-0000-000000000002',
    'INV-QA','INV-QA','Inventory quarantine','front','QA','ACTIVE',1002
  )
on conflict(location_code) do nothing;

insert into public.ecoflow_sku_barcode_registry(
  id,sku,barcode,package_level,units_per_barcode,product_name,
  verified,is_active
)
values(
  '72000000-0000-0000-0000-000000000001',
  'INV-FACT-SKU','940000000001','CARTON',12,'Inventory Fact SKU',true,true
)
on conflict(barcode) do update set
  sku=excluded.sku,package_level=excluded.package_level,
  units_per_barcode=excluded.units_per_barcode,is_active=true;

insert into public.ecoflow_inventory_movements(
  id,sku,product_name,movement_type,quantity,from_location,to_location,
  reference_type,reference_id,action_note,source,moved_by,moved_at
)
values
  (
    '73000000-0000-0000-0000-000000000001',
    'INV-FACT-SKU','Inventory Fact SKU','RECEIVE',24,null,'INV-A1',
    'WAREHOUSE_RECEIVING_LINE','inventory-fact-receive-1',
    'paired base receipt','WAREHOUSE_RECEIVING_BATCH',null,
    '2026-07-29 08:00:00+09:30'
  ),
  (
    '73000000-0000-0000-0000-000000000002',
    'INV-FACT-SKU','Inventory Fact SKU','ADJUST_OUT',3,'INV-A1',null,
    'MANUAL','inventory-fact-adjust-1','base-only adjustment',
    'INVENTORY_CONTROL',null,'2026-07-29 08:30:00+09:30'
  );

insert into public.ecoflow_warehouse_movements(
  id,movement_type,location_id,to_location_id,sku,product_name,barcode,
  unit_level,quantity,note,actor_user_id,created_at,reference_type,reference_id
)
values
  (
    '74000000-0000-0000-0000-000000000001',
    'RECEIVE','71000000-0000-0000-0000-000000000001',
    '71000000-0000-0000-0000-000000000001',
    'INV-FACT-SKU','Inventory Fact SKU','940000000001','carton',2,
    'paired package receipt',null,'2026-07-29 08:00:00+09:30',
    'WAREHOUSE_RECEIVING_LINE','inventory-fact-receive-1'
  ),
  (
    '74000000-0000-0000-0000-000000000002',
    'PICK','71000000-0000-0000-0000-000000000001',null,
    'INV-FACT-SKU','Inventory Fact SKU','940000000001','carton',1,
    'controlled package pick',null,'2026-07-29 09:00:00+09:30',null,null
  ),
  (
    '74000000-0000-0000-0000-000000000003',
    'LEGACY_UNKNOWN','71000000-0000-0000-0000-000000000002',null,
    'INV-FACT-UNKNOWN','Unknown inventory item',null,'unknown',2,
    'legacy event with unknown semantics',null,
    '2026-07-29 09:15:00+09:30',null,null
  );

insert into public.ecoflow_warehouse_location_items(
  id,location_id,sku,product_name,source_barcode,unit_level,quantity,status,
  last_movement_at,last_note,created_at,updated_at
)
values
  (
    '75000000-0000-0000-0000-000000000001',
    '71000000-0000-0000-0000-000000000001',
    'INV-FACT-SKU','Inventory Fact SKU','940000000001','carton',1,'ACTIVE',
    '2026-07-29 09:00:00+09:30','one carton after pick',
    '2026-07-29 08:00:00+09:30','2026-07-29 09:00:00+09:30'
  ),
  (
    '75000000-0000-0000-0000-000000000002',
    '71000000-0000-0000-0000-000000000002',
    'INV-FACT-UNKNOWN','Unknown inventory item',null,'unknown',5,'HOLD',
    null,'conversion deliberately unknown',
    '2026-07-29 09:15:00+09:30','2026-07-29 09:15:00+09:30'
  ),
  (
    '75000000-0000-0000-0000-000000000003',
    '71000000-0000-0000-0000-000000000002',
    'INV-FACT-NEGATIVE','Negative test item',null,'each',-1,'HOLD',
    '2026-07-29 09:20:00+09:30','invalid negative balance',
    '2026-07-29 09:20:00+09:30','2026-07-29 09:20:00+09:30'
  );

set role service_role;
select *
from analytics.refresh_inventory_movement_and_snapshot_facts(
  '2026-07-29 12:00:00+09:30'
);

select public.ecoflow_inventory_fact_expect_denied(
  $sql$insert into analytics.fact_inventory_movement(
    source_domain,source_movement_id,source_movement_key,sku_identity_status,
    movement_type,movement_direction,native_unit_level,
    paired_reference_status,quality_status,source_row_hash,
    first_observed_at,last_observed_at,as_of_at
  ) values (
    'GLOBAL_BASE',gen_random_uuid(),'FORGED','UNRESOLVED','RECEIVE','IN',
    'BASE_UNIT','NOT_APPLICABLE','TRUSTED',repeat('a',64),now(),now(),now()
  )$sql$
);
reset role;

do $first_refresh$
declare
  v_quality record;
begin
  if (
    select count(*) from analytics.fact_inventory_movement
    where source_movement_key like 'GLOBAL_BASE:73000000-%'
       or source_movement_key like 'LOCATION_PACKAGE:74000000-%'
  )<>5 then
    raise exception 'movement source rows were collapsed or omitted';
  end if;

  if not exists(
    select 1 from analytics.fact_inventory_movement
    where source_domain='GLOBAL_BASE'
      and source_movement_id='73000000-0000-0000-0000-000000000001'
      and movement_direction='IN' and signed_quantity=24
      and native_unit_level='BASE_UNIT'
      and paired_reference_status='PAIRED_REFERENCE'
  ) then
    raise exception 'global base receiving fact is incorrect';
  end if;

  if not exists(
    select 1 from analytics.fact_inventory_movement
    where source_domain='LOCATION_PACKAGE'
      and source_movement_id='74000000-0000-0000-0000-000000000001'
      and movement_direction='IN' and signed_quantity=2
      and native_unit_level='carton'
      and paired_reference_status='PAIRED_REFERENCE'
  ) then
    raise exception 'location package receiving fact is incorrect';
  end if;

  if not exists(
    select 1 from analytics.fact_inventory_movement
    where source_movement_id='74000000-0000-0000-0000-000000000002'
      and movement_direction='OUT' and signed_quantity=-1
      and source_domain='LOCATION_PACKAGE'
  ) then
    raise exception 'package pick direction is incorrect';
  end if;

  if not exists(
    select 1 from analytics.fact_inventory_movement
    where source_movement_id='74000000-0000-0000-0000-000000000003'
      and movement_direction='UNKNOWN' and signed_quantity is null
      and quality_status='DEGRADED'
  ) then
    raise exception 'unknown movement semantics were guessed';
  end if;

  if (
    select count(*) from analytics.fact_daily_inventory_snapshot
    where snapshot_date='2026-07-29'
      and source_item_id in (
        '75000000-0000-0000-0000-000000000001',
        '75000000-0000-0000-0000-000000000002',
        '75000000-0000-0000-0000-000000000003'
      )
  )<>3 then
    raise exception 'daily location snapshot rows are incomplete';
  end if;

  if not exists(
    select 1 from analytics.fact_daily_inventory_snapshot
    where source_item_id='75000000-0000-0000-0000-000000000001'
      and snapshot_date='2026-07-29'
      and native_quantity=1
      and unit_level='carton'
      and base_units_per_native=12
      and base_equivalent_quantity=12
      and conversion_status='CONVERTED_ACTIVE_BARCODE'
      and quality_status='TRUSTED'
      and reconciliation_status='NOT_ESTABLISHED'
      and warehouse_location_dimension_id is not null
  ) then
    raise exception 'trusted carton snapshot conversion is incorrect';
  end if;

  if not exists(
    select 1 from analytics.fact_daily_inventory_snapshot
    where source_item_id='75000000-0000-0000-0000-000000000002'
      and snapshot_date='2026-07-29'
      and native_quantity=5
      and base_equivalent_quantity is null
      and conversion_status='UNKNOWN_UNIT'
      and quality_status='DEGRADED'
  ) then
    raise exception 'unknown unit was force-converted';
  end if;

  if not exists(
    select 1 from analytics.fact_daily_inventory_snapshot
    where source_item_id='75000000-0000-0000-0000-000000000003'
      and snapshot_date='2026-07-29'
      and quality_status='INVALID'
      and quality_detail='NEGATIVE_LOCATION_BALANCE'
  ) then
    raise exception 'negative location balance was not surfaced';
  end if;

  select * into v_quality
  from analytics.v_daily_inventory_snapshot_quality
  where snapshot_date='2026-07-29';

  if v_quality.snapshot_row_count<3
     or v_quality.unconverted_row_count<2
     or v_quality.all_rows_convertible then
    raise exception 'snapshot quality summary hides conversion gaps: %',
      row_to_json(v_quality);
  end if;

  if exists(
    select 1 from analytics.refresh_status
    where dataset_key in (
      'analytics.inventory_movements','analytics.daily_inventory_snapshot'
    ) and status<>'CURRENT'
  ) then
    raise exception 'inventory refresh statuses are not CURRENT';
  end if;
end;
$first_refresh$;

update public.ecoflow_warehouse_location_items
set quantity=2,updated_at='2026-07-29 13:00:00+09:30'
where id='75000000-0000-0000-0000-000000000001';

set role service_role;
select *
from analytics.refresh_inventory_movement_and_snapshot_facts(
  '2026-07-29 13:05:00+09:30'
);
reset role;

do $same_day_refresh$
begin
  if (
    select count(*) from analytics.fact_daily_inventory_snapshot
    where snapshot_date='2026-07-29'
      and source_item_id='75000000-0000-0000-0000-000000000001'
  )<>1 then
    raise exception 'same-day snapshot refresh duplicated a row';
  end if;

  if not exists(
    select 1 from analytics.fact_daily_inventory_snapshot
    where snapshot_date='2026-07-29'
      and source_item_id='75000000-0000-0000-0000-000000000001'
      and native_quantity=2 and base_equivalent_quantity=24
      and snapshot_at='2026-07-29 13:05:00+09:30'
  ) then
    raise exception 'same-day snapshot did not update in place';
  end if;

  if (
    select count(*) from analytics.fact_inventory_movement
    where source_movement_key like 'GLOBAL_BASE:73000000-%'
       or source_movement_key like 'LOCATION_PACKAGE:74000000-%'
  )<>5 then
    raise exception 'movement refresh duplicated immutable source rows';
  end if;
end;
$same_day_refresh$;

set role service_role;
select *
from analytics.refresh_inventory_movement_and_snapshot_facts(
  '2026-07-30 08:00:00+09:30'
);
reset role;

do $next_day_snapshot$
begin
  if (
    select count(*) from analytics.fact_daily_inventory_snapshot
    where source_item_id='75000000-0000-0000-0000-000000000001'
      and snapshot_date in ('2026-07-29','2026-07-30')
  )<>2 then
    raise exception 'next-day snapshot did not preserve daily history';
  end if;
end;
$next_day_snapshot$;

rollback;
