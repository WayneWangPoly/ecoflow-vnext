-- Use the named primary-key constraint for layout upserts. The RETURNS TABLE
-- output variable site_code otherwise conflicts with ON CONFLICT (site_code).

begin;

create or replace function public.ecoflow_save_warehouse_layout(
  p_site_code text,
  p_layout_json jsonb,
  p_expected_version integer default null
)
returns table (
  site_code text,
  layout_json jsonb,
  layout_version integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site text := upper(coalesce(nullif(trim(coalesce(p_site_code,'')),''),'SITE-01'));
  v_current integer;
begin
  if not public.ecoflow_can_edit_warehouse_layout() then
    raise exception 'OWNER_OR_ADMIN_REQUIRED';
  end if;
  if p_layout_json is null or jsonb_typeof(p_layout_json) <> 'object' then
    raise exception 'layout must be a JSON object';
  end if;

  select l.layout_version into v_current
  from public.ecoflow_warehouse_layouts l
  where l.site_code = v_site
  for update;

  if found and p_expected_version is not null and p_expected_version <> v_current then
    raise exception 'LAYOUT_VERSION_CONFLICT: expected %, current %',p_expected_version,v_current;
  end if;

  insert into public.ecoflow_warehouse_layouts(
    site_code,layout_json,layout_version,updated_by,updated_at
  ) values (
    v_site,p_layout_json,1,auth.uid(),now()
  )
  on conflict on constraint ecoflow_warehouse_layouts_pkey do update set
    layout_json = excluded.layout_json,
    layout_version = public.ecoflow_warehouse_layouts.layout_version + 1,
    updated_by = auth.uid(),
    updated_at = now();

  return query
  select l.site_code,l.layout_json,l.layout_version,l.updated_at
  from public.ecoflow_warehouse_layouts l
  where l.site_code = v_site;
end;
$$;

notify pgrst, 'reload schema';

commit;
