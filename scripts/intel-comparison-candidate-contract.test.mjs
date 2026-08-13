import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const repository = fs.readFileSync('src/data/repositories/comparisonCandidates.ts', 'utf8');

const canonicalKinds = ['CUSTOMER', 'COMMERCIAL_SKU', 'PHYSICAL_SKU', 'DELIVERY_RUN'];

test('comparison candidate repository exposes only canonical governed kinds', () => {
  for (const kind of canonicalKinds) assert.ok(repository.includes(`'${kind}'`), `missing ${kind}`);
  for (const forbidden of ['PRODUCT', 'STORE', 'ORDER', 'METRIC']) {
    assert.ok(!repository.includes(`'${forbidden}'`), `legacy comparison kind remains: ${forbidden}`);
  }
});

test('comparison candidate parser is fail closed on permission and malformed authority', () => {
  assert.ok(repository.includes("permission !== 'ALLOWED'"), 'explicit ALLOWED requirement missing');
  assert.ok(repository.includes('COMPARISON_CANDIDATE_NOT_ALLOWED'), 'permission failure missing');
  assert.ok(repository.includes('COMPARISON_CANDIDATE_INVALID_KIND'), 'kind failure missing');
  assert.ok(repository.includes('COMPARISON_CANDIDATE_INVALID_ID'), 'id failure missing');
  assert.ok(repository.includes('COMPARISON_CANDIDATE_DUPLICATE'), 'duplicate failure missing');
  assert.ok(!repository.includes("permission ?? 'ALLOWED'"), 'fail-open permission default returned');
});

test('comparison candidate browser boundary is RPC-only', () => {
  assert.ok(repository.includes(".rpc('ecoflow_read_comparison_candidates_v1'"), 'governed read RPC missing');
  assert.ok(!repository.includes('.from('), 'direct table read crossed candidate boundary');
  assert.ok(!/\.(?:insert|update|upsert|delete)\s*\(/.test(repository), 'business mutation crossed candidate boundary');
  assert.ok(repository.includes('COMPARISON_QUERY_TOO_LONG'), 'bounded query guard missing');
  assert.ok(repository.includes('Math.min(Math.max(input.limit ?? 20, 1), 100)'), 'bounded result limit missing');
});
