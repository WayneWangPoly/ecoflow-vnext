import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migrationPath = 'supabase/migrations/20260826124500_warehouse_first_seen_commissioning.sql';
const repoPath = 'src/data/repositories/warehouseFirstSeenCommissioning.ts';
const panelPath = 'src/features/operationalStability/WarehouseFirstSeenCommissioningPanel.tsx';
const workspacePath = 'src/features/operationalStability/WarehouseControlWorkspaceV3.tsx';

const migration = readFileSync(migrationPath, 'utf8');
const repository = readFileSync(repoPath, 'utf8');
const panel = readFileSync(panelPath, 'utf8');
const workspace = readFileSync(workspacePath, 'utf8');

function functionBody(name) {
  const start = migration.indexOf(`create or replace function public.${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = migration.indexOf(`revoke all on function public.${name}`, start);
  assert.notEqual(end, -1, `${name} revoke boundary must exist`);
  return migration.slice(start, end);
}

test('first-seen command is warehouse-capable but narrow and fail-closed', () => {
  const body = functionBody('ecoflow_commission_first_seen_barcode_v1');
  assert.match(body, /v_role not in \('OWNER','ADMIN','WAREHOUSE'\)/);
  assert.match(body, /pg_advisory_xact_lock/);
  assert.match(body, /FIRST_SEEN_IDEMPOTENCY_CONFLICT/);
  assert.match(body, /BARCODE_ALREADY_HAS_CANONICAL_HISTORY/);
  assert.match(body, /PHYSICAL_SKU_REPARENT_NOT_ALLOWED/);
  assert.match(body, /PACKAGE_CONVERSION_CHANGE_NOT_ALLOWED/);
  assert.match(body, /COMMERCIAL_FAMILY_REPLACEMENT_NOT_ALLOWED/);
  assert.match(body, /SUBSTITUTION_POLICY_CHANGE_NOT_ALLOWED/);
  assert.match(body, /PREFERRED_PHYSICAL_REPLACEMENT_NOT_ALLOWED/);
  assert.match(body, /FIRST_COMMERCIAL_LINK_REQUIRES_PREFERRED_PHYSICAL/);
  assert.match(body, /ecoflow_resolve_operational_barcode\(v_barcode,v_commercial_code\)/);
  assert.match(body, /FIRST_SEEN_POSTCONDITION_FAILED/);
});

test('first-seen identity setup cannot mutate operational quantities', () => {
  const body = functionBody('ecoflow_commission_first_seen_barcode_v1');
  const forbidden = [
    'ecoflow_inventory_movements',
    'ecoflow_inventory_balances',
    'ecoflow_warehouse_receiving',
    'ecoflow_stocktake_observations',
    'ecoflow_stocktake_location_progress',
    'ecoflow_stocktake_sessions',
    'ecoflow_pick',
    'ecoflow_delivery',
  ];
  for (const table of forbidden) {
    assert.doesNotMatch(
      body,
      new RegExp(`(?:insert\\s+into|update|delete\\s+from)\\s+public\\.${table}`, 'i'),
      `commissioning must not mutate ${table}`,
    );
  }
  assert.match(body, /ecoflow_inventory_sku_controls/);
});

test('barcode history and audit provenance remain protected', () => {
  assert.match(migration, /barcode text not null unique/);
  assert.match(migration, /revoke all on table public\.ecoflow_warehouse_first_seen_commissions from public,anon,authenticated/);
  assert.match(migration, /grant select on table public\.ecoflow_warehouse_first_seen_commissions to authenticated/);
  assert.match(migration, /source_context text not null default 'WAREHOUSE_FIRST_SEEN'/);
  assert.match(migration, /actor_role text not null check \(actor_role in \('OWNER','ADMIN','WAREHOUSE'\)\)/);
});

test('stocktake resolves through canonical Product Identity only', () => {
  const body = functionBody('ecoflow_record_stocktake_observation');
  assert.match(body, /ecoflow_resolve_operational_barcode\(v_barcode,v_sku\)/);
  assert.doesNotMatch(body, /ecoflow_sku_barcode_registry/);
  assert.match(body, /UNKNOWN_BARCODE/);
  assert.match(body, /BARCODE_SKU_MISMATCH/);
});

test('client always sends an RFC UUID-shaped command id', () => {
  assert.match(repository, /normalizeFirstSeenCommandId/);
  assert.match(repository, /uuidPattern/);
  assert.match(repository, /bytes\[6\] = \(bytes\[6\] & 0x0f\) \| 0x40/);
  assert.match(repository, /bytes\[8\] = \(bytes\[8\] & 0x3f\) \| 0x80/);
  assert.match(repository, /p_command_id: normalizeFirstSeenCommandId\(input\.commandId\)/);
  assert.match(repository, /ecoflow_commission_first_seen_barcode_v1/);
});

test('live Warehouse Control exposes first-seen flow without making Survey a prerequisite', () => {
  assert.match(workspace, /useState<'live' \| 'survey' \| 'inventory'>\('live'\)/);
  assert.match(workspace, /<WarehouseFirstSeenCommissioningPanel role=\{role\} \/>/);
  assert.match(workspace, /Live Barcode/);
  assert.match(workspace, /Barcode Survey/);
  assert.match(panel, /resolution\?\.resolutionStatus !== 'UNKNOWN'/);
  assert.match(panel, /This barcode is now canonical for Receiving, Stocktake and Pick/);
  assert.match(panel, /does <strong>not<\/strong> change stock quantity/);
});
