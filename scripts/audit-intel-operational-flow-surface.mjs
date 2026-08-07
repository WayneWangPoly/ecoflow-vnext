import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`INTEL_UI_004B_FILE_MISSING: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

const dashboard = read('src/features/dashboard/DashboardPage.tsx');
const navigation = read('src/features/dashboard/dashboardNavigationContract.ts');
const navigationTest = read('scripts/intel-dashboard-navigation-contract.test.mjs');
const style = read('src/features/dashboard/operationalFlowSurface.css');
const contract = read('src/features/intelligence/operationalFlow/operationalFlowContract.ts');
const packageJson = JSON.parse(read('package.json'));

for (const marker of [
  "from '@/features/intelligence/operationalFlow'",
  "import './operationalFlowSurface.css';",
  'buildOperationalFlow(orders)',
  'const orderById = useMemo(() => {',
  'const value = new Map<string, ImportedOrder>();',
  'flow.assignments.forEach((assignment) => {',
  'const order = orderById.get(assignment.orderId);',
  'if (order) value[assignment.stage].push(order);',
  'operationalFlowStages.map((stage) => [stage.key, []])',
  "assignment.stage !== 'DELIVERED'",
  'groups.NEEDS_ACTION.length',
  'groups.FINANCE_REVIEW.length',
  'groups.READY.length',
  'groups.WAREHOUSE.length',
  'groups.STAGED.length',
  'groups.ROUTE.length',
  'groups.DELIVERED',
  'flow.nodes.map((stage)',
  'dashboardStageTarget(stage.key, role)',
  'title="Operational flow"',
  'aria-label="Eight-stage operational flow"',
  'data-stage={stage.key.toLowerCase()}',
  "label={flow.state === 'partial' || flow.state === 'invalid' ? 'PARTIAL'",
  'flow.excludedCount',
  'flow.unknownCount',
  'const detailReady = snapshotReady',
  'Eight-stage classification is loading as secondary detail',
]) {
  if (!dashboard.includes(marker)) throw new Error(`INTEL_UI_004B_DASHBOARD_MARKER_MISSING: ${marker}`);
}

if ((dashboard.match(/buildOperationalFlow\(orders\)/g) ?? []).length !== 1) {
  throw new Error('INTEL_UI_004B_FLOW_BUILD_COUNT_INVALID');
}
if ((dashboard.match(/flow\.assignments\.forEach\(\(assignment\) => \{/g) ?? []).length !== 1) {
  throw new Error('INTEL_UI_004B_ASSIGNMENT_MAPPING_COUNT_INVALID');
}

for (const forbidden of [
  /type Stage\s*=/,
  /function stageOf\s*\(/,
  /const CLOSED\s*=/,
  /const WAREHOUSE\s*=/,
  /releaseGateStatus\s*===/,
  /order\.status\s*===\s*'OUT_FOR_DELIVERY'/,
  /WAREHOUSE\.has\(/,
  /five exclusive stages/,
  /Open order stages/,
  /document\.querySelector/,
  /MutationObserver/,
  /CustomEvent/,
  /dispatchEvent/,
]) {
  if (forbidden.test(dashboard)) throw new Error(`INTEL_UI_004B_LEGACY_OR_DOM_CLASSIFIER: ${forbidden}`);
}

for (const marker of [
  "import type { OperationalFlowStage } from '@/features/intelligence/operationalFlow'",
  'export type DashboardStage = OperationalFlowStage',
  "stage === 'WAREHOUSE' || stage === 'STAGED' || stage === 'ROUTE' || stage === 'DELIVERED'",
  "stage === 'FINANCE_REVIEW' && role === 'account'",
]) {
  if (!navigation.includes(marker)) throw new Error(`INTEL_UI_004B_NAVIGATION_MARKER_MISSING: ${marker}`);
}

for (const assertion of [
  "dashboardStageTarget('NEW', 'owner'), 'orders'",
  "dashboardStageTarget('NEEDS_ACTION', 'owner'), 'orders'",
  "dashboardStageTarget('FINANCE_REVIEW', 'account'), 'reconciliation'",
  "dashboardStageTarget('WAREHOUSE', 'owner'), 'delivery'",
  "dashboardStageTarget('STAGED', 'owner'), 'delivery'",
  "dashboardStageTarget('ROUTE', 'account'), 'delivery'",
  "dashboardStageTarget('DELIVERED', 'viewer'), 'delivery'",
]) {
  if (!navigationTest.includes(assertion)) throw new Error(`INTEL_UI_004B_NAVIGATION_TEST_MISSING: ${assertion}`);
}

for (const marker of [
  '.ops-control-room .ops-control-grid',
  'grid-template-columns: minmax(300px, .72fr) minmax(720px, 1.28fr)',
  'grid-template-columns: repeat(8, minmax(88px, 1fr))',
  "button[data-stage='new']",
  "button[data-stage='needs_action']",
  "button[data-stage='finance_review']",
  "button[data-stage='ready']",
  "button[data-stage='warehouse']",
  "button[data-stage='staged']",
  "button[data-stage='route']",
  "button[data-stage='delivered']",
  '@media (max-width: 760px)',
  'grid-template-columns: repeat(2, minmax(0, 1fr))',
  '@media (prefers-contrast: more)',
  '@media (prefers-reduced-motion: reduce)',
]) {
  if (!style.includes(marker)) throw new Error(`INTEL_UI_004B_STYLE_MARKER_MISSING: ${marker}`);
}

for (const forbidden of [
  '!important',
  '@font-face',
  'url(',
  '#root',
  '.warehouse-',
  '.driver-',
  '.orders-',
]) {
  if (style.includes(forbidden)) throw new Error(`INTEL_UI_004B_STYLE_SCOPE_EXPANSION: ${forbidden}`);
}

if ((contract.match(/\{ key: '[A-Z_]+'/g) ?? []).length !== 8) {
  throw new Error('INTEL_UI_004B_CONTRACT_STAGE_COUNT_CHANGED');
}

const frontendAudit = packageJson.scripts?.['audit:intel-frontend'];
if (typeof frontendAudit !== 'string'
  || !frontendAudit.includes('audit-intel-operational-flow-surface.mjs')) {
  throw new Error('INTEL_UI_004B_PACKAGE_WIRING_MISSING');
}

console.log('INTEL-UI-004B operational flow surface audit passed.');