import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/20260903170435_unleashed_inventory_reference.sql');
const contract = read('scripts/unleashed-inventory-reference-db-contract-test.sql');
const workPackage = read('docs/engineering/work-packages/UNLEASHED-MIGRATION-004-inventory-reference.md');
const workflow = read('.github/workflows/unleashed-inventory-reference-check.yml');

const checks = [];
const check = (name, pass, evidence) => checks.push({ name, pass: Boolean(pass), evidence });

check('three-table reference envelope',
  ['batches','rows','commands'].every((suffix) => migration.includes(`create table public.ecoflow_unleashed_inventory_reference_${suffix}`)),
  'batch identity, durable rows, and append-only commands are separate');
check('four source quantities retained',
  ['qty_on_hand','allocated_qty','on_purchase_qty','available_qty_source'].every((field) => migration.includes(field)),
  'source semantics remain distinct');
check('durable snapshot provenance has no raw FK',
  /source_snapshot_id uuid not null,/.test(migration)
    && !/source_snapshot_id uuid[^;]+references public\.unleashed_raw_snapshots/is.test(migration),
  'raw retention cannot cascade into 339A evidence');
check('source set is content addressed',
  /source_set_sha256 text not null unique/.test(migration)
    && /extensions\.digest/.test(migration)
    && /order by s\.external_key/.test(migration),
  'PostgreSQL computes a deterministic SHA-256 over sorted source facts');
check('source rows are immutable', /IMMUTABLE_INVENTORY_REFERENCE_ROW/.test(migration),
  'UPDATE and DELETE fail closed');
check('commands are immutable', /IMMUTABLE_INVENTORY_REFERENCE_COMMAND/.test(migration),
  'command evidence cannot be rewritten');
check('batch source identity is immutable', /IMMUTABLE_INVENTORY_REFERENCE_BATCH_SOURCE/.test(migration),
  'run, boundary, hash, count, and stage identity are fixed');
check('stage is service-role-only',
  /grant execute on function public\.ecoflow_stage_unleashed_inventory_reference[\s\S]+to service_role/.test(migration)
    && /revoke all on function public\.ecoflow_stage_unleashed_inventory_reference[\s\S]+from public,anon,authenticated,service_role/.test(migration),
  'browser roles have no stage RPC execution');
check('stage validates successful governed scope',
  /r\.status='SUCCEEDED'/.test(migration)
    && /b\.resource='stock_on_hand' and b\.status='SUCCEEDED'/.test(migration),
  'run and stock batch must both succeed');
check('bad source facts fail closed',
  ['SOURCE_ROW_INVALID','DUPLICATE_PRODUCT_WAREHOUSE','OBSERVED_AFTER_BOUNDARY'].every((code) => migration.includes(code)),
  'missing, malformed, duplicate, and post-T evidence is rejected');
check('command replay is payload-bound',
  /COMMAND_REPLAY_PAYLOAD_MISMATCH/.test(migration) && /command_payload_sha256/.test(migration),
  'same command with changed content fails');
check('concurrent source staging is fenced',
  /pg_advisory_xact_lock/.test(migration) && /source_set_sha256 text not null unique/.test(migration),
  'transaction locks and decisive DB uniqueness prevent duplicates');
check('lifecycle is revisioned and governed',
  ['seal','reject','supersede'].every((verb) => migration.includes(`ecoflow_${verb}_unleashed_inventory_reference_batch`))
    && /INVENTORY_REFERENCE_REVISION_CONFLICT/.test(migration)
    && /OWNER_OR_ADMIN_REQUIRED/.test(migration),
  'Owner/Admin commands own accepted transitions');
check('all new tables use RLS',
  (migration.match(/enable row level security/g) ?? []).length === 3,
  'batch, row, and command tables are protected');
check('browser table DML is revoked',
  (migration.match(/revoke all on table public\.ecoflow_unleashed_inventory_reference_/g) ?? []).length >= 3,
  'authenticated callers receive SELECT only');
check('views are security invokers',
  (migration.match(/with \(security_invoker=on\)/g) ?? []).length === 2,
  'views obey underlying grants and RLS');
check('mapping ambiguity is explicit',
  ['PENDING_PRODUCT_MAPPING','AMBIGUOUS_PRODUCT_MAPPING','PENDING_WAREHOUSE_MAPPING','AMBIGUOUS_WAREHOUSE_MAPPING'].every((state) => migration.includes(state)),
  'missing and ambiguous mappings never guess');
check('warehouse total remains unassigned',
  /UNLEASHED_WAREHOUSE_TOTAL/.test(migration)
    && /null::uuid as quantity_assigned_physical_sku_id/.test(migration)
    && /null::uuid as quantity_assigned_location_id/.test(migration),
  'preferred identity is context, not quantity allocation');
check('forbidden authorities are untouched',
  !/(insert\s+into|update|delete\s+from)\s+public\.(?:ecoflow_physical_skus|ecoflow_commercial_family_links|ecoflow_warehouse_location_items|ecoflow_warehouse_movements|ecoflow_inventory_movements|ecoflow_stocktake_sessions)/i.test(migration),
  '339A performs no identity, location, stocktake, or movement write');
check('provider and Edge code are absent',
  !/api\.unleashedsoftware\.com|api-auth-id|api-auth-signature/i.test(migration)
    && /DB\/RPC contract is sufficient for 339A/.test(workPackage),
  '339A consumes existing snapshots only');
check('PostgreSQL 17 contract is reproducible',
  /postgres:17/.test(workflow)
    && /UNLEASHED_INVENTORY_REFERENCE_DB_CONTRACT_PASS/.test(contract),
  'dedicated CI runs migration and DB assertions');
check('boundary ownership is documented',
  /events `< T`/.test(workPackage) && /events `>= T`/.test(workPackage),
  'equality belongs to WAYNX; 339A does not activate authority');

for (const item of checks) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}: ${item.evidence}`);
}
const failed = checks.filter((item) => !item.pass);
console.log(`UNLEASHED_INVENTORY_REFERENCE_AUDIT ${failed.length ? 'FAIL' : 'PASS'} (${checks.length - failed.length}/${checks.length})`);
if (failed.length) process.exitCode = 1;
