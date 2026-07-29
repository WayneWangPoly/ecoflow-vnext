import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`INTEL_FE_005B_FILE_MISSING: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

const component = read('src/features/intelligence/analytics/primitives/AnalyticsPrimitives.tsx');
const contract = read('src/features/intelligence/analytics/primitives/analyticsPrimitiveContract.ts');
const css = read('src/features/intelligence/analytics/primitives/analyticsPrimitives.css');
const barrel = read('src/features/intelligence/analytics/primitives/index.ts');
const featureBarrel = read('src/features/intelligence/analytics/index.ts');
const test = read('scripts/intel-analytics-primitives-contract.test.mjs');
const packageJson = JSON.parse(read('package.json'));

for (const required of [
  'AnalyticsMetricFrame',
  'AnalyticsLineChart',
  'AnalyticsBarChart',
  'AnalyticsDataTable',
  'buildAnalyticsLineGeometry',
  'buildAnalyticsBarGeometry',
  'aria-label={ariaLabel}',
  'role="img"',
  '<title>{point.label}',
  '<table className="ef-analytics-table"',
  '<th key={column.key} scope="col"',
  '<caption>{caption}</caption>',
]) {
  if (!component.includes(required)) throw new Error(`INTEL_FE_005B_COMPONENT_CONTRACT_MISSING: ${required}`);
}

for (const required of [
  'normaliseAnalyticsSeries',
  'buildAnalyticsLineGeometry',
  'buildAnalyticsBarGeometry',
  'buildAnalyticsNumericTicks',
  'selectAnalyticsLabelTicks',
  'analyticsPath',
  "point.y === null",
  "direction: 'missing'",
  "datum.value === 0",
]) {
  if (!contract.includes(required)) throw new Error(`INTEL_FE_005B_GEOMETRY_CONTRACT_MISSING: ${required}`);
}

for (const forbidden of [
  'recharts',
  'chart.js',
  'echarts',
  'd3-',
  'plotly',
  'visx',
  'canvas',
  'supabase',
  '@/data/repositories/',
  '.from(',
  '.rpc(',
  'fetch(',
  'window.',
  'document.',
  'localStorage',
  'sessionStorage',
  'MutationObserver',
  'CustomEvent(',
  'dispatchEvent(',
]) {
  if (`${component}\n${contract}`.includes(forbidden)) {
    throw new Error(`INTEL_FE_005B_EXTERNAL_DATA_OR_DOM_COUPLING: ${forbidden}`);
  }
}

for (const forbidden of ['value ?? 0', 'value || 0', 'point.y ?? 0', 'datum.value ?? 0', 'datum.value || 0']) {
  if (`${component}\n${contract}`.includes(forbidden)) {
    throw new Error(`INTEL_FE_005B_SILENT_ZERO_PATTERN: ${forbidden}`);
  }
}

for (const phrase of ['How to', 'Learn more', 'Getting started', 'Click here', 'You should', 'Next step', 'Tip:']) {
  if (`${component}\n${css}`.includes(phrase)) {
    throw new Error(`INTEL_FE_005B_DEFAULT_GUIDANCE_COPY: ${phrase}`);
  }
}

for (const required of [
  '.ef-analytics-frame',
  '.ef-analytics-line',
  '.ef-analytics-line__missing',
  '.ef-analytics-bars',
  '.ef-analytics-table-shell',
  '@media (max-width: 760px)',
  '@media (prefers-contrast: more)',
  '@media (prefers-reduced-motion: reduce)',
]) {
  if (!css.includes(required)) throw new Error(`INTEL_FE_005B_VISUAL_CONTRACT_MISSING: ${required}`);
}

for (const forbidden of ['!important', 'url(', '@font-face', '.dashboard-', '.orders-', '.inventory-', '.delivery-']) {
  if (css.includes(forbidden)) throw new Error(`INTEL_FE_005B_VISUAL_SCOPE_EXPANSION: ${forbidden}`);
}

for (const required of [
  'AnalyticsLineChart',
  'AnalyticsBarChart',
  'AnalyticsDataTable',
  'buildAnalyticsLineGeometry',
  'type AnalyticsSeriesDatum',
]) {
  if (!barrel.includes(required)) throw new Error(`INTEL_FE_005B_PRIMITIVE_EXPORT_MISSING: ${required}`);
}
if (!featureBarrel.includes("export * from './primitives';")) {
  throw new Error('INTEL_FE_005B_FEATURE_EXPORT_MISSING');
}

for (const testName of [
  'analytics series preserves confirmed zero and converts invalid values to missing issues',
  'line geometry creates real gaps instead of bridging missing values',
  'equal line values receive a non-zero plotting domain',
  'bar geometry shares a signed zero baseline and retains zero width',
  'all-missing bar data has no fabricated numeric domain',
  'numeric and label ticks remain bounded and deterministic',
]) {
  if (!test.includes(testName)) throw new Error(`INTEL_FE_005B_TEST_MISSING: ${testName}`);
}

const dependencyNames = Object.keys(packageJson.dependencies ?? {});
for (const dependency of dependencyNames) {
  if (/chart|recharts|echarts|plotly|visx|d3/i.test(dependency)) {
    throw new Error(`INTEL_FE_005B_CHART_DEPENDENCY_ADDED: ${dependency}`);
  }
}

const auditCommand = packageJson.scripts?.['audit:intel-frontend'];
if (typeof auditCommand !== 'string'
  || !auditCommand.includes('audit-intel-analytics-primitives.mjs')
  || !auditCommand.includes('intel-analytics-primitives-contract.test.mjs')) {
  throw new Error('INTEL_FE_005B_PACKAGE_AUDIT_WIRING_MISSING');
}

console.log('INTEL-FE-005B analytics primitives audit passed.');
