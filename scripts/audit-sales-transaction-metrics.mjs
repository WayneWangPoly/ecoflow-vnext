import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  'supabase/migrations/20260921015000_sales_transaction_metric_semantics.sql',
  'utf8',
);
const rematerializationMigration = fs.readFileSync(
  'supabase/migrations/20260921044500_sales_transaction_transform_version_rematerialization.sql',
  'utf8',
);
const workflow = fs.readFileSync(
  '.github/workflows/warehouse-productisation-check.yml',
  'utf8',
);
const factContract = fs.readFileSync(
  'scripts/sales-transaction-facts-contract-test.sql',
  'utf8',
);

const required = [
  ['InvoiceStatus mapping', /InvoiceStatus/],
  ['legacy invoice Status fallback', /InvoiceStatus'[\s\S]{0,120}Status'/],
  ['metric input view', /create or replace view analytics\.v_sales_transaction_metric_input_internal/],
  ['security invoker view', /security_barrier=true,security_invoker=true/],
  ['service-only view read', /grant select on analytics\.v_sales_transaction_metric_input_internal[\s\S]{0,60}to service_role/],
  ['reconciliation function', /create or replace function analytics\.reconcile_sales_transaction_metrics/],
  ['service-only reconciliation', /grant execute on function analytics\.reconcile_sales_transaction_metrics\(date,date\)[\s\S]{0,60}to service_role/],
  ['Revenue v2', /'revenue',2,'Revenue'/],
  ['Sales Orders v1', /'sales_orders',1,'Sales Orders'/],
  ['Average Revenue per Order v1', /'average_revenue_per_order',1,'Average Revenue per Order'/],
  ['base currency revenue', /source_bc_subtotal/],
  ['completed eligibility', /document_status='Completed'/],
  ['distinct order denominator', /count\(distinct v\.completed_invoice_order_key\)/],
  ['zero denominator null', /nullif\([\s\S]{0,180}completed_invoice_order_key/],
  ['all candidates draft', /'DRAFT'\s*\)\s*,[\s\S]*'DRAFT'\s*\)\s*,[\s\S]*'DRAFT'\s*\)/],
  ['workflow migration', /20260921015000_sales_transaction_metric_semantics\.sql/, workflow],
  ['workflow audit', /audit-sales-transaction-metrics\.mjs/, workflow],
  ['contract parked invoice', /InvoiceStatus":"Parked"/, factContract],
  ['contract distinct order metric', /sales_orders=2/, factContract],
  ['transform contract version', /sales_transaction_transform_v2_invoice_status/, rematerializationMigration],
  ['document transform hash', /sales_transaction_transform_v2_invoice_status'[\s\S]{0,180}d\.source_snapshot_hash,d\.order_snapshot_hash,d\.invoice_snapshot_hash/, rematerializationMigration],
  ['line transform hash', /sales_transaction_transform_v2_invoice_status'[\s\S]{0,220}d\.source_snapshot_hash,d\.order_snapshot_hash,d\.invoice_snapshot_hash,l\.value,l\.ordinality/, rematerializationMigration],
  ['workflow rematerialization migration', /20260921044500_sales_transaction_transform_version_rematerialization\.sql/, workflow],
  ['legacy same-source-hash regression', /legacy_without_transform_contract[\s\S]{0,4000}\$transform_rematerialization\$/, factContract],
];

for (const [name, pattern, content = migration] of required) {
  assert.match(content, pattern, `Sales transaction metric audit failed: ${name}`);
}

const forbidden = [
  ['metric activation', /status\s*=\s*'ACTIVE'|,'ACTIVE'\s*\)/i],
  ['metric deprecation', /status\s*=\s*'DEPRECATED'|,'DEPRECATED'\s*\)/i],
  ['Revenue v1 update', /update\s+analytics\.metric_definition[\s\S]{0,400}metric_key\s*=\s*'revenue'/i],
  ['metric delete', /delete\s+from\s+analytics\.metric_definition/i],
  ['automatic fact refresh', /select\s+(?:\*\s+from\s+)?analytics\.refresh_sales_transaction_facts\s*\(/i],
  ['provider traffic', /http_(?:get|post)|net\.http|unleashedsoftware\.com/i],
  ['balancing row', /balancing[_ ]line/i],
];

for (const [name, pattern] of forbidden) {
  assert.doesNotMatch(migration, pattern, `Sales transaction metric audit found forbidden ${name} in metric migration`);
  assert.doesNotMatch(rematerializationMigration, pattern, `Sales transaction metric audit found forbidden ${name} in rematerialization migration`);
}

assert.equal(required.length, 24);
assert.equal(forbidden.length, 7);
console.log(
  `Sales transaction metric static audit passed (${required.length + (forbidden.length * 2)}/${required.length + (forbidden.length * 2)}).`,
);
