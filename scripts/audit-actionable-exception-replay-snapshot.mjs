import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`INTEL_DATA_004B_REPLAY_FILE_MISSING: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

const migrationPath = 'supabase/migrations/20260730190100_actionable_exception_idempotent_replay_snapshot.sql';
const testPath = 'scripts/actionable-exception-lifecycle-replay-contract-test.sql';
const migration = read(migrationPath);
const test = read(testPath);
const workflow = read('.github/workflows/warehouse-productisation-check.yml');
const packageJson = JSON.parse(read('package.json'));

for (const marker of [
  'resulting_version bigint',
  'resulting_acknowledged_at timestamptz',
  'resulting_resolved_at timestamptz',
  'actionable_exception_event_capture_result',
  'capture_actionable_exception_event_result',
  'apply_actionable_exception_lifecycle_command_unsnapshotted_20260730',
  "'REPLAYED'::text",
  'v_replay.resulting_version',
  'v_replay.resulting_acknowledged_at',
  'v_replay.resulting_resolved_at',
  'ACTIONABLE_EXCEPTION_COMMAND_ID_CONFLICT',
  'pg_advisory_xact_lock',
]) {
  if (!migration.includes(marker)) {
    throw new Error(`INTEL_DATA_004B_REPLAY_MARKER_MISSING: ${marker}`);
  }
}

for (const forbidden of [
  /update\s+public\./i,
  /insert\s+into\s+public\./i,
  /delete\s+from\s+public\./i,
  /ecoflow_day_state/i,
  /ecoflow_inventory_/i,
  /ecoflow_warehouse_/i,
  /ecoflow_delivery_/i,
  /analytics\.data_quality_status/i,
  /\bDISMISS\b/i,
]) {
  if (forbidden.test(migration)) {
    throw new Error(`INTEL_DATA_004B_REPLAY_FORBIDDEN_SCOPE: ${forbidden}`);
  }
}

if (!migration.includes(
  'revoke all on function analytics.apply_actionable_exception_lifecycle_command_unsnapshotted_20260730',
)) {
  throw new Error('INTEL_DATA_004B_INTERNAL_COMMAND_ACL_MISSING');
}
if (!migration.includes(
  "comment on function analytics.apply_actionable_exception_lifecycle_command(",
)) {
  throw new Error('INTEL_DATA_004B_REPLAY_WRAPPER_COMMENT_MISSING');
}

for (const testMarker of [
  'initial_command_ok',
  'later_assign_ok',
  'later_resolve_ok',
  'historical_replay_ok',
  'current_state_remains_latest',
  'stored_snapshot_ok',
  'historical lifecycle replay leaked newer current state',
]) {
  if (!test.includes(testMarker)) {
    throw new Error(`INTEL_DATA_004B_REPLAY_TEST_MARKER_MISSING: ${testMarker}`);
  }
}

if (!workflow.includes(migrationPath)
  || !workflow.includes('Execute actionable exception lifecycle replay tests')
  || !workflow.includes(testPath)) {
  throw new Error('INTEL_DATA_004B_REPLAY_WORKFLOW_WIRING_MISSING');
}

const analyticsAudit = packageJson.scripts?.['audit:analytics'];
if (typeof analyticsAudit !== 'string'
  || !analyticsAudit.includes('audit-actionable-exception-replay-snapshot.mjs')) {
  throw new Error('INTEL_DATA_004B_REPLAY_PACKAGE_AUDIT_WIRING_MISSING');
}

console.log('INTEL-DATA-004B actionable exception replay snapshot audit passed.');
