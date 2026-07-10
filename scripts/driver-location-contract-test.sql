\set ON_ERROR_STOP on

reset role;

insert into auth.users(id,email)
values
  ('11111111-1111-1111-1111-111111111111','owner@example.test'),
  ('22222222-2222-2222-2222-222222222222','driver@example.test'),
  ('33333333-3333-3333-3333-333333333333','warehouse@example.test')
on conflict (id) do nothing;

insert into public.app_user_profiles(user_id,app_role,is_active,team_status)
values
  ('11111111-1111-1111-1111-111111111111','OWNER',true,'ACTIVE'),
  ('22222222-2222-2222-2222-222222222222','DRIVER',true,'ACTIVE'),
  ('33333333-3333-3333-3333-333333333333','WAREHOUSE',true,'ACTIVE')
on conflict (user_id) do update set
  app_role=excluded.app_role,
  is_active=excluded.is_active,
  team_status=excluded.team_status;

set role authenticated;
select set_config('request.jwt.claim.role','authenticated',false);
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);

DO $$
declare
  v_first uuid;
  v_retry uuid;
  v_throttled uuid;
  v_event uuid;
  v_visible_count integer;
  v_blocked boolean;
begin
  select r.location_id into v_first
  from public.ecoflow_record_driver_location_sample(
    p_business_day => current_date,
    p_route_id => 'RUN-CI-A',
    p_latitude => -34.9001,
    p_longitude => 138.6001,
    p_accuracy_m => 28,
    p_current_order_id => 'ORDER-1',
    p_sample_source => 'AUTO_INTERVAL',
    p_client_sample_id => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    p_captured_at => now(),
    p_driver_label => 'CI Driver',
    p_device_timezone => 'Australia/Adelaide'
  ) r;

  select r.location_id into v_retry
  from public.ecoflow_record_driver_location_sample(
    p_business_day => current_date,
    p_route_id => 'RUN-CI-A',
    p_latitude => -34.9001,
    p_longitude => 138.6001,
    p_accuracy_m => 28,
    p_current_order_id => 'ORDER-1',
    p_sample_source => 'AUTO_INTERVAL',
    p_client_sample_id => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    p_captured_at => now(),
    p_driver_label => 'CI Driver'
  ) r;

  if v_first is null or v_retry <> v_first then
    raise exception 'driver location idempotency failed';
  end if;

  select r.location_id into v_throttled
  from public.ecoflow_record_driver_location_sample(
    p_business_day => current_date,
    p_route_id => 'RUN-CI-A',
    p_latitude => -34.9002,
    p_longitude => 138.6002,
    p_accuracy_m => 32,
    p_current_order_id => 'ORDER-1',
    p_sample_source => 'AUTO_INTERVAL',
    p_client_sample_id => 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    p_captured_at => now(),
    p_driver_label => 'CI Driver'
  ) r;

  if v_throttled <> v_first then
    raise exception 'automatic sample rate limit did not reuse latest sample';
  end if;

  select r.location_id into v_event
  from public.ecoflow_record_driver_location_sample(
    p_business_day => current_date,
    p_route_id => 'RUN-CI-A',
    p_latitude => -34.9010,
    p_longitude => 138.6010,
    p_accuracy_m => 15,
    p_current_order_id => 'ORDER-1',
    p_sample_source => 'STOP_ARRIVAL',
    p_client_sample_id => 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    p_captured_at => now(),
    p_driver_label => 'CI Driver'
  ) r;

  if v_event is null or v_event = v_first then
    raise exception 'event location sample was not persisted separately';
  end if;

  -- Driver is write-only for this data: RLS must hide both the base table and Owner view.
  select count(*) into v_visible_count from public.ecoflow_driver_location_samples;
  if v_visible_count <> 0 then raise exception 'Driver could read raw location history'; end if;
  select count(*) into v_visible_count from public.v_ecoflow_owner_driver_location_timeline;
  if v_visible_count <> 0 then raise exception 'Driver could read Owner location timeline'; end if;

  v_blocked := false;
  begin
    perform * from public.ecoflow_record_driver_location_sample(
      p_business_day => current_date,
      p_route_id => 'RUN-CI-A',
      p_latitude => 110,
      p_longitude => 138.6,
      p_sample_source => 'MANUAL',
      p_client_sample_id => gen_random_uuid(),
      p_captured_at => now()
    );
  exception when others then
    if position('VALID_LATITUDE_REQUIRED' in sqlerrm)>0 then v_blocked := true; else raise; end if;
  end;
  if not v_blocked then raise exception 'invalid latitude was accepted'; end if;
end;
$$;

select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
DO $$
declare v_count integer;
begin
  select count(*) into v_count from public.v_ecoflow_owner_driver_location_timeline;
  if v_count <> 2 then raise exception 'Owner timeline expected 2 samples, got %',v_count; end if;
  select count(*) into v_count from public.v_ecoflow_owner_driver_location_latest;
  if v_count <> 1 then raise exception 'Owner latest view expected 1 row, got %',v_count; end if;
end;
$$;

select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
DO $$
declare v_count integer; v_blocked boolean := false;
begin
  select count(*) into v_count from public.v_ecoflow_owner_driver_location_timeline;
  if v_count <> 0 then raise exception 'Warehouse role could read Owner location timeline'; end if;
  begin
    perform * from public.ecoflow_record_driver_location_sample(
      p_business_day => current_date,
      p_route_id => 'RUN-CI-A',
      p_latitude => -34.9,
      p_longitude => 138.6,
      p_sample_source => 'MANUAL',
      p_client_sample_id => gen_random_uuid(),
      p_captured_at => now()
    );
  exception when others then
    if position('DRIVER_LOCATION_ROLE_REQUIRED' in sqlerrm)>0 then v_blocked := true; else raise; end if;
  end;
  if not v_blocked then raise exception 'Warehouse role could record driver location'; end if;
end;
$$;

reset role;
select 'driver location contract passed' as result;
