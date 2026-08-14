import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const migration = fs.readFileSync('supabase/migrations/20260715010000_ordermentum_resumable_history_pipeline.sql', 'utf8');
const snapshotMigration = fs.readFileSync('supabase/migrations/20260717001000_ordermentum_mirror_status_snapshot.sql', 'utf8');
const sourceMissingMigration = fs.readFileSync('supabase/migrations/20260717130000_active_source_missing_operational_definition.sql', 'utf8');
const sourceMissingDetailsMigration = fs.readFileSync('supabase/migrations/20260717140000_active_source_missing_details.sql', 'utf8');
const pipeline = fs.readFileSync('scripts/ordermentum-history-pipeline.mjs', 'utf8');
const common = fs.readFileSync('scripts/ordermentum-history-common.mjs', 'utf8');
const catalog = fs.readFileSync('scripts/ordermentum-history-catalog.mjs', 'utf8');
const details = fs.readFileSync('scripts/ordermentum-history-details.mjs', 'utf8');
const orchestrator = fs.readFileSync('scripts/ordermentum-complete-mirror.mjs', 'utf8');
const master = fs.readFileSync('scripts/ordermentum-master-data-sync.mjs', 'utf8');
const finalise = fs.readFileSync('scripts/finalise-ordermentum-source-presence.mjs', 'utf8');
const verify = fs.readFileSync('scripts/verify-ordermentum-complete-mirror.mjs', 'utf8');
const settingsLoader = fs.readFileSync('src/features/team/ordermentumSync.ts', 'utf8');

for (const fragment of ['ecoflow_ordermentum_history_runs','ecoflow_ordermentum_order_catalog','ecoflow_upsert_ordermentum_catalog_page','ecoflow_claim_ordermentum_detail_batch','for update skip locked','v_ecoflow_ordermentum_mirror_health_v3']) {
  assert.ok(migration.toLowerCase().includes(fragment.toLowerCase()), `Missing durable history contract: ${fragment}`);
}
assert.ok(snapshotMigration.includes('ecoflow_ordermentum_mirror_status_snapshot'), 'Mirror status snapshot table is missing.');
assert.ok(snapshotMigration.includes('grant select') && snapshotMigration.includes('to authenticated'), 'Authenticated users must be able to read the mirror status snapshot.');
assert.ok(sourceMissingMigration.includes('ecoflow_count_active_source_missing_orders'), 'Operational source-missing definition is missing.');
assert.ok(sourceMissingMigration.includes('d.internal_order_id is not null'), 'Retained source-missing history must only block when an internal workflow exists.');
assert.ok(sourceMissingDetailsMigration.includes('ecoflow_active_source_missing_order_details'), 'Active source-missing detail contract is missing.');

assert.ok(common.includes("mode === 'restart'"), 'History pipeline must support explicit restart.');
assert.ok(common.includes('next_page'), 'Catalog checkpoint must be durable.');
assert.ok(common.includes('timeBudgetMinutes'), 'History work must carry a wall-clock budget.');
assert.ok(common.includes('ctx.run = completed.data || await createRun()'), 'Completed history must remain the durable baseline for routine resume.');
assert.ok(!common.includes('ORDERMENTUM_HISTORY_RESTART_AFTER_DAYS'), 'Routine resume must not age a completed baseline into a new full-history run.');
assert.ok(common.includes('cancel superseded history checkpoints'), 'Explicit restart must still cancel superseded incomplete checkpoints safely.');

assert.ok(catalog.includes('history_catalog_page'), 'Every completed catalog page must emit progress.');
assert.ok(details.includes('detail_claimed_at'), 'Cancelled detail claims must be recoverable.');
assert.ok(details.includes('maxDetailsPerSlice'), 'Detail work must be bounded per slice.');
assert.ok(pipeline.includes('PAUSED_CATALOG') && pipeline.includes('PAUSED_DETAILS'), 'Incomplete slices must pause cleanly.');
assert.ok(orchestrator.includes("'resume_history'"), 'Complete mirror must expose resumable history mode.');
assert.ok(orchestrator.includes("'restart_history'"), 'Complete mirror must expose explicit history restart mode.');
assert.ok(orchestrator.includes('complete_mirror_paused'), 'Paused history must not be reported as complete.');
assert.ok(orchestrator.includes('finalisation_completed_at'), 'Completed finalisation must be checkpointed before verification.');
assert.ok(orchestrator.includes('complete_mirror_finalisation_reused') && orchestrator.includes('complete_mirror_finalisation_recovered'), 'Finalisation must be reusable after a verification failure.');
assert.ok(orchestrator.includes('degraded-exit-mode'), 'Orchestrator must carry the degraded alert policy.');
assert.ok(orchestrator.includes("`--touch-unchanged=${scope === 'full_history' ? 'true' : 'false'}`"), 'Only full-history verification may touch unchanged master rows.');
assert.ok(master.includes('detailSkippedUnchanged') && master.includes('detail-changed-only'), 'Unchanged master detail must be skipped.');
assert.ok(master.includes('recordsUnchanged') && master.includes('touchUnchanged'), 'Master sync must expose incremental unchanged-row behavior.');
assert.ok(finalise.includes('ecoflow_ordermentum_order_catalog'), 'Full source presence must use the durable catalog.');
assert.ok(finalise.includes('refresh_ui_active_order_keys_deferred'), 'UI cache refresh must be non-blocking.');
assert.ok(!/v_ecoflow_ordermentum_mirror_health_v\d/i.test(verify), 'Final verification must not execute the heavy mirror-health view stack.');
assert.ok(verify.includes('LIGHTWEIGHT_DIRECT_V4') && verify.includes("'ordermentum_raw_orders'") && verify.includes("'om_orders'") && verify.includes("'om_invoices'"), 'Final completion must use direct lightweight source/projection checks.');
assert.ok(verify.includes("db.rpc('ecoflow_active_source_missing_order_details')"), 'Final completion must use the operational source-missing detail definition.');
assert.ok(verify.includes('previousBlockerFingerprint'), 'Persistent degraded blocker alerts must be deduplicated.');
assert.ok(verify.includes("from('ecoflow_ordermentum_mirror_status_snapshot').upsert"), 'Final verification must persist the lightweight status snapshot.');
assert.ok(settingsLoader.indexOf("from('ecoflow_ordermentum_mirror_status_snapshot')") < settingsLoader.indexOf("'v_ecoflow_ordermentum_mirror_health_v3'"), 'Settings must read the snapshot before legacy heavy health views.');

for (const script of ['scripts/ordermentum-complete-mirror.mjs', 'scripts/verify-ordermentum-complete-mirror.mjs']) {
  const syntax = spawnSync(process.execPath, ['--check', script], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, `${script} syntax error: ${syntax.stderr || syntax.stdout}`);
}

console.log('Resumable Ordermentum history pipeline audit passed: completed history is a durable baseline, explicit restart remains available, and incremental automation does not weaken completeness verification.');
