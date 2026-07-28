\set ON_ERROR_STOP on

begin;

alter table public.app_user_profiles
  add column if not exists updated_at timestamptz not null default now();

insert into auth.users(id,email)
values('91000000-0000-0000-0000-000000000001','driver-scd@example.test')
on conflict(id) do nothing;

insert into public.app_user_profiles(
  user_id,email,display_name,app_role,is_active,team_status,updated_at
) values(
  '91000000-0000-0000-0000-000000000001','driver-scd@example.test',
  'Driver SCD Original','DRIVER',true,'ACTIVE','2026-07-29 11:50:00+09:30'
)
on conflict(user_id) do update set
  email=excluded.email,
  display_name=excluded.display_name,
  app_role='DRIVER',
  is_active=true,
  team_status='ACTIVE',
  updated_at=excluded.updated_at;

insert into public.ecoflow_driver_departure_acknowledgements(
  id,business_day,route_id,driver_user_id,driver_email,driver_label,typed_name,
  policy_version,checks,location_consent,declaration_text,accepted_at,metadata
) values(
  '92000000-0000-0000-0000-000000000001','2026-07-29','RUN-20260729-B',
  '91000000-0000-0000-0000-000000000001','driver-scd@example.test',
  'Driver SCD Original','Driver SCD Original','contract-v1','{}',true,
  'Driver SCD contract departure','2026-07-29 11:55:00+09:30','{}'
);

set role service_role;
create temporary table pg_temp.driver_scd_first_refresh as
select * from analytics.refresh_delivery_route_stop_facts(
  '2026-07-29 12:00:00+09:30'
);
reset role;

do $initial_dimension$
declare
  v_dimension_id bigint;
begin
  if exists(
    select 1 from pg_temp.driver_scd_first_refresh where refresh_state<>'CURRENT'
  ) then
    raise exception 'initial Driver SCD refresh failed: %',
      (select jsonb_agg(to_jsonb(r)) from pg_temp.driver_scd_first_refresh r);
  end if;

  select driver_dimension_id into v_dimension_id
  from analytics.dim_driver
  where source_system='ECOFLOW'
    and source_driver_key='91000000-0000-0000-0000-000000000001'
    and is_current
    and display_name='Driver SCD Original';

  if v_dimension_id is null then
    raise exception 'initial Driver dimension was not created';
  end if;

  if not exists(
    select 1 from analytics.fact_delivery_route_observation
    where source_route_key='2026-07-29:RUN:B'
      and is_current
      and driver_resolution_status='SINGLE'
      and driver_dimension_id=v_dimension_id
  ) then
    raise exception 'initial Route observation did not bind the Driver dimension';
  end if;
end;
$initial_dimension$;

update public.app_user_profiles
set display_name='Driver SCD Renamed',
    updated_at='2026-07-29 12:05:00+09:30'
where user_id='91000000-0000-0000-0000-000000000001';

set role service_role;
create temporary table pg_temp.driver_scd_second_refresh as
select * from analytics.refresh_delivery_route_stop_facts(
  '2026-07-29 12:10:00+09:30'
);
reset role;

do $versioned_dimension$
declare
  v_old_id bigint;
  v_new_id bigint;
begin
  if exists(
    select 1 from pg_temp.driver_scd_second_refresh where refresh_state<>'CURRENT'
  ) then
    raise exception 'renamed Driver SCD refresh failed: result=% status=%',
      (select jsonb_agg(to_jsonb(r)) from pg_temp.driver_scd_second_refresh r),
      (select jsonb_agg(jsonb_build_object(
        'dataset_key',rs.dataset_key,
        'status',rs.status,
        'error_code',rs.error_code,
        'error_message',rs.error_message
      ) order by rs.dataset_key)
       from analytics.refresh_status rs
       where rs.dataset_key in(
         'analytics.delivery_routes','analytics.delivery_stops'
       ));
  end if;

  select driver_dimension_id into v_old_id
  from analytics.dim_driver
  where source_system='ECOFLOW'
    and source_driver_key='91000000-0000-0000-0000-000000000001'
    and display_name='Driver SCD Original'
    and not is_current
    and effective_to='2026-07-29 12:10:00+09:30';

  select driver_dimension_id into v_new_id
  from analytics.dim_driver
  where source_system='ECOFLOW'
    and source_driver_key='91000000-0000-0000-0000-000000000001'
    and display_name='Driver SCD Renamed'
    and is_current
    and effective_from='2026-07-29 12:10:00+09:30';

  if v_old_id is null or v_new_id is null or v_old_id=v_new_id then
    raise exception 'Driver display-name change did not create an SCD version';
  end if;

  if (select count(*) from analytics.dim_driver
      where source_system='ECOFLOW'
        and source_driver_key='91000000-0000-0000-0000-000000000001')<>2 then
    raise exception 'Driver SCD version count is incorrect';
  end if;

  if (select count(*) from analytics.fact_delivery_route_observation
      where source_route_key='2026-07-29:RUN:B')<>1 then
    raise exception 'Driver name change created a false Route observation version';
  end if;

  if not exists(
    select 1 from analytics.fact_delivery_route_observation
    where source_route_key='2026-07-29:RUN:B'
      and is_current
      and driver_dimension_id=v_old_id
  ) then
    raise exception 'historical Route meaning was rebound to the new Driver dimension';
  end if;
end;
$versioned_dimension$;

-- A correction at the current dimension's own effective instant remains in-place.
update analytics.dim_driver
set display_name='Driver SCD Corrected',
    updated_at=effective_from
where source_system='ECOFLOW'
  and source_driver_key='91000000-0000-0000-0000-000000000001'
  and is_current;

do $same_instant_correction$
begin
  if (select count(*) from analytics.dim_driver
      where source_system='ECOFLOW'
        and source_driver_key='91000000-0000-0000-0000-000000000001')<>2 then
    raise exception 'same-effective-instant correction created false Driver history';
  end if;

  if not exists(
    select 1 from analytics.dim_driver
    where source_system='ECOFLOW'
      and source_driver_key='91000000-0000-0000-0000-000000000001'
      and is_current
      and display_name='Driver SCD Corrected'
  ) then
    raise exception 'same-effective-instant Driver correction was not retained';
  end if;

  if has_function_privilege(
    'authenticated',
    'analytics.ecoflow_version_driver_dimension_name_change()',
    'EXECUTE'
  ) or has_function_privilege(
    'service_role',
    'analytics.ecoflow_version_driver_dimension_name_change()',
    'EXECUTE'
  ) then
    raise exception 'Driver SCD trigger function is directly executable by runtime roles';
  end if;
end;
$same_instant_correction$;

rollback;

\echo 'Delivery Driver dimension SCD contract passed.'
