import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  getOrdermentumAuthMode,
  getOrdermentumBaseUrl,
} from './ordermentum-auth.mjs';
import { ordermentumFetch } from './ordermentum-sync-common.mjs';

const FAKE_KEY = 'test-ordermentum-key-not-a-real-secret';
const FAKE_BEARER = 'legacy-test-bearer-not-real';
const API_ORIGIN = 'https://api.ordermentum.com';
const APP_ORIGIN = 'https://app.ordermentum.com';
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

function readRepo(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

async function withEnv(overrides, work) {
  const previous = new Map();
  for (const [name, value] of Object.entries(overrides)) {
    previous.set(name, Object.prototype.hasOwnProperty.call(process.env, name) ? process.env[name] : undefined);
    if (value === undefined || value === null) delete process.env[name];
    else process.env[name] = String(value);
  }
  try {
    return await work();
  } finally {
    for (const [name, value] of previous.entries()) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

async function withMockFetch(mock, work) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await work();
  } finally {
    globalThis.fetch = original;
  }
}

function expectCode(code) {
  return (error) => error?.code === code;
}

test('secret presence alone cannot switch incumbent operational callers to API-key mode', async () => {
  await withEnv({
    ORDERMENTUM_AUTH_MODE: undefined,
    ORDERMENTUM_API_KEY: FAKE_KEY,
    ORDERMENTUM_BASE_URL: undefined,
    ORDERMENTUM_BEARER_TOKEN: FAKE_BEARER,
    ORDERMENTUM_ACCESS_TOKEN: undefined,
    ORDERMENTUM_API_TOKEN: undefined,
  }, async () => {
    assert.equal(getOrdermentumAuthMode(), 'legacy-bearer');
    assert.equal(getOrdermentumBaseUrl(), APP_ORIGIN);

    const calls = [];
    await withMockFetch(async (url, options) => {
      calls.push({ url: String(url), options });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }, async () => {
      const data = await ordermentumFetch(`${APP_ORIGIN}/v2/orders`, { method: 'GET' });
      assert.deepEqual(data, { ok: true });
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.headers.authorization, `Bearer ${FAKE_BEARER}`);
    assert.equal(calls[0].options.headers['x-api-key'], undefined);
    assert.equal(calls[0].options.redirect, undefined);
  });
});

test('explicit API-key mode rejects an arbitrary base origin before outbound traffic', async () => {
  await withEnv({
    ORDERMENTUM_AUTH_MODE: 'api-key',
    ORDERMENTUM_API_KEY: FAKE_KEY,
    ORDERMENTUM_BASE_URL: 'https://evil.example',
  }, async () => {
    assert.throws(() => getOrdermentumBaseUrl(), expectCode('ORDERMENTUM_API_ORIGIN_BLOCKED'));
  });
});

test('operational sync-common API-key mode blocks off-origin requests before fetch', async () => {
  await withEnv({
    ORDERMENTUM_AUTH_MODE: 'api-key',
    ORDERMENTUM_API_KEY: FAKE_KEY,
    ORDERMENTUM_BASE_URL: API_ORIGIN,
  }, async () => {
    let calls = 0;
    await withMockFetch(async () => {
      calls += 1;
      throw new Error('fetch must not run');
    }, async () => {
      await assert.rejects(
        () => ordermentumFetch('https://evil.example/v2/orders', { method: 'GET' }),
        expectCode('ORDERMENTUM_API_ORIGIN_BLOCKED'),
      );
    });
    assert.equal(calls, 0);
  });
});

test('operational sync-common API-key mode owns credentials and fails closed on redirects', async () => {
  await withEnv({
    ORDERMENTUM_AUTH_MODE: 'api-key',
    ORDERMENTUM_API_KEY: FAKE_KEY,
    ORDERMENTUM_BASE_URL: API_ORIGIN,
  }, async () => {
    const calls = [];
    await withMockFetch(async (url, options) => {
      calls.push({ url: String(url), options });
      return new Response('', {
        status: 302,
        headers: { location: 'https://evil.example/capture' },
      });
    }, async () => {
      await assert.rejects(
        () => ordermentumFetch(`${API_ORIGIN}/v2/orders`, { method: 'GET' }),
        expectCode('ORDERMENTUM_REDIRECT_BLOCKED'),
      );
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.redirect, 'manual');
    assert.equal(calls[0].options.headers['x-api-key'], FAKE_KEY);
    assert.equal(calls[0].options.headers.authorization, undefined);
  });
});

test('operational sync-common rejects caller credential override before fetch', async () => {
  await withEnv({
    ORDERMENTUM_AUTH_MODE: 'api-key',
    ORDERMENTUM_API_KEY: FAKE_KEY,
    ORDERMENTUM_BASE_URL: API_ORIGIN,
  }, async () => {
    let calls = 0;
    await withMockFetch(async () => {
      calls += 1;
      throw new Error('fetch must not run');
    }, async () => {
      await assert.rejects(
        () => ordermentumFetch(`${API_ORIGIN}/v2/orders`, {
          method: 'GET',
          headers: { 'x-api-key': 'caller-owned-key' },
        }),
        expectCode('ORDERMENTUM_CREDENTIAL_HEADER_OVERRIDE_BLOCKED'),
      );
    });
    assert.equal(calls, 0);
  });
});

test('operational sync-common redacts a failed provider response that echoes the API key', async () => {
  await withEnv({
    ORDERMENTUM_AUTH_MODE: 'api-key',
    ORDERMENTUM_API_KEY: FAKE_KEY,
    ORDERMENTUM_BASE_URL: API_ORIGIN,
  }, async () => {
    await withMockFetch(async () => new Response(JSON.stringify({ message: `bad credential ${FAKE_KEY}` }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }), async () => {
      await assert.rejects(
        () => ordermentumFetch(`${API_ORIGIN}/v2/orders`, { method: 'GET' }),
        (error) => {
          assert.equal(String(error.message).includes(FAKE_KEY), false);
          assert.equal(JSON.stringify(error.payload).includes(FAKE_KEY), false);
          assert.equal(String(error.message).includes('[REDACTED]'), true);
          return true;
        },
      );
    });
  });
});

test('master-data caller remains legacy when a future API-key secret is merely present', async () => {
  await withEnv({
    ORDERMENTUM_AUTH_MODE: 'legacy-bearer',
    ORDERMENTUM_API_KEY: FAKE_KEY,
    ORDERMENTUM_BEARER_TOKEN: FAKE_BEARER,
    ORDERMENTUM_API_BASE_URL: API_ORIGIN,
    ORDERMENTUM_FETCH_RETRIES: '0',
  }, async () => {
    const moduleUrl = new URL(`./ordermentum-master-data-common.mjs?legacy=${Date.now()}`, import.meta.url);
    const master = await import(moduleUrl.href);
    assert.equal(await master.getLegacyBearerToken(), FAKE_BEARER);

    const calls = [];
    await withMockFetch(async (url, options) => {
      calls.push({ url: String(url), options });
      return new Response(JSON.stringify({ id: 'fixture' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }, async () => {
      const result = await master.fetchOrdermentumJson(FAKE_BEARER, '/v2/products', {});
      assert.equal(result.ok, true);
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.headers.authorization, `Bearer ${FAKE_BEARER}`);
    assert.equal(calls[0].options.headers['x-api-key'], undefined);
    assert.equal(calls[0].options.redirect, undefined);
  });
});

test('known scheduled, manual, targeted and recovery callers are pinned to the governed boundary', () => {
  const auth = readRepo('scripts/ordermentum-auth.mjs');
  const syncCommon = readRepo('scripts/ordermentum-sync-common.mjs');
  const fullSync = readRepo('scripts/ordermentum-full-sync-core.mjs');
  const masterCommon = readRepo('scripts/ordermentum-master-data-common.mjs');
  const legacyWrapper = readRepo('scripts/ordermentum-sync-now-legacy.mjs');
  const backfill = readRepo('scripts/import-ordermentum-backfill-all.mjs');
  const incremental = readRepo('scripts/import-ordermentum-incremental.mjs');
  const missingInvoices = readRepo('scripts/refresh-ordermentum-missing-invoices.mjs');
  const cloudSync = readRepo('scripts/ordermentum-cloud-sync.mjs');
  const completeMirror = readRepo('scripts/ordermentum-complete-mirror.mjs');
  const targeted = readRepo('scripts/ordermentum-targeted-store-sync.mjs');
  const cloudWorkflow = readRepo('.github/workflows/ordermentum-cloud-sync.yml');
  const mirrorWorkflow = readRepo('.github/workflows/ordermentum-complete-mirror.yml');
  const targetedWorkflow = readRepo('.github/workflows/ordermentum-targeted-store-sync.yml');
  const guardWorkflow = readRepo('.github/workflows/ordermentum-api-origin-guard-check.yml');

  assert.match(auth, /default: 'legacy-bearer'/);
  assert.doesNotMatch(auth, /ORDERMENTUM_API_KEY\s*\?\s*'api-key'/);
  assert.match(syncCommon, /assertOrdermentumApiRequestUrl/);
  assert.match(syncCommon, /redirect:\s*'manual'/);
  assert.match(fullSync, /getOrdermentumAuthMode/);
  assert.match(fullSync, /isOrdermentumApiKeyMode/);
  assert.match(masterCommon, /getOrdermentumAuthMode/);
  assert.match(masterCommon, /isOrdermentumApiKeyMode/);
  assert.match(legacyWrapper, /ORDERMENTUM_AUTH_MODE:\s*'legacy-bearer'/);

  assert.match(backfill, /ordermentumFetch/);
  assert.match(incremental, /import-ordermentum-backfill-all\.mjs/);
  assert.match(missingInvoices, /ordermentumFetch/);
  assert.match(cloudSync, /ordermentum-sync-now-legacy\.mjs/);
  assert.match(cloudSync, /ordermentum-master-data-sync\.mjs/);
  assert.match(completeMirror, /ordermentum-sync-now-legacy\.mjs/);
  assert.match(completeMirror, /ordermentum-master-data-sync\.mjs/);
  assert.match(targeted, /ordermentum-master-data-common\.mjs/);

  for (const workflow of [cloudWorkflow, mirrorWorkflow, targetedWorkflow]) {
    assert.match(workflow, /ORDERMENTUM_AUTH_MODE:\s*legacy-bearer/);
  }

  const guardedPaths = [
    'scripts/ordermentum-auth.mjs',
    'scripts/ordermentum-sync-common.mjs',
    'scripts/ordermentum-full-sync-core.mjs',
    'scripts/ordermentum-master-data-common.mjs',
    'scripts/ordermentum-master-data-sync.mjs',
    'scripts/ordermentum-invoice-detail-sync.mjs',
    'scripts/ordermentum-cloud-sync.mjs',
    'scripts/ordermentum-complete-mirror.mjs',
    'scripts/ordermentum-targeted-store-sync.mjs',
    'scripts/ordermentum-sync-now-legacy.mjs',
    'scripts/import-ordermentum-backfill-all.mjs',
    'scripts/import-ordermentum-incremental.mjs',
    'scripts/refresh-ordermentum-missing-invoices.mjs',
    '.github/workflows/ordermentum-cloud-sync.yml',
    '.github/workflows/ordermentum-complete-mirror.yml',
    '.github/workflows/ordermentum-targeted-store-sync.yml',
  ];
  for (const guardedPath of guardedPaths) {
    assert.equal(guardWorkflow.includes(`'${guardedPath}'`), true, `guard workflow must cover ${guardedPath}`);
  }
});
