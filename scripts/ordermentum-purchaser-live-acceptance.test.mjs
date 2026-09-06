import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runAcceptance } from './ordermentum-purchaser-live-acceptance.mjs';
const id = '123e4567-e89b-42d3-a456-426614174000';
const sha = 'a'.repeat(40);
const saved = { ...process.env };
const originalFetch = globalThis.fetch;
const payload = { id, name: 'Private test purchaser', settings: { b: 2, a: 1 } };
let calls;
test.beforeEach(() => {
  calls = [];
  for (const k of Object.keys(process.env)) if (k.startsWith('ORDERMENTUM_')) delete process.env[k];
  Object.assign(process.env, { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: sha, GITHUB_RUN_ATTEMPT: '1', ORDERMENTUM_ACCEPTANCE_SHA: sha, ORDERMENTUM_ACCEPTANCE_CONFIRM: 'ONE_CURRENT_GET_ONE_LEGACY_GET', ORDERMENTUM_PROBE_PURCHASER_ID: id, ORDERMENTUM_AUTH_MODE: 'api-key', ORDERMENTUM_BASE_URL: 'https://api.ordermentum.com', ORDERMENTUM_API_KEY: 'fake-current-key', ORDERMENTUM_USERNAME: 'fake-user', ORDERMENTUM_PASSWORD: 'fake-password' });
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return Response.json(String(url).endsWith('/v1/auth') ? { access_token: 'fake-bearer' } : payload);
  };
});
test.afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  globalThis.fetch = originalFetch;
});
test('exactly one current GET, one legacy auth POST and same endpoint legacy GET; metadata only', async () => {
  const result = await runAcceptance();
  assert.equal(result.status, 'PASS');
  assert.equal(result.equivalence.payload_equal, true);
  assert.deepEqual(calls.map(c => [c.url, c.options.method]), [
    [`https://api.ordermentum.com/v1/purchasers/${id}`, 'GET'],
    ['https://app.ordermentum.com/v1/auth', 'POST'],
    [`https://api.ordermentum.com/v1/purchasers/${id}`, 'GET'],
  ]);
  assert.equal(calls[0].options.headers['x-api-key'], 'fake-current-key');
  assert.equal(calls[2].options.headers.authorization, 'Bearer fake-bearer');
  assert.equal(calls[2].options.headers['x-api-key'], undefined);
  for (const c of calls) { assert.equal(c.options.redirect, 'manual'); assert.ok(c.options.signal); }
  for (const secret of [id, payload.name, 'fake-current-key', 'fake-bearer', 'fake-password']) assert.equal(JSON.stringify(result).includes(secret), false);
});
for (const [key, value] of [ ['ORDERMENTUM_API_KEY', ''], ['ORDERMENTUM_PASSWORD', ''], ['ORDERMENTUM_PROBE_PURCHASER_ID','bad'], ['ORDERMENTUM_ACCEPTANCE_SHA','b'.repeat(40)], ['GITHUB_REF','refs/heads/other'], ['GITHUB_EVENT_NAME','push'], ['GITHUB_RUN_ATTEMPT','2'], ['ORDERMENTUM_ACCEPTANCE_CONFIRM','yes'], ['ORDERMENTUM_AUTH_MODE','legacy-bearer'], ['ORDERMENTUM_BASE_URL','https://evil.test'] ]) {
  test(`${key} invalid fails before any provider request`, async () => {
    process.env[key] = value;
    const result = await runAcceptance();
    assert.equal(result.status, 'HOLD'); assert.equal(calls.length, 0);
  });
}
for (const status of [301,302,307,401,429,500]) {
  test(`current ${status} stops without legacy traffic or retry`, async () => {
    globalThis.fetch = async (url, options) => { calls.push({url,options}); return new Response('secret raw provider error', {status,headers:{location:'https://evil.test'}}); };
    const result = await runAcceptance();
    assert.equal(result.status,'HOLD'); assert.equal(calls.length,1);
    assert.equal(JSON.stringify(result).includes('secret raw'),false);
  });
}
for (const stage of ['legacy_auth','legacy_get']) {
  test(`${stage} redirects fail closed without retry`, async () => {
    globalThis.fetch = async (url,options) => {
      calls.push({url,options});
      if (calls.length === (stage === 'legacy_auth' ? 2 : 3)) return new Response('',{status:302,headers:{location:'https://evil.test'}});
      return Response.json(String(url).endsWith('/v1/auth') ? {access_token:'fake-bearer'} : payload);
    };
    const result=await runAcceptance();
    assert.equal(result.status,'HOLD'); assert.equal(result.stage,stage);
    assert.equal(calls.length,stage === 'legacy_auth' ? 2 : 3);
  });
}
test('payload drift emits unequal hashes and HOLD, never a second current GET',async()=>{
  globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json(String(url).endsWith('/v1/auth')?{token:'fake-bearer'}:{...payload,name:calls.length===3?'Changed private purchaser':payload.name});};
  const result=await runAcceptance();
  assert.equal(result.status,'HOLD');assert.equal(result.equivalence.payload_equal,false);assert.equal(calls.length,3);
  assert.equal(JSON.stringify(result).includes('Changed private purchaser'),false);
});
test('bad current identity prevents legacy auth',async()=>{
  globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json({...payload,id:'wrong'});};
  assert.equal((await runAcceptance()).status,'HOLD');assert.equal(calls.length,1);
});
test('network and parser errors never expose provider text',async()=>{
  globalThis.fetch=async()=>{throw new Error('fake-current-key Private test purchaser');};
  const result=await runAcceptance();assert.equal(result.status,'HOLD');
  assert.equal(JSON.stringify(result).includes('fake-current-key'),false);
});
test('runner has no ingestion, file writes, cache or dynamic legacy URL',()=>{
  const source=readFileSync(new URL('./ordermentum-purchaser-live-acceptance.mjs',import.meta.url),'utf8');
  assert.equal(/writeFile|appendFile|mkdir|createClient|supabaseRequest|getLegacyBearerToken|ORDERMENTUM_AUTH_URL/.test(source),false);
  const workflow=readFileSync(new URL('../.github/workflows/ordermentum-purchaser-live-acceptance.yml',import.meta.url),'utf8');
  assert.equal(/SUPABASE_|pull_request_target|schedule:/.test(workflow),false);
  assert.match(workflow,/github.ref == 'refs\/heads\/main'/);
  assert.match(workflow,/github.run_attempt == 1/);
  assert.match(workflow,/persist-credentials: false/);
  assert.match(workflow,/group: ordermentum-cloud-sync/);
});
