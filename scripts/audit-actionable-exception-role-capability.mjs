import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`INTEL_DATA_004C_FILE_MISSING: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

const migrationPath = 'supabase/migrations/20260730190200_actionable_exception_role_aware_capability.sql';
const testPath = 'scripts/actionable-exception-role-capability-contract-test.sql';
const migration = read(migrationPath);
const test = read(testPath);
const workflow = read('.github/workflows/warehouse-productisation-check.yml');
const packageJson = JSON.parse(read('package.json'));

for (const marker of [
  'analytics.get_actionable_exception_lifecycle',
  'analytics.ecoflow_can_read_actionable_exceptions',
  'analytics.ecoflow_can_write_actionable_exception_lifecycle',
  "then 'AVAILABLE'",
  "else 'READ_ONLY'",
  'v_action_capability as action_capability',
  'ACTIONABLE_EXCEPTION_DESKTOP_ROLE_REQUIRED',
  'ACTIONABLE_EXCEPTION_LIMIT_INVALID',
  'ACTIONABLE_EXCEPTION_ID_LIST_TOO_LARGE',
  'security definer',
  'limit 50',
]) {
  if (!migration.includes(marker)) {
    throw new Error(`INTEL_DATA_004C_CONTRACT_MARKER_MISSING: ${marker}`);
  }
}

for (const forbidden of [
  /\b(insert|update|delete|merge|truncate|refresh)\b/i,
  /\bexecute\b/i,
  /apply_actionable_exception_lifecycle_command\s*\(/i,
  /ecoflow_day_state/i,
  /ecoflow_inventory_/i,
  /ecoflow_warehouse_/i,
  /ecoflow_delivery_/i,
  /analytics\.data_quality_status/i,
  /severity\s*:=/i,
  /impact\s*:=/i,
]) {
  if (forbidden.test(migration)) {
    throw new Error(`INTEL_DATA_004C_FORBIDDEN_SCOPE: ${forbidden}`);
  }
}

for (const marker of [
  'owner_capability_ok',
  'admin_capability_ok',
  'account_capability_ok',
  'viewer_capability_ok',
  "action_capability='READ_ONLY'",
  'ACTIONABLE_EXCEPTION_OWNER_ADMIN_OR_ACCOUNT_REQUIRED',
  'ACTIONABLE_EXCEPTION_DESKTOP_ROLE_REQUIRED',
  'capability-warehouse@example.test',
  'capability-driver@example.test',
  'capability-inactive@example.test',
]) {
  if (!test.includes(marker)) {
    throw new Error(`INTEL_DATA_004C_TEST_MARKER_MISSING: ${marker}`);
  }
}

if (!workflow.includes(migrationPath)
  || !workflow.includes('Execute actionable exception role capability tests')
  || !workflow.includes(testPath)) {
  throw new Error('INTEL_DATA_004C_WORKFLOW_WIRING_MISSING');
}

const analyticsAudit = packageJson.scripts?.['audit:analytics'];
if (typeof analyticsAudit !== 'string'
  || !analyticsAudit.includes('audit-actionable-exception-role-capability.mjs')) {
  throw new Error('INTEL_DATA_004C_PACKAGE_AUDIT_WIRING_MISSING');
}

console.log('INTEL-DATA-004C role-aware lifecycle capability audit passed.');
