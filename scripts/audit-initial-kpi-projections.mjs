import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrationFile =
  'supabase/migrations/20260729220000_initial_kpi_projections_reconciliation.sql';
const contractFile = 'scripts/initial-kpi-projections-contract-test.sql';
const migration = fs.readFileSync(migrationFile, 'utf8');
const contract = fs.readFileSync(contractFile, 'utf8');

const required = [
  'create table analytics.metric_projection_readiness',
  'create table analytics.metric_order_status_policy',
  'create or replace view analytics.v_initial_kpi_line_projection_internal',
  'create or replace view analytics.v_initial_kpi_reconciliation_internal',
  'create or replace function analytics.get_initial_kpi_shadow_projection',
  'create or replace function analytics.get_initial_kpi_reconciliation',
  "'fill_rate',1,'SHADOW'",
  "'substitution_rate',1,'SHADOW'",
  "'revenue',1,'BLOCKED'",
  "'ORDER_CURRENCY_NOT_CAPTURED'",
  "'ACTUAL_COST_COVERAGE_NOT_ESTABLISHED'",
  "'PROMISED_TIME_NOT_CAPTURED'",
  "'FULFILMENT_CAPTURE_COVERAGE_NOT_ESTABLISHED'",
  "'ACCEPTED','INCLUDE'",
  "'ORDER_STATUS_UNCLASSIFIED'",
  "'ZERO_FULFILLED_DENOMINATOR'",
  "'FULFILMENT_UNIT_MISMATCH'",
  "'OVERFULFILLED_SOURCE_LINE'",
  "projection_state='SHADOW_READY'",
  'if p_date_to-p_date_from>366 then',
  "v_role not in ('OWNER','ADMIN')",
];

for (const marker of required) {
  assert.ok(migration.includes(marker), `missing initial KPI marker: ${marker}`);
}

const forbidden = [
  /set\s+status\s*=\s*'ACTIVE'/i,
  /values\s*\([^)]*'ACTIVE'[^)]*\)[\s\S]*metric_definition/i,
  /grant\s+select[^;]*v_initial_kpi_(?:line_projection|reconciliation)_internal[^;]*authenticated/i,
  /grant\s+execute[^;]*get_initial_kpi_(?:shadow_projection|reconciliation)[^;]*\banon\b/i,
  /create\s+trigger/i,
  /(?:select|perform)\s+analytics\.refresh_(?:order_fulfilment|inventory|delivery|return)/i,
  /\bAUD\b/,
  /coalesce\s*\(\s*metric_value_percent\s*,\s*0\s*\)/i,
  /coalesce\s*\(\s*[^,]*metric_value[^,]*,\s*0\s*\)/i,
];

for (const pattern of forbidden) {
  assert.ok(!pattern.test(migration), `forbidden initial KPI pattern: ${pattern}`);
}

const acceptedSeedCount = (
  migration.match(/'ACCEPTED','INCLUDE'/g) ?? []
).length;
assert.equal(
  acceptedSeedCount,
  2,
  'v1 must seed only the two evidenced ACCEPTED policies',
);

assert.ok(
  migration.includes("when e.order_status_eligibility is null then 'UNAVAILABLE'"),
  'unlisted source statuses must fail closed',
);
assert.ok(
  migration.includes("when e.metric_key='substitution_rate'") &&
    migration.includes("and e.active_fulfilled_quantity=0 then 'EMPTY'"),
  'zero substitution denominator must remain empty',
);
assert.ok(
  migration.includes("when c.projection_state='SHADOW_READY' then round("),
  'metric values must only be emitted for shadow-ready rows',
);
assert.ok(
  migration.includes("where metric_key='fill_rate' and metric_version=1 and status='DRAFT'"),
  'fill-rate registry update must remain draft-scoped',
);
assert.ok(
  migration.includes("where metric_key='substitution_rate' and metric_version=1 and status='DRAFT'"),
  'substitution registry update must remain draft-scoped',
);

const contractMarkers = [
  'zero substitution denominator was silently converted to zero',
  'confirmed zero numerator was not represented as real zero',
  'unknown order status did not fail closed',
  'degraded order fact did not fail closed',
  'overfulfilment did not fail closed',
  'unit mismatch did not fail closed',
  'stale fulfilment source did not suppress the metric value',
  'a comparable initial KPI line did not reconcile',
  'viewer could read DRAFT KPI readiness rows',
  'INITIAL_KPI_DATE_RANGE_TOO_LARGE',
];

for (const marker of contractMarkers) {
  assert.ok(contract.includes(marker), `missing KPI contract marker: ${marker}`);
}

console.log('Initial KPI projection boundary audit passed.');
