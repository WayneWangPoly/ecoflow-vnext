import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrationPath = 'supabase/migrations/20260731083000_initial_kpi_shadow_drill_evidence.sql';
const testPath = 'scripts/initial-kpi-shadow-drill-evidence-contract-test.sql';
const workflowPath = '.github/workflows/warehouse-productisation-check.yml';
const packagePath = 'package.json';

for (const path of [migrationPath, testPath, workflowPath, packagePath]) {
  assert.ok(fs.existsSync(path), `missing shadow drill evidence package file: ${path}`);
}

const migration = fs.readFileSync(migrationPath, 'utf8');
const tests = fs.readFileSync(testPath, 'utf8');
const workflow = fs.readFileSync(workflowPath, 'utf8');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

for (const marker of [
  'get_initial_kpi_shadow_drill_evidence',
  'analytics.v_initial_kpi_line_projection_internal',
  'analytics.fact_order_line',
  'public.app_user_profiles',
  "v_metric_key not in ('fill_rate','substitution_rate')",
  "v_dimension_key not in ('date','commercial_sku')",
  "v_metric_status is distinct from 'DRAFT'",
  "v_projection_status is distinct from 'SHADOW'",
  "'SHADOW_ONLY'::text",
  "'kind','order'",
  'p_breakdown_limit>50',
  'p_entity_limit>100',
  'entities_truncated boolean',
  'statement_timestamp()',
  'INITIAL_KPI_SHADOW_DRILL_OWNER_OR_ADMIN_REQUIRED',
  'INITIAL_KPI_SHADOW_DRILL_GOVERNANCE_STATE_REQUIRED',
]) {
  assert.ok(migration.includes(marker), `missing shadow drill evidence marker: ${marker}`);
}

for (const forbidden of [
  /metric_value_percent/i,
  /numerator_quantity/i,
  /denominator_quantity/i,
  /fulfilled_quantity/i,
  /ordered_quantity/i,
  /line_total/i,
  /unit_price/i,
  /update\s+analytics\.metric_definition/i,
  /update\s+analytics\.metric_projection_readiness/i,
  /insert\s+into\s+analytics\./i,
  /delete\s+from\s+analytics\./i,
  /truncate\s+analytics\./i,
  /create\s+(?:or\s+replace\s+)?trigger/i,
  /get_initial_kpi_shadow_projection\s*\(/i,
  /get_initial_kpi_reconciliation\s*\(/i,
  /get_metric_drill_access\s*\(/i,
  /grant\s+execute[\s\S]*?\b(?:public|anon|service_role)\b/i,
  /public\.ecoflow_ordermentum_/i,
  /public\.ordermentum_/i,
  /public\.om_/i,
]) {
  assert.ok(!forbidden.test(migration), `shadow drill evidence scope expansion: ${forbidden}`);
}

assert.equal(
  (migration.match(/create or replace function analytics\.get_initial_kpi_shadow_drill_evidence/g) ?? []).length,
  1,
  'shadow drill evidence package must create exactly one read RPC',
);
assert.equal(
  (migration.match(/grant execute on function analytics\.get_initial_kpi_shadow_drill_evidence/g) ?? []).length,
  1,
  'shadow drill evidence RPC must have one authenticated execute grant',
);

for (const marker of [
  'shadow drill evidence RPC governance/source contract is incomplete',
  'shadow drill evidence RPC exposes arithmetic or writes data',
  'bounded routeable Order evidence contract failed',
  'unavailable shadow evidence reason was not preserved',
  'substitution partial/empty shadow evidence contract failed',
  'shadow evidence incorrectly granted production drill authority',
  'INITIAL_KPI_SHADOW_DRILL_DIMENSION_NOT_AVAILABLE',
  'INITIAL_KPI_SHADOW_DRILL_GOVERNANCE_STATE_REQUIRED',
]) {
  assert.ok(tests.includes(marker), `missing shadow drill evidence contract coverage: ${marker}`);
}

const migrationIndex = workflow.indexOf(migrationPath);
const migrationStepIndex = workflow.indexOf('Apply initial KPI shadow drill evidence migration');
const testIndex = workflow.indexOf(testPath);
const accessTestIndex = workflow.indexOf('scripts/metric-drill-access-contract-test.sql');
const downstreamIndex = workflow.indexOf('scripts/unknown-barcode-contract-test.sql');
assert.ok(migrationIndex >= 0 && migrationStepIndex >= 0, 'shadow drill evidence migration is not wired');
assert.ok(testIndex >= 0, 'shadow drill evidence test is not wired');
assert.ok(
  migrationIndex > accessTestIndex && testIndex > migrationIndex && testIndex < downstreamIndex,
  'shadow drill evidence migration/test order is incorrect',
);

const analyticsAudit = packageJson.scripts?.['audit:analytics'];
assert.equal(typeof analyticsAudit, 'string', 'audit:analytics command missing');
assert.ok(
  analyticsAudit.includes('audit-initial-kpi-shadow-drill-evidence.mjs'),
  'shadow drill evidence audit is not wired to audit:analytics',
);

console.log('INTEL-DATA-005B initial KPI Shadow drill evidence audit passed.');
