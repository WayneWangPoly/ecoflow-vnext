import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrationPath = 'supabase/migrations/20260730103000_metric_readiness_read_boundary.sql';
const testPath = 'scripts/metric-readiness-rpc-contract-test.sql';
const workflowPath = '.github/workflows/warehouse-productisation-check.yml';
const packagePath = 'package.json';

for (const file of [migrationPath, testPath, workflowPath, packagePath]) {
  assert.ok(fs.existsSync(file), `missing metric readiness package file: ${file}`);
}

const migration = fs.readFileSync(migrationPath, 'utf8');
const contract = fs.readFileSync(testPath, 'utf8');
const workflow = fs.readFileSync(workflowPath, 'utf8');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

for (const marker of [
  'create or replace function analytics.get_metric_projection_readiness()',
  "v_role not in ('OWNER','ADMIN')",
  "message='METRIC_READINESS_OWNER_ROLE_REQUIRED'",
  'analytics.metric_projection_readiness r',
  'analytics.metric_definition d',
  'd.display_name',
  'd.unit_kind',
  'd.status as metric_status',
  'r.projection_status',
  'r.exact_grain',
  'r.blocker_codes',
  'greatest(r.updated_at,d.updated_at)',
  'grant execute on function analytics.get_metric_projection_readiness()',
  "'Owner/Admin bounded read-only governance metadata",
]) {
  assert.ok(migration.includes(marker), `missing readiness RPC marker: ${marker}`);
}

for (const metricKey of [
  'revenue',
  'gross_margin',
  'fill_rate',
  'on_time_delivery_rate',
  'stockout_risk_count',
  'dead_stock_value',
  'substitution_rate',
  'lines_picked_per_hour',
  'inventory_days_of_cover',
  'customer_concentration',
]) {
  assert.ok(migration.includes(`'${metricKey}'`), `missing readiness metric identity: ${metricKey}`);
}

for (const pattern of [
  /\bmetric_value\b/i,
  /\bfact_[a-z_]+\b/i,
  /v_initial_kpi_[a-z_]+_internal/i,
  /(?:select|perform)\s+analytics\.refresh_[a-z_]+/i,
  /\bcreate\s+trigger\b/i,
  /\binsert\s+into\s+analytics\./i,
  /\bupdate\s+analytics\./i,
  /\bdelete\s+from\s+analytics\./i,
  /set\s+status\s*=\s*'ACTIVE'/i,
  /projection_status\s*=\s*'READY'/i,
  /grant\s+execute[^;]*\b(?:public|anon|service_role)\b/i,
  /\bexecute\s+format\b/i,
  /\bdynamic\s+sql\b/i,
]) {
  assert.ok(!pattern.test(migration), `forbidden readiness RPC pattern: ${pattern}`);
}

for (const marker of [
  'metric readiness read RPC missing',
  'metric readiness RPC execute ACL is incorrect',
  'METRIC_READINESS_OWNER_ROLE_REQUIRED',
  'owner did not receive exactly ten metric readiness rows',
  'metric readiness rows are not in canonical Operational Pulse order',
  'metric readiness states or DRAFT registry status changed',
  'shadow or blocked readiness rows lost blocker codes',
  'metric readiness read model lost governed display metadata',
]) {
  assert.ok(contract.includes(marker), `missing readiness RPC contract marker: ${marker}`);
}

for (const marker of [
  'supabase/migrations/20260730103000_metric_readiness_read_boundary.sql',
  'scripts/metric-readiness-rpc-contract-test.sql',
  'Execute metric readiness read boundary tests',
]) {
  assert.ok(workflow.includes(marker), `metric readiness workflow wiring missing: ${marker}`);
}

const analyticsAudit = packageJson.scripts?.['audit:analytics'];
assert.equal(typeof analyticsAudit, 'string', 'audit:analytics command missing');
assert.ok(
  analyticsAudit.includes('audit-metric-readiness-rpc.mjs'),
  'metric readiness static audit is not wired to audit:analytics',
);

console.log('INTEL-DATA-003A metric readiness RPC audit passed.');
