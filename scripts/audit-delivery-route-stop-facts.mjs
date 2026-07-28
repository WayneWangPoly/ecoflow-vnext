import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrationFile =
  'supabase/migrations/20260729200000_delivery_route_stop_execution_facts.sql';
const contractFile = 'scripts/delivery-route-stop-facts-contract-test.sql';
const migration = fs.readFileSync(migrationFile, 'utf8');
const contract = fs.readFileSync(contractFile, 'utf8');

const required = [
  ['transaction boundary', /\bbegin;\s*[\s\S]*\bcommit;\s*$/i],
  ['preflight', /DELIVERY_EXECUTION_FACT_PREREQUISITES_MISSING/],
  ['route observation fact', /create table analytics\.fact_delivery_route_observation/],
  ['stop observation fact', /create table analytics\.fact_delivery_stop_observation/],
  ['route current uniqueness', /create unique index delivery_route_one_current/],
  ['stop current uniqueness', /create unique index delivery_stop_one_current/],
  ['route dimension', /references analytics\.dim_route/],
  ['driver dimension', /references analytics\.dim_driver/],
  ['observed driver count', /\bobserved_driver_count\b/],
  ['combined driver evidence', /select da\.driver_user_id[\s\S]{0,500}union all[\s\S]{0,300}select dl\.driver_user_id/],
  ['parsed durable dates', /\bparsed_business_day\b/],
  ['two typed POD rules', /POD1_DROP_POINT[\s\S]*POD2_GOODS_PLACED/],
  ['durable exception authority', /DURABLE_EXCEPTION/],
  ['notification communication disclaimer', /Notifications are communication evidence and never prove delivery/i],
  ['day-state history disclaimer', /not represented as a complete event ledger/i],
  ['GPS privacy disclaimer', /Driver-location coordinates are intentionally excluded/i],
  ['confirmed delivery authority', /DAY_STATE_AND_TYPED_POD/],
  ['unverified delivery state', /DELIVERED_UNVERIFIED/],
  ['unassigned route evidence', /DURABLE_EVIDENCE_WITHOUT_RUN_ASSIGNMENT/],
  ['observation history label', /OBSERVATION_VERSIONED_CURRENT_STATE/],
  ['route quality view', /create or replace view analytics\.v_delivery_route_observation_quality/],
  ['stop quality view', /create or replace view analytics\.v_delivery_stop_observation_quality/],
  ['controlled refresh', /create or replace function analytics\.refresh_delivery_route_stop_facts/],
  ['advisory refresh lock', /pg_advisory_xact_lock\([\s\S]{0,120}refresh_delivery_route_stop_facts/],
  ['route refresh status never', /'analytics\.delivery_routes'[\s\S]{0,200}'NEVER'/],
  ['stop refresh status never', /'analytics\.delivery_stops'[\s\S]{0,200}'NEVER'/],
  ['service route read only', /grant select on table analytics\.fact_delivery_route_observation to service_role/],
  ['service stop read only', /grant select on table analytics\.fact_delivery_stop_observation to service_role/],
  ['service refresh execution', /grant execute on function analytics\.refresh_delivery_route_stop_facts\(timestamptz\)[\s\S]{0,80}to service_role/],
  ['no automatic refresh comment', /does not refresh or backfill production data/i],
  ['semantic stop hash', /source_version_hash[\s\S]*jsonb_build_array/],
  ['invalid text date protection', /ecoflow_try_date/],
  ['schema reload', /notify pgrst,'reload schema'/],
];

for (const [name, pattern] of required) {
  assert.match(migration, pattern, `Delivery fact audit failed: ${name}`);
}

assert.match(
  contract,
  /delivery refresh did not complete: result=% status=%[\s\S]{0,700}error_code[\s\S]{0,200}error_message/,
  'Delivery fact contract must expose refresh SQLSTATE and error message.',
);

const routeTable = migration.match(
  /create table analytics\.fact_delivery_route_observation\([\s\S]*?\n\);/i,
)?.[0] ?? '';
const stopTable = migration.match(
  /create table analytics\.fact_delivery_stop_observation\([\s\S]*?\n\);/i,
)?.[0] ?? '';

assert.ok(routeTable, 'Delivery fact audit could not isolate route fact DDL.');
assert.ok(stopTable, 'Delivery fact audit could not isolate stop fact DDL.');

for (const [name, pattern, source = migration] of [
  ['legacy departure-only driver field', /\bdeparture_driver_count\b/],
  ['duplicate parsed POD date alias', /ecoflow_try_date\(p\.business_day\)\s+as\s+business_day\s*,\s*p\.\*/i],
  ['duplicate parsed exception date alias', /ecoflow_try_date\(e\.business_day\)\s+as\s+business_day\s*,\s*e\.\*/i],
  ['duplicate parsed notification date alias', /ecoflow_try_date\(n\.business_day\)\s+as\s+business_day\s*,\s*n\.\*/i],
  ['route browser grant', /grant select on table analytics\.fact_delivery_route_observation to (?:anon|authenticated)/],
  ['stop browser grant', /grant select on table analytics\.fact_delivery_stop_observation to (?:anon|authenticated)/],
  ['service route direct writes', /grant all on table analytics\.fact_delivery_route_observation to service_role/],
  ['service stop direct writes', /grant all on table analytics\.fact_delivery_stop_observation to service_role/],
  ['automatic refresh invocation', /select\s+\*\s+from\s+analytics\.refresh_delivery_route_stop_facts/i],
  ['metric activation', /update analytics\.metric_definition[\s\S]{0,200}status\s*=\s*'ACTIVE'/],
  ['operational table trigger', /create trigger[\s\S]{0,300}\bon\s+public\./i],
  ['raw latitude route fact', /\blatitude\b/i, routeTable],
  ['raw longitude route fact', /\blongitude\b/i, routeTable],
  ['raw latitude stop fact', /\blatitude\b/i, stopTable],
  ['raw longitude stop fact', /\blongitude\b/i, stopTable],
  ['POD path route fact', /\b(?:photo_path|pod1_path|pod2_path)\b/i, routeTable],
  ['POD path stop fact', /\b(?:photo_path|pod1_path|pod2_path)\b/i, stopTable],
  ['recipient route fact', /\b(?:recipient|contact_email|contact_phone)\b/i, routeTable],
  ['recipient stop fact', /\b(?:recipient|contact_email|contact_phone)\b/i, stopTable],
  ['notification proves delivered', /when\s+[^\n]*notification[^\n]*then\s+'DELIVERED'/i],
  ['day-state called event ledger', /ecoflow_day_state[^\n]{0,120}(?:complete|authoritative)\s+event\s+ledger/i],
]) {
  assert.doesNotMatch(source, pattern, `Delivery fact audit found ${name}`);
}

assert.equal(required.length, 33);
console.log(`Delivery route/stop fact audit passed (${required.length}/${required.length}).`);
