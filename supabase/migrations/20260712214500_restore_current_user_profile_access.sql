-- Restore the signed-in user's profile read path after a role change.
-- The current-user view is deliberately narrow and always scoped to auth.uid().

begin;

create or replace view public.v_ecoflow_current_user
as
select
  p.user_id,
  p.email,
  p.display_name,
  p.app_role,
  p.team_status,
  p.is_active,
  p.invited_at,
  p.accepted_at,
  p.last_seen_at
from public.app_user_profiles p
where p.user_id = auth.uid();

grant select on public.v_ecoflow_current_user to authenticated;
revoke all on public.v_ecoflow_current_user from anon;

notify pgrst, 'reload schema';
commit;
