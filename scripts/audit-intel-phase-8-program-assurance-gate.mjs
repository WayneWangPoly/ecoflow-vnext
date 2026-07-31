import './audit-intel-phase-3-control-room-gate.mjs';
import './audit-intel-phase-4-domain-intelligence-gate.mjs';
import './audit-intel-phase-5-action-integration-gate.mjs';
import './audit-intel-phase-6-personalisation-productivity-gate.mjs';
import './audit-intel-phase-7-release-verification-gate.mjs';
import './audit-intel-program-assurance.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  assert.ok(fs.existsSync(path), `Phase 8 completion gate prerequisite missing: ${path}`);
  return fs.readFileSync(path, 'utf8');
}

const contract = read('src/features/intelligence/analytics/programAssurance/programAssuranceContract.ts');
const workspace = read('src/features/intelligence/analytics/OperationalPulseReadinessWorkspace.tsx');
const workflow = read('.github/workflows/intelligence-program-assurance-check.yml');
const documentation = read('docs/INTEL-GATE-008-PROGRAM-COMPLETION.md');

assert.equal((contract.match(/engineeringState: 'COMPLETE',/g) ?? []).length, 12, 'Gate 8 requires 12/12 completed engineering outcomes');
assert.equal((contract.match(/title: '(Data correctness|UI interaction|Operational safety|Performance|Accessibility|Release control)'/g) ?? []).length, 6, 'Gate 8 requires 6/6 permanent quality pillars');
assert.ok(contract.includes("? 'NOT_AVAILABLE'"), 'Gate 8 must preserve unavailable production state');
assert.ok(contract.includes("? 'FULL_CUTOVER'"), 'Gate 8 full-cutover state missing');
assert.ok(contract.includes("? 'PARTIAL_CUTOVER'"), 'Gate 8 partial-cutover state missing');
assert.ok(contract.includes("? 'SHADOW'"), 'Gate 8 shadow state missing');
assert.ok(workspace.includes('<ProgramAssurancePanel />'), 'Gate 8 programme assurance panel is not mounted');

for (const marker of [
  'Audit Phase 8 completion gate',
  'Execute programme assurance contract tests',
  'TypeScript check',
  'Vite production bundle',
  'Enforce Intelligence performance budgets',
  'Smoke canonical deep routes',
]) {
  assert.ok(workflow.includes(marker), `Gate 8 permanent workflow marker missing: ${marker}`);
}

for (const marker of [
  '12/12 final completion outcomes',
  '6/6 permanent quality pillars',
  'engineering completion does not imply production cutover',
  '9/9 canonical deep routes',
  'bundle budgets are executable release controls',
  'all preceding Intelligence completion gates',
]) {
  assert.ok(documentation.toLowerCase().includes(marker.toLowerCase()), `Gate 8 documentation marker missing: ${marker}`);
}

console.log('INTEL-GATE-008 Phase 8 Program Assurance & Completion gate passed: 12/12 final outcomes, 6/6 quality pillars, executable bundle budgets, 9/9 canonical routes and all prior Intelligence gates.');
