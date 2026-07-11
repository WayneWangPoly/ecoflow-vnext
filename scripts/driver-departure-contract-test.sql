\set ON_ERROR_STOP on

insert into auth.users(id,email) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','driver@example.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','owner@example.com')
on conflict do nothing;

insert into public.app_user_profiles(user_id,email,display_name,app_role,is_active,team_status) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','driver@example.com','Test Driver','DRIVER',true,'ACTIVE'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','owner@example.com','Test Owner','OWNER',true,'ACTIVE')
on conflict (user_id) do update set
  email=excluded.email,display_name=excluded.display_name,app_role=excluded.app_role,is_active=true,team_status='ACTIVE';

insert into public.ecoflow_store_sites(retailer_id,store_name,suburb,verified)
values ('STORE-1','Contract Test Cafe','Adelaide',true)
on conflict (store_name) do nothing;

set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',true);
select set_config('request.jwt.claim.role','authenticated',true);

select * from public.ecoflow_record_driver_departure_acknowledgement(
  '2026-07-11'::date,
  'RUN-20260711-A',
  '2026-07-11-v1',
  'Test Driver',
  '{"vehicle_walkaround":true,"tyres_wheels":true,"windscreen_mirrors":true,"lights_indicators":true,"fuel_charge":true,"load_secured":true,"phone_navigation":true,"licence_fitness":true,"defects_reported":true}'::jsonb,
  true,
  'Contract declaration text',
  'Test Driver',
  'CI',
  '{}'::jsonb
);

select * from public.ecoflow_record_driver_departure_acknowledgement(
  '2026-07-11'::date,
  'RUN-20260711-A',
  '2026-07-11-v1',
  'Test Driver',
  '{"vehicle_walkaround":true,"tyres_wheels":true,"windscreen_mirrors":true,"lights_indicators":true,"fuel_charge":true,"load_secured":true,"phone_navigation":true,"licence_fitness":true,"defects_reported":true}'::jsonb,
  true,
  'Contract declaration text',
  'Test Driver',
  'CI',
  '{}'::jsonb
);

do $$
begin
  if (select count(*) from public.ecoflow_driver_departure_acknowledgements where route_id='RUN-20260711-A') <> 1 then
    raise exception 'departure acknowledgement is not idempotent';
  end if;
end $$;

do $$
begin
  begin
    perform * from public.ecoflow_record_driver_departure_acknowledgement(
      '2026-07-11'::date,'RUN-FAIL','2026-07-11-v1','Test Driver',
      '{"vehicle_walkaround":false}'::jsonb,true,'Contract declaration text','Test Driver','CI','{}'::jsonb
    );
    raise exception 'missing checks were accepted';
  exception when others then
    if sqlerrm = 'missing checks were accepted' then raise; end if;
  end;
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',true);
select set_config('request.jwt.claim.role','authenticated',true);

select * from public.ecoflow_upsert_store_delivery_notification_contact(
  'STORE-1','Contract Test Cafe','STORE-1','delivery@example.com','Cafe Manager',true
);

reset role;
insert into public.ecoflow_delivery_notification_log(
  business_day,route_id,retailer_id,store_key,store_name,recipient_email,order_ids,order_numbers,status,requested_by
) values (
  '2026-07-11','RUN-20260711-A','STORE-1','STORE-1','Contract Test Cafe','delivery@example.com',
  array['ORDER-1'],array['1001'],'SENT','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',true);
select set_config('request.jwt.claim.role','authenticated',true);
do $$
begin
  if (select count(*) from public.ecoflow_delivery_notification_log) <> 0 then
    raise exception 'driver can read customer notification log';
  end if;
  if (select count(*) from public.ecoflow_delivery_notification_contacts) <> 0 then
    raise exception 'driver can read customer notification contacts';
  end if;
end $$;

select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',true);
do $$
begin
  if (select count(*) from public.ecoflow_delivery_notification_log) <> 1 then
    raise exception 'owner cannot read customer notification log';
  end if;
  if (select contact_email from public.ecoflow_delivery_notification_contacts where retailer_id='STORE-1') <> 'delivery@example.com' then
    raise exception 'owner contact update did not persist';
  end if;
end $$;

reset role;
\echo 'Driver departure and customer notification database contract passed.'
