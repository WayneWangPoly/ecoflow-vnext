-- Inventory SKU control.
-- This layer makes Inventory operational before a full stock ledger exists: SKU velocity,
-- barcode cleanup, fixed shelf, reorder target, optional stock estimate and audited SKU actions.

create table if not exists public.ecoflow_inventory_sku_controls (
  sku text primary key,
  product_name text,
  category text,
  fixed_shelf text,
  primary_barcode text,
  reorder_target numeric,
  on_hand_estimate numeric,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','WATCH','HOLD','DISCONTINUED')),
  owner_note text,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_inventory_sku_controls_status on public.ecoflow_inventory_sku_controls(status);
create index if not exists idx_inventory_sku_controls_fixed_shelf on public.ecoflow_inventory_sku_controls(fixed_shelf);

grant select, insert, update on public.ecoflow_inventory_sku_controls to authenticated;

create table if not exists public.ecoflow_inventory_sku_actions (
  id uuid primary key default gen_random_uuid(),
  sku text not null,
  action text not null check (action in (
    'SET_FIXED_SHELF',
    'SET_BARCODE',
    'SET_REORDER_TARGET',
    'SET_ON_HAND_ESTIMATE',
    'SET_STATUS',
    'SET_NOTE',
    'MARK_REVIEWED'
  )),
  action_value text,
  action_note text,
  execution_status text not null,
  before_snapshot jsonb,
  after_snapshot jsonb,
  error_message text,
  executed_by uuid default auth.uid(),
  executed_at timestamptz not null default now()
);

create index if not exists idx_inventory_sku_actions_sku on public.ecoflow_inventory_sku_actions(sku);
create index if not exists idx_inventory_sku_actions_executed_at on public.ecoflow_inventory_sku_actions(executed_at desc);

grant select, insert on public.ecoflow_inventory_sku_actions to authenticated;

create or replace function public.ecoflow_apply_inventory_sku_action(
  p_sku text,
  p_action text,
  p_value text default null,
  p_note text default null
)
returns table (
  action_id uuid,
  sku text,
  action text,
  execution_status text,
  executed_at timestamptz,
  error_message text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sku text := nullif(trim(coalesce(p_sku, '')), '');
  v_action text := upper(trim(coalesce(p_action, '')));
  v_value text := nullif(trim(coalesce(p_value, '')), '');
  v_before jsonb;
  v_after jsonb;
  v_status text := 'NOT_EXECUTED';
  v_error text;
  v_id uuid;
  v_product_name text;
begin
  if v_sku is null or v_sku = 'UNKNOWN' then
    raise exception 'valid SKU is required';
  end if;

  if v_action not in ('SET_FIXED_SHELF','SET_BARCODE','SET_REORDER_TARGET','SET_ON_HAND_ESTIMATE','SET_STATUS','SET_NOTE','MARK_REVIEWED') then
    raise exception 'unsupported inventory SKU action: %', p_action;
  end if;

  select product_name into v_product_name
  from public.v_ecoflow_owner_sku_velocity
  where sku = v_sku
  limit 1;

  insert into public.ecoflow_inventory_sku_controls (sku, product_name, updated_by, updated_at)
  values (v_sku, v_product_name, auth.uid(), now())
  on conflict (sku) do update set
    product_name = coalesce(public.ecoflow_inventory_sku_controls.product_name, excluded.product_name),
    updated_at = now();

  select to_jsonb(c) into v_before
  from public.ecoflow_inventory_sku_controls c
  where c.sku = v_sku;

  if v_action = 'SET_FIXED_SHELF' then
    if v_value is null then raise exception 'fixed shelf is required'; end if;
    update public.ecoflow_inventory_sku_controls c set fixed_shelf = v_value, updated_by = auth.uid(), updated_at = now() where c.sku = v_sku returning to_jsonb(c) into v_after;
    v_status := 'FIXED_SHELF_UPDATED';
  elsif v_action = 'SET_BARCODE' then
    if v_value is null then raise exception 'barcode is required'; end if;
    update public.ecoflow_inventory_sku_controls c set primary_barcode = v_value, updated_by = auth.uid(), updated_at = now() where c.sku = v_sku returning to_jsonb(c) into v_after;
    v_status := 'BARCODE_UPDATED';
  elsif v_action = 'SET_REORDER_TARGET' then
    if v_value is null or v_value !~ '^[0-9]+(\.[0-9]+)?$' then
      raise exception 'reorder target must be a number';
    end if;
    update public.ecoflow_inventory_sku_controls c set reorder_target = v_value::numeric, updated_by = auth.uid(), updated_at = now() where c.sku = v_sku returning to_jsonb(c) into v_after;
    v_status := 'REORDER_TARGET_UPDATED';
  elsif v_action = 'SET_ON_HAND_ESTIMATE' then
    if v_value is null or v_value !~ '^[0-9]+(\.[0-9]+)?$' then
      raise exception 'on hand estimate must be a number';
    end if;
    update public.ecoflow_inventory_sku_controls c set on_hand_estimate = v_value::numeric, updated_by = auth.uid(), updated_at = now() where c.sku = v_sku returning to_jsonb(c) into v_after;
    v_status := 'ON_HAND_ESTIMATE_UPDATED';
  elsif v_action = 'SET_STATUS' then
    if v_value not in ('ACTIVE','WATCH','HOLD','DISCONTINUED') then
      raise exception 'status must be ACTIVE, WATCH, HOLD or DISCONTINUED';
    end if;
    update public.ecoflow_inventory_sku_controls c set status = v_value, updated_by = auth.uid(), updated_at = now() where c.sku = v_sku returning to_jsonb(c) into v_after;
    v_status := 'STATUS_UPDATED';
  elsif v_action = 'SET_NOTE' then
    update public.ecoflow_inventory_sku_controls c set owner_note = v_value, updated_by = auth.uid(), updated_at = now() where c.sku = v_sku returning to_jsonb(c) into v_after;
    v_status := 'NOTE_UPDATED';
  else
    update public.ecoflow_inventory_sku_controls c set updated_by = auth.uid(), updated_at = now() where c.sku = v_sku returning to_jsonb(c) into v_after;
    v_status := 'SKU_REVIEWED';
  end if;

  insert into public.ecoflow_inventory_sku_actions (
    sku,
    action,
    action_value,
    action_note,
    execution_status,
    before_snapshot,
    after_snapshot,
    error_message,
    executed_by,
    executed_at
  ) values (
    v_sku,
    v_action,
    v_value,
    nullif(trim(coalesce(p_note, '')), ''),
    v_status,
    v_before,
    v_after,
    v_error,
    auth.uid(),
    now()
  ) returning id into v_id;

  return query
  select a.id, a.sku, a.action, a.execution_status, a.executed_at, a.error_message
  from public.ecoflow_inventory_sku_actions a
  where a.id = v_id;
end;
$$;

grant execute on function public.ecoflow_apply_inventory_sku_action(text, text, text, text) to authenticated;

drop view if exists public.v_ecoflow_inventory_sku_actions_latest cascade;
drop view if exists public.v_ecoflow_inventory_sku_control cascade;
drop view if exists public.v_ecoflow_inventory_kpis cascade;

create view public.v_ecoflow_inventory_sku_actions_latest as
select distinct on (sku)
  sku,
  action as latest_action,
  execution_status as latest_execution_status,
  action_value as latest_action_value,
  action_note as latest_action_note,
  executed_at as latest_action_at
from public.ecoflow_inventory_sku_actions
order by sku, executed_at desc;

grant select on public.v_ecoflow_inventory_sku_actions_latest to authenticated;

create view public.v_ecoflow_inventory_sku_control as
with velocity as (
  select
    sku,
    product_name,
    revenue_7d,
    revenue_30d,
    units_7d,
    units_30d,
    order_count_30d,
    avg_unit_price,
    last_sold_at,
    barcode_attention_lines,
    latest_barcode_status,
    warehouse_barcode,
    velocity_rank
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
  a.latest_action,
  a.latest_execution_status,
  a.latest_action_at,
  case
    when c.on_hand_estimate is null then 'NO_STOCK_LEDGER'
    when c.reorder_target is not null and c.on_hand_estimate <= c.reorder_target then 'BELOW_TARGET'
    when coalesce(r.high_reorder_stores, 0) > 0 then 'REORDER_PRESSURE'
    when coalesce(v.barcode_attention_lines, 0) > 0 then 'BARCODE_CLEANUP'
    when c.fixed_shelf is null or trim(c.fixed_shelf) = '' then 'NEEDS_SHELF'
    else 'CONTROLLED'
  end as inventory_signal,
  case
    when c.on_hand_estimate is null then 'Add live stock ledger or temporary stock estimate'
    when c.reorder_target is not null and c.on_hand_estimate <= c.reorder_target then 'Plan reorder or receiving check'
    when coalesce(r.high_reorder_stores, 0) > 0 then 'Review store/SKU reorder demand'
    when coalesce(v.barcode_attention_lines, 0) > 0 then 'Clean barcode mapping before warehouse release'
    when c.fixed_shelf is null or trim(c.fixed_shelf) = '' then 'Assign fixed shelf / rack'
    else 'Ready'
  end as action_hint,
  dense_rank() over (
    order by
      case
        when c.on_hand_estimate is null then 0
        when c.reorder_target is not null and c.on_hand_estimate <= c.reorder_target then 1
        when coalesce(r.high_reorder_stores, 0) > 0 then 2
        when coalesce(v.barcode_attention_lines, 0) > 0 then 3
        when c.fixed_shelf is null or trim(c.fixed_shelf) = '' then 4
        else 5
      end,
      coalesce(v.units_30d, 0) desc,
      coalesce(v.revenue_30d, 0) desc
  ) as inventory_rank
from velocity v
left join public.ecoflow_inventory_sku_controls c on c.sku = v.sku
left join reorder_store_pressure r on r.sku = v.sku
left join public.v_ecoflow_inventory_sku_actions_latest a on a.sku = v.sku
order by inventory_rank asc;

grant select on public.v_ecoflow_inventory_sku_control to authenticated;

create view public.v_ecoflow_inventory_kpis as
select
  count(*)::numeric as sku_count,
  count(*) filter (where inventory_signal = 'NO_STOCK_LEDGER')::numeric as no_stock_ledger_skus,
  count(*) filter (where inventory_signal = 'BELOW_TARGET')::numeric as below_target_skus,
  count(*) filter (where inventory_signal = 'REORDER_PRESSURE')::numeric as reorder_pressure_skus,
  count(*) filter (where inventory_signal = 'BARCODE_CLEANUP')::numeric as barcode_cleanup_skus,
  count(*) filter (where inventory_signal = 'NEEDS_SHELF')::numeric as needs_shelf_skus,
  coalesce(sum(units_30d), 0)::numeric as units_30d,
  coalesce(sum(revenue_30d), 0)::numeric as revenue_30d,
  (array_agg(sku order by units_30d desc nulls last))[1] as top_sku_30d,
  (array_agg(product_name order by units_30d desc nulls last))[1] as top_product_30d,
  max(last_sold_at) as latest_sku_sale_at
from public.v_ecoflow_inventory_sku_control;

grant select on public.v_ecoflow_inventory_kpis to authenticated;

notify pgrst, 'reload schema';
