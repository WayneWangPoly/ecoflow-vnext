import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`INTEL_DATA_004D_FILE_MISSING: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

const migrationPath = 'supabase/migrations/20260730190300_actionable_exception_lifecycle_access_envelope.sql';
const testPath = 'scripts/actionable-exception-lifecycle-access-contract-test.sql';
const migration = read(migrationPath);
const test = read(testPath);
const workflow = read('.github/workflows/warehouse-productisation-check.yml');
const packageJson = JSON.parse(read('package.json'));

for (const marker of [
  'analytics.get_actionable_exception_lifecycle_access',
  'analytics.ecoflow_can_read_actionable_exceptions',
  'analytics.ecoflow_can_write_actionable_exception_lifecycle',
  "case when v_can_write then 'AVAILABLE' else 'READ_ONLY'",
  "'ACKNOWLEDGE','ASSIGN','UNASSIGN','SNOOZE','UNSNOOZE'",
  "'RESOLVE','REOPEN','ADD_NOTE'",
  'array[]::text[]',
  'command_id_required boolean',
  'max_read_ids integer',
  'max_read_rows integer',
  'max_history_events integer',
  'max_snooze_days integer',
  'security definer',
  'ACTIONABLE_EXCEPTION_DESKTOP_ROLE_REQUIRED',
]) {
  if (!migration.includes(marker)) {
    throw new Error(`INTEL_DATA_004D_CONTRACT_MARKER_MISSING: ${marker}`);
  }
}

for (const forbidden of [
  /\b(insert|update|delete|merge|truncate|refresh)\b/i,
  /^\s*execute\s+/im,
  /\bfrom\s+analytics\.actionable_exception_lifecycle\b/i,
  /\bfrom\s+analytics\.actionable_exception_lifecycle_event\b/i,
  /v_ecoflow_ordermentum_ui_active_exceptions/i,
  /apply_actionable_exception_lifecycle_command\s*\(/i,
  /ecoflow_day_state/i,
  /ecoflow_inventory_/i,
  /ecoflow_warehouse_/i,
  /ecoflow_delivery_/i,
  /analytics\.data_quality_status/i,
]) {
  if (forbidden.test(migration)) {
    throw new Error(`INTEL_DATA_004D_FORBIDDEN_SCOPE: ${forbidden}`);
  }
}

for (const marker of [
  'lifecycle_is_empty',
  'owner_access_ok',
  'admin_access_ok',
  'account_access_ok',
  'viewer_access_ok',
  "action_capability='READ_ONLY'",
  'cardinality(a.command_actions)=0',
  'access-warehouse@example.test',
  'access-driver@example.test',
  'access-inactive@example.test',
  'ACTIONABLE_EXCEPTION_DESKTOP_ROLE_REQUIRED',
]) {
  if (!test.includes(marker)) {
    throw new Error(`INTEL_DATA_004D_TEST_MARKER_MISSING: ${marker}`);
  }
}

if (!workflow.includes(migrationPath)
  || !workflow.includes('Execute actionable exception lifecycle access tests')
  || !workflow.includes(testPath)) {
  throw new Error('INTEL_DATA_004D_WORKFLOW_WIRING_MISSING');
}

const analyticsAudit = packageJson.scripts?.['audit:analytics'];
if (typeof analyticsAudit !== 'string'
  || !analyticsAudit.includes('audit-actionable-exception-lifecycle-access.mjs')) {
  throw new Error('INTEL_DATA_004D_PACKAGE_AUDIT_WIRING_MISSING');
}

console.log('INTEL-DATA-004D actionable exception lifecycle access envelope audit passed.');
