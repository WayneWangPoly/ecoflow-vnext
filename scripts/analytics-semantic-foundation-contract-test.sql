\set ON_ERROR_STOP on

begin;

insert into auth.users(id,email)
values
  ('11111111-1111-1111-1111-111111111111','driver.analytics@example.test'),
  ('22222222-2222-2222-2222-222222222222','warehouse.analytics@example.test'),
  ('33333333-3333-3333-3333-333333333333','account.analytics@example.test'),
  ('44444444-4444-4444-4444-444444444444','viewer.analytics@example.test'),
  ('55555555-5555-5555-5555-555555555555','owner.analytics@example.test'),
  ('66666666-6666-6666-6666-666666666666','admin.analytics@example.test'),
  ('77777777-7777-7777-7777-777777777777','inactive.analytics@example.test')
on conflict(id) do update set email=excluded.email;

insert into public.app_user_profiles(user_id,app_role,is_active,team_status)
values
  ('11111111-1111-1111-1111-111111111111','DRIVER',true,'ACTIVE'),
  ('22222222-2222-2222-2222-222222222222','WAREHOUSE',true,'ACTIVE'),
  ('33333333-3333-3333-3333-333333333333','ACCOUNT',true,'ACTIVE'),
  ('44444444-4444-4444-4444-444444444444','VIEWER',true,'ACTIVE'),
  ('55555555-5555-5555-5555-555555555555','OWNER',true,'ACTIVE'),
  ('66666666-6666-6666-6666-666666666666','ADMIN',true,'ACTIVE'),
  ('77777777-7777-7777-7777-777777777777','VIEWER',false,'SUSPENDED')
on conflict(user_id) do update
set app_role=excluded.app_role,is_active=excluded.is_active,team_status=excluded.team_status;

create or replace function public.ecoflow_analytics_test_expect_denied(
  p_sql text
)
returns void
language plpgsql
as $$
begin
  execute p_sql;
  raise exception 'EXPECTED_DENIAL_NOT_RAISED: %',p_sql;
exception
  when insufficient_privilege then null;
end;
$$;

revoke all on function public.ecoflow_analytics_test_expect_denied(text) from public;
grant execute on function public.ecoflow_analytics_test_expect_denied(text)
  to anon,authenticated;

do $structure$
declare
  v_name text;
  v_table text;
  v_rls_count integer;
  v_policy_count integer;
begin
  foreach v_name in array array[
    'analytics.metric_definition',
    'analytics.refresh_status',
    'analytics.data_quality_status',
    'analytics.dim_date',
    'analytics.dim_customer',
    'analytics.dim_store',
    'analytics.dim_supplier',
    'analytics.dim_brand',
    'analytics.dim_commercial_sku',
    'analytics.dim_physical_sku',
    'analytics.bridge_commercial_physical_sku',
    'analytics.dim_warehouse_location',
    'analytics.dim_driver',
    'analytics.dim_route',
    'analytics.dim_order_source',
    'analytics.dim_exception_type',
    'public.v_ecoflow_analytics_metric_catalog',
    'public.v_ecoflow_analytics_refresh_status',
    'public.v_ecoflow_analytics_data_quality',
    'public.v_ecoflow_analytics_health'
  ]
  loop
    if to_regclass(v_name) is null then
      raise exception 'analytics object missing: %',v_name;
    end if;
  end loop;

  select count(*) into v_rls_count
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='analytics'
    and c.relname in (
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
    )
    and c.relrowsecurity;

  if v_rls_count <> 16 then
    raise exception 'unexpected analytics RLS table count: %',v_rls_count;
  end if;

  select count(*) into v_policy_count
  from pg_policies
  where schemaname='analytics';

  if v_policy_count <> 3 then
    raise exception 'unexpected analytics policy count: %',v_policy_count;
  end if;

  foreach v_table in array array[
    'analytics.metric_definition',
    'analytics.refresh_status',
    'analytics.data_quality_status',
    'analytics.dim_date',
    'analytics.dim_customer',
    'analytics.dim_store',
    'analytics.dim_supplier',
    'analytics.dim_brand',
    'analytics.dim_commercial_sku',
    'analytics.dim_physical_sku',
    'analytics.bridge_commercial_physical_sku',
    'analytics.dim_warehouse_location',
    'analytics.dim_driver',
    'analytics.dim_route',
    'analytics.dim_order_source',
    'analytics.dim_exception_type'
  ]
  loop
    if has_table_privilege('anon',v_table,'SELECT')
       or has_table_privilege('anon',v_table,'INSERT')
       or has_table_privilege('authenticated',v_table,'INSERT')
       or has_table_privilege('authenticated',v_table,'UPDATE')
       or has_table_privilege('authenticated',v_table,'DELETE')
       or has_table_privilege('authenticated',v_table,'TRUNCATE')
       or has_table_privilege('authenticated',v_table,'REFERENCES')
       or has_table_privilege('authenticated',v_table,'TRIGGER') then
      raise exception 'broad analytics ACL remains on %',v_table;
    end if;

    if not has_table_privilege('service_role',v_table,'SELECT')
       or not has_table_privilege('service_role',v_table,'INSERT')
       or not has_table_privilege('service_role',v_table,'UPDATE')
       or not has_table_privilege('service_role',v_table,'DELETE') then
      raise exception 'service_role analytics ACL incomplete on %',v_table;
    end if;
  end loop;

  if not has_table_privilege(
      'authenticated','analytics.metric_definition','SELECT'
    )
    or not has_table_privilege(
      'authenticated','analytics.refresh_status','SELECT'
    )
    or not has_table_privilege(
      'authenticated','analytics.data_quality_status','SELECT'
    ) then
    raise exception 'authenticated metadata read ACL is incomplete';
  end if;

  foreach v_table in array array[
    'analytics.dim_date',
    'analytics.dim_customer',
    'analytics.dim_store',
    'analytics.dim_supplier',
    'analytics.dim_brand',
    'analytics.dim_commercial_sku',
    'analytics.dim_physical_sku',
    'analytics.bridge_commercial_physical_sku',
    'analytics.dim_warehouse_location',
    'analytics.dim_driver',
    'analytics.dim_route',
    'analytics.dim_order_source',
    'analytics.dim_exception_type'
  ]
  loop
    if has_table_privilege('authenticated',v_table,'SELECT') then
      raise exception 'dimension is directly browser-readable: %',v_table;
    end if;
  end loop;

  if exists(
    select 1
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname in (
        'v_ecoflow_analytics_metric_catalog',
        'v_ecoflow_analytics_refresh_status',
        'v_ecoflow_analytics_data_quality',
        'v_ecoflow_analytics_health'
      )
      and not coalesce(c.reloptions,'{}'::text[])
        @> array['security_invoker=true']
  ) then
    raise exception 'an analytics public view is not security_invoker';
  end if;

  if has_function_privilege(
      'anon','analytics.touch_updated_at()','EXECUTE'
    )
    or has_function_privilege(
      'authenticated','analytics.touch_updated_at()','EXECUTE'
    ) then
    raise exception 'analytics trigger function remains browser-callable';
  end if;

  if (select count(*) from analytics.dim_date) <> 7671 then
    raise exception 'unexpected date dimension row count';
  end if;

  if not exists(
    select 1 from analytics.dim_date
    where date_key=date '2026-07-28'
      and business_day_key='2026-07-28'
      and financial_year_ending=2027
      and financial_quarter=1
  ) then
    raise exception 'Adelaide business-date dimension semantics are incorrect';
  end if;

  if (select count(*) from analytics.metric_definition) <> 10 then
    raise exception 'unexpected draft metric seed count';
  end if;

  if exists(
    select 1 from analytics.metric_definition where status <> 'DRAFT'
  ) then
    raise exception 'foundation migration incorrectly claims an active metric';
  end if;
end;
$structure$;

insert into analytics.dim_customer(
  source_system,source_customer_key,customer_code,customer_name,effective_from
)
values ('TEST','customer-1','C-1','Test Customer',clock_timestamp())
returning customer_dimension_id
\gset test_customer_

insert into analytics.dim_store(
  source_system,source_store_key,customer_dimension_id,store_code,store_name,effective_from
)
values (
  'TEST','store-1',:'test_customer_customer_dimension_id'::bigint,
  'S-1','Test Store',clock_timestamp()
)
returning store_dimension_id
\gset test_store_

insert into analytics.dim_supplier(
  source_system,source_supplier_key,supplier_code,supplier_name,effective_from
)
values ('TEST','supplier-1','SUP-1','Test Supplier',clock_timestamp())
returning supplier_dimension_id
\gset test_supplier_

insert into analytics.dim_brand(
  source_system,source_brand_key,brand_name,effective_from
)
values ('TEST','brand-1','Test Brand',clock_timestamp())
returning brand_dimension_id
\gset test_brand_

insert into analytics.dim_commercial_sku(
  source_system,source_commercial_sku_key,commercial_sku_code,product_name,
  sales_unit,sales_unit_quantity,effective_from
)
values (
  'TEST','commercial-1','GLOVE-M-BLK','Medium Black Gloves',
  'CARTON',10,clock_timestamp()
)
returning commercial_sku_dimension_id
\gset test_commercial_

insert into analytics.dim_physical_sku(
  source_system,source_physical_sku_key,physical_sku_code,product_name,
  supplier_dimension_id,brand_dimension_id,primary_barcode,package_level,
  units_per_package,effective_from
)
values (
  'TEST','physical-1','SUP-A-GLOVE-M-BLK','Supplier A Medium Black Gloves',
  :'test_supplier_supplier_dimension_id'::bigint,
  :'test_brand_brand_dimension_id'::bigint,
  '9300000000001','CARTON',10,clock_timestamp()
)
returning physical_sku_dimension_id
\gset test_physical_

insert into analytics.bridge_commercial_physical_sku(
  commercial_sku_dimension_id,physical_sku_dimension_id,relationship_type,
  fulfilment_priority,approved_reason,effective_from
)
values (
  :'test_commercial_commercial_sku_dimension_id'::bigint,
  :'test_physical_physical_sku_dimension_id'::bigint,
  'APPROVED_SUBSTITUTE',2,'test approved mapping',clock_timestamp()
);

do $separation$
begin
  if not exists(
    select 1
    from analytics.bridge_commercial_physical_sku b
    join analytics.dim_commercial_sku c
      on c.commercial_sku_dimension_id=b.commercial_sku_dimension_id
    join analytics.dim_physical_sku p
      on p.physical_sku_dimension_id=b.physical_sku_dimension_id
    where c.commercial_sku_code='GLOVE-M-BLK'
      and p.physical_sku_code='SUP-A-GLOVE-M-BLK'
      and c.commercial_sku_code <> p.physical_sku_code
      and b.relationship_type='APPROVED_SUBSTITUTE'
  ) then
    raise exception 'commercial and physical SKU separation contract failed';
  end if;
end;
$separation$;

update analytics.metric_definition
set status='ACTIVE'
where metric_key='fill_rate' and metric_version=1;

insert into analytics.data_quality_status(
  issue_key,dataset_key,severity,issue_type,title,detail,visible_to_roles
)
values
  (
    'test.order.cost','operational.orders','ERROR','MISSING_COST',
    'Order cost missing','A test order line lacks historical cost.',
    array['OWNER','ADMIN','ACCOUNT','VIEWER']::text[]
  ),
  (
    'test.inventory.barcode','operational.inventory','WARN','BARCODE_GAP',
    'Barcode coverage gap','A test physical SKU lacks a verified barcode.',
    array['OWNER','ADMIN','VIEWER','WAREHOUSE']::text[]
  ),
  (
    'test.delivery.pod','operational.delivery','CRITICAL','POD_MISSING',
    'POD missing','A test delivered stop lacks required proof.',
    array['OWNER','ADMIN','ACCOUNT','VIEWER','DRIVER']::text[]
  );

set role anon;
select public.ecoflow_analytics_test_expect_denied(
  'select * from public.v_ecoflow_analytics_metric_catalog'
);
select public.ecoflow_analytics_test_expect_denied(
  'select * from public.v_ecoflow_analytics_health'
);
reset role;

set role authenticated;
select set_config('request.jwt.claim.role','authenticated',false);
select set_config(
  'request.jwt.claim.sub',
  '55555555-5555-5555-5555-555555555555',
  false
);

select (count(*)=10) as owner_metric_ok
from public.v_ecoflow_analytics_metric_catalog
\gset
\if :owner_metric_ok
\else
  \echo 'owner metric visibility failed'
  \quit 1
\endif

select (count(*)=5) as owner_refresh_ok
from public.v_ecoflow_analytics_refresh_status
\gset
\if :owner_refresh_ok
\else
  \echo 'owner refresh visibility failed'
  \quit 1
\endif

select (count(*)=3) as owner_quality_ok
from public.v_ecoflow_analytics_data_quality
\gset
\if :owner_quality_ok
\else
  \echo 'owner quality visibility failed'
  \quit 1
\endif

select (count(*)=1) as owner_health_ok
from public.v_ecoflow_analytics_health
\gset
\if :owner_health_ok
\else
  \echo 'owner health visibility failed'
  \quit 1
\endif

select public.ecoflow_analytics_test_expect_denied(
  $$insert into analytics.metric_definition(
    metric_key,metric_version,display_name,business_definition,
    formula_description,grain_key,date_basis,unit_kind,
    freshness_sla,data_owner
  ) values (
    'browser_metric',1,'Browser Metric','invalid browser write',
    'none','none','none','COUNT',interval '5 minutes','Browser'
  )$$
);
select public.ecoflow_analytics_test_expect_denied(
  $$update analytics.refresh_status set status='CURRENT'
    where dataset_key='analytics.semantic'$$
);
select public.ecoflow_analytics_test_expect_denied(
  $$delete from analytics.data_quality_status
    where issue_key='test.delivery.pod'$$
);
select public.ecoflow_analytics_test_expect_denied(
  $$select * from analytics.dim_commercial_sku$$
);
reset role;

set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '44444444-4444-4444-4444-444444444444',
  false
);
select (count(*)=1) as viewer_metric_ok
from public.v_ecoflow_analytics_metric_catalog
\gset
\if :viewer_metric_ok
\else
  \echo 'viewer should see only active metrics'
  \quit 1
\endif
select (count(*)=5) as viewer_refresh_ok
from public.v_ecoflow_analytics_refresh_status
\gset
\if :viewer_refresh_ok
\else
  \echo 'viewer refresh visibility failed'
  \quit 1
\endif
select (count(*)=3) as viewer_quality_ok
from public.v_ecoflow_analytics_data_quality
\gset
\if :viewer_quality_ok
\else
  \echo 'viewer quality visibility failed'
  \quit 1
\endif
reset role;

set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '33333333-3333-3333-3333-333333333333',
  false
);
select (count(*)=1) as account_metric_ok
from public.v_ecoflow_analytics_metric_catalog
\gset
\if :account_metric_ok
\else
  \echo 'account metric visibility failed'
  \quit 1
\endif
select (count(*)=4) as account_refresh_ok
from public.v_ecoflow_analytics_refresh_status
\gset
\if :account_refresh_ok
\else
  \echo 'account refresh visibility failed'
  \quit 1
\endif
select (count(*)=2) as account_quality_ok
from public.v_ecoflow_analytics_data_quality
\gset
\if :account_quality_ok
\else
  \echo 'account quality visibility failed'
  \quit 1
\endif
reset role;

set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '22222222-2222-2222-2222-222222222222',
  false
);
select (count(*)=1) as warehouse_metric_ok
from public.v_ecoflow_analytics_metric_catalog
\gset
\if :warehouse_metric_ok
\else
  \echo 'warehouse metric visibility failed'
  \quit 1
\endif
select (count(*)=3) as warehouse_refresh_ok
from public.v_ecoflow_analytics_refresh_status
\gset
\if :warehouse_refresh_ok
\else
  \echo 'warehouse refresh visibility failed'
  \quit 1
\endif
select (count(*)=1) as warehouse_quality_ok
from public.v_ecoflow_analytics_data_quality
\gset
\if :warehouse_quality_ok
\else
  \echo 'warehouse quality visibility failed'
  \quit 1
\endif
reset role;

set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-1111-1111-111111111111',
  false
);
select (count(*)=1) as driver_metric_ok
from public.v_ecoflow_analytics_metric_catalog
\gset
\if :driver_metric_ok
\else
  \echo 'driver metric visibility failed'
  \quit 1
\endif
select (count(*)=2) as driver_refresh_ok
from public.v_ecoflow_analytics_refresh_status
\gset
\if :driver_refresh_ok
\else
  \echo 'driver refresh visibility failed'
  \quit 1
\endif
select (count(*)=1) as driver_quality_ok
from public.v_ecoflow_analytics_data_quality
\gset
\if :driver_quality_ok
\else
  \echo 'driver quality visibility failed'
  \quit 1
\endif
reset role;

set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '77777777-7777-7777-7777-777777777777',
  false
);
select (count(*)=0) as inactive_metric_ok
from public.v_ecoflow_analytics_metric_catalog
\gset
\if :inactive_metric_ok
\else
  \echo 'inactive user read metric metadata'
  \quit 1
\endif
select (count(*)=0) as inactive_refresh_ok
from public.v_ecoflow_analytics_refresh_status
\gset
\if :inactive_refresh_ok
\else
  \echo 'inactive user read refresh metadata'
  \quit 1
\endif
select (count(*)=0) as inactive_quality_ok
from public.v_ecoflow_analytics_data_quality
\gset
\if :inactive_quality_ok
\else
  \echo 'inactive user read quality metadata'
  \quit 1
\endif
select (count(*)=0) as inactive_health_ok
from public.v_ecoflow_analytics_health
\gset
\if :inactive_health_ok
\else
  \echo 'inactive user read analytics health'
  \quit 1
\endif
reset role;

rollback;
