import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyPayloadRows,
  fetchUnleashedWithRetry,
  normalizeTarget,
  serializeUnleashedQuery,
  selectTargetItems,
  sourceIdentityForItem,
} from '../supabase/functions/trigger-unleashed-readonly-sync/core.ts';

const productGuid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

test('target normalization produces only approved exact request shapes', () => {
  assert.deepEqual(normalizeTarget(['products'], { guid: productGuid.toUpperCase() }), {
    resource: 'products',
    pathIdentifier: null,
    query: { productId: productGuid },
    exactMatches: [{ keys: ['Guid', 'guid', 'ProductGuid'], value: productGuid }],
    audit: { guid: productGuid },
  });
  assert.deepEqual(normalizeTarget(['stock_on_hand'], { productId: productGuid, warehouseCode: 'MAIN' })?.query, {
    productId: productGuid,
    warehouseCode: 'MAIN',
  });
  assert.deepEqual(normalizeTarget(['sales_orders_open'], { orderNumber: 'SO-1001' })?.query, {
    orderNumber: 'SO-1001',
  });
  assert.throws(() => normalizeTarget(['products', 'stock_on_hand'], { guid: productGuid }), /TARGET_REQUIRES_ONE_RESOURCE/);
  assert.throws(() => normalizeTarget(['products'], { endpoint: 'Anything' }), /INVALID_TARGET_FIELDS/);
  assert.throws(() => normalizeTarget(['warehouses'], { guid: productGuid }), /TARGET_NOT_SUPPORTED_FOR_RESOURCE/);
});

test('Unleashed query serialization preserves documented comma-separated filters', () => {
  const query = new URLSearchParams();
  query.append('orderStatus', 'Parked,Placed,Backordered');
  query.append('pageSize', '1');

  assert.equal(
    serializeUnleashedQuery(query),
    'orderStatus=Parked,Placed,Backordered&pageSize=1',
  );
});

test('target selection rejects missing and ambiguous API responses', () => {
  const target = normalizeTarget(['products'], { productCode: 'SKU-10' });
  assert.deepEqual(selectTargetItems([{ ProductCode: 'sku-10' }, { ProductCode: 'SKU-11' }], target), [{ ProductCode: 'sku-10' }]);
  assert.throws(() => selectTargetItems([{ ProductCode: 'SKU-11' }], target), /UNLEASHED_TARGET_NOT_FOUND/);
  assert.throws(() => selectTargetItems([{ ProductCode: 'SKU-10' }, { ProductCode: 'sku-10' }], target), /UNLEASHED_TARGET_AMBIGUOUS/);
});

test('payload classification separates inserts, changes, and unchanged replay', () => {
  const result = classifyPayloadRows(
    [
      { external_key: 'a', payload_sha256: 'same' },
      { external_key: 'b', payload_sha256: 'old' },
    ],
    [
      { external_key: 'a', payload_sha256: 'same', marker: 1 },
      { external_key: 'b', payload_sha256: 'new', marker: 2 },
      { external_key: 'c', payload_sha256: 'first', marker: 3 },
    ],
  );
  assert.deepEqual(result.unchanged.map((row) => row.external_key), ['a']);
  assert.deepEqual(result.changed.map((row) => row.external_key), ['b']);
  assert.deepEqual(result.inserted.map((row) => row.external_key), ['c']);
});

test('stock source identity includes warehouse identity', () => {
  const main = sourceIdentityForItem('stock_on_hand', {
    ProductGuid: productGuid,
    ProductCode: 'SKU-10',
    WarehouseId: '11111111-2222-4333-8444-555555555555',
    WarehouseCode: 'MAIN',
  }, 'hash-a');
  const overflow = sourceIdentityForItem('stock_on_hand', {
    ProductGuid: productGuid,
    ProductCode: 'SKU-10',
    WarehouseId: '66666666-7777-4888-8999-aaaaaaaaaaaa',
    WarehouseCode: 'OVERFLOW',
  }, 'hash-b');
  assert.notEqual(main.externalKey, overflow.externalKey);
  assert.match(main.externalKey, new RegExp(`^product:${productGuid}:warehouse:`));
  assert.equal(main.guid, productGuid);
});

test('GET retry succeeds after transient statuses and honors the three-attempt bound', async () => {
  const statuses = [503, 429, 200];
  const methods = [];
  const delays = [];
  const result = await fetchUnleashedWithRetry(
    new URL('https://api.example.test/Products/1?pageSize=1'),
    { Accept: 'application/json' },
    {
      fetcher: async (_url, init) => {
        methods.push(init?.method);
        const status = statuses.shift();
        return new Response('{}', {
          status,
          headers: status === 429 ? { 'Retry-After': '9' } : undefined,
        });
      },
      sleep: async (delayMs) => { delays.push(delayMs); },
    },
  );
  assert.equal(result.response.status, 200);
  assert.equal(result.attempts, 3);
  assert.deepEqual(methods, ['GET', 'GET', 'GET']);
  assert.deepEqual(delays, [250, 2_000]);
});

test('GET retry does not retry non-transient responses and exhausts network failures', async () => {
  let nonTransientCalls = 0;
  const nonTransient = await fetchUnleashedWithRetry(
    new URL('https://api.example.test/Products/1?pageSize=1'),
    {},
    {
      fetcher: async () => {
        nonTransientCalls += 1;
        return new Response('{}', { status: 400 });
      },
      sleep: async () => {},
    },
  );
  assert.equal(nonTransient.response.status, 400);
  assert.equal(nonTransientCalls, 1);

  let networkCalls = 0;
  const delays = [];
  await assert.rejects(
    fetchUnleashedWithRetry(
      new URL('https://api.example.test/Products/1?pageSize=1'),
      {},
      {
        fetcher: async () => {
          networkCalls += 1;
          throw new Error('offline');
        },
        sleep: async (delayMs) => { delays.push(delayMs); },
      },
    ),
    /UNLEASHED_API_RETRY_EXHAUSTED:offline/,
  );
  assert.equal(networkCalls, 3);
  assert.deepEqual(delays, [250, 500]);
});
