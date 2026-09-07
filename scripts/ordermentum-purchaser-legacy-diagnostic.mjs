import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { hashCanonicalPayload, validateProbePurchaserId } from './ordermentum-api-key-probe.mjs';

const REFERENCE = Object.freeze({
  run_id: 34076398472,
  candidate_sha: 'c932ea1edcf2ee2d00aa7fcb81e46adf0db928b7',
  completed_at: '2026-09-07T02:28:33.318Z',
  target_sha256: '95ddce452fa5d6afece19d6d78858bf545d901a53b9a75fd250033bf08cae0fb',
  payload_sha256: '51c938bf25a518f006ee3270e5d66994c90a6def1c0e2875b61b7a4016c1d308',
});
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
class DiagnosticFailure extends Error {
  constructor(category, httpStatus) { super('blocked'); this.category=category; this.httpStatus=httpStatus; }
}
function requireCondition(condition, category='preflight') { if(!condition) throw new DiagnosticFailure(category); }
function origin(value, fallback) {
  const selected=value || fallback;
  requireCondition(/^https:\/\/(app|api)\.ordermentum\.com\/?$/.test(selected));
  return selected.replace(/\/$/,'');
}
// No raw provider messages, bodies, headers or redirect locations escape here.
export async function readLegacyJson(url, options) {
  let response;
  try {
    response=await fetch(url,{...options,redirect:'manual',signal:AbortSignal.timeout(20000)});
  } catch(error) { throw new DiagnosticFailure(error?.name==='TimeoutError'||error?.name==='AbortError'?'timeout':'network'); }
  const status=response.status;
  if(response.redirected || (status>=300&&status<400)) { await response.body?.cancel(); throw new DiagnosticFailure('redirect',status); }
  if(!response.ok) { await response.body?.cancel(); throw new DiagnosticFailure('http',status); }
  const chunks=[]; let bytes=0;
  try {
    if(response.body) for await(const chunk of response.body) {
      bytes+=chunk.byteLength;
      if(bytes>2*1024*1024) throw new DiagnosticFailure('body_limit',status);
      chunks.push(chunk);
    }
  } catch(error) {
    if(error instanceof DiagnosticFailure) throw error;
    throw new DiagnosticFailure(error?.name==='TimeoutError'||error?.name==='AbortError'?'timeout':'network',status);
  }
  try { return {data:JSON.parse(Buffer.concat(chunks).toString('utf8')),status}; }
  catch { throw new DiagnosticFailure('json',status); }
}
export async function runDiagnostic() {
  const evidence={evidence:'ordermentum-legacy-only-purchaser-diagnostic',status:'HOLD',stage:'preflight',started_at:new Date().toISOString(),reference:REFERENCE,request_counts:{current_get:0,legacy_auth_post:0,legacy_get:0},business_writes:0,legacy_retirement:'HOLD'};
  try {
    const e=process.env;
    requireCondition(e.GITHUB_EVENT_NAME==='workflow_dispatch'&&e.GITHUB_REF==='refs/heads/main'&&e.GITHUB_RUN_ATTEMPT==='1');
    requireCondition(/^[0-9a-f]{40}$/.test(e.GITHUB_SHA||'')&&e.ORDERMENTUM_ACCEPTANCE_SHA===e.GITHUB_SHA);
    evidence.candidate_sha=e.GITHUB_SHA;
    requireCondition(e.ORDERMENTUM_ACCEPTANCE_CONFIRM==='ONE_LEGACY_GET_ONLY');
    requireCondition(Boolean(e.ORDERMENTUM_USERNAME?.trim())&&Boolean(e.ORDERMENTUM_PASSWORD?.trim()));
    const id=validateProbePurchaserId(e.ORDERMENTUM_PROBE_PURCHASER_ID);
    requireCondition(hash(id)===REFERENCE.target_sha256);
    const authOrigin=origin(e.ORDERMENTUM_BASE_URL,'https://app.ordermentum.com');
    const apiOrigin=origin(e.ORDERMENTUM_API_BASE_URL,'https://api.ordermentum.com');
    evidence.origins={auth:authOrigin,legacy_get:apiOrigin};
    evidence.stage='legacy_auth'; evidence.request_counts.legacy_auth_post++;
    const auth=await readLegacyJson(`${authOrigin}/v1/auth`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:e.ORDERMENTUM_USERNAME,password:e.ORDERMENTUM_PASSWORD})});
    evidence.auth_http_status=auth.status;
    const token=auth.data?.access_token||auth.data?.accessToken||auth.data?.token;
    requireCondition(typeof token==='string'&&Boolean(token.trim()),'token_shape');
    evidence.stage='legacy_get'; evidence.request_counts.legacy_get++;
    const result=await readLegacyJson(`${apiOrigin}/v1/purchasers/${encodeURIComponent(id)}`,{method:'GET',headers:{accept:'application/json',authorization:`Bearer ${token}`}});
    evidence.legacy_http_status=result.status;
    const payload=result.data;
    requireCondition(payload&&typeof payload==='object'&&!Array.isArray(payload)&&String(payload.id||'').trim()===id,'identity');
    evidence.stage='comparison';
    const legacyHash=hashCanonicalPayload(payload);
    evidence.comparison={basis:'historical-current-sample',target_sha256:REFERENCE.target_sha256,identity_match:true,legacy_payload_sha256:legacyHash,current_payload_sha256:REFERENCE.payload_sha256,payload_equal:legacyHash===REFERENCE.payload_sha256,legacy_top_level_key_count:Object.keys(payload).length};
    if(evidence.comparison.payload_equal)evidence.status='PASS';
  } catch(error) {
    evidence.failure=error instanceof DiagnosticFailure?{category:error.category,...(Number.isInteger(error.httpStatus)?{http_status:error.httpStatus}:{})}:{category:evidence.stage==='preflight'?'preflight':'internal'};
  }
  evidence.completed_at=new Date().toISOString();
  return evidence;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const result=await runDiagnostic();process.stdout.write(`${JSON.stringify(result)}\n`);if(result.status!=='PASS')process.exitCode=1;
}
