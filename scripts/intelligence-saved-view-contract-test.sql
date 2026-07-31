\set ON_ERROR_STOP on

begin;
set timezone='UTC';

create or replace function public.ecoflow_saved_view_expect_error(p_sql text,p_marker text)
returns void
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
begin
  execute p_sql;
  raise exception 'EXPECTED_SAVED_VIEW_ERROR_NOT_RAISED: %',p_sql;
exception when others then
  if sqlerrm like 'EXPECTED_SAVED_VIEW_ERROR_NOT_RAISED:%' then raise; end if;
  if position(p_marker in sqlerrm)=0 then
    raise exception 'EXPECTED_SAVED_VIEW_ERROR_MARKER_MISSING: expected %, got %',p_marker,sqlerrm;
  end if;
end;
$$;

do $structure$
declare
  v_read_def text;
  v_write_def text;
begin
  if to_regclass('analytics.intelligence_saved_view') is null
     or to_regprocedure('analytics.get_intelligence_saved_views(text)') is null
     or to_regprocedure('analytics.apply_intelligence_saved_view_command(text,uuid,text,text,jsonb,text)') is null then
    raise exception 'Saved View objects missing';
  end if;
  select pg_get_functiondef('analytics.get_intelligence_saved_views(text)'::regprocedure) into v_read_def;
  select pg_get_functiondef('analytics.apply_intelligence_saved_view_command(text,uuid,text,text,jsonb,text)'::regprocedure) into v_write_def;
  if position('owner_user_id=v_user' in v_read_def)=0
     or position('role_scope=v_role' in v_read_def)=0
     or position('ROLE_DEFAULT_ADMIN_REQUIRED' in v_write_def)=0
     or position('DUPLICATE' in v_write_def)=0
     or position('RENAME' in v_write_def)=0
     or position('DELETE' in v_write_def)=0 then
    raise exception 'Saved View privacy/default/command boundary incomplete';
  end if;
  if has_table_privilege('authenticated','analytics.intelligence_saved_view','SELECT')
     or has_table_privilege('authenticated','analytics.intelligence_saved_view','INSERT')
     or has_table_privilege('authenticated','analytics.intelligence_saved_view','UPDATE')
     or has_table_privilege('authenticated','analytics.intelligence_saved_view','DELETE') then
    raise exception 'Authenticated role must not access Saved View table directly';
  end if;
  if not has_function_privilege('authenticated','analytics.get_intelligence_saved_views(text)','EXECUTE')
     or not has_function_privilege('authenticated','analytics.apply_intelligence_saved_view_command(text,uuid,text,text,jsonb,text)','EXECUTE')
     or has_function_privilege('anon','analytics.get_intelligence_saved_views(text)','EXECUTE') then
    raise exception 'Saved View RPC ACL incorrect';
  end if;
end;
$structure$;

insert into auth.users(id,email)
values
 ('99000000-0000-0000-0000-000000000001','saved-owner@example.test'),
 ('99000000-0000-0000-0000-000000000002','saved-viewer@example.test'),
 ('99000000-0000-0000-0000-000000000003','saved-account@example.test'),
 ('99000000-0000-0000-0000-000000000004','saved-warehouse@example.test')
on conflict(id) do update set email=excluded.email;

insert into public.app_user_profiles(user_id,app_role,is_active,team_status)
values
 ('99000000-0000-0000-0000-000000000001','OWNER',true,'ACTIVE'),
 ('99000000-0000-0000-0000-000000000002','VIEWER',true,'ACTIVE'),
 ('99000000-0000-0000-0000-000000000003','ACCOUNT',true,'ACTIVE'),
 ('99000000-0000-0000-0000-000000000004','WAREHOUSE',true,'ACTIVE')
on conflict(user_id) do update
set app_role=excluded.app_role,is_active=excluded.is_active,team_status=excluded.team_status;

set role authenticated;
select set_config('request.jwt.claim.role','authenticated',false);
select set_config('request.jwt.claim.sub','99000000-0000-0000-0000-000000000001',false);

select * from analytics.apply_intelligence_saved_view_command(
  'CREATE',null,'orders','My order review',
  '{"filters":["status:ready"],"sort":"created:desc","visibleColumns":["order","status"],"dateRange":{"from":"2026-07-01","to":"2026-07-31"},"comparisonSettings":["previous-period"],"searchTerm":"ADE"}'::jsonb,
  null
) \gset owner_private_

select * from analytics.apply_intelligence_saved_view_command(
  'SET_ROLE_DEFAULT',null,'analytics','Viewer daily default',
  '{"filters":[],"sort":null,"visibleColumns":["metric","state"],"dateRange":null,"comparisonSettings":[],"searchTerm":null}'::jsonb,
  'VIEWER'
) \gset viewer_default_

select (
  count(*) filter(where scope='PRIVATE')=1
  and count(*) filter(where scope='ROLE_DEFAULT')=0
  and bool_and(can_manage_role_defaults)
) as owner_private_only_ok
from analytics.get_intelligence_saved_views(null)
\gset
\if :owner_private_only_ok
\else
  \echo 'Owner Saved View visibility incorrect'
  \quit 1
\endif

select * from analytics.apply_intelligence_saved_view_command(
  'DUPLICATE',:'owner_private_saved_view_id'::uuid,null,'My order review copy',null,null
) \gset owner_copy_
select * from analytics.apply_intelligence_saved_view_command(
  'RENAME',:'owner_copy_saved_view_id'::uuid,null,'Renamed copy',null,null
) \gset owner_rename_

select set_config('request.jwt.claim.sub','99000000-0000-0000-0000-000000000002',false);
select (
  count(*)=1
  and min(scope)='ROLE_DEFAULT'
  and min(role_scope)='VIEWER'
  and not bool_or(can_manage_role_defaults)
) as viewer_default_ok
from analytics.get_intelligence_saved_views('analytics')
\gset
\if :viewer_default_ok
\else
  \echo 'Viewer role default not visible'
  \quit 1
\endif

select * from analytics.apply_intelligence_saved_view_command(
  'CREATE',null,'analytics','Viewer private',
  '{"filters":[],"sort":null,"visibleColumns":["metric"],"dateRange":null,"comparisonSettings":[],"searchTerm":null}'::jsonb,
  null
) \gset viewer_private_

select public.ecoflow_saved_view_expect_error(
  $$select * from analytics.apply_intelligence_saved_view_command(
    'SET_ROLE_DEFAULT',null,'orders','Illegal default',
    '{"filters":[],"sort":null,"visibleColumns":[],"dateRange":null,"comparisonSettings":[],"searchTerm":null}'::jsonb,
    'VIEWER')$$,
  'ROLE_DEFAULT_ADMIN_REQUIRED'
);
select public.ecoflow_saved_view_expect_error(
  format($sql$select * from analytics.apply_intelligence_saved_view_command(
    'RENAME',%L::uuid,null,'Stolen rename',null,null)$sql$,:'owner_private_saved_view_id'),
  'PRIVATE_OWNER_REQUIRED'
);

select set_config('request.jwt.claim.sub','99000000-0000-0000-0000-000000000003',false);
select (count(*)=0) as account_cannot_see_viewer_or_owner_private
from analytics.get_intelligence_saved_views(null)
\gset
\if :account_cannot_see_viewer_or_owner_private
\else
  \echo 'Private Saved Views leaked across users'
  \quit 1
\endif

select set_config('request.jwt.claim.sub','99000000-0000-0000-0000-000000000004',false);
select public.ecoflow_saved_view_expect_error(
  $$select * from analytics.get_intelligence_saved_views(null)$$,
  'DESKTOP_ROLE_REQUIRED'
);

select set_config('request.jwt.claim.sub','99000000-0000-0000-0000-000000000001',false);
select * from analytics.apply_intelligence_saved_view_command(
  'DELETE',:'owner_rename_saved_view_id'::uuid,null,null,null,null
) \gset owner_delete_
select * from analytics.apply_intelligence_saved_view_command(
  'CLEAR_ROLE_DEFAULT',null,'analytics',null,null,'VIEWER'
) \gset clear_default_

reset role;
rollback;
