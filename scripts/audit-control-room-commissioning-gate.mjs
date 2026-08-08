import assert from 'node:assert/strict';
import fs from 'node:fs';

// Commissioning is a server-authoritative global operating mode; this audit
// prevents UI cleanup from weakening release, data-quality or failure gates.
const flow = fs.readFileSync('src/features/intelligence/operationalFlow/operationalFlowContract.ts', 'utf8');
const flowIndex = fs.readFileSync('src/features/intelligence/operationalFlow/index.ts', 'utf8');
const dashboard = fs.readFileSync('src/features/dashboard/DashboardPage.tsx', 'utf8');

assert.ok(
  flow.includes('inventoryQuantityCommissioned?: boolean')
    && flow.includes('COMMISSIONING_DEFERRED_GATES')
    && flow.includes("'BLOCKED_MAPPING'")
    && flow.includes("'BLOCKED_STOCK'"),
  'Operational flow must carry explicit pre-INITIAL-stocktake commissioning context.',
);

assert.ok(
  flow.includes('export function isOperationalFlowCommissioningDeferred(')
    && flow.includes("status === 'CANCELLED' || status === 'FAILED' || EXECUTION_STAGE_BY_STATUS[status]")
    && flow.includes("gate.kind === 'known' && COMMISSIONING_DEFERRED_GATES.has(gate.value)")
    && flow.includes('const commissioningDeferred = isOperationalFlowCommissioningDeferred(input, context);'),
  'Commissioning deferral must have one governed classifier that excludes failed, cancelled and execution work.',
);

assert.ok(
  flowIndex.includes('isOperationalFlowCommissioningDeferred')
    && dashboard.includes('isOperationalFlowCommissioningDeferred(order, commissioningContext)')
    && !dashboard.includes('releaseGateStatus ==='),
  'Control Room summaries must consume the governed classifier instead of duplicating release-gate rules.',
);

assert.ok(
  flow.includes("status === 'MAPPING_EXCEPTION' && commissioningDeferred")
    && flow.includes("stage: 'NEW'"),
  'Pre-commission mapping/stock dependencies must stay loaded without becoming order-level action items.',
);

assert.ok(
  flow.includes("'BLOCKED_DATA'") && flow.includes("return { kind: 'classified', orderId, stage: 'NEEDS_ACTION', issues }"),
  'Real data blockers must remain order-level Needs Action.',
);

assert.ok(
  dashboard.includes('buildOperationalFlow(orders, {')
    && dashboard.includes('inventoryQuantityCommissioned: readiness ? inventoryQuantityCommissioned : undefined')
    && dashboard.includes('buildOperationalFlow(todayOrders, {'),
  'Control Room current and Today flows must use server-authoritative inventory commissioning state.',
);

assert.ok(
  dashboard.includes('Warehouse commissioning required')
    && dashboard.includes('not separate action items')
    && dashboard.includes('Release remains closed until commissioning is complete.')
    && dashboard.includes('data-operating-mode={readiness ? (inventoryQuantityCommissioned ? \'live\' : \'commissioning\') : \'unknown\'}'),
  'Control Room must expose one explicit global commissioning gate without implying release is open.',
);

assert.ok(
  dashboard.includes('todayCommissioningDeferred')
    && dashboard.includes('await warehouse commissioning')
    && dashboard.includes("firstStocktakeNeeded && stage.key === 'NEW' ? 'Loaded' : stage.label")
    && dashboard.includes("? `${flow.classifiedCount} LOADED`"),
  'Commissioning orders must be presented as loaded/awaiting commissioning instead of inflated Needs Action work.',
);

assert.ok(
  dashboard.includes("serverExceptions + (firstStocktakeNeeded ? 1 : 0)")
    && dashboard.includes('Global gates'),
  'Pre-close must count warehouse commissioning once, not once per blocked order.',
);

assert.ok(
  !dashboard.includes('buildOperationalFlow(orders), [orders]')
    && !dashboard.includes('buildOperationalFlow(todayOrders), [todayOrders]'),
  'Control Room must not regress to context-free flow classification.',
);

console.log('Control Room global commissioning-gate contract passed.');