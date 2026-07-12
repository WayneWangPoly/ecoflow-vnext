-- Repair two production projection gaps:
-- 1) Ordermentum uses an uppercase `SKU` property, so the complete catalog view
--    previously projected zero rows even though 354 products and 354 variants
--    were present in the raw master archive.
-- 2) browser reads must use authenticated active-workflow views. Historical raw
--    exception views remain available for audit, but are not the operational queue.

begin;

create or replace view public.v_ecoflow_synced_sku_catalog
as
with source_rows as (
  select
    coalesce(
      nullif(trim(s.external_sku_code),''),
      nullif(trim(s.raw_payload->>'SKU'),''),
      nullif(trim(s.raw_payload->>'sku'),''),
      nullif(trim(s.raw_payload->>'variantSku'),''),
      nullif(trim(s.raw_payload->>'variant_sku'),''),
      nullif(trim(s.raw_payload->>'externalSkuCode'),''),
      nullif(trim(s.raw_payload->>'itemCode'),''),
      nullif(trim(s.raw_payload->>'code'),'')
    ) as sku,
    coalesce(
      nullif(trim(s.external_variant_name),''),
      nullif(trim(s.external_product_name),''),
      nullif(trim(s.raw_payload->>'name'),''),
      nullif(trim(s.raw_payload->>'productName'),''),
      nullif(trim(s.raw_payload->>'variantName'),'')
    ) as product_name,
    coalesce(
      s.base_price,
      case
        when coalesce(s.raw_payload->>'basePrice',s.raw_payload->>'price',s.raw_payload->>'unitPrice') ~ '^-?[0-9]+(\.[0-9]+)?$'
        then coalesce(s.raw_payload->>'basePrice',s.raw_payload->>'price',s.raw_payload->>'unitPrice')::numeric
        else null
      end
    ) as base_price,
    coalesce(nullif(trim(s.source_type),''),'product') as source_type,
    s.last_synced_at,
    row_number() over (
      partition by upper(coalesce(
        nullif(trim(s.external_sku_code),''),
        nullif(trim(s.raw_payload->>'SKU'),''),
        nullif(trim(s.raw_payload->>'sku'),''),
        nullif(trim(s.raw_payload->>'variantSku'),''),
        nullif(trim(s.raw_payload->>'variant_sku'),''),
        nullif(trim(s.raw_payload->>'externalSkuCode'),''),
        nullif(trim(s.raw_payload->>'itemCode'),''),
        nullif(trim(s.raw_payload->>'code'),'')
      ))
      order by
        case when lower(coalesce(s.source_type,''))='variant' then 0 else 1 end,
        s.last_synced_at desc nulls last,
        case when s.base_price is not null then 0 else 1 end,
        case when coalesce(s.external_variant_name,s.external_product_name,s.raw_payload->>'name') is not null then 0 else 1 end
    ) as rn
  from public.v_ecoflow_ordermentum_sku_master_v1 s
), ranked as (
  select * from source_rows where sku is not null
)
select
  sku,
  coalesce(product_name,'Product name pending') as product_name,
  base_price,
  source_type,
  last_synced_at
from ranked
where rn=1;

grant select on public.v_ecoflow_synced_sku_catalog to authenticated;
revoke all on public.v_ecoflow_synced_sku_catalog from anon;

create or replace view public.v_ecoflow_master_projection_health
as
select
  (select count(*) from public.ordermentum_raw_master_resources where resource_type='products' and coalesce(is_deleted_or_missing,false)=false)::numeric as raw_products,
  (select count(*) from public.ordermentum_raw_master_resources where resource_type='variants' and coalesce(is_deleted_or_missing,false)=false)::numeric as raw_variants,
  (select count(*) from public.v_ecoflow_synced_sku_catalog)::numeric as projected_skus,
  (select count(*) from public.v_ecoflow_synced_price_groups)::numeric as projected_price_groups,
  (select max(coalesce(last_synced_at,last_seen_at)) from public.ordermentum_raw_master_resources where resource_type in ('products','variants')) as latest_sku_master_sync_at,
  (select max(coalesce(last_synced_at,last_seen_at)) from public.ordermentum_raw_master_resources where resource_type='price_groups') as latest_price_group_sync_at;

grant select on public.v_ecoflow_master_projection_health to authenticated;
revoke all on public.v_ecoflow_master_projection_health from anon;

-- Some earlier active views existed in production but had not been granted to
-- authenticated application sessions. Grant only when a view exists so this
-- migration stays compatible with clean schema fixtures and staged rollouts.
do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'v_ecoflow_ordermentum_ui_active_inbox',
    'v_ecoflow_ordermentum_ui_active_exceptions',
    'v_ecoflow_ordermentum_ui_active_order_lines',
    'v_ecoflow_ordermentum_ui_active_drafts',
    'v_ecoflow_ordermentum_ui_active_om_orders',
    'v_ecoflow_ordermentum_sync_health',
    'v_ecoflow_ordermentum_release_summary_v2',
    'v_ecoflow_ordermentum_sku_mapping_candidates',
    'v_ecoflow_ordermentum_sku_master_v1',
    'v_ecoflow_app_sku_master',
    'v_ecoflow_inventory_sku_control',
    'v_ecoflow_inventory_sku_location_balance',
    'v_ecoflow_barcode_registry_review'
  ]
  loop
    if to_regclass('public.' || relation_name) is not null then
      execute format('grant select on public.%I to authenticated', relation_name);
    end if;
  end loop;
end $$;

notify pgrst,'reload schema';
commit;
