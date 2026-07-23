import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), 'utf8');
const has = (source, text, message) => assert.ok(source.includes(text), message);
const lacks = (source, text, message) => assert.ok(!source.includes(text), message);

const map = read('src/features/warehouse/WarehouseMapPage.tsx');
const styles = read('src/warehousePhysicalLayout.css');
const migration = read('supabase/migrations/20260723093000_verified_warehouse_physical_layout.sql');

for (const rack of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'B1', 'B2', 'B3', 'B4', 'B5', 'C1', 'C2', 'D1', 'D2', 'D3', 'D4', 'TEMP']) {
  has(map, `id: '${rack}'`, `Physical map must include ${rack}.`);
}

has(map, "id: 'C1', title: 'C1', mode: 'grid', bins: 6", 'C1 must have six large bays.');
has(map, "id: 'C2', title: 'C2', mode: 'grid', bins: 6", 'C2 must have six large bays.');
has(map, "id: 'A6', title: 'A6', mode: 'grid', bins: 6", 'A6 must retain the six-bay main-rack structure.');
has(map, 'Napkins / Snack Box', 'C2 category must match the onsite label.');
has(map, 'Double Wall Cups', 'A1 category must match the onsite label.');
has(map, 'Cold Cups & Lids', 'A4 category must match the onsite label.');
has(map, 'PLA Coffee Lids', 'A5 category must match the onsite label.');
has(map, 'Egg Trays 2 & 4', 'D1 upper shelf must be recorded.');
has(map, 'Lemon Fresh Surface Sanitiser', 'B1 segmented third shelf must be recorded.');
has(map, 'Aluminium Foil / Cling Wrap / Baking Paper', 'B2 middle shelf must be recorded.');
has(map, "{ code: '04', label: 'Top', category: 'Cutlery' }", 'B3 must have a four-level definition.');
has(map, "data-layout-key={`physical-v2:rack-${rack.id.toLowerCase()}`}", 'New onsite geometry must not inherit stale cloud coordinates.');
has(styles, '.warehouse-shelf-segments', 'Variable shelf segmentation must have a dedicated layout.');

has(migration, 'LEGACY_SIDE_CODED_LOCATION_HAS_STOCK', 'Migration must stop if retired locations contain stock.');
has(migration, 'B3_LEGACY_LEVEL_HAS_STOCK_REVIEW_REQUIRED', 'Migration must stop before relabelling a live B3 legacy shelf.');
has(migration, "generate_series(1, 6)", 'All main rack faces must seed six bays.');
has(migration, "v_expected <> 318", 'Migration must verify the complete 318-location structure.');
has(migration, "status = 'INACTIVE'", 'Retired side-prefixed scaffold locations must be hidden, not deleted.');
lacks(migration, 'delete from public.ecoflow_warehouse_location_items', 'Physical layout migration must not delete stock.');
lacks(migration, 'update public.ecoflow_warehouse_location_items', 'Physical layout migration must not rewrite stock quantities.');
lacks(migration, 'insert into public.ecoflow_warehouse_movements', 'Physical layout migration must not fabricate stock movements.');

console.log('Warehouse physical layout contract passed.');
