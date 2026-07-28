import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrationFile =
  'supabase/migrations/20260729200000_delivery_route_stop_execution_facts.sql';
const driverScdFile =
  'supabase/migrations/20260729200100_delivery_driver_dimension_scd_guard.sql';
const contractFile = 'scripts/delivery-route-stop-facts-contract-test.sql';
const driverScdContractFile =
  'scripts/delivery-driver-dimension-scd-contract-test.sql';

const migration = fs.readFileSync(migrationFile, 'utf8');
const driverScd = fs.readFileSync(driverScdFile, 'utf8');
const contract = fs.readFileSync(contractFile, 'utf8');
const driverScdContract = fs.readFileSync(driverScdContractFile, 'utf8');

const required = [
  ['transaction boundary', /\bbegin;\s*[\s\S]*\bcommit;\s*$/i, migration],
  ['preflight', /DELIVERY_EXECUTION_FACT_PREREQUISITES_MISSING/, migration],
  ['route observation fact', /create table analytics\.fact_delivery_route_observation/, migration],
  ['stop observation fact', /create table analytics\.fact_delivery_stop_observation/, migration],
  ['route current uniqueness', /create unique index delivery_route_one_current/, migration],
  ['stop current uniqueness', /create unique index delivery_stop_one_current/, migration],
  ['route dimension', /references analytics\.dim_route/, migration],
  ['driver dimension', /references analytics\.dim_driver/, migration],
  ['observed driver count', /\bobserved_driver_count\b/, migration],
  ['combined driver evidence', /select da\.driver_user_id[\s\S]{0,500}union all[\s\S]{0,300}select dl\.driver_user_id/, migration],
  ['parsed durable dates', /\bparsed_business_day\b/, migration],
  ['qualified assignment join', /on a\.business_day=c\.business_day\s+and a\.source_order_id=c\.source_order_id/, migration],
  ['two typed POD rules', /POD1_DROP_POINT[\s\S]*POD2_GOODS_PLACED/, migration],
  ['durable exception authority', /DURABLE_EXCEPTION/, migration],
  ['notification communication disclaimer', /Notifications are communication evidence and never prove delivery/i, migration],
  ['day-state history disclaimer', /not represented as a complete event ledger/i, migration],
  ['GPS privacy disclaimer', /Driver-location coordinates are intentionally excluded/i, migration],
  ['confirmed delivery authority', /DAY_STATE_AND_TYPED_POD/, migration],
  ['unverified delivery state', /DELIVERED_UNVERIFIED/, migration],
  ['unassigned route evidence', /DURABLE_EVIDENCE_WITHOUT_RUN_ASSIGNMENT/, migration],
  ['observation history label', /OBSERVATION_VERSIONED_CURRENT_STATE/, migration],
  ['route quality view', /create or replace view analytics\.v_delivery_route_observation_quality/, migration],
  ['stop quality view', /create or replace view analytics\.v_delivery_stop_observation_quality/, migration],
  ['controlled refresh', /create or replace function analytics\.refresh_delivery_route_stop_facts/, migration],
  ['advisory refresh lock', /pg_advisory_xact_lock\([\s\S]{0,120}refresh_delivery_route_stop_facts/, migration],
  ['route refresh status never', /'analytics\.delivery_routes'[\s\S]{0,200}'NEVER'/, migration],
  ['stop refresh status never', /'analytics\.delivery_stops'[\s\S]{0,200}'NEVER'/, migration],
  ['service route read only', /grant select on table analytics\.fact_delivery_route_observation to service_role/, migration],
  ['service stop read only', /grant select on table analytics\.fact_delivery_stop_observation to service_role/, migration],
  ['service refresh execution', /grant execute on function analytics\.refresh_delivery_route_stop_facts\(timestamptz\)[\s\S]{0,80}to service_role/, migration],
  ['no automatic refresh comment', /does not refresh or backfill production data/i, migration],
  ['semantic stop hash', /source_version_hash[\s\S]*jsonb_build_array/, migration],
  ['invalid text date protection', /ecoflow_try_date/, migration],
  ['schema reload', /notify pgrst,'reload schema'/, migration],
  ['Driver SCD transaction', /\bbegin;\s*[\s\S]*\bcommit;\s*$/i, driverScd],
  ['Driver SCD preflight', /DELIVERY_DRIVER_SCD_PREREQUISITES_MISSING/, driverScd],
  ['Driver SCD function', /create or replace function analytics\.ecoflow_version_driver_dimension_name_change/, driverScd],
  ['Driver SCD recursion guard', /pg_trigger_depth\(\)>1/, driverScd],
  ['Driver same-instant correction', /v_change_at<=old\.effective_from/, driverScd],
  ['Driver historical close', /effective_to=v_change_at,[\s\S]{0,100}is_current=false/, driverScd],
  ['Driver new current version', /insert into analytics\.dim_driver[\s\S]{0,500}v_change_at,null,true/, driverScd],
  ['Driver SCD trigger', /create trigger version_driver_dimension_name_change/, driverScd],
  ['Driver SCD runtime revoke', /revoke all on function analytics\.ecoflow_version_driver_dimension_name_change\(\)[\s\S]{0,80}service_role/, driverScd],
  ['Driver SCD no automatic refresh', /No operational table,[\s\S]{0,100}fact refresh is invoked/i, driverScd],
  ['Driver SCD version contract', /Driver display-name change did not create an SCD version/, driverScdContract],
  ['Driver historical Route binding contract', /historical Route meaning was rebound to the new Driver dimension/, driverScdContract],
  ['Driver same-instant contract', /same-effective-instant correction created false Driver history/, driverScdContract],
];

for (const [name, pattern, source] of required) {
  assert.match(source, pattern, `Delivery fact audit failed: ${name}`);
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
  ['ambiguous prepared assignment using', /left join pg_temp\.delivery_stop_state[\s\S]{0,300}left join pg_temp\.delivery_order_route_assignment a\s+using\(business_day,source_order_id\)/i],
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
  ['Driver SCD operational trigger', /create trigger[\s\S]{0,200}\bon\s+public\./i, driverScd],
  ['Driver SCD runtime execute grant', /grant execute on function analytics\.ecoflow_version_driver_dimension_name_change\(\)[\s\S]{0,80}(?:authenticated|service_role)/i, driverScd],
]) {
  assert.doesNotMatch(source, pattern, `Delivery fact audit found ${name}`);
}

console.log(`Delivery route/stop fact audit passed (${required.length}/${required.length}).`);
