import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrationFile =
  'supabase/migrations/20260920093537_sales_transaction_fact_foundation.sql';
const migration = fs.readFileSync(migrationFile, 'utf8');
const workflow = fs.readFileSync(
  '.github/workflows/warehouse-productisation-check.yml',
  'utf8',
);
const fixture = fs.readFileSync(
  'scripts/sales-transaction-facts-migration-fixture.sql',
  'utf8',
);

const required = [
  ['transaction boundary', /\bbegin;[\s\S]*\bcommit;\s*$/i],
  ['dependency preflight', /SALES_TRANSACTION_FACT_PREREQUISITES_MISSING/],
  ['document fact', /create table analytics\.fact_sales_transaction_document/],
  ['line fact', /create table analytics\.fact_sales_transaction_line/],
  ['document current index', /create unique index fact_sales_transaction_document_one_current[\s\S]{0,220}where is_current/],
  ['line current index', /create unique index fact_sales_transaction_line_one_current[\s\S]{0,220}where is_current/],
  ['invoice effect', /transaction_kind='INVOICE' and effect_sign=1/],
  ['credit effect', /transaction_kind='CREDIT_NOTE' and effect_sign=-1/],
  ['bounded classification', /'INVOICE_LINE','INVOICE_CHARGE','CREDIT_LINE'/],
  ['amount basis variance', /HEADER_LINE_AMOUNT_BASIS_VARIANCE/],
  ['exact order join', /ol\.order_number=d\.source_order_number/],
  ['exact invoice join', /il\.invoice_number=d\.origin_invoice_number/],
  ['controlled refresh', /create or replace function analytics\.refresh_sales_transaction_facts/],
  ['refresh lock', /pg_advisory_xact_lock\(hashtext\('analytics\.refresh_sales_transaction_facts'\)\)/],
  ['version close', /update analytics\.fact_sales_transaction_document f[\s\S]{0,450}source_version_hash<>s\.source_version_hash/],
  ['fail closed', /get stacked diagnostics v_error=message_text,v_error_code=returned_sqlstate/],
  ['quality view', /create view analytics\.v_sales_transaction_source_quality_internal[\s\S]{0,100}security_invoker=true/],
  ['document RLS', /alter table analytics\.fact_sales_transaction_document enable row level security/],
  ['line RLS', /alter table analytics\.fact_sales_transaction_line enable row level security/],
  ['sequence write fence', /do \$sequence_acl\$[\s\S]{0,700}pg_get_serial_sequence[\s\S]{0,700}revoke all on sequence %s from public,anon,authenticated,service_role/],
  ['service refresh grant', /grant execute on function analytics\.refresh_sales_transaction_facts\(timestamptz\)[\s\S]{0,40}to service_role/],
  ['document dataset never', /'analytics\.sales_transaction_documents','UNLEASHED',[\s\S]{0,120}'NEVER'/],
  ['line dataset never', /'analytics\.sales_transaction_lines','UNLEASHED',[\s\S]{0,120}'NEVER'/],
  ['no-provider boundary comment', /No provider calls/],
];

for (const [name, pattern] of required) {
  assert.match(migration, pattern, `Sales transaction fact audit failed: ${name}`);
}

const forbidden = [
  ['automatic refresh invocation', /select\s+(?:\*\s+from\s+)?analytics\.refresh_sales_transaction_facts\s*\(/i],
  ['metric insert', /insert\s+into\s+analytics\.metric_definition/i],
  ['metric update', /update\s+analytics\.metric_definition/i],
  ['browser fact read grant', /grant\s+select\s+on\s+table\s+analytics\.fact_sales_transaction_(?:document|line)[\s\S]{0,100}to\s+(?:anon|authenticated)/i],
  ['browser refresh grant', /grant\s+execute\s+on\s+function\s+analytics\.refresh_sales_transaction_facts[\s\S]{0,120}to\s+(?:anon|authenticated)/i],
  ['service fact write grant', /grant\s+(?:all|insert|update|delete|truncate)[\s\S]{0,100}analytics\.fact_sales_transaction_(?:document|line)[\s\S]{0,100}service_role/i],
  ['network extension', /http_(?:get|post)|net\.http|unleashed\.com/i],
  ['balancing row', /balancing[_ ]line/i],
  ['revenue eligibility', /revenue_eligible/i],
];

for (const [name, pattern] of forbidden) {
  assert.doesNotMatch(migration, pattern, `Sales transaction fact audit found ${name}`);
}

const supportChecks = [
  ['workflow fixture', workflow, /scripts\/sales-transaction-facts-migration-fixture\.sql/],
  ['workflow migration', workflow, /supabase\/migrations\/20260920093537_sales_transaction_fact_foundation\.sql/],
  ['workflow DB contract', workflow, /scripts\/sales-transaction-facts-contract-test\.sql/],
  ['raw snapshot shell', fixture, /create table if not exists public\.unleashed_raw_snapshots/],
];

for (const [name, content, pattern] of supportChecks) {
  assert.match(content, pattern, `Sales transaction support audit failed: ${name}`);
}
assert.doesNotMatch(
  fixture,
  /insert\s+into\s+public\.unleashed_raw_snapshots/i,
  'Sales transaction migration fixture must not include business data',
);

assert.equal(required.length, 24);
assert.equal(forbidden.length, 9);
assert.equal(supportChecks.length, 4);
console.log(
  `Sales transaction fact static audit passed (${required.length + forbidden.length + supportChecks.length + 1}/${required.length + forbidden.length + supportChecks.length + 1}).`,
);
