\set ON_ERROR_STOP on

begin;

insert into auth.users(id,email)
values
  ('11111111-1111-1111-1111-111111111111','driver@example.test'),
  ('22222222-2222-2222-2222-222222222222','warehouse@example.test'),
  ('33333333-3333-3333-3333-333333333333','account@example.test'),
  ('44444444-4444-4444-4444-444444444444','viewer@example.test'),
  ('55555555-5555-5555-5555-555555555555','owner@example.test'),
  ('66666666-6666-6666-6666-666666666666','admin@example.test'),
  ('77777777-7777-7777-7777-777777777777','inactive-driver@example.test')
on conflict(id) do update set email=excluded.email;

insert into public.app_user_profiles(user_id,app_role,is_active,team_status)
values
  ('11111111-1111-1111-1111-111111111111','DRIVER',true,'ACTIVE'),
  ('22222222-2222-2222-2222-222222222222','WAREHOUSE',true,'ACTIVE'),
  ('33333333-3333-3333-3333-333333333333','ACCOUNT',true,'ACTIVE'),
  ('44444444-4444-4444-4444-444444444444','VIEWER',true,'ACTIVE'),
  ('55555555-5555-5555-5555-555555555555','OWNER',true,'ACTIVE'),
  ('66666666-6666-6666-6666-666666666666','ADMIN',true,'ACTIVE'),
  ('77777777-7777-7777-7777-777777777777','DRIVER',false,'SUSPENDED')
on conflict(user_id) do update
set app_role=excluded.app_role,is_active=excluded.is_active,team_status=excluded.team_status;

create or replace function public.ecoflow_test_expect_denied(
  p_sql text,
  p_marker text default null
)
returns void
language plpgsql
as $$
begin
  execute p_sql;
  raise exception 'EXPECTED_DENIAL_NOT_RAISED: %',p_sql;
exception
  when insufficient_privilege then
    if p_marker is not null and position(p_marker in sqlerrm)=0 then
      raise exception 'EXPECTED_DENIAL_MARKER_MISSING: expected %, got %',p_marker,sqlerrm;
    end if;
end;
$$;
revoke all on function public.ecoflow_test_expect_denied(text,text) from public;
grant execute on function public.ecoflow_test_expect_denied(text,text) to anon,authenticated;

do $$
declare
  v_table text;
  v_impl text;
  v_wrapper text;
  v_policy_count integer;
begin
  foreach v_table in array array[
    'public.ecoflow_delivery_notification_settings',
    'public.ecoflow_delivery_notifications',
    'public.ecoflow_delivery_exceptions',
    'public.ecoflow_delivery_return_scans',
    'public.ecoflow_warehouse_return_zones',
    'public.ecoflow_delivery_return_inspection_lines'
  ]
  loop
    if has_table_privilege('anon',v_table,'SELECT')
       or has_table_privilege('anon',v_table,'INSERT')
       or has_table_privilege('authenticated',v_table,'INSERT')
       or has_table_privilege('authenticated',v_table,'UPDATE')
       or has_table_privilege('authenticated',v_table,'DELETE') then
      raise exception 'legacy broad table ACL remains on %',v_table;
    end if;
  end loop;

  foreach v_impl in array array[
    'public.ecoflow_queue_delivery_notifications_acl_impl(text,text,text,text,integer,text,text,text,text,text,text,text,text,text)',
    'public.ecoflow_record_delivery_exception_acl_impl(text,text,text,integer,text,text,text,numeric,numeric,numeric,text,text,text,text,text,text)',
    'public.ecoflow_scan_delivery_return_acl_impl(text,text,text,text)',
    'public.ecoflow_driver_drop_return_acl_impl(uuid,text,text,text,double precision,double precision,numeric)',
    'public.ecoflow_record_return_inspection_item_acl_impl(uuid,text,text,numeric,text,text,text,text)',
    'public.ecoflow_complete_return_inspection_acl_impl(uuid,text,text)'
  ]
  loop
    if has_function_privilege('anon',v_impl,'EXECUTE')
       or has_function_privilege('authenticated',v_impl,'EXECUTE') then
      raise exception 'implementation function remains callable: %',v_impl;
    end if;
  end loop;

  foreach v_wrapper in array array[
    'public.ecoflow_queue_delivery_notifications(text,text,text,text,integer,text,text,text,text,text,text,text,text,text)',
    'public.ecoflow_record_delivery_exception(text,text,text,integer,text,text,text,numeric,numeric,numeric,text,text,text,text,text,text)',
    'public.ecoflow_scan_delivery_return(text,text,text,text)',
    'public.ecoflow_driver_drop_return(uuid,text,text,text,double precision,double precision,numeric)',
    'public.ecoflow_record_return_inspection_item(uuid,text,text,numeric,text,text,text,text)',
    'public.ecoflow_complete_return_inspection(uuid,text,text)'
  ]
  loop
    if has_function_privilege('anon',v_wrapper,'EXECUTE')
       or not has_function_privilege('authenticated',v_wrapper,'EXECUTE') then
      raise exception 'wrapper execute ACL is incorrect: %',v_wrapper;
    end if;
  end loop;

  if has_column_privilege('authenticated','public.ecoflow_delivery_notifications','message_html','SELECT')
     or has_column_privilege('authenticated','public.ecoflow_delivery_exceptions','store_email','SELECT')
     or has_column_privilege('authenticated','public.ecoflow_delivery_exceptions','store_phone','SELECT') then
    raise exception 'sensitive delivery-return columns remain browser-readable';
  end if;

  select count(*) into v_policy_count
  from pg_policies
  where schemaname='public'
    and tablename in (
      'ecoflow_delivery_notification_settings',
      'ecoflow_delivery_notifications',
      'ecoflow_delivery_exceptions',
      'ecoflow_delivery_return_scans',
      'ecoflow_warehouse_return_zones',
      'ecoflow_delivery_return_inspection_lines'
    );
  if v_policy_count<>4 then
    raise exception 'unexpected returns-domain policy count: %',v_policy_count;
  end if;

  if exists(
    select 1
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname in (
        'v_ecoflow_delivery_notification_outbox',
        'v_ecoflow_warehouse_return_zones',
        'v_ecoflow_return_inspection_lines',
        'v_ecoflow_open_delivery_returns',
        'v_ecoflow_delivery_exception_summary'
      )
      and not coalesce(c.reloptions,'{}'::text[]) @> array['security_invoker=true']
  ) then
    raise exception 'a returns-domain view is not security_invoker';
  end if;
end;
$$;

set role anon;
select public.ecoflow_test_expect_denied(
  $$select * from public.ecoflow_record_delivery_exception(
    '2026-07-28','anon-order',null,null,'BOX-ANON','Anon Store','REFUSED',
    1,0,1,'test',null,null,null,null,'spoofed'
  )$$,
  null
);
reset role;

set role authenticated;
select set_config('request.jwt.claim.role','authenticated',false);
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);

select exception_id::text as exception_id,return_code
from public.ecoflow_record_delivery_exception(
  '2026-07-28','driver-order','ORD-DRIVER',1,'BOX-DRIVER','Driver Store','REFUSED',
  1,0,1,'customer refused','returning goods',null,'store@example.test','0400000000','Spoofed Driver'
)
\gset driver_

select public.ecoflow_test_expect_denied(
  format($sql$select * from public.ecoflow_scan_delivery_return(%L)$sql$,:'driver_return_code'),
  'RETURN_WAREHOUSE_ROLE_REQUIRED'
);
select public.ecoflow_test_expect_denied(
  format($sql$select * from public.ecoflow_record_return_inspection_item(%L::uuid,'SUPPLIER_CLAIM',null,1,null,'box',null,'Spoofed')$sql$,:'driver_exception_id'),
  'RETURN_INSPECTION_WAREHOUSE_ROLE_REQUIRED'
);

select (count(*)=1) as driver_zone_ok
from public.v_ecoflow_warehouse_return_zones
\gset
\if :driver_zone_ok
\else
  \echo 'driver could not read the active returns zone'
  \quit 1
\endif

select *
from public.ecoflow_driver_drop_return(
  :'driver_exception_id'::uuid,'ECOFLOW-RETURNS-ZONE-01','placed in marked zone',
  'Spoofed Driver',-34.8746,138.5626,10
);
reset role;

do $$
declare
  v_recorded text;
  v_returned text;
begin
  select recorded_by,driver_returned_by
  into v_recorded,v_returned
  from public.ecoflow_delivery_exceptions
  where order_id='driver-order';

  if v_recorded<>'DRIVER:11111111-1111-1111-1111-111111111111'
     or v_returned<>'DRIVER:11111111-1111-1111-1111-111111111111' then
    raise exception 'client actor spoofing was not replaced: %, %',v_recorded,v_returned;
  end if;
end;
$$;

set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);

select public.ecoflow_test_expect_denied(
  $$select * from public.ecoflow_record_delivery_exception(
    '2026-07-28','warehouse-order',null,null,'BOX-WH','Warehouse Store','REFUSED',
    1,0,1,'test',null,null,null,null,'Spoofed'
  )$$,
  'DELIVERY_EXCEPTION_DRIVER_ROLE_REQUIRED'
);
select public.ecoflow_test_expect_denied(
  format($sql$select * from public.ecoflow_driver_drop_return(
    %L::uuid,'ECOFLOW-RETURNS-ZONE-01',null,'Spoofed',-34.8746,138.5626,10
  )$sql$,:'driver_exception_id'),
  'RETURN_DRIVER_ROLE_REQUIRED'
);

select *
from public.ecoflow_record_return_inspection_item(
  :'driver_exception_id'::uuid,'SUPPLIER_CLAIM',null,1,null,'Returned carton',
  'supplier review required','Spoofed Warehouse'
);
select *
from public.ecoflow_complete_return_inspection(
  :'driver_exception_id'::uuid,'inspection complete','Spoofed Warehouse'
);

select (count(*)=1) as warehouse_inspection_ok
from public.v_ecoflow_return_inspection_lines
where exception_id=:'driver_exception_id'::uuid
\gset
\if :warehouse_inspection_ok
\else
  \echo 'warehouse could not read its inspection line'
  \quit 1
\endif

select (count(*)=0) as warehouse_notification_ok
from public.v_ecoflow_delivery_notification_outbox
\gset
\if :warehouse_notification_ok
\else
  \echo 'warehouse unexpectedly read office notification rows'
  \quit 1
\endif
reset role;

do $$
declare
  v_inspected text;
  v_completed text;
begin
  select inspected_by into v_inspected
  from public.ecoflow_delivery_return_inspection_lines
  where order_id is null;
exception when undefined_column then
  select inspected_by into v_inspected
  from public.ecoflow_delivery_return_inspection_lines l
  join public.ecoflow_delivery_exceptions e on e.id=l.exception_id
  where e.order_id='driver-order'
  limit 1;
end;
$$;

do $$
declare
  v_inspected text;
  v_completed text;
begin
  select l.inspected_by,e.inspection_completed_by
  into v_inspected,v_completed
  from public.ecoflow_delivery_return_inspection_lines l
  join public.ecoflow_delivery_exceptions e on e.id=l.exception_id
  where e.order_id='driver-order'
  limit 1;

  if v_inspected<>'WAREHOUSE:22222222-2222-2222-2222-222222222222'
     or v_completed<>'WAREHOUSE:22222222-2222-2222-2222-222222222222' then
    raise exception 'warehouse actor spoofing was not replaced: %, %',v_inspected,v_completed;
  end if;
end;
$$;

set role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
select public.ecoflow_test_expect_denied(
  $$select * from public.ecoflow_queue_delivery_notifications(
    'account-denied','2026-07-28','account-order',null,null,null,null,'DELIVERED',
    null,null,null,null,null,'Spoofed'
  )$$,
  'DELIVERY_NOTIFICATION_DRIVER_ROLE_REQUIRED'
);
select (count(*)>=1) as account_notification_ok
from public.v_ecoflow_delivery_notification_outbox
\gset
\if :account_notification_ok
\else
  \echo 'account role could not read notification outbox'
  \quit 1
\endif
select (count(*)=0) as account_zone_ok from public.v_ecoflow_warehouse_return_zones
\gset
\if :account_zone_ok
\else
  \echo 'account role unexpectedly read warehouse return zones'
  \quit 1
\endif
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);
select public.ecoflow_test_expect_denied(
  format($sql$select * from public.ecoflow_scan_delivery_return(%L)$sql$,:'driver_return_code'),
  'RETURN_WAREHOUSE_ROLE_REQUIRED'
);
select (count(*)>=1) as viewer_summary_ok
from public.v_ecoflow_delivery_exception_summary
\gset
\if :viewer_summary_ok
\else
  \echo 'viewer could not read delivery exception summary'
  \quit 1
\endif
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub','55555555-5555-5555-5555-555555555555',false);
select (count(*)>=2) as owner_queue_ok
from public.ecoflow_queue_delivery_notifications(
  'owner-allowed','2026-07-28','owner-order','ORD-OWNER',2,'BOX-OWNER','Owner Store',
  'DELIVERED',null,null,null,null,'owner test','Spoofed Owner'
)
\gset
\if :owner_queue_ok
\else
  \echo 'owner could not queue delivery notifications'
  \quit 1
\endif
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub','66666666-6666-6666-6666-666666666666',false);
select exception_id::text as exception_id,return_code
from public.ecoflow_record_delivery_exception(
  '2026-07-28','admin-order','ORD-ADMIN',3,'BOX-ADMIN','Admin Store','REFUSED',
  1,0,1,'admin test',null,null,null,null,'Spoofed Admin'
)
\gset admin_
select *
from public.ecoflow_scan_delivery_return(
  :'admin_return_code','RETURNS-HOLD','admin scan','Spoofed Admin'
);
reset role;

do $$
declare
  v_recorded text;
  v_received text;
begin
  select recorded_by,warehouse_received_by
  into v_recorded,v_received
  from public.ecoflow_delivery_exceptions
  where order_id='admin-order';

  if v_recorded<>'ADMIN:66666666-6666-6666-6666-666666666666'
     or v_received<>'ADMIN:66666666-6666-6666-6666-666666666666' then
    raise exception 'admin actor spoofing was not replaced: %, %',v_recorded,v_received;
  end if;
end;
$$;

set role authenticated;
select set_config('request.jwt.claim.sub','77777777-7777-7777-7777-777777777777',false);
select public.ecoflow_test_expect_denied(
  $$select * from public.ecoflow_queue_delivery_notifications(
    'inactive-denied','2026-07-28','inactive-order',null,null,null,null,'DELIVERED',
    null,null,null,null,null,'Spoofed'
  )$$,
  'DELIVERY_NOTIFICATION_DRIVER_ROLE_REQUIRED'
);
select public.ecoflow_test_expect_denied(
  $$insert into public.ecoflow_delivery_exceptions(
    business_day,order_id,outcome,recorded_by
  ) values ('2026-07-28','direct-write','FAILED','browser')$$,
  null
);
reset role;

rollback;

select 'legacy returns ACL real-role contract passed' as result;
