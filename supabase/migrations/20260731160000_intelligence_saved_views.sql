-- INTEL-PER-001: durable private Saved Views and role defaults.
-- Browser roles receive RPC-only access. Saved state is bounded to governed query,
-- column, date and comparison fields and never stores operational commands.

begin;

do $preflight$
begin
  if to_regclass('public.app_user_profiles') is null
     or to_regclass('auth.users') is null
     or to_regprocedure('gen_random_uuid()') is null then
    raise exception 'INTELLIGENCE_SAVED_VIEW_PREREQUISITES_MISSING';
  end if;
end;
$preflight$;

create or replace function analytics.intelligence_saved_view_state_valid(p_state jsonb)
returns boolean
language sql
immutable
security invoker
set search_path=pg_catalog
as $$
  select
    jsonb_typeof(p_state)='object'
    and (p_state - array[
      'filters','sort','visibleColumns','dateRange','comparisonSettings','searchTerm'
    ]::text[])='{}'::jsonb
    and jsonb_typeof(coalesce(p_state->'filters','[]'::jsonb))='array'
    and jsonb_array_length(coalesce(p_state->'filters','[]'::jsonb))<=20
    and jsonb_typeof(coalesce(p_state->'visibleColumns','[]'::jsonb))='array'
    and jsonb_array_length(coalesce(p_state->'visibleColumns','[]'::jsonb))<=50
    and jsonb_typeof(coalesce(p_state->'comparisonSettings','[]'::jsonb))='array'
    and jsonb_array_length(coalesce(p_state->'comparisonSettings','[]'::jsonb))<=20
    and (p_state->'sort' is null or jsonb_typeof(p_state->'sort') in ('string','null'))
    and (p_state->'searchTerm' is null or jsonb_typeof(p_state->'searchTerm') in ('string','null'))
    and (p_state->'dateRange' is null or jsonb_typeof(p_state->'dateRange') in ('object','null'))
$$;

revoke all on function analytics.intelligence_saved_view_state_valid(jsonb)
  from public,anon,authenticated,service_role;

create table analytics.intelligence_saved_view (
  saved_view_id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  workspace text not null,
  name text not null,
  view_state jsonb not null,
  role_scope text,
  is_role_default boolean not null default false,
  version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint intelligence_saved_view_workspace
    check (workspace in ('control-room','orders','inventory','customers','delivery','returns','analytics')),
  constraint intelligence_saved_view_name
    check (btrim(name)<>'' and length(name)<=80),
  constraint intelligence_saved_view_state
    check (analytics.intelligence_saved_view_state_valid(view_state)),
  constraint intelligence_saved_view_role
    check (role_scope is null or role_scope in ('OWNER','ADMIN','ACCOUNT','VIEWER')),
  constraint intelligence_saved_view_scope
    check ((role_scope is null and not is_role_default) or (role_scope is not null and is_role_default)),
  constraint intelligence_saved_view_version check (version>=1),
  constraint intelligence_saved_view_time check (updated_at>=created_at)
);

create unique index intelligence_saved_view_private_name_uq
  on analytics.intelligence_saved_view(owner_user_id,workspace,lower(name))
  where role_scope is null;
create unique index intelligence_saved_view_role_default_uq
  on analytics.intelligence_saved_view(workspace,role_scope)
  where is_role_default;
create index intelligence_saved_view_owner_idx
  on analytics.intelligence_saved_view(owner_user_id,workspace,updated_at desc);

alter table analytics.intelligence_saved_view enable row level security;
revoke all on analytics.intelligence_saved_view from public,anon,authenticated;

create or replace function analytics.get_intelligence_saved_views(p_workspace text default null)
returns table(
  saved_view_id uuid,
  workspace text,
  name text,
  view_state jsonb,
  scope text,
  role_scope text,
  is_role_default boolean,
  version bigint,
  can_manage_role_defaults boolean,
  updated_at timestamptz,
  read_at timestamptz
)
language plpgsql
stable
security definer
set search_path=pg_catalog,analytics,public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_workspace text := nullif(lower(btrim(coalesce(p_workspace,''))), '');
  v_read_at timestamptz := statement_timestamp();
begin
  select p.app_role into v_role
  from public.app_user_profiles p
  where p.user_id=v_user
    and p.is_active=true
    and p.team_status='ACTIVE'
    and p.app_role in ('OWNER','ADMIN','ACCOUNT','VIEWER');

  if v_role is null then
    raise exception using errcode='42501',message='INTELLIGENCE_SAVED_VIEW_DESKTOP_ROLE_REQUIRED';
  end if;
  if v_workspace is not null and v_workspace not in (
    'control-room','orders','inventory','customers','delivery','returns','analytics'
  ) then
    raise exception using errcode='22023',message='INTELLIGENCE_SAVED_VIEW_WORKSPACE_INVALID';
  end if;

  return query
  select
    v.saved_view_id,
    v.workspace,
    v.name,
    v.view_state,
    case when v.role_scope is null then 'PRIVATE' else 'ROLE_DEFAULT' end::text,
    v.role_scope,
    v.is_role_default,
    v.version,
    (v_role in ('OWNER','ADMIN'))::boolean,
    v.updated_at,
    v_read_at
  from analytics.intelligence_saved_view v
  where (v_workspace is null or v.workspace=v_workspace)
    and (
      (v.role_scope is null and v.owner_user_id=v_user)
      or (v.is_role_default and v.role_scope=v_role)
    )
  order by v.is_role_default desc,v.workspace,lower(v.name),v.saved_view_id;
end;
$$;

create or replace function analytics.apply_intelligence_saved_view_command(
  p_action text,
  p_saved_view_id uuid default null,
  p_workspace text default null,
  p_name text default null,
  p_view_state jsonb default null,
  p_role_scope text default null
)
returns table(
  saved_view_id uuid,
  command_status text,
  version bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path=pg_catalog,analytics,public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_action text := upper(btrim(coalesce(p_action,'')));
  v_workspace text := nullif(lower(btrim(coalesce(p_workspace,''))), '');
  v_name text := nullif(btrim(coalesce(p_name,'')), '');
  v_role_scope text := nullif(upper(btrim(coalesce(p_role_scope,''))), '');
  v_record analytics.intelligence_saved_view%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select p.app_role into v_role
  from public.app_user_profiles p
  where p.user_id=v_user
    and p.is_active=true
    and p.team_status='ACTIVE'
    and p.app_role in ('OWNER','ADMIN','ACCOUNT','VIEWER');

  if v_role is null then
    raise exception using errcode='42501',message='INTELLIGENCE_SAVED_VIEW_DESKTOP_ROLE_REQUIRED';
  end if;
  if v_action not in ('CREATE','DUPLICATE','RENAME','DELETE','SET_ROLE_DEFAULT','CLEAR_ROLE_DEFAULT') then
    raise exception using errcode='22023',message='INTELLIGENCE_SAVED_VIEW_ACTION_INVALID';
  end if;

  if v_action='CREATE' then
    if v_workspace not in ('control-room','orders','inventory','customers','delivery','returns','analytics')
       or v_name is null or length(v_name)>80
       or not analytics.intelligence_saved_view_state_valid(p_view_state) then
      raise exception using errcode='22023',message='INTELLIGENCE_SAVED_VIEW_CREATE_INVALID';
    end if;
    if (select count(*) from analytics.intelligence_saved_view v
        where v.owner_user_id=v_user and v.workspace=v_workspace and v.role_scope is null)>=50 then
      raise exception using errcode='22023',message='INTELLIGENCE_SAVED_VIEW_PRIVATE_LIMIT';
    end if;
    insert into analytics.intelligence_saved_view(owner_user_id,workspace,name,view_state)
    values(v_user,v_workspace,v_name,p_view_state)
    returning * into v_record;

  elsif v_action='DUPLICATE' then
    if p_saved_view_id is null or v_name is null or length(v_name)>80 then
      raise exception using errcode='22023',message='INTELLIGENCE_SAVED_VIEW_DUPLICATE_INVALID';
    end if;
    select * into v_record
    from analytics.intelligence_saved_view v
    where v.saved_view_id=p_saved_view_id
      and ((v.role_scope is null and v.owner_user_id=v_user) or (v.is_role_default and v.role_scope=v_role));
    if not found then
      raise exception using errcode='42501',message='INTELLIGENCE_SAVED_VIEW_SOURCE_FORBIDDEN';
    end if;
    insert into analytics.intelligence_saved_view(owner_user_id,workspace,name,view_state)
    values(v_user,v_record.workspace,v_name,v_record.view_state)
    returning * into v_record;

  elsif v_action='RENAME' then
    if p_saved_view_id is null or v_name is null or length(v_name)>80 then
      raise exception using errcode='22023',message='INTELLIGENCE_SAVED_VIEW_RENAME_INVALID';
    end if;
    update analytics.intelligence_saved_view v
    set name=v_name,version=v.version+1,updated_at=v_now
    where v.saved_view_id=p_saved_view_id and v.owner_user_id=v_user and v.role_scope is null
    returning * into v_record;
    if not found then
      raise exception using errcode='42501',message='INTELLIGENCE_SAVED_VIEW_PRIVATE_OWNER_REQUIRED';
    end if;

  elsif v_action='DELETE' then
    if p_saved_view_id is null then
      raise exception using errcode='22023',message='INTELLIGENCE_SAVED_VIEW_DELETE_INVALID';
    end if;
    delete from analytics.intelligence_saved_view v
    where v.saved_view_id=p_saved_view_id and v.owner_user_id=v_user and v.role_scope is null
    returning * into v_record;
    if not found then
      raise exception using errcode='42501',message='INTELLIGENCE_SAVED_VIEW_PRIVATE_OWNER_REQUIRED';
    end if;

  elsif v_action='SET_ROLE_DEFAULT' then
    if v_role not in ('OWNER','ADMIN') then
      raise exception using errcode='42501',message='INTELLIGENCE_SAVED_VIEW_ROLE_DEFAULT_ADMIN_REQUIRED';
    end if;
    if v_workspace not in ('control-room','orders','inventory','customers','delivery','returns','analytics')
       or v_role_scope not in ('OWNER','ADMIN','ACCOUNT','VIEWER')
       or v_name is null or length(v_name)>80
       or not analytics.intelligence_saved_view_state_valid(p_view_state) then
      raise exception using errcode='22023',message='INTELLIGENCE_SAVED_VIEW_ROLE_DEFAULT_INVALID';
    end if;
    insert into analytics.intelligence_saved_view(
      owner_user_id,workspace,name,view_state,role_scope,is_role_default
    ) values(v_user,v_workspace,v_name,p_view_state,v_role_scope,true)
    on conflict (workspace,role_scope) where is_role_default
    do update set
      owner_user_id=excluded.owner_user_id,
      name=excluded.name,
      view_state=excluded.view_state,
      version=analytics.intelligence_saved_view.version+1,
      updated_at=v_now
    returning * into v_record;

  else
    if v_role not in ('OWNER','ADMIN') then
      raise exception using errcode='42501',message='INTELLIGENCE_SAVED_VIEW_ROLE_DEFAULT_ADMIN_REQUIRED';
    end if;
    if v_workspace not in ('control-room','orders','inventory','customers','delivery','returns','analytics')
       or v_role_scope not in ('OWNER','ADMIN','ACCOUNT','VIEWER') then
      raise exception using errcode='22023',message='INTELLIGENCE_SAVED_VIEW_ROLE_DEFAULT_INVALID';
    end if;
    delete from analytics.intelligence_saved_view v
    where v.workspace=v_workspace and v.role_scope=v_role_scope and v.is_role_default
    returning * into v_record;
    if not found then
      raise exception using errcode='22023',message='INTELLIGENCE_SAVED_VIEW_ROLE_DEFAULT_MISSING';
    end if;
  end if;

  return query select
    v_record.saved_view_id,
    'APPLIED'::text,
    case when v_action in ('DELETE','CLEAR_ROLE_DEFAULT') then null::bigint else v_record.version end,
    v_now;
end;
$$;

revoke all on function analytics.get_intelligence_saved_views(text)
  from public,anon,authenticated,service_role;
revoke all on function analytics.apply_intelligence_saved_view_command(text,uuid,text,text,jsonb,text)
  from public,anon,authenticated,service_role;
grant execute on function analytics.get_intelligence_saved_views(text) to authenticated;
grant execute on function analytics.apply_intelligence_saved_view_command(text,uuid,text,text,jsonb,text) to authenticated;

comment on table analytics.intelligence_saved_view is
  'Durable private Saved Views and one role default per workspace. RPC-only browser access.';
comment on function analytics.get_intelligence_saved_views(text) is
  'Returns the current user private views and the active role default only.';
comment on function analytics.apply_intelligence_saved_view_command(text,uuid,text,text,jsonb,text) is
  'Applies bounded create, duplicate, rename, delete and Owner/Admin role-default commands.';

notify pgrst,'reload schema';
commit;
