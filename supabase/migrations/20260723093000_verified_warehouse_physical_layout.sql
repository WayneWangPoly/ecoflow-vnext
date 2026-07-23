-- Verified EcoFlow warehouse physical layout captured onsite on 23 July 2026.
--
-- This migration changes location structure and labels only. It never changes
-- stock quantities, location balances or movement history.

begin;

do $safety$
begin
  if to_regclass('public.ecoflow_warehouse_locations') is null
     or to_regclass('public.ecoflow_warehouse_location_items') is null then
    raise exception 'WAREHOUSE_LOCATION_SCHEMA_REQUIRED';
  end if;

  -- Side-coded locations belong to the retired map model. Never hide one if it
  -- has acquired real stock.
  if exists (
    select 1
    from public.ecoflow_warehouse_locations location
    join public.ecoflow_warehouse_location_items item on item.location_id = location.id
    where location.location_code ~ '^(A[1-6]|C[12])-[LR]-'
      and item.status <> 'ZEROED'
      and item.quantity <> 0
  ) then
    raise exception 'LEGACY_SIDE_CODED_LOCATION_HAS_STOCK';
  end if;

  -- B3-01/02/03 previously represented a different three-level rack. The
  -- onsite layout confirms B3 has four levels, so stop rather than silently
  -- relabel any live stock already recorded against those old meanings.
  if exists (
    select 1
    from public.ecoflow_warehouse_locations location
    join public.ecoflow_warehouse_location_items item on item.location_id = location.id
    where location.location_code in ('B3-01', 'B3-02', 'B3-03')
      and item.status <> 'ZEROED'
      and item.quantity <> 0
  ) then
    raise exception 'B3_LEGACY_LEVEL_HAS_STOCK_REVIEW_REQUIRED';
  end if;
end
$safety$;

create temporary table _ecoflow_verified_locations (
  location_code text primary key,
  rack_id text not null,
  rack_title text not null,
  side text not null,
  bin_code text,
  level_code text,
  half_code text,
  display_level text not null,
  category text,
  zone text not null,
  location_type text not null,
  sort_order integer not null
) on commit drop;

-- Main warehouse rows. Each physical face has its own rack code. All large
-- faces have six bays, three levels and A/B halves.
insert into _ecoflow_verified_locations (
  location_code, rack_id, rack_title, side, bin_code, level_code, half_code,
  display_level, category, zone, location_type, sort_order
)
select
  rack.rack_id || '-' || lpad(bay::text, 2, '0') || '-' || level.level_code || half.half_code,
  rack.rack_id,
  rack.rack_id,
  'front',
  lpad(bay::text, 2, '0'),
  level.level_code,
  half.half_code,
  level.display_level,
  rack.category,
  'MAIN_WAREHOUSE',
  'BIN',
  rack.sort_base + bay * 100 + level.sort_offset + case half.half_code when 'A' then 1 else 2 end
from (
  values
    ('C1', null::text, 1000),
    ('C2', 'Napkins / Snack Box', 2000),
    ('A1', 'Double Wall Cups', 2100),
    ('A2', 'Single Wall Cups / Salad & Soup Bowls', 3000),
    ('A3', 'SOS Bags / Paper Bags / Single Wall Cups', 3100),
    ('A4', 'Cold Cups & Lids', 4000),
    ('A5', 'PLA Coffee Lids', 4100),
    ('A6', 'Single Wall Cups (Black & Kraft)', 5000)
) as rack(rack_id, category, sort_base)
cross join generate_series(1, 6) as bay
cross join lateral (
  values ('03', 'Top', 0), ('02', 'Middle', 10), ('01', 'Bottom', 20)
) as level(level_code, display_level, sort_offset)
cross join lateral (values ('A'), ('B')) as half(half_code);

-- TEMP north racks D1-D4, TEMP west/south racks B1-B2, and office north
-- racks B3-B5. half_code is used only where a physical shelf is divided.
insert into _ecoflow_verified_locations (
  location_code, rack_id, rack_title, side, bin_code, level_code, half_code,
  display_level, category, zone, location_type, sort_order
)
values
  ('D1-02', 'D1', 'D1', 'front', null, '02', null, 'Upper', 'Egg Trays 2 & 4', 'TEMP_NORTH', 'SHELF', 6001),
  ('D1-01', 'D1', 'D1', 'front', null, '01', null, 'Lower', 'Open Trays', 'TEMP_NORTH', 'SHELF', 6002),
  ('D2-02', 'D2', 'D2', 'front', null, '02', null, 'Upper', 'Double Rolls / Star Seals / Single Bags', 'TEMP_NORTH', 'SHELF', 6101),
  ('D2-01', 'D2', 'D2', 'front', null, '01', null, 'Lower', 'Double Rolls / Star Seals / Single Bags', 'TEMP_NORTH', 'SHELF', 6102),
  ('D3-02', 'D3', 'D3', 'front', null, '02', null, 'Upper', 'Thermal Rolls', 'TEMP_NORTH', 'SHELF', 6201),
  ('D3-01', 'D3', 'D3', 'front', null, '01', null, 'Lower', 'Thermal Rolls', 'TEMP_NORTH', 'SHELF', 6202),
  ('D4-02', 'D4', 'D4', 'front', null, '02', null, 'Upper', 'Others', 'TEMP_NORTH', 'SHELF', 6301),
  ('D4-01', 'D4', 'D4', 'front', null, '01', null, 'Lower', 'Others', 'TEMP_NORTH', 'SHELF', 6302),

  ('B1-04', 'B1', 'B1', 'front', null, '04', null, 'Top', 'Toilet / Jumbo Rolls', 'TEMP_WEST', 'SHELF', 7001),
  ('B1-03', 'B1', 'B1', 'front', null, '03', null, 'Second', 'Hand Towel', 'TEMP_WEST', 'SHELF', 7002),
  ('B1-02A', 'B1', 'B1', 'front', null, '02', 'A', 'Third · Left', 'Slim Hand Towel', 'TEMP_WEST', 'SHELF', 7003),
  ('B1-02B', 'B1', 'B1', 'front', null, '02', 'B', 'Third · Middle', 'Lemon Fresh Surface Sanitiser', 'TEMP_WEST', 'SHELF', 7004),
  ('B1-02C', 'B1', 'B1', 'front', null, '02', 'C', 'Third · Right', 'Chemicals', 'TEMP_WEST', 'SHELF', 7005),
  ('B1-01A', 'B1', 'B1', 'front', null, '01', 'A', 'Bottom · Left', 'Chemicals', 'TEMP_WEST', 'SHELF', 7006),
  ('B1-01B', 'B1', 'B1', 'front', null, '01', 'B', 'Bottom · Right', 'Dishwashing Liquid', 'TEMP_WEST', 'SHELF', 7007),

  ('B2-03', 'B2', 'B2', 'front', null, '03', null, 'Top', 'Clam Shell', 'TEMP_SOUTH', 'SHELF', 7101),
  ('B2-02', 'B2', 'B2', 'front', null, '02', null, 'Middle', 'Aluminium Foil / Cling Wrap / Baking Paper', 'TEMP_SOUTH', 'SHELF', 7102),
  ('B2-01A', 'B2', 'B2', 'front', null, '01', 'A', 'Bottom · Left', 'Bin Bags', 'TEMP_SOUTH', 'SHELF', 7103),
  ('B2-01B', 'B2', 'B2', 'front', null, '01', 'B', 'Bottom · Right', 'Wipes', 'TEMP_SOUTH', 'SHELF', 7104),

  ('B3-04', 'B3', 'B3', 'front', null, '04', null, 'Top', 'Cutlery', 'OFFICE_NORTH', 'SHELF', 8001),
  ('B3-03', 'B3', 'B3', 'front', null, '03', null, 'Second', 'Grease', 'OFFICE_NORTH', 'SHELF', 8002),
  ('B3-02', 'B3', 'B3', 'front', null, '02', null, 'Third', 'Paperproof', 'OFFICE_NORTH', 'SHELF', 8003),
  ('B3-01', 'B3', 'B3', 'front', null, '01', null, 'Bottom', 'Gloves', 'OFFICE_NORTH', 'SHELF', 8004),

  ('B4-04', 'B4', 'B4', 'front', null, '04', null, 'Top', 'Buffer Area', 'OFFICE_NORTH', 'SHELF', 8101),
  ('B4-03', 'B4', 'B4', 'front', null, '03', null, 'Second', 'Sauce Containers', 'OFFICE_NORTH', 'SHELF', 8102),
  ('B4-02', 'B4', 'B4', 'front', null, '02', null, 'Third', 'Paper Bags', 'OFFICE_NORTH', 'SHELF', 8103),
  ('B4-01', 'B4', 'B4', 'front', null, '01', null, 'Bottom', 'Straws', 'OFFICE_NORTH', 'SHELF', 8104),

  ('B5-02', 'B5', 'B5', 'front', null, '02', null, 'Upper', 'Buffer Area', 'OFFICE_NORTH', 'SHELF', 8201),
  ('B5-01', 'B5', 'B5', 'front', null, '01', null, 'Lower', 'Buffer Area', 'OFFICE_NORTH', 'SHELF', 8202),

  ('TEMP', 'TEMP', 'TEMP', 'front', null, null, null, 'Temporary holding area', 'Temporary holding area', 'TEMP', 'AREA', 9000);

insert into public.ecoflow_warehouse_locations (
  location_code, rack_id, rack_title, side, bin_code, level_code, half_code,
  display_level, category, zone, location_type, status, sort_order
)
select
  location_code, rack_id, rack_title, side, bin_code, level_code, half_code,
  display_level, category, zone, location_type, 'ACTIVE', sort_order
from _ecoflow_verified_locations
on conflict (location_code) do update set
  rack_id = excluded.rack_id,
  rack_title = excluded.rack_title,
  side = excluded.side,
  bin_code = excluded.bin_code,
  level_code = excluded.level_code,
  half_code = excluded.half_code,
  display_level = excluded.display_level,
  category = excluded.category,
  zone = excluded.zone,
  location_type = excluded.location_type,
  status = case
    when public.ecoflow_warehouse_locations.status = 'INACTIVE' then 'ACTIVE'
    else public.ecoflow_warehouse_locations.status
  end,
  sort_order = excluded.sort_order,
  updated_at = now();

-- Retain but hide obsolete side-prefixed scaffold locations. The safety block
-- above guarantees none of these contains non-zero stock.
update public.ecoflow_warehouse_locations
set status = 'INACTIVE',
    category = coalesce(category, 'Retired map scaffold'),
    updated_at = now()
where location_code ~ '^(A[1-6]|C[12])-[LR]-';

do $verify$
declare
  v_expected integer;
  v_missing integer;
begin
  select count(*) into v_expected from _ecoflow_verified_locations;
  select count(*) into v_missing
  from _ecoflow_verified_locations expected
  left join public.ecoflow_warehouse_locations actual
    on actual.location_code = expected.location_code
   and actual.status <> 'INACTIVE'
  where actual.id is null;

  if v_expected <> 318 then
    raise exception 'VERIFIED_LAYOUT_EXPECTED_318_LOCATIONS_FOUND_%', v_expected;
  end if;
  if v_missing <> 0 then
    raise exception 'VERIFIED_LAYOUT_MISSING_%_LOCATIONS', v_missing;
  end if;
end
$verify$;

commit;
