import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ORDERMENTUM_DATABASE_GUARD_BYTES,
  ORDERMENTUM_VERSION_RETENTION,
  buildArchivedVersion,
  shouldArchivePreviousVersion,
} from './ordermentum-master-version-policy.mjs';

test('first-seen resources do not create a history duplicate', () => {
  assert.equal(shouldArchivePreviousVersion(null, 'new-hash'), false);
});

test('unchanged resources do not create a history version', () => {
  assert.equal(shouldArchivePreviousVersion({ payload_hash: 'same-hash' }, 'same-hash'), false);
});

test('a true change archives the previous current state', () => {
  const existing = {
    resource_type: 'product_detail',
    external_id: 'product-1',
    supplier_id: 'supplier-1',
    source_endpoint: '/v1/products/product-1',
    payload: { name: 'Previous name', price: 10 },
    payload_hash: 'old-hash',
    sync_run_id: 'old-run',
  };

  assert.equal(shouldArchivePreviousVersion(existing, 'new-hash'), true);
  assert.deepEqual(buildArchivedVersion(existing, {
    supplierId: 'fallback-supplier',
    sourceEndpoint: '/fallback',
    syncRunId: 'new-run',
  }), {
    resource_type: 'product_detail',
    external_id: 'product-1',
    supplier_id: 'supplier-1',
    source_endpoint: '/v1/products/product-1',
    payload: { name: 'Previous name', price: 10 },
    payload_hash: 'old-hash',
    sync_run_id: 'old-run',
  });
});

test('archived versions use safe fallbacks for legacy current rows', () => {
  assert.deepEqual(buildArchivedVersion({
    resource_type: 'invoice_detail',
    external_id: 'invoice-1',
    payload: { total: 42 },
    payload_hash: 'old-invoice-hash',
  }, {
    supplierId: 'supplier-1',
    sourceEndpoint: '/v2/invoices',
    syncRunId: 'current-run',
  }), {
    resource_type: 'invoice_detail',
    external_id: 'invoice-1',
    supplier_id: 'supplier-1',
    source_endpoint: '/v2/invoices',
    payload: { total: 42 },
    payload_hash: 'old-invoice-hash',
    sync_run_id: 'current-run',
  });
});

test('storage policy stays inside the Free-plan incident headroom', () => {
  assert.deepEqual(ORDERMENTUM_VERSION_RETENTION, {
    maxVersionsPerResource: 3,
    maxAgeDays: 30,
    maxPayloadBytes: 10 * 1024 * 1024,
  });
  assert.equal(ORDERMENTUM_DATABASE_GUARD_BYTES, 475 * 1024 * 1024);
});
