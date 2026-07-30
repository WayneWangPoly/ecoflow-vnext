\set ON_ERROR_STOP on

begin;
set timezone='UTC';

create or replace function public.ecoflow_actionable_exception_access_expect_error(
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
  raise exception 'EXPECTED_ACTIONABLE_EXCEPTION_ACCESS_ERROR_NOT_RAISED: %',p_sql;
exception
  when others then
    if sqlerrm like 'EXPECTED_ACTIONABLE_EXCEPTION_ACCESS_ERROR_NOT_RAISED:%' then
      raise;
    end if;
    if position(p_marker in sqlerrm)=0 then
      raise exception 'EXPECTED_ACTIONABLE_EXCEPTION_ACCESS_ERROR_MARKER_MISSING: expected %, got %',
        p_marker,sqlerrm;
    end if;
end;
$$;

revoke all on function public.ecoflow_actionable_exception_access_expect_error(text,text)
  from public,anon,authenticated;
grant execute on function public.ecoflow_actionable_exception_access_expect_error(text,text)
  to authenticated;

do $structure$
declare
  v_definition text;
  v_result text;
  v_definer boolean;
begin
  if to_regprocedure('analytics.get_actionable_exception_lifecycle_access()') is null then
    raise exception 'actionable exception lifecycle access RPC missing';
  end if;

  select pg_get_functiondef(p.oid),pg_get_function_result(p.oid),p.prosecdef
  into v_definition,v_result,v_definer
  from pg_catalog.pg_proc p
  where p.oid='analytics.get_actionable_exception_lifecycle_access()'::regprocedure;

  if not v_definer then
    raise exception 'actionable exception lifecycle access RPC must be security definer';
  end if;
  if position('ecoflow_can_read_actionable_exceptions' in v_definition)=0
     or position('ecoflow_can_write_actionable_exception_lifecycle' in v_definition)=0
     or position('READ_ONLY' in v_definition)=0
     or position('ACKNOWLEDGE' in v_definition)=0
     or position('ADD_NOTE' in v_definition)=0 then
    raise exception 'actionable exception lifecycle access role/command boundary incomplete';
  end if;
  if position('action_capability text' in v_result)=0
     or position('command_actions text[]' in v_result)=0
     or position('command_id_required boolean' in v_result)=0
     or position('max_history_events integer' in v_result)=0 then
    raise exception 'actionable exception lifecycle access result incomplete: %',v_result;
  end if;

  if has_function_privilege(
       'anon','analytics.get_actionable_exception_lifecycle_access()','EXECUTE'
     )
     or has_function_privilege(
       'service_role','analytics.get_actionable_exception_lifecycle_access()','EXECUTE'
     )
     or not has_function_privilege(
       'authenticated','analytics.get_actionable_exception_lifecycle_access()','EXECUTE'
     ) then
    raise exception 'actionable exception lifecycle access ACL incorrect';
  end if;
end;
$structure$;

insert into auth.users(id,email)
values
  ('98000000-0000-0000-0000-000000000001','access-owner@example.test'),
  ('98000000-0000-0000-0000-000000000002','access-admin@example.test'),
  ('98000000-0000-0000-0000-000000000003','access-account@example.test'),
  ('98000000-0000-0000-0000-000000000004','access-viewer@example.test'),
  ('98000000-0000-0000-0000-000000000005','access-warehouse@example.test'),
  ('98000000-0000-0000-0000-000000000006','access-driver@example.test'),
  ('98000000-0000-0000-0000-000000000007','access-inactive@example.test')
on conflict(id) do update set email=excluded.email;

insert into public.app_user_profiles(user_id,app_role,is_active,team_status)
values
  ('98000000-0000-0000-0000-000000000001','OWNER',true,'ACTIVE'),
  ('98000000-0000-0000-0000-000000000002','ADMIN',true,'ACTIVE'),
  ('98000000-0000-0000-0000-000000000003','ACCOUNT',true,'ACTIVE'),
  ('98000000-0000-0000-0000-000000000004','VIEWER',true,'ACTIVE'),
  ('98000000-0000-0000-0000-000000000005','WAREHOUSE',true,'ACTIVE'),
  ('98000000-0000-0000-0000-000000000006','DRIVER',true,'ACTIVE'),
  ('98000000-0000-0000-0000-000000000007','OWNER',false,'ACTIVE')
on conflict(user_id) do update
set app_role=excluded.app_role,is_active=excluded.is_active,team_status=excluded.team_status;

-- The capability envelope must work before any lifecycle row exists.
select (count(*)=0) as lifecycle_is_empty
from analytics.actionable_exception_lifecycle
\gset
\if :lifecycle_is_empty
\else
  \echo 'lifecycle access contract requires an empty ledger fixture'
  \quit 1
\endif

set role authenticated;
select set_config('request.jwt.claim.role','authenticated',false);

select set_config('request.jwt.claim.sub','98000000-0000-0000-0000-000000000001',false);
select (
  a.access_version=1
  and a.action_capability='AVAILABLE'
  and a.lifecycle_capability='AVAILABLE'
  and a.ownership_capability='AVAILABLE'
  and a.history_capability='AVAILABLE'
  and a.command_actions=array[
    'ACKNOWLEDGE','ASSIGN','UNASSIGN','SNOOZE','UNSNOOZE',
    'RESOLVE','REOPEN','ADD_NOTE'
  ]::text[]
  and a.command_id_required
  and a.max_read_ids=300
  and a.max_read_rows=300
  and a.max_history_events=50
  and a.max_snooze_days=30
) as owner_access_ok
from analytics.get_actionable_exception_lifecycle_access() a
\gset
\if :owner_access_ok
\else
  \echo 'Owner lifecycle access envelope incorrect'
  \quit 1
\endif

select set_config('request.jwt.claim.sub','98000000-0000-0000-0000-000000000002',false);
select (a.action_capability='AVAILABLE' and cardinality(a.command_actions)=8) as admin_access_ok
from analytics.get_actionable_exception_lifecycle_access() a
\gset
\if :admin_access_ok
\else
  \echo 'Admin lifecycle access envelope incorrect'
  \quit 1
\endif

select set_config('request.jwt.claim.sub','98000000-0000-0000-0000-000000000003',false);
select (a.action_capability='AVAILABLE' and cardinality(a.command_actions)=8) as account_access_ok
from analytics.get_actionable_exception_lifecycle_access() a
\gset
\if :account_access_ok
\else
  \echo 'Account lifecycle access envelope incorrect'
  \quit 1
\endif

select set_config('request.jwt.claim.sub','98000000-0000-0000-0000-000000000004',false);
select (
  a.action_capability='READ_ONLY'
  and cardinality(a.command_actions)=0
  and a.command_id_required
  and a.lifecycle_capability='AVAILABLE'
  and a.ownership_capability='AVAILABLE'
  and a.history_capability='AVAILABLE'
) as viewer_access_ok
from analytics.get_actionable_exception_lifecycle_access() a
\gset
\if :viewer_access_ok
\else
  \echo 'Viewer lifecycle access envelope incorrect'
  \quit 1
\endif

select set_config('request.jwt.claim.sub','98000000-0000-0000-0000-000000000005',false);
select public.ecoflow_actionable_exception_access_expect_error(
  $$select * from analytics.get_actionable_exception_lifecycle_access()$$,
  'ACTIONABLE_EXCEPTION_DESKTOP_ROLE_REQUIRED'
);

select set_config('request.jwt.claim.sub','98000000-0000-0000-0000-000000000006',false);
select public.ecoflow_actionable_exception_access_expect_error(
  $$select * from analytics.get_actionable_exception_lifecycle_access()$$,
  'ACTIONABLE_EXCEPTION_DESKTOP_ROLE_REQUIRED'
);

select set_config('request.jwt.claim.sub','98000000-0000-0000-0000-000000000007',false);
select public.ecoflow_actionable_exception_access_expect_error(
  $$select * from analytics.get_actionable_exception_lifecycle_access()$$,
  'ACTIONABLE_EXCEPTION_DESKTOP_ROLE_REQUIRED'
);

reset role;
rollback;
