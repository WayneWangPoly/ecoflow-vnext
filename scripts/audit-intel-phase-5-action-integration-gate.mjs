import './audit-intel-action-handoff.mjs';
import './audit-intel-safe-inline-actions.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  assert.ok(fs.existsSync(path), `Phase 5 gate prerequisite missing: ${path}`);
  return fs.readFileSync(path, 'utf8');
}

const root = 'src/features/intelligence/analytics/actionIntegration';
const handoff = read(`${root}/actionHandoffContract.ts`);
const inline = read(`${root}/safeInlineActionContract.ts`);
const panel = read(`${root}/ActionIntegrationPanel.tsx`);
const style = read(`${root}/actionIntegrationWorkspace.css`);
const workspace = read('src/features/intelligence/analytics/OperationalPulseReadinessWorkspace.tsx');
const lifecycle = read('src/features/intelligence/attention/actionableExceptionLifecycleContract.ts');
const modal = read('src/features/intelligence/attention/ExceptionLifecycleCommitModal.tsx');
const documentation = read('docs/INTEL-PHASE-5-ACTION-INTEGRATION.md');

const handoffKeys = [
  'OPEN_ORDER',
  'OPEN_INVENTORY',
  'OPEN_CUSTOMER',
  'OPEN_ROUTE',
  'OPEN_EXCEPTION',
];

for (const key of handoffKeys) {
  assert.ok(handoff.includes(`'${key}'`), `Phase 5 handoff missing: ${key}`);
}
assert.equal((handoff.match(/^  'OPEN_[A-Z_]+'[,]?$/gm) ?? []).length, 5, 'Phase 5 must expose exactly five canonical handoff keys');
for (const marker of [
  "source: 'domain-intelligence'",
  'buildActionHandoff',
  'validateActionHandoffRegistry',
  "query.set('source', context.source)",
  "query.set('domain', context.domain)",
  "query.set('handoff', context.handoff)",
  "issues.push({ code: 'INVALID_ENTITY_ID'",
  "issues.push({ code: 'INVALID_EXCEPTION_ID'",
  "issues.push({ code: 'INVALID_SOURCE_TIMESTAMP'",
]) {
  assert.ok(handoff.includes(marker), `Phase 5 bounded handoff evidence missing: ${marker}`);
}

const inlineKeys = [
  'EXCEPTION_LIFECYCLE',
  'ORDER_RELEASE',
  'INVENTORY_MUTATION',
  'CUSTOMER_MUTATION',
  'ROUTE_CONTROL',
  'RETURN_DISPOSITION',
];
for (const key of inlineKeys) {
  assert.ok(inline.includes(`'${key}'`), `Phase 5 inline action family missing: ${key}`);
}
assert.equal((inline.match(/eligibility: 'AVAILABLE'/g) ?? []).length, 1, 'Phase 5 must expose exactly one migrated inline command family');
assert.equal((inline.match(/eligibility: 'BLOCKED'/g) ?? []).length, 5, 'Phase 5 must keep five non-migrated command families blocked');

for (const marker of [
  "key: 'EXCEPTION_LIFECYCLE'",
  "serverCommand: 'apply_actionable_exception_lifecycle_command'",
  'server lifecycle version and transition checks',
  'commandId UUID with APPLIED or REPLAYED result',
  'server lifecycle access envelope and per-row action capability',
  "'accepted'",
  "'conflict'",
  "'rejected'",
  "'replay'",
  "'network-unknown'",
  "result.data.commandStatus === 'APPLIED'",
  "result.data.commandStatus === 'REPLAYED'",
  "result.state === 'conflict'",
  "result.state === 'failed'",
  'validateSafeInlineActionRegistry',
]) {
  assert.ok(inline.includes(marker), `Phase 5 inline command evidence missing: ${marker}`);
}

for (const marker of [
  "actionableExceptionLifecycleCommandRpcName = 'apply_actionable_exception_lifecycle_command'",
  "commandStatus: 'APPLIED' | 'REPLAYED' | 'UNKNOWN'",
  "| 'conflict'",
  "| 'forbidden'",
  "| 'invalid'",
  "| 'unavailable'",
  "| 'failed'",
]) {
  assert.ok(lifecycle.includes(marker), `Phase 5 migrated lifecycle command evidence missing: ${marker}`);
}
for (const marker of [
  'globalThis.crypto?.randomUUID?.()',
  'await onCommit({',
  'commandId,',
  'onConflict();',
  'server access envelope',
]) {
  assert.ok(modal.includes(marker), `Phase 5 migrated lifecycle modal evidence missing: ${marker}`);
}

for (const marker of [
  'PHASE 5 · ACTION INTEGRATION',
  'Governed operational handoff',
  'NO DIRECT WRITES',
  'SAFE INLINE ACTIONS',
  'Command migration eligibility',
  'Context only · no command execution',
  'Inline action blocked',
  'accepted, conflict, rejected, replay and network-unknown',
]) {
  assert.ok(panel.includes(marker), `Phase 5 presentation marker missing: ${marker}`);
}
assert.ok(workspace.includes('<ActionIntegrationPanel />'), 'Phase 5 Action Integration panel is not mounted in Analytics');

for (const marker of [
  '@media (max-width: 1200px)',
  '@media (max-width: 820px)',
  '@media (max-width: 560px)',
  '@media (prefers-reduced-motion: reduce)',
]) {
  assert.ok(style.includes(marker), `Phase 5 responsive/accessibility marker missing: ${marker}`);
}
for (const forbidden of ['!important', '@font-face', 'url(', '#root']) {
  assert.ok(!style.includes(forbidden), `Phase 5 style scope expansion: ${forbidden}`);
}

const integrationRuntime = `${handoff}\n${inline}\n${panel}`;
for (const forbidden of [
  /supabase/i,
  /\.schema\s*\(/,
  /\.rpc\s*\(/,
  /\.from\s*\(/,
  /fetch\s*\(/,
  /insert\s*\(/i,
  /update\s*\(/i,
  /upsert\s*\(/i,
  /delete\s*\(/i,
  /localStorage/,
  /sessionStorage/,
  /MutationObserver/,
  /CustomEvent/,
  /dispatchEvent/,
]) {
  assert.ok(!forbidden.test(integrationRuntime), `Gate 5 direct business write or enhancer pattern detected: ${forbidden}`);
}

for (const marker of [
  'Action Handoff',
  'Safe Inline Actions',
  'Open order',
  'Open inventory',
  'Open customer',
  'Open route',
  'Open exception',
  'exactly one available migrated inline family',
  'accepted, conflict, rejected, replay and network-unknown',
  'No component under Action Integration may directly update a business table',
  'permanent execution through the existing frontend audit chain',
]) {
  assert.ok(documentation.toLowerCase().includes(marker.toLowerCase()), `Phase 5 documentation marker missing: ${marker}`);
}

console.log('INTEL-GATE-005 Phase 5 Action Integration completion gate passed: 5 handoffs, 6 command families, 1 migrated inline family, no direct business-table writes.');

await import('./audit-intel-personalisation-productivity.mjs');
