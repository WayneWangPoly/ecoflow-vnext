import assert from 'node:assert/strict';
import fs from 'node:fs';

const files = {
  dashboard: 'src/features/dashboard/DashboardPage.tsx',
  workspace: 'src/features/intelligence/analytics/OperationalPulseReadinessWorkspace.tsx',
  pulse: 'src/features/intelligence/operationalPulse/operationalPulseContract.ts',
  queue: 'src/features/intelligence/attention/ActionableExceptionQueue.tsx',
  lifecycle: 'src/features/intelligence/attention/ExceptionLifecycleCommitModal.tsx',
  flow: 'src/features/intelligence/operationalFlow/operationalFlowContract.ts',
  drillContract: 'src/features/intelligence/crossFilter/crossFilterDrillContract.ts',
  drillSurface: 'src/features/intelligence/crossFilter/CrossFilterDrillSurface.tsx',
  drillAccess: 'src/features/intelligence/crossFilter/MetricDrillAccessStatus.tsx',
  shadowReview: 'src/features/intelligence/crossFilter/ShadowDrillEvidenceReview.tsx',
  shadowRoute: 'src/features/intelligence/crossFilter/shadowDrillEvidencePresentationContract.ts',
  priority: 'src/features/intelligence/attention/PriorityWork.tsx',
  priorityRoute: 'src/features/intelligence/attention/priorityWorkPresentationContract.ts',
  package: 'package.json',
};

for (const path of Object.values(files)) {
  assert.ok(fs.existsSync(path), `Phase 3 gate prerequisite missing: ${path}`);
}

const source = Object.fromEntries(
  Object.entries(files).map(([key, path]) => [key, fs.readFileSync(path, 'utf8')]),
);
const packageJson = JSON.parse(source.package);
const frontendAudit = packageJson.scripts?.['audit:intel-frontend'];
assert.equal(typeof frontendAudit, 'string', 'Phase 3 gate requires audit:intel-frontend');

const phasePackages = [
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
];
for (const packageName of phasePackages) {
  assert.ok(frontendAudit.includes(packageName), `Phase 3 package not enforced: ${packageName}`);
}

// UI-001: one desktop control shell and typed navigation remain the entry boundary.
for (const marker of [
  'ops-control-room',
  'Review orders',
  'Operational flow',
  "onOpenTab(stage.tab)",
]) {
  assert.ok(source.dashboard.includes(marker), `UI-001 shell/control marker missing: ${marker}`);
}

// UI-002: the canonical ten metrics are represented, with governed non-ready states.
const metricKeys = [
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
];
for (const metricKey of metricKeys) {
  assert.ok(source.pulse.includes(`'${metricKey}'`), `UI-002 canonical metric missing: ${metricKey}`);
}
assert.equal(
  (source.pulse.match(/^\s*'[a-z_]+',?$/gm) ?? []).filter((line) => metricKeys.includes(line.trim().replace(/[',]/g, ''))).length,
  10,
  'UI-002 canonical metric set must contain ten governed keys',
);
for (const marker of [
  '<OperationalPulseDeck deck={deck}',
  '<MetricDrillAccessStatus />',
  '<ShadowDrillEvidenceReview />',
]) {
  assert.ok(source.workspace.includes(marker), `UI-002 governed workspace marker missing: ${marker}`);
}

// UI-003: current exceptions, governed lifecycle, commit modal and Order handoff.
for (const marker of [
  'repository.readActionableExceptions()',
  'lifecycleRepository.readLifecycle(',
  'lifecycleAccessRepository.readAccess()',
  'ExceptionLifecycleCommitModal',
  'relatedRecords: orderId ? [{',
]) {
  assert.ok(source.queue.includes(marker), `UI-003 exception marker missing: ${marker}`);
}
for (const marker of [
  'role="dialog"',
  'aria-modal="true"',
  'globalThis.crypto?.randomUUID?.()',
  'await onCommit({',
]) {
  assert.ok(source.lifecycle.includes(marker), `UI-003 lifecycle commit marker missing: ${marker}`);
}

// UI-004: exactly eight mutually exclusive operational stages, including Staged.
const stageKeys = [
  'NEW',
  'NEEDS_ACTION',
  'FINANCE_REVIEW',
  'READY',
  'WAREHOUSE',
  'STAGED',
  'ROUTE',
  'DELIVERED',
];
for (const stage of stageKeys) {
  assert.ok(source.flow.includes(`key: '${stage}'`), `UI-004 stage missing: ${stage}`);
}
assert.equal(
  (source.flow.match(/\{ key: '[A-Z_]+'/g) ?? []).length,
  8,
  'UI-004 must expose exactly eight mutually exclusive stages',
);
for (const forbidden of ['function stageOf(', 'STAGED\') return \'WAREHOUSE', 'five exclusive stages']) {
  assert.ok(!source.dashboard.includes(forbidden) && !source.flow.includes(forbidden), `UI-004 legacy stage logic remains: ${forbidden}`);
}

// UI-005: governed drill chain and explicit blocked authority.
for (const marker of [
  'buildCrossFilterDrillModel',
  'buildCrossFilterDrillPath',
  "availability !== 'READY'",
  "drillCapability !== 'AVAILABLE'",
]) {
  assert.ok(source.drillContract.includes(marker), `UI-005 drill contract marker missing: ${marker}`);
}
for (const marker of [
  'Metric drill access',
  'Authority metadata only · No KPI values, breakdowns or affected entities are read.',
]) {
  assert.ok(source.drillAccess.includes(marker), `UI-005 access-state marker missing: ${marker}`);
}

// Maximum interaction budget for the supported Shadow chain:
// 1 select metric/breakdown, 2 submit Review evidence, 3 Open order.
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
  assert.ok(source.shadowReview.includes(marker), `UI-005 three-step Shadow path missing: ${marker}`);
}
for (const marker of [
  "matched.route.workspace !== 'orders'",
  "matched.route.entityKind !== 'order'",
  "primaryDrawer: `order:${entity.id}`",
  'withWorkspaceQuery(pathname, query)',
]) {
  assert.ok(source.shadowRoute.includes(marker), `UI-005 verified Order handoff missing: ${marker}`);
}
assert.ok(
  !source.workspace.includes('<CrossFilterDrillSurface')
    && !source.dashboard.includes('<CrossFilterDrillSurface'),
  'UI-005 formal Drill Surface must not be adopted while access remains unavailable',
);

// UI-006: server-ranked Priority Work with the six required work fields.
for (const heading of ['Order', 'Cause', 'Impact', 'Age', 'Owner', 'Next action']) {
  assert.ok(source.priority.includes(`<th scope="col">${heading}</th>`), `UI-006 required column missing: ${heading}`);
}
for (const marker of [
  'repository.readPriorityWork(limit)',
  'POLICY-RANKED · CURRENT EXCEPTIONS',
  'Server policy rank · Unassigned first · Oldest first',
  'priorityWorkOrderRoute(record)',
  'navigate(route.href)',
]) {
  assert.ok(source.priority.includes(marker), `UI-006 governed surface marker missing: ${marker}`);
}
for (const marker of [
  "ownerTeam ?? 'Unassigned'",
  "primaryDrawer: `order:${record.orderEntityId}`",
  'withWorkspaceQuery(pathname, query)',
]) {
  assert.ok(source.priorityRoute.includes(marker), `UI-006 presentation/handoff marker missing: ${marker}`);
}
assert.equal((source.dashboard.match(/<PriorityWork \/>/g) ?? []).length, 1, 'UI-006 Dashboard adoption must be singular');
for (const removed of [
  'FLOW_PRIORITY',
  'activeOrders',
  'Top {activeOrders.length}',
  'ops-control-order-table',
  'ops-control-order-row',
]) {
  assert.ok(!source.dashboard.includes(removed), `UI-006 local newest-order ranking remains: ${removed}`);
}

// Whole-phase safety: no DOM event bridge or browser persistence in Control Room features.
const phaseRuntime = [
  source.dashboard,
  source.workspace,
  source.queue,
  source.lifecycle,
  source.drillSurface,
  source.shadowReview,
  source.priority,
].join('\n');
for (const forbidden of [
  'MutationObserver',
  'CustomEvent(',
  'dispatchEvent(',
  'localStorage',
  'sessionStorage',
  'document.querySelector',
]) {
  assert.ok(!phaseRuntime.includes(forbidden), `Phase 3 forbidden runtime pattern: ${forbidden}`);
}

assert.ok(
  frontendAudit.includes('audit-intel-phase-3-control-room-gate.mjs'),
  'Phase 3 completion gate is not wired to audit:intel-frontend',
);

console.log('INTEL-GATE-003 Phase 3 Control Room 2.0 completion gate passed.');
