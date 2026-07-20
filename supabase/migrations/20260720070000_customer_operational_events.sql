-- Customer operational events belong to EcoFlow, not the Ordermentum customer master.
-- Delivery instructions recorded here are office-to-driver operational notes.
-- Contact events preserve calls, emails and requests without changing source customer facts.

begin;

create table if not exists public.ecoflow_customer_operational_events (
  id uuid primary key default gen_random_uuid(),
  store_key text not null,
  store_name text not null,
  event_type text not null check (event_type in ('DELIVERY_INSTRUCTION','CUSTOMER_CONTACT')),
  note_text text not null,
  contact_channel text check (contact_channel is null or contact_channel in ('PHONE','EMAIL','IN_PERSON','SMS','OTHER')),
  occurred_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  created_by_email text,
  created_at timestamptz not null default now()
);

create index if not exists idx_customer_operational_events_store
  on public.ecoflow_customer_operational_events(store_key, occurred_at desc);
create index if not exists idx_customer_operational_events_delivery
  on public.ecoflow_customer_operational_events(event_type, store_key, occurred_at desc);

alter table public.ecoflow_customer_operational_events enable row level security;
revoke all on public.ecoflow_customer_operational_events from anon, authenticated;
grant select on public.ecoflow_customer_operational_events to authenticated;
grant all on public.ecoflow_customer_operational_events to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='ecoflow_customer_operational_events'
      and policyname='customer_operational_events_authenticated_read'
  ) then
    create policy customer_operational_events_authenticated_read
      on public.ecoflow_customer_operational_events
      for select to authenticated
      using (true);
  end if;
end $$;

create or replace function public.ecoflow_record_customer_operational_event(
  p_store_key text,
  p_store_name text,
  p_event_type text,
  p_note_text text,
  p_contact_channel text default null,
  p_occurred_at timestamptz default now()
)
returns table (
  id uuid,
  store_key text,
  store_name text,
  event_type text,
  note_text text,
  contact_channel text,
  occurred_at timestamptz,
  created_by uuid,
  created_by_email text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_role text;
  v_email text;
  v_type text := upper(trim(coalesce(p_event_type,'')));
  v_channel text := nullif(upper(trim(coalesce(p_contact_channel,''))), '');
  v_key text := lower(regexp_replace(trim(coalesce(p_store_key,'')), '[^a-zA-Z0-9]+', '-', 'g'));
  v_name text := nullif(trim(coalesce(p_store_name,'')), '');
  v_note text := nullif(trim(coalesce(p_note_text,'')), '');
  v_id uuid;
begin
  select upper(coalesce(app_role,'')), email
    into v_role, v_email
  from public.v_ecoflow_current_user
  limit 1;

  if v_role not in ('OWNER','ADMIN','ACCOUNT') then
    raise exception 'OWNER, ADMIN or ACCOUNT access is required to record customer events'
      using errcode='42501';
  end if;
  if v_key is null or v_key = '' or v_name is null then
    raise exception 'customer identity is required';
  end if;
  if v_type not in ('DELIVERY_INSTRUCTION','CUSTOMER_CONTACT') then
    raise exception 'unsupported customer event type: %', p_event_type;
  end if;
  if v_note is null then
    raise exception 'event note is required';
  end if;
  if v_type='CUSTOMER_CONTACT' and coalesce(v_channel,'') not in ('PHONE','EMAIL','IN_PERSON','SMS','OTHER') then
    raise exception 'a valid contact channel is required';
  end if;
  if v_type='DELIVERY_INSTRUCTION' then
    v_channel := null;
  end if;

  insert into public.ecoflow_customer_operational_events (
    store_key, store_name, event_type, note_text, contact_channel,
    occurred_at, created_by, created_by_email, created_at
  ) values (
    v_key, v_name, v_type, v_note, v_channel,
    coalesce(p_occurred_at, now()), auth.uid(), v_email, now()
  ) returning ecoflow_customer_operational_events.id into v_id;

  return query
  select e.id, e.store_key, e.store_name, e.event_type, e.note_text,
         e.contact_channel, e.occurred_at, e.created_by,
         e.created_by_email, e.created_at
  from public.ecoflow_customer_operational_events e
  where e.id=v_id;
end;
$$;

grant execute on function public.ecoflow_record_customer_operational_event(text,text,text,text,text,timestamptz) to authenticated;
revoke execute on function public.ecoflow_record_customer_operational_event(text,text,text,text,text,timestamptz) from anon;

create or replace view public.v_ecoflow_customer_operational_events as
select
  id, store_key, store_name, event_type, note_text, contact_channel,
  occurred_at, created_by, created_by_email, created_at
from public.ecoflow_customer_operational_events;

grant select on public.v_ecoflow_customer_operational_events to authenticated;
revoke all on public.v_ecoflow_customer_operational_events from anon;

create or replace view public.v_ecoflow_latest_driver_delivery_instructions as
select distinct on (store_key)
  store_key, store_name, note_text, occurred_at, created_by_email, created_at
from public.ecoflow_customer_operational_events
where event_type='DELIVERY_INSTRUCTION'
order by store_key, occurred_at desc, created_at desc;

grant select on public.v_ecoflow_latest_driver_delivery_instructions to authenticated;
revoke all on public.v_ecoflow_latest_driver_delivery_instructions from anon;

notify pgrst, 'reload schema';
commit;
