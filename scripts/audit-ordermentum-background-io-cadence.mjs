#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile('.github/workflows/ordermentum-complete-mirror.yml', 'utf8');
const mirror = await readFile('scripts/ordermentum-complete-mirror.mjs', 'utf8');

function requireText(source, text, label) {
  assert.ok(source.includes(text), `${label} is missing required contract: ${text}`);
}

// Preserve explicit recovery and post-deployment verification paths.
requireText(workflow, 'workflow_dispatch:', 'complete-mirror workflow');
requireText(workflow, 'workflows: ["Deploy Supabase migrations"]', 'post-migration verification');
requireText(workflow, '- cron: "30 17 * * *"', 'daily recent reconciliation');
requireText(workflow, '- full_history', 'manual full-history option');
requireText(workflow, 'MIRROR_SCOPE=${{ inputs.scope }}', 'manual scope selection');
requireText(workflow, 'MIRROR_SCOPE=recent', 'automatic recent reconciliation');
requireText(workflow, 'Incremental verification after successful Supabase production deployment', 'post-migration incremental reason');
requireText(workflow, 'Daily recent commercial reconciliation', 'daily recent reason');

// Routine automation is incremental-first. Full history is an explicit operator
// action only; it must never be awakened by cadence, deployment or workflow edits.
assert.ok(!workflow.includes('45 18 * * 6'), 'weekly full-history schedule must stay removed');
assert.ok(!workflow.includes('Weekly history window reconciliation'), 'weekly full-history branch must stay removed');
assert.ok(!workflow.includes('Resume after successful Supabase production deployment'), 'post-deployment path must not auto-resume full history');
assert.ok(!workflow.includes('MIRROR_REASON=Release verification after complete-mirror workflow update'), 'workflow updates must not auto-run full history');
assert.ok(!workflow.includes('17 */2 * * *'), 'completed full-history mirror must not be scheduled every two hours');
assert.ok(!workflow.includes('Automatic two-hour checkpoint resume'), 'two-hour checkpoint-resume branch must stay removed');

const automatedBlock = workflow.slice(
  workflow.indexOf('if [ "${{ github.event_name }}" = "workflow_run" ]'),
  workflow.indexOf('else\n            echo "MIRROR_SCOPE=${{ inputs.scope }}"'),
);
assert.ok(automatedBlock.length > 0, 'automatic scope-resolution block must be discoverable');
assert.ok(!automatedBlock.includes('MIRROR_SCOPE=full_history'), 'no automatic event may select full_history');

// Keep fail-closed recovery mechanisms in the runner intact. Manual full-history
// remains resumable and must still require successful history verification.
requireText(mirror, "legacyScope === 'full_history' ? 'resume_history' : 'recent'", 'mirror scope mapping');
requireText(mirror, "'resume_history'", 'manual/full-history resume mode');
requireText(mirror, "'restart_history'", 'explicit full-history restart mode');
requireText(mirror, "if (history.state === 'COMPLETE')", 'completed-history verification path');
requireText(mirror, 'await verifyMirror(true)', 'history completeness verification');
requireText(mirror, 'ORDERMENTUM_STORAGE_GUARD', 'fail-closed storage guard');

console.log('Ordermentum background IO cadence audit passed: automatic runs are recent-only; full history remains explicit, resumable and fail-closed.');
