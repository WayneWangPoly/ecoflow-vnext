import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const facadePath = new URL('../src/data/repositories/operationalStability.ts', import.meta.url);
const workspacePath = new URL('../src/features/operationalStability/OperationalStabilityWorkspaceV2.tsx', import.meta.url);

const facade = readFileSync(facadePath, 'utf8');
const workspace = readFileSync(workspacePath, 'utf8');

test('stocktake approval feedback is sourced from the authoritative RPC result', () => {
  assert.match(facade, /approveStocktake as approveStocktakeV2/);
  assert.match(facade, /await approveStocktakeV2\(input, client\)/);
  assert.match(facade, /result\?\.session_status/);
  assert.match(facade, /result\?\.revision/);
  assert.match(facade, /result\?\.adjustment_count/);
  assert.match(facade, /Stocktake approval succeeded\./);
  assert.match(facade, /window\.alert/);
  assert.match(facade, /return result;/);
});

test('feedback facade does not add a second inventory authority path', () => {
  assert.doesNotMatch(facade, /\.rpc\(/);
  assert.doesNotMatch(facade, /from\(['"]ecoflow_warehouse_location_items['"]\)/);
  assert.doesNotMatch(facade, /from\(['"]ecoflow_warehouse_movements['"]\)/);
  assert.doesNotMatch(facade, /from\(['"]ecoflow_inventory_movements['"]\)/);
  assert.doesNotMatch(facade, /\.(insert|update|delete|upsert)\(/);
});

test('warehouse control still imports approval through the facade', () => {
  assert.match(workspace, /approveStocktake,/);
  assert.match(workspace, /@\/data\/repositories\/operationalStability/);
  assert.match(workspace, /Approve and post balances/);
});
