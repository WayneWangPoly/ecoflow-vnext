-- EcoFlow / Ordermentum mapping and internal draft layer
-- Safe migration: creates helper tables, views and functions only.
-- It does not delete Ordermentum raw data and does not create warehouse pick waves.

begin;

create table if not exists public.ordermentum_mapping_actions (
  id uuid primary key default gen_random_uuid(),
  action_type text not null,
  entity_type text not null,
  external_key text not null,
  internal_id uuid,
  action_payload jsonb not null default '{}'::jsonb,
  created_by text not null default 'system',
  created_at timestamptz not null default now()
);

create index if not exists idx_ordermentum_mapping_actions_entity
  on public.ordermentum_mapping_actions(entity_type, external_key, created_at desc);

create or replace function public.ecoflow_safe_sku_code(
  p_external_sku_code text,
  p_product_name text default null
)
returns text
language plpgsql
as $$
declare
  base_code text;
  candidate text;
  suffix integer := 1;
begin
  base_code := upper(regexp_replace(coalesce(nullif(trim(p_external_sku_code), ''), left(md5(coalesce(p_product_name, 'ordermentum-sku')), 10)), '[^A-Za-z0-9]+', '-', 'g'));
  base_code := trim(both '-' from base_code);

  if base_code is null or base_code = '' then
    base_code := 'OM-' || upper(left(md5(random()::text), 8));
  end if;

  if length(base_code) > 48 then
    base_code := left(base_code, 48);
  end if;

  candidate := base_code;

  while exists (select 1 from public.skus where sku_code = candidate) loop
    suffix := suffix + 1;
    candidate := left(base_code, 44) || '-' || suffix::text;
  end loop;

  return candidate;
end;
$$;

create or replace function public.ecoflow_map_ordermentum_sku(
  p_external_sku_code text,
  p_internal_sku_id uuid default null,
  p_sku_code text default null,
  p_display_name text default null,
  p_category text default 'Ordermentum imported',
  p_default_unit_level text default 'sleeve',
  p_confidence text default 'AUTO_CREATED',
  p_created_by text default 'system'
)
returns table (
  internal_sku_id uuid,
  sku_code text,
  mapping_id uuid,
  action_taken text
)
language plpgsql
as $$
declare
  v_candidate_name text;
  v_sku_id uuid;
  v_sku_code text;
  v_mapping_id uuid;
begin
  if p_external_sku_code is null or trim(p_external_sku_code) = '' then
    raise exception 'p_external_sku_code is required';
  end if;

  select external_product_name
    into v_candidate_name
  from public.v_ecoflow_ordermentum_sku_mapping_workbench
  where external_sku_code = p_external_sku_code
  order by order_count desc nulls last, line_count desc nulls last
  limit 1;

  if p_internal_sku_id is not null then
    select id, skus.sku_code
      into v_sku_id, v_sku_code
    from public.skus
    where id = p_internal_sku_id;

    if v_sku_id is null then
      raise exception 'Internal SKU % was not found', p_internal_sku_id;
    end if;
  else
    v_sku_code := coalesce(nullif(trim(p_sku_code), ''), public.ecoflow_safe_sku_code(p_external_sku_code, coalesce(p_display_name, v_candidate_name)));

    insert into public.skus (
      sku_code,
      display_name,
      category,
      can_sell_by_carton,
      can_sell_by_sleeve,
      default_storage_unit,
      default_pick_unit,
      can_mix_pack,
      setup_status
    )
    values (
      v_sku_code,
      coalesce(nullif(trim(p_display_name), ''), nullif(trim(v_candidate_name), ''), p_external_sku_code),
      p_category,
      true,
      true,
      'carton',
      coalesce(nullif(trim(p_default_unit_level), ''), 'sleeve'),
      true,
      'mapping_draft'
    )
    returning id into v_sku_id;

    insert into public.sku_units (
      sku_id,
      unit_level,
      quantity_in_base_unit,
      is_default_receiving_unit,
      is_default_picking_unit
    )
    values (
      v_sku_id,
      coalesce(nullif(trim(p_default_unit_level), ''), 'sleeve'),
      1,
      true,
      true
    )
    on conflict (sku_id, unit_level) do nothing;
  end if;

  insert into public.external_product_mappings (
    provider,
    external_product_code,
    internal_sku_id,
    default_unit_level,
    confidence,
    is_active
  )
  values (
    'ORDERMENTUM',
    p_external_sku_code,
    v_sku_id,
    coalesce(nullif(trim(p_default_unit_level), ''), 'sleeve'),
    p_confidence,
    true
  )
  on conflict (provider, external_product_code)
  do update set
    internal_sku_id = excluded.internal_sku_id,
    default_unit_level = excluded.default_unit_level,
    confidence = excluded.confidence,
    is_active = true,
    updated_at = now()
  returning id into v_mapping_id;

  insert into public.ordermentum_mapping_actions (
    action_type,
    entity_type,
    external_key,
    internal_id,
    action_payload,
    created_by
  )
  values (
    case when p_internal_sku_id is null then 'CREATE_SKU_AND_MAP' else 'MAP_TO_EXISTING_SKU' end,
    'SKU',
    p_external_sku_code,
    v_sku_id,
    jsonb_build_object(
      'external_sku_code', p_external_sku_code,
      'sku_code', v_sku_code,
      'display_name', coalesce(nullif(trim(p_display_name), ''), nullif(trim(v_candidate_name), ''), p_external_sku_code),
      'confidence', p_confidence,
      'default_unit_level', coalesce(nullif(trim(p_default_unit_level), ''), 'sleeve')
    ),
    p_created_by
  );

  return query select
    v_sku_id,
    v_sku_code,
    v_mapping_id,
    case when p_internal_sku_id is null then 'CREATE_SKU_AND_MAP' else 'MAP_TO_EXISTING_SKU' end;
end;
$$;

create or replace function public.ecoflow_bulk_map_ordermentum_skus(
  p_limit integer default 25,
  p_created_by text default 'system-bulk'
)
returns table (
  external_sku_code text,
  internal_sku_id uuid,
  sku_code text,
  mapping_id uuid,
  action_taken text
)
language plpgsql
as $$
declare
  r record;
  mapped record;
  limit_value integer := greatest(coalesce(p_limit, 25), 0);
begin
  for r in
    select external_sku_code, external_product_name
    from public.v_ecoflow_ordermentum_sku_mapping_workbench
    where mapping_status = 'UNMAPPED'
      and external_sku_code is not null
      and trim(external_sku_code) <> ''
    order by priority_rank asc nulls last, order_count desc nulls last, line_count desc nulls last
    limit limit_value
  loop
    for mapped in
      select *
      from public.ecoflow_map_ordermentum_sku(
        r.external_sku_code,
        null,
        null,
        r.external_product_name,
        'Ordermentum imported',
        'sleeve',
        'AUTO_CREATED',
        p_created_by
      )
    loop
      external_sku_code := r.external_sku_code;
      internal_sku_id := mapped.internal_sku_id;
      sku_code := mapped.sku_code;
      mapping_id := mapped.mapping_id;
      action_taken := mapped.action_taken;
      return next;
    end loop;
  end loop;
end;
$$;

drop view if exists public.v_ecoflow_ordermentum_sku_setup_queue cascade;
create view public.v_ecoflow_ordermentum_sku_setup_queue as
select
  w.priority_rank,
  w.external_sku_code,
  w.external_product_name,
  w.order_count,
  w.line_count,
  w.total_required_quantity,
  w.total_sales_value,
  w.mapping_status,
  w.required_action,
  m.internal_sku_id,
  s.sku_code as internal_sku_code,
  s.display_name as internal_sku_name,
  s.setup_status as internal_setup_status,
  case
    when m.internal_sku_id is not null then 'MAPPED'
    when w.external_sku_code is null or trim(w.external_sku_code) = '' then 'NEEDS_EXTERNAL_CODE'
    else 'CREATE_OR_MAP_SKU'
  end as setup_action
from public.v_ecoflow_ordermentum_sku_mapping_workbench w
left join public.external_product_mappings m
  on m.provider = 'ORDERMENTUM'
 and m.external_product_code = w.external_sku_code
 and m.is_active = true
left join public.skus s
  on s.id = m.internal_sku_id;

drop view if exists public.v_ecoflow_ordermentum_mapping_progress cascade;
create view public.v_ecoflow_ordermentum_mapping_progress as
select
  count(*)::bigint as sku_candidates,
  count(*) filter (where mapping_status = 'MAPPED')::bigint as mapped_sku_candidates,
  count(*) filter (where mapping_status <> 'MAPPED')::bigint as unmapped_sku_candidates,
  coalesce(sum(order_count) filter (where mapping_status = 'MAPPED'), 0)::bigint as mapped_order_touchpoints,
  coalesce(sum(order_count) filter (where mapping_status <> 'MAPPED'), 0)::bigint as unmapped_order_touchpoints,
  coalesce(sum(total_sales_value) filter (where mapping_status = 'MAPPED'), 0)::numeric(12,4) as mapped_sales_value,
  coalesce(sum(total_sales_value) filter (where mapping_status <> 'MAPPED'), 0)::numeric(12,4) as unmapped_sales_value,
  (select blocked_mapping from public.v_ecoflow_ordermentum_release_summary_v2)::bigint as blocked_mapping_orders,
  (select ready_to_internalise from public.v_ecoflow_ordermentum_release_summary_v2)::bigint as ready_to_internalise_orders,
  now() as checked_at
from public.v_ecoflow_ordermentum_sku_mapping_workbench;

drop view if exists public.v_ecoflow_ordermentum_internal_order_drafts_v2 cascade;
create view public.v_ecoflow_ordermentum_internal_order_drafts_v2 as
select
  g.raw_order_id,
  g.external_order_id,
  g.order_number as external_order_number,
  g.invoice_number as external_invoice_number,
  g.release_gate_status,
  g.payment_status,
  g.invoice_total,
  g.total_due,
  g.updated_business_day,
  l.source_line_id,
  l.external_sku_code,
  l.external_product_name,
  l.quantity,
  l.unit,
  l.total as line_total,
  m.internal_sku_id,
  s.sku_code as internal_sku_code,
  s.display_name as internal_sku_name,
  case
    when g.release_gate_status = 'READY_TO_INTERNALISE' then 'CREATE_INTERNAL_ORDER'
    when g.release_gate_status = 'REVIEW_PAYMENT' then 'ACCOUNT_REVIEW_REQUIRED'
    when g.release_gate_status = 'BLOCKED_MAPPING' then 'SKU_MAPPING_REQUIRED'
    when g.release_gate_status = 'BLOCKED_DATA' then 'DATA_REPAIR_REQUIRED'
    else g.release_gate_status
  end as draft_action
from public.v_ecoflow_ordermentum_release_gate_v2 g
left join public.v_ecoflow_ordermentum_order_lines l
  on l.invoice_number = g.invoice_number
left join public.external_product_mappings m
  on m.provider = 'ORDERMENTUM'
 and m.external_product_code = l.external_sku_code
 and m.is_active = true
left join public.skus s
  on s.id = m.internal_sku_id;

drop view if exists public.v_ecoflow_ordermentum_order_readiness_board cascade;
create view public.v_ecoflow_ordermentum_order_readiness_board as
select
  g.release_gate_status,
  count(*)::bigint as order_count,
  coalesce(sum(g.invoice_total), 0)::numeric(12,4) as invoice_total,
  coalesce(sum(g.total_due), 0)::numeric(12,4) as total_due,
  min(g.order_updated_at) as oldest_update,
  max(g.order_updated_at) as newest_update
from public.v_ecoflow_ordermentum_release_gate_v2 g
group by g.release_gate_status;

commit;
