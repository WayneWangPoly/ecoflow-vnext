#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const verifierPath = 'scripts/verify-ordermentum-complete-mirror.mjs';
const orchestratorPath = 'scripts/ordermentum-complete-mirror.mjs';
const sourceMissingMigrationPath = 'supabase/migrations/20260717130000_active_source_missing_operational_definition.sql';
const verifier = fs.readFileSync(verifierPath, 'utf8');
const orchestrator = fs.readFileSync(orchestratorPath, 'utf8');
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
assert(verifier.includes('LIGHTWEIGHT_DIRECT_V3'), 'Lightweight verification v3 mode marker is missing.');
assert(verifier.includes('groupRawOrderAliases'), 'Raw orders must be counted as distinct source records, not as both UUID and order-number aliases.');
assert(verifier.includes('sourceBackedProjectedOrders'), 'Projected order count must use source-backed distinct records.');
assert(verifier.includes('sourceBackedProjectedInvoices'), 'Projected invoice count must exclude retained canonical rows that are absent from the current source mirror.');
assert(verifier.includes("count_semantics: 'source-backed distinct records'"), 'Snapshot metadata must state its counting semantics.');
assert(verifier.includes("db.rpc('ecoflow_count_active_source_missing_orders')"), 'Active source-missing count must come from the operational workflow-state contract.');
assert(verifier.includes("['active source-missing orders', activeSourceMissingOrders]"), 'Genuinely active source-missing orders must remain a hard mirror blocker.');
assert(verifier.includes('unknownRecentStatuses'), 'Unknown recent source statuses must be computed rather than hardcoded.');
assert(verifier.includes('!sourceMissingOrderKeys.has(text(row.id))'), 'Retained source-missing history must not be classified as a current source-status review.');
assert(!verifier.includes('active_source_missing_orders: 0'), 'Active source-missing status must never be hardcoded to zero.');
assert(!verifier.includes('unknown_recent_statuses: 0'), 'Unknown current status count must never be hardcoded to zero.');
assert(sourceMissingMigration.includes('ecoflow_count_active_source_missing_orders'), 'Operational source-missing count function is missing.');
assert(sourceMissingMigration.includes('v_ecoflow_ordermentum_internal_order_drafts_v3'), 'Source-missing activity must be grounded in internal workflow state.');
assert(sourceMissingMigration.includes('d.internal_order_id is not null'), 'A retained source-missing order cannot be active without an internal EcoFlow order.');
assert(!sourceMissingMigration.includes('ecoflow_ui_active_order_keys'), 'Mirror verification must not depend on the UI acceleration cache.');
assert(orchestrator.includes('finalisation_completed_at'), 'Finalisation completion must be persisted before verification.');
assert(orchestrator.includes('complete_mirror_finalisation_reused'), 'Finalisation checkpoint reuse log is missing.');
assert(orchestrator.includes('complete_mirror_finalisation_recovered'), 'Recovery of the already-completed production finalisation is missing.');
assert(orchestrator.indexOf('await ensureHistoryFinalised(historyRunId);') < orchestrator.indexOf('await verifyMirror(false);'), 'Finalisation must be checkpointed before verification.');

console.log(JSON.stringify({
  action: 'audit_ordermentum_lightweight_verification',
  status: 'passed',
  verifier: verifierPath,
  orchestrator: orchestratorPath,
}, null, 2));
