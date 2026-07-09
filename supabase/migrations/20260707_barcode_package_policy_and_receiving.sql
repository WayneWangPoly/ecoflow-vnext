-- SKU package policy + receive by barcode.
-- This fixes the real warehouse case: some SKUs need carton + sleeve barcodes,
-- some are carton-only, and some are each-only chemicals with no carton/sleeve workflow.

create table if not exists public.ecoflow_sku_package_policies (
  sku text primary key,
  product_name text,
  package_mode text not null default 'UNKNOWN' check (package_mode in (
    'CARTON_AND_SLEEVE',
    'CARTON_ONLY',
    'SLEEVE_ONLY',
    'EACH_ONLY',
    'INNER_ONLY',
    'UNKNOWN'
  )),
  default_units_per_carton numeric,
  default_units_per_sleeve numeric,
  default_units_per_each numeric,
  default_shelf text,
  policy_note text,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sku_package_policies_mode on public.ecoflow_sku_package_policies(package_mode);

grant select, insert, update on public.ecoflow_sku_package_policies to authenticated;

create or replace function public.ecoflow_set_sku_package_policy(
  p_sku text,
  p_package_mode text,
  p_default_shelf text default null,
  p_note text default null
)
returns table (
  sku text,
  package_mode text,
  default_shelf text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sku text := upper(nullif(trim(coalesce(p_sku, '')), ''));
  v_mode text := upper(trim(coalesce(p_package_mode, 'UNKNOWN')));
  v_product_name text;
begin
  if v_sku is null or v_sku = 'UNKNOWN' then raise exception 'valid SKU is required'; end if;
  if v_mode not in ('CARTON_AND_SLEEVE','CARTON_ONLY','SLEEVE_ONLY','EACH_ONLY','INNER_ONLY','UNKNOWN') then
    raise exception 'invalid package mode: %', p_package_mode;
  end if;

  select product_name into v_product_name from public.v_ecoflow_owner_sku_velocity where sku = v_sku limit 1;

  insert into public.ecoflow_sku_package_policies (
    sku,
    product_name,
    package_mode,
    default_shelf,
    policy_note,
    updated_by,
    updated_at
  ) values (
    v_sku,
    v_product_name,
    v_mode,
    nullif(trim(coalesce(p_default_shelf, '')), ''),
    nullif(trim(coalesce(p_note, '')), ''),
    auth.uid(),
    now()
  )
  on conflict (sku) do update set
    product_name = coalesce(public.ecoflow_sku_package_policies.product_name, excluded.product_name),
    package_mode = excluded.package_mode,
    default_shelf = coalesce(excluded.default_shelf, public.ecoflow_sku_package_policies.default_shelf),
    policy_note = coalesce(excluded.policy_note, public.ecoflow_sku_package_policies.policy_note),
    updated_by = auth.uid(),
    updated_at = now();

  return query
  select p.sku, p.package_mode, p.default_shelf, p.updated_at
  from public.ecoflow_sku_package_policies p
  where p.sku = v_sku;
end;
$$;

grant execute on function public.ecoflow_set_sku_package_policy(text, text, text, text) to authenticated;

create or replace function public.ecoflow_receive_by_barcode(
  p_barcode text,
  p_qty_packages numeric default 1,
  p_to_location text default null,
  p_note text default null
)
returns table (
  movement_id uuid,
  sku text,
  barcode text,
  package_level text,
  packages numeric,
  units_received numeric,
  to_location text,
  moved_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_barcode text := nullif(trim(coalesce(p_barcode, '')), '');
  v_packages numeric := greatest(coalesce(p_qty_packages, 1), 1);
  v_registry public.ecoflow_sku_barcode_registry%rowtype;
  v_units numeric;
  v_location text;
  v_id uuid;
begin
  if v_barcode is null then raise exception 'barcode is required'; end if;

  select * into v_registry
  from public.ecoflow_sku_barcode_registry
  where barcode = v_barcode
  order by last_scanned_at desc
  limit 1;

  if v_registry.id is null then
    raise exception 'barcode is not mapped yet: %', v_barcode;
  end if;

  v_units := v_packages * greatest(coalesce(v_registry.units_per_barcode, 1), 1);
  v_location := coalesce(nullif(trim(coalesce(p_to_location, '')), ''), nullif(trim(coalesce(v_registry.fixed_shelf, '')), ''), 'RECEIVING');

  insert into public.ecoflow_inventory_movements(
    sku,
    product_name,
    movement_type,
    quantity,
    to_location,
    reference_type,
    reference_id,
    action_note,
    source,
    moved_by,
    moved_at
  ) values (
    v_registry.sku,
    v_registry.product_name,
    'RECEIVE',
    v_units,
    v_location,
    'BARCODE_RECEIVE',
    v_barcode,
    nullif(trim(coalesce(p_note, '')), ''),
    'BARCODE_RECEIVING',
    auth.uid(),
    now()
  ) returning id into v_id;

  update public.ecoflow_sku_barcode_registry
  set scan_count = scan_count + 1,
      last_scanned_at = now()
  where id = v_registry.id;

  insert into public.ecoflow_barcode_scan_events(
    session_id,
    sku,
    barcode,
    package_level,
    units_per_barcode,
    product_name,
    shelf,
    qty_observed,
    action_mode,
    scan_status,
    movement_id,
    scan_note,
    scanned_by,
    scanned_at
  ) values (
    v_registry.source_session_id,
    v_registry.sku,
    v_barcode,
    v_registry.package_level,
    v_registry.units_per_barcode,
    v_registry.product_name,
    v_location,
    v_packages,
    'MAP_AND_RECEIVE',
    'RECEIVED_BY_BARCODE',
    v_id,
    nullif(trim(coalesce(p_note, '')), ''),
    auth.uid(),
    now()
  );

  return query
  select v_id, v_registry.sku, v_barcode, v_registry.package_level, v_packages, v_units, v_location, now();
end;
$$;

grant execute on function public.ecoflow_receive_by_barcode(text, numeric, text, text) to authenticated;

-- Recreate review/KPI views with package policy awareness.
drop view if exists public.v_ecoflow_barcode_sprint_kpis cascade;
drop view if exists public.v_ecoflow_barcode_registry_review cascade;

create view public.v_ecoflow_barcode_registry_review as
with registry as (
  select
    sku,
    count(id)::numeric as barcode_count,
    count(id) filter (where package_level = 'CARTON')::numeric as carton_barcodes,
    count(id) filter (where package_level = 'SLEEVE')::numeric as sleeve_barcodes,
    count(id) filter (where package_level = 'EACH')::numeric as each_barcodes,
    count(id) filter (where package_level = 'INNER')::numeric as inner_barcodes,
    max(fixed_shelf) as scanned_shelf,
    max(last_scanned_at) as last_scanned_at,
    coalesce(sum(scan_count), 0)::numeric as scan_count
  from public.ecoflow_sku_barcode_registry
  group by sku
)
select
  v.sku,
  v.product_name,
  coalesce(p.package_mode, 'UNKNOWN') as package_mode,
  coalesce(c.fixed_shelf, p.default_shelf, r.scanned_shelf) as fixed_shelf,
  coalesce(r.barcode_count, 0)::numeric as barcode_count,
  coalesce(r.carton_barcodes, 0)::numeric as carton_barcodes,
  coalesce(r.sleeve_barcodes, 0)::numeric as sleeve_barcodes,
  coalesce(r.each_barcodes, 0)::numeric as each_barcodes,
  coalesce(r.inner_barcodes, 0)::numeric as inner_barcodes,
  r.last_scanned_at,
  coalesce(r.scan_count, 0)::numeric as scan_count,
  case
    when coalesce(p.package_mode, 'UNKNOWN') = 'UNKNOWN' then 'NEEDS_PACKAGE_POLICY'
    when p.package_mode = 'CARTON_AND_SLEEVE' and coalesce(r.carton_barcodes, 0) = 0 then 'NEEDS_CARTON_BARCODE'
    when p.package_mode = 'CARTON_AND_SLEEVE' and coalesce(r.sleeve_barcodes, 0) = 0 then 'NEEDS_SLEEVE_BARCODE'
    when p.package_mode = 'CARTON_ONLY' and coalesce(r.carton_barcodes, 0) = 0 then 'NEEDS_CARTON_BARCODE'
    when p.package_mode = 'SLEEVE_ONLY' and coalesce(r.sleeve_barcodes, 0) = 0 then 'NEEDS_SLEEVE_BARCODE'
    when p.package_mode = 'EACH_ONLY' and coalesce(r.each_barcodes, 0) = 0 then 'NEEDS_EACH_BARCODE'
    when p.package_mode = 'INNER_ONLY' and coalesce(r.inner_barcodes, 0) = 0 then 'NEEDS_INNER_BARCODE'
    when coalesce(c.fixed_shelf, p.default_shelf, r.scanned_shelf) is null then 'NEEDS_SHELF'
    else 'BARCODE_READY'
  end as barcode_signal
from public.v_ecoflow_owner_sku_velocity v
left join registry r on r.sku = v.sku
left join public.ecoflow_inventory_sku_controls c on c.sku = v.sku
left join public.ecoflow_sku_package_policies p on p.sku = v.sku
order by
  case
    when coalesce(p.package_mode, 'UNKNOWN') = 'UNKNOWN' then 0
    when p.package_mode = 'CARTON_AND_SLEEVE' and coalesce(r.carton_barcodes, 0) = 0 then 1
    when p.package_mode = 'CARTON_AND_SLEEVE' and coalesce(r.sleeve_barcodes, 0) = 0 then 2
    when p.package_mode = 'CARTON_ONLY' and coalesce(r.carton_barcodes, 0) = 0 then 3
    when p.package_mode = 'SLEEVE_ONLY' and coalesce(r.sleeve_barcodes, 0) = 0 then 4
    when p.package_mode = 'EACH_ONLY' and coalesce(r.each_barcodes, 0) = 0 then 5
    when p.package_mode = 'INNER_ONLY' and coalesce(r.inner_barcodes, 0) = 0 then 6
    when coalesce(c.fixed_shelf, p.default_shelf, r.scanned_shelf) is null then 7
    else 8
  end,
  v.units_30d desc nulls last;

grant select on public.v_ecoflow_barcode_registry_review to authenticated;

create view public.v_ecoflow_barcode_sprint_kpis as
select
  coalesce((select count(*) from public.ecoflow_sku_barcode_registry), 0)::numeric as registered_barcodes,
  coalesce((select count(distinct sku) from public.ecoflow_sku_barcode_registry), 0)::numeric as covered_skus,
  coalesce((select count(*) from public.v_ecoflow_barcode_registry_review where barcode_signal = 'NEEDS_PACKAGE_POLICY'), 0)::numeric as needs_policy,
  coalesce((select count(*) from public.v_ecoflow_barcode_registry_review where barcode_signal = 'NEEDS_CARTON_BARCODE'), 0)::numeric as needs_carton,
  coalesce((select count(*) from public.v_ecoflow_barcode_registry_review where barcode_signal = 'NEEDS_SLEEVE_BARCODE'), 0)::numeric as needs_sleeve,
  coalesce((select count(*) from public.v_ecoflow_barcode_registry_review where barcode_signal = 'NEEDS_EACH_BARCODE'), 0)::numeric as needs_each,
  coalesce((select count(*) from public.v_ecoflow_barcode_registry_review where barcode_signal = 'BARCODE_READY'), 0)::numeric as barcode_ready_skus,
  coalesce((select count(*) from public.ecoflow_barcode_scan_events where scanned_at >= now() - interval '1 day'), 0)::numeric as scans_24h,
  (select max(scanned_at) from public.ecoflow_barcode_scan_events) as latest_scan_at;

grant select on public.v_ecoflow_barcode_sprint_kpis to authenticated;

notify pgrst, 'reload schema';
