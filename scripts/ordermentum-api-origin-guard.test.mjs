import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ORDERMENTUM_API_ORIGIN,
  assertOrdermentumApiBaseUrl,
  assertOrdermentumApiKeyRequestShape,
  assertOrdermentumApiRequestUrl,
} from './ordermentum-api-origin-guard.mjs';
import {
  config,
  ordermentumFetchJson as fullSyncFetch,
} from './ordermentum-full-sync-core.mjs';

const FAKE_KEY = 'test-ordermentum-key-not-a-real-secret';
const SPECIAL_FAKE_KEY = 'test+/=key?not-real';

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

test('exact Ordermentum API origin accepts only the approved bare HTTPS origin', () => {
  assert.equal(assertOrdermentumApiBaseUrl(ORDERMENTUM_API_ORIGIN), ORDERMENTUM_API_ORIGIN);
  assert.equal(assertOrdermentumApiBaseUrl(`${ORDERMENTUM_API_ORIGIN}/`), ORDERMENTUM_API_ORIGIN);
  assert.equal(
    assertOrdermentumApiRequestUrl(`${ORDERMENTUM_API_ORIGIN}/v2/orders?pageNo=1`),
    `${ORDERMENTUM_API_ORIGIN}/v2/orders?pageNo=1`,
  );

  assert.throws(() => assertOrdermentumApiBaseUrl('http://api.ordermentum.com'), expectCode('ORDERMENTUM_API_ORIGIN_BLOCKED'));
  assert.throws(() => assertOrdermentumApiBaseUrl('https://api.ordermentum.com.evil.example'), expectCode('ORDERMENTUM_API_ORIGIN_BLOCKED'));
  assert.throws(() => assertOrdermentumApiBaseUrl('https://user:pass@api.ordermentum.com'), expectCode('ORDERMENTUM_API_ORIGIN_BLOCKED'));
  assert.throws(() => assertOrdermentumApiBaseUrl('https://api.ordermentum.com/v2'), expectCode('ORDERMENTUM_API_BASE_PATH_BLOCKED'));
  assert.throws(() => assertOrdermentumApiRequestUrl('https://api.ordermentum.com/v2/orders#fragment'), expectCode('ORDERMENTUM_API_URL_FRAGMENT_BLOCKED'));
});

test('API key transport enforces one credential channel and rejects raw or encoded leakage', () => {
  assert.doesNotThrow(() => assertOrdermentumApiKeyRequestShape({
    apiKey: FAKE_KEY,
    requestUrl: `${ORDERMENTUM_API_ORIGIN}/v2/orders?pageNo=1`,
    body: JSON.stringify({ supplierId: 'supplier-1' }),
    callerHeaders: { 'content-type': 'application/json' },
  }));

  assert.throws(() => assertOrdermentumApiKeyRequestShape({
    apiKey: FAKE_KEY,
    requestUrl: `${ORDERMENTUM_API_ORIGIN}/v2/orders?token=${encodeURIComponent(FAKE_KEY)}`,
  }), expectCode('ORDERMENTUM_API_KEY_EXPOSED'));

  assert.throws(() => assertOrdermentumApiKeyRequestShape({
    apiKey: SPECIAL_FAKE_KEY,
    requestUrl: `${ORDERMENTUM_API_ORIGIN}/v2/orders?token=${encodeURIComponent(SPECIAL_FAKE_KEY)}`,
  }), expectCode('ORDERMENTUM_API_KEY_EXPOSED'));

  assert.throws(() => assertOrdermentumApiKeyRequestShape({
    apiKey: SPECIAL_FAKE_KEY,
    requestUrl: `${ORDERMENTUM_API_ORIGIN}/v2/${encodeURIComponent(SPECIAL_FAKE_KEY)}/orders`,
  }), expectCode('ORDERMENTUM_API_KEY_EXPOSED'));

  assert.throws(() => assertOrdermentumApiKeyRequestShape({
    apiKey: FAKE_KEY,
    requestUrl: `${ORDERMENTUM_API_ORIGIN}/v2/orders`,
    body: JSON.stringify({ token: FAKE_KEY }),
  }), expectCode('ORDERMENTUM_API_KEY_EXPOSED'));

  assert.throws(() => assertOrdermentumApiKeyRequestShape({
    apiKey: SPECIAL_FAKE_KEY,
    requestUrl: `${ORDERMENTUM_API_ORIGIN}/v2/orders`,
    body: JSON.stringify({ token: encodeURIComponent(SPECIAL_FAKE_KEY) }),
  }), expectCode('ORDERMENTUM_API_KEY_EXPOSED'));

  assert.throws(() => assertOrdermentumApiKeyRequestShape({
    apiKey: FAKE_KEY,
    requestUrl: `${ORDERMENTUM_API_ORIGIN}/v2/orders`,
    callerHeaders: { authorization: `Bearer ${FAKE_KEY}` },
  }), expectCode('ORDERMENTUM_CREDENTIAL_HEADER_OVERRIDE_BLOCKED'));

  assert.throws(() => assertOrdermentumApiKeyRequestShape({
    apiKey: FAKE_KEY,
    requestUrl: `${ORDERMENTUM_API_ORIGIN}/v2/orders`,
    callerHeaders: { 'x-api-key': FAKE_KEY },
  }), expectCode('ORDERMENTUM_CREDENTIAL_HEADER_OVERRIDE_BLOCKED'));

  assert.throws(() => assertOrdermentumApiKeyRequestShape({
    apiKey: SPECIAL_FAKE_KEY,
    requestUrl: `${ORDERMENTUM_API_ORIGIN}/v2/orders`,
    callerHeaders: { 'x-debug-value': encodeURIComponent(SPECIAL_FAKE_KEY) },
  }), expectCode('ORDERMENTUM_API_KEY_EXPOSED'));

  const headerObject = new Headers({ authorization: `Bearer ${FAKE_KEY}` });
  assert.throws(() => assertOrdermentumApiKeyRequestShape({
    apiKey: FAKE_KEY,
    requestUrl: `${ORDERMENTUM_API_ORIGIN}/v2/orders`,
    callerHeaders: headerObject,
  }), expectCode('ORDERMENTUM_CREDENTIAL_HEADER_OVERRIDE_BLOCKED'));
});

test('full-sync API-key config rejects a non-approved base before outbound traffic', async () => {
  await withEnv({
    ORDERMENTUM_AUTH_MODE: 'api-key',
    ORDERMENTUM_API_KEY: FAKE_KEY,
    ORDERMENTUM_BASE_URL: 'https://evil.example',
    ORDERMENTUM_SKIP_SUPABASE: 'true',
  }, async () => {
    assert.throws(() => config(), expectCode('ORDERMENTUM_API_ORIGIN_BLOCKED'));
  });
});

test('full-sync API-key request blocks off-origin URL before fetch is called', async () => {
  await withEnv({
    ORDERMENTUM_AUTH_MODE: 'api-key',
    ORDERMENTUM_API_KEY: FAKE_KEY,
    ORDERMENTUM_BASE_URL: ORDERMENTUM_API_ORIGIN,
    ORDERMENTUM_SKIP_SUPABASE: 'true',
    ORDERMENTUM_FETCH_RETRIES: '0',
  }, async () => {
    const cfg = config();
    let calls = 0;
    await withMockFetch(async () => {
      calls += 1;
      throw new Error('fetch must not run');
    }, async () => {
      await assert.rejects(
        () => fullSyncFetch(cfg, 'https://evil.example/v2/orders'),
        expectCode('ORDERMENTUM_API_ORIGIN_BLOCKED'),
      );
    });
    assert.equal(calls, 0);
  });
});

test('full-sync API-key request uses x-api-key, manual redirects, and fails closed on 3xx', async () => {
  await withEnv({
    ORDERMENTUM_AUTH_MODE: 'api-key',
    ORDERMENTUM_API_KEY: FAKE_KEY,
    ORDERMENTUM_BASE_URL: ORDERMENTUM_API_ORIGIN,
    ORDERMENTUM_SKIP_SUPABASE: 'true',
    ORDERMENTUM_FETCH_RETRIES: '0',
  }, async () => {
    const cfg = config();
    const calls = [];
    await withMockFetch(async (url, options) => {
      calls.push({ url: String(url), options });
      return new Response('', {
        status: 302,
        headers: { location: 'https://evil.example/capture' },
      });
    }, async () => {
      await assert.rejects(
        () => fullSyncFetch(cfg, `${ORDERMENTUM_API_ORIGIN}/v2/orders`),
        expectCode('ORDERMENTUM_REDIRECT_BLOCKED'),
      );
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${ORDERMENTUM_API_ORIGIN}/v2/orders`);
    assert.equal(calls[0].options.redirect, 'manual');
    assert.equal(calls[0].options.headers['x-api-key'], FAKE_KEY);
    assert.equal(calls[0].options.headers.authorization, undefined);
  });
});

test('full-sync API-key errors redact a provider response that echoes the token', async () => {
  await withEnv({
    ORDERMENTUM_AUTH_MODE: 'api-key',
    ORDERMENTUM_API_KEY: FAKE_KEY,
    ORDERMENTUM_BASE_URL: ORDERMENTUM_API_ORIGIN,
    ORDERMENTUM_SKIP_SUPABASE: 'true',
    ORDERMENTUM_FETCH_RETRIES: '0',
  }, async () => {
    const cfg = config();
    await withMockFetch(async () => new Response(JSON.stringify({ message: `bad credential ${FAKE_KEY}` }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }), async () => {
      await assert.rejects(
        () => fullSyncFetch(cfg, `${ORDERMENTUM_API_ORIGIN}/v2/orders`),
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

test('full-sync API-key errors also redact a percent-encoded token echo', async () => {
  await withEnv({
    ORDERMENTUM_AUTH_MODE: 'api-key',
    ORDERMENTUM_API_KEY: SPECIAL_FAKE_KEY,
    ORDERMENTUM_BASE_URL: ORDERMENTUM_API_ORIGIN,
    ORDERMENTUM_SKIP_SUPABASE: 'true',
    ORDERMENTUM_FETCH_RETRIES: '0',
  }, async () => {
    const cfg = config();
    const encoded = encodeURIComponent(SPECIAL_FAKE_KEY);
    await withMockFetch(async () => new Response(JSON.stringify({ message: `bad credential ${encoded}` }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }), async () => {
      await assert.rejects(
        () => fullSyncFetch(cfg, `${ORDERMENTUM_API_ORIGIN}/v2/orders`),
        (error) => {
          assert.equal(String(error.message).includes(SPECIAL_FAKE_KEY), false);
          assert.equal(String(error.message).includes(encoded), false);
          assert.equal(JSON.stringify(error.payload).includes(encoded), false);
          assert.equal(String(error.message).includes('[REDACTED]'), true);
          return true;
        },
      );
    });
  });
});

test('master-data API-key boundary pins origin and refuses redirects without following them', async () => {
  await withEnv({
    ORDERMENTUM_API_KEY: FAKE_KEY,
    ORDERMENTUM_API_BASE_URL: ORDERMENTUM_API_ORIGIN,
    ORDERMENTUM_FETCH_RETRIES: '0',
  }, async () => {
    const moduleUrl = new URL(`./ordermentum-master-data-common.mjs?guard=${Date.now()}`, import.meta.url);
    const master = await import(moduleUrl.href);
    const calls = [];
    await withMockFetch(async (url, options) => {
      calls.push({ url: String(url), options });
      return new Response('', {
        status: 307,
        headers: { location: 'https://evil.example/capture' },
      });
    }, async () => {
      await assert.rejects(
        () => master.fetchOrdermentumJson(null, '/v2/products', { supplierId: 'supplier-1' }),
        expectCode('ORDERMENTUM_REDIRECT_BLOCKED'),
      );
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.redirect, 'manual');
    assert.equal(calls[0].options.headers['x-api-key'], FAKE_KEY);
    assert.equal(calls[0].options.headers.authorization, undefined);
  });
});

test('master-data API-key boundary rejects an off-origin configured API base before fetch', async () => {
  await withEnv({
    ORDERMENTUM_API_KEY: FAKE_KEY,
    ORDERMENTUM_API_BASE_URL: 'https://evil.example',
    ORDERMENTUM_FETCH_RETRIES: '0',
  }, async () => {
    const moduleUrl = new URL(`./ordermentum-master-data-common.mjs?offorigin=${Date.now()}`, import.meta.url);
    const master = await import(moduleUrl.href);
    let calls = 0;
    await withMockFetch(async () => {
      calls += 1;
      throw new Error('fetch must not run');
    }, async () => {
      assert.throws(
        () => master.buildUrl('/v2/products', {}),
        expectCode('ORDERMENTUM_API_ORIGIN_BLOCKED'),
      );
    });
    assert.equal(calls, 0);
  });
});
