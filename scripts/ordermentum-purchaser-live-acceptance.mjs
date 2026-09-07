import { pathToFileURL } from 'node:url';
import { runProbe, validateProbePurchaserId } from './ordermentum-api-key-probe.mjs';
import { ordermentumFetch } from './ordermentum-sync-common.mjs';
import { comparePurchaserPayloads } from './ordermentum-purchaser-equivalence.mjs';

const API_ORIGIN = 'https://api.ordermentum.com';
const LEGACY_AUTH = 'https://app.ordermentum.com/v1/auth';
const SHA = /^[0-9a-f]{40}$/;
const TIMEOUT_MS = 20000;
function requireCondition(condition) { if (!condition) throw new Error('blocked'); }

// This is a read-only acceptance adapter, never a canonical ingestion path.
// The legacy request shape matches targeted-store-sync's master-data helper,
// but intentionally omits its optional retries and unredacted errors.
async function legacyJson(url, options) {
  const response = await fetch(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
  requireCondition(response.ok && !response.redirected);
  return response.json();
}

export async function runAcceptance() {
  const startedAt = new Date().toISOString();
  const counts = { current_get: 0, legacy_auth_post: 0, legacy_get: 0 };
  let stage = 'preflight';
  let probe;
  let equivalence;
  let candidate;
  let status = 'HOLD';
  try {
    const e = process.env;
    requireCondition(e.GITHUB_EVENT_NAME === 'workflow_dispatch' && e.GITHUB_REF === 'refs/heads/main' && e.GITHUB_RUN_ATTEMPT === '1');
    requireCondition(SHA.test(e.GITHUB_SHA || '') && e.ORDERMENTUM_ACCEPTANCE_SHA === e.GITHUB_SHA);
    candidate = e.GITHUB_SHA;
    requireCondition(e.ORDERMENTUM_ACCEPTANCE_CONFIRM === 'ONE_CURRENT_GET_ONE_LEGACY_GET');
    requireCondition(e.ORDERMENTUM_AUTH_MODE === 'api-key' && e.ORDERMENTUM_BASE_URL === API_ORIGIN);
    requireCondition(Boolean(e.ORDERMENTUM_API_KEY?.trim()) && Boolean(e.ORDERMENTUM_USERNAME?.trim()) && Boolean(e.ORDERMENTUM_PASSWORD?.trim()));
    const purchaserId = validateProbePurchaserId(e.ORDERMENTUM_PROBE_PURCHASER_ID);
    let currentPayload;
    stage = 'current_get';
    probe = await runProbe({ purchaserId, fetchJson: async (url) => {
      counts.current_get += 1;
      currentPayload = await ordermentumFetch(url, { method: 'GET', signal: AbortSignal.timeout(TIMEOUT_MS) });
      return currentPayload;
    } });
    stage = 'legacy_auth';
    counts.legacy_auth_post += 1;
    const auth = await legacyJson(LEGACY_AUTH, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: e.ORDERMENTUM_USERNAME, password: e.ORDERMENTUM_PASSWORD }),
    });
    const token = auth?.access_token || auth?.accessToken || auth?.token;
    requireCondition(typeof token === 'string' && Boolean(token.trim()));
    stage = 'legacy_get';
    counts.legacy_get += 1;
    const legacyPayload = await legacyJson(`${API_ORIGIN}/v1/purchasers/${encodeURIComponent(purchaserId)}`, {
      method: 'GET', headers: { accept: 'application/json', authorization: `Bearer ${token}` },
    });
    stage = 'equivalence';
    equivalence = comparePurchaserPayloads({ targetId: purchaserId, legacyPayload, currentPayload });
    if (equivalence.payload_equal) status = 'PASS';
  } catch {
    // Never emit provider bodies, raw parser/network messages, targets or secrets.
    status = 'HOLD';
  }
  return {
    evidence: 'ordermentum-bounded-purchaser-live-acceptance', status, stage,
    ...(candidate ? { candidate_sha: candidate } : {}),
    started_at: startedAt, completed_at: new Date().toISOString(),
    request_counts: counts, business_writes: 0,
    ...(probe ? { probe } : {}), ...(equivalence ? { equivalence } : {}),
    legacy_retirement: 'HOLD',
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const evidence = await runAcceptance();
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
  if (evidence.status !== 'PASS') process.exitCode = 1;
}
