import test from 'node:test';
import assert from 'node:assert/strict';
import { parseComparisonCandidateRows } from '../src/data/repositories/comparisonCandidates.ts';

test('comparison candidates accept only explicit server ALLOWED rows', () => {
  const rows = parseComparisonCandidateRows([{
    candidate_kind: 'COMMERCIAL_SKU',
    entity_id: '99000000-0000-4000-8000-000000000001',
    label: 'CUP-12W · 12oz cup',
    context: { identityStatus: 'READY' },
    permission: 'ALLOWED',
    read_at: '2026-08-13T09:00:00Z',
  }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'COMMERCIAL_SKU');
  assert.equal(rows[0].permission, 'ALLOWED');
});

test('comparison candidates fail closed when permission is absent, denied or unknown', () => {
  const base = {
    candidate_kind: 'CUSTOMER',
    entity_id: '99000000-0000-4000-8000-000000000002',
    label: 'Test customer',
    context: {},
    read_at: '2026-08-13T09:00:00Z',
  };
  for (const permission of [undefined, 'DENIED', 'FORBIDDEN', 'UNKNOWN']) {
    assert.throws(() => parseComparisonCandidateRows([{ ...base, ...(permission === undefined ? {} : { permission }) }]), /NOT_ALLOWED/);
  }
});

test('comparison candidates keep commercial and physical identities distinct', () => {
  const rows = parseComparisonCandidateRows([
    { candidate_kind: 'COMMERCIAL_SKU', entity_id: '99000000-0000-4000-8000-000000000003', label: 'Commercial', context: {}, permission: 'ALLOWED', read_at: '2026-08-13T09:00:00Z' },
    { candidate_kind: 'PHYSICAL_SKU', entity_id: '99000000-0000-4000-8000-000000000003', label: 'Physical', context: {}, permission: 'ALLOWED', read_at: '2026-08-13T09:00:00Z' },
  ]);
  assert.equal(rows.length, 2);
  assert.notEqual(`${rows[0].kind}:${rows[0].entityId}`, `${rows[1].kind}:${rows[1].entityId}`);
});

test('comparison candidates reject arbitrary kinds and malformed IDs', () => {
  const row = { entity_id: 'free form id!', label: 'Bad', context: {}, permission: 'ALLOWED', read_at: '2026-08-13T09:00:00Z' };
  assert.throws(() => parseComparisonCandidateRows([{ ...row, candidate_kind: 'ORDER' }]), /INVALID_KIND/);
  assert.throws(() => parseComparisonCandidateRows([{ ...row, candidate_kind: 'CUSTOMER' }]), /INVALID_ID/);
});
