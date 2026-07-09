-- Barcode onboarding sprint.
-- Practical first-run workflow for scanning carton and sleeve barcodes at scale.

create table if not exists public.ecoflow_barcode_scan_sessions (
  id uuid primary key default gen_random_uuid(),
  session_name text not null default 'Barcode sprint',
  target_area text,
  session_status text not null default 'OPEN' check (session_status in ('OPEN','PAUSED','CLOSED')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists public.ecoflow_sku_barcode_registry (
  id uuid primary key default gen_random_uuid(),
  sku text not null,
  barcode text not null unique,
  package_level text not null default 'UNKNOWN' check (package_level in ('CARTON','SLEEVE','EACH','INNER','UNKNOWN')),
  units_per_barcode numeric not null default 1,
  product_name text,
  fixed_shelf text,
  source_session_id uuid references public.ecoflow_barcode_scan_sessions(id),
  scan_count integer not null default 1,
  first_scanned_at timestamptz not null default now(),
  last_scanned_at timestamptz not null default now(),
  verified boolean not null default false,
  note text
);

create index if not exists idx_sku_barcode_registry_sku on public.ecoflow_sku_barcode_registry(sku);
create index if not exists idx_sku_barcode_registry_package on public.ecoflow_sku_barcode_registry(package_level);

grant select, insert, update on public.ecoflow_barcode_scan_sessions to authenticated;
grant select, insert, update on public.ecoflow_sku_barcode_registry to authenticated;

create table if not exists public.ecoflow_barcode_scan_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.ecoflow_barcode_scan_sessions(id),
  sku text not null,
  barcode text not null,
  package_level text not null default 'UNKNOWN',
  units_per_barcode numeric not null default 1,
  product_name text,
  shelf text,
  qty_observed numeric,
  action_mode text not null default 'MAP_ONLY' check (action_mode in ('MAP_ONLY','MAP_AND_COUNT','MAP_AND_RECEIVE')),
  scan_status text not null default 'RECORDED',
  movement_id uuid,
  scan_note text,
  scanned_by uuid default auth.uid(),
  scanned_at timestamptz not null default now()
);

create index if not exists idx_barcode_scan_events_session on public.ecoflow_barcode_scan_events(session_id);
create index if not exists idx_barcode_scan_events_sku on public.ecoflow_barcode_scan_events(sku);
create index if not exists idx_barcode_scan_events_barcode on public.ecoflow_barcode_scan_events(barcode);
create index if not exists idx_barcode_scan_events_scanned_at on public.ecoflow_barcode_scan_events(scanned_at desc);

grant select, insert on public.ecoflow_barcode_scan_events to authenticated;

create or replace function public.ecoflow_start_barcode_scan_session(
  p_session_name text default 'Barcode sprint',
  p_target_area text default null
)
returns table (session_id uuid, session_name text, target_area text, session_status text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.ecoflow_barcode_scan_sessions(session_name, target_area, session_status, created_by, created_at)
  values (coalesce(nullif(trim(p_session_name), ''), 'Barcode sprint'), nullif(trim(coalesce(p_target_area, '')), ''), 'OPEN', auth.uid(), now())
  returning id into v_id;

  return query
  select s.id, s.session_name, s.target_area, s.session_status, s.created_at
  from public.ecoflow_barcode_scan_sessions s
  where s.id = v_id;
end;
$$;

grant execute on function public.ecoflow_start_barcode_scan_session(text, text) to authenticated;

create or replace function public.ecoflow_record_barcode_scan(
  p_session_id uuid,
  p_sku text,
  p_barcode text,
  p_package_level text default 'UNKNOWN',
  p_units_per_barcode numeric default 1,
  p_product_name text default null,
  p_shelf text default null,
  p_qty_observed numeric default null,
  p_action_mode text default 'MAP_ONLY',
  p_note text default null
)
returns table (
  event_id uuid,
  sku text,
  barcode text,
  package_level text,
  scan_status text,
  movement_id uuid,
  scanned_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sku text := upper(nullif(trim(coalesce(p_sku, '')), ''));
  v_barcode text := nullif(trim(coalesce(p_barcode, '')), '');
  v_package text := upper(trim(coalesce(p_package_level, 'UNKNOWN')));
  v_mode text := upper(trim(coalesce(p_action_mode, 'MAP_ONLY')));
  v_units numeric := greatest(coalesce(p_units_per_barcode, 1), 1);
  v_qty numeric := coalesce(p_qty_observed, 1);
  v_event_id uuid;
  v_movement_id uuid;
  v_product text;
  v_status text := 'RECORDED';
begin
  if v_sku is null or v_sku = 'UNKNOWN' then raise exception 'valid SKU is required'; end if;
  if v_barcode is null then raise exception 'barcode is required'; end if;
  if v_package not in ('CARTON','SLEEVE','EACH','INNER','UNKNOWN') then raise exception 'invalid package level'; end if;
  if v_mode not in ('MAP_ONLY','MAP_AND_COUNT','MAP_AND_RECEIVE') then raise exception 'invalid action mode'; end if;

  select product_name into v_product from public.v_ecoflow_owner_sku_velocity where sku = v_sku limit 1;
  v_product := coalesce(nullif(trim(coalesce(p_product_name, '')), ''), v_product, 'Unknown product');

  insert into public.ecoflow_sku_barcode_registry(
    sku, barcode, package_level, units_per_barcode, product_name, fixed_shelf,
    source_session_id, scan_count, first_scanned_at, last_scanned_at, verified, note
  ) values (
    v_sku, v_barcode, v_package, v_units, v_product, nullif(trim(coalesce(p_shelf, '')), ''),
    p_session_id, 1, now(), now(), false, nullif(trim(coalesce(p_note, '')), '')
  )
  on conflict (barcode) do update set
    sku = excluded.sku,
    package_level = excluded.package_level,
    units_per_barcode = excluded.units_per_barcode,
    product_name = coalesce(nullif(excluded.product_name, ''), public.ecoflow_sku_barcode_registry.product_name),
    fixed_shelf = coalesce(nullif(excluded.fixed_shelf, ''), public.ecoflow_sku_barcode_registry.fixed_shelf),
    source_session_id = coalesce(excluded.source_session_id, public.ecoflow_sku_barcode_registry.source_session_id),
    scan_count = public.ecoflow_sku_barcode_registry.scan_count + 1,
    last_scanned_at = now(),
    note = coalesce(excluded.note, public.ecoflow_sku_barcode_registry.note);

  insert into public.ecoflow_inventory_sku_controls(sku, product_name, fixed_shelf, primary_barcode, updated_by, updated_at)
  values (v_sku, v_product, nullif(trim(coalesce(p_shelf, '')), ''), v_barcode, auth.uid(), now())
  on conflict (sku) do update set
    product_name = coalesce(public.ecoflow_inventory_sku_controls.product_name, excluded.product_name),
    fixed_shelf = coalesce(public.ecoflow_inventory_sku_controls.fixed_shelf, excluded.fixed_shelf),
    primary_barcode = coalesce(public.ecoflow_inventory_sku_controls.primary_barcode, excluded.primary_barcode),
    updated_by = auth.uid(),
    updated_at = now();

  if v_mode = 'MAP_AND_RECEIVE' then
    insert into public.ecoflow_inventory_movements(
      sku, product_name, movement_type, quantity, to_location, reference_type, reference_id,
      action_note, source, moved_by, moved_at
    ) values (
      v_sku, v_product, 'RECEIVE', v_qty * v_units, coalesce(nullif(trim(coalesce(p_shelf, '')), ''), 'RECEIVING'),
      'BARCODE_SCAN', v_barcode, nullif(trim(coalesce(p_note, '')), ''), 'BARCODE_ONBOARDING', auth.uid(), now()
    ) returning id into v_movement_id;
    v_status := 'RECORDED_AND_RECEIVED';
  elsif v_mode = 'MAP_AND_COUNT' then
    v_status := 'RECORDED_AND_COUNTED';
  end if;

  insert into public.ecoflow_barcode_scan_events(
    session_id, sku, barcode, package_level, units_per_barcode, product_name, shelf,
    qty_observed, action_mode, scan_status, movement_id, scan_note, scanned_by, scanned_at
  ) values (
    p_session_id, v_sku, v_barcode, v_package, v_units, v_product, nullif(trim(coalesce(p_shelf, '')), ''),
    v_qty, v_mode, v_status, v_movement_id, nullif(trim(coalesce(p_note, '')), ''), auth.uid(), now()
  ) returning id into v_event_id;

  return query
  select e.id, e.sku, e.barcode, e.package_level, e.scan_status, e.movement_id, e.scanned_at
  from public.ecoflow_barcode_scan_events e
  where e.id = v_event_id;
end;
$$;

grant execute on function public.ecoflow_record_barcode_scan(uuid, text, text, text, numeric, text, text, numeric, text, text) to authenticated;

drop view if exists public.v_ecoflow_barcode_sprint_kpis cascade;
drop view if exists public.v_ecoflow_barcode_registry_review cascade;
drop view if exists public.v_ecoflow_barcode_recent_scans cascade;

create view public.v_ecoflow_barcode_recent_scans as
select * from public.ecoflow_barcode_scan_events order by scanned_at desc limit 200;
grant select on public.v_ecoflow_barcode_recent_scans to authenticated;

create view public.v_ecoflow_barcode_registry_review as
select
  v.sku,
  v.product_name,
  coalesce(c.fixed_shelf, max(r.fixed_shelf)) as fixed_shelf,
  count(r.id)::numeric as barcode_count,
  count(r.id) filter (where r.package_level = 'CARTON')::numeric as carton_barcodes,
  count(r.id) filter (where r.package_level = 'SLEEVE')::numeric as sleeve_barcodes,
  count(r.id) filter (where r.package_level = 'EACH')::numeric as each_barcodes,
  max(r.last_scanned_at) as last_scanned_at,
  coalesce(sum(r.scan_count), 0)::numeric as scan_count,
  case
    when count(r.id) filter (where r.package_level = 'CARTON') = 0 then 'NEEDS_CARTON_BARCODE'
    when count(r.id) filter (where r.package_level = 'SLEEVE') = 0 then 'NEEDS_SLEEVE_BARCODE'
    when c.fixed_shelf is null and max(r.fixed_shelf) is null then 'NEEDS_SHELF'
    else 'BARCODE_READY'
  end as barcode_signal
from public.v_ecoflow_owner_sku_velocity v
left join public.ecoflow_sku_barcode_registry r on r.sku = v.sku
left join public.ecoflow_inventory_sku_controls c on c.sku = v.sku
group by v.sku, v.product_name, c.fixed_shelf
order by
  case
    when count(r.id) filter (where r.package_level = 'CARTON') = 0 then 0
    when count(r.id) filter (where r.package_level = 'SLEEVE') = 0 then 1
    when c.fixed_shelf is null and max(r.fixed_shelf) is null then 2
    else 3
  end,
  max(v.units_30d) desc nulls last;

grant select on public.v_ecoflow_barcode_registry_review to authenticated;

create view public.v_ecoflow_barcode_sprint_kpis as
select
  coalesce((select count(*) from public.ecoflow_sku_barcode_registry), 0)::numeric as registered_barcodes,
  coalesce((select count(distinct sku) from public.ecoflow_sku_barcode_registry), 0)::numeric as covered_skus,
  coalesce((select count(*) from public.v_ecoflow_barcode_registry_review where barcode_signal = 'NEEDS_CARTON_BARCODE'), 0)::numeric as needs_carton,
  coalesce((select count(*) from public.v_ecoflow_barcode_registry_review where barcode_signal = 'NEEDS_SLEEVE_BARCODE'), 0)::numeric as needs_sleeve,
  coalesce((select count(*) from public.v_ecoflow_barcode_registry_review where barcode_signal = 'BARCODE_READY'), 0)::numeric as barcode_ready_skus,
  coalesce((select count(*) from public.ecoflow_barcode_scan_events where scanned_at >= now() - interval '1 day'), 0)::numeric as scans_24h,
  (select max(scanned_at) from public.ecoflow_barcode_scan_events) as latest_scan_at;

grant select on public.v_ecoflow_barcode_sprint_kpis to authenticated;

notify pgrst, 'reload schema';
