\set ON_ERROR_STOP on

begin;

create or replace function public.ecoflow_actionable_exception_expect_error(
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
  raise exception 'EXPECTED_ACTIONABLE_EXCEPTION_ERROR_NOT_RAISED: %',p_sql;
exception
  when others then
    if sqlerrm like 'EXPECTED_ACTIONABLE_EXCEPTION_ERROR_NOT_RAISED:%' then
      raise;
    end if;
    if position(p_marker in sqlerrm)=0 then
      raise exception 'EXPECTED_ACTIONABLE_EXCEPTION_ERROR_MARKER_MISSING: expected %, got %',
        p_marker,sqlerrm;
    end if;
end;
$$;

revoke all on function public.ecoflow_actionable_exception_expect_error(text,text)
  from public,anon,authenticated;
grant execute on function public.ecoflow_actionable_exception_expect_error(text,text)
  to authenticated;

do $structure$
declare
  v_definition text;
  v_result text;
  v_security_definer boolean;
begin
  if to_regprocedure('analytics.get_actionable_exception_queue(integer)') is null then
    raise exception 'actionable exception read RPC missing';
  end if;

  if has_function_privilege(
       'anon','analytics.get_actionable_exception_queue(integer)','EXECUTE'
     )
     or has_function_privilege(
       'service_role','analytics.get_actionable_exception_queue(integer)','EXECUTE'
     )
     or not has_function_privilege(
       'authenticated','analytics.get_actionable_exception_queue(integer)','EXECUTE'
     ) then
    raise exception 'actionable exception RPC execute ACL is incorrect';
  end if;

  select pg_get_functiondef('analytics.get_actionable_exception_queue(integer)'::regprocedure),
         pg_get_function_result('analytics.get_actionable_exception_queue(integer)'::regprocedure),
         p.prosecdef
  into v_definition,v_result,v_security_definer
  from pg_catalog.pg_proc p
  where p.oid='analytics.get_actionable_exception_queue(integer)'::regprocedure;

  if v_security_definer then
    raise exception 'actionable exception RPC must preserve caller rights';
  end if;

  if position('public.v_ecoflow_ordermentum_ui_active_exceptions' in v_definition)=0
     or position('CURRENT_ACTIVE_ONLY' in v_definition)=0
     or position('UNAVAILABLE' in v_definition)=0 then
    raise exception 'actionable exception source or capability boundary missing';
  end if;

  if v_definition ~* '\m(insert|update|delete|merge|truncate|refresh)\M'
     or v_definition ~* '\mexecute\M'
     or v_definition ~* 'fact_[a-z_]+'
     or v_definition ~* 'ecoflow_delivery_exceptions'
     or v_definition ~* 'data_quality_status' then
    raise exception 'actionable exception RPC contains write, dynamic SQL or unsupported source access';
  end if;

  if position('severity text' in v_result)=0
     or position('due_at timestamp with time zone' in v_result)=0
     or position('impact_value numeric' in v_result)=0
     or position('audit_history jsonb' in v_result)=0
     or position('lifecycle_capability text' in v_result)=0
     or position('history_capability text' in v_result)=0 then
    raise exception 'actionable exception return contract is incomplete: %',v_result;
  end if;
end;
$structure$;

insert into auth.users(id,email)
values
  ('94000000-0000-0000-0000-000000000001','exceptions-owner@example.test'),
  ('94000000-0000-0000-0000-000000000002','exceptions-account@example.test'),
  ('94000000-0000-0000-0000-000000000003','exceptions-viewer@example.test'),
  ('94000000-0000-0000-0000-000000000004','exceptions-warehouse@example.test'),
  ('94000000-0000-0000-0000-000000000005','exceptions-driver@example.test'),
  ('94000000-0000-0000-0000-000000000006','exceptions-inactive@example.test')
on conflict(id) do update set email=excluded.email;

insert into public.app_user_profiles(user_id,app_role,is_active,team_status)
values
  ('94000000-0000-0000-0000-000000000001','OWNER',true,'ACTIVE'),
  ('94000000-0000-0000-0000-000000000002','ACCOUNT',true,'ACTIVE'),
  ('94000000-0000-0000-0000-000000000003','VIEWER',true,'ACTIVE'),
  ('94000000-0000-0000-0000-000000000004','WAREHOUSE',true,'ACTIVE'),
  ('94000000-0000-0000-0000-000000000005','DRIVER',true,'ACTIVE'),
  ('94000000-0000-0000-0000-000000000006','OWNER',false,'ACTIVE')
on conflict(user_id) do update
set app_role=excluded.app_role,
    is_active=excluded.is_active,
    team_status=excluded.team_status;

set role authenticated;
select set_config('request.jwt.claim.role','authenticated',false);

select set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000004',false);
select public.ecoflow_actionable_exception_expect_error(
  $$select * from analytics.get_actionable_exception_queue(100)$$,
  'ACTIONABLE_EXCEPTION_DESKTOP_ROLE_REQUIRED'
);

select set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000005',false);
select public.ecoflow_actionable_exception_expect_error(
  $$select * from analytics.get_actionable_exception_queue(100)$$,
  'ACTIONABLE_EXCEPTION_DESKTOP_ROLE_REQUIRED'
);

select set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000006',false);
select public.ecoflow_actionable_exception_expect_error(
  $$select * from analytics.get_actionable_exception_queue(100)$$,
  'ACTIONABLE_EXCEPTION_DESKTOP_ROLE_REQUIRED'
);

select set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000001',false);
select public.ecoflow_actionable_exception_expect_error(
  $$select * from analytics.get_actionable_exception_queue(0)$$,
  'ACTIONABLE_EXCEPTION_LIMIT_INVALID'
);
select public.ecoflow_actionable_exception_expect_error(
  $$select * from analytics.get_actionable_exception_queue(301)$$,
  'ACTIONABLE_EXCEPTION_LIMIT_INVALID'
);

select (count(*)>=0) as owner_read_succeeds
from analytics.get_actionable_exception_queue(1)
\gset
\if :owner_read_succeeds
\else
  \echo 'owner actionable exception read failed'
  \quit 1
\endif

select set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000002',false);
select (count(*)>=0) as account_read_succeeds
from analytics.get_actionable_exception_queue(1)
\gset
\if :account_read_succeeds
\else
  \echo 'account actionable exception read failed'
  \quit 1
\endif

select set_config('request.jwt.claim.sub','94000000-0000-0000-0000-000000000003',false);
select (count(*)>=0) as viewer_read_succeeds
from analytics.get_actionable_exception_queue(1)
\gset
\if :viewer_read_succeeds
\else
  \echo 'viewer actionable exception read failed'
  \quit 1
\endif

reset role;
rollback;
