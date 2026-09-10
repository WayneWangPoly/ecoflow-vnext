import { pathToFileURL } from 'node:url';
import { loadManifest, validateManifest, assertSupplierBinding, assertExternalBinding } from './ordermentum-shadow-manifest.mjs';
import { executeWindow, classifyFailure } from './ordermentum-shadow-adapter.mjs';

const SHA = /^[0-9a-f]{40}$/;
function requireValue(value) { if (!String(value || '').trim()) throw new Error('Required bounded input is absent.'); return String(value).trim(); }

async function legacyAuth(env, fetchImpl) {
  const response = await fetchImpl('https://app.ordermentum.com/v1/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: env.ORDERMENTUM_USERNAME, password: env.ORDERMENTUM_PASSWORD }), redirect: 'manual', signal: AbortSignal.timeout(20000) });
  if (response.status >= 300 && response.status <= 399) { const error = new Error('Legacy authentication redirect blocked.'); error.code = 'ORDERMENTUM_REDIRECT_BLOCKED'; throw error; }
  if (!response.ok) { const error = new Error('Legacy authentication rejected.'); error.status = response.status; throw error; }
  const declared = Number(response.headers?.get?.('content-length') || 0);
  if (declared > 1048576) { const error = new Error('Legacy auth response cap exceeded.'); error.code = 'ORDERMENTUM_C_RESPONSE_CAP'; throw error; }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > 1048576) { const error = new Error('Legacy auth response cap exceeded.'); error.code = 'ORDERMENTUM_C_RESPONSE_CAP'; throw error; }
  const payload = JSON.parse(text);
  return requireValue(payload?.access_token || payload?.accessToken || payload?.token);
}

export async function runShadow({ env = process.env, fetchImpl = fetch } = {}) {
  let stage = 'preflight';
  const startedAt = new Date().toISOString();
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
    stage = 'legacy_auth';
    const legacyBearer = await legacyAuth({ ORDERMENTUM_USERNAME: username, ORDERMENTUM_PASSWORD: password }, fetchImpl);
    stage = 'paired_reads';
    const result = await executeWindow({ manifest, windowId: env.ORDERMENTUM_C_WINDOW, supplierId, currentApiKey, legacyBearer, fetchImpl });
    return { evidence: 'ordermentum-359-c-shadow-equivalence', status: 'PASS', stage: 'complete', candidate_sha: env.GITHUB_SHA, manifest_sha256: validated.digest, started_at: startedAt, completed_at: new Date().toISOString(), legacy_auth_posts: 1, ...result, legacy_retirement: 'HOLD', scheduled_caller_switch: 'HOLD' };
  } catch (error) {
    return { evidence: 'ordermentum-359-c-shadow-equivalence', status: 'HOLD', stage, failure_category: classifyFailure(error), started_at: startedAt, completed_at: new Date().toISOString(), business_writes: 0, legacy_retirement: 'HOLD', scheduled_caller_switch: 'HOLD' };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const evidence = await runShadow();
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
  if (evidence.status !== 'PASS') process.exitCode = 1;
}
