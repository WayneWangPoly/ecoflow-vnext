import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ORDERMENTUM_API_ORIGIN,
  assertOrdermentumApiKeyRequestShape,
  redactOrdermentumSecret,
} from './ordermentum-api-origin-guard.mjs';

const FAKE_KEY = 'test+/=key?not-real';

function expectCode(code) {
  return (error) => error?.code === code;
}

function lowerPercentEscapes(value) {
  return String(value).replace(/%[0-9A-F]{2}/g, (escape) => escape.toLowerCase());
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

test('lower-case percent-encoded token leakage is rejected in inspectable body and caller headers', () => {
  const encoded = lowerPercentEscapes(encodeURIComponent(FAKE_KEY));

  assert.throws(() => assertOrdermentumApiKeyRequestShape({
    apiKey: FAKE_KEY,
    requestUrl: `${ORDERMENTUM_API_ORIGIN}/v2/orders`,
    body: `token=${encoded}`,
  }), expectCode('ORDERMENTUM_API_KEY_EXPOSED'));

  assert.throws(() => assertOrdermentumApiKeyRequestShape({
    apiKey: FAKE_KEY,
    requestUrl: `${ORDERMENTUM_API_ORIGIN}/v2/orders`,
    callerHeaders: { 'x-debug-value': encoded },
  }), expectCode('ORDERMENTUM_API_KEY_EXPOSED'));
});

test('lower-case percent-encoded provider token echoes are redacted', () => {
  const encoded = lowerPercentEscapes(encodeURIComponent(FAKE_KEY));
  const redacted = redactOrdermentumSecret(`bad credential ${encoded}`, FAKE_KEY);

  assert.equal(redacted.includes(encoded), false);
  assert.equal(redacted.includes('[REDACTED]'), true);
});

test('credential header names are normalized before override rejection', () => {
  assert.throws(() => assertOrdermentumApiKeyRequestShape({
    apiKey: FAKE_KEY,
    requestUrl: `${ORDERMENTUM_API_ORIGIN}/v2/orders`,
    callerHeaders: { ' X-API-KEY ': 'anything' },
  }), expectCode('ORDERMENTUM_CREDENTIAL_HEADER_OVERRIDE_BLOCKED'));
});
