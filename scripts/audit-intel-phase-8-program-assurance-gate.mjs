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

const root = 'src/features/intelligence/analytics/programAssurance';
const contract = read(`${root}/programAssuranceContract.ts`);
const panel = read(`${root}/ProgramAssurancePanel.tsx`);
const style = read(`${root}/programAssuranceWorkspace.css`);
const workspace = read('src/features/intelligence/analytics/OperationalPulseReadinessWorkspace.tsx');
const assuranceAudit = read('scripts/audit-intel-program-assurance.mjs');
const assuranceTest = read('scripts/intel-program-assurance-contract.test.mjs');
const performanceAudit = read('scripts/audit-intel-performance-budget.mjs');
const routeSmoke = read('scripts/intel-route-smoke.mjs');
const workflow = read('.github/workflows/intelligence-program-assurance-check.yml');
const phaseDocumentation = read('docs/INTEL-PHASE-8-PROGRAM-ASSURANCE.md');
const gateDocumentation = read('docs/INTEL-GATE-008-PROGRAM-COMPLETION.md');

const phasePackages = [
  'INTEL-ASSURE-001',
  'INTEL-ASSURE-002',
  'INTEL-ASSURE-003',
  'INTEL-ASSURE-004',
];
for (const packageId of phasePackages) {
  assert.ok(
    phaseDocumentation.includes(packageId) || assuranceAudit.includes(packageId) || performanceAudit.includes(packageId) || routeSmoke.includes(packageId),
    `Phase 8 package missing: ${packageId}`,
  );
}

const outcomeKeys = [
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
for (const outcome of outcomeKeys) {
  assert.ok(contract.includes(`key: '${outcome}'`), `Phase 8 final completion outcome missing: ${outcome}`);
}
assert.equal((contract.match(/engineeringState: 'COMPLETE',/g) ?? []).length, 12, 'Phase 8 requires exactly twelve completed engineering outcomes');
assert.ok(contract.includes("productionDependency: 'NONE'"), 'Phase 8 production-independent outcome evidence missing');
assert.ok(contract.includes("productionDependency: 'SHADOW_EVIDENCE'"), 'Phase 8 shadow-evidence dependency missing');
assert.ok(contract.includes("productionDependency: 'CUTOVER_PER_FLAG'"), 'Phase 8 per-flag cutover dependency missing');

const pillars = [
  'DATA_CORRECTNESS',
  'UI_INTERACTION',
  'OPERATIONAL_SAFETY',
  'PERFORMANCE',
  'ACCESSIBILITY',
  'RELEASE_CONTROL',
];
for (const pillar of pillars) {
  assert.ok(contract.includes(`'${pillar}'`), `Phase 8 permanent quality pillar missing: ${pillar}`);
}
assert.equal((contract.match(/title: '(Data correctness|UI interaction|Operational safety|Performance|Accessibility|Release control)'/g) ?? []).length, 6, 'Phase 8 requires six quality evidence definitions');

for (const marker of [
  "? 'NOT_AVAILABLE'",
  "? 'FULL_CUTOVER'",
  "? 'PARTIAL_CUTOVER'",
  "? 'SHADOW'",
  ": 'LEGACY_ONLY'",
  'engineeringComplete:',
  'releaseFlagsAvailable:',
  'productionState,',
]) {
  assert.ok(contract.includes(marker), `Phase 8 engineering/production state separation missing: ${marker}`);
}

const routes = [
  '/control-room',
  '/orders',
  '/inventory',
  '/customers',
  '/delivery',
  '/returns',
  '/exceptions',
  '/analytics',
  '/settings',
];
for (const route of routes) {
  assert.ok(contract.includes(`'${route}'`), `Phase 8 canonical route registry missing: ${route}`);
}
assert.ok(routeSmoke.includes('for (const route of intelligenceCanonicalSmokeRoutes)'), 'Phase 8 route smoke does not execute the canonical route registry');
assert.ok(routeSmoke.includes('assert.equal(response.status, 200'), 'Phase 8 route smoke does not enforce HTTP 200');
assert.ok(routeSmoke.includes('/id=["\']root["\']\//'), 'Phase 8 route smoke does not verify the application root');
assert.ok(routeSmoke.includes('9} / ${intelligenceCanonicalSmokeRoutes.length}') || routeSmoke.includes('intelligenceCanonicalSmokeRoutes.length} / ${intelligenceCanonicalSmokeRoutes.length}'), 'Phase 8 route smoke completion evidence missing');

for (const marker of [
  'largestJavaScriptBytes: 750_000',
  'totalJavaScriptBytes: 1_600_000',
  'largestCssBytes: 320_000',
  'totalCssBytes: 800_000',
  'totalAssetCount: 160',
  'indexHtmlBytes: 6_000',
]) {
  assert.ok(contract.includes(marker), `Phase 8 approved performance budget missing: ${marker}`);
}
for (const marker of [
  'fs.statSync',
  'largestJavaScriptBytes <= intelligencePerformanceBudgets.largestJavaScriptBytes',
  'totalJavaScriptBytes <= intelligencePerformanceBudgets.totalJavaScriptBytes',
  'largestCssBytes <= intelligencePerformanceBudgets.largestCssBytes',
  'totalCssBytes <= intelligencePerformanceBudgets.totalCssBytes',
  'totalAssetCount <= intelligencePerformanceBudgets.totalAssetCount',
  'indexHtmlBytes <= intelligencePerformanceBudgets.indexHtmlBytes',
]) {
  assert.ok(performanceAudit.includes(marker), `Phase 8 executable performance gate missing: ${marker}`);
}

for (const marker of [
  'PHASE 8 · PROGRAM ASSURANCE & COMPLETION',
  '12 / 12 ENGINEERING COMPLETE',
  'PRODUCTION DELIVERY STATE',
  'No production rollout state is inferred from an unavailable response.',
  'Six quality pillars',
  'Performance budgets',
  'Deep-link smoke surface',
  'PROGRAMME COMPLETION BOUNDARY',
]) {
  assert.ok(panel.includes(marker), `Phase 8 programme assurance presentation missing: ${marker}`);
}
assert.ok(workspace.includes('<ProgramAssurancePanel />'), 'Phase 8 programme assurance panel is not mounted in Analytics');

for (const marker of [
  '@media (max-width: 1100px)',
  '@media (max-width: 760px)',
  '@media (max-width: 520px)',
  '@media (prefers-reduced-motion: reduce)',
  ':focus-visible',
]) {
  assert.ok(style.includes(marker), `Phase 8 responsive/accessibility gate missing: ${marker}`);
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
  assert.ok(!forbidden.test(runtime), `Phase 8 assurance surface crossed its read-only boundary: ${forbidden}`);
}

for (const marker of [
  'engineering completion is independent from unavailable production evidence',
  'all shadow flags preserve legacy-primary production state',
  'partial and full cutover remain explicit',
  'canonical deep routes and performance budgets are bounded',
]) {
  assert.ok(assuranceTest.includes(marker), `Phase 8 contract coverage missing: ${marker}`);
}

for (const marker of [
  'Audit Phase 8 completion gate',
  'Execute programme assurance contract tests',
  'TypeScript check',
  'Vite production bundle',
  'Enforce Intelligence performance budgets',
  'Smoke canonical deep routes',
]) {
  assert.ok(workflow.includes(marker), `Phase 8 permanent workflow marker missing: ${marker}`);
}

for (const priorGate of [
  'audit-intel-phase-3-control-room-gate.mjs',
  'audit-intel-phase-4-domain-intelligence-gate.mjs',
  'audit-intel-phase-5-action-integration-gate.mjs',
  'audit-intel-phase-6-personalisation-productivity-gate.mjs',
  'audit-intel-phase-7-release-verification-gate.mjs',
]) {
  assert.ok(fs.existsSync(`scripts/${priorGate}`), `Phase 8 prior completion gate missing: ${priorGate}`);
}

for (const marker of [
  '12/12 final completion outcomes',
  '6/6 permanent quality pillars',
  'engineering completion does not imply production cutover',
  '9/9 canonical deep routes',
  'bundle budgets are executable release controls',
  'all preceding intelligence completion gates',
]) {
  assert.ok(gateDocumentation.toLowerCase().includes(marker.toLowerCase()), `Phase 8 completion documentation marker missing: ${marker}`);
}

console.log('INTEL-GATE-008 Phase 8 Program Assurance & Completion gate passed: 12/12 final outcomes, 6/6 quality pillars, executable bundle budgets, 9/9 canonical routes and all prior Intelligence gates.');
