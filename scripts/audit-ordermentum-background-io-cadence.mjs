#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [mirrorWorkflow, cloudWorkflow, storeRefreshWorkflow, masterRefreshWorkflow, mirror] = await Promise.all([
  readFile('.github/workflows/ordermentum-complete-mirror.yml', 'utf8'),
  readFile('.github/workflows/ordermentum-cloud-sync.yml', 'utf8'),
  readFile('.github/workflows/refresh-customer-stores-on-release.yml', 'utf8'),
  readFile('.github/workflows/refresh-master-catalog-after-migrations.yml', 'utf8'),
  readFile('scripts/ordermentum-complete-mirror.mjs', 'utf8'),
]);

function requireText(source, text, label) {
  assert.ok(source.includes(text), `${label} is missing required contract: ${text}`);
}

function requireManualOnly(source, label) {
  requireText(source, 'workflow_dispatch:', label);
  assert.ok(!/\n\s*push:\s*\n/.test(source), `${label} must not run automatically on push`);
  assert.ok(!/\n\s*workflow_run:\s*\n/.test(source), `${label} must not run automatically after another workflow`);
  assert.ok(!/\n\s*schedule:\s*\n/.test(source), `${label} must not have a schedule`);
}

// Routine order ingestion is high-watermark incremental and bounded to four
// scheduled runs per day. Recovery modes remain explicit operator actions.
requireText(cloudWorkflow, '- cron: "7 4,12,16,22 * * *"', 'cloud sync four-times-daily cadence');
requireText(cloudWorkflow, 'SYNC_MODE=orders_invoices', 'scheduled order/invoice delta mode');
requireText(cloudWorkflow, 'Scheduled four-times-daily high-watermark order and invoice delta', 'scheduled delta reason');
requireText(cloudWorkflow, '- catchup', 'manual catchup option');
assert.ok(!cloudWorkflow.includes('7,37 * * * *'), 'twice-hourly cloud sync cadence must stay removed');
assert.ok(!/\n\s*push:\s*\n/.test(cloudWorkflow), 'cloud sync must not auto-catchup on repository push');
requireText(cloudWorkflow, 'retention-days: 1', 'cloud sync one-day artifact retention');

// Preserve explicit recovery and post-deployment verification paths while
// keeping actual reconciliation rare.
requireText(mirrorWorkflow, 'workflow_dispatch:', 'complete-mirror workflow');
requireText(mirrorWorkflow, 'workflows: ["Deploy Supabase migrations"]', 'post-migration verification');
requireText(mirrorWorkflow, '- cron: "30 17 * * 0"', 'weekly recent reconciliation');
requireText(mirrorWorkflow, '- full_history', 'manual full-history option');
requireText(mirrorWorkflow, 'MIRROR_MODE=verify_only', 'post-migration verification-only mode');
requireText(mirrorWorkflow, 'MIRROR_MODE=recent', 'recent reconciliation mode');
requireText(mirrorWorkflow, 'MIRROR_MODE=resume_history', 'manual full-history resume mode');
requireText(mirrorWorkflow, 'Lightweight verification after successful Supabase production deployment', 'post-migration verification reason');
requireText(mirrorWorkflow, 'Weekly recent commercial reconciliation', 'weekly recent reason');
requireText(mirrorWorkflow, 'retention-days: 1', 'complete-mirror one-day artifact retention');
assert.ok(!/\n\s*push:\s*\n/.test(mirrorWorkflow), 'complete-mirror workflow must not self-trigger on push');
assert.ok(!mirrorWorkflow.includes('30 17 * * *'), 'daily recent reconciliation must stay removed');

const automatedBlock = mirrorWorkflow.slice(
  mirrorWorkflow.indexOf('if [ "${{ github.event_name }}" = "workflow_run" ]'),
  mirrorWorkflow.indexOf('else\n            if [ "${{ inputs.scope }}" = "full_history" ]'),
);
assert.ok(automatedBlock.length > 0, 'automatic mirror-mode block must be discoverable');
assert.ok(!automatedBlock.includes('resume_history'), 'no automatic event may resume full history');
assert.ok(!automatedBlock.includes('restart_history'), 'no automatic event may restart full history');

// Full customer/master refreshes are recovery/admin tools only. A code release
// or migration must never implicitly rescan all purchasers, products or variants.
requireManualOnly(storeRefreshWorkflow, 'customer-store full refresh');
requireManualOnly(masterRefreshWorkflow, 'master-catalog full refresh');
requireText(storeRefreshWorkflow, 'retention-days: 1', 'customer-store refresh one-day artifact retention');
requireText(masterRefreshWorkflow, 'retention-days: 1', 'master-catalog refresh one-day artifact retention');

// Keep fail-closed recovery mechanisms in the runner intact. Manual full-history
// remains resumable and must still require successful history verification.
requireText(mirror, "legacyScope === 'full_history' ? 'resume_history' : 'recent'", 'mirror legacy scope mapping');
requireText(mirror, "'resume_history'", 'manual/full-history resume mode');
requireText(mirror, "'restart_history'", 'explicit full-history restart mode');
requireText(mirror, "'verify_only'", 'verification-only mode');
requireText(mirror, "if (history.state === 'COMPLETE')", 'completed-history verification path');
requireText(mirror, 'await verifyMirror(true)', 'history completeness verification');
requireText(mirror, 'ORDERMENTUM_STORAGE_GUARD', 'fail-closed storage guard');

console.log('Ordermentum background IO cadence audit passed: four daily high-watermark deltas, weekly recent reconciliation, verification-only deployments, one-day artifacts, and manual-only full master/history refreshes.');
