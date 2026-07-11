-- Database-authoritative ownership for shared warehouse/driver pick tasks.
-- A SKU task must be claimed before stock can be deducted. Claims expire so
-- abandoned phones cannot block the floor indefinitely; Owner/Admin may release.

begin;

create or replace function public.ecoflow_can_claim_pick_task()
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
      and p.app_role in ('OWNER','ADMIN','WAREHOUSE','DRIVER')
  );
$$;

grant execute on function public.ecoflow_can_claim_pick_task() to authenticated;
revoke execute on function public.ecoflow_can_claim_pick_task() from anon;

create table if not exists public.ecoflow_pick_task_claims (
  business_day date not null,
  task_key text not null,
  task_type text not null default 'SKU_PICK',
  claimed_by uuid not null,
  claimed_by_label text not null,
  claimed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (business_day, task_key)
);

create index if not exists idx_ecoflow_pick_task_claims_expiry
  on public.ecoflow_pick_task_claims(expires_at);

create table if not exists public.ecoflow_pick_task_claim_audit (
  id uuid primary key default gen_random_uuid(),
  business_day date not null,
  task_key text not null,
  task_type text not null,
  action text not null,
  actor_user_id uuid,
  actor_label text,
  previous_user_id uuid,
  previous_label text,
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists idx_ecoflow_pick_task_claim_audit_task
  on public.ecoflow_pick_task_claim_audit(business_day, task_key, created_at desc);

revoke insert, update, delete on public.ecoflow_pick_task_claims from anon, authenticated;
revoke insert, update, delete on public.ecoflow_pick_task_claim_audit from anon, authenticated;
grant select on public.ecoflow_pick_task_claims to authenticated;
grant select on public.ecoflow_pick_task_claim_audit to authenticated;

create or replace view public.v_ecoflow_active_pick_task_claims as
select
  c.business_day,
  c.task_key,
  c.task_type,
  c.claimed_by,
  c.claimed_by_label,
  c.claimed_at,
  c.expires_at,
  c.updated_at
from public.ecoflow_pick_task_claims c
where c.expires_at > now();

grant select on public.v_ecoflow_active_pick_task_claims to authenticated;

create or replace function public.ecoflow_claim_pick_task(
  p_business_day date,
  p_task_key text,
  p_actor_label text default null,
  p_ttl_minutes integer default 30
)
returns table (
  business_day date,
  task_key text,
  task_type text,
  claimed_by uuid,
  claimed_by_label text,
  claimed_at timestamptz,
  expires_at timestamptz,
  claim_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := coalesce(p_business_day, (now() at time zone 'Australia/Adelaide')::date);
  v_key text := upper(nullif(trim(coalesce(p_task_key, '')), ''));
  v_user uuid := auth.uid();
  v_label text;
  v_ttl integer := greatest(5, least(coalesce(p_ttl_minutes, 30), 120));
  v_existing public.ecoflow_pick_task_claims%rowtype;
  v_status text := 'CLAIMED';
begin
  if not public.ecoflow_can_claim_pick_task() then
    raise exception 'OWNER_ADMIN_WAREHOUSE_OR_DRIVER_REQUIRED';
  end if;
  if v_user is null then raise exception 'AUTHENTICATED_USER_REQUIRED'; end if;
  if v_key is null then raise exception 'pick task key is required'; end if;

  select coalesce(
    nullif(trim(coalesce(p_actor_label, '')), ''),
    nullif(trim(coalesce(u.email, '')), ''),
    'Warehouse operator'
  ) into v_label
  from auth.users u
  where u.id = v_user;
  v_label := coalesce(v_label, nullif(trim(coalesce(p_actor_label, '')), ''), 'Warehouse operator');

  perform pg_advisory_xact_lock(hashtextextended(v_day::text || ':' || v_key, 0));

  select * into v_existing
  from public.ecoflow_pick_task_claims c
  where c.business_day = v_day and c.task_key = v_key
  for update;

  if found and v_existing.expires_at > now() and v_existing.claimed_by <> v_user then
    raise exception 'TASK_ALREADY_CLAIMED_BY: %', v_existing.claimed_by_label;
  end if;

  if found then
    if v_existing.claimed_by = v_user and v_existing.expires_at > now() then
      v_status := 'REFRESHED';
    else
      v_status := 'TAKEN_OVER';
    end if;

    update public.ecoflow_pick_task_claims c
    set task_type = 'SKU_PICK',
        claimed_by = v_user,
        claimed_by_label = v_label,
        claimed_at = case when v_status = 'REFRESHED' then c.claimed_at else now() end,
        expires_at = now() + make_interval(mins => v_ttl),
        updated_at = now()
    where c.business_day = v_day and c.task_key = v_key;
  else
    insert into public.ecoflow_pick_task_claims(
      business_day, task_key, task_type, claimed_by, claimed_by_label,
      claimed_at, expires_at, updated_at
    ) values (
      v_day, v_key, 'SKU_PICK', v_user, v_label,
      now(), now() + make_interval(mins => v_ttl), now()
    );
  end if;

  if v_status <> 'REFRESHED' then
    insert into public.ecoflow_pick_task_claim_audit(
      business_day, task_key, task_type, action, actor_user_id, actor_label,
      previous_user_id, previous_label, detail
    ) values (
      v_day, v_key, 'SKU_PICK', v_status, v_user, v_label,
      v_existing.claimed_by, v_existing.claimed_by_label,
      'Claim TTL ' || v_ttl::text || ' minutes'
    );
  end if;

  return query
  select c.business_day,c.task_key,c.task_type,c.claimed_by,c.claimed_by_label,
         c.claimed_at,c.expires_at,v_status
  from public.ecoflow_pick_task_claims c
  where c.business_day = v_day and c.task_key = v_key;
end;
$$;

grant execute on function public.ecoflow_claim_pick_task(date,text,text,integer) to authenticated;
revoke execute on function public.ecoflow_claim_pick_task(date,text,text,integer) from anon;

create or replace function public.ecoflow_release_pick_task(
  p_business_day date,
  p_task_key text,
  p_reason text default null
)
returns table (
  business_day date,
  task_key text,
  released_by uuid,
  release_status text,
  released_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := coalesce(p_business_day, (now() at time zone 'Australia/Adelaide')::date);
  v_key text := upper(nullif(trim(coalesce(p_task_key, '')), ''));
  v_user uuid := auth.uid();
  v_existing public.ecoflow_pick_task_claims%rowtype;
begin
  if not public.ecoflow_can_claim_pick_task() then
    raise exception 'OWNER_ADMIN_WAREHOUSE_OR_DRIVER_REQUIRED';
  end if;
  if v_user is null then raise exception 'AUTHENTICATED_USER_REQUIRED'; end if;
  if v_key is null then raise exception 'pick task key is required'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_day::text || ':' || v_key, 0));
  select * into v_existing
  from public.ecoflow_pick_task_claims c
  where c.business_day = v_day and c.task_key = v_key
  for update;

  if not found then
    return query select v_day,v_key,v_user,'ALREADY_RELEASED'::text,now();
    return;
  end if;

  if v_existing.claimed_by <> v_user and not public.ecoflow_can_edit_warehouse_layout() then
    raise exception 'TASK_RELEASE_NOT_ALLOWED: claimed by %', v_existing.claimed_by_label;
  end if;

  insert into public.ecoflow_pick_task_claim_audit(
    business_day, task_key, task_type, action, actor_user_id, actor_label,
    previous_user_id, previous_label, detail
  ) values (
    v_day, v_key, v_existing.task_type, 'RELEASED', v_user,
    coalesce((select u.email from auth.users u where u.id = v_user), 'Operator'),
    v_existing.claimed_by, v_existing.claimed_by_label,
    nullif(trim(coalesce(p_reason, '')), '')
  );

  delete from public.ecoflow_pick_task_claims c
  where c.business_day = v_day and c.task_key = v_key;

  return query select v_day,v_key,v_user,'RELEASED'::text,now();
end;
$$;

grant execute on function public.ecoflow_release_pick_task(date,text,text) to authenticated;
revoke execute on function public.ecoflow_release_pick_task(date,text,text) from anon;

-- Preserve the proven stock-deduction implementation behind a claim-checking
-- wrapper. The conditional keeps migration fixtures and repeated deploys safe.
do $$
begin
  if to_regprocedure('public.ecoflow_record_pick_movement_unchecked_20260711(text,numeric,text,text,text)') is null then
    if to_regprocedure('public.ecoflow_record_pick_movement(text,numeric,text,text,text)') is null then
      raise exception 'ecoflow_record_pick_movement(text,numeric,text,text,text) is required before pick ownership migration';
    end if;
    alter function public.ecoflow_record_pick_movement(text,numeric,text,text,text)
      rename to ecoflow_record_pick_movement_unchecked_20260711;
  end if;
end;
$$;

revoke execute on function public.ecoflow_record_pick_movement_unchecked_20260711(text,numeric,text,text,text) from anon, authenticated;

create or replace function public.ecoflow_record_pick_movement(
  p_sku text,
  p_quantity numeric,
  p_unit_level text default 'carton',
  p_barcode text default null,
  p_note text default null
)
returns table (
  location_code text,
  sku text,
  picked_quantity numeric,
  remaining_quantity numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := (now() at time zone 'Australia/Adelaide')::date;
  v_sku text := upper(nullif(trim(coalesce(p_sku, '')), ''));
begin
  if not public.ecoflow_can_claim_pick_task() then
    raise exception 'OWNER_ADMIN_WAREHOUSE_OR_DRIVER_REQUIRED';
  end if;
  if v_sku is null then raise exception 'valid SKU is required'; end if;

  if not exists (
    select 1
    from public.ecoflow_pick_task_claims c
    where c.business_day = v_day
      and c.task_key = v_sku
      and c.claimed_by = auth.uid()
      and c.expires_at > now()
  ) then
    raise exception 'PICK_TASK_CLAIM_REQUIRED: claim % before deducting stock', v_sku;
  end if;

  return query
  select p.location_code,p.sku,p.picked_quantity,p.remaining_quantity
  from public.ecoflow_record_pick_movement_unchecked_20260711(
    v_sku,p_quantity,p_unit_level,p_barcode,p_note
  ) p;
end;
$$;

grant execute on function public.ecoflow_record_pick_movement(text,numeric,text,text,text) to authenticated;
revoke execute on function public.ecoflow_record_pick_movement(text,numeric,text,text,text) from anon;

commit;
