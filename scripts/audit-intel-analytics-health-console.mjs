import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`INTEL_FE_006A_FILE_MISSING: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

const component = read('src/features/intelligence/analytics/healthConsole/AnalyticsHealthConsole.tsx');
const contract = read('src/features/intelligence/analytics/healthConsole/analyticsHealthConsoleContract.ts');
const css = read('src/features/intelligence/analytics/healthConsole/analyticsHealthConsole.css');
const barrel = read('src/features/intelligence/analytics/healthConsole/index.ts');
const featureBarrel = read('src/features/intelligence/analytics/index.ts');
const app = read('src/app/App.tsx');
const types = read('src/domain/types.ts');
const route = read('src/features/intelligence/navigation/routeContract.ts');
const navigationTest = read('scripts/intel-frontend-navigation-contract.test.mjs');
const contractTest = read('scripts/intel-analytics-health-console-contract.test.mjs');
const designTokens = read('src/features/intelligence/designSystem/tokens.css');
const packageJson = JSON.parse(read('package.json'));

for (const required of [
  'AnalyticsHealthConsole',
  'repository.readHealth()',
  'repository.readRefreshStatus()',
  'repository.readDataQuality()',
  'repository.readMetricCatalog()',
  '<AnalyticsMetricFrame',
  '<AnalyticsDataTable',
  'ResourceLoading',
  'ResourceFailure',
  'ResourceEmpty',
  'reads.health && !reads.health.ok',
  'displayAnalyticsCount',
  'countTone',
  'Australia/Adelaide',
]) {
  if (!`${component}\n${contract}`.includes(required)) {
    throw new Error(`INTEL_FE_006A_CONSOLE_CONTRACT_MISSING: ${required}`);
  }
}

for (const forbidden of [
  'readShadowProjection',
  'readReconciliation',
  '.rpc(',
  '.schema(',
  'supabase',
  '.insert(',
  '.update(',
  '.upsert(',
  '.delete(',
  'fact_order_line',
  'fact_fulfilment_line',
  '_internal',
  'window.',
  'document.',
  'localStorage',
  'sessionStorage',
  'MutationObserver',
  'CustomEvent(',
  'dispatchEvent(',
  'fetch(',
]) {
  if (`${component}\n${contract}`.includes(forbidden)) {
    throw new Error(`INTEL_FE_006A_WRITE_OR_PRIVATE_DATA_BOUNDARY: ${forbidden}`);
  }
}

for (const forbidden of [
  'value ?? 0',
  'value || 0',
  'openQualityCount ?? 0',
  'neverRefreshedCount ?? 0',
  'failedDatasetCount ?? 0',
  'degradedDatasetCount ?? 0',
]) {
  if (`${component}\n${contract}`.includes(forbidden)) {
    throw new Error(`INTEL_FE_006A_SILENT_ZERO_PATTERN: ${forbidden}`);
  }
}

for (const required of [
  "value === null ? '—'",
  "if (value === null) return 'neutral'",
  "return value === 0 ? 'success' : 'warning'",
  "failedDatasetCount: health?.failedDatasetCount ?? null",
  "neverRefreshedCount: health?.neverRefreshedCount ?? null",
]) {
  if (!`${component}\n${contract}`.includes(required)) {
    throw new Error(`INTEL_FE_006A_NULL_ZERO_BOUNDARY_MISSING: ${required}`);
  }
}

for (const phrase of [
  'How to',
  'Learn more',
  'Getting started',
  'Click here',
  'You should',
  'Next step',
  'Tip:',
]) {
  if (`${component}\n${css}`.includes(phrase)) {
    throw new Error(`INTEL_FE_006A_GUIDANCE_COPY_FORBIDDEN: ${phrase}`);
  }
}

for (const required of [
  '.ef-analytics-console__command',
  '.ef-analytics-console__metrics',
  '.ef-analytics-console__status-strip',
  '.ef-analytics-console__signal',
  '.ef-analytics-console__resource-state',
  '@media (max-width: 760px)',
  '@media (prefers-contrast: more)',
  '@media (prefers-reduced-motion: reduce)',
]) {
  if (!css.includes(required)) throw new Error(`INTEL_FE_006A_VISUAL_CONTRACT_MISSING: ${required}`);
}

for (const forbidden of [
  '!important',
  'url(',
  '@font-face',
  '.dashboard-',
  '.orders-',
  '.inventory-',
  '.delivery-',
]) {
  if (css.includes(forbidden)) throw new Error(`INTEL_FE_006A_VISUAL_SCOPE_EXPANSION: ${forbidden}`);
}

const publishedTokens = new Set(
  Array.from(designTokens.matchAll(/(--ef-[a-z0-9-]+)\s*:/gi), (match) => match[1]),
);
const locallyDeclaredTokens = new Set(
  Array.from(css.matchAll(/(--ef-[a-z0-9-]+)\s*:/gi), (match) => match[1]),
);
for (const reference of Array.from(css.matchAll(/var\((--ef-[a-z0-9-]+)/gi), (match) => match[1])) {
  if (!publishedTokens.has(reference) && !locallyDeclaredTokens.has(reference)) {
    throw new Error(`INTEL_FE_006A_UNPUBLISHED_DESIGN_TOKEN: ${reference}`);
  }
}

for (const required of [
  "export * from './healthConsole';",
  'AnalyticsHealthConsole',
  'analyticsHealthReadout',
  'sortAnalyticsRefreshRows',
]) {
  if (!`${barrel}\n${featureBarrel}`.includes(required)) {
    throw new Error(`INTEL_FE_006A_EXPORT_MISSING: ${required}`);
  }
}

for (const required of [
  "{ id: 'analytics', label: 'Analytics' }",
  "tab === 'analytics' ? <AnalyticsHealthConsole />",
  "tab === 'reconciliation' ? <ReconciliationPanel",
  "'reconciliation' | 'analytics'",
]) {
  if (!`${app}\n${types}`.includes(required)) {
    throw new Error(`INTEL_FE_006A_DESKTOP_ADOPTION_MISSING: ${required}`);
  }
}

for (const required of [
  "{ path: '/reconciliation', workspace: 'reconciliation', legacyDesktopTab: 'reconciliation' }",
  "{ path: '/analytics', workspace: 'analytics', legacyDesktopTab: 'analytics' }",
  "reconciliation: '/reconciliation'",
  "analytics: '/analytics'",
  "pathForLegacyDesktopTab('reconciliation'), '/reconciliation'",
  "pathForLegacyDesktopTab('analytics'), '/analytics'",
]) {
  if (!`${route}\n${navigationTest}`.includes(required)) {
    throw new Error(`INTEL_FE_006A_ROUTE_SEPARATION_MISSING: ${required}`);
  }
}

for (const required of [
  'analytics health readout preserves confirmed zero and missing null',
  'dataset refresh rows sort failed and degraded states before current rows',
  'quality findings sort by severity then most recent detection',
  'metric catalog sorts active before draft without inventing readiness',
  'analytics timestamps use Adelaide presentation and invalid values remain missing',
]) {
  if (!contractTest.includes(required)) {
    throw new Error(`INTEL_FE_006A_TEST_MISSING: ${required}`);
  }
}

const dependencyNames = Object.keys(packageJson.dependencies ?? {});
for (const dependency of dependencyNames) {
  if (/chart|recharts|echarts|plotly|visx|d3/i.test(dependency)) {
    throw new Error(`INTEL_FE_006A_ANALYTICS_DEPENDENCY_ADDED: ${dependency}`);
  }
}

const auditCommand = packageJson.scripts?.['audit:intel-frontend'];
if (typeof auditCommand !== 'string'
  || !auditCommand.includes('audit-intel-analytics-health-console.mjs')
  || !auditCommand.includes('intel-analytics-health-console-contract.test.mjs')) {
  throw new Error('INTEL_FE_006A_PACKAGE_AUDIT_WIRING_MISSING');
}

console.log('INTEL-FE-006A analytics health console audit passed.');
