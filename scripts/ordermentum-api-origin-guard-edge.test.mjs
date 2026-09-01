import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ORDERMENTUM_API_ORIGIN,
  assertOrdermentumApiKeyRequestShape,
} from './ordermentum-api-origin-guard.mjs';

const FAKE_KEY = 'test+/=key?not-real';

function expectCode(code) {
  return (error) => error?.code === code;
}

test('credentialed body must be inspectable before fetch', () => {
  assert.throws(() => assertOrdermentumApiKeyRequestShape({
    apiKey: FAKE_KEY,
    requestUrl: `${ORDERMENTUM_API_ORIGIN}/v2/orders`,
    body: new Uint8Array([1, 2, 3]),
  }), expectCode('ORDERMENTUM_API_BODY_UNINSPECTABLE'));
});

test('URLSearchParams body is inspectable and encoded token leakage is rejected', () => {
  const body = new URLSearchParams({ token: FAKE_KEY });
  assert.throws(() => assertOrdermentumApiKeyRequestShape({
    apiKey: FAKE_KEY,
    requestUrl: `${ORDERMENTUM_API_ORIGIN}/v2/orders`,
    body,
  }), expectCode('ORDERMENTUM_API_KEY_EXPOSED'));
});

test('credential header names are normalized before override rejection', () => {
  assert.throws(() => assertOrdermentumApiKeyRequestShape({
    apiKey: FAKE_KEY,
    requestUrl: `${ORDERMENTUM_API_ORIGIN}/v2/orders`,
    callerHeaders: { ' X-API-KEY ': 'anything' },
  }), expectCode('ORDERMENTUM_CREDENTIAL_HEADER_OVERRIDE_BLOCKED'));
});
