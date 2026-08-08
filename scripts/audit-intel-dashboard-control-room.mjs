import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`INTEL_FE_002C_FILE_MISSING: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

const dashboard = read('src/features/dashboard/DashboardPage.tsx');
const route = read('src/features/operationalRoutes/UnifiedOperationalRoutes.tsx');
const css = read('src/features/dashboard/dashboardControlRoom.css');
const flowCss = read('src/features/dashboard/operationalFlowSurface.css');
const vnextCss = read('src/features/dashboard/controlRoomVNext.css');
const priorityCss = read('src/features/intelligence/attention/priorityWork.css');
const priorityComponent = read('src/features/intelligence/attention/PriorityWork.tsx');
const contract = read('src/features/dashboard/dashboardControlContract.ts');
const test = read('scripts/intel-dashboard-control-room-contract.test.mjs');
const packageJson = JSON.parse(read('package.json'));

for (const primitive of [
  'ControlBanner',
  'ControlButton',
  'ControlPanel',
  'ControlSkeleton',
  'ControlStatus',
]) {
  if (!dashboard.includes(primitive)) throw new Error(`INTEL_FE_002C_PRIMITIVE_NOT_ADOPTED: ${primitive}`);
}

// TRANSFORM-003 is a product hierarchy contract, not a card-presence audit.
for (const required of [
  'ops-control-room--vnext',
  'ops-vnext-hero',
  'ops-vnext-live-strip',
  'ops-vnext-today',
  'ops-vnext-progress-track',
  'ops-vnext-command-grid',
  'ops-vnext-flow-panel',
  'ops-vnext-priority-slot',
  'ops-vnext-live-grid',
  'ops-vnext-live-panel',
  'ops-vnext-decision-grid',
  'ops-vnext-close-panel',
  'ops-vnext-exception-detail',
  'ops-vnext-source-footnote',
]) {
  if (!dashboard.includes(required)) throw new Error(`TRANSFORM_003_COMMAND_CENTER_STRUCTURE_MISSING: ${required}`);
  if (!vnextCss.includes(`.${required}`)) throw new Error(`TRANSFORM_003_COMMAND_CENTER_STYLE_MISSING: ${required}`);
}

for (const copy of [
  'Run today from one operating picture.',
  'Current workload',
  'Active exceptions',
  'Physical inventory',
  'Execution progress',
  'CURRENT WORKLOAD',
  'WAREHOUSE LIVE',
  'Physical execution',
  'DELIVERY LIVE',
  'Route execution',
  'Pre-close control',
  'Full current exception register',
  'Final Business Day Close remains server-authoritative',
]) {
  if (!dashboard.includes(copy)) throw new Error(`TRANSFORM_003_PRODUCT_COPY_MISSING: ${copy}`);
}

// Today is allowed to include only an explicitly current business-day scope.
for (const marker of [
  'matchesBusinessDay',
  'order.requestedDeliveryBusinessDay === businessDay',
  'deliveryDate === businessDay',
  'buildOperationalFlow(todayOrders, {',
  'inventoryQuantityCommissioned: readiness ? inventoryQuantityCommissioned : undefined',
  "stageCount(todayFlow, 'DELIVERED')",
  'todayDelivered / todayTotal',
]) {
  if (!dashboard.includes(marker)) throw new Error(`TRANSFORM_003_TODAY_AUTHORITY_MISSING: ${marker}`);
}
if (dashboard.includes('serverCurrentOrders} Today') || dashboard.includes('server_current_orders) as today')) {
  throw new Error('TRANSFORM_003_CURRENT_WORKLOAD_MISREPRESENTED_AS_TODAY');
}
if (dashboard.includes('buildOperationalFlow(todayOrders), [todayOrders]')) {
  throw new Error('TRANSFORM_003_TODAY_COMMISSIONING_CONTEXT_MISSING');
}

// Do not manufacture driver identity, route delay or close authority that does
// not exist in the current production model.
for (const forbidden of [
  '3 drivers',
  'drivers on road',
  'South 01',
  'East 02',
  '+12 min',
  'closeBlockers === 0 ? \'Ready to close\'',
  'Final close complete',
]) {
  if (dashboard.includes(forbidden)) throw new Error(`TRANSFORM_003_FABRICATED_OPERATING_FACT: ${forbidden}`);
}

for (const preserved of [
  'Review orders',
  'Start first stocktake',
  'Warehouse map',
  'Reconciliation',
  'Refreshing…',
  'Refresh',
  'Needs attention',
  'Operational flow',
  'Connecting to current operations…',
  'Current operating summary is unavailable',
  'Detailed order classification is unavailable',
]) {
  if (!dashboard.includes(preserved)) throw new Error(`INTEL_FE_002C_EXISTING_COPY_LOST: ${preserved}`);
}

if (!dashboard.includes('ActionableExceptionQueue, PriorityWork')
    || !dashboard.includes('<PriorityWork />')
    || !dashboard.includes("<ActionableExceptionQueue onOpenOrders={() => onOpenTab('orders')} />")) {
  throw new Error('TRANSFORM_003_GOVERNED_ATTENTION_SURFACES_MISSING');
}
if (!priorityComponent.includes('POLICY-RANKED · CURRENT EXCEPTIONS')
    || !priorityCss.includes('.ef-priority-work__table')) {
  throw new Error('INTEL_FE_002C_PRIORITY_WORK_PUBLIC_SURFACE_INCOMPLETE');
}
if (dashboard.indexOf('<PriorityWork />') > dashboard.indexOf('ops-vnext-live-grid')) {
  throw new Error('TRANSFORM_003_PRIORITY_WORK_NOT_IN_PRIMARY_COMMAND_TIER');
}
if (dashboard.indexOf('<ActionableExceptionQueue') < dashboard.indexOf('ops-vnext-exception-detail')) {
  throw new Error('TRANSFORM_003_FULL_EXCEPTION_REGISTER_DOMINATES_PRIMARY_SURFACE');
}

for (const localPriority of [
  'FLOW_PRIORITY',
  'activeOrders',
  'ops-control-order-table',
  'ops-control-order-row',
  'Top {activeOrders.length}',
  'No open orders.',
]) {
  if (dashboard.includes(localPriority)) {
    throw new Error(`INTEL_FE_002C_LOCAL_PRIORITY_WORK_REMAINS: ${localPriority}`);
  }
}

for (const guidance of [
  'How to',
  'Learn more',
  'Getting started',
  'Click here',
  'You should',
  'Next step',
  'Tip:',
  'Need help',
]) {
  if (dashboard.includes(guidance)) throw new Error(`INTEL_FE_002C_GUIDANCE_COPY_ADDED: ${guidance}`);
}

for (const forbiddenSelector of [
  '.sidebar',
  '.desktop-topbar',
  '.desktop-mobile-nav',
  '.mobile-shell',
  '.warehouse-',
  '.driver-',
  '#root',
]) {
  if (`${css}\n${flowCss}\n${vnextCss}`.includes(forbiddenSelector)) {
    throw new Error(`INTEL_FE_002C_CROSS_PAGE_STYLE_FORBIDDEN: ${forbiddenSelector}`);
  }
}
for (const forbidden of ['!important', 'url(']) {
  if (`${css}\n${flowCss}\n${vnextCss}\n${priorityCss}`.includes(forbidden)) {
    throw new Error(`INTEL_FE_002C_STYLE_ESCAPE_FORBIDDEN: ${forbidden}`);
  }
}

for (const required of [
  "import './fieldReadinessDashboard.css';",
  "import './dashboardControlRoom.css';",
  "import './operationalFlowSurface.css';",
  "@import './controlRoomVNext.css';",
  'dashboardSourceTone',
]) {
  const source = required.startsWith('@import') ? flowCss : dashboard;
  if (!source.includes(required)) throw new Error(`INTEL_FE_002C_WIRING_MISSING: ${required}`);
}
if (dashboard.indexOf("import './dashboardControlRoom.css';") < dashboard.indexOf("import './fieldReadinessDashboard.css';")) {
  throw new Error('INTEL_FE_002C_CONTROL_ROOM_CSS_PRECEDENCE_INVALID');
}
if (dashboard.indexOf("import './operationalFlowSurface.css';") < dashboard.indexOf("import './dashboardControlRoom.css';")) {
  throw new Error('INTEL_FE_002C_OPERATIONAL_FLOW_CSS_PRECEDENCE_INVALID');
}

// VNext desktop/tablet/phone hierarchy must be designed, not a squeezed grid.
for (const responsive of [
  '@media (max-width: 1280px)',
  '@media (max-width: 960px)',
  '@media (max-width: 700px)',
  '.ops-vnext-live-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }',
  '.ops-vnext-live-grid,',
  '.ops-vnext-decision-grid { grid-template-columns: 1fr; }',
  '.ops-vnext-close-checks { grid-template-columns: 1fr; }',
]) {
  if (!vnextCss.includes(responsive)) throw new Error(`TRANSFORM_003_RESPONSIVE_CONTRACT_MISSING: ${responsive}`);
}

// TRANSFORM-001 remains non-negotiable beneath the visual transformation.
for (const required of [
  'loadDashboardReadiness',
  'reloadPrimary',
  'reloadSecondary',
  'data-primary-ready',
  'detail loads without blocking this page',
  'ecoflow:control-room:shell',
  'ecoflow:control-room:primary-summary-ready',
  'ecoflow:control-room:modules-ready',
  'ecoflow:control-room:flow-ready',
  'ecoflow:control-room:full-ready',
]) {
  if (!dashboard.includes(required)) throw new Error(`TRANSFORM_001_BOUNDED_BOOTSTRAP_MISSING: ${required}`);
}
for (const forbidden of [
  'if (loading && !snapshotReady)',
  'if (!snapshotReady) {',
  'if (snapshotReady) void reloadReadiness()',
]) {
  if (dashboard.includes(forbidden)) throw new Error(`TRANSFORM_001_GLOBAL_LOADING_GATE_REMAINS: ${forbidden}`);
}
if (!route.includes("if (workspace === 'ordermentum') void reloadViews();")) {
  throw new Error('TRANSFORM_001_ORDERMENTUM_AGGREGATE_BOUNDARY_MISSING');
}
if (!route.includes('bounded bootstrap introduced by TRANSFORM-001')
    || !route.includes('reloadViews only as secondary flow enrichment')) {
  throw new Error('TRANSFORM_001_ROUTE_BOUNDARY_NOT_DOCUMENTED');
}
if (route.includes("if (workspace === 'dashboard') void reloadViews();")) {
  throw new Error('TRANSFORM_001_CONTROL_ROOM_EAGER_AGGREGATE_ROUTE_REMAINS');
}

for (const required of ['DashboardOperationalTone', 'dashboardControlTone', 'dashboardSourceTone']) {
  if (!contract.includes(required)) throw new Error(`INTEL_FE_002C_TYPED_CONTRACT_MISSING: ${required}`);
}
for (const testName of [
  'Dashboard operational tones map to semantic status tones',
  'healthy source states resolve to success',
  'checking and degraded source states resolve to warning',
  'failed source states resolve to danger and unknown remains neutral',
]) {
  if (!test.includes(testName)) throw new Error(`INTEL_FE_002C_TEST_MISSING: ${testName}`);
}

const auditCommand = packageJson.scripts?.['audit:intel-frontend'];
if (typeof auditCommand !== 'string'
  || !auditCommand.includes('audit-intel-dashboard-control-room.mjs')
  || !auditCommand.includes('intel-dashboard-control-room-contract.test.mjs')) {
  throw new Error('INTEL_FE_002C_PACKAGE_AUDIT_WIRING_MISSING');
}

console.log('Control Room VNext audit passed: bounded bootstrap, commercial command hierarchy and truthful current-day semantics are enforced.');