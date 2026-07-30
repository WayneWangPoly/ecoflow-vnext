import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`INTEL_DATA_004A_FILE_MISSING: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

const migrationPath = 'supabase/migrations/20260730160000_actionable_exception_read_model.sql';
const migration = read(migrationPath);
const test = read('scripts/actionable-exception-read-model-contract-test.sql');
const workflow = read('.github/workflows/warehouse-productisation-check.yml');
const packageJson = JSON.parse(read('package.json'));

for (const marker of [
  'analytics.get_actionable_exception_queue',
  'public.v_ecoflow_ordermentum_ui_active_exceptions',
  'security invoker',
  "v_role not in ('OWNER','ADMIN','ACCOUNT','VIEWER')",
  'ACTIONABLE_EXCEPTION_DESKTOP_ROLE_REQUIRED',
  'ACTIONABLE_EXCEPTION_LIMIT_INVALID',
  'v_limit<1 or v_limit>300',
  "'order'::text as source_kind",
  "'unknown'::text as severity",
  "'orders'::text as handoff_workspace",
  "'CURRENT_ACTIVE_ONLY'::text as lifecycle_capability",
  "'UNAVAILABLE'::text as sla_capability",
  "'UNAVAILABLE'::text as ownership_capability",
  "'UNAVAILABLE'::text as impact_capability",
  "'UNAVAILABLE'::text as action_capability",
  "'UNAVAILABLE'::text as history_capability",
  'null::numeric as impact_value',
  'null::bigint as affected_count',
  'null::jsonb as audit_history',
  'limit v_limit',
]) {
  if (!migration.includes(marker)) throw new Error(`INTEL_DATA_004A_CONTRACT_MARKER_MISSING: ${marker}`);
}

for (const sourceColumn of [
  'raw_order_id',
  'external_order_id',
  'external_order_number',
  'external_invoice_number',
  'order_number',
  'invoice_number',
  'exception_type',
  'message',
  'status',
  'detected_at',
]) {
  if (!migration.includes(`'${sourceColumn}'`)) {
    throw new Error(`INTEL_DATA_004A_SOURCE_COLUMN_PREFLIGHT_MISSING: ${sourceColumn}`);
  }
}

const functionStart = migration.indexOf('create or replace function analytics.get_actionable_exception_queue');
const functionEnd = migration.indexOf('revoke all on function analytics.get_actionable_exception_queue', functionStart);
if (functionStart < 0 || functionEnd < 0) throw new Error('INTEL_DATA_004A_FUNCTION_BOUNDARY_MISSING');
const functionBody = migration.slice(functionStart, functionEnd);

for (const forbidden of [
  /\b(insert|update|delete|upsert|merge|truncate|refresh)\b/i,
  /\bexecute\b/i,
  /fact_[a-z_]+/i,
  /ecoflow_delivery_exceptions/i,
  /data_quality_status/i,
  /metric_value/i,
  /service_role/i,
  /recommended_action\s*:=/i,
  /owner_team\s*:=/i,
]) {
  if (forbidden.test(functionBody)) throw new Error(`INTEL_DATA_004A_FORBIDDEN_FUNCTION_PATTERN: ${forbidden}`);
}

for (const forbidden of [
  'security definer',
  'grant execute on function analytics.get_actionable_exception_queue(integer)\n  to service_role',
  'grant execute on function analytics.get_actionable_exception_queue(integer)\n  to anon',
  'create table',
  'alter table',
  'create trigger',
  'create policy',
]) {
  if (migration.toLowerCase().includes(forbidden.toLowerCase())) {
    throw new Error(`INTEL_DATA_004A_SCOPE_EXPANSION: ${forbidden}`);
  }
}

for (const testMarker of [
  'actionable exception read RPC missing',
  'actionable exception RPC must preserve caller rights',
  'ACTIONABLE_EXCEPTION_DESKTOP_ROLE_REQUIRED',
  'ACTIONABLE_EXCEPTION_LIMIT_INVALID',
  'owner_read_succeeds',
  'account_read_succeeds',
  'viewer_read_succeeds',
  'exceptions-warehouse@example.test',
  'exceptions-driver@example.test',
  'exceptions-inactive@example.test',
]) {
  if (!test.includes(testMarker)) throw new Error(`INTEL_DATA_004A_TEST_MARKER_MISSING: ${testMarker}`);
}

if (!workflow.includes(migrationPath)
  || !workflow.includes('Execute actionable exception read model tests')
  || !workflow.includes('scripts/actionable-exception-read-model-contract-test.sql')) {
  throw new Error('INTEL_DATA_004A_WORKFLOW_WIRING_MISSING');
}

const analyticsAudit = packageJson.scripts?.['audit:analytics'];
if (typeof analyticsAudit !== 'string'
  || !analyticsAudit.includes('audit-actionable-exception-read-model.mjs')) {
  throw new Error('INTEL_DATA_004A_PACKAGE_AUDIT_WIRING_MISSING');
}

console.log('INTEL-DATA-004A actionable exception read model audit passed.');
