import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTrustedLiveSnapshot } from '../src/domain/trustedLiveSnapshot.ts';

test('accepts a fresh live candidate and records its sequence', () => {
  const candidate = Object.freeze({ orders: ['live-order'] });
  const result = resolveTrustedLiveSnapshot(null, candidate, 17);

  assert.equal(result.source, 'fresh');
  assert.equal(result.snapshot?.data, candidate);
  assert.equal(result.snapshot?.acceptedSequence, 17);
});

test('retains only the last trusted live snapshot when refresh is unavailable', () => {
  const current = Object.freeze({
    data: Object.freeze({ orders: ['last-trusted-live-order'] }),
    acceptedSequence: 11,
  });
  const result = resolveTrustedLiveSnapshot(current, null, 18);

  assert.equal(result.source, 'last-trusted');
  assert.equal(result.snapshot, current);
  assert.equal(result.snapshot?.acceptedSequence, 11);
});

test('fails closed when neither fresh nor previously trusted live data exists', () => {
  const result = resolveTrustedLiveSnapshot(null, undefined, 19);

  assert.equal(result.source, 'unavailable');
  assert.equal(result.snapshot, null);
});

test('does not reject valid falsey live values', () => {
  const zero = resolveTrustedLiveSnapshot(null, 0, 20);
  const empty = resolveTrustedLiveSnapshot(null, '', 21);

  assert.equal(zero.source, 'fresh');
  assert.equal(zero.snapshot?.data, 0);
  assert.equal(empty.source, 'fresh');
  assert.equal(empty.snapshot?.data, '');
});
