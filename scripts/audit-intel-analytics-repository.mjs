import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`INTEL_FE_005A_FILE_MISSING: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

const contract = read('src/features/intelligence/analytics/analyticsRepositoryContract.ts');
const repository = read('src/data/repositories/analyticsRepository.ts');
const barrel = read('src/features/intelligence/analytics/index.ts');
const test = read('scripts/intel-analytics-repository-contract.test.mjs');
const packageJson = JSON.parse(read('package.json'));

for (const required of [
  "analyticsShadowMetricKeys = ['fill_rate', 'substitution_rate']",
  "'v_ecoflow_analytics_metric_catalog'",
  "'v_ecoflow_analytics_refresh_status'",
  "'v_ecoflow_analytics_data_quality'",
  "'v_ecoflow_analytics_health'",
  "'get_initial_kpi_shadow_projection'",
  "'get_initial_kpi_reconciliation'",
  "type AnalyticsReadState = 'ready' | 'partial' | 'empty'",
  "type AnalyticsFailureState = 'forbidden' | 'invalid' | 'unavailable' | 'failed'",
  'normaliseAnalyticsDateRange',
  'normaliseAnalyticsShadowRequest',
  'normaliseAnalyticsShadowProjectionRows',
  'normaliseAnalyticsReconciliationRows',
  'classifyAnalyticsRepositoryError',
]) {
  if (!contract.includes(required)) throw new Error(`INTEL_FE_005A_CONTRACT_MISSING: ${required}`);
}

for (const required of [
  'createAnalyticsRepository',
  'readMetricCatalog',
  'readRefreshStatus',
  'readDataQuality',
  'readHealth',
  'readShadowProjection',
  'readReconciliation',
  ".from('v_ecoflow_analytics_metric_catalog')",
  ".from('v_ecoflow_analytics_refresh_status')",
  ".from('v_ecoflow_analytics_data_quality')",
  ".from('v_ecoflow_analytics_health')",
  ".schema('analytics')",
  ".rpc('get_initial_kpi_shadow_projection'",
  ".rpc('get_initial_kpi_reconciliation'",
  'p_metric_key: request.request.metricKey',
  'p_date_from: request.request.dateFrom',
  'p_date_to: request.request.dateTo',
]) {
  if (!repository.includes(required)) throw new Error(`INTEL_FE_005A_REPOSITORY_MISSING: ${required}`);
}

for (const forbidden of [
  'metric_projection_readiness',
  'metric_order_status_policy',
  'v_initial_kpi_line_projection_internal',
  'v_initial_kpi_reconciliation_internal',
  'fact_order_line',
  'fact_fulfilment_line',
  'fact_delivery_stop',
  'fact_daily_inventory_snapshot',
  'fact_inventory_movement',
]) {
  if (repository.includes(forbidden)) throw new Error(`INTEL_FE_005A_INTERNAL_ANALYTICS_BYPASS: ${forbidden}`);
}

for (const forbidden of [
  '.insert(',
  '.update(',
  '.upsert(',
  '.delete(',
  '.remove(',
  'fetch(',
  'window.',
  'document.',
  'localStorage',
  'sessionStorage',
  'MutationObserver',
  'CustomEvent(',
  'dispatchEvent(',
]) {
  if (`${contract}\n${repository}`.includes(forbidden)) {
    throw new Error(`INTEL_FE_005A_WRITE_DOM_OR_STORAGE_PATTERN: ${forbidden}`);
  }
}

for (const forbidden of ['metric_value_percent ?? 0', 'metric_value_percent || 0', 'numerator_quantity ?? 0', 'denominator_quantity ?? 0']) {
  if (`${contract}\n${repository}`.includes(forbidden)) {
    throw new Error(`INTEL_FE_005A_SILENT_ZERO_PATTERN: ${forbidden}`);
  }
}

if (!contract.includes("row.metricValuePercent !== null")) {
  throw new Error('INTEL_FE_005A_READY_STATE_DOES_NOT_REQUIRE_REAL_METRIC_VALUE');
}
if (!contract.includes("return 'UNKNOWN';")) {
  throw new Error('INTEL_FE_005A_UNKNOWN_SOURCE_STATE_NOT_FAIL_CLOSED');
}
if (!repository.includes('normaliseAnalyticsShadowRequest(input)')) {
  throw new Error('INTEL_FE_005A_RPC_REQUEST_NOT_PREFLIGHTED');
}

for (const required of [
  'type AnalyticsShadowMetricKey',
  'type AnalyticsReadResult',
  'normaliseAnalyticsShadowRequest',
  'projectionReadState',
]) {
  if (!barrel.includes(required)) throw new Error(`INTEL_FE_005A_EXPORT_MISSING: ${required}`);
}

for (const testName of [
  'analytics date ranges are Adelaide-date safe and bounded to the database contract',
  'only governed Shadow metrics can create repository requests',
  'Shadow projection normalisation preserves real zero and never converts null to zero',
  'invalid numeric source values become explicit partial issues',
  'analytics health retains unknown source state instead of claiming current',
  'reconciliation mismatch remains partial and not comparable remains explicit',
  'repository errors separate role denial, invalid requests and unavailable schemas',
]) {
  if (!test.includes(testName)) throw new Error(`INTEL_FE_005A_TEST_MISSING: ${testName}`);
}

const auditCommand = packageJson.scripts?.['audit:intel-frontend'];
if (typeof auditCommand !== 'string'
  || !auditCommand.includes('audit-intel-analytics-repository.mjs')
  || !auditCommand.includes('intel-analytics-repository-contract.test.mjs')) {
  throw new Error('INTEL_FE_005A_PACKAGE_AUDIT_WIRING_MISSING');
}

console.log('INTEL-FE-005A analytics repository audit passed.');
