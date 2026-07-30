import fs from 'node:fs';

function read(path) {
  if (!fs.existsSync(path)) throw new Error(`INTEL_FE_006B_FILE_MISSING: ${path}`);
  return fs.readFileSync(path, 'utf8');
}

const workspace = read('src/features/intelligence/analytics/OperationalPulseReadinessWorkspace.tsx');
const contract = read('src/features/intelligence/analytics/operationalPulseReadinessContract.ts');
const css = read('src/features/intelligence/analytics/operationalPulseReadinessWorkspace.css');
const barrel = read('src/features/intelligence/analytics/index.ts');
const test = read('scripts/intel-operational-pulse-readiness-contract.test.mjs');
const packageJson = JSON.parse(read('package.json'));

for (const marker of [
  'metricReadinessRepository',
  'readMetricReadiness()',
  'OperationalPulseDeck',
  'readinessRowsToOperationalPulse',
  'OperationalPulse readiness',
  'GOVERNED OPERATING SIGNALS',
  'Refresh readiness',
]) {
  if (!workspace.includes(marker)) throw new Error(`INTEL_FE_006B_WORKSPACE_MARKER_MISSING: ${marker}`);
}

for (const marker of [
  "if (row.projectionStatus === 'READY') return 'READY'",
  "if (row.projectionStatus === 'SHADOW') return 'SHADOW'",
  "if (row.projectionStatus === 'BLOCKED') return 'BLOCKED'",
  "return 'UNAVAILABLE'",
  'value: null',
  'displayValue: null',
  'buildOperationalPulseDeck',
]) {
  if (!contract.includes(marker)) throw new Error(`INTEL_FE_006B_CONTRACT_MARKER_MISSING: ${marker}`);
}

for (const forbidden of [
  'readShadowProjection',
  'readReconciliation',
  'get_initial_kpi_shadow_projection',
  'get_initial_kpi_reconciliation',
  'supabase',
  ".from('",
  '.rpc(',
  '.insert(',
  '.update(',
  '.upsert(',
  '.delete(',
  'reduce(',
  'Number(null)',
  'value ?? 0',
  'value || 0',
  'localStorage',
  'sessionStorage',
  'MutationObserver',
  'CustomEvent(',
]) {
  if (`${workspace}\n${contract}`.includes(forbidden)) {
    throw new Error(`INTEL_FE_006B_FORBIDDEN_COUPLING: ${forbidden}`);
  }
}

for (const marker of [
  '.ef-pulse-readiness',
  '.ef-pulse-readiness__header',
  '.ef-pulse-readiness__summary',
  '@media (max-width: 640px)',
  '@media (prefers-reduced-motion: reduce)',
]) {
  if (!css.includes(marker)) throw new Error(`INTEL_FE_006B_STYLE_MARKER_MISSING: ${marker}`);
}

for (const forbidden of ['!important', '@font-face', 'url(', '.dashboard-', '.orders-', '.inventory-', '.delivery-']) {
  if (css.includes(forbidden)) throw new Error(`INTEL_FE_006B_STYLE_SCOPE_EXPANSION: ${forbidden}`);
}

if (!barrel.includes('OperationalPulseReadinessWorkspace as AnalyticsHealthConsole')) {
  throw new Error('INTEL_FE_006B_APP_ADAPTER_EXPORT_MISSING');
}

for (const name of [
  'readiness mapping preserves two shadow and eight blocked metrics without values',
  'readiness mapping keeps canonical metric order regardless of RPC row order',
  'unknown readiness state fails closed as unavailable',
  'ready readiness metadata cannot manufacture a KPI value',
]) {
  if (!test.includes(name)) throw new Error(`INTEL_FE_006B_TEST_MISSING: ${name}`);
}

const command = packageJson.scripts?.['audit:intel-frontend'];
if (typeof command !== 'string'
  || !command.includes('audit-intel-operational-pulse-readiness.mjs')
  || !command.includes('intel-operational-pulse-readiness-contract.test.mjs')) {
  throw new Error('INTEL_FE_006B_AUDIT_WIRING_MISSING');
}

console.log('INTEL-FE-006B operational pulse readiness audit passed.');
