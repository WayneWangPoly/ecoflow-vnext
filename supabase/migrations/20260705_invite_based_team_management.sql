-- Invite-based team management for EcoFlow
-- Purpose: replace shared role/password login with per-user Supabase Auth accounts,
-- OWNER/ADMIN controlled invitations, and auditable role assignment.

begin;

-- Required for case-insensitive email comparisons.
create extension if not exists citext with schema extensions;

-- Role enum is stored as text to keep compatibility with existing migrations.
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'app_user_profiles'
  ) then
    create table public.app_user_profiles (
      user_id uuid primary key references auth.users(id) on delete cascade,
      email extensions.citext not null unique,
      display_name text,
      app_role text not null default 'VIEWER',
      team_status text not null default 'ACTIVE',
      is_active boolean not null default true,
      invited_by uuid references auth.users(id),
      invited_at timestamptz,
      accepted_at timestamptz,
      last_seen_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint app_user_profiles_role_check check (app_role in ('OWNER','ADMIN','ACCOUNT','WAREHOUSE','DRIVER','VIEWER')),
      constraint app_user_profiles_team_status_check check (team_status in ('INVITED','ACTIVE','SUSPENDED','DISABLED'))
    );
  else
    alter table public.app_user_profiles add column if not exists email extensions.citext;
    alter table public.app_user_profiles add column if not exists display_name text;
    alter table public.app_user_profiles add column if not exists app_role text not null default 'VIEWER';
    alter table public.app_user_profiles add column if not exists team_status text not null default 'ACTIVE';
    alter table public.app_user_profiles add column if not exists is_active boolean not null default true;
    alter table public.app_user_profiles add column if not exists invited_by uuid references auth.users(id);
    alter table public.app_user_profiles add column if not exists invited_at timestamptz;
    alter table public.app_user_profiles add column if not exists accepted_at timestamptz;
    alter table public.app_user_profiles add column if not exists last_seen_at timestamptz;
    alter table public.app_user_profiles add column if not exists created_at timestamptz not null default now();
    alter table public.app_user_profiles add column if not exists updated_at timestamptz not null default now();

    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.app_user_profiles'::regclass
        and conname = 'app_user_profiles_role_check'
    ) then
      alter table public.app_user_profiles
      add constraint app_user_profiles_role_check
      check (app_role in ('OWNER','ADMIN','ACCOUNT','WAREHOUSE','DRIVER','VIEWER'));
    end if;

    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.app_user_profiles'::regclass
        and conname = 'app_user_profiles_team_status_check'
    ) then
      alter table public.app_user_profiles
      add constraint app_user_profiles_team_status_check
      check (team_status in ('INVITED','ACTIVE','SUSPENDED','DISABLED'));
    end if;
  end if;
end $$;

create table if not exists public.app_user_invitations (
  id uuid primary key default gen_random_uuid(),
  email extensions.citext not null,
  display_name text,
  app_role text not null default 'VIEWER',
  invitation_status text not null default 'SENT',
  auth_user_id uuid references auth.users(id) on delete set null,
  invited_by uuid references auth.users(id) on delete set null,
  invited_by_email extensions.citext,
  invite_sent_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_user_invitations_role_check check (app_role in ('OWNER','ADMIN','ACCOUNT','WAREHOUSE','DRIVER','VIEWER')),
  constraint app_user_invitations_status_check check (invitation_status in ('SENT','ACCEPTED','REVOKED','FAILED'))
);

create index if not exists app_user_invitations_email_idx on public.app_user_invitations (email);
create index if not exists app_user_invitations_status_idx on public.app_user_invitations (invitation_status);
create index if not exists app_user_profiles_role_idx on public.app_user_profiles (app_role);
create index if not exists app_user_profiles_active_idx on public.app_user_profiles (is_active, team_status);

-- Security audit table, compatible with prior patches if already present.
create table if not exists public.app_security_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email extensions.citext,
  actor_role text,
  action text not null,
  target_type text,
  target_id text,
  target_email extensions.citext,
  before_data jsonb,
  after_data jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists app_security_audit_events_actor_idx on public.app_security_audit_events(actor_user_id, created_at desc);
create index if not exists app_security_audit_events_action_idx on public.app_security_audit_events(action, created_at desc);
create index if not exists app_security_audit_events_target_email_idx on public.app_security_audit_events(target_email, created_at desc);

create or replace function public.ecoflow_touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists app_user_profiles_touch_updated_at on public.app_user_profiles;
create trigger app_user_profiles_touch_updated_at
before update on public.app_user_profiles
for each row execute function public.ecoflow_touch_updated_at();

drop trigger if exists app_user_invitations_touch_updated_at on public.app_user_invitations;
create trigger app_user_invitations_touch_updated_at
before update on public.app_user_invitations
for each row execute function public.ecoflow_touch_updated_at();

create or replace function public.ecoflow_current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p.app_role
    from public.app_user_profiles p
    where p.user_id = auth.uid()
      and p.is_active = true
      and p.team_status in ('ACTIVE','INVITED')
    limit 1
  ), 'ANON');
$$;

create or replace function public.ecoflow_has_any_role(roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.ecoflow_current_app_role() = any(roles);
$$;

create or replace function public.ecoflow_is_owner_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.ecoflow_has_any_role(array['OWNER','ADMIN']);
$$;

create or replace function public.ecoflow_assert_owner_or_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.ecoflow_is_owner_or_admin() then
    raise exception 'OWNER_OR_ADMIN_REQUIRED' using errcode = '42501';
  end if;
end;
$$;

-- Secure profile/current user views for front-end.
create or replace view public.v_ecoflow_current_user as
select
  p.user_id,
  p.email::text as email,
  p.display_name,
  p.app_role,
  p.team_status,
  p.is_active,
  p.invited_at,
  p.accepted_at,
  p.last_seen_at
from public.app_user_profiles p
where p.user_id = auth.uid();

create or replace view public.v_ecoflow_team_members_secure as
select
  p.user_id,
  p.email::text as email,
  p.display_name,
  p.app_role,
  p.team_status,
  p.is_active,
  p.invited_at,
  p.accepted_at,
  p.last_seen_at,
  p.created_at,
  p.updated_at,
  inviter.email::text as invited_by_email
from public.app_user_profiles p
left join public.app_user_profiles inviter on inviter.user_id = p.invited_by
where public.ecoflow_is_owner_or_admin();

create or replace view public.v_ecoflow_team_invitations_secure as
select
  i.id,
  i.email::text as email,
  i.display_name,
  i.app_role,
  i.invitation_status,
  i.auth_user_id,
  i.invited_by_email::text as invited_by_email,
  i.invite_sent_at,
  i.accepted_at,
  i.revoked_at,
  i.last_error,
  i.created_at,
  i.updated_at
from public.app_user_invitations i
where public.ecoflow_is_owner_or_admin();

create or replace view public.v_ecoflow_security_audit_secure as
select
  id,
  actor_email::text as actor_email,
  actor_role,
  action,
  target_type,
  target_id,
  target_email::text as target_email,
  before_data,
  after_data,
  ip_address::text as ip_address,
  user_agent,
  created_at
from public.app_security_audit_events
where public.ecoflow_is_owner_or_admin();

-- RPCs for front-end role management. Invitation email itself is sent by Edge Function
-- because auth.admin requires service_role, which must never run in the browser.
create or replace function public.ecoflow_update_team_member_role(
  target_user_id uuid,
  new_app_role text,
  new_team_status text default null,
  new_is_active boolean default null
)
returns table(user_id uuid, email text, app_role text, team_status text, is_active boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  actor record;
  before_row jsonb;
  after_row jsonb;
begin
  perform public.ecoflow_assert_owner_or_admin();

  if new_app_role not in ('OWNER','ADMIN','ACCOUNT','WAREHOUSE','DRIVER','VIEWER') then
    raise exception 'INVALID_ROLE' using errcode = '22023';
  end if;

  if new_team_status is not null and new_team_status not in ('INVITED','ACTIVE','SUSPENDED','DISABLED') then
    raise exception 'INVALID_TEAM_STATUS' using errcode = '22023';
  end if;

  select p.user_id, p.email, p.app_role into actor
  from public.app_user_profiles p
  where p.user_id = auth.uid();

  select to_jsonb(p.*) into before_row
  from public.app_user_profiles p
  where p.user_id = target_user_id;

  update public.app_user_profiles p
  set
    app_role = new_app_role,
    team_status = coalesce(new_team_status, p.team_status),
    is_active = coalesce(new_is_active, p.is_active)
  where p.user_id = target_user_id;

  if not found then
    raise exception 'TEAM_MEMBER_NOT_FOUND' using errcode = 'P0002';
  end if;

  select to_jsonb(p.*) into after_row
  from public.app_user_profiles p
  where p.user_id = target_user_id;

  insert into public.app_security_audit_events(
    actor_user_id, actor_email, actor_role, action, target_type, target_id, target_email, before_data, after_data
  )
  select
    auth.uid(), actor.email, actor.app_role, 'TEAM_MEMBER_ROLE_UPDATED', 'app_user_profiles', target_user_id::text,
    (after_row->>'email')::extensions.citext, before_row, after_row;

  return query
  select p.user_id, p.email::text, p.app_role, p.team_status, p.is_active
  from public.app_user_profiles p
  where p.user_id = target_user_id;
end;
$$;

create or replace function public.ecoflow_record_login_seen()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.app_user_profiles
  set last_seen_at = now(),
      team_status = case when team_status = 'INVITED' then 'ACTIVE' else team_status end,
      accepted_at = coalesce(accepted_at, now())
  where user_id = auth.uid();
end;
$$;

-- RLS
alter table public.app_user_profiles enable row level security;
alter table public.app_user_invitations enable row level security;
alter table public.app_security_audit_events enable row level security;

-- Profiles: users can read themselves; OWNER/ADMIN can read/manage all via policies and functions.
drop policy if exists app_profiles_self_select on public.app_user_profiles;
create policy app_profiles_self_select
on public.app_user_profiles
for select
to authenticated
using (user_id = auth.uid() or public.ecoflow_is_owner_or_admin());

drop policy if exists app_profiles_owner_admin_update on public.app_user_profiles;
create policy app_profiles_owner_admin_update
on public.app_user_profiles
for update
to authenticated
using (public.ecoflow_is_owner_or_admin())
with check (public.ecoflow_is_owner_or_admin());

-- Invitation and audit rows are visible only to OWNER/ADMIN in the client.
drop policy if exists app_invitations_owner_admin_select on public.app_user_invitations;
create policy app_invitations_owner_admin_select
on public.app_user_invitations
for select
to authenticated
using (public.ecoflow_is_owner_or_admin());

drop policy if exists app_audit_owner_admin_select on public.app_security_audit_events;
create policy app_audit_owner_admin_select
on public.app_security_audit_events
for select
to authenticated
using (public.ecoflow_is_owner_or_admin());

-- Service role bypasses RLS; Edge Function writes invitations and profiles using service role.
revoke all on table public.app_user_profiles from anon;
revoke all on table public.app_user_invitations from anon;
revoke all on table public.app_security_audit_events from anon;

grant select on public.v_ecoflow_current_user to authenticated;
grant select on public.v_ecoflow_team_members_secure to authenticated;
grant select on public.v_ecoflow_team_invitations_secure to authenticated;
grant select on public.v_ecoflow_security_audit_secure to authenticated;
grant execute on function public.ecoflow_update_team_member_role(uuid, text, text, boolean) to authenticated;
grant execute on function public.ecoflow_record_login_seen() to authenticated;

commit;
