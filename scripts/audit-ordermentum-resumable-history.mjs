import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const migration = fs.readFileSync('supabase/migrations/20260715010000_ordermentum_resumable_history_pipeline.sql', 'utf8');
const pipeline = fs.readFileSync('scripts/ordermentum-history-pipeline.mjs', 'utf8');
const common = fs.readFileSync('scripts/ordermentum-history-common.mjs', 'utf8');
const catalog = fs.readFileSync('scripts/ordermentum-history-catalog.mjs', 'utf8');
const details = fs.readFileSync('scripts/ordermentum-history-details.mjs', 'utf8');
const orchestrator = fs.readFileSync('scripts/ordermentum-complete-mirror.mjs', 'utf8');
const master = fs.readFileSync('scripts/ordermentum-master-data-sync.mjs', 'utf8');
const finalise = fs.readFileSync('scripts/finalise-ordermentum-source-presence.mjs', 'utf8');
const verify = fs.readFileSync('scripts/verify-ordermentum-complete-mirror.mjs', 'utf8');

for (const fragment of ['ecoflow_ordermentum_history_runs','ecoflow_ordermentum_order_catalog','ecoflow_upsert_ordermentum_catalog_page','ecoflow_claim_ordermentum_detail_batch','for update skip locked','v_ecoflow_ordermentum_mirror_health_v3']) {
  assert.ok(migration.toLowerCase().includes(fragment.toLowerCase()), `Missing durable history contract: ${fragment}`);
}
assert.ok(common.includes("mode === 'restart'"), 'History pipeline must support explicit restart.');
assert.ok(common.includes('next_page'), 'Catalog checkpoint must be durable.');
assert.ok(common.includes('timeBudgetMinutes'), 'History work must carry a wall-clock budget.');
assert.ok(common.includes('ORDERMENTUM_HISTORY_RESTART_AFTER_DAYS'), 'Completed history must age into a fresh fixed window.');
assert.ok(catalog.includes('history_catalog_page'), 'Every completed catalog page must emit progress.');
assert.ok(details.includes('detail_claimed_at'), 'Cancelled detail claims must be recoverable.');
assert.ok(details.includes('maxDetailsPerSlice'), 'Detail work must be bounded per slice.');
assert.ok(pipeline.includes('PAUSED_CATALOG') && pipeline.includes('PAUSED_DETAILS'), 'Incomplete slices must pause cleanly.');
assert.ok(orchestrator.includes("'resume_history'"), 'Complete mirror must expose resumable history mode.');
assert.ok(orchestrator.includes('complete_mirror_paused'), 'Paused history must not be reported as complete.');
assert.ok(orchestrator.includes('finalisation_completed_at'), 'Completed finalisation must be checkpointed before verification.');
assert.ok(orchestrator.includes('complete_mirror_finalisation_reused') && orchestrator.includes('complete_mirror_finalisation_recovered'), 'Finalisation must be reusable after a verification failure.');
assert.ok(master.includes('detailSkippedUnchanged') && master.includes('detail-changed-only'), 'Unchanged master detail must be skipped.');
assert.ok(finalise.includes('ecoflow_ordermentum_order_catalog'), 'Full source presence must use the durable catalog.');
assert.ok(finalise.includes('refresh_ui_active_order_keys_deferred'), 'UI cache refresh must be non-blocking.');
assert.ok(!/v_ecoflow_ordermentum_mirror_health_v\d/i.test(verify), 'Final verification must not execute the heavy mirror-health view stack.');
assert.ok(verify.includes('LIGHTWEIGHT_DIRECT_V1') && verify.includes("'ordermentum_raw_orders'") && verify.includes("'om_orders'") && verify.includes("'om_invoices'"), 'Final completion must use direct lightweight source/projection checks.');
for (const script of ['scripts/ordermentum-complete-mirror.mjs', 'scripts/verify-ordermentum-complete-mirror.mjs']) {
  const syntax = spawnSync(process.execPath, ['--check', script], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, `${script} syntax error: ${syntax.stderr || syntax.stdout}`);
}
console.log('Resumable Ordermentum history pipeline audit passed.');
