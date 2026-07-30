\set ON_ERROR_STOP on

begin;

create or replace function public.ecoflow_priority_work_expect_error(
  p_sql text,
  p_marker text
)
returns void
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
begin
  execute p_sql;
  raise exception 'EXPECTED_PRIORITY_WORK_ERROR_NOT_RAISED: %',p_sql;
exception
  when others then
    if sqlerrm like 'EXPECTED_PRIORITY_WORK_ERROR_NOT_RAISED:%' then
      raise;
    end if;
    if position(p_marker in sqlerrm)=0 then
      raise exception 'EXPECTED_PRIORITY_WORK_ERROR_MARKER_MISSING: expected %, got %',
        p_marker,sqlerrm;
    end if;
end;
$$;

grant execute on function public.ecoflow_priority_work_expect_error(text,text)
  to authenticated;

do $structure$
declare
  v_definition text;
  v_result text;
  v_security_definer boolean;
begin
  if to_regclass('analytics.actionable_exception_priority_policy') is null then
    raise exception 'Priority Work policy table missing';
  end if;
  if to_regprocedure('analytics.get_priority_work_queue(integer)') is null then
    raise exception 'Priority Work RPC missing';
  end if;

  if has_table_privilege(
       'authenticated','analytics.actionable_exception_priority_policy','SELECT'
     )
     or has_table_privilege(
       'service_role','analytics.actionable_exception_priority_policy','SELECT'
     ) then
    raise exception 'Priority Work policy table is browser or service readable';
  end if;

  if has_function_privilege(
       'anon','analytics.get_priority_work_queue(integer)','EXECUTE'
     )
     or has_function_privilege(
       'service_role','analytics.get_priority_work_queue(integer)','EXECUTE'
     )
     or not has_function_privilege(
       'authenticated','analytics.get_priority_work_queue(integer)','EXECUTE'
     ) then
    raise exception 'Priority Work RPC execute ACL is incorrect';
  end if;

  select
    pg_get_functiondef('analytics.get_priority_work_queue(integer)'::regprocedure),
    pg_get_function_result('analytics.get_priority_work_queue(integer)'::regprocedure),
    p.prosecdef
  into v_definition,v_result,v_security_definer
  from pg_catalog.pg_proc p
  where p.oid='analytics.get_priority_work_queue(integer)'::regprocedure;

  if not v_security_definer then
    raise exception 'Priority Work RPC must protect governed tables with security definer';
  end if;

  if position('public.v_ecoflow_ordermentum_ui_active_exceptions' in v_definition)=0
     or position('analytics.actionable_exception_priority_policy' in v_definition)=0
     or position('analytics.actionable_exception_lifecycle' in v_definition)=0
     or position('priority_rank asc' in lower(v_definition))=0
     or position('detected_at asc' in lower(v_definition))=0
     or position('lifecycle_status=''RESOLVED''' in v_definition)=0
     or position('lifecycle_status=''SNOOZED''' in v_definition)=0 then
    raise exception 'Priority Work source, policy, lifecycle or ranking boundary missing';
  end if;

  if v_definition ~* '\m(insert|update|delete|merge|truncate|refresh)\M'
     or v_definition ~* '\mexecute\M'
     or v_definition ~* 'fact_[a-z_]+'
     or v_definition ~* 'metric_value'
     or v_definition ~* 'severity'
     or v_definition ~* 'due_at' then
    raise exception 'Priority Work RPC contains write, unsupported facts or invented fields';
  end if;

  if position('order_entity_id text' in v_result)=0
     or position('cause_title text' in v_result)=0
     or position('impact_statement text' in v_result)=0
     or position('age_seconds bigint' in v_result)=0
     or position('owner_team text' in v_result)=0
     or position('next_action text' in v_result)=0
     or position('priority_rank integer' in v_result)=0 then
    raise exception 'Priority Work return contract is incomplete: %',v_result;
  end if;
end;
$structure$;

create or replace view public.v_ecoflow_ordermentum_ui_active_exceptions as
select *
from (values
  (
    'PW-1'::text,'EXT-1'::text,'OMO-001'::text,'INV-001'::text,
    'ORDER-001'::text,'INV-001'::text,'Invoice detail missing'::text,
    'Invoice detail missing for the mirrored order header.'::text,
    'OPEN'::text,'2026-07-01 08:00:00+09:30'::timestamptz
  ),
  (
    'PW-2','EXT-2','OMO-002','INV-002','ORDER-002','INV-002',
    'Invoice detail missing','Invoice detail missing for the mirrored line detail.',
    'OPEN','2026-07-20 08:00:00+09:30'::timestamptz
  ),
  (
    'PW-3','EXT-3','OMO-003','INV-003','ORDER-003','INV-003',
    'Payment review','Payment review is required.',
    'OPEN','2026-06-01 08:00:00+09:30'::timestamptz
  ),
  (
    'PW-4','EXT-4','OMO-004','INV-004','ORDER-004','INV-004',
    'Invoice detail missing','Invoice detail missing but review was resolved.',
    'OPEN','2026-06-15 08:00:00+09:30'::timestamptz
  ),
  (
    'PW-5','EXT-5','OMO-005','INV-005','ORDER-005','INV-005',
    'Invoice detail missing','Invoice detail missing but review is snoozed.',
    'OPEN','2026-06-20 08:00:00+09:30'::timestamptz
  )
) as e(
  raw_order_id,external_order_id,external_order_number,
  external_invoice_number,order_number,invoice_number,
  exception_type,message,status,detected_at
);

grant select on public.v_ecoflow_ordermentum_ui_active_exceptions
  to authenticated;

insert into auth.users(id,email)
values
  ('96000000-0000-0000-0000-000000000001','priority-owner@example.test'),
  ('96000000-0000-0000-0000-000000000002','priority-admin@example.test'),
  ('96000000-0000-0000-0000-000000000003','priority-account@example.test'),
  ('96000000-0000-0000-0000-000000000004','priority-viewer@example.test'),
  ('96000000-0000-0000-0000-000000000005','priority-warehouse@example.test'),
  ('96000000-0000-0000-0000-000000000006','priority-driver@example.test'),
  ('96000000-0000-0000-0000-000000000007','priority-inactive@example.test')
on conflict(id) do update set email=excluded.email;

insert into public.app_user_profiles(user_id,app_role,is_active,team_status)
values
  ('96000000-0000-0000-0000-000000000001','OWNER',true,'ACTIVE'),
  ('96000000-0000-0000-0000-000000000002','ADMIN',true,'ACTIVE'),
  ('96000000-0000-0000-0000-000000000003','ACCOUNT',true,'ACTIVE'),
  ('96000000-0000-0000-0000-000000000004','VIEWER',true,'ACTIVE'),
  ('96000000-0000-0000-0000-000000000005','WAREHOUSE',true,'ACTIVE'),
  ('96000000-0000-0000-0000-000000000006','DRIVER',true,'ACTIVE'),
  ('96000000-0000-0000-0000-000000000007','OWNER',false,'INACTIVE')
on conflict(user_id) do update
set app_role=excluded.app_role,
    is_active=excluded.is_active,
    team_status=excluded.team_status;

with identified as (
  select
    'ORDERMENTUM_ACTIVE:'||md5(concat_ws('|',
      coalesce(raw_order_id,''),coalesce(external_order_id,''),
      coalesce(external_order_number,''),coalesce(external_invoice_number,''),
      coalesce(order_number,''),coalesce(invoice_number,''),
      coalesce(exception_type,''),coalesce(status,''),coalesce(detected_at::text,'')
    )) as exception_id,
    *
  from public.v_ecoflow_ordermentum_ui_active_exceptions
)
insert into analytics.actionable_exception_lifecycle(
  exception_id,source_key,source_kind,source_status,title,detail,detected_at,
  handoff_workspace,handoff_entity_kind,handoff_entity_id,lifecycle_status,
  owner_team,resolved_at,resolved_by,resolution_note,
  snoozed_until,snooze_resume_status
)
select
  i.exception_id,i.exception_id,'order',i.status,i.exception_type,i.message,
  i.detected_at,'orders','order',i.raw_order_id,
  case i.raw_order_id
    when 'PW-2' then 'ACKNOWLEDGED'
    when 'PW-4' then 'RESOLVED'
    when 'PW-5' then 'SNOOZED'
  end,
  case when i.raw_order_id='PW-2' then 'Operations' end,
  case when i.raw_order_id='PW-4' then '2026-07-01 10:00:00+09:30'::timestamptz end,
  case when i.raw_order_id='PW-4' then '96000000-0000-0000-0000-000000000001'::uuid end,
  case when i.raw_order_id='PW-4' then 'Mirrored detail verified.' end,
  case when i.raw_order_id='PW-5' then '2099-01-01 00:00:00+00'::timestamptz end,
  case when i.raw_order_id='PW-5' then 'OPEN' end
from identified i
where i.raw_order_id in ('PW-2','PW-4','PW-5');

set role authenticated;
select set_config('request.jwt.claim.role','authenticated',false);

select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000005',false);
select public.ecoflow_priority_work_expect_error(
  $$select * from analytics.get_priority_work_queue(20)$$,
  'PRIORITY_WORK_DESKTOP_ROLE_REQUIRED'
);
select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000006',false);
select public.ecoflow_priority_work_expect_error(
  $$select * from analytics.get_priority_work_queue(20)$$,
  'PRIORITY_WORK_DESKTOP_ROLE_REQUIRED'
);
select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000007',false);
select public.ecoflow_priority_work_expect_error(
  $$select * from analytics.get_priority_work_queue(20)$$,
  'PRIORITY_WORK_DESKTOP_ROLE_REQUIRED'
);
select set_config('request.jwt.claim.sub','',false);
select public.ecoflow_priority_work_expect_error(
  $$select * from analytics.get_priority_work_queue(20)$$,
  'PRIORITY_WORK_DESKTOP_ROLE_REQUIRED'
);

select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000001',false);
select public.ecoflow_priority_work_expect_error(
  $$select * from analytics.get_priority_work_queue(0)$$,
  'PRIORITY_WORK_LIMIT_INVALID'
);
select public.ecoflow_priority_work_expect_error(
  $$select * from analytics.get_priority_work_queue(101)$$,
  'PRIORITY_WORK_LIMIT_INVALID'
);

select (count(*)=2) as owner_received_only_complete_active_priority_items
from analytics.get_priority_work_queue(20)
\gset
\if :owner_received_only_complete_active_priority_items
\else
  \echo 'Priority Work did not suppress unmatched, resolved or active-snoozed exceptions'
  \quit 1
\endif

select (
  array_agg(order_entity_id order by sequence_no)=array['PW-1','PW-2']::text[]
  and min(priority_capability)='POLICY_GOVERNED'
  and max(priority_capability)='POLICY_GOVERNED'
  and min(priority_rank)=40
  and max(priority_rank)=40
) as priority_order_is_policy_then_unassigned_then_oldest
from (
  select *,row_number() over() as sequence_no
  from analytics.get_priority_work_queue(20)
) ranked
\gset
\if :priority_order_is_policy_then_unassigned_then_oldest
\else
  \echo 'Priority Work was not ordered by governed priority, assignment and oldest age'
  \quit 1
\endif

select (
  count(*) filter(where order_display_label is null or cause_title is null)=0
  and count(*) filter(where impact_statement is null or btrim(impact_statement)='')=0
  and count(*) filter(where next_action is null or btrim(next_action)='')=0
  and count(*) filter(where detected_at is null or age_seconds<0)=0
  and count(*) filter(where owner_team is null)=1
  and count(*) filter(where owner_team='Operations')=1
  and count(distinct read_at)=1
) as priority_rows_are_complete_and_snapshot_consistent
from analytics.get_priority_work_queue(20)
\gset
\if :priority_rows_are_complete_and_snapshot_consistent
\else
  \echo 'Priority Work rows are incomplete or snapshot-inconsistent'
  \quit 1
\endif

select (
  impact_statement='EcoFlow cannot verify the Order from mirrored invoice or line detail.'
  and next_action='Open the Order and verify the mirrored invoice or line detail.'
  and cause_title='Invoice detail missing'
  and cause_detail like 'Invoice detail missing%'
) as priority_policy_copy_is_exact
from analytics.get_priority_work_queue(20)
where order_entity_id='PW-1'
\gset
\if :priority_policy_copy_is_exact
\else
  \echo 'Priority Work impact or next action drifted from governed policy'
  \quit 1
\endif

select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000002',false);
select (count(*)=2) as admin_read_succeeds
from analytics.get_priority_work_queue(20)
\gset
\if :admin_read_succeeds
\else
  \echo 'Admin Priority Work read failed'
  \quit 1
\endif

select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000003',false);
select (count(*)=2) as account_read_succeeds
from analytics.get_priority_work_queue(20)
\gset
\if :account_read_succeeds
\else
  \echo 'Account Priority Work read failed'
  \quit 1
\endif

select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000004',false);
select (count(*)=2) as viewer_read_succeeds
from analytics.get_priority_work_queue(20)
\gset
\if :viewer_read_succeeds
\else
  \echo 'Viewer Priority Work read failed'
  \quit 1
\endif

reset role;

update analytics.actionable_exception_priority_policy
set enabled=false,updated_at=clock_timestamp()
where policy_key='invoice_detail_missing';

set role authenticated;
select set_config('request.jwt.claim.role','authenticated',false);
select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000001',false);
select (count(*)=0) as disabled_policy_suppresses_priority_work
from analytics.get_priority_work_queue(20)
\gset
\if :disabled_policy_suppresses_priority_work
\else
  \echo 'Disabled Priority Work policy still produced rows'
  \quit 1
\endif

reset role;
rollback;
