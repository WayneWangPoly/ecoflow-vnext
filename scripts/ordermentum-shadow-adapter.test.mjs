import assert from 'node:assert/strict';
import test from 'node:test';
import { loadManifest, validateManifest, sha256 } from './ordermentum-shadow-manifest.mjs';
import { buildListUrl, canonicalProjection, comparePair, replayTwice, selectDetailTarget, boundedJsonFetch, executeWindow } from './ordermentum-shadow-adapter.mjs';

const UUIDS = {
  orders: '10000000-0000-4000-8000-000000000001', products: '20000000-0000-4000-8000-000000000001', variants: '30000000-0000-4000-8000-000000000001', purchasers: '40000000-0000-4000-8000-000000000001', price_groups: '50000000-0000-4000-8000-000000000001', invoices: '60000000-0000-4000-8000-000000000001', stock_locations: '70000000-0000-4000-8000-000000000001', leads: '80000000-0000-4000-8000-000000000001',
};
const response = (payload, status = 200, headers = {}) => ({ ok: status >= 200 && status < 300, status, redirected: false, headers: { get: (name) => headers[name.toLowerCase()] || null }, text: async () => JSON.stringify(payload) });

test('request plan preserves incumbent inclusive upper bound and price groups omit invented supplier filter', () => {
  const manifest = validateManifest(loadManifest()).manifest; const window = manifest.windows[0];
  assert.equal(manifest.window_semantics, 'inclusive_gte_lte');
  const products = buildListUrl(manifest, manifest.resources[1], window, 'supplier-a', 1);
  assert.match(products, /^https:\/\/api\.ordermentum\.com\/v2\/products\?/); assert.match(products, /supplierId=supplier-a/);
  const priceGroups = buildListUrl(manifest, manifest.resources[4], window, 'supplier-a', 1);
  assert.doesNotMatch(priceGroups, /supplierId/);
  const orders = new URL(buildListUrl(manifest, manifest.resources[0], window, 'supplier-a', 2));
  assert.equal(orders.searchParams.get('updatedAt[gte]'), window.from);
  assert.equal(orders.searchParams.get('updatedAt[lte]'), window.to);
  assert.equal(orders.searchParams.get('pageNo'), '2');
});

test('pair comparison requires real stable identity and replay is idempotent', () => {
  const payload = { data: [{ id: UUIDS.orders, orderNumber: 'SO-1', updatedAt: '2026-09-07T05:00:00Z' }] };
  const pair = comparePair('orders', payload, structuredClone(payload));
  assert.equal(pair.evidence.equal, true);
  assert.deepEqual(replayTwice('orders', pair.currentItems), { passes: 2, records: 1, semantic_duplicates: 0, replay_sha256: replayTwice('orders', pair.currentItems).replay_sha256 });
  assert.throws(() => comparePair('orders', payload, { data: [{ ...payload.data[0], orderNumber: 'drift' }] }), /variance/);
  assert.throws(() => comparePair('products', { data: [{ name: 'no-id' }] }, { data: [{ name: 'no-id' }] }), /without stable identity/);
});

test('invoice detail evidence uses incumbent writer hash/timestamp primitives including summary fallback', () => {
  const summary = { id: UUIDS.invoices, updatedAt: '2026-09-07T05:00:00Z' };
  const detail = { id: UUIDS.invoices, invoiceDate: '2026-09-06T01:02:03Z', total: 42 };
  const projection = canonicalProjection('invoice_detail', detail, { summaryPayload: summary });
  assert.equal(projection.external_id, UUIDS.invoices);
  assert.match(projection.payload_hash, /^[0-9a-f]{64}$/);
  assert.equal(projection.remote_created_at, '2026-09-06T01:02:03.000Z');
  assert.equal(projection.remote_updated_at, '2026-09-07T05:00:00.000Z');
});

test('detail selection excludes the already-probed B1 target', () => {
  const resource = { name: 'products', detail_path: '/v1/products/{id}' };
  const items = [{ id: UUIDS.products }, { id: UUIDS.variants }];
  assert.equal(selectDetailTarget(resource, items, items, sha256(UUIDS.products)), UUIDS.variants);
});

test('bounded transport blocks redirects and byte overflow', async () => {
  await assert.rejects(() => boundedJsonFetch({ url: 'https://api.ordermentum.com/v1/purchasers', headers: {}, timeoutMs: 10, maxBytes: 10, fetchImpl: async () => response({}, 302) }), /redirect/i);
  await assert.rejects(() => boundedJsonFetch({ url: 'https://api.ordermentum.com/v1/purchasers', headers: {}, timeoutMs: 10, maxBytes: 2, fetchImpl: async () => response({ big: true }) }), /cap/i);
});

test('pagination cap and provider interruption preserve attempted-request evidence without retry', async () => {
  const manifest = validateManifest(loadManifest()).manifest;
  let calls = 0;
  const ten = Array.from({ length: 10 }, (_, index) => ({ id: `order-${index}`, orderNumber: `SO-${index}` }));
  let paginationError;
  try {
    await executeWindow({ manifest, windowId: 'W0', supplierId: 'supplier-a', currentApiKey: 'current-key', legacyBearer: 'legacy-token', fetchImpl: async () => { calls += 1; return response({ data: ten }); } });
  } catch (error) { paginationError = error; }
  assert.match(paginationError?.message || '', /partial after page cap/);
  assert.equal(calls, 4);
  assert.equal(paginationError.progress.current_get, 2);
  assert.equal(paginationError.progress.legacy_get, 2);
  assert.equal(paginationError.progress.retries, 0);

  calls = 0;
  let interruption;
  try {
    await executeWindow({ manifest, windowId: 'W0', supplierId: 'supplier-a', currentApiKey: 'current-key', legacyBearer: 'legacy-token', fetchImpl: async () => { calls += 1; throw new Error('offline interruption'); } });
  } catch (error) { interruption = error; }
  assert.match(interruption?.message || '', /offline interruption/);
  assert.equal(calls, 2);
  assert.equal(interruption.progress.current_get, 1);
  assert.equal(interruption.progress.legacy_get, 1);
  assert.equal(interruption.progress.rows, 0);
});

test('aggregate byte budget can stop before any GET dispatch', async () => {
  const manifest = validateManifest(loadManifest()).manifest;
  let calls = 0;
  let error;
  try {
    await executeWindow({
      manifest,
      windowId: 'W0',
      supplierId: 'supplier-a',
      currentApiKey: 'current-key',
      legacyBearer: 'legacy-token',
      initialCounts: { decoded_bytes: manifest.limits.max_decoded_bytes_per_window - 1 },
      fetchImpl: async () => { calls += 1; return response({ data: [] }); },
    });
  } catch (caught) { error = caught; }
  assert.match(error?.message || '', /byte budget exhausted before dispatch/i);
  assert.equal(calls, 0);
  assert.equal(error.progress.decoded_bytes, manifest.limits.max_decoded_bytes_per_window - 1);
});

test('oversized provider page fails closed before rows are admitted', async () => {
  const manifest = validateManifest(loadManifest()).manifest;
  let calls = 0;
  const eleven = Array.from({ length: 11 }, (_, index) => ({ id: `order-${index}`, orderNumber: `SO-${index}` }));
  let error;
  try {
    await executeWindow({ manifest, windowId: 'W0', supplierId: 'supplier-a', currentApiKey: 'current-key', legacyBearer: 'legacy-token', fetchImpl: async () => { calls += 1; return response({ data: eleven }); } });
  } catch (caught) { error = caught; }
  assert.match(error?.message || '', /page-size row bound/);
  assert.equal(calls, 2);
  assert.equal(error.progress.rows, 0);
  assert.equal(error.progress.current_get, 1);
  assert.equal(error.progress.legacy_get, 1);
});

test('offline full window covers all resources with paired auth and zero writes', async () => {
  const manifest = validateManifest(loadManifest()).manifest;
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, headers: options.headers, method: options.method, redirect: options.redirect });
    const path = new URL(url).pathname;
    const detail = !manifest.resources.some((resource) => resource.list_path === path);
    if (detail) return response({ id: Object.values(UUIDS).find((id) => path.endsWith(id)), name: 'same' });
    const resource = manifest.resources.find((candidate) => candidate.list_path === path);
    return response({ data: [{ id: UUIDS[resource.name], name: 'same', orderNumber: 'SO-1', updatedAt: '2026-09-07T05:00:00Z' }] });
  };
  const result = await executeWindow({ manifest, windowId: 'W0', supplierId: 'supplier-a', currentApiKey: 'current-key', legacyBearer: 'legacy-token', fetchImpl });
  assert.equal(result.status, 'PASS'); assert.equal(result.request_counts.business_writes, 0); assert.equal(result.request_counts.current_get, 11); assert.equal(result.request_counts.legacy_get, 11);
  assert.equal(calls.length, 22); assert.ok(calls.every((call) => call.method === 'GET' && call.redirect === 'manual'));
  assert.equal(calls.filter((call) => call.headers['x-api-key']).length, 11); assert.equal(calls.filter((call) => call.headers.authorization).length, 11);
});
