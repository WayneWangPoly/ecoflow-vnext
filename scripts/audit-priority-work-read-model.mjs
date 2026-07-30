import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrationPath = 'supabase/migrations/20260731110000_priority_work_read_model.sql';
const testPath = 'scripts/priority-work-read-model-contract-test.sql';
const workflowPath = '.github/workflows/warehouse-productisation-check.yml';
const packagePath = 'package.json';

for (const file of [migrationPath, testPath, workflowPath, packagePath]) {
  assert.ok(fs.existsSync(file), `missing Priority Work file: ${file}`);
}

const migration = fs.readFileSync(migrationPath, 'utf8');
const tests = fs.readFileSync(testPath, 'utf8');
const workflow = fs.readFileSync(workflowPath, 'utf8');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

for (const marker of [
  'create table analytics.actionable_exception_priority_policy',
  'create or replace function analytics.get_priority_work_queue',
  "message='PRIORITY_WORK_DESKTOP_ROLE_REQUIRED'",
  "message='PRIORITY_WORK_LIMIT_INVALID'",
  "v_role not in ('OWNER','ADMIN','ACCOUNT','VIEWER')",
  "'INVOICE DETAIL MISSING'",
  "'EcoFlow cannot verify the Order from mirrored invoice or line detail.'",
  "'Open the Order and verify the mirrored invoice or line detail.'",
  "'POLICY_GOVERNED'::text",
  'join lateral',
  'analytics.actionable_exception_priority_policy',
  'analytics.actionable_exception_lifecycle',
  "coalesce(l.lifecycle_status,'OPEN')<>'RESOLVED'",
  "l.lifecycle_status='SNOOZED'",
  'g.priority_rank asc',
  '(g.owner_team is null) desc',
  'g.detected_at asc',
  'limit v_limit',
]) {
  assert.ok(migration.includes(marker), `missing Priority Work migration marker: ${marker}`);
}

assert.ok(
  migration.indexOf('g.priority_rank asc') < migration.indexOf('(g.owner_team is null) desc')
    && migration.indexOf('(g.owner_team is null) desc') < migration.indexOf('g.detected_at asc'),
  'Priority Work ranking order must be policy, assignment, then oldest detected time',
);

const functionStart = migration.indexOf(
  'create or replace function analytics.get_priority_work_queue',
);
const functionEnd = migration.indexOf(
  'revoke all on function analytics.get_priority_work_queue(integer)',
);
assert.ok(functionStart >= 0 && functionEnd > functionStart, 'Priority Work function boundary missing');
const functionDefinition = migration.slice(functionStart, functionEnd);

for (const forbidden of [
  /order by\s+[^;]*detected_at\s+desc/i,
  /\bseverity\b/i,
  /\bdue_at\b/i,
  /\bsla\b/i,
  /\bimpact_value\b/i,
  /\bimpact_display_value\b/i,
  /\brecommended_action\b/i,
  /\bfact_[a-z_]+\b/i,
  /\bmetric_value\b/i,
  /\becoflow_delivery_exceptions\b/i,
  /\bdata_quality_status\b/i,
  /\b(insert|update|delete|merge|truncate|refresh|execute)\b/i,
]) {
  assert.ok(!forbidden.test(functionDefinition), `Priority Work RPC scope expansion: ${forbidden}`);
}

assert.ok(
  migration.includes('revoke all on analytics.actionable_exception_priority_policy')
    && migration.includes('revoke all on function analytics.get_priority_work_queue(integer)')
    && migration.includes('grant execute on function analytics.get_priority_work_queue(integer)\n  to authenticated'),
  'Priority Work ACL boundary missing',
);

for (const testName of [
  'owner_received_only_complete_active_priority_items',
  'priority_order_is_policy_then_unassigned_then_oldest',
  'priority_rows_are_complete_and_snapshot_consistent',
  'priority_policy_copy_is_exact',
  'admin_read_succeeds',
  'account_read_succeeds',
  'viewer_read_succeeds',
  'disabled_policy_suppresses_priority_work',
]) {
  assert.ok(tests.includes(testName), `Priority Work database test missing: ${testName}`);
}

for (const marker of [
  '20260731110000_priority_work_read_model.sql',
  'priority-work-read-model-contract-test.sql',
]) {
  assert.ok(workflow.includes(marker), `Priority Work workflow wiring missing: ${marker}`);
}

const analyticsAudit = packageJson.scripts?.['audit:analytics'];
assert.equal(typeof analyticsAudit, 'string', 'audit:analytics command missing');
assert.ok(
  analyticsAudit.includes('audit-priority-work-read-model.mjs'),
  'Priority Work audit is not wired to audit:analytics',
);

console.log('INTEL-DATA-006A Priority Work read-model audit passed.');
