import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`INTEL_UI_005B_FILE_MISSING: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

const componentPath = 'src/features/intelligence/crossFilter/CrossFilterDrillSurface.tsx';
const presentationPath = 'src/features/intelligence/crossFilter/crossFilterDrillPresentationContract.ts';
const stylePath = 'src/features/intelligence/crossFilter/crossFilterDrillSurface.css';
const testPath = 'scripts/intel-cross-filter-drill-surface-contract.test.mjs';
const component = read(componentPath);
const presentation = read(presentationPath);
const style = read(stylePath);
const test = read(testPath);
const index = read('src/features/intelligence/crossFilter/index.ts');
const dashboard = read('src/features/dashboard/DashboardPage.tsx');
const pulse = read('src/features/intelligence/operationalPulse/OperationalPulse.tsx');
const app = read('src/app/App.tsx');
const designTokens = read('src/features/intelligence/designSystem/tokens.css');
const packageJson = JSON.parse(read('package.json'));

for (const marker of [
  'CrossFilterDrillSurface',
  'model: CrossFilterDrillModel',
  'activeBreakdownKey?: string | null',
  'onBreakdownChange: (breakdownKey: string) => void',
  'onInspectEntity: (entity: CrossFilterAffectedEntity) => void',
  'onOpenOperationalRoute:',
  'resolveCrossFilterBreakdown(model, activeBreakdownKey)',
  'requestedSelectionMissing',
  'ControlPanel',
  'ControlStatus',
  'ControlTabs',
  'ControlButton',
  'ariaLabel="Metric breakdown values"',
  'aria-label="Affected operational entities"',
  'onChange={onBreakdownChange}',
  'onClick={() => onInspectEntity(entity)}',
  'onClick={() => onOpenOperationalRoute(entity.operationalRoute, entity)}',
  'Selected breakdown is unavailable',
  'No routed entities available',
  'validated contract data',
]) {
  if (!component.includes(marker)) throw new Error(`INTEL_UI_005B_COMPONENT_MARKER_MISSING: ${marker}`);
}

for (const forbidden of [
  /useState/,
  /useEffect/,
  /supabase/i,
  /\.schema\s*\(/,
  /\.rpc\s*\(/,
  /\.from\s*\(/,
  /fetch\s*\(/,
  /window\./,
  /document\./,
  /location\./,
  /history\./,
  /localStorage/,
  /sessionStorage/,
  /MutationObserver/,
  /CustomEvent/,
  /dispatchEvent/,
  /<a\s/i,
  /href=/,
  /setTimeout/,
  /setInterval/,
  /Math\.random/,
  /\bowner\b/i,
  /\badmin\b/i,
  /\baccount\b/i,
  /\bviewer\b/i,
]) {
  if (forbidden.test(component)) throw new Error(`INTEL_UI_005B_COMPONENT_SCOPE_EXPANSION: ${forbidden}`);
}

if ((component.match(/onInspectEntity\(entity\)/g) ?? []).length !== 1) {
  throw new Error('INTEL_UI_005B_INSPECT_CALLBACK_COUNT_INVALID');
}
if ((component.match(/onOpenOperationalRoute\(entity\.operationalRoute, entity\)/g) ?? []).length !== 1) {
  throw new Error('INTEL_UI_005B_ROUTE_CALLBACK_COUNT_INVALID');
}

for (const marker of [
  'OPERATIONAL_PULSE_METRIC_LABELS',
  'satisfies Record<OperationalPulseMetricKey, string>',
  "revenue: 'Revenue'",
  "gross_margin: 'Gross margin'",
  "fill_rate: 'Fill rate'",
  "on_time_delivery_rate: 'On-time delivery rate'",
  "stockout_risk_count: 'Stockout risk count'",
  "dead_stock_value: 'Dead stock value'",
  "substitution_rate: 'Substitution rate'",
  "lines_picked_per_hour: 'Lines picked per hour'",
  "inventory_days_of_cover: 'Inventory days of cover'",
  "customer_concentration: 'Customer concentration'",
  'crossFilterDrillMetricLabel',
  'crossFilterDrillStatePresentation',
  'resolveCrossFilterBreakdown',
  'crossFilterBreakdownMeta',
  'crossFilterEntityKindLabel',
  'crossFilterOperationalRouteLabel',
  "label: 'DRILL READY'",
  "label: 'PARTIAL DRILL'",
  "label: 'NO BREAKDOWNS'",
  "label: 'DRILL BLOCKED'",
  "label: 'DRILL INVALID'",
  "if (workspace === 'orders') return 'Open Orders'",
  "if (workspace === 'inventory') return 'Open Inventory'",
  "if (workspace === 'customers') return 'Open Customers'",
  "if (workspace === 'stores') return 'Open Stores'",
  "return 'Open Delivery'",
]) {
  if (!presentation.includes(marker)) throw new Error(`INTEL_UI_005B_PRESENTATION_MARKER_MISSING: ${marker}`);
}

for (const forbidden of [
  /supabase/i,
  /\.rpc\s*\(/,
  /\.from\s*\(/,
  /fetch\s*\(/,
  /DashboardPage/,
  /OverlayManager/,
  /window\./,
  /document\./,
  /localStorage/,
  /sessionStorage/,
  /recommendedAction/,
  /businessImpact/,
  /severity/,
  /\bsla\b/i,
  /\bowner\b/i,
  /\badmin\b/i,
  /\baccount\b/i,
  /\bviewer\b/i,
]) {
  if (forbidden.test(presentation)) throw new Error(`INTEL_UI_005B_PRESENTATION_SCOPE_EXPANSION: ${forbidden}`);
}

for (const marker of [
  '.ef-cross-filter-drill',
  '.ef-cross-filter-drill__workspace',
  '.ef-cross-filter-drill__selection',
  '.ef-cross-filter-drill__entity-list',
  '.ef-cross-filter-drill__entity',
  '.ef-cross-filter-drill__entity-actions',
  '.ef-cross-filter-drill__state',
  '.ef-cross-filter-drill__boundary',
  '@media (max-width: 760px)',
  '@media (prefers-contrast: more)',
  '@media (prefers-reduced-motion: reduce)',
]) {
  if (!style.includes(marker)) throw new Error(`INTEL_UI_005B_STYLE_MARKER_MISSING: ${marker}`);
}

for (const forbidden of [
  '!important',
  '@font-face',
  'url(',
  '#root',
  '.ops-control-',
  '.orders-',
  '.inventory-',
  '.warehouse-',
  '.delivery-',
]) {
  if (style.includes(forbidden)) throw new Error(`INTEL_UI_005B_STYLE_SCOPE_EXPANSION: ${forbidden}`);
}

const publishedTokens = new Set(
  Array.from(designTokens.matchAll(/(--ef-[a-z0-9-]+)\s*:/gi), (match) => match[1]),
);
const localTokens = new Set(
  Array.from(style.matchAll(/(--ef-[a-z0-9-]+)\s*:/gi), (match) => match[1]),
);
for (const reference of Array.from(style.matchAll(/var\((--ef-[a-z0-9-]+)/gi), (match) => match[1])) {
  if (!publishedTokens.has(reference) && !localTokens.has(reference)) {
    throw new Error(`INTEL_UI_005B_UNPUBLISHED_DESIGN_TOKEN: ${reference}`);
  }
}

for (const testName of [
  'metric presentation uses canonical Operational Pulse labels',
  'ready partial empty blocked and invalid states remain visibly distinct',
  'breakdown selection defaults once but fails closed for stale explicit keys',
  'breakdown meta distinguishes complete and truncated routed coverage',
  'entity kind labels cover all six routed entity kinds',
  'operational route labels derive only from validated route workspace',
]) {
  if (!test.includes(testName)) throw new Error(`INTEL_UI_005B_TEST_MISSING: ${testName}`);
}

for (const marker of [
  'CrossFilterDrillSurface',
  'CrossFilterDrillSurfaceProps',
  'crossFilterDrillStatePresentation',
  'resolveCrossFilterBreakdown',
]) {
  if (!index.includes(marker)) throw new Error(`INTEL_UI_005B_EXPORT_MISSING: ${marker}`);
}

for (const forbidden of [
  "@/features/intelligence/crossFilter",
  'CrossFilterDrillSurface',
  'crossFilterDrillPresentationContract',
]) {
  if (dashboard.includes(forbidden) || pulse.includes(forbidden) || app.includes(forbidden)) {
    throw new Error(`INTEL_UI_005B_PREMATURE_ADOPTION: ${forbidden}`);
  }
}

const frontendAudit = packageJson.scripts?.['audit:intel-frontend'];
if (typeof frontendAudit !== 'string'
  || !frontendAudit.includes('audit-intel-cross-filter-drill-surface.mjs')
  || !frontendAudit.includes('intel-cross-filter-drill-surface-contract.test.mjs')) {
  throw new Error('INTEL_UI_005B_PACKAGE_WIRING_MISSING');
}

console.log('INTEL-UI-005B cross-filter drill surface audit passed.');
