import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrationFile =
  'supabase/migrations/20260729120000_inventory_movement_and_daily_snapshot.sql';
const locationFixFile =
  'supabase/migrations/20260729120100_inventory_location_dimension_resolution.sql';
const migration = fs.readFileSync(migrationFile, 'utf8');
const locationFix = fs.readFileSync(locationFixFile, 'utf8');

const checks = [
  ['transaction boundary', /\bbegin;\s*[\s\S]*\bcommit;\s*$/i],
  ['preflight', /INVENTORY_FACT_PREREQUISITES_MISSING/],
  ['movement fact', /create table analytics\.fact_inventory_movement/],
  ['daily snapshot', /create table analytics\.fact_daily_inventory_snapshot/],
  ['global base domain', /'GLOBAL_BASE'/],
  ['location package domain', /'LOCATION_PACKAGE'/],
  ['base unit label', /'BASE_UNIT'/],
  ['unknown direction preserved', /movement_direction in \('IN','OUT','TRANSFER','UNKNOWN'\)/],
  ['unknown signed quantity nullable', /else null[\s\S]{0,120}end,[\s\S]{0,120}'BASE_UNIT'/],
  ['paired reference', /PAIRED_REFERENCE/],
  ['global completeness warning', /global completeness is not assumed/i],
  ['snapshot location basis', /current warehouse location balances/i],
  ['active barcode conversion', /CONVERTED_ACTIVE_BARCODE/],
  ['unknown unit', /UNKNOWN_UNIT/],
  ['unestablished reconciliation', /NOT_ESTABLISHED/],
  ['negative balance quality', /NEGATIVE_LOCATION_BALANCE/],
  ['movement quality view', /create or replace view analytics\.v_inventory_movement_quality/],
  ['snapshot quality view', /create or replace view analytics\.v_daily_inventory_snapshot_quality/],
  ['controlled refresh', /create or replace function analytics\.refresh_inventory_movement_and_snapshot_facts/],
  ['refresh advisory lock', /pg_advisory_xact_lock\([\s\S]{0,120}refresh_inventory_movement_and_snapshot_facts/],
  ['service movement read', /grant select on table analytics\.fact_inventory_movement to service_role/],
  ['service snapshot read', /grant select on table analytics\.fact_daily_inventory_snapshot to service_role/],
  ['service refresh grant', /grant execute on function analytics\.refresh_inventory_movement_and_snapshot_facts\([\s\S]{0,80}to service_role/],
  ['no automatic backfill comment', /does not refresh or backfill facts/i],
  ['pgrst reload', /notify pgrst,'reload schema'/],
];

const locationChecks = [
  ['location fix transaction', /\bbegin;\s*[\s\S]*\bcommit;\s*$/i],
  ['location fix preflight', /INVENTORY_LOCATION_DIMENSION_PREREQUISITES_MISSING/],
  ['location SCD resolver', /create or replace function analytics\.ecoflow_ensure_warehouse_location_dimension/],
  ['same-as-of in-place correction', /v_as_of<=v_current\.effective_from/],
  ['location history close', /set effective_to=v_as_of,[\s\S]{0,80}is_current=false/],
  ['movement location trigger', /create trigger resolve_inventory_fact_locations/],
  ['analytics-only statement', /performs no operational warehouse mutation/i],
];

for (const [name, pattern] of checks) {
  assert.match(migration, pattern, `Inventory fact audit failed: ${name}`);
}
for (const [name, pattern] of locationChecks) {
  assert.match(locationFix, pattern, `Inventory location audit failed: ${name}`);
}

for (const [name, pattern, source = migration] of [
  [
    'browser movement fact grant',
    /grant select on table analytics\.fact_inventory_movement to (?:anon|authenticated)/,
  ],
  [
    'browser snapshot grant',
    /grant select on table analytics\.fact_daily_inventory_snapshot to (?:anon|authenticated)/,
  ],
  [
    'browser refresh grant',
    /grant execute on function analytics\.refresh_inventory_movement_and_snapshot_facts[\s\S]{0,120}to (?:anon|authenticated)/,
  ],
  [
    'service direct fact writes',
    /grant all on table analytics\.fact_(?:inventory_movement|daily_inventory_snapshot) to service_role/,
  ],
  [
    'automatic refresh invocation',
    /select\s+\*\s+from\s+analytics\.refresh_inventory_movement_and_snapshot_facts/i,
  ],
  [
    'KPI activation',
    /update analytics\.metric_definition[\s\S]{0,200}status\s*=\s*'ACTIVE'/,
  ],
  [
    'cross-domain quantity sum',
    /sum\(signed_quantity\)[\s\S]{0,300}group by source_sku_code/i,
  ],
  [
    'global ledger reconstructed snapshot',
    /from analytics\.fact_inventory_movement[\s\S]{0,500}insert into analytics\.fact_daily_inventory_snapshot/i,
  ],
  [
    'operational location update',
    /update public\.ecoflow_warehouse_locations/,
    locationFix,
  ],
]) {
  assert.doesNotMatch(source, pattern, `Inventory fact audit found ${name}`);
}

assert.equal(checks.length, 25);
assert.equal(locationChecks.length, 7);
console.log(
  `Inventory movement/snapshot static audit passed (${checks.length + locationChecks.length}/${checks.length + locationChecks.length}).`,
);
