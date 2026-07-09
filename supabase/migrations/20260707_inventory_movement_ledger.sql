-- Inventory movement ledger for receiving, putaway, dispatch and adjustments.

create table if not exists public.ecoflow_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  sku text not null,
  product_name text,
  movement_type text not null check (movement_type in ('RECEIVE','PUTAWAY','DISPATCH','ADJUST_IN','ADJUST_OUT','RETURN_IN')),
  quantity numeric not null check (quantity > 0),
  from_location text,
  to_location text,
  reference_type text,
  reference_id text,
  store_id text,
  action_note text,
  source text not null default 'INVENTORY_CONTROL',
  moved_by uuid default auth.uid(),
  moved_at timestamptz not null default now()
);

create index if not exists idx_inventory_movements_sku on public.ecoflow_inventory_movements(sku);
create index if not exists idx_inventory_movements_moved_at on public.ecoflow_inventory_movements(moved_at desc);
create index if not exists idx_inventory_movements_reference on public.ecoflow_inventory_movements(reference_type, reference_id);
create index if not exists idx_inventory_movements_locations on public.ecoflow_inventory_movements(from_location, to_location);

grant select, insert on public.ecoflow_inventory_movements to authenticated;

create or replace function public.ecoflow_record_inventory_movement(
  p_sku text,
  p_movement_type text,
  p_quantity numeric,
  p_from_location text default null,
  p_to_location text default null,
  p_reference_type text default null,
  p_reference_id text default null,
  p_store_id text default null,
  p_note text default null,
  p_source text default 'INVENTORY_CONTROL'
)
returns table (
  movement_id uuid,
  sku text,
  movement_type text,
  quantity numeric,
  from_location text,
  to_location text,
  moved_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sku text := nullif(trim(coalesce(p_sku, '')), '');
  v_type text := upper(trim(coalesce(p_movement_type, '')));
  v_qty numeric := coalesce(p_quantity, 0);
  v_product_name text;
  v_id uuid;
begin
  if v_sku is null or v_sku = 'UNKNOWN' then
    raise exception 'valid SKU is required';
  end if;
  if v_type not in ('RECEIVE','PUTAWAY','DISPATCH','ADJUST_IN','ADJUST_OUT','RETURN_IN') then
    raise exception 'unsupported inventory movement type: %', p_movement_type;
  end if;
  if v_qty <= 0 then
    raise exception 'movement quantity must be greater than zero';
  end if;
  if v_type in ('RECEIVE','ADJUST_IN','RETURN_IN') and nullif(trim(coalesce(p_to_location, '')), '') is null then
    raise exception '% requires to_location', v_type;
  end if;
  if v_type in ('DISPATCH','ADJUST_OUT') and nullif(trim(coalesce(p_from_location, '')), '') is null then
    raise exception '% requires from_location', v_type;
  end if;
  if v_type = 'PUTAWAY' and (nullif(trim(coalesce(p_from_location, '')), '') is null or nullif(trim(coalesce(p_to_location, '')), '') is null) then
    raise exception 'PUTAWAY requires from_location and to_location';
  end if;

  select product_name into v_product_name from public.v_ecoflow_owner_sku_velocity where sku = v_sku limit 1;

  insert into public.ecoflow_inventory_movements (
    sku, product_name, movement_type, quantity, from_location, to_location, reference_type,
    reference_id, store_id, action_note, source, moved_by, moved_at
  ) values (
    v_sku, v_product_name, v_type, v_qty,
    nullif(trim(coalesce(p_from_location, '')), ''),
    nullif(trim(coalesce(p_to_location, '')), ''),
    nullif(trim(coalesce(p_reference_type, '')), ''),
    nullif(trim(coalesce(p_reference_id, '')), ''),
    nullif(trim(coalesce(p_store_id, '')), ''),
    nullif(trim(coalesce(p_note, '')), ''),
    coalesce(nullif(trim(coalesce(p_source, '')), ''), 'INVENTORY_CONTROL'),
    auth.uid(), now()
  ) returning id into v_id;

  insert into public.ecoflow_inventory_sku_controls (sku, product_name, updated_by, updated_at)
  values (v_sku, v_product_name, auth.uid(), now())
  on conflict (sku) do update set
    product_name = coalesce(public.ecoflow_inventory_sku_controls.product_name, excluded.product_name),
    updated_at = now(),
    updated_by = auth.uid();

  return query
  select m.id, m.sku, m.movement_type, m.quantity, m.from_location, m.to_location, m.moved_at
  from public.ecoflow_inventory_movements m
  where m.id = v_id;
end;
$$;

grant execute on function public.ecoflow_record_inventory_movement(text, text, numeric, text, text, text, text, text, text, text) to authenticated;

drop view if exists public.v_ecoflow_inventory_kpis cascade;
drop view if exists public.v_ecoflow_inventory_sku_control cascade;
drop view if exists public.v_ecoflow_inventory_sku_location_balance cascade;
drop view if exists public.v_ecoflow_inventory_sku_balance cascade;
drop view if exists public.v_ecoflow_inventory_recent_movements cascade;

create view public.v_ecoflow_inventory_recent_movements as
select
  m.id,
  m.sku,
  coalesce(m.product_name, v.product_name, c.product_name, 'Unknown product') as product_name,
  m.movement_type,
  m.quantity,
  m.from_location,
  m.to_location,
  m.reference_type,
  m.reference_id,
  m.store_id,
  m.action_note,
  m.source,
  m.moved_at
from public.ecoflow_inventory_movements m
left join public.v_ecoflow_owner_sku_velocity v on v.sku = m.sku
left join public.ecoflow_inventory_sku_controls c on c.sku = m.sku
order by m.moved_at desc
limit 250;

grant select on public.v_ecoflow_inventory_recent_movements to authenticated;

create view public.v_ecoflow_inventory_sku_balance as
select
  m.sku,
  max(coalesce(m.product_name, v.product_name, c.product_name, 'Unknown product')) as product_name,
  coalesce(sum(case
    when m.movement_type in ('RECEIVE','ADJUST_IN','RETURN_IN') then m.quantity
    when m.movement_type in ('DISPATCH','ADJUST_OUT') then -m.quantity
    else 0
  end), 0)::numeric as on_hand_live,
  count(*)::numeric as movement_count,
  max(m.moved_at) as latest_movement_at,
  min(m.moved_at) as first_movement_at
from public.ecoflow_inventory_movements m
left join public.v_ecoflow_owner_sku_velocity v on v.sku = m.sku
left join public.ecoflow_inventory_sku_controls c on c.sku = m.sku
group by m.sku;

grant select on public.v_ecoflow_inventory_sku_balance to authenticated;

create view public.v_ecoflow_inventory_sku_location_balance as
with legs as (
  select sku, product_name, to_location as location, quantity as signed_qty, moved_at from public.ecoflow_inventory_movements where movement_type in ('RECEIVE','ADJUST_IN','RETURN_IN') and to_location is not null
  union all
  select sku, product_name, from_location as location, -quantity as signed_qty, moved_at from public.ecoflow_inventory_movements where movement_type in ('DISPATCH','ADJUST_OUT') and from_location is not null
  union all
  select sku, product_name, from_location as location, -quantity as signed_qty, moved_at from public.ecoflow_inventory_movements where movement_type = 'PUTAWAY' and from_location is not null
  union all
  select sku, product_name, to_location as location, quantity as signed_qty, moved_at from public.ecoflow_inventory_movements where movement_type = 'PUTAWAY' and to_location is not null
)
select
  sku,
  max(coalesce(product_name, 'Unknown product')) as product_name,
  location,
  coalesce(sum(signed_qty), 0)::numeric as on_hand_location,
  max(moved_at) as latest_location_movement_at
from legs
where location is not null and trim(location) <> ''
group by sku, location
having coalesce(sum(signed_qty), 0) <> 0
order by sku, on_hand_location desc;

grant select on public.v_ecoflow_inventory_sku_location_balance to authenticated;

create view public.v_ecoflow_inventory_sku_control as
with velocity as (
  select
    sku, product_name, revenue_7d, revenue_30d, units_7d, units_30d,
    order_count as order_count_30d, avg_unit_price, last_sold_at,
    barcode_attention_lines, latest_barcode_status, warehouse_barcode, velocity_rank
  from public.v_ecoflow_owner_sku_velocity
), reorder_store_pressure as (
  select
    sku,
    count(*) filter (where reorder_signal = 'HIGH_REORDER_PRESSURE')::numeric as high_reorder_stores,
    count(*) filter (where reorder_signal = 'WATCH_REORDER')::numeric as watch_reorder_stores,
    max(last_sold_at) as latest_store_reorder_at
  from public.v_ecoflow_owner_store_reorder_watch
  group by sku
)
select
  v.sku,
  coalesce(c.product_name, v.product_name, 'Unknown product') as product_name,
  c.category,
  c.fixed_shelf,
  coalesce(c.primary_barcode, v.warehouse_barcode) as primary_barcode,
  c.reorder_target,
  c.on_hand_estimate,
  b.on_hand_live,
  case when b.movement_count is not null then 'LIVE_LEDGER' else 'TEMP_ESTIMATE' end as stock_source,
  coalesce(b.on_hand_live, c.on_hand_estimate) as effective_on_hand,
  coalesce(c.status, 'ACTIVE') as control_status,
  c.owner_note,
  v.revenue_7d,
  v.revenue_30d,
  v.units_7d,
  v.units_30d,
  v.order_count_30d,
  v.avg_unit_price,
  v.last_sold_at,
  coalesce(v.barcode_attention_lines, 0)::numeric as barcode_attention_lines,
  v.latest_barcode_status,
  coalesce(r.high_reorder_stores, 0)::numeric as high_reorder_stores,
  coalesce(r.watch_reorder_stores, 0)::numeric as watch_reorder_stores,
  r.latest_store_reorder_at,
  b.movement_count,
  b.latest_movement_at,
  a.latest_action,
  a.latest_execution_status,
  a.latest_action_at,
  case
    when b.movement_count is null and c.on_hand_estimate is null then 'NO_STOCK_LEDGER'
    when coalesce(b.on_hand_live, c.on_hand_estimate) < 0 then 'NEGATIVE_STOCK'
    when c.reorder_target is not null and coalesce(b.on_hand_live, c.on_hand_estimate) <= c.reorder_target then 'BELOW_TARGET'
    when coalesce(r.high_reorder_stores, 0) > 0 then 'REORDER_PRESSURE'
    when coalesce(v.barcode_attention_lines, 0) > 0 then 'BARCODE_CLEANUP'
    when c.fixed_shelf is null or trim(c.fixed_shelf) = '' then 'NEEDS_SHELF'
    else 'CONTROLLED'
  end as inventory_signal,
  case
    when b.movement_count is null and c.on_hand_estimate is null then 'Receive stock or add a temporary stock estimate'
    when coalesce(b.on_hand_live, c.on_hand_estimate) < 0 then 'Investigate negative stock before release'
    when c.reorder_target is not null and coalesce(b.on_hand_live, c.on_hand_estimate) <= c.reorder_target then 'Plan reorder or receiving check'
    when coalesce(r.high_reorder_stores, 0) > 0 then 'Review store/SKU reorder demand'
    when coalesce(v.barcode_attention_lines, 0) > 0 then 'Clean barcode mapping before warehouse release'
    when c.fixed_shelf is null or trim(c.fixed_shelf) = '' then 'Assign fixed shelf / rack'
    else 'Ready'
  end as action_hint,
  dense_rank() over (
    order by
      case
        when b.movement_count is null and c.on_hand_estimate is null then 0
        when coalesce(b.on_hand_live, c.on_hand_estimate) < 0 then 1
        when c.reorder_target is not null and coalesce(b.on_hand_live, c.on_hand_estimate) <= c.reorder_target then 2
        when coalesce(r.high_reorder_stores, 0) > 0 then 3
        when coalesce(v.barcode_attention_lines, 0) > 0 then 4
        when c.fixed_shelf is null or trim(c.fixed_shelf) = '' then 5
        else 6
      end,
      coalesce(v.units_30d, 0) desc,
      coalesce(v.revenue_30d, 0) desc
  ) as inventory_rank
from velocity v
left join public.ecoflow_inventory_sku_controls c on c.sku = v.sku
left join public.v_ecoflow_inventory_sku_balance b on b.sku = v.sku
left join reorder_store_pressure r on r.sku = v.sku
left join public.v_ecoflow_inventory_sku_actions_latest a on a.sku = v.sku
order by inventory_rank asc;

grant select on public.v_ecoflow_inventory_sku_control to authenticated;

create view public.v_ecoflow_inventory_kpis as
select
  count(*)::numeric as sku_count,
  count(*) filter (where inventory_signal = 'NO_STOCK_LEDGER')::numeric as no_stock_ledger_skus,
  count(*) filter (where inventory_signal = 'NEGATIVE_STOCK')::numeric as negative_stock_skus,
  count(*) filter (where inventory_signal = 'BELOW_TARGET')::numeric as below_target_skus,
  count(*) filter (where inventory_signal = 'REORDER_PRESSURE')::numeric as reorder_pressure_skus,
  count(*) filter (where inventory_signal = 'BARCODE_CLEANUP')::numeric as barcode_cleanup_skus,
  count(*) filter (where inventory_signal = 'NEEDS_SHELF')::numeric as needs_shelf_skus,
  coalesce(sum(units_30d), 0)::numeric as units_30d,
  coalesce(sum(revenue_30d), 0)::numeric as revenue_30d,
  coalesce(sum(effective_on_hand) filter (where stock_source = 'LIVE_LEDGER'), 0)::numeric as live_on_hand_units,
  count(*) filter (where stock_source = 'LIVE_LEDGER')::numeric as live_ledger_skus,
  (array_agg(sku order by units_30d desc nulls last))[1] as top_sku_30d,
  (array_agg(product_name order by units_30d desc nulls last))[1] as top_product_30d,
  max(greatest(coalesce(last_sold_at, '1970-01-01'::timestamptz), coalesce(latest_movement_at, '1970-01-01'::timestamptz))) as latest_sku_activity_at
from public.v_ecoflow_inventory_sku_control;

grant select on public.v_ecoflow_inventory_kpis to authenticated;

notify pgrst, 'reload schema';
