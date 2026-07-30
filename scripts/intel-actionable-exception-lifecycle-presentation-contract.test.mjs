import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actionableExceptionLifecycleAccessLabel,
  actionableExceptionLifecycleActionOptions,
  actionableExceptionLifecycleOwnerLabel,
  actionableExceptionLifecycleStatusLabel,
} from '../src/features/intelligence/attention/actionableExceptionLifecyclePresentationContract.ts';

const actions = [
  'ACKNOWLEDGE','ASSIGN','UNASSIGN','SNOOZE','UNSNOOZE',
  'RESOLVE','REOPEN','ADD_NOTE',
];

function access(overrides = {}) {
  return {
    accessVersion: 1,
    lifecycleCapability: 'AVAILABLE',
    ownershipCapability: 'AVAILABLE',
    actionCapability: 'AVAILABLE',
    historyCapability: 'AVAILABLE',
    commandActions: actions,
    commandIdRequired: true,
    maxReadIds: 300,
    maxReadRows: 300,
    maxHistoryEvents: 50,
    maxSnoozeDays: 30,
    readAt: '2026-07-30T10:00:00Z',
    ...overrides,
  };
}

function lifecycle(overrides = {}) {
  return {
    effectiveStatus: 'OPEN',
    lifecycleStatus: 'OPEN',
    ownerTeam: null,
    snoozeExpired: false,
    capabilities: {
      lifecycle: 'AVAILABLE',
      ownership: 'AVAILABLE',
      action: 'AVAILABLE',
      history: 'AVAILABLE',
    },
    ...overrides,
  };
}

test('Writer can start a lifecycle record only with server-authorised actions', () => {
  const options = actionableExceptionLifecycleActionOptions(access(), null);
  assert.deepEqual(options.map((option) => option.action), [
    'ACKNOWLEDGE','ASSIGN','SNOOZE','RESOLVE','ADD_NOTE',
  ]);
  assert.equal(options.find((option) => option.action === 'ASSIGN')?.fieldKind, 'ownerTeam');
  assert.equal(options.find((option) => option.action === 'SNOOZE')?.fieldKind, 'snoozedUntil');
  assert.equal(options.find((option) => option.action === 'RESOLVE')?.fieldKind, 'resolutionNote');
  assert.equal(options.find((option) => option.action === 'ADD_NOTE')?.fieldKind, 'note');
});

test('Viewer and unknown access never receive lifecycle commit actions', () => {
  assert.deepEqual(actionableExceptionLifecycleActionOptions(access({
    actionCapability: 'READ_ONLY',
    commandActions: [],
  }), null), []);
  assert.deepEqual(actionableExceptionLifecycleActionOptions(access({
    actionCapability: 'UNKNOWN',
    commandActions: [],
  }), null), []);
  assert.equal(actionableExceptionLifecycleAccessLabel(access({
    actionCapability: 'READ_ONLY',
    commandActions: [],
  })), 'LIFECYCLE READ ONLY');
});

test('existing lifecycle row must independently authorise commands', () => {
  assert.deepEqual(actionableExceptionLifecycleActionOptions(access(), lifecycle({
    capabilities: {
      lifecycle: 'AVAILABLE',
      ownership: 'AVAILABLE',
      action: 'READ_ONLY',
      history: 'AVAILABLE',
    },
  })), []);
  assert.deepEqual(actionableExceptionLifecycleActionOptions(access(), lifecycle({
    capabilities: {
      lifecycle: 'AVAILABLE',
      ownership: 'AVAILABLE',
      action: 'UNKNOWN',
      history: 'AVAILABLE',
    },
  })), []);
});

test('server command list remains an upper bound on UI actions', () => {
  const options = actionableExceptionLifecycleActionOptions(access({
    commandActions: ['ACKNOWLEDGE','ADD_NOTE'],
  }), lifecycle());
  assert.deepEqual(options.map((option) => option.action), ['ACKNOWLEDGE','ADD_NOTE']);
});

test('assigned open and acknowledged states expose governed ownership controls', () => {
  const open = actionableExceptionLifecycleActionOptions(access(), lifecycle({ ownerTeam: 'Order Operations' }));
  assert.deepEqual(open.map((option) => option.action), [
    'ACKNOWLEDGE','ASSIGN','UNASSIGN','SNOOZE','RESOLVE','ADD_NOTE',
  ]);

  const acknowledged = actionableExceptionLifecycleActionOptions(access(), lifecycle({
    effectiveStatus: 'ACKNOWLEDGED',
    lifecycleStatus: 'ACKNOWLEDGED',
    ownerTeam: 'Order Operations',
  }));
  assert.deepEqual(acknowledged.map((option) => option.action), [
    'ASSIGN','UNASSIGN','SNOOZE','RESOLVE','ADD_NOTE',
  ]);
});

test('snoozed state can be acknowledged, reassigned, unsnoozed or resolved', () => {
  const options = actionableExceptionLifecycleActionOptions(access(), lifecycle({
    effectiveStatus: 'SNOOZED',
    lifecycleStatus: 'SNOOZED',
    ownerTeam: 'Order Operations',
  }));
  assert.deepEqual(options.map((option) => option.action), [
    'ACKNOWLEDGE','ASSIGN','UNASSIGN','UNSNOOZE','RESOLVE','ADD_NOTE',
  ]);
});

test('resolved state offers only reopen and immutable note actions', () => {
  const options = actionableExceptionLifecycleActionOptions(access(), lifecycle({
    effectiveStatus: 'RESOLVED',
    lifecycleStatus: 'RESOLVED',
    ownerTeam: 'Order Operations',
  }));
  assert.deepEqual(options.map((option) => option.action), ['REOPEN','ADD_NOTE']);
  assert.equal(options[0]?.confirmation.includes('source exception remains active'), true);
});

test('unknown lifecycle state fails closed', () => {
  assert.deepEqual(actionableExceptionLifecycleActionOptions(access(), lifecycle({
    effectiveStatus: 'UNKNOWN',
    lifecycleStatus: 'UNKNOWN',
  })), []);
});

test('lifecycle labels distinguish no row, unavailable read and governed states', () => {
  assert.equal(actionableExceptionLifecycleStatusLabel(null, true), 'Not started');
  assert.equal(actionableExceptionLifecycleStatusLabel(null, false), 'Unavailable');
  assert.equal(actionableExceptionLifecycleStatusLabel(lifecycle({
    effectiveStatus: 'ACKNOWLEDGED',
    lifecycleStatus: 'ACKNOWLEDGED',
  }), true), 'Acknowledged');
  assert.equal(actionableExceptionLifecycleStatusLabel(lifecycle({
    effectiveStatus: 'SNOOZED',
    lifecycleStatus: 'SNOOZED',
    snoozeExpired: true,
  }), true), 'Snooze expired');
  assert.equal(actionableExceptionLifecycleOwnerLabel(null, true), 'Unassigned');
  assert.equal(actionableExceptionLifecycleOwnerLabel(null, false), 'Unavailable');
});
