-- TRANSFORM-006: server-authoritative locked delivery route snapshots.
--
-- Office approval must freeze the exact route the Driver will execute. The
-- browser may build a draft from current orders, but once approved the route
-- definition (stop sequence, address, ETA, boxes and line summary) is persisted
-- server-side and Driver becomes a read-only consumer of that snapshot.

begin;

create table if not exists public.ecoflow_delivery_route_snapshots (
  id uuid primary key default extensions.gen_random_uuid(),
  business_day date not null,
  run_code text not null,
  revision integer not null,
  route_status text not null default 'LOCKED'
    check (route_status in ('LOCKED','SUPERSEDED')),
  snapshot jsonb not null,
  snapshot_hash text not null,
  approved_by uuid not null,
  approved_at timestamptz not null default now(),
  superseded_by uuid,
  superseded_at timestamptz,
  superseded_reason text,
  created_at timestamptz not null default now(),
  constraint ecoflow_delivery_route_snapshot_revision_positive check (revision > 0),
  constraint ecoflow_delivery_route_snapshot_run_code check (run_code ~ '^[A-Z]+$'),
  constraint ecoflow_delivery_route_snapshot_superseded_fk
    foreign key (superseded_by) references public.ecoflow_delivery_route_snapshots(id),
  unique (business_day, run_code, revision)
);

create unique index if not exists uq_ecoflow_delivery_route_one_locked
  on public.ecoflow_delivery_route_snapshots(business_day, run_code)
  where route_status='LOCKED';

create index if not exists idx_ecoflow_delivery_route_history
  on public.ecoflow_delivery_route_snapshots(business_day desc, run_code, revision desc);

revoke all on table public.ecoflow_delivery_route_snapshots from public, anon, authenticated;

create or replace function public.ecoflow_lock_delivery_route_snapshot(
  p_business_day date,
  p_run_code text,
  p_snapshot jsonb
)
returns table(
  route_snapshot_id uuid,
  business_day date,
  run_code text,
  revision integer,
  snapshot jsonb,
  approved_by uuid,
  approved_at timestamptz
)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
#variable_conflict error
declare
  v_run_code text:=upper(btrim(coalesce(p_run_code,'')));
  v_current public.ecoflow_delivery_route_snapshots%rowtype;
  v_inserted public.ecoflow_delivery_route_snapshots%rowtype;
  v_revision integer;
  v_stop_count integer;
begin
  if auth.uid() is null or public.ecoflow_active_app_role() not in ('OWNER','ADMIN','ACCOUNT') then
    raise exception using errcode='42501',message='OFFICE_ROUTE_APPROVAL_REQUIRED';
  end if;
  if p_business_day is null then raise exception 'BUSINESS_DAY_REQUIRED'; end if;
  if v_run_code !~ '^[A-Z]+$' then raise exception 'VALID_RUN_CODE_REQUIRED'; end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot)<>'object' then
    raise exception 'VALID_ROUTE_SNAPSHOT_REQUIRED';
  end if;
  if p_snapshot->>'businessDay' is distinct from p_business_day::text then
    raise exception 'ROUTE_SNAPSHOT_BUSINESS_DAY_MISMATCH';
  end if;
  if upper(coalesce(p_snapshot->>'runCode','')) is distinct from v_run_code then
    raise exception 'ROUTE_SNAPSHOT_RUN_CODE_MISMATCH';
  end if;
  if jsonb_typeof(p_snapshot->'stops')<>'array' then
    raise exception 'ROUTE_SNAPSHOT_STOPS_REQUIRED';
  end if;

  v_stop_count:=jsonb_array_length(p_snapshot->'stops');
  if v_stop_count<1 then raise exception 'ROUTE_SNAPSHOT_EMPTY'; end if;

  if exists(
    select 1
    from jsonb_array_elements(p_snapshot->'stops') as s
    where nullif(btrim(coalesce(s->>'orderId','')),'') is null
       or nullif(btrim(coalesce(s->>'store','')),'') is null
       or nullif(btrim(coalesce(s->>'address','')),'') is null
       or nullif(btrim(coalesce(s->>'boxCode','')),'') is null
       or coalesce((s->>'stopNumber') ~ '^[0-9]+$',false)=false
       or (s->>'stopNumber')::integer<1
  ) then
    raise exception 'ROUTE_SNAPSHOT_STOP_INVALID';
  end if;

  if exists(
    select 1 from (
      select s->>'orderId' as key, count(*)
      from jsonb_array_elements(p_snapshot->'stops') as s
      group by s->>'orderId'
      having count(*)>1
    ) duplicate_order
  ) then raise exception 'ROUTE_SNAPSHOT_DUPLICATE_ORDER'; end if;

  if exists(
    select 1 from (
      select (s->>'stopNumber')::integer as key, count(*)
      from jsonb_array_elements(p_snapshot->'stops') as s
      group by (s->>'stopNumber')::integer
      having count(*)>1
    ) duplicate_stop
  ) then raise exception 'ROUTE_SNAPSHOT_DUPLICATE_STOP_NUMBER'; end if;

  if (
    select coalesce(min((s->>'stopNumber')::integer),0)=1
       and coalesce(max((s->>'stopNumber')::integer),0)=v_stop_count
    from jsonb_array_elements(p_snapshot->'stops') as s
  ) is not true then
    raise exception 'ROUTE_SNAPSHOT_STOP_SEQUENCE_GAP';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('delivery-route:'||p_business_day::text||':'||v_run_code,0));

  select r.* into v_current
  from public.ecoflow_delivery_route_snapshots r
  where r.business_day=p_business_day
    and r.run_code=v_run_code
    and r.route_status='LOCKED'
  for update;

  if found then
    if v_current.snapshot=p_snapshot then
      return query select v_current.id,v_current.business_day,v_current.run_code,
        v_current.revision,v_current.snapshot,v_current.approved_by,v_current.approved_at;
      return;
    end if;
    raise exception 'ROUTE_ALREADY_LOCKED_DIFFERENT_SNAPSHOT: office must unlock before changing an approved route';
  end if;

  select coalesce(max(r.revision),0)+1 into v_revision
  from public.ecoflow_delivery_route_snapshots r
  where r.business_day=p_business_day and r.run_code=v_run_code;

  insert into public.ecoflow_delivery_route_snapshots(
    business_day,run_code,revision,route_status,snapshot,snapshot_hash,approved_by,approved_at
  ) values(
    p_business_day,v_run_code,v_revision,'LOCKED',p_snapshot,md5(p_snapshot::text),auth.uid(),now()
  ) returning * into v_inserted;

  return query select v_inserted.id,v_inserted.business_day,v_inserted.run_code,
    v_inserted.revision,v_inserted.snapshot,v_inserted.approved_by,v_inserted.approved_at;
end;
$$;

create or replace function public.ecoflow_unlock_delivery_route_snapshot(
  p_business_day date,
  p_run_code text,
  p_reason text default null
)
returns table(route_snapshot_id uuid,revision integer,route_status text,superseded_at timestamptz)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
#variable_conflict error
declare
  v_run_code text:=upper(btrim(coalesce(p_run_code,'')));
  v_current public.ecoflow_delivery_route_snapshots%rowtype;
begin
  if auth.uid() is null or public.ecoflow_active_app_role() not in ('OWNER','ADMIN','ACCOUNT') then
    raise exception using errcode='42501',message='OFFICE_ROUTE_APPROVAL_REQUIRED';
  end if;
  if p_business_day is null then raise exception 'BUSINESS_DAY_REQUIRED'; end if;
  if v_run_code !~ '^[A-Z]+$' then raise exception 'VALID_RUN_CODE_REQUIRED'; end if;

  perform pg_advisory_xact_lock(hashtextextended('delivery-route:'||p_business_day::text||':'||v_run_code,0));

  update public.ecoflow_delivery_route_snapshots r
  set route_status='SUPERSEDED',
      superseded_at=now(),
      superseded_reason=coalesce(nullif(btrim(coalesce(p_reason,'')),''),'Office unlocked route before execution')
  where r.business_day=p_business_day
    and r.run_code=v_run_code
    and r.route_status='LOCKED'
  returning r.* into v_current;

  if not found then raise exception 'LOCKED_ROUTE_NOT_FOUND'; end if;

  return query select v_current.id,v_current.revision,v_current.route_status,v_current.superseded_at;
end;
$$;

create or replace function public.ecoflow_get_locked_delivery_route_snapshot(
  p_business_day date,
  p_run_code text
)
returns table(
  route_snapshot_id uuid,
  business_day date,
  run_code text,
  revision integer,
  snapshot jsonb,
  approved_by uuid,
  approved_at timestamptz
)
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
#variable_conflict error
declare
  v_run_code text:=upper(btrim(coalesce(p_run_code,'')));
begin
  if auth.uid() is null or public.ecoflow_active_app_role() not in ('OWNER','ADMIN','ACCOUNT','WAREHOUSE','DRIVER') then
    raise exception using errcode='42501',message='DELIVERY_ROUTE_READ_REQUIRED';
  end if;
  if p_business_day is null then raise exception 'BUSINESS_DAY_REQUIRED'; end if;
  if v_run_code !~ '^[A-Z]+$' then raise exception 'VALID_RUN_CODE_REQUIRED'; end if;

  return query
  select r.id,r.business_day,r.run_code,r.revision,r.snapshot,r.approved_by,r.approved_at
  from public.ecoflow_delivery_route_snapshots r
  where r.business_day=p_business_day
    and r.run_code=v_run_code
    and r.route_status='LOCKED'
  limit 1;
end;
$$;

revoke all on function public.ecoflow_lock_delivery_route_snapshot(date,text,jsonb) from public,anon,authenticated;
revoke all on function public.ecoflow_unlock_delivery_route_snapshot(date,text,text) from public,anon,authenticated;
revoke all on function public.ecoflow_get_locked_delivery_route_snapshot(date,text) from public,anon,authenticated;

grant execute on function public.ecoflow_lock_delivery_route_snapshot(date,text,jsonb) to authenticated;
grant execute on function public.ecoflow_unlock_delivery_route_snapshot(date,text,text) to authenticated;
grant execute on function public.ecoflow_get_locked_delivery_route_snapshot(date,text) to authenticated;

comment on table public.ecoflow_delivery_route_snapshots is
  'Append-only authoritative snapshots of office-approved delivery routes. Driver consumes the active LOCKED revision and cannot mutate route authority.';
comment on function public.ecoflow_lock_delivery_route_snapshot(date,text,jsonb) is
  'Office-only idempotent route approval boundary. A changed route requires explicit server unlock before a new revision can be locked.';
comment on function public.ecoflow_get_locked_delivery_route_snapshot(date,text) is
  'Read boundary for the exact server-authoritative route approved for a business day and run.';

notify pgrst,'reload schema';
commit;
