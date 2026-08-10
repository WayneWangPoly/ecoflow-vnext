-- TRANSFORM-006A follow-up: idempotent replay must return one internally
-- consistent historical command result even after later sequence revisions exist.
--
-- The first execution-sequence migration returned the stored historical
-- stop_order/revision on replay but rebuilt `snapshot` from the latest effective
-- route sequence. Preserve the canonical mutation implementation behind a
-- private primitive and make the public wrapper render the snapshot from the
-- exact stop_order returned by that command.

begin;

create or replace function public.ecoflow_delivery_route_snapshot_for_stop_order(
  p_route_snapshot_id uuid,
  p_stop_order text[]
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
  v_stops jsonb;
begin
  if p_route_snapshot_id is null then raise exception 'DELIVERY_ROUTE_REQUIRED'; end if;
  if p_stop_order is null then raise exception 'STOP_ORDER_REQUIRED'; end if;

  select r.snapshot into v_snapshot
  from public.ecoflow_delivery_route_snapshots r
  where r.id=p_route_snapshot_id;
  if not found then raise exception 'DELIVERY_ROUTE_NOT_FOUND'; end if;

  select coalesce(jsonb_agg(
    (source_stop.stop_json - 'stopNumber' - 'eta')
      || jsonb_build_object(
        'stopNumber',ordered.ordinality,
        'eta',coalesce(eta_slot.eta,'')
      )
    order by ordered.ordinality
  ),'[]'::jsonb)
  into v_stops
  from unnest(p_stop_order) with ordinality as ordered(order_id,ordinality)
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

  if jsonb_array_length(v_stops)<>coalesce(array_length(p_stop_order,1),0) then
    raise exception 'STOP_ORDER_ROUTE_MEMBERSHIP_MISMATCH';
  end if;

  return jsonb_set(v_snapshot,'{stops}',v_stops,true);
end;
$$;

revoke all on function public.ecoflow_delivery_route_snapshot_for_stop_order(uuid,text[])
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
  v_order text[];
begin
  select e.stop_order into v_order
  from public.ecoflow_delivery_route_effective_stop_order(p_route_snapshot_id) e;

  return public.ecoflow_delivery_route_snapshot_for_stop_order(
    p_route_snapshot_id,
    v_order
  );
end;
$$;

revoke all on function public.ecoflow_delivery_route_effective_snapshot(uuid)
  from public,anon,authenticated;

alter function public.ecoflow_reorder_delivery_route_execution(date,text,bigint,uuid,text[])
  rename to ecoflow_reorder_delivery_route_execution_pre_replay_consistency_20260811;

revoke all
on function public.ecoflow_reorder_delivery_route_execution_pre_replay_consistency_20260811(date,text,bigint,uuid,text[])
from public,anon,authenticated;

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
  v_result record;
begin
  select * into v_result
  from public.ecoflow_reorder_delivery_route_execution_pre_replay_consistency_20260811(
    p_business_day,
    p_run_code,
    p_expected_sequence_revision,
    p_command_id,
    p_stop_order
  );

  if not found then
    raise exception 'ROUTE_SEQUENCE_COMMAND_RETURNED_NO_RESULT';
  end if;

  return query select
    v_result.route_snapshot_id,
    v_result.route_revision,
    v_result.sequence_revision,
    v_result.stop_order,
    public.ecoflow_delivery_route_snapshot_for_stop_order(
      v_result.route_snapshot_id,
      v_result.stop_order
    ),
    v_result.command_status,
    v_result.updated_at;
end;
$$;

revoke all
on function public.ecoflow_reorder_delivery_route_execution(date,text,bigint,uuid,text[])
from public,anon;
grant execute
on function public.ecoflow_reorder_delivery_route_execution(date,text,bigint,uuid,text[])
to authenticated;

comment on function public.ecoflow_delivery_route_snapshot_for_stop_order(uuid,text[]) is
  'Private deterministic renderer for one validated route stop order. Preserves dispatch facts while assigning route-position stop numbers and ETA slots.';
comment on function public.ecoflow_reorder_delivery_route_execution(date,text,bigint,uuid,text[]) is
  'Public assigned-Driver/office reorder boundary. Mutation authority remains in the private canonical primitive; every apply/replay response snapshot is rendered from the exact returned command stop order.';

notify pgrst,'reload schema';
commit;
