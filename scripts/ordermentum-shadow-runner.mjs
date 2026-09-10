import { pathToFileURL } from 'node:url';
import { loadManifest, validateManifest, assertSupplierBinding, assertExternalBinding } from './ordermentum-shadow-manifest.mjs';
import { executeWindow, classifyFailure, readResponseTextBounded } from './ordermentum-shadow-adapter.mjs';

const SHA = /^[0-9a-f]{40}$/;
function requireValue(value) { if (!String(value || '').trim()) throw new Error('Required bounded input is absent.'); return String(value).trim(); }

async function legacyAuth(env, fetchImpl, { timeoutMs, maxBytes }) {
  const response = await fetchImpl('https://app.ordermentum.com/v1/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: env.ORDERMENTUM_USERNAME, password: env.ORDERMENTUM_PASSWORD }), redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
  if (response.status >= 300 && response.status <= 399) { const error = new Error('Legacy authentication redirect blocked.'); error.code = 'ORDERMENTUM_REDIRECT_BLOCKED'; throw error; }
  if (!response.ok) { const error = new Error('Legacy authentication rejected.'); error.status = response.status; throw error; }
  const { text, bytes } = await readResponseTextBounded(response, maxBytes);
  try {
    const payload = JSON.parse(text);
    return { bearer: requireValue(payload?.access_token || payload?.accessToken || payload?.token), bytes };
  } catch (error) {
    if (error && typeof error === 'object') error.decoded_bytes = bytes;
    throw error;
  }
}

export async function runShadow({ env = process.env, fetchImpl = fetch } = {}) {
  let stage = 'preflight';
  const startedAt = new Date().toISOString();
  const progress = { legacy_auth_posts: 0, current_get: 0, legacy_get: 0, decoded_bytes: 0, rows: 0, business_writes: 0, retries: 0, redirects: 0 };
  try {
    if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_REF !== 'refs/heads/main' || env.GITHUB_RUN_ATTEMPT !== '1') throw new Error('Main-only first-attempt workflow required.');
    if (!SHA.test(env.GITHUB_SHA || '')) throw new Error('Invalid checkout SHA.');
    if (env.ORDERMENTUM_C_CONFIRM !== 'READ_ONLY_SHADOW_NO_WRITES') throw new Error('Explicit read-only confirmation required.');
    if (env.SUPABASE_URL || env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase credentials are forbidden.');
    const manifest = loadManifest(env.ORDERMENTUM_C_MANIFEST_PATH);
    const validated = validateManifest(manifest);
    assertExternalBinding(manifest, { candidateSha: env.ORDERMENTUM_C_EXPECTED_SHA, checkoutSha: env.GITHUB_SHA, currentMainSha: env.ORDERMENTUM_C_CURRENT_MAIN_SHA, reviewedManifestDigest: env.ORDERMENTUM_C_MANIFEST_SHA256 });
    const supplierId = requireValue(env.ORDERMENTUM_SUPPLIER_ID);
    assertSupplierBinding(manifest, supplierId, env.ORDERMENTUM_C_SHADOW_SUPPLIER_SHA256);
    const currentApiKey = requireValue(env.ORDERMENTUM_API_KEY);
    const username = requireValue(env.ORDERMENTUM_USERNAME); const password = requireValue(env.ORDERMENTUM_PASSWORD);
    const deadlineEpochMs = Date.now() + manifest.limits.window_timeout_ms;
    stage = 'legacy_auth';
    progress.legacy_auth_posts = 1;
    const authRemaining = deadlineEpochMs - Date.now();
    if (authRemaining <= 0) { const error = new Error('Window runtime cap exceeded before legacy auth.'); error.code = 'ORDERMENTUM_C_WINDOW_CAP'; error.progress = { ...progress }; throw error; }
    const auth = await legacyAuth(
      { ORDERMENTUM_USERNAME: username, ORDERMENTUM_PASSWORD: password },
      fetchImpl,
      {
        timeoutMs: Math.max(1, Math.min(manifest.limits.request_timeout_ms, authRemaining)),
        maxBytes: Math.min(manifest.limits.max_response_bytes, manifest.limits.max_decoded_bytes_per_window - progress.decoded_bytes),
      },
    );
    progress.decoded_bytes += auth.bytes;
    stage = 'paired_reads';
    const result = await executeWindow({ manifest, windowId: env.ORDERMENTUM_C_WINDOW, supplierId, currentApiKey, legacyBearer: auth.bearer, fetchImpl, initialCounts: progress, deadlineEpochMs });
    return { evidence: 'ordermentum-359-c-shadow-equivalence', status: 'PASS', stage: 'complete', candidate_sha: env.GITHUB_SHA, manifest_sha256: validated.digest, started_at: startedAt, completed_at: new Date().toISOString(), legacy_auth_posts: result.request_counts.legacy_auth_posts, ...result, legacy_retirement: 'HOLD', scheduled_caller_switch: 'HOLD' };
  } catch (error) {
    if (Number.isSafeInteger(error?.decoded_bytes) && error.decoded_bytes > 0) progress.decoded_bytes += error.decoded_bytes;
    const requestCounts = error?.progress ? { ...error.progress } : { ...progress };
    if (Number.isSafeInteger(error?.decoded_bytes) && error.decoded_bytes > 0 && error?.progress) requestCounts.decoded_bytes += error.decoded_bytes;
    return { evidence: 'ordermentum-359-c-shadow-equivalence', status: 'HOLD', stage, failure_category: classifyFailure(error), started_at: startedAt, completed_at: new Date().toISOString(), request_counts: requestCounts, business_writes: 0, legacy_retirement: 'HOLD', scheduled_caller_switch: 'HOLD' };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const evidence = await runShadow();
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
  if (evidence.status !== 'PASS') process.exitCode = 1;
}
