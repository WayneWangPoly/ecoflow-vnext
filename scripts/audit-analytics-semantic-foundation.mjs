import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrationFile = 'supabase/migrations/20260728221500_analytics_semantic_foundation.sql';
const contractFile = 'scripts/analytics-semantic-foundation-contract-test.sql';
const workflowFile = '.github/workflows/warehouse-productisation-check.yml';

const migration = fs.readFileSync(migrationFile, 'utf8');
const contract = fs.readFileSync(contractFile, 'utf8');
const workflow = fs.readFileSync(workflowFile, 'utf8');

const migrationChecks = [
  ['transaction boundary', /\bbegin;\s*[\s\S]*\bcommit;\s*$/i],
  ['prerequisite guard', /ANALYTICS_FOUNDATION_PREREQUISITES_MISSING/],
  ['analytics schema', /create schema if not exists analytics;/],
  ['schema browser create denied', /revoke all on schema analytics from public, anon, authenticated;/],
  ['schema authenticated usage only', /grant usage on schema analytics to authenticated, service_role;/],
  ['default table ACL hardened', /alter default privileges in schema analytics revoke all on tables from public, anon, authenticated;/],
  ['default function ACL hardened', /alter default privileges in schema analytics revoke execute on functions from public, anon, authenticated;/],
  ['metric registry', /create table analytics\.metric_definition/],
  ['one active metric version', /create unique index metric_definition_one_active_version[\s\S]{0,120}where status = 'ACTIVE';/],
  ['active metric requires source', /metric_definition_active_sources[\s\S]{0,100}status <> 'ACTIVE' or cardinality\(source_objects\) > 0/],
  ['freshness registry', /create table analytics\.refresh_status/],
  ['freshness states', /'NEVER','REFRESHING','CURRENT','STALE','DEGRADED','FAILED'/],
  ['current freshness requires as-of', /refresh_status_current_has_as_of/],
  ['quality registry', /create table analytics\.data_quality_status/],
  ['quality action fields', /business_impact text,[\s\S]{0,80}recommended_action text,[\s\S]{0,80}owner_team text/],
  ['date dimension', /create table analytics\.dim_date/],
  ['date range seed', /date '2020-01-01',[\s\S]{0,80}date '2040-12-31'/],
  ['customer dimension', /create table analytics\.dim_customer/],
  ['store dimension', /create table analytics\.dim_store/],
  ['supplier dimension', /create table analytics\.dim_supplier/],
  ['brand dimension', /create table analytics\.dim_brand/],
  ['commercial SKU dimension', /create table analytics\.dim_commercial_sku/],
  ['physical SKU dimension', /create table analytics\.dim_physical_sku/],
  ['commercial physical bridge', /create table analytics\.bridge_commercial_physical_sku/],
  ['approved substitute relation', /'PRIMARY','APPROVED_SUBSTITUTE','TEMPORARY_SUBSTITUTE','BLOCKED'/],
  ['warehouse location dimension', /create table analytics\.dim_warehouse_location/],
  ['driver dimension', /create table analytics\.dim_driver/],
  ['route dimension', /create table analytics\.dim_route/],
  ['order source dimension', /create table analytics\.dim_order_source/],
  ['exception type dimension', /create table analytics\.dim_exception_type/],
  ['historical effective state', /is_current and effective_to is null[\s\S]{0,100}not is_current and effective_to is not null/],
  ['all dimensions use RLS', /foreach v_table in array array\[[\s\S]{0,800}'dim_exception_type'[\s\S]{0,200}enable row level security/],
  ['only metadata read grants', /grant select on analytics\.metric_definition to authenticated;[\s\S]{0,160}grant select on analytics\.data_quality_status to authenticated;/],
  ['service role owns analytics writes', /grant all on all tables in schema analytics to service_role;/],
  ['metric role policy', /create policy analytics_metric_definition_read/],
  ['refresh role policy', /create policy analytics_refresh_status_read/],
  ['quality role policy', /create policy analytics_data_quality_status_read/],
  ['draft metric seeds', /'fill_rate',1,'Fill Rate'[\s\S]{0,800}'DRAFT'/],
  ['no active metric claim in migration', /on conflict \(metric_key,metric_version\) do nothing;/],
  ['refresh visibility roles', /visible_to_roles[\s\S]{0,600}'WAREHOUSE','DRIVER'/],
  ['metric catalog security invoker', /v_ecoflow_analytics_metric_catalog[\s\S]{0,120}security_invoker = true/],
  ['refresh view security invoker', /v_ecoflow_analytics_refresh_status[\s\S]{0,120}security_invoker = true/],
  ['quality view security invoker', /v_ecoflow_analytics_data_quality[\s\S]{0,120}security_invoker = true/],
  ['health view security invoker', /v_ecoflow_analytics_health[\s\S]{0,120}security_invoker = true/],
  ['health fail closed', /failed_dataset_count > 0[\s\S]{0,120}critical_quality_count > 0 then 'FAILED'/],
  ['inactive health suppressed', /where role_context\.app_role in \([\s\S]{0,100}'DRIVER'/],
  ['anon view revokes', /revoke all on table public\.v_ecoflow_analytics_metric_catalog from public, anon;/],
  ['browser view grants', /grant select on table public\.v_ecoflow_analytics_health to authenticated;/],
  ['semantic comments', /Customer-facing commercial demand identity, distinct from physical stock/],
  ['schema reload', /notify pgrst, 'reload schema';/],
];

for (const [name, pattern] of migrationChecks) {
  assert.match(migration, pattern, `Analytics migration audit failed: ${name}`);
}

const forbiddenMigrationPatterns = [
  ['no operational update', /\bupdate\s+public\.(?!v_ecoflow_analytics)/i],
  ['no operational delete', /\bdelete\s+from\s+public\./i],
  ['no operational truncate', /\btruncate\s+(table\s+)?public\./i],
  ['no authenticated analytics write grant', /grant\s+(insert|update|delete|truncate|references|trigger)[\s\S]{0,120}\bto authenticated\b/i],
  ['no anon analytics read grant', /grant\s+select[\s\S]{0,120}\bto anon\b/i],
  ['no new day-state scope', /insert[\s\S]{0,100}ecoflow_day_state/i],
];

for (const [name, pattern] of forbiddenMigrationPatterns) {
  assert.doesNotMatch(migration, pattern, `Analytics migration audit failed: ${name}`);
}

const contractChecks = [
  ['real role fixtures', /'DRIVER',true,'ACTIVE'[\s\S]{0,500}'VIEWER',false,'SUSPENDED'/],
  ['RLS count', /v_rls_count <> 16/],
  ['policy count', /v_policy_count <> 3/],
  ['service role ACL assertions', /service_role analytics ACL incomplete/],
  ['dimension browser denial', /dimension is directly browser-readable/],
  ['security invoker assertion', /an analytics public view is not security_invoker/],
  ['date row count', /count\(\*\) from analytics\.dim_date\) <> 7671/],
  ['Adelaide financial period check', /date '2026-07-28'[\s\S]{0,120}financial_year_ending=2027/],
  ['draft metric check', /foundation migration incorrectly claims an active metric/],
  ['commercial physical separation', /commercial and physical SKU separation contract failed/],
  ['browser insert denial', /browser_metric/],
  ['browser refresh update denial', /update analytics\.refresh_status set status='CURRENT'/],
  ['browser quality delete denial', /delete from analytics\.data_quality_status/],
  ['owner role evidence', /owner_metric_ok[\s\S]{0,1000}owner_health_ok/],
  ['viewer role evidence', /viewer_metric_ok[\s\S]{0,800}viewer_quality_ok/],
  ['account role evidence', /account_metric_ok[\s\S]{0,800}account_quality_ok/],
  ['warehouse role evidence', /warehouse_metric_ok[\s\S]{0,800}warehouse_quality_ok/],
  ['driver role evidence', /driver_metric_ok[\s\S]{0,800}driver_quality_ok/],
  ['inactive role evidence', /inactive_metric_ok[\s\S]{0,1200}inactive_health_ok/],
  ['transaction rollback', /\brollback;\s*$/i],
];

for (const [name, pattern] of contractChecks) {
  assert.match(contract, pattern, `Analytics SQL contract audit failed: ${name}`);
}

const workflowChecks = [
  ['migration in release sequence', /20260728221500_analytics_semantic_foundation\.sql/],
  ['contract execution', /analytics-semantic-foundation-contract-test\.sql/],
  ['static audit execution', /npm run audit:analytics/],
];

for (const [name, pattern] of workflowChecks) {
  assert.match(workflow, pattern, `Analytics workflow audit failed: ${name}`);
}

const total = migrationChecks.length
  + forbiddenMigrationPatterns.length
  + contractChecks.length
  + workflowChecks.length;

console.log(`Analytics semantic foundation static audit passed (${total}/${total}).`);
