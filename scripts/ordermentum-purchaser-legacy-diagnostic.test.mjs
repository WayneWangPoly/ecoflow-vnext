import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { runDiagnostic, readLegacyJson } from './ordermentum-purchaser-legacy-diagnostic.mjs';
const id = '0004e15f-76b6-4580-93b5-c347611542da';
const sha = 'a'.repeat(40);
const saved = {...process.env};
const originalFetch = globalThis.fetch;
let calls;
test.beforeEach(()=>{
  calls=[];
  for(const k of Object.keys(process.env)) if(k.startsWith('ORDERMENTUM_')) delete process.env[k];
  Object.assign(process.env,{GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:sha,ORDERMENTUM_ACCEPTANCE_SHA:sha,ORDERMENTUM_ACCEPTANCE_CONFIRM:'ONE_LEGACY_GET_ONLY',ORDERMENTUM_PROBE_PURCHASER_ID:id,ORDERMENTUM_USERNAME:'private-user',ORDERMENTUM_PASSWORD:'private-password'});
  globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json(String(url).endsWith('/v1/auth')?{token:'private-token'}:{id,name:'private-name'});};
});
test.afterEach(()=>{for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);globalThis.fetch=originalFetch;});
for(const [k,v] of [['GITHUB_REF','refs/heads/other'],['GITHUB_RUN_ATTEMPT','2'],['GITHUB_EVENT_NAME','push'],['ORDERMENTUM_ACCEPTANCE_SHA','b'.repeat(40)],['ORDERMENTUM_ACCEPTANCE_CONFIRM','yes'],['ORDERMENTUM_PASSWORD',''],['ORDERMENTUM_PROBE_PURCHASER_ID','123e4567-e89b-42d3-a456-426614174000'],['ORDERMENTUM_BASE_URL','https://evil.test'],['ORDERMENTUM_API_BASE_URL','https://api.ordermentum.com/evil'],['ORDERMENTUM_API_BASE_URL','https://api.ordermentum.com?secret']])test(`reject ${k} before traffic`,async()=>{process.env[k]=v;const r=await runDiagnostic();assert.equal(r.status,'HOLD');assert.equal(calls.length,0);});
for(const origin of ['https://api.ordermentum.com','https://app.ordermentum.com'])test(`bounded legacy read ${origin}`,async()=>{
  process.env.ORDERMENTUM_API_BASE_URL=origin;
  const r=await runDiagnostic();assert.equal(calls.length,2);assert.equal(calls[1].url,`${origin}/v1/purchasers/${id}`);
  assert.deepEqual(r.request_counts,{current_get:0,legacy_auth_post:1,legacy_get:1});assert.equal(r.business_writes,0);
  for(const c of calls){assert.equal(c.options.redirect,'manual');assert.ok(c.options.signal);assert.equal(c.options.headers['x-api-key'],undefined);}
  assert.equal(r.comparison.payload_equal,false);assert.equal(r.status,'HOLD');assert.equal(r.legacy_retirement,'HOLD');
  for(const value of [id,'private-name','private-user','private-password','private-token'])assert.equal(JSON.stringify(r).includes(value),false);
});
for(const status of [302,401,403,404,429,500])test(`legacy HTTP ${status} classified with no retry`,async()=>{
  globalThis.fetch=async(url,options)=>{calls.push({url,options});return calls.length===1?Response.json({token:'private-token'}):new Response('private-body',{status});};
  const r=await runDiagnostic();assert.equal(r.failure.http_status,status);assert.equal(r.failure.category,status===302?'redirect':'http');assert.equal(calls.length,2);assert.equal(r.comparison,undefined);assert.equal(JSON.stringify(r).includes('private-body'),false);
});
for(const [name,category] of [['TimeoutError','timeout'],['TypeError','network']])test(name,async()=>{
  globalThis.fetch=async()=>{throw Object.assign(new Error('private-message'),{name});};const r=await runDiagnostic();assert.equal(r.failure.category,category);assert.equal(JSON.stringify(r).includes('private-message'),false);
});
test('bad JSON and oversized bodies classified safely',async()=>{
  for(const [body,category] of [['private invalid json','json'],['x'.repeat(2*1024*1024+1),'body_limit']]){
    globalThis.fetch=async()=>new Response(body);
    await assert.rejects(readLegacyJson('https://api.ordermentum.com',{}),e=>e.category===category&&e.httpStatus===200);
  }
});
test('invalid identity never compared',async()=>{globalThis.fetch=async(url)=>Response.json(String(url).endsWith('/v1/auth')?{token:'private-token'}:{id:'wrong'});const r=await runDiagnostic();assert.equal(r.failure.category,'identity');assert.equal(r.comparison,undefined);});
test('reference target hash is pinned',()=>{assert.equal(crypto.createHash('sha256').update(id).digest('hex'),'95ddce452fa5d6afece19d6d78858bf545d901a53b9a75fd250033bf08cae0fb');});
test('auth rejection stops before purchaser GET',async()=>{
  globalThis.fetch=async(url,options)=>{calls.push({url,options});return new Response('private auth error',{status:401});};
  const r=await runDiagnostic();assert.equal(calls.length,1);assert.equal(r.stage,'legacy_auth');assert.equal(r.failure.http_status,401);assert.equal(r.request_counts.legacy_get,0);
});
test('token shape rejection stops before purchaser GET',async()=>{
  globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json({token:{private:'value'}});};
  const r=await runDiagnostic();assert.equal(calls.length,1);assert.equal(r.failure.category,'token_shape');
});
test('workflow excludes current credentials and business writes',async()=>{
  const {readFileSync}=await import('node:fs');
  const workflow=readFileSync(new URL('../.github/workflows/ordermentum-purchaser-legacy-diagnostic.yml',import.meta.url),'utf8');
  assert.equal(/ORDERMENTUM_API_KEY|SUPABASE_|pull_request_target|schedule:|npm/.test(workflow),false);
  assert.match(workflow,/github.ref == 'refs\/heads\/main'/);assert.match(workflow,/github.run_attempt == 1/);
  assert.match(workflow,/persist-credentials: false/);assert.match(workflow,/group: ordermentum-cloud-sync/);
  assert.match(workflow,/test "\$current_main" = "\$EXPECTED_SHA"/);
});
