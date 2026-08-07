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

for (const required of [
  'ops-control-room',
  'ops-control-hero',
  'ops-control-metrics',
  'ops-control-metric',
  'ops-control-grid',
  'ops-control-panel',
  'ops-control-flow',
  'ops-control-status-line',
]) {
  if (!dashboard.includes(required)) throw new Error(`INTEL_FE_002C_DASHBOARD_STRUCTURE_MISSING: ${required}`);
  if (!css.includes(`.${required}`) && !flowCss.includes(`.${required}`)) {
    throw new Error(`INTEL_FE_002C_DASHBOARD_STYLE_MISSING: ${required}`);
  }
}

for (const legacy of [
  'ops-home-header',
  'ops-metric"',
  'ops-home-panel',
  'ops-action-row',
  'ops-stage-panel',
  'ops-flow-exclusive',
  'ops-order-table',
  'ops-order-row',
  'ops-chip',
  'field-readiness-warning',
  'field-readiness-note',
  'field-readiness-unavailable',
  'field-readiness-loading',
]) {
  if (dashboard.includes(legacy)) throw new Error(`INTEL_FE_002C_LEGACY_DASHBOARD_VISUAL_REMAINS: ${legacy}`);
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
    || !dashboard.includes('<PriorityWork />')) {
  throw new Error('INTEL_FE_002C_GOVERNED_PRIORITY_WORK_MISSING');
}
if (!priorityComponent.includes('POLICY-RANKED · CURRENT EXCEPTIONS')
    || !priorityCss.includes('.ef-priority-work__table')) {
  throw new Error('INTEL_FE_002C_PRIORITY_WORK_PUBLIC_SURFACE_INCOMPLETE');
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
  if (`${css}\n${flowCss}`.includes(forbiddenSelector)) {
    throw new Error(`INTEL_FE_002C_CROSS_PAGE_STYLE_FORBIDDEN: ${forbiddenSelector}`);
  }
}

for (const forbidden of ['!important', 'url(']) {
  if (`${css}\n${flowCss}\n${priorityCss}`.includes(forbidden)) {
    throw new Error(`INTEL_FE_002C_STYLE_ESCAPE_FORBIDDEN: ${forbidden}`);
  }
}

for (const required of [
  "import './fieldReadinessDashboard.css';",
  "import './dashboardControlRoom.css';",
  "import './operationalFlowSurface.css';",
  'dashboardSourceTone',
]) {
  if (!dashboard.includes(required)) throw new Error(`INTEL_FE_002C_WIRING_MISSING: ${required}`);
}

if (dashboard.indexOf("import './dashboardControlRoom.css';") < dashboard.indexOf("import './fieldReadinessDashboard.css';")) {
  throw new Error('INTEL_FE_002C_CONTROL_ROOM_CSS_PRECEDENCE_INVALID');
}
if (dashboard.indexOf("import './operationalFlowSurface.css';") < dashboard.indexOf("import './dashboardControlRoom.css';")) {
  throw new Error('INTEL_FE_002C_OPERATIONAL_FLOW_CSS_PRECEDENCE_INVALID');
}

// TRANSFORM-001: the Control Room must reach first useful paint from the
// bounded readiness RPC. The aggregate operational snapshot is secondary
// detail and cannot be an authentication/profile side effect for this route.
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
if (!route.includes('Control Room owns the bounded bootstrap introduced by TRANSFORM-001')) {
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

console.log('INTEL-FE-002C Dashboard control-room + TRANSFORM-001 bounded bootstrap audit passed.');