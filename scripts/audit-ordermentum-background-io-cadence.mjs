#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile('.github/workflows/ordermentum-complete-mirror.yml', 'utf8');
const mirror = await readFile('scripts/ordermentum-complete-mirror.mjs', 'utf8');

function requireText(source, text, label) {
  assert.ok(source.includes(text), `${label} is missing required contract: ${text}`);
}

// Preserve the deliberate verification/reconciliation paths.
requireText(workflow, 'workflow_dispatch:', 'complete-mirror workflow');
requireText(workflow, 'workflows: ["Deploy Supabase migrations"]', 'post-migration verification');
requireText(workflow, '- cron: "30 17 * * *"', 'daily recent reconciliation');
requireText(workflow, '- cron: "45 18 * * 6"', 'weekly full-history verification');
requireText(workflow, 'MIRROR_SCOPE=full_history', 'full-history verification path');
requireText(workflow, 'MIRROR_SCOPE=recent', 'recent reconciliation path');
requireText(workflow, 'Resume after successful Supabase production deployment', 'post-migration verification reason');
requireText(workflow, 'Weekly history window reconciliation', 'weekly history reason');
requireText(workflow, 'Daily recent commercial reconciliation', 'daily recent reason');

// A completed history mirror must not wake up every two hours just to re-read
// its checkpoint and completeness counters. Manual dispatch and the weekly gate
// remain available if the durable history job ever needs to be resumed.
assert.ok(
  !workflow.includes('17 */2 * * *'),
  'completed full-history mirror must not be scheduled every two hours',
);
assert.ok(
  !workflow.includes('Automatic two-hour checkpoint resume'),
  'two-hour checkpoint-resume branch must be removed with its cron trigger',
);

// Keep the recovery mechanisms in the underlying runner intact; this hotfix is
// a cadence change only, not a change to mirror semantics.
requireText(mirror, "legacyScope === 'full_history' ? 'resume_history' : 'recent'", 'mirror scope mapping');
requireText(mirror, "'resume_history'", 'manual/full-history resume mode');
requireText(mirror, "if (history.state === 'COMPLETE')", 'completed-history verification path');
requireText(mirror, 'await verifyMirror(true)', 'history completeness verification');

console.log('Ordermentum background IO cadence audit passed: no two-hour full-history wake-up; daily, weekly, manual and post-migration safety paths remain.');
