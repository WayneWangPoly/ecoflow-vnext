\set ON_ERROR_STOP on

begin;
set timezone='UTC';

create or replace view public.v_ecoflow_ordermentum_ui_active_exceptions as
select
  'raw-capability-1'::text as raw_order_id,
  'ext-capability-1'::text as external_order_id,
  'SO-CAPABILITY-1'::text as external_order_number,
  'EXT-INV-CAPABILITY-1'::text as external_invoice_number,
  'ORD-CAPABILITY-1'::text as order_number,
  'INV-CAPABILITY-1'::text as invoice_number,
  'MAPPING_EXCEPTION'::text as exception_type,
  'Role capability source'::text as message,
  'OPEN'::text as status,
  '2026-07-30 11:00:00+00'::timestamptz as detected_at;
grant select on public.v_ecoflow_ordermentum_ui_active_exceptions to authenticated;

create or replace function public.ecoflow_actionable_exception_role_capability_expect_error(
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
  raise exception 'EXPECTED_ACTIONABLE_EXCEPTION_ROLE_CAPABILITY_ERROR_NOT_RAISED: %',p_sql;
exception
  when others then
    if sqlerrm like 'EXPECTED_ACTIONABLE_EXCEPTION_ROLE_CAPABILITY_ERROR_NOT_RAISED:%' then
      raise;
    end if;
    if position(p_marker in sqlerrm)=0 then
      raise exception 'EXPECTED_ACTIONABLE_EXCEPTION_ROLE_CAPABILITY_ERROR_MARKER_MISSING: expected %, got %',
        p_marker,sqlerrm;
    end if;
end;
$$;

revoke all on function public.ecoflow_actionable_exception_role_capability_expect_error(text,text)
  from public,anon,authenticated;
grant execute on function public.ecoflow_actionable_exception_role_capability_expect_error(text,text)
  to authenticated;

do $structure$
declare
  v_definition text;
  v_result text;
  v_definer boolean;
begin
  if to_regprocedure('analytics.get_actionable_exception_lifecycle(text[],integer)') is null then
    raise exception 'role-aware actionable exception lifecycle read RPC missing';
  end if;

  select pg_get_functiondef(p.oid),pg_get_function_result(p.oid),p.prosecdef
  into v_definition,v_result,v_definer
  from pg_catalog.pg_proc p
  where p.oid='analytics.get_actionable_exception_lifecycle(text[],integer)'::regprocedure;

  if not v_definer then
    raise exception 'role-aware actionable exception lifecycle read must remain security definer';
  end if;
  if position('ecoflow_can_read_actionable_exceptions' in v_definition)=0
     or position('ecoflow_can_write_actionable_exception_lifecycle' in v_definition)=0
     or position('AVAILABLE' in v_definition)=0
     or position('READ_ONLY' in v_definition)=0 then
    raise exception 'role-aware actionable exception capability boundary incomplete';
  end if;
  if position('action_capability text' in v_result)=0 then
    raise exception 'role-aware actionable exception capability result missing';
  end if;

  if has_function_privilege(
       'anon','analytics.get_actionable_exception_lifecycle(text[],integer)','EXECUTE'
     )
     or has_function_privilege(
       'service_role','analytics.get_actionable_exception_lifecycle(text[],integer)','EXECUTE'
     )
     or not has_function_privilege(
       'authenticated','analytics.get_actionable_exception_lifecycle(text[],integer)','EXECUTE'
     ) then
    raise exception 'role-aware actionable exception lifecycle read ACL incorrect';
  end if;
end;
$structure$;

insert into auth.users(id,email)
values
  ('97000000-0000-0000-0000-000000000001','capability-owner@example.test'),
  ('97000000-0000-0000-0000-000000000002','capability-admin@example.test'),
  ('97000000-0000-0000-0000-000000000003','capability-account@example.test'),
  ('97000000-0000-0000-0000-000000000004','capability-viewer@example.test'),
  ('97000000-0000-0000-0000-000000000005','capability-warehouse@example.test'),
  ('97000000-0000-0000-0000-000000000006','capability-driver@example.test'),
  ('97000000-0000-0000-0000-000000000007','capability-inactive@example.test')
on conflict(id) do update set email=excluded.email;

insert into public.app_user_profiles(user_id,app_role,is_active,team_status)
values
  ('97000000-0000-0000-0000-000000000001','OWNER',true,'ACTIVE'),
  ('97000000-0000-0000-0000-000000000002','ADMIN',true,'ACTIVE'),
  ('97000000-0000-0000-0000-000000000003','ACCOUNT',true,'ACTIVE'),
  ('97000000-0000-0000-0000-000000000004','VIEWER',true,'ACTIVE'),
  ('97000000-0000-0000-0000-000000000005','WAREHOUSE',true,'ACTIVE'),
  ('97000000-0000-0000-0000-000000000006','DRIVER',true,'ACTIVE'),
  ('97000000-0000-0000-0000-000000000007','OWNER',false,'ACTIVE')
on conflict(user_id) do update
set app_role=excluded.app_role,
    is_active=excluded.is_active,
    team_status=excluded.team_status;

select 'ORDERMENTUM_ACTIVE:'||md5(concat_ws('|',
  'raw-capability-1','ext-capability-1','SO-CAPABILITY-1','EXT-INV-CAPABILITY-1',
  'ORD-CAPABILITY-1','INV-CAPABILITY-1','MAPPING_EXCEPTION','OPEN',
  '2026-07-30 11:00:00+00'::timestamptz::text
)) as capability_exception_id
\gset

set role authenticated;
select set_config('request.jwt.claim.role','authenticated',false);
select set_config('request.jwt.claim.sub','97000000-0000-0000-0000-000000000001',false);

select (r.lifecycle_status='ACKNOWLEDGED' and r.command_status='APPLIED') as seed_command_ok
from analytics.apply_actionable_exception_lifecycle_command(
  '97100000-0000-0000-0000-000000000001',:'capability_exception_id','ACKNOWLEDGE',
  null,null,null,null
) r
\gset
\if :seed_command_ok
\else
  \echo 'role capability seed command failed'
  \quit 1
\endif

select (l.action_capability='AVAILABLE') as owner_capability_ok
from analytics.get_actionable_exception_lifecycle(array[:'capability_exception_id'],10) l
\gset
\if :owner_capability_ok
\else
  \echo 'Owner did not receive AVAILABLE lifecycle action capability'
  \quit 1
\endif

select set_config('request.jwt.claim.sub','97000000-0000-0000-0000-000000000002',false);
select (l.action_capability='AVAILABLE') as admin_capability_ok
from analytics.get_actionable_exception_lifecycle(array[:'capability_exception_id'],10) l
\gset
\if :admin_capability_ok
\else
  \echo 'Admin did not receive AVAILABLE lifecycle action capability'
  \quit 1
\endif

select set_config('request.jwt.claim.sub','97000000-0000-0000-0000-000000000003',false);
select (l.action_capability='AVAILABLE') as account_capability_ok
from analytics.get_actionable_exception_lifecycle(array[:'capability_exception_id'],10) l
\gset
\if :account_capability_ok
\else
  \echo 'Account did not receive AVAILABLE lifecycle action capability'
  \quit 1
\endif

select set_config('request.jwt.claim.sub','97000000-0000-0000-0000-000000000004',false);
select (
  l.action_capability='READ_ONLY'
  and l.lifecycle_capability='AVAILABLE'
  and l.ownership_capability='AVAILABLE'
  and l.history_capability='AVAILABLE'
  and l.lifecycle_status='ACKNOWLEDGED'
) as viewer_capability_ok
from analytics.get_actionable_exception_lifecycle(array[:'capability_exception_id'],10) l
\gset
\if :viewer_capability_ok
\else
  \echo 'Viewer lifecycle read was not explicitly READ_ONLY'
  \quit 1
\endif

select public.ecoflow_actionable_exception_role_capability_expect_error(
  format(
    'select * from analytics.apply_actionable_exception_lifecycle_command(%L,%L,%L,null,null,null,null)',
    '97100000-0000-0000-0000-000000000002',:'capability_exception_id','UNASSIGN'
  ),
  'ACTIONABLE_EXCEPTION_OWNER_ADMIN_OR_ACCOUNT_REQUIRED'
);

select set_config('request.jwt.claim.sub','97000000-0000-0000-0000-000000000005',false);
select public.ecoflow_actionable_exception_role_capability_expect_error(
  format(
    'select * from analytics.get_actionable_exception_lifecycle(array[%L],10)',
    :'capability_exception_id'
  ),
  'ACTIONABLE_EXCEPTION_DESKTOP_ROLE_REQUIRED'
);

select set_config('request.jwt.claim.sub','97000000-0000-0000-0000-000000000006',false);
select public.ecoflow_actionable_exception_role_capability_expect_error(
  format(
    'select * from analytics.get_actionable_exception_lifecycle(array[%L],10)',
    :'capability_exception_id'
  ),
  'ACTIONABLE_EXCEPTION_DESKTOP_ROLE_REQUIRED'
);

select set_config('request.jwt.claim.sub','97000000-0000-0000-0000-000000000007',false);
select public.ecoflow_actionable_exception_role_capability_expect_error(
  format(
    'select * from analytics.get_actionable_exception_lifecycle(array[%L],10)',
    :'capability_exception_id'
  ),
  'ACTIONABLE_EXCEPTION_DESKTOP_ROLE_REQUIRED'
);

reset role;
rollback;
