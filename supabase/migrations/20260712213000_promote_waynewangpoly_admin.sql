-- Promote the user's EcoFlow login to the operational ADMIN role.
-- The update is intentionally exact and fails closed if the expected profile is missing.

begin;

do $$
declare
  affected integer;
begin
  update public.app_user_profiles
  set
    app_role = 'ADMIN',
    is_active = true,
    team_status = 'ACTIVE'
  where lower(email) = 'waynewangpoly@gmail.com';

  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'Expected exactly one EcoFlow profile for waynewangpoly@gmail.com, updated %', affected;
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
