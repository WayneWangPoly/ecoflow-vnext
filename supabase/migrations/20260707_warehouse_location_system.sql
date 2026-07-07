-- EcoFlow warehouse location system
-- Applies the real warehouse map backbone: locations, stock-by-location and movement history.

create extension if not exists pgcrypto;

create table if not exists public.ecoflow_warehouse_locations (
  id uuid primary key default gen_random_uuid(),
  location_code text not null unique,
  rack_id text not null,
  rack_title text not null,
  side text not null check (side in ('left','right','front')),
  bin_code text,
  level_code text,
  half_code text,
  display_level text not null,
  category text,
  zone text not null default 'MAIN_WAREHOUSE',
  location_type text not null default 'BIN' check (location_type in ('BIN','SHELF','AREA')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE','HOLD')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ecoflow_warehouse_location_items (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.ecoflow_warehouse_locations(id) on delete cascade,
  sku text not null,
  product_name text,
  source_barcode text,
  unit_level text not null default 'carton' check (unit_level in ('carton','sleeve','each','unknown')),
  quantity numeric(14,2) not null default 0,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','HOLD','ZEROED')),
  last_movement_at timestamptz,
  last_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ecoflow_location_items_unique unique (location_id, sku, unit_level)
);

create index if not exists idx_ecoflow_location_items_location on public.ecoflow_warehouse_location_items(location_id);
create index if not exists idx_ecoflow_location_items_sku on public.ecoflow_warehouse_location_items(upper(sku));
create index if not exists idx_ecoflow_location_items_barcode on public.ecoflow_warehouse_location_items(source_barcode);

create table if not exists public.ecoflow_warehouse_movements (
  id uuid primary key default gen_random_uuid(),
  movement_type text not null check (movement_type in ('RECEIVE','MOVE_IN','MOVE_OUT','ADJUST','PICK','COUNT')),
  location_id uuid references public.ecoflow_warehouse_locations(id) on delete set null,
  from_location_id uuid references public.ecoflow_warehouse_locations(id) on delete set null,
  to_location_id uuid references public.ecoflow_warehouse_locations(id) on delete set null,
  sku text not null,
  product_name text,
  barcode text,
  unit_level text not null default 'carton',
  quantity numeric(14,2) not null,
  note text,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_ecoflow_movements_location on public.ecoflow_warehouse_movements(location_id, created_at desc);
create index if not exists idx_ecoflow_movements_sku on public.ecoflow_warehouse_movements(upper(sku), created_at desc);

create or replace function public.ecoflow_warehouse_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_ecoflow_warehouse_locations_updated_at on public.ecoflow_warehouse_locations;
create trigger trg_ecoflow_warehouse_locations_updated_at
before update on public.ecoflow_warehouse_locations
for each row execute function public.ecoflow_warehouse_touch_updated_at();

drop trigger if exists trg_ecoflow_warehouse_location_items_updated_at on public.ecoflow_warehouse_location_items;
create trigger trg_ecoflow_warehouse_location_items_updated_at
before update on public.ecoflow_warehouse_location_items
for each row execute function public.ecoflow_warehouse_touch_updated_at();

create or replace function public.ecoflow_can_read_warehouse()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_user_profiles p
    where p.user_id = auth.uid()
      and p.is_active = true
      and p.team_status = 'ACTIVE'
      and p.app_role in ('OWNER','ADMIN','ACCOUNT','WAREHOUSE','DRIVER','VIEWER')
  );
$$;

create or replace function public.ecoflow_can_manage_warehouse()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_user_profiles p
    where p.user_id = auth.uid()
      and p.is_active = true
      and p.team_status = 'ACTIVE'
      and p.app_role in ('OWNER','ADMIN','WAREHOUSE')
  );
$$;

alter table public.ecoflow_warehouse_locations enable row level security;
alter table public.ecoflow_warehouse_location_items enable row level security;
alter table public.ecoflow_warehouse_movements enable row level security;

drop policy if exists ecoflow_warehouse_locations_read on public.ecoflow_warehouse_locations;
create policy ecoflow_warehouse_locations_read on public.ecoflow_warehouse_locations
for select using (public.ecoflow_can_read_warehouse());

drop policy if exists ecoflow_warehouse_locations_manage on public.ecoflow_warehouse_locations;
create policy ecoflow_warehouse_locations_manage on public.ecoflow_warehouse_locations
for all using (public.ecoflow_can_manage_warehouse()) with check (public.ecoflow_can_manage_warehouse());

drop policy if exists ecoflow_warehouse_items_read on public.ecoflow_warehouse_location_items;
create policy ecoflow_warehouse_items_read on public.ecoflow_warehouse_location_items
for select using (public.ecoflow_can_read_warehouse());

drop policy if exists ecoflow_warehouse_items_manage on public.ecoflow_warehouse_location_items;
create policy ecoflow_warehouse_items_manage on public.ecoflow_warehouse_location_items
for all using (public.ecoflow_can_manage_warehouse()) with check (public.ecoflow_can_manage_warehouse());

drop policy if exists ecoflow_warehouse_movements_read on public.ecoflow_warehouse_movements;
create policy ecoflow_warehouse_movements_read on public.ecoflow_warehouse_movements
for select using (public.ecoflow_can_read_warehouse());

drop policy if exists ecoflow_warehouse_movements_manage on public.ecoflow_warehouse_movements;
create policy ecoflow_warehouse_movements_manage on public.ecoflow_warehouse_movements
for insert with check (public.ecoflow_can_manage_warehouse());

insert into public.ecoflow_warehouse_locations (location_code, rack_id, rack_title, side, bin_code, level_code, half_code, display_level, category, location_type, sort_order)
select
  r.rack_id || '-' || lpad(gs.bin::text, 2, '0') || '-' || lvl.level_code || half.half_code,
  r.rack_id,
  r.rack_id,
  side.side,
  lpad(gs.bin::text, 2, '0'),
  lvl.level_code,
  half.half_code,
  lvl.display_level,
  r.category,
  'BIN',
  r.sort_base + gs.bin * 100 + lvl.sort_offset + case half.half_code when 'A' then 1 else 2 end + case side.side when 'left' then 0 when 'right' then 40 else 80 end
from (
  values
    ('A4', 4, null::text, 1000),
    ('A3', 4, 'Single Wall Cup (ART) / SO5 Bags / Paper Bags', 2000),
    ('A2', 4, 'Single Wall Cup (White) / Salad / Soup Bowl', 3000),
    ('A1', 4, null::text, 4000),
    ('C2', 4, null::text, 5000),
    ('C1', 4, null::text, 6000)
) as r(rack_id, bins, category, sort_base)
cross join lateral generate_series(1, r.bins) as gs(bin)
cross join lateral (values ('03','Top', 0), ('02','Middle', 10), ('01','Bottom', 20)) as lvl(level_code, display_level, sort_offset)
cross join lateral (values ('A'), ('B')) as half(half_code)
cross join lateral (
  select unnest(case when r.rack_id = 'C1' then array['front']::text[] else array['left','right']::text[] end) as side
) as side
on conflict (location_code) do update set
  rack_id = excluded.rack_id,
  rack_title = excluded.rack_title,
  side = excluded.side,
  bin_code = excluded.bin_code,
  level_code = excluded.level_code,
  half_code = excluded.half_code,
  display_level = excluded.display_level,
  category = excluded.category,
  location_type = excluded.location_type,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.ecoflow_warehouse_locations (location_code, rack_id, rack_title, side, bin_code, level_code, half_code, display_level, category, location_type, sort_order)
select
  'B3-' || lvl.level_code,
  'B3',
  'B3',
  'front',
  null,
  lvl.level_code,
  null,
  lvl.display_level,
  lvl.category,
  'SHELF',
  7000 + lvl.sort_offset
from (values
  ('03','Top · Cutlery','Cutlery', 0),
  ('02','Middle · Grease Paperproof','Grease Paperproof', 10),
  ('01','Bottom · Glove','Glove', 20)
) as lvl(level_code, display_level, category, sort_offset)
on conflict (location_code) do update set
  display_level = excluded.display_level,
  category = excluded.category,
  location_type = excluded.location_type,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.ecoflow_warehouse_locations (location_code, rack_id, rack_title, side, display_level, category, location_type, sort_order)
values ('TEMP', 'TEMP', 'TEMP', 'front', 'Temporary holding area', 'Temporary', 'AREA', 9000)
on conflict (location_code) do update set
  display_level = excluded.display_level,
  category = excluded.category,
  location_type = excluded.location_type,
  sort_order = excluded.sort_order,
  updated_at = now();

create or replace view public.v_ecoflow_warehouse_location_items as
select
  l.id as location_id,
  l.location_code,
  l.rack_id,
  l.rack_title,
  l.side,
  l.bin_code,
  l.level_code,
  l.half_code,
  l.display_level,
  l.category as location_category,
  l.location_type,
  l.status as location_status,
  l.sort_order,
  i.id as item_id,
  i.sku,
  i.product_name,
  i.source_barcode,
  i.unit_level,
  i.quantity,
  i.status as item_status,
  i.last_movement_at,
  i.last_note,
  i.updated_at as item_updated_at,
  coalesce(sum(i.quantity) filter (where i.id is not null) over (partition by i.sku), 0) as sku_total_quantity
from public.ecoflow_warehouse_locations l
left join public.ecoflow_warehouse_location_items i
  on i.location_id = l.id
 and i.status <> 'ZEROED'
order by l.sort_order, i.sku;

grant select on public.v_ecoflow_warehouse_location_items to authenticated;

create or replace function public.ecoflow_record_receive_movement(
  p_location_code text,
  p_barcode text,
  p_quantity numeric,
  p_note text default null,
  p_sku text default null,
  p_product_name text default null,
  p_unit_level text default 'carton'
)
returns table(location_code text, sku text, quantity numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_location public.ecoflow_warehouse_locations%rowtype;
  v_existing public.ecoflow_warehouse_location_items%rowtype;
  v_sku text;
  v_product_name text;
  v_unit_level text;
begin
  if not public.ecoflow_can_manage_warehouse() then
    raise exception 'OWNER_ADMIN_OR_WAREHOUSE_REQUIRED';
  end if;

  if coalesce(trim(p_barcode), '') = '' then
    raise exception 'BARCODE_REQUIRED';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'POSITIVE_QUANTITY_REQUIRED';
  end if;

  select * into v_location
  from public.ecoflow_warehouse_locations
  where upper(location_code) = upper(trim(p_location_code))
  limit 1;

  if not found then
    raise exception 'LOCATION_NOT_FOUND: %', p_location_code;
  end if;

  select * into v_existing
  from public.ecoflow_warehouse_location_items
  where source_barcode = trim(p_barcode)
     or upper(sku) = upper(coalesce(trim(p_sku), ''))
  order by updated_at desc
  limit 1;

  v_sku := coalesce(nullif(trim(p_sku), ''), nullif(v_existing.sku, ''), 'UNKNOWN-' || right(regexp_replace(trim(p_barcode), '[^A-Za-z0-9]', '', 'g'), 8));
  v_product_name := coalesce(nullif(trim(p_product_name), ''), nullif(v_existing.product_name, ''), 'Unknown barcode pending identification');
  v_unit_level := coalesce(nullif(trim(p_unit_level), ''), nullif(v_existing.unit_level, ''), 'carton');

  insert into public.ecoflow_warehouse_location_items (location_id, sku, product_name, source_barcode, unit_level, quantity, status, last_movement_at, last_note)
  values (v_location.id, v_sku, v_product_name, trim(p_barcode), v_unit_level, p_quantity, 'ACTIVE', now(), p_note)
  on conflict (location_id, sku, unit_level) do update set
    quantity = public.ecoflow_warehouse_location_items.quantity + excluded.quantity,
    product_name = coalesce(excluded.product_name, public.ecoflow_warehouse_location_items.product_name),
    source_barcode = coalesce(excluded.source_barcode, public.ecoflow_warehouse_location_items.source_barcode),
    status = 'ACTIVE',
    last_movement_at = now(),
    last_note = excluded.last_note,
    updated_at = now();

  insert into public.ecoflow_warehouse_movements (movement_type, location_id, to_location_id, sku, product_name, barcode, unit_level, quantity, note, actor_user_id)
  values ('RECEIVE', v_location.id, v_location.id, v_sku, v_product_name, trim(p_barcode), v_unit_level, p_quantity, p_note, auth.uid());

  return query select v_location.location_code, v_sku, p_quantity;
end;
$$;

grant execute on function public.ecoflow_record_receive_movement(text, text, numeric, text, text, text, text) to authenticated;
