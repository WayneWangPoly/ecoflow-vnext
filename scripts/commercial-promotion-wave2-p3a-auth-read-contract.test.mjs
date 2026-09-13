import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migrationPath = 'supabase/migrations/20260913173007_commercial_wave2_p3a_authenticated_evidence_read.sql';
const migration = fs.readFileSync(migrationPath, 'utf8');
const repository = fs.readFileSync('src/data/repositories/commercialWave2CanaryVerification.ts', 'utf8');
const contract = fs.readFileSync('src/features/productIdentity/commercialWave2CanaryVerificationContract.ts', 'utf8');
const carrier = fs.readFileSync('src/features/productIdentity/CommercialWave2CanaryVerificationCarrier.tsx', 'utf8');
const wrapper = fs.readFileSync('src/features/productIdentity/ProductIdentityCommissioningWithSurvey.tsx', 'utf8');

const rpcBody = migration.match(
  /create or replace function public\.ecoflow_read_commercial_wave2_p3_verification\(\)[\s\S]*?as \$function\$([\s\S]*?)\$function\$;/i,
)?.[1];

test('P3A authority is one no-argument authenticated ACTIVE OWNER/ADMIN read RPC', () => {
  assert.ok(rpcBody, 'bounded P3 RPC body is present');
  assert.match(migration, /returns jsonb[\s\S]*language plpgsql[\s\S]*stable[\s\S]*security definer[\s\S]*set search_path = ''/i);
  assert.match(rpcBody, /v_actor uuid := auth\.uid\(\)/);
  assert.match(rpcBody, /from public\.app_user_profiles p[\s\S]*p\.user_id = v_actor[\s\S]*p\.is_active[\s\S]*p\.team_status = 'ACTIVE'/);
  assert.match(rpcBody, /v_actor_role not in \('OWNER', 'ADMIN'\)/);
  assert.match(rpcBody, /public\.ecoflow_active_app_role\(\) is distinct from v_actor_role/);
  assert.match(migration, /revoke all on function public\.ecoflow_read_commercial_wave2_p3_verification\(\)[\s\S]*from public, anon, service_role;/i);
  assert.match(migration, /grant execute on function public\.ecoflow_read_commercial_wave2_p3_verification\(\)[\s\S]*to authenticated;/i);
});

test('P3A RPC has no DML, dynamic SQL, provider call, or arbitrary scope input', () => {
  assert.doesNotMatch(rpcBody, /\b(?:insert|update|delete|merge|truncate|copy)\b/i);
  assert.doesNotMatch(rpcBody, /\bexecute\b|\bformat\s*\(/i);
  assert.doesNotMatch(rpcBody, /https?:\/\/|extensions\.(?:http|net)|http_(?:get|post)|functions\.invoke/i);
  assert.doesNotMatch(migration, /ecoflow_read_commercial_wave2_p3_verification\s*\([^)]*\w[^)]*\)/i);
  assert.match(rpcBody, /p3aEmittedProviderTraffic', 0/);
  assert.match(rpcBody, /currentApiShadowExecuted/);
  assert.match(rpcBody, /legacyRetired/);
});

test('private Wave-2 ledgers remain unavailable through direct authenticated SELECT', () => {
  for (const table of [
    'ecoflow_commercial_wave2_candidates',
    'ecoflow_commercial_wave2_promotions',
    'ecoflow_commercial_wave2_promotion_commands',
  ]) {
    assert.match(migration, new RegExp(`revoke all on table public\\.${table}[\\s\\S]{0,80}from public, anon, authenticated`, 'i'));
  }
  assert.doesNotMatch(migration, /grant\s+select\s+on\s+(?:table\s+)?public\.ecoflow_commercial_wave2_/i);
  assert.doesNotMatch(migration, /create\s+policy[\s\S]*ecoflow_commercial_wave2_/i);
});

test('frozen P2B lineage and corrected attribution-aware sentinel are exact', () => {
  for (const token of [
    '7900f15b-bdae-444f-b22c-04000730e260',
    '140010',
    '4710bb98-2706-42e5-866b-8788e36e1acc',
    '1995b15c-7ee7-466b-ba3e-daba596d71a3',
    '3001d0f1-6c1b-4b15-98a0-91443ca6b525',
    '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
    '016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8',
    'guid:e80b9e1d-f33d-4ebf-b76d-dfdd9beb1a7b',
    'COMMERCIAL_WAVE2_SKU_PROMOTED',
    '2026-09-13T11:35:14.960842Z',
  ]) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(migration, new RegExp(escaped));
    assert.match(contract, new RegExp(escaped));
  }
  for (const token of [
    '34767646363',
    '0bc9be6e-bc67-4e20-8e5c-c843451eb326',
    'ordermentum-cloud-sync.yml',
    'legacy-bearer',
    'ATTRIBUTED_INCUMBENT_LEGACY_SYNC',
    'UNATTRIBUTED_PROVIDER_ACTIVITY',
  ]) assert.match(migration + contract, new RegExp(token.replaceAll('.', '\\.')));
  assert.match(contract, /expansionCandidateCount, 163/);
  assert.match(contract, /p4EnabledCandidates, 0/);
  assert.match(contract, /nonCanaryPromotions, 0/);
});

test('browser uses only the caller-authenticated bounded RPC', () => {
  assert.match(repository, /\.rpc\(P3_READ_RPC\)/);
  assert.match(repository, /ecoflow_read_commercial_wave2_p3_verification/);
  assert.doesNotMatch(repository, /functions\.invoke|\.from\s*\(|\.(?:insert|update|upsert|delete)\s*\(/i);
  assert.doesNotMatch(repository + carrier + contract, /SUPABASE_SERVICE_ROLE_KEY|service[_-]?role|access[_-]?token|\bjwt\b/i);
  assert.doesNotMatch(repository + carrier, /ecoflow_(?:execute|promote|unlock|reconcile|repair|publish)/i);
});

test('P3 UI remains visibly verification-only with P4 locked', () => {
  assert.match(carrier, /P3 verification-only/);
  assert.match(carrier, /Run authenticated P3 verification-only/);
  assert.match(carrier, /aria-label="P4 expansion locked"/);
  assert.match(wrapper, /<CommercialWave2CanaryVerificationCarrier/);
  assert.doesNotMatch(carrier, /run(?:Promotion|Unlock|Edit|Retry|Reconcile|Repair|Publish)|Execute separately authorized/i);
  assert.doesNotMatch(carrier, /onChanged/);
});
