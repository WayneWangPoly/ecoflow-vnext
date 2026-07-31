import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  assert.ok(fs.existsSync(path), `Phase 8 assurance prerequisite missing: ${path}`);
  return fs.readFileSync(path, 'utf8');
}

const root = 'src/features/intelligence/analytics/programAssurance';
const contract = read(`${root}/programAssuranceContract.ts`);
const panel = read(`${root}/ProgramAssurancePanel.tsx`);
const style = read(`${root}/programAssuranceWorkspace.css`);
const workspace = read('src/features/intelligence/analytics/OperationalPulseReadinessWorkspace.tsx');
const test = read('scripts/intel-program-assurance-contract.test.mjs');
const performance = read('scripts/audit-intel-performance-budget.mjs');
const smoke = read('scripts/intel-route-smoke.mjs');
const workflow = read('.github/workflows/intelligence-program-assurance-check.yml');
const documentation = read('docs/INTEL-PHASE-8-PROGRAM-ASSURANCE.md');

const pillars = [
  'DATA_CORRECTNESS',
  'UI_INTERACTION',
  'OPERATIONAL_SAFETY',
  'PERFORMANCE',
  'ACCESSIBILITY',
  'RELEASE_CONTROL',
];
for (const pillar of pillars) {
  assert.ok(contract.includes(`'${pillar}'`), `Phase 8 quality pillar missing: ${pillar}`);
}

const outcomes = [
  'DECISION_FIRST_OWNER_ENTRY',
  'METRIC_TO_CAUSE_TO_ENTITY',
  'CONTEXT_PRESERVATION',
  'CONSISTENT_METRIC_DEFINITION',
  'COMMERCIAL_PHYSICAL_SEPARATION',
  'BACKGROUND_ANALYTICS_SOURCE',
  'NO_FALSE_ZERO_OR_DEMO',
  'LAYERED_WORKSPACE_MODEL',
  'SAFE_INSIGHT_TO_ACTION',
  'NATIVE_REACT_OWNERSHIP',
  'ROLE_SPECIFIC_SHARED_FACTS',
  'ECOFLOW_OPERATIONAL_INTELLIGENCE',
];
for (const outcome of outcomes) {
  assert.ok(contract.includes(`key: '${outcome}'`), `Phase 8 final outcome missing: ${outcome}`);
}
assert.equal((contract.match(/engineeringState: 'COMPLETE'/g) ?? []).length, 12, 'Phase 8 must contain twelve completed engineering outcomes');
for (const marker of [
  "'NONE' | 'SHADOW_EVIDENCE' | 'CUTOVER_PER_FLAG'",
  "'NOT_AVAILABLE'",
  "'FULL_CUTOVER'",
  "'PARTIAL_CUTOVER'",
  "'SHADOW'",
  "'LEGACY_ONLY'",
  'intelligenceProgramCompletionSummary',
  'validateIntelligenceProgramAssurance',
]) {
  assert.ok(contract.includes(marker), `Phase 8 completion boundary missing: ${marker}`);
}

for (const route of [
  '/control-room',
  '/orders',
  '/inventory',
  '/customers',
  '/delivery',
  '/returns',
  '/exceptions',
  '/analytics',
  '/settings',
]) {
  assert.ok(contract.includes(`'${route}'`), `Phase 8 canonical smoke route missing: ${route}`);
  assert.ok(smoke.includes(route), `Phase 8 route smoke execution missing: ${route}`);
}

for (const marker of [
  '750_000',
  '1_600_000',
  '320_000',
  '800_000',
  'totalAssetCount: 160',
  'indexHtmlBytes: 6_000',
]) {
  assert.ok(contract.includes(marker), `Phase 8 performance budget missing: ${marker}`);
}
for (const marker of [
  'largestJavaScriptBytes',
  'totalJavaScriptBytes',
  'largestCssBytes',
  'totalCssBytes',
  'totalAssetCount',
  'indexHtmlBytes',
  'INTEL-ASSURE-003',
]) {
  assert.ok(performance.includes(marker), `Phase 8 performance audit marker missing: ${marker}`);
}

for (const marker of [
  'PHASE 8 · PROGRAM ASSURANCE & COMPLETION',
  'Engineering closure with production truth preserved',
  '12 / 12 ENGINEERING COMPLETE',
  'Six quality pillars',
  'Performance budgets',
  'Deep-link smoke surface',
  'PROGRAMME COMPLETION BOUNDARY',
  'No production rollout state is inferred from an unavailable response.',
]) {
  assert.ok(panel.includes(marker), `Phase 8 presentation marker missing: ${marker}`);
}
assert.ok(panel.includes('aria-labelledby="program-assurance-title"'), 'Phase 8 heading relationship is missing');
assert.ok(panel.includes('role="status"'), 'Phase 8 loading status semantics are missing');
assert.ok(panel.includes('role="alert"'), 'Phase 8 failure alert semantics are missing');
assert.ok(workspace.includes('<ProgramAssurancePanel />'), 'Phase 8 programme assurance panel is not mounted in Analytics');

for (const marker of [
  '@media (max-width: 1100px)',
  '@media (max-width: 760px)',
  '@media (max-width: 520px)',
  '@media (prefers-reduced-motion: reduce)',
  ':focus-visible',
]) {
  assert.ok(style.includes(marker), `Phase 8 responsive/accessibility marker missing: ${marker}`);
}
for (const forbidden of ['!important', '@font-face', 'url(', '#root']) {
  assert.ok(!style.includes(forbidden), `Phase 8 style scope expansion detected: ${forbidden}`);
}

const runtime = `${contract}\n${panel}`;
for (const forbidden of [
  /localStorage/,
  /sessionStorage/,
  /indexedDB/i,
  /\.schema\s*\(/,
  /\.rpc\s*\(/,
  /\.from\s*\(/,
  /fetch\s*\(/,
  /insert\s*\(/i,
  /upsert\s*\(/i,
  /delete\s*\(/i,
  /update\s*\(/i,
]) {
  assert.ok(!forbidden.test(runtime), `Phase 8 runtime crossed the read-only assurance boundary: ${forbidden}`);
}

for (const marker of [
  'twelve unique final completion outcomes',
  'all six permanent quality pillars',
  'engineering completion is independent from unavailable production evidence',
  'partial and full cutover remain explicit',
]) {
  assert.ok(test.includes(marker), `Phase 8 contract-test marker missing: ${marker}`);
}

for (const marker of [
  'Audit Phase 8 programme assurance',
  'Execute programme assurance contract tests',
  'TypeScript check',
  'Vite production bundle',
  'Enforce Intelligence performance budgets',
  'Smoke canonical deep routes',
]) {
  assert.ok(workflow.includes(marker), `Phase 8 CI marker missing: ${marker}`);
}

for (const marker of [
  'twelve final completion outcomes',
  'six permanent quality pillars',
  'engineering completion and production cutover are separate states',
  'nine canonical deep routes',
  'bundle budgets',
  'no production evidence is fabricated',
]) {
  assert.ok(documentation.toLowerCase().includes(marker.toLowerCase()), `Phase 8 documentation marker missing: ${marker}`);
}

console.log('INTEL-ASSURE-001 through INTEL-ASSURE-004 programme assurance audit passed: 12 outcomes, 6 quality pillars, bounded assets and 9 canonical route checks.');
