import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cutoverAssessment,
  intelligenceDeliveryMode,
  intelligenceReleaseCheckKeys,
  intelligenceReleaseFlagKeys,
  intelligenceReleaseSummary,
  normaliseIntelligenceReleaseRows,
  parallelReadAssessment,
  rollbackAssessment,
  validateReleaseFlagCommand,
  validateReleaseVerificationCommand,
} from '../src/features/intelligence/analytics/releaseReadiness/releaseReadinessContract.ts';

function rowsFor({ status = 'UNAVAILABLE', rolloutState = 'SHADOW', recorded = false } = {}) {
  return intelligenceReleaseFlagKeys.flatMap((flagKey) => intelligenceReleaseCheckKeys.map((checkKey, index) => ({
    flag_key: flagKey,
    rollout_state: rolloutState,
    flag_version: 1,
    flag_reason: 'Parallel verification remains in progress.',
    flag_updated_at: '2026-07-31T06:00:00.000Z',
    check_key: checkKey,
    check_order: index + 1,
    check_name: checkKey.replaceAll('_', ' '),
    requirement: `Governed requirement for ${checkKey}`,
    check_status: status,
    observed_value: recorded ? 'observed' : null,
    expected_value: recorded ? 'expected' : null,
    note: recorded ? 'Evidence recorded.' : null,
    source_as_of: recorded ? '2026-07-31T05:55:00.000Z' : null,
    check_version: recorded ? 1 : null,
    check_updated_at: recorded ? '2026-07-31T06:00:00.000Z' : null,
    can_manage: true,
    read_at: '2026-07-31T06:05:00.000Z',
  })));
}

test('normalises five flags crossed with ten explicit checks', () => {
  const result = normaliseIntelligenceReleaseRows(rowsFor());
  assert.equal(result.state, 'ready');
  assert.equal(result.issues.length, 0);
  assert.equal(result.flags.length, 5);
  assert.ok(result.flags.every((flag) => flag.checks.length === 10));
  assert.ok(result.flags.every((flag) => flag.deliveryMode === 'LEGACY_PRIMARY_SHADOW_READ'));
  assert.ok(result.flags.every((flag) => flag.checks.every((check) => check.evidenceState === 'MISSING')));
});

test('missing verification stays unavailable and never becomes numeric zero', () => {
  const result = normaliseIntelligenceReleaseRows(rowsFor());
  const check = result.flags[0].checks[0];
  assert.equal(check.status, 'UNAVAILABLE');
  assert.equal(check.observedValue, null);
  assert.equal(check.expectedValue, null);
  assert.notEqual(check.observedValue, 0);
});

test('cutover is eligible only from shadow with every check passing', () => {
  const result = normaliseIntelligenceReleaseRows(rowsFor({ status: 'PASS', recorded: true }));
  const flag = result.flags[0];
  assert.deepEqual(cutoverAssessment(flag), { state: 'ELIGIBLE', blockers: [] });
  assert.equal(parallelReadAssessment(flag).state, 'EXPLAINED');

  const blockedRows = rowsFor({ status: 'PASS', recorded: true });
  blockedRows.find((row) => row.flag_key === flag.key && row.check_key === 'NO_SILENT_ZERO').check_status = 'BLOCKED';
  const blocked = normaliseIntelligenceReleaseRows(blockedRows).flags[0];
  assert.equal(cutoverAssessment(blocked).state, 'BLOCKED');
  assert.deepEqual(cutoverAssessment(blocked).blockers, ['NO_SILENT_ZERO']);
});

test('active rollout requires verified rollback evidence for ready status', () => {
  const rows = rowsFor({ status: 'PASS', rolloutState: 'ON', recorded: true });
  const flag = normaliseIntelligenceReleaseRows(rows).flags[0];
  assert.equal(cutoverAssessment(flag).state, 'ACTIVE');
  assert.equal(rollbackAssessment(flag).state, 'READY');

  rows.find((row) => row.flag_key === flag.key && row.check_key === 'ROLLBACK_VERIFIED').check_status = 'UNAVAILABLE';
  const blocked = normaliseIntelligenceReleaseRows(rows).flags[0];
  assert.equal(rollbackAssessment(blocked).state, 'BLOCKED');
  assert.equal(rollbackAssessment(blocked).preservesAnalyticsHistory, true);
});

test('rollout state resolves to a deterministic delivery mode', () => {
  assert.equal(intelligenceDeliveryMode('OFF'), 'LEGACY_ONLY');
  assert.equal(intelligenceDeliveryMode('SHADOW'), 'LEGACY_PRIMARY_SHADOW_READ');
  assert.equal(intelligenceDeliveryMode('ON'), 'INTELLIGENCE_PRIMARY');
});

test('release summary counts flags and checks without fabricating pass state', () => {
  const result = normaliseIntelligenceReleaseRows(rowsFor());
  const summary = intelligenceReleaseSummary(result.flags);
  assert.deepEqual(summary, {
    totalFlags: 5,
    off: 0,
    shadow: 5,
    on: 0,
    totalChecks: 50,
    passedChecks: 0,
    blockedChecks: 0,
    unavailableChecks: 50,
    cutoverEligible: 0,
  });
});

test('flag commands require UUID, version, date and bounded reason', () => {
  assert.deepEqual(validateReleaseFlagCommand({
    commandId: '11111111-1111-4111-8111-111111111111',
    flagKey: 'control_room_v2',
    businessDate: '2026-07-31',
    expectedVersion: 1,
    nextState: 'ON',
    reason: 'All governed cutover evidence passed.',
  }), []);
  assert.ok(validateReleaseFlagCommand({
    commandId: 'bad',
    flagKey: 'control_room_v2',
    businessDate: '31/07/2026',
    expectedVersion: 0,
    nextState: 'ON',
    reason: 'short',
  }).length >= 4);
});

test('non-pass verification commands require an explanatory note', () => {
  assert.deepEqual(validateReleaseVerificationCommand({
    commandId: '22222222-2222-4222-8222-222222222222',
    flagKey: 'analytics_inventory_v1',
    businessDate: '2026-07-31',
    checkKey: 'PARALLEL_READ_EXPLAINED',
    status: 'FAIL',
    note: 'Legacy and Intelligence totals differ because one source refresh is stale.',
    sourceAsOf: '2026-07-31T05:55:00.000Z',
  }), []);
  assert.ok(validateReleaseVerificationCommand({
    commandId: '22222222-2222-4222-8222-222222222222',
    flagKey: 'analytics_inventory_v1',
    businessDate: '2026-07-31',
    checkKey: 'PARALLEL_READ_EXPLAINED',
    status: 'BLOCKED',
  }).includes('NON_PASS_NOTE_REQUIRED'));
});

test('invalid duplicate and incomplete evidence is surfaced as partial', () => {
  const rows = rowsFor();
  rows.push({ ...rows[0] });
  rows.pop();
  rows.splice(1, 1);
  const result = normaliseIntelligenceReleaseRows(rows);
  assert.equal(result.state, 'partial');
  assert.ok(result.issues.some((issue) => issue.code === 'INCOMPLETE_CHECK_COVERAGE'));
});
