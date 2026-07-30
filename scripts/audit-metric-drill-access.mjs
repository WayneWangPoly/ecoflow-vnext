import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrationPath = 'supabase/migrations/20260731070000_metric_drill_access_envelope.sql';
const testPath = 'scripts/metric-drill-access-contract-test.sql';
const workflowPath = '.github/workflows/warehouse-productisation-check.yml';
const packagePath = 'package.json';

for (const file of [migrationPath, testPath, workflowPath, packagePath]) {
  assert.ok(fs.existsSync(file), `missing metric drill access package file: ${file}`);
}

const migration = fs.readFileSync(migrationPath, 'utf8');
const migrationSql = migration.replace(/--.*$/gm, '');
const contract = fs.readFileSync(testPath, 'utf8');
const workflow = fs.readFileSync(workflowPath, 'utf8');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

for (const marker of [
  'create or replace function analytics.get_metric_drill_access()',
  'v_user uuid := auth.uid()',
  'from public.app_user_profiles p',
  'p.user_id=v_user',
  'p.is_active=true',
  "p.team_status='ACTIVE'",
  "v_role not in ('OWNER','ADMIN')",
  "message='METRIC_DRILL_ACCESS_OWNER_OR_ADMIN_REQUIRED'",
  'analytics.metric_projection_readiness r',
  'analytics.metric_definition d',
  "d.status='ACTIVE'",
  "r.projection_status='READY'",
  'cardinality(r.supported_dimension_keys)>0',
  "then 'AVAILABLE'",
  "else 'UNAVAILABLE'",
  "else '{}'::text[]",
  'r.supported_dimension_keys as declared_dimension_keys',
  "'METRIC_NOT_ACTIVE'",
  "'PROJECTION_'||r.projection_status",
  "'NO_SUPPORTED_DIMENSIONS'",
  'statement_timestamp()',
  'grant execute on function analytics.get_metric_drill_access()',
  'Returns no KPI values, facts, breakdowns, or affected entities.',
]) {
  assert.ok(migration.includes(marker), `missing metric drill access marker: ${marker}`);
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
  assert.ok(migration.includes(`'${metricKey}'`), `missing drill access metric identity: ${metricKey}`);
}

for (const pattern of [
  /\bmetric_value\b/i,
  /\bfact_[a-z_]+\b/i,
  /v_initial_kpi_[a-z_]+_internal/i,
  /\b(?:from|join)\s+(?:analytics\.)?[a-z0-9_]*breakdown[a-z0-9_]*/i,
  /\b(?:from|join)\s+(?:analytics\.)?[a-z0-9_]*affected_entit(?:y|ies)[a-z0-9_]*/i,
  /(?:select|perform)\s+analytics\.refresh_[a-z_]+/i,
  /\bcreate\s+trigger\b/i,
  /\binsert\s+into\s+analytics\./i,
  /\bupdate\s+analytics\./i,
  /\bdelete\s+from\s+analytics\./i,
  /set\s+status\s*=\s*'ACTIVE'/i,
  /set\s+projection_status\s*=\s*'READY'/i,
  /grant\s+execute[^;]*\b(?:public|anon|service_role)\b/i,
  /\bexecute\s+format\b/i,
  /\bdynamic\s+sql\b/i,
]) {
  assert.ok(!pattern.test(migrationSql), `forbidden metric drill access pattern: ${pattern}`);
}

for (const marker of [
  'metric drill access RPC missing',
  'metric drill access RPC execute ACL is incorrect',
  'METRIC_DRILL_ACCESS_OWNER_OR_ADMIN_REQUIRED',
  'owner did not receive exactly ten metric drill access rows',
  'metric drill access rows are not in canonical Operational Pulse order',
  'current Shadow or Blocked metrics unexpectedly received drill authority',
  'metric drill access reasons or governed blocker codes were not preserved',
  'metric drill access rows do not share one server read timestamp',
  'admin did not receive exactly ten metric drill access rows',
  'ACTIVE READY metric with governed dimensions did not receive drill authority',
  'READY metric without governed dimensions did not fail closed',
]) {
  assert.ok(contract.includes(marker), `missing metric drill access test marker: ${marker}`);
}

for (const marker of [
  'supabase/migrations/20260731070000_metric_drill_access_envelope.sql',
  'scripts/metric-drill-access-contract-test.sql',
  'Apply metric drill access envelope migration',
  'Execute metric drill access tests',
]) {
  assert.ok(workflow.includes(marker), `metric drill access workflow wiring missing: ${marker}`);
}

const lifecycleAccess = workflow.indexOf('Apply lifecycle access envelope migration');
const drillAccess = workflow.indexOf('Apply metric drill access envelope migration');
if (lifecycleAccess < 0 || drillAccess < lifecycleAccess) {
  throw new Error('metric drill access migration is not applied after earlier lifecycle migrations');
}

const analyticsAudit = packageJson.scripts?.['audit:analytics'];
assert.equal(typeof analyticsAudit, 'string', 'audit:analytics command missing');
assert.ok(
  analyticsAudit.includes('audit-metric-drill-access.mjs'),
  'metric drill access static audit is not wired to audit:analytics',
);

console.log('INTEL-DATA-005A metric drill access audit passed.');
