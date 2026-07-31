import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  assert.ok(fs.existsSync(path), `Phase 3 gate prerequisite missing: ${path}`);
  return fs.readFileSync(path, 'utf8');
}

const dashboard = read('src/features/dashboard/DashboardPage.tsx');
const workspace = read('src/features/intelligence/analytics/OperationalPulseReadinessWorkspace.tsx');
const pulse = read('src/features/intelligence/operationalPulse/operationalPulseContract.ts');
const queue = read('src/features/intelligence/attention/ActionableExceptionQueue.tsx');
const lifecycle = read('src/features/intelligence/attention/ExceptionLifecycleCommitModal.tsx');
const flow = read('src/features/intelligence/operationalFlow/operationalFlowContract.ts');
const drillContract = read('src/features/intelligence/crossFilter/crossFilterDrillContract.ts');
const drillAccess = read('src/features/intelligence/crossFilter/MetricDrillAccessStatus.tsx');
const shadowReview = read('src/features/intelligence/crossFilter/ShadowDrillEvidenceReview.tsx');
const shadowRoute = read('src/features/intelligence/crossFilter/shadowDrillEvidencePresentationContract.ts');
const priority = read('src/features/intelligence/attention/PriorityWork.tsx');
const priorityRoute = read('src/features/intelligence/attention/priorityWorkPresentationContract.ts');
const priorityAudit = read('scripts/audit-intel-priority-work-surface.mjs');
const packageJson = JSON.parse(read('package.json'));
const frontendAudit = packageJson.scripts?.['audit:intel-frontend'];
assert.equal(typeof frontendAudit, 'string', 'Phase 3 gate requires audit:intel-frontend');

for (const packageName of [
  'audit-intel-desktop-route-shell.mjs',
  'audit-intel-dashboard-control-room.mjs',
  'audit-intel-operational-pulse.mjs',
  'audit-intel-operational-pulse-readiness.mjs',
  'audit-intel-actionable-exception-surface.mjs',
  'audit-intel-actionable-exception-lifecycle-commit-modal.mjs',
  'audit-intel-operational-flow-surface.mjs',
  'audit-intel-cross-filter-drill-contract.mjs',
  'audit-intel-cross-filter-drill-surface.mjs',
  'audit-intel-metric-drill-access-status.mjs',
  'audit-intel-shadow-drill-evidence-review.mjs',
  'audit-intel-priority-work-surface.mjs',
]) {
  assert.ok(frontendAudit.includes(packageName), `Phase 3 package not enforced: ${packageName}`);
}
assert.ok(
  priorityAudit.includes("import './audit-intel-phase-3-control-room-gate.mjs';"),
  'Phase 3 gate is not bound to the final Priority Work audit',
);

// UI-001 — desktop control shell and typed stage navigation.
for (const marker of ['ops-control-room', 'Review orders', 'Operational flow', 'onOpenTab(stage.tab)']) {
  assert.ok(dashboard.includes(marker), `UI-001 marker missing: ${marker}`);
}

// UI-002 — canonical ten-metric Pulse with governed Shadow/Blocked states.
const metricKeys = [
  'revenue','gross_margin','fill_rate','on_time_delivery_rate','stockout_risk_count',
  'dead_stock_value','substitution_rate','lines_picked_per_hour',
  'inventory_days_of_cover','customer_concentration',
];
for (const key of metricKeys) assert.ok(pulse.includes(`'${key}'`), `UI-002 metric missing: ${key}`);
for (const marker of [
  '<OperationalPulseDeck deck={deck}',
  '<MetricDrillAccessStatus />',
  '<ShadowDrillEvidenceReview />',
]) {
  assert.ok(workspace.includes(marker), `UI-002 workspace marker missing: ${marker}`);
}

// UI-003 — exception queue, lifecycle access and governed commit modal.
for (const marker of [
  'repository.readActionableExceptions()',
  'lifecycleRepository.readLifecycle(',
  'lifecycleAccessRepository.readAccess()',
  'ExceptionLifecycleCommitModal',
  'relatedRecords: orderId ? [{',
]) {
  assert.ok(queue.includes(marker), `UI-003 exception marker missing: ${marker}`);
}
for (const marker of ['role="dialog"', 'aria-modal="true"', 'globalThis.crypto?.randomUUID?.()', 'await onCommit({']) {
  assert.ok(lifecycle.includes(marker), `UI-003 lifecycle marker missing: ${marker}`);
}

// UI-004 — exactly eight mutually exclusive operational stages.
for (const stage of ['NEW','NEEDS_ACTION','FINANCE_REVIEW','READY','WAREHOUSE','STAGED','ROUTE','DELIVERED']) {
  assert.ok(flow.includes(`key: '${stage}'`), `UI-004 stage missing: ${stage}`);
}
assert.equal((flow.match(/\{ key: '[A-Z_]+'/g) ?? []).length, 8, 'UI-004 stage count must be eight');
for (const forbidden of ['function stageOf(', 'FLOW_PRIORITY', 'five exclusive stages']) {
  assert.ok(!dashboard.includes(forbidden) && !flow.includes(forbidden), `UI-004 legacy logic remains: ${forbidden}`);
}

// UI-005 — fail-closed formal drill plus <=3-interaction Shadow cause-to-Order path.
for (const marker of [
  'buildCrossFilterDrillModel',
  'buildCrossFilterDrillPath',
  'NON_DRILLABLE_DATA_SUPPRESSED',
  "state: 'blocked'",
]) {
  assert.ok(drillContract.includes(marker), `UI-005 drill contract marker missing: ${marker}`);
}
assert.match(
  drillContract,
  /const drillable\s*=\s*metric\.availability\s*===\s*'READY'\s*&&\s*drillCapability\s*===\s*'AVAILABLE'/,
  'UI-005 formal drill must require READY availability and AVAILABLE capability',
);
assert.match(
  drillContract,
  /model\.drillCapability\s*!==\s*'AVAILABLE'/,
  'UI-005 drill path must reject unavailable capability',
);
assert.match(
  drillContract,
  /model\.metricAvailability\s*!==\s*'READY'/,
  'UI-005 drill path must reject non-ready metrics',
);
for (const marker of [
  'Metric drill access',
  'Authority metadata only · No KPI values, breakdowns or affected entities are read.',
]) {
  assert.ok(drillAccess.includes(marker), `UI-005 access marker missing: ${marker}`);
}
// 1 select metric/breakdown, 2 Review evidence, 3 Open order.
for (const marker of [
  '<option value="fill_rate">Fill Rate</option>',
  '<option value="substitution_rate">Substitution Rate</option>',
  '<option value="date">Delivery date</option>',
  '<option value="commercial_sku">Commercial SKU</option>',
  'Review evidence',
  'setSelectedBreakdownKey(rows[0]?.dimensionValueKey ?? null)',
  'Open order',
  'shadowEvidenceOrderRoute(entity)',
]) {
  assert.ok(shadowReview.includes(marker), `UI-005 Shadow path missing: ${marker}`);
}
for (const marker of [
  "matched.route.workspace !== 'orders'",
  "matched.route.entityKind !== 'order'",
  "primaryDrawer: `order:${entity.id}`",
  'withWorkspaceQuery(pathname, query)',
]) {
  assert.ok(shadowRoute.includes(marker), `UI-005 Order handoff missing: ${marker}`);
}
assert.ok(
  !workspace.includes('<CrossFilterDrillSurface') && !dashboard.includes('<CrossFilterDrillSurface'),
  'UI-005 formal Drill Surface adopted before server authority',
);

// UI-006 — policy-ranked Priority Work with all six required fields.
for (const heading of ['Order','Cause','Impact','Age','Owner','Next action']) {
  assert.ok(priority.includes(`<th scope="col">${heading}</th>`), `UI-006 column missing: ${heading}`);
}
for (const marker of [
  'repository.readPriorityWork(limit)',
  'POLICY-RANKED · CURRENT EXCEPTIONS',
  'Server policy rank · Unassigned first · Oldest first',
  'priorityWorkOrderRoute(record)',
  'navigate(route.href)',
]) {
  assert.ok(priority.includes(marker), `UI-006 surface marker missing: ${marker}`);
}
for (const marker of [
  "ownerTeam ?? 'Unassigned'",
  "primaryDrawer: `order:${record.orderEntityId}`",
  'withWorkspaceQuery(pathname, query)',
]) {
  assert.ok(priorityRoute.includes(marker), `UI-006 handoff marker missing: ${marker}`);
}
assert.equal((dashboard.match(/<PriorityWork \/>/g) ?? []).length, 1, 'UI-006 Dashboard adoption must be singular');
for (const removed of ['FLOW_PRIORITY','activeOrders','Top {activeOrders.length}','ops-control-order-table','ops-control-order-row']) {
  assert.ok(!dashboard.includes(removed), `UI-006 local newest-order ranking remains: ${removed}`);
}

const phaseRuntime = [dashboard, workspace, queue, lifecycle, shadowReview, priority].join('\n');
for (const forbidden of [
  'MutationObserver','CustomEvent(','dispatchEvent(','localStorage','sessionStorage','document.querySelector',
]) {
  assert.ok(!phaseRuntime.includes(forbidden), `Phase 3 forbidden runtime pattern: ${forbidden}`);
}

console.log('INTEL-GATE-003 Phase 3 Control Room 2.0 completion gate passed.');
