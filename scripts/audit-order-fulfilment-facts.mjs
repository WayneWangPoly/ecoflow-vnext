import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrationFile =
  'supabase/migrations/20260729090000_order_fulfilment_facts.sql';
const migration = fs.readFileSync(migrationFile, 'utf8');

// This audit protects boundaries the runtime contract cannot prove by row data:
// no browser command grants, no automatic refresh, no inferred fulfilment,
// no direct service writes to derived facts, and no observation timestamp in
// the business-version hash.
const checks = [
  ['transaction boundary', /\bbegin;\s*[\s\S]*\bcommit;\s*$/i],
  ['preflight', /ORDER_FULFILMENT_FACT_PREREQUISITES_MISSING/],
  ['explicit ledger', /create table public\.ecoflow_order_fulfilment_allocations/],
  ['source event idempotency', /source_event_key text not null unique/],
  ['commercial snapshot', /commercial_sku_code text not null[\s\S]{0,160}commercial_product_name text not null/],
  ['physical snapshot', /physical_sku_id uuid not null[\s\S]{0,180}physical_sku_code text not null[\s\S]{0,120}physical_product_name text not null/],
  ['substitution reason', /order_fulfilment_substitution_reason_required/],
  ['command-only table revoke', /revoke all on table public\.ecoflow_order_fulfilment_allocations[\s\S]{0,100}service_role/],
  ['service read only table grant', /grant select on table public\.ecoflow_order_fulfilment_allocations to service_role/],
  ['record command', /create or replace function public\.ecoflow_record_order_fulfilment_allocation/],
  ['event conflict', /FULFILMENT_EVENT_KEY_CONFLICT/],
  ['unit conversion gate', /FULFILMENT_UNIT_CONVERSION_REQUIRED/],
  ['service-line physical gate', /FULFILMENT_SERVICE_LINE_NOT_PHYSICAL/],
  ['quantity ceiling', /FULFILMENT_QUANTITY_EXCEEDS_ORDERED/],
  ['source-line advisory lock', /pg_advisory_xact_lock\(hashtext\(v_source_line_key\)\)/],
  ['void command', /create or replace function public\.ecoflow_void_order_fulfilment_allocation/],
  ['order fact', /create table analytics\.fact_order_line/],
  ['fulfilment fact', /create table analytics\.fact_fulfilment_line/],
  ['service order fact read', /grant select on table analytics\.fact_order_line to service_role/],
  ['service fulfilment fact read', /grant select on table analytics\.fact_fulfilment_line to service_role/],
  ['current version index', /create unique index fact_order_line_one_current[\s\S]{0,180}where is_current/],
  ['coverage projection', /create or replace view analytics\.v_order_fulfilment_coverage/],
  ['controlled refresh', /create or replace function analytics\.refresh_order_fulfilment_facts/],
  ['refresh advisory lock', /pg_advisory_xact_lock\(hashtext\('analytics\.refresh_order_fulfilment_facts'\)\)/],
  ['version close', /update analytics\.fact_order_line f[\s\S]{0,500}source_version_hash<>s\.source_version_hash/],
  ['no default mapping inference', /Default mappings and pick summaries are not evidence/],
  ['no automatic refresh invocation', /not invoked automatically by migration or browser clients/i],
  ['draft metric protection comment', /No production backfill is executed by this migration/],
  ['service refresh grant', /grant execute on function analytics\.refresh_order_fulfilment_facts\(timestamptz\)[\s\S]{0,40}to service_role/],
  ['pgrst reload', /notify pgrst,'reload schema'/],
];

for (const [name, pattern] of checks) {
  assert.match(migration, pattern, `Order/fulfilment fact audit failed: ${name}`);
}

for (const [name, pattern] of [
  [
    'browser record command grant',
    /grant execute on function public\.ecoflow_record_order_fulfilment_allocation[\s\S]{0,180}to (?:anon|authenticated)/,
  ],
  [
    'browser void command grant',
    /grant execute on function public\.ecoflow_void_order_fulfilment_allocation[\s\S]{0,120}to (?:anon|authenticated)/,
  ],
  [
    'browser refresh grant',
    /grant execute on function analytics\.refresh_order_fulfilment_facts[\s\S]{0,120}to (?:anon|authenticated)/,
  ],
  [
    'metric activation',
    /update analytics\.metric_definition[\s\S]{0,200}status\s*=\s*'ACTIVE'/,
  ],
  [
    'automatic refresh call',
    /select\s+\*\s+from\s+analytics\.refresh_order_fulfilment_facts/i,
  ],
  [
    'day state inference',
    /from\s+public\.ecoflow_day_state/i,
  ],
  [
    'direct service fact writes',
    /grant all on table analytics\.fact_(?:order|fulfilment)_line to service_role/,
  ],
  [
    'broad analytics sequence grant',
    /grant usage,select on all sequences in schema analytics to service_role/,
  ],
  [
    'observation time in business version hash',
    /jsonb_build_array\([\s\S]{0,1200}last_synced_at[\s\S]{0,120}\)::text/,
  ],
]) {
  assert.doesNotMatch(migration, pattern, `Order/fulfilment fact audit found ${name}`);
}

assert.equal(checks.length, 30);
console.log(`Order/fulfilment fact static audit passed (${checks.length}/${checks.length}).`);
