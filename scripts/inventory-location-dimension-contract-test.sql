\set ON_ERROR_STOP on

begin;

insert into public.ecoflow_warehouse_locations(
  id,location_code,rack_id,rack_title,side,display_level,location_category,
  status,sort_order,updated_at
)
values(
  '76000000-0000-0000-0000-000000000001',
  'INV-DIM-A1','INV-DIM-RACK-A','Inventory dimension rack A','front','Bottom',
  'PICK_FACE','ACTIVE',1101,'2026-07-29 08:00:00+09:30'
);

insert into public.ecoflow_warehouse_location_items(
  id,location_id,sku,product_name,source_barcode,unit_level,quantity,status,
  last_movement_at,last_note,created_at,updated_at
)
values(
  '78000000-0000-0000-0000-000000000001',
  '76000000-0000-0000-0000-000000000001',
  'INV-DIM-SKU','Inventory Dimension SKU',null,'each',5,'ACTIVE',
  '2026-07-29 09:00:00+09:30','dimension snapshot contract',
  '2026-07-29 09:00:00+09:30','2026-07-29 09:00:00+09:30'
);

insert into public.ecoflow_warehouse_movements(
  id,movement_type,location_id,to_location_id,sku,product_name,barcode,
  unit_level,quantity,note,actor_user_id,created_at,reference_type,reference_id
)
values(
  '77000000-0000-0000-0000-000000000001',
  'MOVE','76000000-0000-0000-0000-000000000001',
  '76000000-0000-0000-0000-000000000001',
  'INV-DIM-SKU','Inventory Dimension SKU',null,'each',1,
  'first location dimension movement',null,'2026-07-29 09:00:00+09:30',
  null,null
);

set role service_role;
select *
from analytics.refresh_inventory_movement_and_snapshot_facts(
  '2026-07-29 09:30:00+09:30'
);
reset role;

do $first_resolution$
declare
  v_fact record;
  v_snapshot record;
  v_dim record;
begin
  select * into v_fact
  from analytics.fact_inventory_movement
  where source_domain='LOCATION_PACKAGE'
    and source_movement_id='77000000-0000-0000-0000-000000000001';

  if v_fact.from_location_dimension_id is null
     or v_fact.to_location_dimension_id is null
     or v_fact.from_location_dimension_id<>v_fact.to_location_dimension_id then
    raise exception 'first refresh did not resolve movement location dimensions';
  end if;

  select * into v_snapshot
  from analytics.fact_daily_inventory_snapshot
  where snapshot_date='2026-07-29'
    and source_item_id='78000000-0000-0000-0000-000000000001';

  if v_snapshot.warehouse_location_dimension_id is null
     or v_snapshot.warehouse_location_dimension_id<>
        v_fact.from_location_dimension_id then
    raise exception 'first daily snapshot did not resolve the initial location dimension';
  end if;

  select * into v_dim
  from analytics.dim_warehouse_location
  where warehouse_location_dimension_id=v_fact.from_location_dimension_id;

  if v_dim.source_system<>'ECOFLOW'
     or v_dim.source_location_key<>'76000000-0000-0000-0000-000000000001'
     or v_dim.location_code<>'INV-DIM-A1'
     or v_dim.rack_code<>'INV-DIM-RACK-A'
     or v_dim.zone_code<>'PICK_FACE'
     or not v_dim.is_current then
    raise exception 'initial location dimension content is incorrect: %',
      row_to_json(v_dim);
  end if;
end;
$first_resolution$;

update public.ecoflow_warehouse_locations
set rack_id='INV-DIM-RACK-B',
    rack_title='Inventory dimension rack B',
    location_category='OVERFLOW',
    updated_at='2026-07-30 07:00:00+09:30'
where id='76000000-0000-0000-0000-000000000001';

update public.ecoflow_warehouse_location_items
set quantity=7,
    last_movement_at='2026-07-30 08:00:00+09:30',
    updated_at='2026-07-30 08:00:00+09:30'
where id='78000000-0000-0000-0000-000000000001';

insert into public.ecoflow_warehouse_movements(
  id,movement_type,location_id,to_location_id,sku,product_name,barcode,
  unit_level,quantity,note,actor_user_id,created_at,reference_type,reference_id
)
values(
  '77000000-0000-0000-0000-000000000002',
  'MOVE','76000000-0000-0000-0000-000000000001',
  '76000000-0000-0000-0000-000000000001',
  'INV-DIM-SKU','Inventory Dimension SKU',null,'each',1,
  'changed location dimension movement',null,'2026-07-30 08:00:00+09:30',
  null,null
);

set role service_role;
select *
from analytics.refresh_inventory_movement_and_snapshot_facts(
  '2026-07-30 08:30:00+09:30'
);
reset role;

do $scd_resolution$
declare
  v_old_id bigint;
  v_new_id bigint;
begin
  select warehouse_location_dimension_id into v_old_id
  from analytics.dim_warehouse_location
  where source_system='ECOFLOW'
    and source_location_key='76000000-0000-0000-0000-000000000001'
    and not is_current
    and rack_code='INV-DIM-RACK-A';

  select warehouse_location_dimension_id into v_new_id
  from analytics.dim_warehouse_location
  where source_system='ECOFLOW'
    and source_location_key='76000000-0000-0000-0000-000000000001'
    and is_current
    and rack_code='INV-DIM-RACK-B'
    and zone_code='OVERFLOW';

  if v_old_id is null or v_new_id is null or v_old_id=v_new_id then
    raise exception 'location dimension change was not versioned';
  end if;

  if not exists(
    select 1 from analytics.fact_inventory_movement
    where source_movement_id='77000000-0000-0000-0000-000000000001'
      and from_location_dimension_id=v_old_id
      and to_location_dimension_id=v_old_id
  ) then
    raise exception 'historic movement lost its original location dimension';
  end if;

  if not exists(
    select 1 from analytics.fact_inventory_movement
    where source_movement_id='77000000-0000-0000-0000-000000000002'
      and from_location_dimension_id=v_new_id
      and to_location_dimension_id=v_new_id
  ) then
    raise exception 'new movement did not use the current location dimension';
  end if;

  if not exists(
    select 1 from analytics.fact_daily_inventory_snapshot
    where snapshot_date='2026-07-29'
      and source_item_id='78000000-0000-0000-0000-000000000001'
      and warehouse_location_dimension_id=v_old_id
      and native_quantity=5
  ) then
    raise exception 'historic daily snapshot lost its original location dimension';
  end if;

  if not exists(
    select 1 from analytics.fact_daily_inventory_snapshot
    where snapshot_date='2026-07-30'
      and source_item_id='78000000-0000-0000-0000-000000000001'
      and warehouse_location_dimension_id=v_new_id
      and native_quantity=7
  ) then
    raise exception 'new daily snapshot did not use the current location dimension';
  end if;
end;
$scd_resolution$;

rollback;