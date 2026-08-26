#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = 'supabase/migrations/20260826100000_ordermentum_derived_json_retention.sql';
const workflowPath = '.github/workflows/ordermentum-derived-json-maintenance.yml';
const [migration, workflow] = await Promise.all([
  readFile(migrationPath, 'utf8'),
  readFile(workflowPath, 'utf8'),
]);

function requireText(source, expected, label) {
  assert.ok(source.includes(expected), `${label} is missing required contract: ${expected}`);
}

requireText(migration, 'create or replace function public.ecoflow_slim_om_invoice_raw_json()', 'invoice slimming trigger function');
requireText(migration, 'create trigger ecoflow_slim_om_invoice_raw_json', 'invoice slimming trigger');
requireText(migration, 'before insert or update of raw_json on public.om_invoices', 'invoice trigger scope');
for (const key of [
  "'paymentMethod'", "'invoicePaymentMethod'", "'currentPaymentMethod'",
  "'paymentTerms'", "'paymentTerm'", "'terms'", "'unleashedStatus'", "'syncStatus'",
  "'{integrations,unleashed,status}'",
]) requireText(migration, key, 'invoice compatibility JSON');

requireText(migration, 'create or replace function public.ecoflow_slim_om_order_item_raw_json()', 'line-item slimming trigger function');
requireText(migration, "new.raw_json := '{}'::jsonb;", 'line-item empty derived JSON');
requireText(migration, 'before insert or update of raw_json on public.om_order_items', 'line-item trigger scope');

for (const fn of ['ecoflow_slim_om_invoice_raw_json()', 'ecoflow_slim_om_order_item_raw_json()']) {
  requireText(migration, `revoke all on function public.${fn} from public;`, `${fn} public revoke`);
  requireText(migration, `revoke all on function public.${fn} from anon;`, `${fn} anon revoke`);
  requireText(migration, `revoke all on function public.${fn} from authenticated;`, `${fn} authenticated revoke`);
}

assert.ok(!/update\s+public\.om_(invoices|order_items)/i.test(migration), 'migration must not rewrite existing derived JSON');
assert.ok(!/vacuum\s/i.test(migration), 'migration must not hide physical compaction');
assert.ok(!/delete\s+from\s+public\.ordermentum_/i.test(migration), 'migration must not delete raw Ordermentum authority');

requireText(workflow, 'workflow_dispatch:', 'maintenance manual trigger');
assert.ok(!/\n\s*schedule:\s*\n/.test(workflow), 'derived JSON maintenance must not be scheduled');
assert.ok(!/\n\s*push:\s*\n/.test(workflow), 'derived JSON maintenance must not run on push');
assert.ok(!/\n\s*workflow_run:\s*\n/.test(workflow), 'derived JSON maintenance must not chain automatically');
requireText(workflow, '- compact_derived_json', 'explicit compact mode');
requireText(workflow, 'retention-days: 1', 'one-day evidence retention');
requireText(workflow, 'group: ordermentum-cloud-sync', 'sync serialization');
requireText(workflow, 'lock_timeout=30s', 'bounded exclusive-lock wait');
requireText(workflow, 'DATABASE_QUOTA_BYTES: "524288000"', '500 MiB quota ceiling');
requireText(workflow, 'TRANSIENT_MARGIN_BYTES: "4194304"', 'transient compaction margin');
requireText(workflow, 'ITEM_TRANSIENT_REQUIRED=$((2 * (ITEM_HEAP_BYTES + ITEM_INDEX_BYTES) + TRANSIENT_MARGIN_BYTES))', 'line-item live headroom estimate');
requireText(workflow, 'INVOICE_TRANSIENT_REQUIRED=$((2 * (INVOICE_HEAP_NOW + INVOICE_INDEX_NOW) + TRANSIENT_MARGIN_BYTES))', 'invoice live headroom estimate');
requireText(workflow, 'Insufficient headroom for first VACUUM FULL', 'preflight abort');
requireText(workflow, 'Line-item reclaim succeeded but invoice compaction lacks safe headroom', 'mid-flight safe stop');

const itemUpdate = workflow.indexOf("update public.om_order_items set raw_json='{}'::jsonb");
const itemVacuum = workflow.indexOf('vacuum (full, analyze, verbose) public.om_order_items');
const invoiceUpdate = workflow.indexOf('update public.om_invoices set raw_json=raw_json');
const invoiceVacuum = workflow.indexOf('vacuum (full, analyze, verbose) public.om_invoices');
assert.ok(itemUpdate >= 0 && itemVacuum > itemUpdate, 'line items must be slimmed then compacted');
assert.ok(invoiceUpdate > itemVacuum && invoiceVacuum > invoiceUpdate, 'invoices must run only after line-item headroom is reclaimed');
requireText(workflow, 'vacuum (analyze) public.om_order_items', 'dead-tuple cleanup before item full compaction');
requireText(workflow, 'vacuum (analyze) public.om_invoices', 'dead-tuple cleanup before invoice full compaction');

for (const evidence of [
  'ITEM_IDENTITY_BEFORE', 'INVOICE_IDENTITY_BEFORE',
  'ITEM_STRUCTURED_BEFORE', 'INVOICE_STRUCTURED_BEFORE',
  'FINANCIAL_BEFORE', 'FINANCIAL_AFTER',
  'quota_headroom_before=', 'quota_headroom_after_line_items=',
  'identity_and_structured_fingerprints_unchanged=true',
  'financial_view_fingerprint_unchanged=true',
]) requireText(workflow, evidence, 'maintenance verification');

assert.ok(!/update\s+public\.ordermentum_raw/i.test(workflow), 'maintenance must not update raw Ordermentum authority');
assert.ok(!/vacuum[^\n]*public\.ordermentum_raw/i.test(workflow), 'maintenance must not compact raw authority in this package');
requireText(workflow, 'MAX_ACCEPTABLE_BYTES_AFTER: "445644800"', '425 MiB post-maintenance safety target');

console.log('Ordermentum derived JSON retention audit passed: future derived JSON is bounded, physical reclaim is explicit, live quota headroom gates each VACUUM FULL, and raw authority is untouched.');
