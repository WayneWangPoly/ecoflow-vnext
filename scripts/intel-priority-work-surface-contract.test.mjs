import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const aliasLoader = `
import { pathToFileURL } from 'node:url';
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    return {
      url: pathToFileURL(\`${process.cwd()}/src/\${specifier.slice(2)}\`).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(aliasLoader)}`, import.meta.url);

const {
  formatPriorityWorkAge,
  formatPriorityWorkMoment,
  priorityWorkLifecycleLabel,
  priorityWorkOrderRoute,
  priorityWorkOwnerLabel,
  priorityWorkSummary,
} = await import('../src/features/intelligence/attention/priorityWorkPresentationContract.ts');

function work(overrides = {}) {
  return {
    priorityItemId: 'ORDERMENTUM_ACTIVE:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    exceptionId: 'ORDERMENTUM_ACTIVE:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    policyKey: 'invoice_detail_missing',
    priorityRank: 40,
    priorityCapability: 'POLICY_GOVERNED',
    orderEntityId: 'PW-1',
    orderDisplayLabel: 'OMO-001',
    invoiceDisplayLabel: 'INV-001',
    causeTitle: 'Invoice detail missing',
    causeDetail: 'Invoice detail missing for the mirrored order header.',
    impactStatement: 'EcoFlow cannot verify the Order from mirrored invoice or line detail.',
    detectedAt: '2026-07-30T00:00:00Z',
    ageSeconds: 86400,
    ownerTeam: null,
    lifecycleStatus: 'OPEN',
    nextAction: 'Open the Order and verify the mirrored invoice or line detail.',
    sourceStatus: 'OPEN',
    readAt: '2026-07-31T00:00:00Z',
    ...overrides,
  };
}

test('Priority Work summary preserves server work metadata without local scoring', () => {
  const summary = priorityWorkSummary([
    work(),
    work({
      priorityItemId: 'ORDERMENTUM_ACTIVE:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      exceptionId: 'ORDERMENTUM_ACTIVE:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      policyKey: 'second_policy',
      orderEntityId: 'PW-2',
      ageSeconds: 172800,
      ownerTeam: 'Operations',
    }),
  ]);
  assert.deepEqual(summary, {
    total: 2,
    unassigned: 1,
    policyCount: 2,
    oldestAgeSeconds: 172800,
    readAt: '2026-07-31T00:00:00Z',
  });
  assert.equal('score' in summary, false);
  assert.equal('amount' in summary, false);
  assert.equal('pod' in summary, false);
});

test('Priority Work age formatting uses server age seconds', () => {
  assert.equal(formatPriorityWorkAge(20), '<1 min');
  assert.equal(formatPriorityWorkAge(180), '3 min');
  assert.equal(formatPriorityWorkAge(7200), '2 hr');
  assert.equal(formatPriorityWorkAge(172800), '2 d');
  assert.equal(formatPriorityWorkAge(-1), 'Unknown');
});

test('Priority Work owner and lifecycle labels remain explicit', () => {
  assert.equal(priorityWorkOwnerLabel(null), 'Unassigned');
  assert.equal(priorityWorkOwnerLabel('Operations'), 'Operations');
  assert.equal(priorityWorkLifecycleLabel('OPEN'), 'Open');
  assert.equal(priorityWorkLifecycleLabel('ACKNOWLEDGED'), 'Acknowledged');
  assert.equal(priorityWorkLifecycleLabel('SNOOZED'), 'Snooze elapsed');
});

test('Priority Work Order route opens canonical Orders drawer', () => {
  const route = priorityWorkOrderRoute(work());
  assert.equal(route?.workspace, 'orders');
  assert.equal(route?.pathname, '/orders/PW-1');
  assert.equal(route?.query.selected, 'PW-1');
  assert.equal(route?.query.primaryDrawer, 'order:PW-1');
  assert.match(route?.href ?? '', /^\/orders\/PW-1\?/);
});

test('unsafe Priority Work Order identity has no route', () => {
  assert.equal(priorityWorkOrderRoute(work({ orderEntityId: 'unsafe/order' })), null);
  assert.equal(priorityWorkOrderRoute(work({ orderEntityId: '' })), null);
});

test('Priority Work moments use Adelaide time and reject invalid values', () => {
  assert.match(formatPriorityWorkMoment('2026-07-31T00:00:00Z'), /2026/);
  assert.equal(formatPriorityWorkMoment(null), 'Not available');
  assert.equal(formatPriorityWorkMoment('not-a-date'), 'Invalid timestamp');
});
