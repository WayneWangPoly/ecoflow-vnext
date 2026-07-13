-- Restore the signed-in user's profile read path after a role change.
-- The current-user view is deliberately narrow and always scoped to auth.uid().
-- Explicit casts preserve the existing public view contract even when profile
-- storage uses citext or enums internally.

begin;

create or replace view public.v_ecoflow_current_user
as
select
  p.user_id::uuid as user_id,
  p.email::text as email,
  p.display_name::text as display_name,
  p.app_role::text as app_role,
  p.team_status::text as team_status,
  p.is_active::boolean as is_active,
  p.invited_at::timestamptz as invited_at,
  p.accepted_at::timestamptz as accepted_at,
  p.last_seen_at::timestamptz as last_seen_at
from public.app_user_profiles p
where p.user_id = auth.uid();

grant select on public.v_ecoflow_current_user to authenticated;
revoke all on public.v_ecoflow_current_user from anon;

notify pgrst, 'reload schema';
commit;
