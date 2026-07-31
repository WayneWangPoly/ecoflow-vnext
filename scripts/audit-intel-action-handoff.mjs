import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  assert.ok(fs.existsSync(path), `Action Handoff prerequisite missing: ${path}`);
  return fs.readFileSync(path, 'utf8');
}

const contractPath = 'src/features/intelligence/analytics/actionIntegration/actionHandoffContract.ts';
const panelPath = 'src/features/intelligence/analytics/actionIntegration/ActionIntegrationPanel.tsx';
const stylePath = 'src/features/intelligence/analytics/actionIntegration/actionIntegrationWorkspace.css';
const workspacePath = 'src/features/intelligence/analytics/OperationalPulseReadinessWorkspace.tsx';
const testPath = 'scripts/intel-action-handoff-contract.test.mjs';

const contract = read(contractPath);
const panel = read(panelPath);
const style = read(stylePath);
const workspace = read(workspacePath);
const tests = read(testPath);

for (const marker of [
  "'OPEN_ORDER'",
  "'OPEN_INVENTORY'",
  "'OPEN_CUSTOMER'",
  "'OPEN_ROUTE'",
  "'OPEN_EXCEPTION'",
  "source: 'domain-intelligence'",
  'buildActionHandoff',
  'validateActionHandoffRegistry',
  "basePath: '/orders'",
  "basePath: '/inventory'",
  "basePath: '/customers'",
  "basePath: '/delivery'",
  "basePath: '/analytics'",
]) {
  assert.ok(contract.includes(marker), `Action Handoff contract marker missing: ${marker}`);
}

for (const marker of [
  'Governed operational handoff',
  'Write boundary',
  'NO DIRECT WRITES',
  'Context only · no command execution',
  'Destination-owned execution',
  'ActionIntegrationPanel',
]) {
  assert.ok(panel.includes(marker) || workspace.includes(marker), `Action Handoff presentation marker missing: ${marker}`);
}

assert.ok(workspace.includes('<ActionIntegrationPanel />'), 'Action Handoff panel is not mounted in Analytics');

for (const marker of [
  '@media (max-width: 1200px)',
  '@media (max-width: 820px)',
  '@media (max-width: 560px)',
  '@media (prefers-reduced-motion: reduce)',
]) {
  assert.ok(style.includes(marker), `Action Handoff responsive marker missing: ${marker}`);
}

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
  assert.ok(!forbidden.test(`${contract}\n${panel}`), `Action Handoff crossed the no-direct-write boundary: ${forbidden}`);
}

for (const testName of [
  'Action Handoff publishes exactly five read-only operational destinations',
  'Action Handoff carries bounded analysis context into the destination URL',
  'invalid handoff context fails closed instead of inventing an operational identity',
]) {
  assert.ok(tests.includes(testName), `Action Handoff test missing: ${testName}`);
}

console.log('INTEL-ACT-001 Action Handoff audit passed.');
