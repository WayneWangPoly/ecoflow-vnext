import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrationFile =
  'supabase/migrations/20260729210000_return_inspection_facts.sql';
const driftMigrationFile =
  'supabase/migrations/20260729210100_return_inspection_source_drift_capture.sql';
const contractFile = 'scripts/return-inspection-facts-contract-test.sql';
const driftContractFile =
  'scripts/return-inspection-source-drift-contract-test.sql';
const migration = fs.readFileSync(migrationFile, 'utf8');
const driftMigration = fs.readFileSync(driftMigrationFile, 'utf8');
const contract = fs.readFileSync(contractFile, 'utf8');
const driftContract = fs.readFileSync(driftContractFile, 'utf8');

const required = [
  'create table analytics.fact_return_inspection',
  'create or replace view analytics.v_return_inspection_quality',
  'create or replace function analytics.refresh_return_inspection_facts',
  "'IMMUTABLE_LINE_CURRENT_CASE_CONTEXT'",
  "'LINKED_RETURN_IN'",
  "'UNRESOLVED_MANUAL_ITEM'",
  "'MAPPED_PACKAGE_TO_BASE'",
  "'MANUAL_NATIVE_QUANTITY'",
  "'INCONSISTENT_SOURCE'",
  'analytics.ecoflow_ensure_warehouse_location_dimension',
  "'analytics.return_inspections'",
  "'automatic_backfill',false",
  'grant select on table analytics.fact_return_inspection to service_role',
  'grant execute on function analytics.refresh_return_inspection_facts',
];
for (const marker of required) {
  assert.ok(migration.includes(marker), `missing return fact marker: ${marker}`);
}

const forbidden = [
  /grant\s+(?:select|insert|update|delete|all)[^;]*analytics\.fact_return_inspection[^;]*\b(?:anon|authenticated)\b/i,
  /grant\s+(?:insert|update|delete|all)[^;]*analytics\.fact_return_inspection[^;]*service_role/i,
  /grant\s+execute[^;]*refresh_return_inspection_facts[^;]*\bauthenticated\b/i,
  /create\s+trigger[\s\S]*?on\s+public\.ecoflow_delivery_return_inspection_lines/i,
  /create\s+trigger[\s\S]*?on\s+public\.ecoflow_delivery_exceptions/i,
  /select\s+analytics\.refresh_return_inspection_facts\s*\(/i,
  /perform\s+analytics\.refresh_return_inspection_facts\s*\(/i,
];
for (const pattern of forbidden) {
  assert.ok(!pattern.test(migration), `forbidden return fact pattern: ${pattern}`);
}

const forbiddenFactColumns = [
  'manual_item text',
  'inspection_note text',
  'reason text',
  'driver_note text',
  'store_email text',
  'store_phone text',
  'pod2_path text',
  'latitude double precision',
  'longitude double precision',
];
for (const marker of forbiddenFactColumns) {
  assert.ok(
    !migration.includes(marker),
    `sensitive/free-text column leaked into return fact schema: ${marker}`,
  );
}

assert.ok(
  migration.includes(
    "history_completeness='IMMUTABLE_LINE_CURRENT_CASE_CONTEXT'",
  ),
  'return fact must disclose current-case-context history limitation',
);
assert.ok(
  migration.includes("'grain','one durable return inspection line'"),
  'refresh metadata must declare exact inspection-line grain',
);
assert.ok(
  !migration.includes("metric_key='return_processing_time'"),
  'case-level KPI must not be activated from inspection-line grain',
);
assert.ok(
  contract.includes('transport-only updated_at change altered business hash'),
  'contract must prove generic timestamps do not alter business hash',
);
assert.ok(
  contract.includes('case completion context was not enriched in place'),
  'contract must prove parent completion enriches without line duplication',
);
assert.ok(
  contract.includes('free-text, contact, POD or coordinate field leaked into facts'),
  'contract must check privacy boundary',
);

const driftRequired = [
  'alter column source_order_id drop not null',
  'drop constraint if exists return_inspection_source_key_not_blank',
  "check(btrim(source_inspection_key)<>'')",
  'Blank legacy values are retained only as INVALID quality rows',
];
for (const marker of driftRequired) {
  assert.ok(
    driftMigration.includes(marker),
    `missing return source-drift marker: ${marker}`,
  );
}

const driftForbidden = [
  /\b(?:insert|update|delete)\s+(?:into\s+|from\s+)?public\.ecoflow_/i,
  /create\s+trigger/i,
  /refresh_return_inspection_facts\s*\(/i,
  /grant\s+[^;]*\b(?:anon|authenticated)\b/i,
];
for (const pattern of driftForbidden) {
  assert.ok(
    !pattern.test(driftMigration),
    `forbidden return source-drift pattern: ${pattern}`,
  );
}

assert.ok(
  driftContract.includes('blank source order key aborted return refresh'),
  'source-drift contract must prove malformed rows do not abort refresh',
);
assert.ok(
  driftContract.includes("quality_detail='SOURCE_ORDER_ID_MISSING'"),
  'source-drift contract must retain an explicit quality code',
);
assert.ok(
  driftContract.includes('source drift contract created an unexpected fact count'),
  'source-drift contract must prove exact line grain',
);

console.log('Return inspection fact boundary audit passed.');
