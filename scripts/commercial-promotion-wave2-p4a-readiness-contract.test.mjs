import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migrationPath = 'supabase/migrations/20260913234000_commercial_wave2_p4a_readiness.sql';
const migration = fs.readFileSync(migrationPath, 'utf8');
const repository = fs.readFileSync('src/data/repositories/commercialWave2P4Readiness.ts', 'utf8');
const contract = fs.readFileSync('src/features/productIdentity/commercialWave2P4ReadinessContract.ts', 'utf8');
const carrier = fs.readFileSync('src/features/productIdentity/CommercialWave2P4ReadinessCarrier.tsx', 'utf8');
const wrapper = fs.readFileSync('src/features/productIdentity/ProductIdentityCommissioningWithSurvey.tsx', 'utf8');

const functionBody = migration.match(/create or replace function public\.ecoflow_read_commercial_wave2_p4_readiness\(\)[\s\S]*?\$function\$;\n/iu)?.[0] ?? '';

test('P4A is a caller-authenticated no-argument read-only authority', () => {
  assert.match(migration, /ecoflow_read_commercial_wave2_p4_readiness\(\)/);
  assert.match(migration, /stable\s+security definer\s+set search_path = ''/i);
  assert.match(migration, /v_actor uuid := auth\.uid\(\)/);
  assert.match(migration, /not in \('OWNER', 'ADMIN'\)/);
  assert.match(migration, /public\.ecoflow_read_commercial_wave2_p3_verification_v3\(\)/);
  assert.match(migration, /revoke all on function public\.ecoflow_read_commercial_wave2_p4_readiness\(\)\s+from public, anon, service_role/i);
  assert.match(migration, /grant execute on function public\.ecoflow_read_commercial_wave2_p4_readiness\(\)\s+to authenticated/i);
  assert.match(repository, /ecoflow_read_commercial_wave2_p4_readiness/);
  assert.doesNotMatch(repository, /service[_-]?role|SUPABASE_SERVICE_ROLE_KEY|access[_-]?token|jwt/i);
});

test('P4A revalidates the exact frozen 163-row expansion cohort', () => {
  for (const token of [
    '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
    '140010',
    '3001d0f1-6c1b-4b15-98a0-91443ca6b525',
    '016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8',
    '4710bb98-2706-42e5-866b-8788e36e1acc',
    '1995b15c-7ee7-466b-ba3e-daba596d71a3',
  ]) assert.match(migration + contract, new RegExp(token));

  assert.match(migration, /v_expansion_count <> 163/);
  assert.match(migration, /v_eligible_expansion <> 163/);
  assert.match(migration, /promotion_phase = 'EXPANSION'/);
  assert.match(migration, /m\.mapping_status = 'UNMATCHED'/);
  assert.match(migration, /m\.source_duplicate_count = 1/);
  assert.match(migration, /rs\.payload_sha256 = a\.expected_source_payload_sha256/);
  assert.match(migration, /is_visible_on_ordermentum/);
  assert.match(migration, /not exists \([\s\S]*external_product_mappings/);
  assert.match(migration, /not exists \([\s\S]*from public\.skus/);
  assert.match(contract, /eligibleExpansionCount, t\.expansionCandidateCount/);
});

test('P4A explicitly discovers the stale legacy expansion authority without invoking it', () => {
  assert.match(migration, /has_function_privilege\([\s\S]*service_role[\s\S]*ecoflow_unlock_commercial_wave2_expansion/);
  assert.match(migration, /v_source\.mapping_status = 'MATCHED'/);
  assert.match(migration, /legacyExpansionUnlock\.unexpectedlyCompatible/);
  assert.match(migration + contract + carrier, /CANARY_SOURCE_MAPPING_REMAINS_UNMATCHED_BY_DESIGN/);
  assert.match(migration + contract + carrier, /P4B_REPLACE_OR_REVOKE_LEGACY_UNLOCK/);
  assert.doesNotMatch(functionBody, /perform\s+public\.ecoflow_unlock_commercial_wave2_expansion\s*\(/i);
  assert.doesNotMatch(functionBody, /perform\s+public\.ecoflow_promote_commercial_wave2_sku\s*\(/i);
});

test('P4A exposes no production expansion mutation control', () => {
  assert.match(contract, /productionExpansionAuthorized: boolean/);
  assert.match(contract, /'production expansion authorization', value\.authority\.productionExpansionAuthorized/);
  assert.match(carrier, /P4B · EXPANSION EXECUTION · LOCKED/);
  assert.match(carrier, /Run authenticated P4A readiness-only/);
  assert.doesNotMatch(repository + carrier, /unlockCommercialWave2Expansion|promoteCommercialWave2|ecoflow_unlock_commercial_wave2_expansion/);
  assert.doesNotMatch(functionBody, /\binsert\s+into\s+public\.ecoflow_commercial_wave2_/i);
  assert.doesNotMatch(functionBody, /\bupdate\s+public\.ecoflow_commercial_wave2_/i);
  assert.doesNotMatch(functionBody, /\bdelete\s+from\s+public\.ecoflow_commercial_wave2_/i);
});

test('native Product Identity surface mounts P4A after P3', () => {
  assert.match(wrapper, /CommercialWave2CanaryVerificationCarrier/);
  assert.match(wrapper, /CommercialWave2P4ReadinessCarrier/);
  assert.ok(wrapper.indexOf('<CommercialWave2CanaryVerificationCarrier') < wrapper.indexOf('<CommercialWave2P4ReadinessCarrier'));
});
