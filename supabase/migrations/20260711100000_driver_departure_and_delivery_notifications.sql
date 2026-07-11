-- Driver pre-departure declaration, route-location consent and customer delivery notification controls.
-- The declaration records operational checks. It does not displace statutory WHS,
-- employment, insurance or workers-compensation duties and rights.

begin;

alter table if exists public.ecoflow_store_sites
  add column if not exists contact_email text,
  add column if not exists delivery_notification_enabled boolean not null default true,
  add column if not exists notification_contact_name text,
  add column if not exists notification_updated_at timestamptz,
  add column if not exists notification_updated_by uuid;

create table if not exists public.ecoflow_driver_departure_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  business_day date not null,
  route_id text not null,
  driver_user_id uuid not null default auth.uid(),
  driver_email text,
  driver_label text,
  typed_name text not null,
  policy_version text not null,
  checks jsonb not null default '{}'::jsonb,
  location_consent boolean not null,
  declaration_text text not null,
  accepted_at timestamptz not null default now(),
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  constraint uq_driver_departure_policy unique (business_day, route_id, driver_user_id, policy_version)
);

create index if not exists idx_driver_departure_day_route
  on public.ecoflow_driver_departure_acknowledgements(business_day, route_id, accepted_at desc);

create table if not exists public.ecoflow_delivery_notification_log (
  id uuid primary key default gen_random_uuid(),
  business_day date not null,
  route_id text not null,
  retailer_id text,
  store_key text not null,
  store_name text not null,
  recipient_email text,
  order_ids text[] not null default '{}',
  order_numbers text[] not null default '{}',
  notification_type text not null default 'ROUTE_STARTED_TODAY',
  status text not null check (status in ('PENDING','SENT','FAILED','MISSING_CONTACT','CONFIGURATION_REQUIRED','SKIPPED_DISABLED')),
  provider_message_id text,
  provider_error text,
  requested_by uuid,
  requested_at timestamptz not null default now(),
  sent_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  constraint uq_delivery_notification_route_store unique (business_day, route_id, store_key, notification_type)
);

create index if not exists idx_delivery_notification_day_route
  on public.ecoflow_delivery_notification_log(business_day, route_id, requested_at desc);

create or replace function public.ecoflow_is_active_owner_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_user_profiles p
    where p.user_id = auth.uid()
      and p.is_active = true
      and p.team_status = 'ACTIVE'
      and p.app_role in ('OWNER','ADMIN')
  );
$$;

grant execute on function public.ecoflow_is_active_owner_admin() to authenticated;

alter table public.ecoflow_driver_departure_acknowledgements enable row level security;
alter table public.ecoflow_delivery_notification_log enable row level security;

revoke all on public.ecoflow_driver_departure_acknowledgements from anon;
revoke insert, update, delete on public.ecoflow_driver_departure_acknowledgements from authenticated;
grant select on public.ecoflow_driver_departure_acknowledgements to authenticated;

revoke all on public.ecoflow_delivery_notification_log from anon;
revoke insert, update, delete on public.ecoflow_delivery_notification_log from authenticated;
grant select on public.ecoflow_delivery_notification_log to authenticated;

drop policy if exists ecoflow_departure_driver_or_owner_read on public.ecoflow_driver_departure_acknowledgements;
create policy ecoflow_departure_driver_or_owner_read
on public.ecoflow_driver_departure_acknowledgements
for select
using (driver_user_id = auth.uid() or public.ecoflow_is_active_owner_admin());

drop policy if exists ecoflow_delivery_notification_owner_read on public.ecoflow_delivery_notification_log;
create policy ecoflow_delivery_notification_owner_read
on public.ecoflow_delivery_notification_log
for select
using (public.ecoflow_is_active_owner_admin());

create or replace function public.ecoflow_record_driver_departure_acknowledgement(
  p_business_day date,
  p_route_id text,
  p_policy_version text,
  p_typed_name text,
  p_checks jsonb,
  p_location_consent boolean,
  p_declaration_text text,
  p_driver_label text default null,
  p_user_agent text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  acknowledgement_id uuid,
  accepted_at timestamptz,
  policy_version text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.app_user_profiles%rowtype;
  v_id uuid;
  v_accepted timestamptz;
  v_required_key text;
  v_route text := nullif(trim(coalesce(p_route_id, '')), '');
  v_policy text := nullif(trim(coalesce(p_policy_version, '')), '');
  v_name text := nullif(trim(coalesce(p_typed_name, '')), '');
begin
  if auth.uid() is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;

  select p.* into v_profile
  from public.app_user_profiles p
  where p.user_id = auth.uid()
    and p.is_active = true
    and p.team_status = 'ACTIVE'
    and p.app_role in ('DRIVER','OWNER','ADMIN');

  if not found then raise exception 'ACTIVE_DRIVER_ROLE_REQUIRED'; end if;
  if p_business_day is null then raise exception 'BUSINESS_DAY_REQUIRED'; end if;
  if v_route is null then raise exception 'ROUTE_ID_REQUIRED'; end if;
  if v_policy is null then raise exception 'POLICY_VERSION_REQUIRED'; end if;
  if v_name is null or length(v_name) < 2 then raise exception 'TYPED_NAME_REQUIRED'; end if;
  if p_location_consent is not true then raise exception 'ROUTE_LOCATION_CONSENT_REQUIRED'; end if;
  if nullif(trim(coalesce(p_declaration_text, '')), '') is null then raise exception 'DECLARATION_TEXT_REQUIRED'; end if;

  foreach v_required_key in array array[
    'vehicle_walkaround','tyres_wheels','windscreen_mirrors','lights_indicators',
    'fuel_charge','load_secured','phone_navigation','licence_fitness','defects_reported'
  ] loop
    if coalesce((p_checks ->> v_required_key)::boolean, false) is not true then
      raise exception 'PRE_DEPARTURE_CHECK_REQUIRED:%', v_required_key;
    end if;
  end loop;

  select a.id, a.accepted_at into v_id, v_accepted
  from public.ecoflow_driver_departure_acknowledgements a
  where a.business_day = p_business_day
    and a.route_id = v_route
    and a.driver_user_id = auth.uid()
    and a.policy_version = v_policy
  limit 1;

  if v_id is null then
    insert into public.ecoflow_driver_departure_acknowledgements(
      business_day, route_id, driver_user_id, driver_email, driver_label,
      typed_name, policy_version, checks, location_consent, declaration_text,
      user_agent, metadata
    ) values (
      p_business_day, v_route, auth.uid(), v_profile.email,
      coalesce(nullif(trim(coalesce(p_driver_label, '')), ''), v_profile.email, 'Driver'),
      v_name, v_policy, coalesce(p_checks, '{}'::jsonb), true, p_declaration_text,
      nullif(trim(coalesce(p_user_agent, '')), ''), coalesce(p_metadata, '{}'::jsonb)
    )
    returning id, ecoflow_driver_departure_acknowledgements.accepted_at into v_id, v_accepted;
  end if;

  return query select v_id, v_accepted, v_policy;
end;
$$;

grant execute on function public.ecoflow_record_driver_departure_acknowledgement(
  date,text,text,text,jsonb,boolean,text,text,text,jsonb
) to authenticated;
revoke execute on function public.ecoflow_record_driver_departure_acknowledgement(
  date,text,text,text,jsonb,boolean,text,text,text,jsonb
) from anon;

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
  v_email text := lower(nullif(trim(coalesce(p_email, '')), ''));
  v_row public.ecoflow_store_sites%rowtype;
begin
  if not public.ecoflow_is_active_owner_admin() then raise exception 'OWNER_OR_ADMIN_REQUIRED'; end if;
  if v_key = '' then raise exception 'STORE_KEY_REQUIRED'; end if;
  if v_email is not null and v_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    raise exception 'VALID_EMAIL_REQUIRED';
  end if;

  select s.* into v_row
  from public.ecoflow_store_sites s
  where (p_retailer_id is not null and s.retailer_id = p_retailer_id)
     or upper(coalesce(s.store_name, '')) = v_key
  order by case when p_retailer_id is not null and s.retailer_id = p_retailer_id then 0 else 1 end
  limit 1;

  if not found then raise exception 'STORE_SITE_NOT_FOUND'; end if;

  update public.ecoflow_store_sites s
  set contact_email = v_email,
      notification_contact_name = nullif(trim(coalesce(p_contact_name, '')), ''),
      delivery_notification_enabled = coalesce(p_enabled, true),
      notification_updated_at = now(),
      notification_updated_by = auth.uid()
  where s.retailer_id is not distinct from v_row.retailer_id
    and s.store_name is not distinct from v_row.store_name;

  return query select v_key, v_email, coalesce(p_enabled, true);
end;
$$;

grant execute on function public.ecoflow_upsert_store_delivery_notification_contact(text,text,text,text,text,boolean) to authenticated;
revoke execute on function public.ecoflow_upsert_store_delivery_notification_contact(text,text,text,text,text,boolean) from anon;

-- Owner/Admin may maintain customer notification contacts; other roles do not see contact emails.
alter table public.ecoflow_store_sites enable row level security;
drop policy if exists ecoflow_store_sites_owner_notification_update on public.ecoflow_store_sites;
create policy ecoflow_store_sites_owner_notification_update
on public.ecoflow_store_sites
for update
using (public.ecoflow_is_active_owner_admin())
with check (public.ecoflow_is_active_owner_admin());

drop view if exists public.v_ecoflow_owner_driver_departure_acknowledgements cascade;
create view public.v_ecoflow_owner_driver_departure_acknowledgements
with (security_invoker = true)
as
select
  a.id, a.business_day, a.route_id, a.driver_user_id, a.driver_email, a.driver_label,
  a.typed_name, a.policy_version, a.checks, a.location_consent,
  a.accepted_at, a.user_agent, a.metadata
from public.ecoflow_driver_departure_acknowledgements a
where public.ecoflow_is_active_owner_admin();

grant select on public.v_ecoflow_owner_driver_departure_acknowledgements to authenticated;

notify pgrst, 'reload schema';
commit;
