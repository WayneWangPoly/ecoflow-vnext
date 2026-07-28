\set ON_ERROR_STOP on

begin;

create or replace function public.ecoflow_facts_test_expect_error(
  p_sql text,
  p_marker text
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog,public
as $$
begin
  execute p_sql;
  raise exception 'EXPECTED_ERROR_NOT_RAISED: %',p_sql;
exception
  when others then
    if sqlerrm like 'EXPECTED_ERROR_NOT_RAISED:%' then
      raise;
    end if;
    if position(p_marker in sqlerrm)=0 then
      raise exception 'EXPECTED_ERROR_MARKER_MISSING: expected %, got %',
        p_marker,sqlerrm;
    end if;
end;
$$;

revoke all on function public.ecoflow_facts_test_expect_error(text,text)
  from public,anon,authenticated;
grant execute on function public.ecoflow_facts_test_expect_error(text,text)
  to service_role;

do $structure$
declare
  v_object text;
begin
  foreach v_object in array array[
    'public.ecoflow_order_fulfilment_allocations',
    'analytics.fact_order_line',
    'analytics.fact_fulfilment_line',
    'analytics.v_order_fulfilment_coverage'
  ]
  loop
    if to_regclass(v_object) is null then
      raise exception 'order/fulfilment fact object missing: %',v_object;
    end if;
  end loop;

  if to_regprocedure(
    'public.ecoflow_record_order_fulfilment_allocation(text,text,text,uuid,numeric,text,text,numeric,text,jsonb,text,timestamptz,uuid,text)'
  ) is null then
    raise exception 'record fulfilment command missing';
  end if;

  if to_regprocedure(
    'public.ecoflow_void_order_fulfilment_allocation(uuid,text,uuid)'
  ) is null then
    raise exception 'void fulfilment command missing';
  end if;

  if to_regprocedure(
    'analytics.refresh_order_fulfilment_facts(timestamptz)'
  ) is null then
    raise exception 'fact refresh function missing';
  end if;

  if not (
    select relrowsecurity
    from pg_class
    where oid='public.ecoflow_order_fulfilment_allocations'::regclass
  ) then
    raise exception 'operational fulfilment ledger is missing RLS';
  end if;

  if not (
    select relrowsecurity
    from pg_class
    where oid='analytics.fact_order_line'::regclass
  ) or not (
    select relrowsecurity
    from pg_class
    where oid='analytics.fact_fulfilment_line'::regclass
  ) then
    raise exception 'analytics facts are missing RLS';
  end if;

  if has_table_privilege(
      'anon','public.ecoflow_order_fulfilment_allocations','SELECT'
    )
    or has_table_privilege(
      'authenticated','public.ecoflow_order_fulfilment_allocations','SELECT'
    )
    or has_table_privilege(
      'service_role','public.ecoflow_order_fulfilment_allocations','INSERT'
    )
    or has_table_privilege(
      'service_role','public.ecoflow_order_fulfilment_allocations','UPDATE'
    ) then
    raise exception 'fulfilment ledger bypasses command-only writes';
  end if;

  if not has_table_privilege(
      'service_role','public.ecoflow_order_fulfilment_allocations','SELECT'
    ) then
    raise exception 'service role cannot inspect fulfilment ledger';
  end if;

  if has_table_privilege('authenticated','analytics.fact_order_line','SELECT')
    or has_table_privilege(
      'authenticated','analytics.fact_fulfilment_line','SELECT'
    ) then
    raise exception 'facts are directly browser-readable before projections';
  end if;

  if not has_table_privilege('service_role','analytics.fact_order_line','SELECT')
    or not has_table_privilege(
      'service_role','analytics.fact_fulfilment_line','SELECT'
    )
    or has_table_privilege('service_role','analytics.fact_order_line','INSERT')
    or has_table_privilege('service_role','analytics.fact_order_line','UPDATE')
    or has_table_privilege('service_role','analytics.fact_order_line','DELETE')
    or has_table_privilege('service_role','analytics.fact_order_line','TRUNCATE')
    or has_table_privilege(
      'service_role','analytics.fact_fulfilment_line','INSERT'
    )
    or has_table_privilege(
      'service_role','analytics.fact_fulfilment_line','UPDATE'
    )
    or has_table_privilege(
      'service_role','analytics.fact_fulfilment_line','DELETE'
    )
    or has_table_privilege(
      'service_role','analytics.fact_fulfilment_line','TRUNCATE'
    ) then
    raise exception 'service role can bypass the controlled fact refresh';
  end if;

  if has_function_privilege(
      'authenticated',
      'public.ecoflow_record_order_fulfilment_allocation(text,text,text,uuid,numeric,text,text,numeric,text,jsonb,text,timestamptz,uuid,text)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.ecoflow_void_order_fulfilment_allocation(uuid,text,uuid)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'analytics.refresh_order_fulfilment_facts(timestamptz)',
      'EXECUTE'
    ) then
    raise exception 'browser role can execute service-only fact commands';
  end if;

  if not has_function_privilege(
      'service_role',
      'public.ecoflow_record_order_fulfilment_allocation(text,text,text,uuid,numeric,text,text,numeric,text,jsonb,text,timestamptz,uuid,text)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.ecoflow_void_order_fulfilment_allocation(uuid,text,uuid)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'analytics.refresh_order_fulfilment_facts(timestamptz)',
      'EXECUTE'
    ) then
    raise exception 'service role fact command grants are incomplete';
  end if;

  if exists(
    select 1
    from analytics.metric_definition
    where metric_key in ('revenue','gross_margin','fill_rate','substitution_rate')
      and status<>'DRAFT'
  ) then
    raise exception 'fact package activated a KPI before projection reconciliation';
  end if;
end;
$structure$;

do $empty_before_refresh$
begin
  if exists(select 1 from analytics.fact_order_line)
     or exists(select 1 from analytics.fact_fulfilment_line) then
    raise exception 'fact tables were populated before controlled refresh';
  end if;
end;
$empty_before_refresh$;

insert into public.ordermentum_raw_orders(
  id,external_order_id,external_order_number,status,payment_status,delivery_date,
  external_created_at,external_updated_at,last_synced_at
)
values(
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'OM-1001','Accepted','Paid','2026-07-30 00:00:00+09:30',
  '2026-07-28 08:00:00+09:30','2026-07-28 09:00:00+09:30',
  '2026-07-28 09:05:00+09:30'
);

insert into public.om_orders(id,order_number,invoice_number)
values(
  '20000000-0000-0000-0000-000000000001',
  'OM-1001','INV-1001'
);

insert into public.om_order_items(
  id,order_id,sku,name,quantity,unit,price,subtotal,gst,total
)
values(
  '30000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'GLOVE-M-BLK','Medium Black Gloves',10,'Carton',10,100,10,110
);

insert into public.ecoflow_ordermentum_internal_orders(
  id,raw_order_id,external_order_id,external_order_number,invoice_number,
  order_number,payment_status,invoice_payment_status,invoice_total,total_due,
  line_count,status,account_release_status,warehouse_gate_status,last_synced_at
)
values(
  '40000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'OM-1001','INV-1001','OM-1001','Paid','Paid',110,0,1,'IMPORTED',
  'READY_FOR_ACCOUNT_RELEASE','READY_FOR_WAREHOUSE_PRECHECK',
  '2026-07-28 09:05:00+09:30'
);

insert into public.ecoflow_sku_barcode_confirmations(
  provider,external_sku_code,status
)
values('ORDERMENTUM','GLOVE-M-BLK','CONFIRMED');

insert into public.skus(id,sku_code,display_name)
values
  (
    '50000000-0000-0000-0000-000000000001',
    'BRAND-A-GLOVE-M-BLK','Brand A Medium Black Gloves'
  ),
  (
    '50000000-0000-0000-0000-000000000002',
    'BRAND-B-GLOVE-M-BLK','Brand B Medium Black Gloves'
  );

insert into public.om_order_items(
  id,order_id,sku,name,quantity,unit,price,subtotal,gst,total
)
values(
  '30000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000001',
  'DELIVERY-FEE','Delivery Fee',1,'Each',5,5,0.50,5.50
);

insert into public.ecoflow_sku_barcode_confirmations(
  provider,external_sku_code,status
)
values('ORDERMENTUM','DELIVERY-FEE','SERVICE_ITEM');

set role service_role;
select public.ecoflow_facts_test_expect_error(
  $sql$select * from public.ecoflow_record_order_fulfilment_allocation(
    'pick:OM-1001:DELIVERY-FEE:invalid-physical',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000002',
    '50000000-0000-0000-0000-000000000001',
    1,'EACH','PRIMARY',0,null
  )$sql$,
  'FULFILMENT_SERVICE_LINE_NOT_PHYSICAL'
);
reset role;

delete from public.ecoflow_sku_barcode_confirmations
where provider='ORDERMENTUM' and external_sku_code='DELIVERY-FEE';
delete from public.om_order_items
where id='30000000-0000-0000-0000-000000000002';

create temporary table pg_temp.ecoflow_fulfilment_test_results(
  result_name text primary key,
  allocation_id uuid not null,
  replayed boolean not null,
  allocation_status text not null,
  revision bigint not null
) on commit drop;

grant select,insert on pg_temp.ecoflow_fulfilment_test_results to service_role;

set role service_role;

insert into pg_temp.ecoflow_fulfilment_test_results
select 'primary',r.*
from public.ecoflow_record_order_fulfilment_allocation(
  'pick:OM-1001:GLOVE-M-BLK:brand-a',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  6,'carton','PRIMARY',6.50,null,'{}'::jsonb,'A1',
  '2026-07-29 08:00:00+09:30',
  '60000000-0000-0000-0000-000000000001','Warehouse Test'
) as r;

insert into pg_temp.ecoflow_fulfilment_test_results
select 'replay',r.*
from public.ecoflow_record_order_fulfilment_allocation(
  'pick:OM-1001:GLOVE-M-BLK:brand-a',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  6,'CARTON','PRIMARY',6.50,null,'{}'::jsonb,'A1',
  '2026-07-29 08:00:00+09:30',
  '60000000-0000-0000-0000-000000000001','Warehouse Test'
) as r;

reset role;

do $idempotency$
declare
  v_primary pg_temp.ecoflow_fulfilment_test_results%rowtype;
  v_replay pg_temp.ecoflow_fulfilment_test_results%rowtype;
begin
  select * into v_primary
  from pg_temp.ecoflow_fulfilment_test_results
  where result_name='primary';

  select * into v_replay
  from pg_temp.ecoflow_fulfilment_test_results
  where result_name='replay';

  if v_primary.allocation_id<>v_replay.allocation_id
     or v_primary.replayed
     or not v_replay.replayed then
    raise exception 'fulfilment event replay contract failed';
  end if;
end;
$idempotency$;

set role service_role;

select public.ecoflow_facts_test_expect_error(
  $sql$select * from public.ecoflow_record_order_fulfilment_allocation(
    'pick:OM-1001:GLOVE-M-BLK:no-reason',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000002',
    1,'CARTON','APPROVED_SUBSTITUTE',6.25,null
  )$sql$,
  'FULFILMENT_SUBSTITUTION_REASON_REQUIRED'
);

select public.ecoflow_facts_test_expect_error(
  $sql$select * from public.ecoflow_record_order_fulfilment_allocation(
    'pick:OM-1001:GLOVE-M-BLK:wrong-unit',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000002',
    1,'SLEEVE','APPROVED_SUBSTITUTE',6.25,'Brand A unavailable'
  )$sql$,
  'FULFILMENT_UNIT_CONVERSION_REQUIRED'
);

insert into pg_temp.ecoflow_fulfilment_test_results
select 'substitute',r.*
from public.ecoflow_record_order_fulfilment_allocation(
  'pick:OM-1001:GLOVE-M-BLK:brand-b',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000002',
  4,'CARTON','APPROVED_SUBSTITUTE',6.25,
  'Brand A unavailable; approved Brand B equivalent',
  '{"approval":"warehouse-equivalence-test"}'::jsonb,'A2',
  '2026-07-29 08:05:00+09:30',
  '60000000-0000-0000-0000-000000000001','Warehouse Test'
) as r;

select public.ecoflow_facts_test_expect_error(
  $sql$select * from public.ecoflow_record_order_fulfilment_allocation(
    'pick:OM-1001:GLOVE-M-BLK:over',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000002',
    1,'CARTON','APPROVED_SUBSTITUTE',6.25,'Extra carton'
  )$sql$,
  'FULFILMENT_QUANTITY_EXCEEDS_ORDERED'
);

select public.ecoflow_facts_test_expect_error(
  $sql$select * from public.ecoflow_record_order_fulfilment_allocation(
    'pick:OM-1001:GLOVE-M-BLK:brand-a',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001',
    5,'CARTON','PRIMARY',6.50,null
  )$sql$,
  'FULFILMENT_EVENT_KEY_CONFLICT'
);

select *
from analytics.refresh_order_fulfilment_facts(
  '2026-07-29 09:00:00+09:30'
);

reset role;

do $first_refresh$
declare
  v_coverage record;
begin
  if (select count(*) from analytics.fact_order_line where is_current)<>1 then
    raise exception 'unexpected current order-line fact count';
  end if;
  if (select count(*) from analytics.fact_fulfilment_line)<>2 then
    raise exception 'default mapping or pick summary was inferred as fulfilment';
  end if;

  select * into v_coverage
  from analytics.v_order_fulfilment_coverage
  where source_order_line_key=
    '20000000-0000-0000-0000-000000000001:30000000-0000-0000-0000-000000000001';

  if v_coverage.coverage_status<>'FULL'
     or v_coverage.active_fulfilled_quantity<>10
     or v_coverage.active_substituted_quantity<>4
     or v_coverage.active_allocation_count<>2 then
    raise exception 'full/substitution coverage contract failed: %',
      row_to_json(v_coverage);
  end if;

  if not exists(
    select 1
    from analytics.fact_fulfilment_line
    where allocation_id=(
      select allocation_id
      from pg_temp.ecoflow_fulfilment_test_results
      where result_name='substitute'
    )
      and commercial_sku_code='GLOVE-M-BLK'
      and physical_sku_code='BRAND-B-GLOVE-M-BLK'
      and substitution_flag
      and allocation_type='APPROVED_SUBSTITUTE'
      and actual_unit_cost=6.25
      and substitution_reason is not null
  ) then
    raise exception 'commercial-to-physical substitution fact is incomplete';
  end if;

  if exists(
    select 1
    from analytics.refresh_status
    where dataset_key in (
      'analytics.order_lines','analytics.fulfilment_lines'
    )
      and status<>'CURRENT'
  ) then
    raise exception 'fact refresh status did not become CURRENT';
  end if;
end;
$first_refresh$;

-- Observation time alone must not manufacture a new business fact version.
update public.ordermentum_raw_orders
set last_synced_at='2026-07-29 09:30:00+09:30'
where id='10000000-0000-0000-0000-000000000001';
update public.ecoflow_ordermentum_internal_orders
set last_synced_at='2026-07-29 09:30:00+09:30'
where id='40000000-0000-0000-0000-000000000001';

set role service_role;
select *
from analytics.refresh_order_fulfilment_facts(
  '2026-07-29 09:35:00+09:30'
);
reset role;

do $observation_only_refresh$
begin
  if (
    select count(*)
    from analytics.fact_order_line
    where source_order_line_key=
      '20000000-0000-0000-0000-000000000001:30000000-0000-0000-0000-000000000001'
  )<>1 then
    raise exception 'observation-only sync created a false fact version';
  end if;

  if not exists(
    select 1
    from analytics.fact_order_line
    where source_order_line_key=
      '20000000-0000-0000-0000-000000000001:30000000-0000-0000-0000-000000000001'
      and is_current
      and last_observed_at='2026-07-29 09:35:00+09:30'
      and source_last_synced_at='2026-07-29 09:30:00+09:30'
  ) then
    raise exception 'observation metadata was not advanced in place';
  end if;
end;
$observation_only_refresh$;

update public.om_order_items
set price=11,subtotal=110,gst=11,total=121
where id='30000000-0000-0000-0000-000000000001';

update public.ordermentum_raw_orders
set external_updated_at='2026-07-29 10:00:00+09:30',
    last_synced_at='2026-07-29 10:01:00+09:30'
where id='10000000-0000-0000-0000-000000000001';

set role service_role;
select *
from analytics.refresh_order_fulfilment_facts(
  '2026-07-29 10:05:00+09:30'
);
reset role;

do $version_history$
begin
  if (
    select count(*)
    from analytics.fact_order_line
    where source_order_line_key=
      '20000000-0000-0000-0000-000000000001:30000000-0000-0000-0000-000000000001'
  )<>2 then
    raise exception 'order-line history was not versioned';
  end if;

  if (
    select count(*)
    from analytics.fact_order_line
    where source_order_line_key=
      '20000000-0000-0000-0000-000000000001:30000000-0000-0000-0000-000000000001'
      and is_current
      and unit_price=11
      and line_total=121
  )<>1 then
    raise exception 'updated order-line version is not current';
  end if;

  if (
    select count(*)
    from analytics.fact_order_line
    where source_order_line_key=
      '20000000-0000-0000-0000-000000000001:30000000-0000-0000-0000-000000000001'
      and not is_current
      and unit_price=10
      and line_total=110
      and effective_to='2026-07-29 10:05:00+09:30'
  )<>1 then
    raise exception 'historical order-line version was overwritten';
  end if;
end;
$version_history$;

set role service_role;
select *
from public.ecoflow_void_order_fulfilment_allocation(
  (
    select allocation_id
    from pg_temp.ecoflow_fulfilment_test_results
    where result_name='substitute'
  ),
  'Test correction: substituted cartons returned to allocation pool',
  '60000000-0000-0000-0000-000000000001'
);
select *
from analytics.refresh_order_fulfilment_facts(
  '2026-07-29 11:00:00+09:30'
);
reset role;

do $void_projection$
declare
  v_coverage record;
begin
  select * into v_coverage
  from analytics.v_order_fulfilment_coverage
  where source_order_line_key=
    '20000000-0000-0000-0000-000000000001:30000000-0000-0000-0000-000000000001';

  if v_coverage.coverage_status<>'PARTIAL'
     or v_coverage.active_fulfilled_quantity<>6
     or v_coverage.active_substituted_quantity<>0
     or v_coverage.active_allocation_count<>1
     or v_coverage.voided_allocation_count<>1 then
    raise exception 'voided allocation coverage contract failed: %',
      row_to_json(v_coverage);
  end if;

  if not exists(
    select 1
    from analytics.fact_fulfilment_line
    where allocation_id=(
      select allocation_id
      from pg_temp.ecoflow_fulfilment_test_results
      where result_name='substitute'
    )
      and allocation_status='VOIDED'
      and source_revision=2
  ) then
    raise exception 'voided operational allocation was not projected';
  end if;
end;
$void_projection$;

rollback;
