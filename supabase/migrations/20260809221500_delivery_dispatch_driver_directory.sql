-- TRANSFORM-006: minimal dispatch-facing Driver directory.
-- Delivery planning needs only active Driver identities, not the wider team
-- administration surface. Keep that read behind an office-role RPC.

begin;

create or replace function public.ecoflow_list_active_dispatch_drivers()
returns table(
  user_id uuid,
  driver_label text
)
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
#variable_conflict error
begin
  if auth.uid() is null or public.ecoflow_active_app_role() not in ('OWNER','ADMIN','ACCOUNT') then
    raise exception using errcode='42501',message='OFFICE_ROUTE_APPROVAL_REQUIRED';
  end if;
  if to_regclass('public.v_ecoflow_team_members_secure') is null then
    raise exception 'DRIVER_DIRECTORY_UNAVAILABLE';
  end if;

  return query execute $q$
    select user_id,
      coalesce(nullif(btrim(display_name),''),nullif(btrim(email),''),user_id::text) as driver_label
    from public.v_ecoflow_team_members_secure
    where upper(coalesce(app_role,''))='DRIVER'
      and upper(coalesce(team_status,''))='ACTIVE'
      and coalesce(is_active,true)
    order by coalesce(nullif(btrim(display_name),''),nullif(btrim(email),''),user_id::text)
  $q$;
end;
$$;

revoke all on function public.ecoflow_list_active_dispatch_drivers() from public,anon,authenticated;
grant execute on function public.ecoflow_list_active_dispatch_drivers() to authenticated;

comment on function public.ecoflow_list_active_dispatch_drivers() is
  'Office-only minimal Driver directory for delivery assignment. Exposes only active Driver user IDs and display labels.';

notify pgrst,'reload schema';
commit;
