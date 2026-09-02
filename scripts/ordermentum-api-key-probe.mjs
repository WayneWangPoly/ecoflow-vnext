import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { getOrdermentumAuthMode, makeOrdermentumUrl } from './ordermentum-auth.mjs';
import { ordermentumFetch } from './ordermentum-sync-common.mjs';

const UUID_RE = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const PROBE_NAME = 'ordermentum-api-key-purchaser';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashCanonicalPayload(payload) {
  return sha256(canonicalJson(payload));
}

export function validateProbePurchaserId(value) {
  const purchaserId = String(value || '').trim();
  if (!UUID_RE.test(purchaserId)) {
    throw new Error('ORDERMENTUM_PROBE_PURCHASER_ID must be a UUID');
  }
  return purchaserId;
}

export function buildPurchaserProbeUrl(purchaserId) {
  const id = validateProbePurchaserId(purchaserId);
  return makeOrdermentumUrl(`/v1/purchasers/${encodeURIComponent(id)}`);
}

export function summarizeProbePayload(payload, purchaserId) {
  const id = validateProbePurchaserId(purchaserId);
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
    throw new Error('Ordermentum purchaser probe returned a non-object payload');
  }
  const returnedId = String(payload.id || '').trim();
  if (returnedId !== id) {
    throw new Error('Ordermentum purchaser probe identity mismatch');
  }
  return {
    probe: PROBE_NAME,
    status: 'accepted',
    auth_mode: 'api-key',
    request_count: 1,
    target_sha256: sha256(id),
    payload_sha256: hashCanonicalPayload(payload),
    top_level_type: 'object',
    top_level_key_count: Object.keys(payload).length,
    identity_match: true,
  };
}

async function fetchProbePayload(fetchJson, url) {
  try {
    return await fetchJson(url);
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : null;
    const wrapped = new Error(`Ordermentum purchaser probe provider request failed${status ? ` status ${status}` : ''}`);
    if (status) wrapped.status = status;
    throw wrapped;
  }
}

export async function runProbe({
  purchaserId = process.env.ORDERMENTUM_PROBE_PURCHASER_ID,
  fetchJson = ordermentumFetch,
} = {}) {
  if (getOrdermentumAuthMode() !== 'api-key') {
    throw new Error('Ordermentum acceptance probe requires ORDERMENTUM_AUTH_MODE=api-key');
  }
  const id = validateProbePurchaserId(purchaserId);
  const url = buildPurchaserProbeUrl(id);
  const payload = await fetchProbePayload(fetchJson, url);
  return summarizeProbePayload(payload, id);
}

function isMainModule() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  runProbe()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`Ordermentum acceptance probe failed: ${String(error?.message || 'blocked')}\n`);
      process.exitCode = 1;
    });
}
