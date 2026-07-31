import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  assert.ok(fs.existsSync(path), `Release readiness prerequisite missing: ${path}`);
  return fs.readFileSync(path, 'utf8');
}

const root = 'src/features/intelligence/analytics/releaseReadiness';
const contract = read(`${root}/releaseReadinessContract.ts`);
const panel = read(`${root}/ReleaseReadinessPanel.tsx`);
const style = read(`${root}/releaseReadinessWorkspace.css`);
const repository = read('src/data/repositories/intelligenceReleaseRepository.ts');
const workspace = read('src/features/intelligence/analytics/OperationalPulseReadinessWorkspace.tsx');
const migration = read('supabase/migrations/20260731190000_intelligence_release_control.sql');

for (const flag of [
  'control_room_v2',
  'analytics_inventory_v1',
  'analytics_customer_v1',
  'analytics_delivery_v1',
  'overlay_navigation_v1',
]) {
  assert.ok(contract.includes(`'${flag}'`), `Release flag missing: ${flag}`);
  assert.ok(migration.includes(`'${flag}'`), `Release migration flag missing: ${flag}`);
}

for (const check of [
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
]) {
  assert.ok(contract.includes(`'${check}'`), `Release check missing: ${check}`);
  assert.ok(migration.includes(`'${check}'`), `Release migration check missing: ${check}`);
}

for (const marker of [
  "'OFF'", "'SHADOW'", "'ON'",
  'LEGACY_ONLY', 'LEGACY_PRIMARY_SHADOW_READ', 'INTELLIGENCE_PRIMARY',
  'cutoverAssessment', 'parallelReadAssessment', 'rollbackAssessment',
  'MISSING', 'UNAVAILABLE', 'preservesAnalyticsHistory',
]) {
  assert.ok(contract.includes(marker), `Release contract marker missing: ${marker}`);
}

for (const marker of [
  'PHASE 7 · RELEASE VERIFICATION & CUTOVER',
  'INTEL-REL-001 · FEATURE FLAG',
  'INTEL-REL-002 · PARALLEL READ',
  'INTEL-REL-003 · CUTOVER GATE',
  'INTEL-REL-004 · ROLLBACK',
  'Current production remains authoritative in SHADOW',
  'Missing, failed, blocked and unavailable evidence all block cutover',
  'analytics history preserved',
  'RELEASE CONTROL BOUNDARY',
]) {
  assert.ok(panel.includes(marker), `Release presentation marker missing: ${marker}`);
}
assert.ok(workspace.includes('<ReleaseReadinessPanel />'), 'Release readiness panel is not mounted in Analytics');

for (const marker of [
  "intelligenceReleaseReadRpcName = 'get_intelligence_release_readiness'",
  "intelligenceReleaseFlagCommandRpcName = 'apply_intelligence_release_flag_command'",
  "intelligenceReleaseVerificationCommandRpcName = 'record_intelligence_release_verification'",
  ".schema('analytics')",
  'p_expected_version',
  'p_command_id',
]) {
  assert.ok(`${contract}\n${repository}`.includes(marker), `Release repository boundary missing: ${marker}`);
}
for (const forbidden of [/\.from\s*\(/, /\.insert\s*\(/, /\.update\s*\(/, /\.delete\s*\(/]) {
  assert.ok(!forbidden.test(repository), `Release repository crossed RPC-only boundary: ${forbidden}`);
}

for (const marker of [
  'create table analytics.intelligence_release_flag',
  'create table analytics.intelligence_release_check_definition',
  'create table analytics.intelligence_release_verification',
  'create table analytics.intelligence_release_event',
  'enable row level security',
  'INTELLIGENCE_RELEASE_FLAG_VERSION_CONFLICT',
  'INTELLIGENCE_RELEASE_CUTOVER_EVIDENCE_INCOMPLETE',
  'INTELLIGENCE_RELEASE_COMMAND_REPLAY_CONFLICT',
  'INTELLIGENCE_RELEASE_EVENT_IMMUTABLE',
  "grant execute on function analytics.get_intelligence_release_readiness(date) to authenticated",
]) {
  assert.ok(migration.includes(marker), `Release database boundary missing: ${marker}`);
}
for (const table of [
  'intelligence_release_flag',
  'intelligence_release_check_definition',
  'intelligence_release_verification',
  'intelligence_release_event',
]) {
  assert.ok(
    migration.includes(`revoke all on analytics.${table} from public,anon,authenticated,service_role`),
    `Direct release table access not revoked: ${table}`,
  );
}

for (const forbidden of [
  /ecoflow_ordermentum_internal_orders\s+set/i,
  /ecoflow_inventory\s+set/i,
  /ecoflow_day_state\s+set/i,
  /pod\s+set/i,
  /route\s+set/i,
  /return\s+set/i,
]) {
  assert.ok(!forbidden.test(migration), `Release control migration crossed operational boundary: ${forbidden}`);
}

for (const marker of [
  '@media (max-width: 1180px)',
  '@media (max-width: 760px)',
  '@media (max-width: 480px)',
  '@media (prefers-reduced-motion: reduce)',
]) {
  assert.ok(style.includes(marker), `Release responsive/accessibility marker missing: ${marker}`);
}
for (const forbidden of ['!important', '@font-face', 'url(', '#root']) {
  assert.ok(!style.includes(forbidden), `Release style scope expansion: ${forbidden}`);
}

console.log('INTEL-REL-001 through INTEL-REL-004 release readiness audit passed.');
