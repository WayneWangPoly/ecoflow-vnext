\set ON_ERROR_STOP on

begin;

reset role;

delete from public.ecoflow_day_state where business_day='2026-07-12';

insert into public.ecoflow_day_state(business_day,scope,payload,updated_by)
values
  ('2026-07-12','run:A:stop:SEQ-1','{"status":"PENDING"}','Contract'),
  ('2026-07-12','run:A:stop:SEQ-2','{"status":"PENDING"}','Contract'),
  ('2026-07-12','shift','{"events":[]}','Contract');

do $$
declare
  v_count integer;
  v_distinct integer;
  v_min bigint;
  v_before bigint;
  v_after bigint;
begin
  select count(*),count(distinct change_seq),min(change_seq)
  into v_count,v_distinct,v_min
  from public.ecoflow_day_state
  where business_day='2026-07-12';

  if v_count<>3 or v_distinct<>3 or v_min is null then
    raise exception 'bulk day-state writes did not receive distinct server sequences';
  end if;

  select change_seq into v_before
  from public.ecoflow_day_state
  where business_day='2026-07-12' and scope='run:A:stop:SEQ-1';

  update public.ecoflow_day_state
  set payload='{"status":"ARRIVED"}'::jsonb,change_seq=1
  where business_day='2026-07-12' and scope='run:A:stop:SEQ-1';

  select change_seq into v_after
  from public.ecoflow_day_state
  where business_day='2026-07-12' and scope='run:A:stop:SEQ-1';

  if v_after<=v_before or v_after=1 then
    raise exception 'update did not replace caller sequence with a newer server sequence';
  end if;
end $$;

do $$
begin
  if has_sequence_privilege('authenticated','public.ecoflow_day_state_change_seq','USAGE') then
    raise exception 'authenticated retained direct sequence usage';
  end if;
  if has_function_privilege('authenticated','public.ecoflow_touch_day_state_change_seq()','EXECUTE') then
    raise exception 'authenticated retained direct trigger-function execution';
  end if;
end $$;

set role authenticated;
select set_config('request.jwt.claim.role','authenticated',false);
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);

insert into public.ecoflow_day_state(business_day,scope,payload,updated_by,change_seq)
values ('2026-07-12','run:A:stop:SEQ-3','{"status":"ARRIVED"}','Driver',1);

reset role;

do $$
declare
  v_sequence bigint;
begin
  select change_seq into v_sequence
  from public.ecoflow_day_state
  where business_day='2026-07-12' and scope='run:A:stop:SEQ-3';
  if v_sequence is null or v_sequence=1 then
    raise exception 'authenticated caller controlled change_seq';
  end if;
end $$;

rollback;

select 'day-state change sequence contract passed' as result;
