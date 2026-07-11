-- PostgreSQL PL/pgSQL output columns become variables. Use the named primary-key
-- constraint so the store_key return column cannot make ON CONFLICT ambiguous.

begin;

create or replace function public.ecoflow_upsert_store_delivery_notification_contact(
  p_store_key text,
  p_store_name text,
  p_retailer_id text default null,
  p_email text default null,
  p_contact_name text default null,
  p_enabled boolean default true
)
returns table (store_key text, contact_email text, enabled boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := upper(trim(coalesce(p_store_key, '')));
  v_name text := nullif(trim(coalesce(p_store_name, '')), '');
  v_retailer text := nullif(trim(coalesce(p_retailer_id, '')), '');
  v_email text := lower(nullif(trim(coalesce(p_email, '')), ''));
  v_site_exists boolean;
begin
  if not public.ecoflow_is_active_owner_admin() then raise exception 'OWNER_OR_ADMIN_REQUIRED'; end if;
  if v_key = '' then raise exception 'STORE_KEY_REQUIRED'; end if;
  if v_name is null then raise exception 'STORE_NAME_REQUIRED'; end if;
  if v_email is not null and v_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    raise exception 'VALID_EMAIL_REQUIRED';
  end if;

  select exists(
    select 1 from public.ecoflow_store_sites s
    where (v_retailer is not null and s.retailer_id = v_retailer)
       or upper(coalesce(s.store_name, '')) = v_key
  ) into v_site_exists;
  if not v_site_exists then raise exception 'STORE_SITE_NOT_FOUND'; end if;

  insert into public.ecoflow_delivery_notification_contacts(
    store_key, retailer_id, store_name, contact_email, contact_name, enabled, updated_at, updated_by
  ) values (
    v_key, v_retailer, v_name, v_email,
    nullif(trim(coalesce(p_contact_name, '')), ''), coalesce(p_enabled, true), now(), auth.uid()
  )
  on conflict on constraint ecoflow_delivery_notification_contacts_pkey do update set
    retailer_id = excluded.retailer_id,
    store_name = excluded.store_name,
    contact_email = excluded.contact_email,
    contact_name = excluded.contact_name,
    enabled = excluded.enabled,
    updated_at = now(),
    updated_by = auth.uid();

  return query select v_key, v_email, coalesce(p_enabled, true);
end;
$$;

notify pgrst, 'reload schema';
commit;
