import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/20260903170435_unleashed_inventory_reference.sql');
const dbContract = read('scripts/unleashed-inventory-reference-db-contract-test.sql');
const audit = read('scripts/audit-unleashed-inventory-reference.mjs');
const workflow = read('.github/workflows/unleashed-inventory-reference-check.yml');
const workPackage = read('docs/engineering/work-packages/UNLEASHED-MIGRATION-004-inventory-reference.md');
const packageJson = JSON.parse(read('package.json'));

test('339A is an additive reference package over the existing authorities', () => {
  for (const dependency of [
    'public.ecoflow_unleashed_master_mappings',
    'public.ecoflow_commercial_family_links',
    'public.ecoflow_sku_families',
    'public.ecoflow_physical_skus',
    'public.warehouses',
  ]) assert.match(migration, new RegExp(dependency.replaceAll('.', '\\.')));

  assert.match(migration, /UNLEASHED_INVENTORY_REFERENCE_DEPENDENCIES_MISSING/);
  assert.doesNotMatch(migration, /create table (?:if not exists )?public\.ecoflow_unleashed_master_mappings/i);
  assert.doesNotMatch(migration, /create table (?:if not exists )?public\.(?:inventory_balances|ecoflow_warehouse_location_items|ecoflow_warehouse_movements|ecoflow_inventory_movements)/i);
});

test('schema preserves immutable source boundary and all four quantity semantics', () => {
  for (const relation of [
    'ecoflow_unleashed_inventory_reference_batches',
    'ecoflow_unleashed_inventory_reference_rows',
    'ecoflow_unleashed_inventory_reference_commands',
  ]) assert.match(migration, new RegExp(`create table public\\.${relation}`));

  for (const field of [
    'source_run_id', 'as_at', 'source_set_sha256', 'source_row_count',
    'source_snapshot_id', 'source_external_key', 'source_payload_sha256',
    'source_row_sha256', 'source_product_guid', 'source_product_code',
    'source_warehouse_id', 'source_warehouse_code', 'qty_on_hand',
    'allocated_qty', 'on_purchase_qty', 'available_qty_source',
    'source_last_modified_at', 'source_observed_at',
  ]) assert.match(migration, new RegExp(`\\b${field}\\b`));

  assert.match(migration, /unique\(batch_id,source_product_guid,source_warehouse_id\)/);
  assert.match(migration, /source_snapshot_id uuid not null,/);
  assert.doesNotMatch(migration, /source_snapshot_id uuid[^;]+references public\.unleashed_raw_snapshots/is);
  assert.match(migration, /IMMUTABLE_INVENTORY_REFERENCE_ROW/);
  assert.match(migration, /IMMUTABLE_INVENTORY_REFERENCE_BATCH_SOURCE/);
  assert.match(migration, /IMMUTABLE_INVENTORY_REFERENCE_COMMAND/);
});

test('stage is service-only, payload-bound, boundary-locked, and fail-closed', () => {
  assert.match(migration, /ecoflow_stage_unleashed_inventory_reference\(/);
  assert.match(migration, /grant execute on function public\.ecoflow_stage_unleashed_inventory_reference[\s\S]+to service_role/);
  assert.match(migration, /revoke all on function public\.ecoflow_stage_unleashed_inventory_reference[\s\S]+from public,anon,authenticated,service_role/);
  assert.match(migration, /COMMAND_REPLAY_PAYLOAD_MISMATCH/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /source_set_sha256 text not null unique/);
  for (const rejection of [
    'INVENTORY_REFERENCE_SOURCE_RUN_NOT_SUCCESSFUL',
    'INVENTORY_REFERENCE_STOCK_SCOPE_NOT_SUCCESSFUL',
    'INVENTORY_REFERENCE_SOURCE_SET_EMPTY',
    'INVENTORY_REFERENCE_SOURCE_ROW_INVALID',
    'INVENTORY_REFERENCE_OBSERVED_AFTER_BOUNDARY',
    'INVENTORY_REFERENCE_DUPLICATE_PRODUCT_WAREHOUSE',
    'INVENTORY_REFERENCE_SOURCE_SET_ALREADY_STAGED',
  ]) assert.match(migration, new RegExp(rejection));
});

test('canonical hash is computed inside PostgreSQL from sorted durable facts', () => {
  assert.match(migration, /extensions\.digest/);
  assert.match(migration, /sourceRunId/);
  assert.match(migration, /sourceExternalKey/);
  assert.match(migration, /sourcePayloadSha256/);
  assert.match(migration, /productGuid/);
  assert.match(migration, /warehouseId/);
  assert.match(migration, /qtyOnHand/);
  assert.match(migration, /allocatedQty/);
  assert.match(migration, /onPurchase/);
  assert.match(migration, /availableQty/);
  assert.match(migration, /order by s\.external_key/);
  assert.match(migration, /ecoflow_compute_unleashed_inventory_reference_set/);
  assert.match(migration, /INVENTORY_REFERENCE_PROVENANCE_MISMATCH/);
});

test('seal reject and supersede use the governed revisioned command envelope', () => {
  for (const rpc of [
    'ecoflow_seal_unleashed_inventory_reference_batch',
    'ecoflow_reject_unleashed_inventory_reference_batch',
    'ecoflow_supersede_unleashed_inventory_reference_batch',
  ]) {
    assert.match(migration, new RegExp(`create or replace function public\\.${rpc}`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${rpc}[\\s\\S]+to authenticated`));
  }
  assert.match(migration, /OWNER_OR_ADMIN_REQUIRED/);
  assert.match(migration, /INVENTORY_REFERENCE_REVISION_CONFLICT/);
  assert.match(migration, /batch_status in \('STAGED','SEALED','REJECTED','SUPERSEDED'\)/);
  assert.match(migration, /command_type in \('STAGE','SEAL','REJECT','SUPERSEDE'\)/);
});

test('RLS and invoker views expose read evidence without browser DML', () => {
  for (const relation of [
    'batches', 'rows', 'commands',
  ]) {
    assert.match(migration, new RegExp(`ecoflow_unleashed_inventory_reference_${relation} enable row level security`));
    assert.match(migration, new RegExp(`revoke all on table public\\.ecoflow_unleashed_inventory_reference_${relation} from public,anon,authenticated`));
  }
  assert.match(migration, /in \('OWNER','ADMIN','WAREHOUSE'\)/);
  assert.match(migration, /v_ecoflow_unleashed_inventory_reference_rows\nwith \(security_invoker=on\)/);
  assert.match(migration, /v_ecoflow_unleashed_inventory_reference_batch_summary\nwith \(security_invoker=on\)/);
  assert.match(migration, /security definer\nset search_path = ''/);
});

test('readiness is explicit and warehouse totals remain unassigned', () => {
  for (const status of [
    'PENDING_PRODUCT_MAPPING',
    'AMBIGUOUS_PRODUCT_MAPPING',
    'PENDING_WAREHOUSE_MAPPING',
    'AMBIGUOUS_WAREHOUSE_MAPPING',
    'PENDING_PHYSICAL_IDENTITY',
    'READY_FOR_LOCATION_EVIDENCE',
  ]) assert.match(migration, new RegExp(status));

  assert.match(migration, /UNLEASHED_WAREHOUSE_TOTAL/);
  assert.match(migration, /null::uuid as quantity_assigned_physical_sku_id/);
  assert.match(migration, /null::uuid as quantity_assigned_location_id/);
  assert.match(migration, /available_qty_source-\(r\.qty_on_hand-r\.allocated_qty\)/);
});

test('339A has no provider, Product Identity, stocktake, location, or ledger write', () => {
  for (const forbiddenWrite of [
    'ecoflow_physical_skus',
    'ecoflow_commercial_family_links',
    'ecoflow_warehouse_location_items',
    'ecoflow_warehouse_movements',
    'ecoflow_inventory_movements',
    'ecoflow_stocktake_sessions',
  ]) assert.doesNotMatch(migration, new RegExp(`(?:insert\\s+into|update|delete\\s+from)\\s+public\\.${forbiddenWrite}`, 'i'));
  assert.doesNotMatch(migration, /api\.unleashedsoftware\.com|api-auth-id|api-auth-signature/i);
  assert.equal(migration.includes('supabase/functions/'), false);
  assert.match(workPackage, /Edge Functions: the DB\/RPC contract is sufficient for 339A/);
});

test('DB contract and workflow cover replay, retention, roles, readiness, and zero effect', () => {
  for (const evidence of [
    'COMMAND_REPLAY_PAYLOAD_MISMATCH',
    'INVENTORY_REFERENCE_SOURCE_SET_ALREADY_STAGED',
    'IMMUTABLE_INVENTORY_REFERENCE_ROW',
    'READY_FOR_LOCATION_EVIDENCE',
    'OWNER_OR_ADMIN_REQUIRED',
    'ecoflow_warehouse_location_items',
    'ecoflow_warehouse_movements',
    'ecoflow_inventory_movements',
    'ecoflow_stocktake_sessions',
    'UNLEASHED_INVENTORY_REFERENCE_DB_CONTRACT_PASS',
  ]) assert.match(dbContract, new RegExp(evidence));

  assert.match(workflow, /postgres:17/);
  assert.match(workflow, /unleashed-inventory-reference-contract\.test\.mjs/);
  assert.match(workflow, /unleashed-inventory-reference-db-contract-test\.sql/);
  assert.match(workflow, /audit-unleashed-inventory-reference\.mjs/);
  assert.match(audit, /UNLEASHED_INVENTORY_REFERENCE_AUDIT/);
  assert.equal(
    packageJson.scripts['audit:unleashed-inventory-reference'],
    'node --experimental-strip-types --test scripts/unleashed-inventory-reference-contract.test.mjs && node scripts/audit-unleashed-inventory-reference.mjs',
  );
});
