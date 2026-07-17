#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const verifierPath = 'scripts/verify-ordermentum-complete-mirror.mjs';
const orchestratorPath = 'scripts/ordermentum-complete-mirror.mjs';
const workflowPath = '.github/workflows/ordermentum-complete-mirror.yml';
const sourceMissingMigrationPath = 'supabase/migrations/20260717140000_active_source_missing_details.sql';
const verifier = fs.readFileSync(verifierPath, 'utf8');
const orchestrator = fs.readFileSync(orchestratorPath, 'utf8');
const workflow = fs.readFileSync(workflowPath, 'utf8');
const sourceMissingMigration = fs.readFileSync(sourceMissingMigrationPath, 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const path of [verifierPath, orchestratorPath]) {
  const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
  assert(result.status === 0, `${path} failed syntax validation: ${result.stderr || result.stdout}`);
}

assert(!/v_ecoflow_ordermentum_mirror_health_v\d/i.test(verifier), 'Final verification must not query the heavy mirror-health view stack.');
for (const table of ['ordermentum_raw_orders', 'om_orders', 'ordermentum_raw_master_resources', 'om_invoices', 'ecoflow_ordermentum_order_catalog']) {
  assert(verifier.includes(`'${table}'`), `Lightweight verifier must read ${table} directly.`);
}
assert(verifier.includes('LIGHTWEIGHT_DIRECT_V4'), 'Lightweight verification v4 mode marker is missing.');
assert(verifier.includes('groupRawOrderAliases'), 'Raw orders must be counted as distinct source records.');
assert(verifier.includes('sourceBackedProjectedOrders'), 'Projected order count must use source-backed distinct records.');
assert(verifier.includes('sourceBackedProjectedInvoices'), 'Projected invoice count must exclude retained canonical rows absent from source.');
assert(verifier.includes("db.rpc('ecoflow_active_source_missing_order_details')"), 'Active source-missing details must be read from the operational contract.');
assert(verifier.includes('active_source_missing_order_details: activeSourceMissingDetails'), 'Exact active source-missing details must be persisted in snapshot metadata.');
assert(verifier.includes("degradedExitMode === 'transition'"), 'Verifier must support transition-only alerting.');
assert(verifier.includes('previousBlockerFingerprint'), 'Verifier must compare the current blocker set with the persisted previous set.');
assert(verifier.includes("degraded_alert_state: active.length === 0"), 'Snapshot must disclose degraded alert state.');
assert(verifier.includes('workflow_failure_suppressed: true'), 'Unchanged persistent blockers must remain visible without repeatedly failing the workflow.');
assert(orchestrator.includes('degraded-exit-mode'), 'Orchestrator must pass the degraded alert policy to verification.');
assert(orchestrator.includes("verification_mode: 'LIGHTWEIGHT_DIRECT_V4'"), 'History checkpoint metadata must record verification v4.');
assert(workflow.includes('--degraded-exit-mode=transition'), 'Scheduled complete mirror must alert only on new or changed blocker sets.');
assert(sourceMissingMigration.includes('ecoflow_active_source_missing_order_details'), 'Source-missing detail function is missing.');
assert(sourceMissingMigration.includes('internal_order_id'), 'Source-missing detail must include the internal workflow identity.');
assert(sourceMissingMigration.includes('warehouse_gate_status'), 'Source-missing detail must include the warehouse state.');
assert(!sourceMissingMigration.includes('ecoflow_ui_active_order_keys'), 'Mirror detail verification must not depend on the UI cache.');

console.log(JSON.stringify({
  action: 'audit_ordermentum_lightweight_verification',
  status: 'passed',
  verifier: verifierPath,
  orchestrator: orchestratorPath,
  workflow: workflowPath,
}, null, 2));
