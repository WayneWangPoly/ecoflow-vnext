import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildPurchaserProbeUrl,
  hashCanonicalPayload,
  runProbe,
  summarizeProbePayload,
  validateProbePurchaserId,
} from './ordermentum-api-key-probe.mjs';

const purchaserId = '123e4567-e89b-42d3-a456-426614174000';
const otherPurchaserId = '123e4567-e89b-42d3-a456-426614174001';
const uuidV7 = '01890f47-1234-7abc-8def-1234567890ab';
const apiKey = 'om_api_test_secret_%2F?x';
const originalFetch = globalThis.fetch;
const originalEnv = {
  ORDERMENTUM_AUTH_MODE: process.env.ORDERMENTUM_AUTH_MODE,
  ORDERMENTUM_API_KEY: process.env.ORDERMENTUM_API_KEY,
  ORDERMENTUM_BASE_URL: process.env.ORDERMENTUM_BASE_URL,
  ORDERMENTUM_PROBE_PURCHASER_ID: process.env.ORDERMENTUM_PROBE_PURCHASER_ID,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = originalFetch;
}

function useApiKeyMode() {
  process.env.ORDERMENTUM_AUTH_MODE = 'api-key';
  process.env.ORDERMENTUM_API_KEY = apiKey;
  delete process.env.ORDERMENTUM_BASE_URL;
  process.env.ORDERMENTUM_PROBE_PURCHASER_ID = purchaserId;
}

test.afterEach(restoreEnv);

test('canonical payload hash is stable across object key order', () => {
  const left = { id: purchaserId, nested: { z: 2, a: 1 }, list: [{ b: 2, a: 1 }] };
  const right = { list: [{ a: 1, b: 2 }], nested: { a: 1, z: 2 }, id: purchaserId };
  assert.equal(hashCanonicalPayload(left), hashCanonicalPayload(right));
});

test('probe accepts UUID-shaped purchaser identities and official purchaser read URL', () => {
  useApiKeyMode();
  assert.equal(validateProbePurchaserId(purchaserId), purchaserId);
  assert.equal(validateProbePurchaserId(uuidV7), uuidV7);
  assert.equal(buildPurchaserProbeUrl(purchaserId), `https://api.ordermentum.com/v1/purchasers/${purchaserId}`);
  assert.throws(() => validateProbePurchaserId('../orders'), /must be a UUID/);
});

test('secret presence alone cannot activate the probe', async () => {
  process.env.ORDERMENTUM_AUTH_MODE = 'legacy-bearer';
  process.env.ORDERMENTUM_API_KEY = apiKey;
  let calls = 0;
  await assert.rejects(
    () => runProbe({ purchaserId, fetchJson: async () => { calls += 1; return {}; } }),
    /requires ORDERMENTUM_AUTH_MODE=api-key/,
  );
  assert.equal(calls, 0);
});

test('invalid target fails before any provider transport call', async () => {
  useApiKeyMode();
  let calls = 0;
  await assert.rejects(
    () => runProbe({ purchaserId: 'not-a-uuid', fetchJson: async () => { calls += 1; return {}; } }),
    /must be a UUID/,
  );
  assert.equal(calls, 0);
});

test('successful probe performs exactly one guarded GET and emits summary only', async () => {
  useApiKeyMode();
  const providerPayload = {
    id: purchaserId,
    name: 'Private Venue Name',
    retailerAddress: { street1: 'Private Street', postcode: '2000' },
  };
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify(providerPayload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const summary = await runProbe({ purchaserId });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://api.ordermentum.com/v1/purchasers/${purchaserId}`);
  assert.equal(calls[0].options.method, undefined);
  assert.equal(calls[0].options.body, undefined);
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(calls[0].options.headers['x-api-key'], apiKey);
  assert.equal(calls[0].options.headers.authorization, undefined);

  assert.deepEqual(Object.keys(summary).sort(), [
    'auth_mode',
    'identity_match',
    'payload_sha256',
    'probe',
    'request_count',
    'status',
    'target_sha256',
    'top_level_key_count',
    'top_level_type',
  ].sort());
  assert.equal(summary.status, 'accepted');
  assert.equal(summary.auth_mode, 'api-key');
  assert.equal(summary.request_count, 1);
  assert.equal(summary.identity_match, true);
  assert.match(summary.target_sha256, /^[0-9a-f]{64}$/);
  assert.match(summary.payload_sha256, /^[0-9a-f]{64}$/);

  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes(apiKey), false);
  assert.equal(serialized.includes(purchaserId), false);
  assert.equal(serialized.includes('Private Venue Name'), false);
  assert.equal(serialized.includes('Private Street'), false);
});

test('provider identity mismatch cannot be reported as an accepted probe', async () => {
  useApiKeyMode();
  await assert.rejects(
    () => runProbe({ purchaserId, fetchJson: async () => ({ id: otherPurchaserId, name: 'Wrong venue' }) }),
    /identity mismatch/,
  );
});

test('credentialed redirects fail closed with metadata-only probe error', async () => {
  useApiKeyMode();
  const redirectTarget = `https://evil.example/steal?key=${encodeURIComponent(apiKey)}`;
  globalThis.fetch = async () => new Response('', {
    status: 302,
    headers: { location: redirectTarget },
  });
  await assert.rejects(
    () => runProbe({ purchaserId }),
    (error) => {
      const message = String(error?.message || error);
      assert.equal(message, 'Ordermentum purchaser probe provider request failed');
      assert.equal(message.includes(apiKey), false);
      assert.equal(message.includes('evil.example'), false);
      assert.equal(message.includes(redirectTarget), false);
      return true;
    },
  );
});

test('provider error payload and key echo never escape the probe boundary', async () => {
  useApiKeyMode();
  const privateProviderMessage = `invalid token ${apiKey} for Private Venue Name`;
  globalThis.fetch = async () => new Response(JSON.stringify({ message: privateProviderMessage }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });
  await assert.rejects(
    () => runProbe({ purchaserId }),
    (error) => {
      const message = String(error?.message || error);
      assert.equal(message, 'Ordermentum purchaser probe provider request failed status 401');
      assert.equal(error.status, 401);
      assert.equal(message.includes(apiKey), false);
      assert.equal(message.includes('Private Venue Name'), false);
      assert.equal(message.includes('invalid token'), false);
      return true;
    },
  );
});

test('probe module contains no business-write or Supabase execution path', () => {
  const source = readFileSync(new URL('./ordermentum-api-key-probe.mjs', import.meta.url), 'utf8');
  assert.equal(/supabase/i.test(source), false);
  assert.equal(/\b(POST|PUT|PATCH|DELETE)\b/.test(source), false);
  assert.equal(/createSyncBatch|upsertRaw|finishSyncBatch|createApiJob|finishApiJob/.test(source), false);
});

test('summary helper rejects non-object provider payloads', () => {
  assert.throws(() => summarizeProbePayload([], purchaserId), /non-object payload/);
  assert.throws(() => summarizeProbePayload(null, purchaserId), /non-object payload/);
});
