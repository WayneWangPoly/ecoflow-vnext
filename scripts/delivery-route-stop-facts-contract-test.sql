\set ON_ERROR_STOP on

begin;

-- The isolated legacy fixture intentionally keeps app_user_profiles minimal.
-- Production has this timestamp; add it only inside the rollback-only contract.
alter table public.app_user_profiles
  add column if not exists updated_at timestamptz not null default now();

insert into auth.users(id,email) values
  ('81000000-0000-0000-0000-000000000001','route-driver-one@example.test'),
  ('81000000-0000-0000-0000-000000000002','route-driver-two@example.test')
on conflict(id) do nothing;

insert into public.app_user_profiles(
  user_id,email,display_name,app_role,is_active,team_status,updated_at
) values
  ('81000000-0000-0000-0000-000000000001','route-driver-one@example.test',
   'Route Driver One','DRIVER',true,'ACTIVE','2026-07-29 07:00:00+09:30'),
  ('81000000-0000-0000-0000-000000000002','route-driver-two@example.test',
   'Route Driver Two','DRIVER',true,'ACTIVE','2026-07-29 07:00:00+09:30')
on conflict(user_id) do update set
  email=excluded.email,display_name=excluded.display_name,app_role='DRIVER',
  is_active=true,team_status='ACTIVE',updated_at=excluded.updated_at;

insert into public.ecoflow_day_state(business_day,scope,payload,updated_by,updated_at)
values
  ('2026-07-29','run:A:meta',
   '{"lockedAt":"2026-07-29T07:30:00+09:30","stopOrder":["ROUTE-O1","ROUTE-O2","ROUTE-O4"],"boxCodes":{"ROUTE-O1":"A","ROUTE-O2":"B","ROUTE-O4":"C"}}',
   'Accounts','2026-07-29 07:30:00+09:30'),
  ('2026-07-29','run:A:route',
   '{"startedAt":"2026-07-29T08:00:00+09:30","endedAt":"2026-07-29T12:00:00+09:30"}',
   'Route Driver One','2026-07-29 12:00:00+09:30'),
  ('2026-07-29','run:A:stop:ROUTE-O1',
   '{"status":"DELIVERED","arrivedAt":"2026-07-29T09:00:00+09:30","completedAt":"2026-07-29T09:10:00+09:30"}',
   'Route Driver One','2026-07-29 09:10:00+09:30'),
  ('2026-07-29','run:A:stop:ROUTE-O2',
   '{"status":"DELIVERED","arrivedAt":"2026-07-29T10:00:00+09:30","completedAt":"2026-07-29T10:08:00+09:30"}',
   'Route Driver One','2026-07-29 10:08:00+09:30'),
  ('2026-07-29','run:A:stop:ROUTE-O4',
   '{"status":"PENDING"}',
   'Route Driver One','2026-07-29 08:00:00+09:30');

insert into public.ecoflow_driver_departure_acknowledgements(
  id,business_day,route_id,driver_user_id,driver_email,driver_label,typed_name,
  policy_version,checks,location_consent,declaration_text,accepted_at,metadata
) values(
  '82000000-0000-0000-0000-000000000001','2026-07-29','RUN-20260729-A',
  '81000000-0000-0000-0000-000000000001','route-driver-one@example.test',
  'Route Driver One','Route Driver One','contract-v1','{}',true,
  'Contract departure declaration','2026-07-29 07:50:00+09:30','{}'
);

-- A second driver leaves route/location evidence. The route must resolve MULTIPLE,
-- not take the maximum of each source independently and incorrectly report SINGLE.
insert into public.ecoflow_driver_location_samples(
  id,business_day,route_id,driver_user_id,driver_label,latitude,longitude,
  accuracy_m,sample_source,client_sample_id,captured_at,received_at,current_order_id,
  metadata
) values
  ('83000000-0000-0000-0000-000000000001','2026-07-29','RUN-20260729-A',
   '81000000-0000-0000-0000-000000000002','Route Driver Two',-34.90,138.60,
   8,'ROUTE_START','84000000-0000-0000-0000-000000000001',
   '2026-07-29 08:00:10+09:30','2026-07-29 08:00:12+09:30',null,'{}'),
  ('83000000-0000-0000-0000-000000000002','2026-07-29','RUN-20260729-A',
   '81000000-0000-0000-0000-000000000002','Route Driver Two',-34.91,138.61,
   7,'DELIVERY','84000000-0000-0000-0000-000000000002',
   '2026-07-29 09:10:05+09:30','2026-07-29 09:10:06+09:30','ROUTE-O1','{}');

insert into public.ecoflow_delivery_pod_proofs(
  id,business_day,order_id,order_number,stop_number,box_code,store_name,
  proof_type,photo_path,captured_at,captured_by,created_at
) values
  ('85000000-0000-0000-0000-000000000001','2026-07-29','ROUTE-O1','1001',1,'A',
   'Route Cafe One','POD1_DROP_POINT','contract/o1-pod1.jpg',
   '2026-07-29 09:09:00+09:30','Route Driver One','2026-07-29 09:09:00+09:30'),
  ('85000000-0000-0000-0000-000000000002','2026-07-29','ROUTE-O1','1001',1,'A',
   'Route Cafe One','POD2_GOODS_PLACED','contract/o1-pod2.jpg',
   '2026-07-29 09:10:00+09:30','Route Driver One','2026-07-29 09:10:00+09:30'),
  ('85000000-0000-0000-0000-000000000003','2026-07-29','ROUTE-O2','1002',2,'B',
   'Route Cafe Two','POD1_DROP_POINT','contract/o2-pod1.jpg',
   '2026-07-29 10:07:00+09:30','Route Driver One','2026-07-29 10:07:00+09:30'),
  ('85000000-0000-0000-0000-000000000099','not-a-date','INVALID-DATE-ORDER',null,null,null,
   null,'POD1_DROP_POINT','contract/invalid.jpg',
   '2026-07-29 10:00:00+09:30','Route Driver One','2026-07-29 10:00:00+09:30');

insert into public.ecoflow_delivery_exceptions(
  id,business_day,order_id,order_number,stop_number,box_code,store_name,outcome,
  expected_cartons,delivered_cartons,return_cartons,reason,driver_note,
  return_status,recorded_by,recorded_at,updated_at
) values(
  '86000000-0000-0000-0000-000000000001','2026-07-29','ROUTE-O3','1003',null,null,
  'Unassigned Cafe','REFUSED',4,0,4,'Customer refused','Office follow-up required',
  'WITH_DRIVER','Route Driver One','2026-07-29 11:00:00+09:30',
  '2026-07-29 11:00:00+09:30'
);

-- A sent notification for O4 must remain communication evidence only.
insert into public.ecoflow_delivery_notifications(
  id,event_key,business_day,order_id,order_number,stop_number,box_code,store_name,
  delivery_outcome,audience,channel,message_text,notification_status,queued_at,
  sent_at,updated_at
) values(
  '87000000-0000-0000-0000-000000000001','contract-o4-customer','2026-07-29',
  'ROUTE-O4','1004',3,'C','Route Cafe Four','DELIVERED','CUSTOMER','EMAIL',
  'Communication-only contract row','SENT','2026-07-29 08:10:00+09:30',
  '2026-07-29 08:11:00+09:30','2026-07-29 08:11:00+09:30'
);

insert into public.ecoflow_delivery_notification_log(
  id,business_day,route_id,store_key,store_name,notification_type,status,
  requested_at,sent_at,payload
) values
  ('88000000-0000-0000-0000-000000000001','2026-07-29','RUN-20260729-A',
   'ROUTE-STORE-1','Route Cafe One','ROUTE_STARTED_TODAY','SENT',
   '2026-07-29 08:01:00+09:30','2026-07-29 08:02:00+09:30','{}'),
  ('88000000-0000-0000-0000-000000000002','2026-07-29','RUN-20260729-A',
   'ROUTE-STORE-2','Route Cafe Two','ROUTE_STARTED_TODAY','FAILED',
   '2026-07-29 08:01:00+09:30',null,'{}');

-- Migration must create structure only.
do $structure_only$
begin
  if exists(select 1 from analytics.fact_delivery_route_observation)
     or exists(select 1 from analytics.fact_delivery_stop_observation) then
    raise exception 'delivery facts were populated automatically by migration';
  end if;
  if (select status from analytics.refresh_status
      where dataset_key='analytics.delivery_routes')<>'NEVER'
     or (select status from analytics.refresh_status
      where dataset_key='analytics.delivery_stops')<>'NEVER' then
    raise exception 'delivery refresh status was activated by migration';
  end if;
end;
$structure_only$;

-- Browser roles cannot read raw facts.
set role authenticated;
do $browser_denied$
begin
  begin
    perform count(*) from analytics.fact_delivery_stop_observation;
    raise exception 'authenticated role read raw delivery facts';
  exception when insufficient_privilege then null;
  end;
end;
$browser_denied$;
reset role;

-- Service role is read-only on derived facts; writes happen only through refresh.
set role service_role;
do $service_write_denied$
begin
  begin
    insert into analytics.fact_delivery_route_observation(
      business_day,run_code,source_route_key,source_route_id,route_status,
      driver_resolution_status,evidence_status,history_completeness,quality_status,
      source_version_hash,effective_from,first_observed_at,last_observed_at,as_of_at
    ) values(
      '2026-07-29','X','forbidden','forbidden','UNKNOWN','NONE','DAY_STATE_ONLY',
      'OBSERVATION_VERSIONED_CURRENT_STATE','TRUSTED',repeat('0',64),now(),now(),now(),now()
    );
    raise exception 'service role wrote delivery fact directly';
  exception when insufficient_privilege then null;
  end;
end;
$service_write_denied$;

create temporary table pg_temp.delivery_refresh_result as
select * from analytics.refresh_delivery_route_stop_facts(
  '2026-07-29 12:30:00+09:30'
);
reset role;

do $first_refresh$
declare
  v_route record;
  v_o1 record;
  v_o2 record;
  v_o3 record;
  v_o4 record;
begin
  if exists(select 1 from pg_temp.delivery_refresh_result where refresh_state<>'CURRENT') then
    raise exception 'delivery refresh did not complete: %',
      (select jsonb_agg(to_jsonb(r)) from pg_temp.delivery_refresh_result r);
  end if;

  select * into v_route
  from analytics.fact_delivery_route_observation
  where source_route_key='2026-07-29:RUN:A' and is_current;

  if v_route.route_status<>'COMPLETED'
     or v_route.planned_stop_count<>3
     or v_route.departure_ack_count<>1
     or v_route.observed_driver_count<>2
     or v_route.driver_resolution_status<>'MULTIPLE'
     or v_route.location_sample_count<>2
     or v_route.route_start_sample_count<>1
     or v_route.delivery_sample_count<>1
     or v_route.route_notice_sent_count<>1
     or v_route.route_notice_failed_count<>1
     or v_route.history_completeness<>'OBSERVATION_VERSIONED_CURRENT_STATE' then
    raise exception 'route observation is incorrect: %',row_to_json(v_route);
  end if;

  select * into v_o1 from analytics.fact_delivery_stop_observation
  where source_order_id='ROUTE-O1' and is_current;
  if v_o1.delivery_outcome<>'DELIVERED'
     or v_o1.outcome_authority<>'DAY_STATE_AND_TYPED_POD'
     or v_o1.proof_completeness<>'COMPLETE'
     or v_o1.history_completeness<>'DURABLE_TERMINAL_EVIDENCE'
     or v_o1.location_event_sample_count<>1 then
    raise exception 'confirmed delivered stop is incorrect: %',row_to_json(v_o1);
  end if;

  select * into v_o2 from analytics.fact_delivery_stop_observation
  where source_order_id='ROUTE-O2' and is_current;
  if v_o2.delivery_outcome<>'DELIVERED_UNVERIFIED'
     or v_o2.proof_completeness<>'ONLY_POD1'
     or v_o2.quality_status<>'DEGRADED' then
    raise exception 'one-proof delivered stop was trusted: %',row_to_json(v_o2);
  end if;

  select * into v_o3 from analytics.fact_delivery_stop_observation
  where source_order_id='ROUTE-O3' and is_current;
  if v_o3.run_code<>'UNASSIGNED'
     or v_o3.route_assignment_status<>'UNASSIGNED'
     or v_o3.delivery_outcome<>'REFUSED'
     or v_o3.outcome_authority<>'DURABLE_EXCEPTION'
     or v_o3.history_completeness<>'DURABLE_TERMINAL_EVIDENCE' then
    raise exception 'durable unassigned exception is incorrect: %',row_to_json(v_o3);
  end if;

  select * into v_o4 from analytics.fact_delivery_stop_observation
  where source_order_id='ROUTE-O4' and is_current;
  if v_o4.recorded_stop_status<>'PENDING'
     or v_o4.delivery_outcome<>'PENDING'
     or v_o4.notification_sent_count<>1 then
    raise exception 'notification incorrectly proved delivery: %',row_to_json(v_o4);
  end if;

  if exists(select 1 from analytics.fact_delivery_stop_observation
            where source_order_id='INVALID-DATE-ORDER') then
    raise exception 'invalid text business day entered delivery facts';
  end if;

  if exists(
    select 1 from information_schema.columns
    where table_schema='analytics'
      and table_name in('fact_delivery_route_observation','fact_delivery_stop_observation')
      and column_name in('latitude','longitude','photo_path','recipient','contact_email')
  ) then
    raise exception 'sensitive location or contact field leaked into delivery facts';
  end if;
end;
$first_refresh$;

-- A transport-only timestamp update with identical payload must not create history.
update public.ecoflow_day_state
set updated_at='2026-07-29 12:35:00+09:30'
where business_day='2026-07-29' and scope='run:A:stop:ROUTE-O2';

set role service_role;
select * from analytics.refresh_delivery_route_stop_facts(
  '2026-07-29 12:40:00+09:30'
);
reset role;

do $no_false_version$
begin
  if (select count(*) from analytics.fact_delivery_stop_observation
      where source_order_id='ROUTE-O2')<>1 then
    raise exception 'source updated_at alone created a delivery-stop version';
  end if;
end;
$no_false_version$;

-- Completing the durable POD pair is a real semantic change and must version.
insert into public.ecoflow_delivery_pod_proofs(
  id,business_day,order_id,order_number,stop_number,box_code,store_name,
  proof_type,photo_path,captured_at,captured_by,created_at
) values(
  '85000000-0000-0000-0000-000000000004','2026-07-29','ROUTE-O2','1002',2,'B',
  'Route Cafe Two','POD2_GOODS_PLACED','contract/o2-pod2.jpg',
  '2026-07-29 10:08:00+09:30','Route Driver One','2026-07-29 10:08:00+09:30'
);

set role service_role;
select * from analytics.refresh_delivery_route_stop_facts(
  '2026-07-29 12:50:00+09:30'
);
reset role;

do $real_version$
begin
  if (select count(*) from analytics.fact_delivery_stop_observation
      where source_order_id='ROUTE-O2')<>2 then
    raise exception 'POD completion did not create a new stop observation version';
  end if;
  if (select count(*) from analytics.fact_delivery_stop_observation
      where source_order_id='ROUTE-O2' and is_current
        and delivery_outcome='DELIVERED'
        and outcome_authority='DAY_STATE_AND_TYPED_POD'
        and proof_completeness='COMPLETE')<>1 then
    raise exception 'completed POD pair did not confirm delivery';
  end if;
  if (select count(*) from analytics.fact_delivery_stop_observation
      where source_order_id='ROUTE-O2' and not is_current
        and delivery_outcome='DELIVERED_UNVERIFIED')<>1 then
    raise exception 'prior unverified delivery version was not retained';
  end if;
end;
$real_version$;

rollback;

\echo 'Delivery route and stop execution fact contract passed.'
