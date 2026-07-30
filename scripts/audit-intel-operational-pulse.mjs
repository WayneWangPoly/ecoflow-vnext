import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`INTEL_UI_002A_FILE_MISSING: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

const component = read('src/features/intelligence/operationalPulse/OperationalPulse.tsx');
const contract = read('src/features/intelligence/operationalPulse/operationalPulseContract.ts');
const css = read('src/features/intelligence/operationalPulse/operationalPulse.css');
const barrel = read('src/features/intelligence/operationalPulse/index.ts');
const test = read('scripts/intel-operational-pulse-contract.test.mjs');
const app = read('src/app/App.tsx');
const dashboard = read('src/features/dashboard/DashboardPage.tsx');
const designTokens = read('src/features/intelligence/designSystem/tokens.css');
const packageJson = JSON.parse(read('package.json'));

for (const required of [
  'OperationalPulseDeck',
  'OperationalPulseCard',
  'buildOperationalPulseDeck',
  'normaliseOperationalPulseMetric',
  'operationalPulseSignalTone',
  'aria-label={`${metric.displayName}: ${accessibleValue}`}',
  "metric.availability === 'READY' ? metric.displayValue : '—'",
  'data-availability={metric.availability.toLowerCase()}',
  'data-freshness={metric.freshness.toLowerCase()}',
  'data-quality={metric.quality.toLowerCase()}',
  '<time dateTime={metric.asOfAt ?? undefined}>',
]) {
  if (!`${component}\n${contract}`.includes(required)) {
    throw new Error(`INTEL_UI_002A_COMPONENT_CONTRACT_MISSING: ${required}`);
  }
}

for (const metricKey of [
  'revenue',
  'gross_margin',
  'fill_rate',
  'on_time_delivery_rate',
  'stockout_risk_count',
  'dead_stock_value',
  'substitution_rate',
  'lines_picked_per_hour',
  'inventory_days_of_cover',
  'customer_concentration',
]) {
  if (!contract.includes(`'${metricKey}'`)) {
    throw new Error(`INTEL_UI_002A_METRIC_IDENTITY_MISSING: ${metricKey}`);
  }
}

for (const required of [
  'function finiteNumber(value: unknown)',
  "if (typeof value !== 'string' || !value.trim()) return null",
  "availability: 'EMPTY'",
  "code: 'NON_READY_VALUE_SUPPRESSED'",
  "value: null",
  "displayValue: null",
  "metric.availability === 'READY'",
  "metric.freshness === 'CURRENT'",
  "metric.quality === 'TRUSTED'",
]) {
  if (!contract.includes(required)) {
    throw new Error(`INTEL_UI_002A_FAIL_CLOSED_CONTRACT_MISSING: ${required}`);
  }
}

for (const forbidden of [
  '@/data/repositories/',
  'analyticsRepository',
  'readShadowProjection',
  'readReconciliation',
  'get_initial_kpi_shadow_projection',
  'get_initial_kpi_reconciliation',
  'supabase',
  '.schema(',
  '.rpc(',
  '.from(',
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
  if (`${component}\n${contract}`.includes(forbidden)) {
    throw new Error(`INTEL_UI_002A_DATA_OR_WRITE_COUPLING: ${forbidden}`);
  }
}

for (const forbidden of [
  'Number(input.value)',
  'value ?? 0',
  'value || 0',
  'displayValue ||',
  'metric.value ?? 0',
  'metric.value || 0',
  '.reduce(',
  'sum(',
  'average(',
]) {
  if (`${component}\n${contract}`.includes(forbidden)) {
    throw new Error(`INTEL_UI_002A_AGGREGATION_OR_SILENT_ZERO: ${forbidden}`);
  }
}

for (const metricName of [
  'Revenue',
  'Gross Margin',
  'Fill Rate',
  'On-time Delivery Rate',
  'Stockout Risk',
  'Dead Stock Value',
  'Substitution Rate',
  'Lines Picked per Hour',
  'Inventory Days of Cover',
  'Customer Concentration',
]) {
  if (component.includes(metricName)) {
    throw new Error(`INTEL_UI_002A_DEFAULT_BUSINESS_COPY: ${metricName}`);
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
    throw new Error(`INTEL_UI_002A_GUIDANCE_COPY_FORBIDDEN: ${phrase}`);
  }
}

for (const required of [
  '.ef-operational-pulse',
  '.ef-operational-pulse__card',
  '.ef-operational-pulse__rail',
  '.ef-operational-pulse__signal',
  '.ef-operational-pulse__value',
  '.ef-operational-pulse__blockers',
  '.ef-operational-pulse__footer',
  '@media (max-width: 620px)',
  '@media (prefers-contrast: more)',
  '@media (prefers-reduced-motion: reduce)',
]) {
  if (!css.includes(required)) {
    throw new Error(`INTEL_UI_002A_VISUAL_CONTRACT_MISSING: ${required}`);
  }
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
  if (css.includes(forbidden)) {
    throw new Error(`INTEL_UI_002A_VISUAL_SCOPE_EXPANSION: ${forbidden}`);
  }
}

const publishedTokens = new Set(
  Array.from(designTokens.matchAll(/(--ef-[a-z0-9-]+)\s*:/gi), (match) => match[1]),
);
const localTokens = new Set(
  Array.from(css.matchAll(/(--ef-[a-z0-9-]+)\s*:/gi), (match) => match[1]),
);
for (const reference of Array.from(css.matchAll(/var\((--ef-[a-z0-9-]+)/gi), (match) => match[1])) {
  if (!publishedTokens.has(reference) && !localTokens.has(reference)) {
    throw new Error(`INTEL_UI_002A_UNPUBLISHED_DESIGN_TOKEN: ${reference}`);
  }
}

for (const required of [
  'OperationalPulseDeck',
  'OperationalPulseCard',
  'buildOperationalPulseDeck',
  'type OperationalPulseMetric',
  'type OperationalPulseAvailability',
]) {
  if (!barrel.includes(required)) {
    throw new Error(`INTEL_UI_002A_EXPORT_MISSING: ${required}`);
  }
}

for (const testName of [
  'operational pulse registry contains the ten governed initial metric identities',
  'ready metrics preserve confirmed numeric zero and supplied display value',
  'non-ready metrics suppress supplied values instead of presenting shadow data',
  'ready metrics with invalid, null or undisplayable values fail closed as empty',
  'operational pulse deck orders metrics canonically and rejects duplicate identity',
  'operational pulse signal tone prioritises invalid quality and stale sources',
  'operational pulse timestamps use Adelaide presentation and invalid values stay missing',
]) {
  if (!test.includes(testName)) {
    throw new Error(`INTEL_UI_002A_TEST_MISSING: ${testName}`);
  }
}

if (app.includes('operationalPulse') || dashboard.includes('operationalPulse')) {
  throw new Error('INTEL_UI_002A_PREMATURE_PAGE_ADOPTION');
}

const dependencyNames = Object.keys(packageJson.dependencies ?? {});
for (const dependency of dependencyNames) {
  if (/chart|recharts|echarts|plotly|visx|d3/i.test(dependency)) {
    throw new Error(`INTEL_UI_002A_DEPENDENCY_ADDED: ${dependency}`);
  }
}

const auditCommand = packageJson.scripts?.['audit:intel-frontend'];
if (typeof auditCommand !== 'string'
  || !auditCommand.includes('audit-intel-operational-pulse.mjs')
  || !auditCommand.includes('intel-operational-pulse-contract.test.mjs')) {
  throw new Error('INTEL_UI_002A_PACKAGE_AUDIT_WIRING_MISSING');
}

console.log('INTEL-UI-002A operational pulse audit passed.');
