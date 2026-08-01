-- Additional production-shape prerequisites for Phase 9D–9G PostgreSQL tests.

create schema if not exists analytics;

create or replace function public.ecoflow_active_app_role()
returns text
language sql
stable
security definer
set search_path=public
as $$
  select p.app_role
  from public.app_user_profiles p
  where p.user_id=auth.uid() and p.is_active=true and p.team_status='ACTIVE'
  limit 1
$$;

create table if not exists public.ecoflow_day_state (
  business_day date not null,
  scope text not null,
  payload jsonb not null default '{}'::jsonb,
  revision bigint not null default 1,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key(business_day,scope)
);

create table if not exists public.ecoflow_business_day_closes (
  business_day date primary key,
  revision bigint not null default 1,
  next_business_day date not null,
  status text not null default 'CLOSED',
  reason text not null,
  command_id uuid not null unique,
  closed_by uuid not null,
  closed_by_label text,
  closed_at timestamptz not null default clock_timestamp(),
  carry_over_count integer not null default 0
);

create table if not exists public.ecoflow_business_day_carry_over (
  id uuid primary key default gen_random_uuid(),
  source_business_day date not null,
  target_business_day date not null,
  source_scope text not null,
  run_code text not null,
  carry_type text not null,
  payload jsonb not null,
  source_revision bigint not null,
  status text not null default 'OPEN',
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(source_business_day,target_business_day,source_scope)
);

create or replace function public.ecoflow_close_business_day(
  p_business_day date,
  p_next_business_day date,
  p_expected_revision bigint,
  p_reason text,
  p_command_id uuid,
  p_actor_label text default null
)
returns table(
  command_id uuid,
  business_day date,
  close_status text,
  revision bigint,
  next_business_day date,
  carry_over_count integer,
  closed_at timestamptz
)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_existing public.ecoflow_business_day_closes%rowtype;
  v_count integer:=0;
begin
  select * into v_existing from public.ecoflow_business_day_closes
  where business_day=p_business_day for update;
  if found then
    return query select p_command_id,p_business_day,
      case when v_existing.command_id=p_command_id then 'REPLAYED' else 'CONFLICT' end,
      v_existing.revision,v_existing.next_business_day,v_existing.carry_over_count,v_existing.closed_at;
    return;
  end if;
  if p_expected_revision<>0 then
    return query select p_command_id,p_business_day,'CONFLICT'::text,0::bigint,p_next_business_day,0,null::timestamptz;
    return;
  end if;
  insert into public.ecoflow_business_day_carry_over(
    source_business_day,target_business_day,source_scope,run_code,carry_type,
    payload,source_revision,created_by
  )
  select p_business_day,p_next_business_day,d.scope,'A',
    case when d.scope like '%stop:%' then 'DRIVER_PROGRESS' else 'PICK_TASK' end,
    d.payload,d.revision,auth.uid()
  from public.ecoflow_day_state d
  where d.business_day=p_business_day
    and ((d.scope like '%stop:%' and coalesce(d.payload->>'status','PENDING') not in ('DELIVERED','FAILED'))
      or (d.scope like '%task:%' and coalesce(d.payload->>'status','PENDING')<>'PICKED'));
  get diagnostics v_count=row_count;
  insert into public.ecoflow_business_day_closes(
    business_day,revision,next_business_day,reason,command_id,closed_by,
    closed_by_label,carry_over_count
  ) values (
    p_business_day,1,p_next_business_day,p_reason,p_command_id,auth.uid(),p_actor_label,v_count
  ) returning * into v_existing;
  return query select p_command_id,p_business_day,'APPLIED'::text,v_existing.revision,
    v_existing.next_business_day,v_existing.carry_over_count,v_existing.closed_at;
end;
$$;

create table if not exists public.fixture_order_inbox (
  raw_order_id text,
  external_order_id text,
  external_order_number text,
  external_invoice_number text,
  order_number text,
  invoice_number text,
  order_status text,
  payment_status text,
  order_items_total numeric,
  order_updated_at timestamptz
);

create or replace view public.v_ecoflow_ordermentum_ui_active_inbox as
select * from public.fixture_order_inbox;

create table if not exists public.fixture_order_exceptions (
  raw_order_id text,
  external_order_id text,
  external_order_number text,
  external_invoice_number text,
  order_number text,
  invoice_number text,
  exception_type text,
  message text,
  status text,
  detected_at timestamptz
);

create or replace view public.v_ecoflow_ordermentum_ui_active_exceptions as
select * from public.fixture_order_exceptions;

create table if not exists public.fixture_sync_health (
  last_synced_at timestamptz
);

create or replace view public.v_ecoflow_ordermentum_sync_health as
select * from public.fixture_sync_health;

create table if not exists public.ecoflow_store_sites (
  retailer_id text primary key,
  purchaser_id text,
  store_name text,
  street1 text,
  street2 text,
  suburb text,
  state text,
  postcode text,
  formatted_address text,
  latitude numeric,
  longitude numeric,
  contact_phone text,
  delivery_instructions text,
  price_group_id text,
  source text,
  verified boolean
);

create table if not exists analytics.actionable_exception_lifecycle (
  exception_id text primary key,
  lifecycle_status text not null default 'OPEN',
  owner_team text,
  snoozed_until timestamptz,
  resolution_note text,
  version bigint not null default 1
);
