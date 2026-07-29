import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dashboardControlTone,
  dashboardSourceTone,
} from '../src/features/dashboard/dashboardControlContract.ts';

test('Dashboard operational tones map to semantic status tones', () => {
  assert.equal(dashboardControlTone('good'), 'success');
  assert.equal(dashboardControlTone('warn'), 'warning');
  assert.equal(dashboardControlTone('danger'), 'danger');
  assert.equal(dashboardControlTone('neutral'), 'neutral');
});

test('healthy source states resolve to success', () => {
  for (const status of ['HEALTHY', 'SUCCESS', 'READY', ' healthy ']) {
    assert.equal(dashboardSourceTone(status), 'success');
  }
});

test('checking and degraded source states resolve to warning', () => {
  for (const status of ['CHECKING', 'DEGRADED', 'WARNING', ' checking ']) {
    assert.equal(dashboardSourceTone(status), 'warning');
  }
});

test('failed source states resolve to danger and unknown remains neutral', () => {
  for (const status of ['FAILED', 'UNAVAILABLE', 'ERROR']) {
    assert.equal(dashboardSourceTone(status), 'danger');
  }
  assert.equal(dashboardSourceTone('STALE'), 'neutral');
});
