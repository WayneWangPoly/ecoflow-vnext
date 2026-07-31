import './audit-intel-release-readiness.mjs';
import './audit-intelligence-release-control.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  assert.ok(fs.existsSync(path), `Phase 7 gate prerequisite missing: ${path}`);
  return fs.readFileSync(path, 'utf8');
}

const root = 'src/features/intelligence/analytics/releaseReadiness';
const contract = read(`${root}/releaseReadinessContract.ts`);
const panel = read(`${root}/ReleaseReadinessPanel.tsx`);
const style = read(`${root}/releaseReadinessWorkspace.css`);
const repository = read('src/data/repositories/intelligenceReleaseRepository.ts');
const workspace = read('src/features/intelligence/analytics/OperationalPulseReadinessWorkspace.tsx');
const migration = read('supabase/migrations/20260731190000_intelligence_release_control.sql');
const forwardFix = read('supabase/migrations/20260731190100_intelligence_release_verification_conflict_fix.sql');
const sqlTest = read('scripts/intelligence-release-control-contract-test.sql');
const frontendTest = read('scripts/intel-release-readiness-contract.test.mjs');
const workflow = read('.github/workflows/intelligence-release-readiness-check.yml');
const documentation = read('docs/INTEL-PHASE-7-RELEASE-VERIFICATION-CUTOVER.md');

const packages = ['INTEL-REL-001', 'INTEL-REL-002', 'INTEL-REL-003', 'INTEL-REL-004'];
for (const packageId of packages) {
  assert.ok(
    panel.includes(packageId) || documentation.includes(packageId),
    `Phase 7 package missing: ${packageId}`,
  );
}

const flags = [
  'control_room_v2',
  'analytics_inventory_v1',
  'analytics_customer_v1',
  'analytics_delivery_v1',
  'overlay_navigation_v1',
];
for (const flag of flags) {
  assert.ok(contract.includes(`'${flag}'`), `Phase 7 contract flag missing: ${flag}`);
  assert.ok(migration.includes(`'${flag}'`), `Phase 7 database flag missing: ${flag}`);
}
assert.equal(
  (contract.match(/^  '[a-z0-9_]+'[,]?$/gm) ?? [])
    .filter((line) => flags.some((flag) => line.includes(`'${flag}'`))).length,
  5,
  'Phase 7 must contain exactly five canonical release flags',
);

const checks = [
  'METRIC_DEFINITION_APPROVED',
  'PARALLEL_READ_EXPLAINED',
  'ROLE_ACCESS_VERIFIED',
  'NO_DEMO_FALLBACK',
  'NO_SILENT_ZERO',
  'PERFORMANCE_BASELINE',
  'OWNER_WORKFLOW_SMOKE',
  'ROLLBACK_VERIFIED',
  'MOBILE_VERIFIED',
  'SOURCE_INTERRUPTION_VERIFIED',
];
for (const check of checks) {
  assert.ok(contract.includes(`'${check}'`), `Phase 7 contract check missing: ${check}`);
  assert.ok(migration.includes(`'${check}'`), `Phase 7 database check missing: ${check}`);
}
assert.equal(
  (contract.match(/^  '[A-Z_]+'[,]?$/gm) ?? [])
    .filter((line) => checks.some((check) => line.includes(`'${check}'`))).length,
  10,
  'Phase 7 must contain exactly ten required cutover checks',
);

for (const marker of [
  "intelligenceRolloutStates = ['OFF', 'SHADOW', 'ON']",
  "'LEGACY_ONLY'",
  "'LEGACY_PRIMARY_SHADOW_READ'",
  "'INTELLIGENCE_PRIMARY'",
  'normaliseIntelligenceReleaseRows',
  'intelligenceReleaseSummary',
  'cutoverAssessment',
  'parallelReadAssessment',
  'rollbackAssessment',
  "evidenceState: 'RECORDED' | 'MISSING'",
  "status: 'UNAVAILABLE'",
  'preservesAnalyticsHistory: true',
]) {
  assert.ok(contract.includes(marker), `Phase 7 contract boundary missing: ${marker}`);
}

for (const marker of [
  'PHASE 7 · RELEASE VERIFICATION & CUTOVER',
  'Governed rollout control',
  'INTEL-REL-001 · FEATURE FLAG',
  'INTEL-REL-002 · PARALLEL READ',
  'INTEL-REL-003 · CUTOVER GATE',
  'INTEL-REL-004 · ROLLBACK',
  'Current production remains authoritative in SHADOW',
  'Missing, failed, blocked and unavailable evidence all block cutover',
  'Target state OFF · analytics history preserved',
  'RELEASE CONTROL BOUNDARY',
  'This workspace is read-only',
]) {
  assert.ok(panel.includes(marker), `Phase 7 presentation marker missing: ${marker}`);
}
assert.ok(workspace.includes('<ReleaseReadinessPanel />'), 'Phase 7 panel is not mounted in Analytics');

for (const marker of [
  "intelligenceReleaseReadRpcName = 'get_intelligence_release_readiness'",
  "intelligenceReleaseFlagCommandRpcName = 'apply_intelligence_release_flag_command'",
  "intelligenceReleaseVerificationCommandRpcName = 'record_intelligence_release_verification'",
  ".schema('analytics')",
  'p_command_id',
  'p_expected_version',
]) {
  assert.ok(`${contract}\n${repository}`.includes(marker), `Phase 7 RPC boundary missing: ${marker}`);
}
for (const forbidden of [/\.from\s*\(/, /\.insert\s*\(/, /\.update\s*\(/, /\.delete\s*\(/]) {
  assert.ok(!forbidden.test(repository), `Phase 7 repository crossed RPC-only boundary: ${forbidden}`);
}

for (const marker of [
  'create table analytics.intelligence_release_flag',
  'create table analytics.intelligence_release_check_definition',
  'create table analytics.intelligence_release_verification',
  'create table analytics.intelligence_release_event',
  "rollout_state in ('OFF','SHADOW','ON')",
  "check_status in ('PASS','FAIL','BLOCKED','UNAVAILABLE')",
  "p.app_role in ('OWNER','ADMIN','ACCOUNT','VIEWER')",
  "p.app_role in ('OWNER','ADMIN')",
  'INTELLIGENCE_RELEASE_CUTOVER_EVIDENCE_INCOMPLETE',
  'INTELLIGENCE_RELEASE_SHADOW_REQUIRED',
  'INTELLIGENCE_RELEASE_FLAG_VERSION_CONFLICT',
  'INTELLIGENCE_RELEASE_COMMAND_REPLAY_CONFLICT',
  'INTELLIGENCE_RELEASE_EVENT_IMMUTABLE',
  "coalesce(v.check_status,'UNAVAILABLE'::text)",
]) {
  assert.ok(migration.includes(marker), `Phase 7 database marker missing: ${marker}`);
}
assert.ok(
  forwardFix.includes('on conflict on constraint intelligence_release_verification_pkey'),
  'Phase 7 managed PostgreSQL conflict target fix missing',
);
assert.ok(
  forwardFix.includes("date_trunc('second',p_source_as_of)"),
  'Phase 7 verification replay fingerprint normalisation missing',
);

for (const table of [
  'intelligence_release_flag',
  'intelligence_release_check_definition',
  'intelligence_release_verification',
  'intelligence_release_event',
]) {
  assert.ok(
    migration.includes(`alter table analytics.${table} enable row level security`),
    `Phase 7 RLS missing: ${table}`,
  );
  assert.ok(
    migration.includes(`revoke all on analytics.${table} from public,anon,authenticated,service_role`),
    `Phase 7 direct table revoke missing: ${table}`,
  );
}

for (const marker of [
  'owner_initial_read_ok',
  'count(*)=50',
  "bool_and(check_status='UNAVAILABLE')",
  'CUTOVER_EVIDENCE_INCOMPLETE',
  "'REPLAYED'",
  'COMMAND_REPLAY_CONFLICT',
  'control_room_evidence_complete',
  'FLAG_VERSION_CONFLICT',
  'SHADOW_REQUIRED',
  'account_read_only_ok',
  'viewer_read_only_ok',
  'DESKTOP_ROLE_REQUIRED',
  'EVENT_IMMUTABLE',
]) {
  assert.ok(sqlTest.includes(marker), `Phase 7 PostgreSQL test marker missing: ${marker}`);
}

for (const marker of [
  'five flags crossed with ten explicit checks',
  'missing verification stays unavailable',
  'cutover is eligible only from shadow with every check passing',
  'active rollout requires verified rollback evidence',
  'release summary counts flags and checks without fabricating pass state',
  'non-pass verification commands require an explanatory note',
]) {
  assert.ok(frontendTest.includes(marker), `Phase 7 frontend test marker missing: ${marker}`);
}

for (const marker of [
  'Audit Phase 7 completion gate',
  'Execute release readiness contract tests',
  'TypeScript check',
  'Vite production bundle',
  'Apply release control migrations',
  'Execute release control contract tests',
  'Audit release control migration',
  '20260731190100_intelligence_release_verification_conflict_fix.sql',
]) {
  assert.ok(workflow.includes(marker), `Phase 7 CI marker missing: ${marker}`);
}

for (const marker of [
  '@media (max-width: 1180px)',
  '@media (max-width: 760px)',
  '@media (max-width: 480px)',
  '@media (prefers-reduced-motion: reduce)',
]) {
  assert.ok(style.includes(marker), `Phase 7 responsive/accessibility marker missing: ${marker}`);
}
for (const forbidden of ['!important', '@font-face', 'url(', '#root']) {
  assert.ok(!style.includes(forbidden), `Phase 7 style scope expansion: ${forbidden}`);
}

const releaseRuntime = `${contract}\n${repository}\n${panel}`;
for (const forbidden of [
  /localStorage/,
  /sessionStorage/,
  /indexedDB/,
  /fetch\s*\(/,
  /MutationObserver/,
  /CustomEvent/,
  /dispatchEvent/,
]) {
  assert.ok(!forbidden.test(releaseRuntime), `Phase 7 forbidden browser authority pattern: ${forbidden}`);
}
for (const forbidden of [
  /update\s+public\./i,
  /insert\s+into\s+public\./i,
  /delete\s+from\s+public\./i,
  /drop\s+(table|schema)/i,
]) {
  assert.ok(!forbidden.test(`${migration}\n${forwardFix}`), `Phase 7 operational/history boundary crossed: ${forbidden}`);
}

for (const marker of [
  'four governed packages',
  'exactly five flags',
  'SHADOW',
  'ten required checks',
  'Missing verification creates an unavailable evidence row',
  'Direct `OFF` to `ON` transition is forbidden',
  'analytics history preserved',
  'RPC-only',
  'Actual production cutover remains intentionally evidence-driven',
]) {
  assert.ok(documentation.toLowerCase().includes(marker.toLowerCase()), `Phase 7 documentation marker missing: ${marker}`);
}

console.log('INTEL-GATE-007 Phase 7 Release Verification & Cutover completion gate passed: 4/4 packages, 5 flags, 10 checks, 50 explicit release evidence rows, revisioned cutover and rollback control.');
