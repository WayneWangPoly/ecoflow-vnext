import assert from 'node:assert/strict';
import test from 'node:test';
import { runShadow } from './ordermentum-shadow-runner.mjs';
import { loadManifest, manifestDigest, sha256 } from './ordermentum-shadow-manifest.mjs';

const UUIDS = {
  orders: '10000000-0000-4000-8000-000000000001', products: '20000000-0000-4000-8000-000000000001', variants: '30000000-0000-4000-8000-000000000001', purchasers: '40000000-0000-4000-8000-000000000001', price_groups: '50000000-0000-4000-8000-000000000001', invoices: '60000000-0000-4000-8000-000000000001', stock_locations: '70000000-0000-4000-8000-000000000001', leads: '80000000-0000-4000-8000-000000000001',
};
const response = (payload, status = 200) => ({ ok: status >= 200 && status < 300, status, redirected: false, headers: { get: () => null }, text: async () => JSON.stringify(payload) });

function validEnv(manifest, candidate = 'a'.repeat(40)) {
  return {
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_SHA: candidate,
    ORDERMENTUM_C_EXPECTED_SHA: candidate,
    ORDERMENTUM_C_CURRENT_MAIN_SHA: candidate,
    ORDERMENTUM_C_MANIFEST_SHA256: manifestDigest(manifest),
    ORDERMENTUM_C_WINDOW: 'W0',
    ORDERMENTUM_C_CONFIRM: 'READ_ONLY_SHADOW_NO_WRITES',
    ORDERMENTUM_C_SHADOW_SUPPLIER_SHA256: sha256('supplier-a'),
    ORDERMENTUM_SUPPLIER_ID: 'supplier-a',
    ORDERMENTUM_API_KEY: 'current-key',
    ORDERMENTUM_USERNAME: 'user',
    ORDERMENTUM_PASSWORD: 'password',
  };
}

test('runner fails before traffic outside the exact main first-attempt contract', async () => {
  let calls = 0;
  const result = await runShadow({ env: {}, fetchImpl: async () => { calls += 1; throw new Error('must not run'); } });
  assert.equal(result.status, 'HOLD'); assert.equal(result.stage, 'preflight'); assert.equal(result.business_writes, 0); assert.equal(calls, 0);
  assert.equal(result.request_counts.current_get, 0); assert.equal(result.request_counts.legacy_get, 0); assert.equal(result.request_counts.legacy_auth_posts, 0);
});

test('runner rejects Supabase credential injection before provider traffic', async () => {
  const manifest = loadManifest(); let calls = 0;
  const env = { ...validEnv(manifest), SUPABASE_URL: 'forbidden' };
  const result = await runShadow({ env, fetchImpl: async () => { calls += 1; } });
  assert.equal(result.status, 'HOLD'); assert.equal(result.stage, 'preflight'); assert.equal(calls, 0);
  assert.equal(result.request_counts.legacy_auth_posts, 0);
});

test('legacy auth failure records the attempted auth post and no GET', async () => {
  const manifest = loadManifest(); let calls = 0;
  const result = await runShadow({ env: validEnv(manifest), fetchImpl: async () => { calls += 1; return response({ error: 'denied' }, 401); } });
  assert.equal(result.status, 'HOLD'); assert.equal(result.stage, 'legacy_auth'); assert.equal(result.failure_category, 'AUTH');
  assert.equal(calls, 1); assert.equal(result.request_counts.legacy_auth_posts, 1); assert.equal(result.request_counts.current_get, 0); assert.equal(result.request_counts.legacy_get, 0);
});

test('runner performs one auth plus the bounded paired fixture window and counts auth bytes', async () => {
  const manifest = loadManifest(); let authPosts = 0; let gets = 0;
  const fetchImpl = async (url, options) => {
    if (options.method === 'POST') { authPosts += 1; return response({ access_token: 'legacy-token' }, 201); }
    gets += 1; const path = new URL(url).pathname;
    const resource = manifest.resources.find((candidateResource) => candidateResource.list_path === path);
    if (resource) return response({ data: [{ id: UUIDS[resource.name], name: 'same', orderNumber: 'SO-1', updatedAt: '2026-09-07T05:00:00Z' }] });
    return response({ id: Object.values(UUIDS).find((id) => path.endsWith(id)), name: 'same' });
  };
  const result = await runShadow({ env: validEnv(manifest), fetchImpl });
  assert.equal(result.status, 'PASS'); assert.equal(authPosts, 1); assert.equal(gets, 22); assert.equal(result.request_counts.business_writes, 0); assert.equal(result.legacy_retirement, 'HOLD');
  assert.equal(result.request_counts.legacy_auth_posts, 1); assert.equal(result.request_counts.current_get, 11); assert.equal(result.request_counts.legacy_get, 11); assert.ok(result.request_counts.decoded_bytes > 0);
});

test('malformed legacy auth preserves decoded-byte evidence', async () => {
  const manifest = loadManifest();
  const bad = 'not-json';
  const result = await runShadow({
    env: validEnv(manifest),
    fetchImpl: async () => ({ ok: true, status: 201, redirected: false, headers: { get: () => null }, text: async () => bad }),
  });
  assert.equal(result.status, 'HOLD'); assert.equal(result.stage, 'legacy_auth');
  assert.equal(result.request_counts.legacy_auth_posts, 1);
  assert.equal(result.request_counts.decoded_bytes, Buffer.byteLength(bad, 'utf8'));
});
