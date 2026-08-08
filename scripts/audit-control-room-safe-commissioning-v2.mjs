import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync('src/features/dashboard/DashboardPage.tsx', 'utf8');
const adapter = fs.readFileSync('src/features/dashboard/controlRoomCommissioningView.ts', 'utf8');
const routes = fs.readFileSync('src/features/operationalRoutes/UnifiedOperationalRoutes.tsx', 'utf8');
const boundary = fs.readFileSync('src/features/navigation/WorkspaceRuntimeBoundary.tsx', 'utf8');
const canonical = fs.readFileSync('src/features/intelligence/operationalFlow/operationalFlowContract.ts', 'utf8');

assert.ok(
  dashboard.includes('buildOperationalFlow(orders)')
    && dashboard.includes('buildOperationalFlow(todayOrders)')
    && !dashboard.includes('buildOperationalFlow(orders, {')
    && !dashboard.includes('buildOperationalFlow(todayOrders, {'),
  'Canonical Operational Flow calls must remain context-free in Control Room.',
);

assert.ok(
  adapter.includes("assignment.stage !== 'NEEDS_ACTION'")
    && adapter.includes("'BLOCKED_MAPPING'")
    && adapter.includes("'BLOCKED_STOCK'")
    && adapter.includes("order.status === 'FAILED'")
    && adapter.includes("stage: 'NEW' as const"),
  'Presentation adapter must only defer mapping/stock Needs Action rows and keep failures actionable.',
);

assert.ok(
  adapter.includes('inventoryQuantityCommissioned !== false')
    && dashboard.includes('Warehouse commissioning required')
    && dashboard.includes('Release remains closed until commissioning is complete.'),
  'Commissioning projection must require explicit server authority and remain visibly fail-closed.',
);

assert.ok(
  !canonical.includes('inventoryQuantityCommissioned?: boolean')
    && !canonical.includes('COMMISSIONING_DEFERRED_GATES')
    && !canonical.includes('isOperationalFlowCommissioningDeferred'),
  'Commissioning presentation must not alter the canonical Operational Flow classifier.',
);

assert.ok(
  routes.includes('WorkspaceRuntimeBoundary')
    && routes.includes('<WorkspaceRuntimeBoundary workspace={workspace}>')
    && boundary.includes('getDerivedStateFromError')
    && boundary.includes('componentDidCatch'),
  'Unified operational workspaces must isolate render failures from the application shell.',
);

assert.ok(
  dashboard.includes('serverExceptions + (firstStocktakeNeeded ? 1 : 0)')
    && dashboard.includes('Global gates')
    && dashboard.includes('commissioningView.deferredCount'),
  'Commissioning must count once as a global gate while preserving deferred workload visibility.',
);

console.log('Control Room safe commissioning v2 audit passed.');
