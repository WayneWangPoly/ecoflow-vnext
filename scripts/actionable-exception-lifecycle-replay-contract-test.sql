\set ON_ERROR_STOP on

begin;
set timezone='UTC';

create or replace view public.v_ecoflow_ordermentum_ui_active_exceptions as
select
  'raw-replay-1'::text as raw_order_id,
  'ext-replay-1'::text as external_order_id,
  'SO-REPLAY-1'::text as external_order_number,
  'EXT-INV-REPLAY-1'::text as external_invoice_number,
  'ORD-REPLAY-1'::text as order_number,
  'INV-REPLAY-1'::text as invoice_number,
  'MAPPING_EXCEPTION'::text as exception_type,
  'Replay snapshot source'::text as message,
  'OPEN'::text as status,
  '2026-07-30 10:00:00+00'::timestamptz as detected_at;
grant select on public.v_ecoflow_ordermentum_ui_active_exceptions to authenticated;

do $structure$
declare
  v_wrapper_definer boolean;
  v_internal_auth_execute boolean;
begin
  if not exists(
    select 1
    from pg_catalog.pg_attribute
    where attrelid='analytics.actionable_exception_lifecycle_event'::regclass
      and attname='resulting_version'
      and attnum>0
      and not attisdropped
  ) then
    raise exception 'actionable exception resulting version snapshot missing';
  end if;
  if not exists(
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid='analytics.actionable_exception_lifecycle_event'::regclass
      and t.tgname='actionable_exception_event_capture_result'
      and not t.tgisinternal
  ) then
    raise exception 'actionable exception result capture trigger missing';
  end if;

  select p.prosecdef into v_wrapper_definer
  from pg_catalog.pg_proc p
  where p.oid='analytics.apply_actionable_exception_lifecycle_command(uuid,text,text,text,timestamp with time zone,text,text)'::regprocedure;
  if not v_wrapper_definer then
    raise exception 'actionable exception replay wrapper must be security definer';
  end if;

  v_internal_auth_execute := has_function_privilege(
    'authenticated',
    'analytics.apply_actionable_exception_lifecycle_command_unsnapshotted_20260730(uuid,text,text,text,timestamp with time zone,text,text)',
    'EXECUTE'
  );
  if v_internal_auth_execute then
    raise exception 'authenticated role must not execute unsnapshotted lifecycle command';
  end if;
end;
$structure$;

insert into auth.users(id,email)
values ('96000000-0000-0000-0000-000000000001','replay-owner@example.test')
on conflict(id) do update set email=excluded.email;

insert into public.app_user_profiles(user_id,app_role,is_active,team_status)
values ('96000000-0000-0000-0000-000000000001','OWNER',true,'ACTIVE')
on conflict(user_id) do update
set app_role=excluded.app_role,is_active=excluded.is_active,team_status=excluded.team_status;

select 'ORDERMENTUM_ACTIVE:'||md5(concat_ws('|',
  'raw-replay-1','ext-replay-1','SO-REPLAY-1','EXT-INV-REPLAY-1',
  'ORD-REPLAY-1','INV-REPLAY-1','MAPPING_EXCEPTION','OPEN',
  '2026-07-30 10:00:00+00'::timestamptz::text
)) as replay_exception_id
\gset

set role authenticated;
select set_config('request.jwt.claim.role','authenticated',false);
select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000001',false);

select (
  r.lifecycle_status='ACKNOWLEDGED'
  and r.owner_team is null
  and r.acknowledged_at is not null
  and r.resolved_at is null
  and r.version=1
  and r.command_status='APPLIED'
) as initial_command_ok
from analytics.apply_actionable_exception_lifecycle_command(
  '96100000-0000-0000-0000-000000000001',:'replay_exception_id','ACKNOWLEDGE',
  null,null,null,null
) r
\gset
\if :initial_command_ok
\else
  \echo 'initial replay-snapshot command failed'
  \quit 1
\endif

select (
  r.lifecycle_status='ACKNOWLEDGED'
  and r.owner_team='Order Operations'
  and r.version=2
) as later_assign_ok
from analytics.apply_actionable_exception_lifecycle_command(
  '96100000-0000-0000-0000-000000000002',:'replay_exception_id','ASSIGN',
  'Order Operations',null,null,null
) r
\gset
\if :later_assign_ok
\else
  \echo 'later assignment for replay snapshot failed'
  \quit 1
\endif

select (
  r.lifecycle_status='RESOLVED'
  and r.owner_team='Order Operations'
  and r.resolved_at is not null
  and r.version=3
) as later_resolve_ok
from analytics.apply_actionable_exception_lifecycle_command(
  '96100000-0000-0000-0000-000000000003',:'replay_exception_id','RESOLVE',
  null,null,'Closed after assignment',null
) r
\gset
\if :later_resolve_ok
\else
  \echo 'later resolution for replay snapshot failed'
  \quit 1
\endif

select (
  r.lifecycle_status='ACKNOWLEDGED'
  and r.owner_team is null
  and r.acknowledged_at is not null
  and r.resolved_at is null
  and r.version=1
  and r.command_status='REPLAYED'
) as historical_replay_ok
from analytics.apply_actionable_exception_lifecycle_command(
  '96100000-0000-0000-0000-000000000001',:'replay_exception_id','ACKNOWLEDGE',
  null,null,null,null
) r
\gset
\if :historical_replay_ok
\else
  \echo 'historical lifecycle replay leaked newer current state'
  \quit 1
\endif

select (
  l.lifecycle_status='RESOLVED'
  and l.owner_team='Order Operations'
  and l.version=3
) as current_state_remains_latest
from analytics.get_actionable_exception_lifecycle(array[:'replay_exception_id'],10) l
\gset
\if :current_state_remains_latest
\else
  \echo 'historical replay changed current lifecycle state'
  \quit 1
\endif

reset role;

select (
  e.resulting_version=1
  and e.resulting_acknowledged_at is not null
  and e.resulting_resolved_at is null
) as stored_snapshot_ok
from analytics.actionable_exception_lifecycle_event e
where e.command_id='96100000-0000-0000-0000-000000000001'
\gset
\if :stored_snapshot_ok
\else
  \echo 'immutable lifecycle result snapshot was not stored'
  \quit 1
\endif

rollback;
