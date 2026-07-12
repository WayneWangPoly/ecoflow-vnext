-- Complete Ordermentum master projections for pricing and Inventory.
-- Raw master resources are the durable source refreshed by stores_only / sku_only.

begin;

-- These narrow master views intentionally run with the view owner's privileges.
-- Authenticated app users can read the projected catalog columns without being
-- granted access to the raw Ordermentum payload archive itself.
create or replace view public.v_ecoflow_synced_price_groups
as
with canonical as (
  select distinct
    coalesce(
      nullif(trim(to_jsonb(pg)->>'price_group_id'),''),
      nullif(trim(to_jsonb(pg)->>'external_price_group_id'),'')
    ) as price_group_id,
    coalesce(
      nullif(trim(to_jsonb(pg)->>'price_group_name'),''),
      nullif(trim(to_jsonb(pg)->>'name'),''),
      coalesce(
        nullif(trim(to_jsonb(pg)->>'price_group_id'),''),
        nullif(trim(to_jsonb(pg)->>'external_price_group_id'),'')
      )
    ) as price_group_name,
    null::timestamptz as last_synced_at,
    'CANONICAL_VIEW'::text as source
  from public.v_ecoflow_ordermentum_price_groups_v1 pg
), raw_ranked as (
  select
    coalesce(
      nullif(trim(r.payload->>'priceGroupId'),''),
      nullif(trim(r.payload->>'price_group_id'),''),
      nullif(trim(r.payload->>'externalPriceGroupId'),''),
      nullif(trim(r.payload->>'id'),''),
      nullif(trim(r.payload#>>'{priceGroup,id}'),''),
      nullif(trim(r.external_id),'')
    ) as price_group_id,
    coalesce(
      nullif(trim(r.payload->>'priceGroupName'),''),
      nullif(trim(r.payload->>'price_group_name'),''),
      nullif(trim(r.payload->>'name'),''),
      nullif(trim(r.payload#>>'{priceGroup,name}'),'')
    ) as price_group_name,
    coalesce(r.last_synced_at,r.last_seen_at) as last_synced_at,
    row_number() over (
      partition by coalesce(
        nullif(trim(r.payload->>'priceGroupId'),''),
        nullif(trim(r.payload->>'price_group_id'),''),
        nullif(trim(r.payload->>'externalPriceGroupId'),''),
        nullif(trim(r.payload->>'id'),''),
        nullif(trim(r.payload#>>'{priceGroup,id}'),''),
        nullif(trim(r.external_id),'')
      )
      order by coalesce(r.last_synced_at,r.last_seen_at) desc nulls last
    ) as rn
  from public.ordermentum_raw_master_resources r
  where r.resource_type in ('price_groups','price_group_detail')
    and coalesce(r.is_deleted_or_missing,false) is false
), combined as (
  select price_group_id,price_group_name,last_synced_at,source from canonical
  where price_group_id is not null
  union all
  select price_group_id,coalesce(price_group_name,price_group_id),last_synced_at,'RAW_MASTER'
  from raw_ranked where rn=1 and price_group_id is not null
)
select distinct on (price_group_id)
  price_group_id,
  coalesce(price_group_name,price_group_id) as price_group_name,
  last_synced_at,
  source
from combined
order by price_group_id, case when source='RAW_MASTER' then 0 else 1 end, last_synced_at desc nulls last;

grant select on public.v_ecoflow_synced_price_groups to authenticated;
revoke all on public.v_ecoflow_synced_price_groups from anon;

create or replace view public.v_ecoflow_synced_sku_catalog
as
with canonical as (
  select
    nullif(trim(s.external_sku_code),'') as sku,
    nullif(trim(s.external_product_name),'') as product_name,
    s.base_price::numeric as base_price,
    s.source_type::text as source_type,
    s.last_synced_at,
    0 as source_priority
  from public.v_ecoflow_ordermentum_sku_master_v1 s
  where nullif(trim(s.external_sku_code),'') is not null
), raw_rows as (
  select
    coalesce(
      nullif(trim(r.payload->>'sku'),''),
      nullif(trim(r.payload->>'variantSku'),''),
      nullif(trim(r.payload->>'variant_sku'),''),
      nullif(trim(r.payload->>'externalSkuCode'),''),
      nullif(trim(r.payload->>'itemCode'),''),
      nullif(trim(r.payload->>'code'),''),
      nullif(trim(r.payload#>>'{variant,sku}'),''),
      nullif(trim(r.payload#>>'{product,sku}'),'')
    ) as sku,
    coalesce(
      nullif(trim(r.payload->>'productName'),''),
      nullif(trim(r.payload->>'variantName'),''),
      nullif(trim(r.payload->>'name'),''),
      nullif(trim(r.payload->>'title'),''),
      nullif(trim(r.payload#>>'{product,name}'),''),
      nullif(trim(r.payload#>>'{variant,name}'),'')
    ) as product_name,
    case
      when coalesce(r.payload->>'basePrice',r.payload->>'base_price',r.payload->>'unitPrice',r.payload->>'price',r.payload#>>'{price,amount}') ~ '^-?[0-9]+(\.[0-9]+)?$'
      then coalesce(r.payload->>'basePrice',r.payload->>'base_price',r.payload->>'unitPrice',r.payload->>'price',r.payload#>>'{price,amount}')::numeric
      else null
    end as base_price,
    case when r.resource_type like 'variant%' then 'variant' else 'product' end as source_type,
    coalesce(r.last_synced_at,r.last_seen_at) as last_synced_at,
    case when r.resource_type like 'variant%' then 1 else 2 end as source_priority
  from public.ordermentum_raw_master_resources r
  where r.resource_type in ('products','product_detail','variants','variant_detail')
    and coalesce(r.is_deleted_or_missing,false) is false
), combined as (
  select * from canonical
  union all
  select * from raw_rows where sku is not null
), ranked as (
  select *, row_number() over (
    partition by sku
    order by source_priority asc, last_synced_at desc nulls last,
             case when product_name is not null then 0 else 1 end,
             case when base_price is not null then 0 else 1 end
  ) as rn
  from combined
)
select sku,product_name,base_price,source_type,last_synced_at
from ranked where rn=1;

grant select on public.v_ecoflow_synced_sku_catalog to authenticated;
revoke all on public.v_ecoflow_synced_sku_catalog from anon;

create or replace view public.v_ecoflow_price_matrix_workbench
with (security_invoker=true)
as
with current_matrix as (
  select * from public.ecoflow_price_matrix_versions where is_current
)
select
  s.sku,
  s.product_name,
  g.price_group_id,
  g.price_group_name,
  coalesce(m.unit_price,s.base_price,0)::numeric(14,4) as effective_price,
  s.base_price::numeric(14,4) as source_base_price,
  (m.id is not null) as has_override,
  m.id as matrix_version_id,
  m.version_no,
  m.effective_from,
  m.change_reason,
  m.created_by,
  m.created_at,
  s.last_synced_at as sku_last_synced_at
from public.v_ecoflow_synced_sku_catalog s
cross join public.v_ecoflow_synced_price_groups g
left join current_matrix m on m.sku=s.sku and m.price_group_id=g.price_group_id;

grant select on public.v_ecoflow_price_matrix_workbench to authenticated;

-- Recreate rather than replace the Inventory projections because production has
-- older compatible views whose historical column order must not block release.
drop view if exists public.v_ecoflow_inventory_kpis;
drop view if exists public.v_ecoflow_inventory_sku_control;

create view public.v_ecoflow_inventory_sku_control
as
with master as (
  select sku,product_name from public.v_ecoflow_synced_sku_catalog
), velocity as (
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
  m.sku,
  coalesce(c.product_name,m.product_name,v.product_name,'Unknown product') as product_name,
  c.category,
  c.fixed_shelf,
  coalesce(c.primary_barcode,v.warehouse_barcode) as primary_barcode,
  c.reorder_target,
  c.on_hand_estimate,
  b.on_hand_live,
  case when b.movement_count is not null then 'LIVE_LEDGER' else 'TEMP_ESTIMATE' end as stock_source,
  coalesce(b.on_hand_live,c.on_hand_estimate) as effective_on_hand,
  coalesce(c.status,'ACTIVE') as control_status,
  c.owner_note,
  coalesce(v.revenue_7d,0)::numeric as revenue_7d,
  coalesce(v.revenue_30d,0)::numeric as revenue_30d,
  coalesce(v.units_7d,0)::numeric as units_7d,
  coalesce(v.units_30d,0)::numeric as units_30d,
  coalesce(v.order_count_30d,0)::numeric as order_count_30d,
  coalesce(v.avg_unit_price,0)::numeric as avg_unit_price,
  v.last_sold_at,
  coalesce(v.barcode_attention_lines,0)::numeric as barcode_attention_lines,
  v.latest_barcode_status,
  coalesce(r.high_reorder_stores,0)::numeric as high_reorder_stores,
  coalesce(r.watch_reorder_stores,0)::numeric as watch_reorder_stores,
  r.latest_store_reorder_at,
  b.movement_count,
  b.latest_movement_at,
  a.latest_action,
  a.latest_execution_status,
  a.latest_action_at,
  case
    when b.movement_count is null and c.on_hand_estimate is null then 'NO_STOCK_LEDGER'
    when coalesce(b.on_hand_live,c.on_hand_estimate) < 0 then 'NEGATIVE_STOCK'
    when c.reorder_target is not null and coalesce(b.on_hand_live,c.on_hand_estimate) <= c.reorder_target then 'BELOW_TARGET'
    when coalesce(r.high_reorder_stores,0) > 0 then 'REORDER_PRESSURE'
    when coalesce(v.barcode_attention_lines,0) > 0 then 'BARCODE_CLEANUP'
    when c.fixed_shelf is null or trim(c.fixed_shelf)='' then 'NEEDS_SHELF'
    else 'CONTROLLED'
  end as inventory_signal,
  case
    when b.movement_count is null and c.on_hand_estimate is null then 'Receive stock or add a temporary stock estimate'
    when coalesce(b.on_hand_live,c.on_hand_estimate) < 0 then 'Investigate negative stock before release'
    when c.reorder_target is not null and coalesce(b.on_hand_live,c.on_hand_estimate) <= c.reorder_target then 'Plan reorder or receiving check'
    when coalesce(r.high_reorder_stores,0) > 0 then 'Review store/SKU reorder demand'
    when coalesce(v.barcode_attention_lines,0) > 0 then 'Clean barcode mapping before warehouse release'
    when c.fixed_shelf is null or trim(c.fixed_shelf)='' then 'Assign fixed shelf / rack'
    else 'Ready'
  end as action_hint,
  dense_rank() over (
    order by
      case
        when b.movement_count is null and c.on_hand_estimate is null then 0
        when coalesce(b.on_hand_live,c.on_hand_estimate) < 0 then 1
        when c.reorder_target is not null and coalesce(b.on_hand_live,c.on_hand_estimate) <= c.reorder_target then 2
        when coalesce(r.high_reorder_stores,0) > 0 then 3
        when coalesce(v.barcode_attention_lines,0) > 0 then 4
        when c.fixed_shelf is null or trim(c.fixed_shelf)='' then 5
        else 6
      end,
      coalesce(v.units_30d,0) desc,
      m.sku asc
  ) as inventory_rank
from master m
left join velocity v on v.sku=m.sku
left join public.ecoflow_inventory_sku_controls c on c.sku=m.sku
left join public.v_ecoflow_inventory_sku_balance b on b.sku=m.sku
left join reorder_store_pressure r on r.sku=m.sku
left join public.v_ecoflow_inventory_sku_actions_latest a on a.sku=m.sku
order by inventory_rank asc,m.sku asc;

grant select on public.v_ecoflow_inventory_sku_control to authenticated;

create view public.v_ecoflow_inventory_kpis
as
select
  count(*)::numeric as sku_count,
  count(*) filter (where inventory_signal='NO_STOCK_LEDGER')::numeric as no_stock_ledger_skus,
  count(*) filter (where inventory_signal='NEGATIVE_STOCK')::numeric as negative_stock_skus,
  count(*) filter (where inventory_signal='BELOW_TARGET')::numeric as below_target_skus,
  count(*) filter (where inventory_signal='REORDER_PRESSURE')::numeric as reorder_pressure_skus,
  count(*) filter (where inventory_signal='BARCODE_CLEANUP')::numeric as barcode_cleanup_skus,
  count(*) filter (where inventory_signal='NEEDS_SHELF')::numeric as needs_shelf_skus,
  coalesce(sum(units_30d),0)::numeric as units_30d,
  coalesce(sum(revenue_30d),0)::numeric as revenue_30d,
  coalesce(sum(effective_on_hand) filter (where stock_source='LIVE_LEDGER'),0)::numeric as live_on_hand_units,
  count(*) filter (where stock_source='LIVE_LEDGER')::numeric as live_ledger_skus,
  (array_agg(sku order by units_30d desc nulls last,sku))[1] as top_sku_30d,
  (array_agg(product_name order by units_30d desc nulls last,sku))[1] as top_product_30d,
  max(greatest(coalesce(last_sold_at,'1970-01-01'::timestamptz),coalesce(latest_movement_at,'1970-01-01'::timestamptz))) as latest_sku_activity_at
from public.v_ecoflow_inventory_sku_control;

grant select on public.v_ecoflow_inventory_kpis to authenticated;

notify pgrst,'reload schema';
commit;
