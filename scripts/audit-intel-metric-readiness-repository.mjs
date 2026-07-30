import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`INTEL_FE_005C_FILE_MISSING: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

const repository = read('src/data/repositories/metricReadinessRepository.ts');
const contract = read('src/features/intelligence/analytics/metricReadinessContract.ts');
const analyticsBarrel = read('src/features/intelligence/analytics/index.ts');
const test = read('scripts/intel-metric-readiness-repository-contract.test.mjs');
const app = read('src/app/App.tsx');
const dashboard = read('src/features/dashboard/DashboardPage.tsx');
const healthConsole = read('src/features/intelligence/analytics/healthConsole/AnalyticsHealthConsole.tsx');
const packageJson = JSON.parse(read('package.json'));
const source = `${repository}\n${contract}`;

for (const required of [
  'MetricReadinessRepository',
  'readMetricReadiness',
  ".schema('analytics')",
  ".rpc('get_metric_projection_readiness')",
  'normaliseMetricReadinessRows',
  'metricReadinessReadState',
  'analyticsReadFailure',
  'analyticsReadSuccess',
  "export type AnalyticsMetricProjectionStatus = 'SHADOW' | 'BLOCKED' | 'READY' | 'UNKNOWN';",
  'const PROJECTION_STATUS_SET',
  "return 'UNKNOWN'",
  "status === 'SHADOW' || status === 'BLOCKED'",
]) {
  if (!source.includes(required)) {
    throw new Error(`INTEL_FE_005C_CONTRACT_MISSING: ${required}`);
  }
}

for (const forbidden of [
  'readShadowProjection',
  'readReconciliation',
  'get_initial_kpi_shadow_projection',
  'get_initial_kpi_reconciliation',
  'metric_value',
  'fact_order_line',
  'fact_fulfilment_line',
  '_internal',
  ".from('",
  '.from("',
  '.insert(',
  '.update(',
  '.upsert(',
  '.delete(',
  'fetch(',
  'window.',
  'document.',
  'localStorage',
  'sessionStorage',
  'MutationObserver',
  'CustomEvent(',
  'dispatchEvent(',
]) {
  if (source.includes(forbidden)) {
    throw new Error(`INTEL_FE_005C_DATA_OR_WRITE_SCOPE: ${forbidden}`);
  }
}

for (const forbidden of [
  'value ?? 0',
  'value || 0',
  'reconciliationTolerance ?? 0',
  'reconciliationTolerance || 0',
  'blockerCodes ||',
]) {
  if (source.includes(forbidden)) {
    throw new Error(`INTEL_FE_005C_SILENT_DEFAULT: ${forbidden}`);
  }
}

for (const required of [
  "if (value === null || value === undefined || value === '') return null",
  'if (Number.isFinite(parsed)) return parsed',
  "code: 'INVALID_NUMBER'",
  "code: 'INVALID_ROW'",
  "return issues.length === 0 ? 'ready' : 'partial'",
]) {
  if (!contract.includes(required)) {
    throw new Error(`INTEL_FE_005C_NORMALISER_BOUNDARY_MISSING: ${required}`);
  }
}

for (const required of [
  "export * from './metricReadinessContract';",
  'export type AnalyticsMetricReadinessRow',
  'export type AnalyticsMetricProjectionStatus',
  'normaliseMetricReadinessRows',
]) {
  if (!`${analyticsBarrel}\n${contract}`.includes(required)) {
    throw new Error(`INTEL_FE_005C_EXPORT_MISSING: ${required}`);
  }
}

for (const testName of [
  'metric readiness rows preserve zero tolerance and governed metadata arrays',
  'unknown projection status fails closed as UNKNOWN and partial',
  'shadow and blocked readiness without blockers remain visible but partial',
  'invalid readiness rows are omitted rather than populated with invented fields',
  'metric readiness owner-role errors classify as forbidden, never empty',
]) {
  if (!test.includes(testName)) {
    throw new Error(`INTEL_FE_005C_TEST_MISSING: ${testName}`);
  }
}

for (const pageSource of [app, dashboard, healthConsole]) {
  if (pageSource.includes('metricReadinessRepository') || pageSource.includes('readMetricReadiness')) {
    throw new Error('INTEL_FE_005C_PREMATURE_PAGE_ADOPTION');
  }
}

const auditCommand = packageJson.scripts?.['audit:intel-frontend'];
if (typeof auditCommand !== 'string'
  || !auditCommand.includes('audit-intel-metric-readiness-repository.mjs')
  || !auditCommand.includes('intel-metric-readiness-repository-contract.test.mjs')) {
  throw new Error('INTEL_FE_005C_PACKAGE_AUDIT_WIRING_MISSING');
}

console.log('INTEL-FE-005C metric readiness repository audit passed.');
