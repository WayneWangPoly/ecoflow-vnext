-- TRANSFORM-006A: assigned-Driver authoritative execution sequence.
--
-- Dispatch authority stays immutable: office owns run membership, assignment,
-- addresses, cartons, order facts and the approved snapshot. This migration adds
-- a separate append-only execution-sequence authority so the assigned Driver may
-- reorder eligible stops without mutating the dispatch snapshot.

begin;

create table if not exists public.ecoflow_delivery_route_sequence_revisions (
  id uuid primary key default extensions.gen_random_uuid(),
  route_snapshot_id uuid not null references public.ecoflow_delivery_route_snapshots(id),
  sequence_revision bigint not null check (sequence_revision > 0),
  expected_revision bigint not null check (expected_revision >= 0),
  stop_order text[] not null,
  command_id uuid not null unique,
  actor_user_id uuid not null,
  actor_role text not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(route_snapshot_id, sequence_revision)
);

create index if not exists idx_ecoflow_delivery_route_sequence_latest
  on public.ecoflow_delivery_route_sequence_revisions(route_snapshot_id, sequence_revision desc);

revoke all on table public.ecoflow_delivery_route_sequence_revisions from public,anon,authenticated;

create or replace function public.ecoflow_delivery_route_effective_stop_order(
  p_route_snapshot_id uuid
)
returns table(sequence_revision bigint, stop_order text[])
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
#variable_conflict error
declare
  v_snapshot jsonb;
  v_revision bigint;
  v_order text[];
begin
  select s.stop_order,s.sequence_revision
    into v_order,v_revision
  from public.ecoflow_delivery_route_sequence_revisions s
  where s.route_snapshot_id=p_route_snapshot_id
  order by s.sequence_revision desc
  limit 1;

  if found then
    return query select v_revision,v_order;
    return;
  end if;

  select r.snapshot into v_snapshot
  from public.ecoflow_delivery_route_snapshots r
  where r.id=p_route_snapshot_id;
  if not found then raise exception 'DELIVERY_ROUTE_NOT_FOUND'; end if;

  select coalesce(array_agg(x.order_id order by x.stop_number),array[]::text[])
    into v_order
  from (
    select s->>'orderId' as order_id,(s->>'stopNumber')::integer as stop_number
    from jsonb_array_elements(v_snapshot->'stops') s
  ) x;

  return query select 0::bigint,v_order;
end;
$$;

revoke all on function public.ecoflow_delivery_route_effective_stop_order(uuid)
  from public,anon,authenticated;

create or replace function public.ecoflow_delivery_route_effective_snapshot(
  p_route_snapshot_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
#variable_conflict error
declare
  v_snapshot jsonb;
  v_order text[];
  v_stops jsonb;
begin
  select r.snapshot into v_snapshot
  from public.ecoflow_delivery_route_snapshots r
  where r.id=p_route_snapshot_id;
  if not found then raise exception 'DELIVERY_ROUTE_NOT_FOUND'; end if;

  select e.stop_order into v_order
  from public.ecoflow_delivery_route_effective_stop_order(p_route_snapshot_id) e;

  -- ETA is a route-position projection. When the Driver changes order, preserve
  -- the original approved ETA slots but assign those slots to the new sequence.
  -- Box codes and every other stop fact remain attached to the original order.
  select coalesce(jsonb_agg(
    (source_stop.stop_json - 'stopNumber' - 'eta')
      || jsonb_build_object(
        'stopNumber',ordered.ordinality,
        'eta',coalesce(eta_slot.eta,'')
      )
    order by ordered.ordinality
  ),'[]'::jsonb)
  into v_stops
  from unnest(v_order) with ordinality as ordered(order_id,ordinality)
  join lateral (
    select s as stop_json
    from jsonb_array_elements(v_snapshot->'stops') s
    where s->>'orderId'=ordered.order_id
    limit 1
  ) source_stop on true
  left join lateral (
    select s->>'eta' as eta
    from jsonb_array_elements(v_snapshot->'stops') s
    where (s->>'stopNumber')::integer=ordered.ordinality
    limit 1
  ) eta_slot on true;

  return jsonb_set(v_snapshot,'{stops}',v_stops,true);
end;
$$;

revoke all on function public.ecoflow_delivery_route_effective_snapshot(uuid)
  from public,anon,authenticated;

create or replace function public.ecoflow_get_delivery_route_execution_sequence(
  p_business_day date,
  p_run_code text
)
returns table(
  route_snapshot_id uuid,
  route_revision integer,
  sequence_revision bigint,
  stop_order text[],
  snapshot jsonb,
  assigned_driver_user_id uuid,
  assigned_driver_label text,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
#variable_conflict error
declare
  v_run_code text:=upper(btrim(coalesce(p_run_code,'')));
  v_role text:=public.ecoflow_active_app_role();
  v_route public.ecoflow_delivery_route_snapshots%rowtype;
  v_sequence_revision bigint;
  v_stop_order text[];
  v_updated_at timestamptz;
begin
  if auth.uid() is null or v_role not in ('OWNER','ADMIN','ACCOUNT','WAREHOUSE','DRIVER') then
    raise exception using errcode='42501',message='DELIVERY_ROUTE_READ_REQUIRED';
  end if;
  if p_business_day is null then raise exception 'BUSINESS_DAY_REQUIRED'; end if;
  if v_run_code !~ '^[A-Z]+$' then raise exception 'VALID_RUN_CODE_REQUIRED'; end if;

  select r.* into v_route
  from public.ecoflow_delivery_route_snapshots r
  where r.business_day=p_business_day
    and r.run_code=v_run_code
    and r.route_status='LOCKED'
  limit 1;
  if not found then return; end if;

  if v_route.assigned_driver_user_id is null then
    raise exception 'ROUTE_DRIVER_ASSIGNMENT_REQUIRED';
  end if;
  if v_role='DRIVER' and v_route.assigned_driver_user_id<>auth.uid() then
    raise exception using errcode='42501',message='DRIVER_ROUTE_ASSIGNMENT_REQUIRED';
  end if;

  select e.sequence_revision,e.stop_order
    into v_sequence_revision,v_stop_order
  from public.ecoflow_delivery_route_effective_stop_order(v_route.id) e;

  select s.created_at into v_updated_at
  from public.ecoflow_delivery_route_sequence_revisions s
  where s.route_snapshot_id=v_route.id
  order by s.sequence_revision desc
  limit 1;

  return query select
    v_route.id,v_route.revision,v_sequence_revision,v_stop_order,
    public.ecoflow_delivery_route_effective_snapshot(v_route.id),
    v_route.assigned_driver_user_id,v_route.assigned_driver_label,
    coalesce(v_updated_at,v_route.approved_at);
end;
$$;

revoke all on function public.ecoflow_get_delivery_route_execution_sequence(date,text)
  from public,anon,authenticated;
grant execute on function public.ecoflow_get_delivery_route_execution_sequence(date,text)
  to authenticated;

create or replace function public.ecoflow_reorder_delivery_route_execution(
  p_business_day date,
  p_run_code text,
  p_expected_sequence_revision bigint,
  p_command_id uuid,
  p_stop_order text[]
)
returns table(
  route_snapshot_id uuid,
  route_revision integer,
  sequence_revision bigint,
  stop_order text[],
  snapshot jsonb,
  command_status text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
#variable_conflict error
declare
  v_run_code text:=upper(btrim(coalesce(p_run_code,'')));
  v_role text:=public.ecoflow_active_app_role();
  v_route public.ecoflow_delivery_route_snapshots%rowtype;
  v_current_revision bigint;
  v_current_order text[];
  v_route_order text[];
  v_existing public.ecoflow_delivery_route_sequence_revisions%rowtype;
  v_inserted public.ecoflow_delivery_route_sequence_revisions%rowtype;
  v_order_id text;
  v_status text;
  v_current_index integer;
  v_next_index integer;
begin
  if auth.uid() is null or v_role not in ('OWNER','ADMIN','ACCOUNT','DRIVER') then
    raise exception using errcode='42501',message='DELIVERY_ROUTE_REORDER_REQUIRED';
  end if;
  if p_business_day is null then raise exception 'BUSINESS_DAY_REQUIRED'; end if;
  if v_run_code !~ '^[A-Z]+$' then raise exception 'VALID_RUN_CODE_REQUIRED'; end if;
  if p_expected_sequence_revision is null or p_expected_sequence_revision<0 then
    raise exception 'EXPECTED_SEQUENCE_REVISION_REQUIRED';
  end if;
  if p_command_id is null then raise exception 'COMMAND_ID_REQUIRED'; end if;
  if p_stop_order is null or coalesce(array_length(p_stop_order,1),0)<1 then
    raise exception 'STOP_ORDER_REQUIRED';
  end if;
  if exists(select 1 from unnest(p_stop_order) x where nullif(btrim(coalesce(x,'')),'') is null) then
    raise exception 'STOP_ORDER_INVALID';
  end if;
  if (select count(*) from unnest(p_stop_order) x)<>(select count(distinct x) from unnest(p_stop_order) x) then
    raise exception 'STOP_ORDER_DUPLICATE_STOP';
  end if;

  select r.* into v_route
  from public.ecoflow_delivery_route_snapshots r
  where r.business_day=p_business_day
    and r.run_code=v_run_code
    and r.route_status='LOCKED'
  limit 1;
  if not found then raise exception 'LOCKED_ROUTE_NOT_FOUND'; end if;
  if v_route.assigned_driver_user_id is null then raise exception 'ROUTE_DRIVER_ASSIGNMENT_REQUIRED'; end if;
  if v_role='DRIVER' and v_route.assigned_driver_user_id<>auth.uid() then
    raise exception using errcode='42501',message='DRIVER_ROUTE_ASSIGNMENT_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('delivery-route-sequence:'||v_route.id::text,0));

  select s.* into v_existing
  from public.ecoflow_delivery_route_sequence_revisions s
  where s.command_id=p_command_id;
  if found then
    if v_existing.route_snapshot_id=v_route.id
       and v_existing.expected_revision=p_expected_sequence_revision
       and v_existing.stop_order=p_stop_order then
      return query select
        v_route.id,v_route.revision,v_existing.sequence_revision,v_existing.stop_order,
        public.ecoflow_delivery_route_effective_snapshot(v_route.id),
        'REPLAYED'::text,v_existing.created_at;
      return;
    end if;
    raise exception 'ROUTE_SEQUENCE_COMMAND_ID_REUSE_MISMATCH';
  end if;

  select e.sequence_revision,e.stop_order
    into v_current_revision,v_current_order
  from public.ecoflow_delivery_route_effective_stop_order(v_route.id) e;

  if v_current_revision<>p_expected_sequence_revision then
    raise exception using errcode='40001',message=format(
      'ROUTE_SEQUENCE_REVISION_CONFLICT: expected %s current %s',
      p_expected_sequence_revision,v_current_revision
    );
  end if;

  select coalesce(array_agg(x.order_id order by x.stop_number),array[]::text[])
    into v_route_order
  from (
    select s->>'orderId' as order_id,(s->>'stopNumber')::integer as stop_number
    from jsonb_array_elements(v_route.snapshot->'stops') s
  ) x;

  if coalesce(array_length(p_stop_order,1),0)<>coalesce(array_length(v_route_order,1),0)
     or exists(select x from unnest(v_route_order) x except select y from unnest(p_stop_order) y)
     or exists(select y from unnest(p_stop_order) y except select x from unnest(v_route_order) x) then
    raise exception 'STOP_ORDER_ROUTE_MEMBERSHIP_MISMATCH';
  end if;

  -- Any stop that has begun execution is position-immutable. Closed stops stay
  -- fixed, and an ARRIVED/current stop can never be moved behind another stop.
  for v_order_id,v_status in
    select regexp_replace(d.scope,'^run:[A-Z]+:stop:',''),upper(coalesce(d.payload->>'status','PENDING'))
    from public.ecoflow_day_state d
    where d.business_day=p_business_day
      and d.scope like 'run:'||v_run_code||':stop:%'
      and upper(coalesce(d.payload->>'status','PENDING')) in ('ARRIVED','DELIVERED','FAILED','SKIPPED')
  loop
    v_current_index:=array_position(v_current_order,v_order_id);
    v_next_index:=array_position(p_stop_order,v_order_id);
    if v_current_index is not null and v_next_index is distinct from v_current_index then
      raise exception 'EXECUTED_STOP_POSITION_IMMUTABLE: % status %',v_order_id,v_status;
    end if;
  end loop;

  insert into public.ecoflow_delivery_route_sequence_revisions(
    route_snapshot_id,sequence_revision,expected_revision,stop_order,command_id,
    actor_user_id,actor_role,created_at
  ) values(
    v_route.id,v_current_revision+1,v_current_revision,p_stop_order,p_command_id,
    auth.uid(),v_role,clock_timestamp()
  ) returning * into v_inserted;

  return query select
    v_route.id,v_route.revision,v_inserted.sequence_revision,v_inserted.stop_order,
    public.ecoflow_delivery_route_effective_snapshot(v_route.id),
    'APPLIED'::text,v_inserted.created_at;
end;
$$;

revoke all on function public.ecoflow_reorder_delivery_route_execution(date,text,bigint,uuid,text[])
  from public,anon,authenticated;
grant execute on function public.ecoflow_reorder_delivery_route_execution(date,text,bigint,uuid,text[])
  to authenticated;

-- Keep the established route-read API compatible while making its `snapshot`
-- reflect the latest authoritative execution sequence. Existing Driver and office
-- consumers therefore stop using stale office order/ETA after a Driver reorder.
create or replace function public.ecoflow_get_assigned_delivery_route_snapshot(
  p_business_day date,
  p_run_code text
)
returns table(
  route_snapshot_id uuid,
  business_day date,
  run_code text,
  revision integer,
  snapshot jsonb,
  assigned_driver_user_id uuid,
  assigned_driver_label text,
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
  v_role text;
  v_route public.ecoflow_delivery_route_snapshots%rowtype;
begin
  v_role:=public.ecoflow_active_app_role();
  if auth.uid() is null or v_role not in ('OWNER','ADMIN','ACCOUNT','WAREHOUSE','DRIVER') then
    raise exception using errcode='42501',message='DELIVERY_ROUTE_READ_REQUIRED';
  end if;
  if p_business_day is null then raise exception 'BUSINESS_DAY_REQUIRED'; end if;
  if v_run_code !~ '^[A-Z]+$' then raise exception 'VALID_RUN_CODE_REQUIRED'; end if;

  select r.* into v_route
  from public.ecoflow_delivery_route_snapshots r
  where r.business_day=p_business_day
    and r.run_code=v_run_code
    and r.route_status='LOCKED'
  limit 1;
  if not found then return; end if;

  if v_route.assigned_driver_user_id is null then
    raise exception 'ROUTE_DRIVER_ASSIGNMENT_REQUIRED: office must re-approve this route with an active Driver';
  end if;
  if v_role='DRIVER' and v_route.assigned_driver_user_id<>auth.uid() then
    raise exception using errcode='42501',message='DRIVER_ROUTE_ASSIGNMENT_REQUIRED';
  end if;

  return query
  select v_route.id,v_route.business_day,v_route.run_code,v_route.revision,
    public.ecoflow_delivery_route_effective_snapshot(v_route.id),
    v_route.assigned_driver_user_id,v_route.assigned_driver_label,v_route.approved_by,v_route.approved_at;
end;
$$;

revoke all on function public.ecoflow_get_assigned_delivery_route_snapshot(date,text)
  from public,anon,authenticated;
grant execute on function public.ecoflow_get_assigned_delivery_route_snapshot(date,text)
  to authenticated;

comment on table public.ecoflow_delivery_route_sequence_revisions is
  'Append-only Driver execution-sequence authority. Reorders may change only stop order; dispatch membership and stop facts stay in the immutable office snapshot.';
comment on function public.ecoflow_reorder_delivery_route_execution(date,text,bigint,uuid,text[]) is
  'Assigned-Driver/office CAS reorder command. Validates exact route permutation, freezes begun/closed stop positions and records idempotent append-only sequence revisions.';
comment on function public.ecoflow_get_delivery_route_execution_sequence(date,text) is
  'Authoritative execution-sequence read including sequence revision and ETA-reprojected snapshot.';
comment on function public.ecoflow_get_assigned_delivery_route_snapshot(date,text) is
  'Assignment-aware route read returning immutable dispatch facts in the latest authoritative execution order with ETA slots coupled to that order.';

notify pgrst,'reload schema';
commit;
