import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');

const migration = read('supabase/migrations/20260913065000_commercial_wave2_p2b_canary_promotion_carrier.sql');
const edge = read('supabase/functions/commercial-wave2-p2b-canary-promotion/index.ts');
const repository = read('src/data/repositories/commercialWave2CanaryPromotion.ts');
const contract = read('src/features/productIdentity/commercialWave2CanaryPromotionContract.ts');
const carrier = read('src/features/productIdentity/CommercialWave2CanaryPromotionCarrier.tsx');
const wrapper = read('src/features/productIdentity/ProductIdentityCommissioningWithSurvey.tsx');
const incumbent = read('supabase/migrations/20260910010000_commercial_promotion_wave2.sql');

const commandId = '7900f15b-bdae-444f-b22c-04000730e260';
const unlockCommandId = '61b13a7c-18d1-48f0-b317-96d23607ddfb';
const cohortHash = '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a';
const mappingId = '3001d0f1-6c1b-4b15-98a0-91443ca6b525';
const sourceSha = '016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8';

test('P2B is a thin carrier over incumbent bounded promotion', () => {
  assert.match(incumbent, /create or replace function public\.ecoflow_promote_commercial_wave2_sku/);
  assert.match(migration, /public\.ecoflow_promote_commercial_wave2_sku\(/);
  assert.match(migration, /P2B_SELECT_ONLY/);
  assert.match(migration, /P2B_CANARY_PROMOTION/);
  assert.match(migration, /CANARY_PROMOTED/);
  assert.doesNotMatch(migration, /ecoflow_unlock_commercial_wave2_expansion\(/);
  assert.doesNotMatch(migration, /promotion_phase='EXPANSION'.*enabled=true/is);
});

test('P2B freezes P2A state and exact canary evidence', () => {
  for (const token of [commandId, unlockCommandId, cohortHash, mappingId, sourceSha, '140010']) {
    assert.match(migration, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(contract, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(edge, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(migration, /enabledCandidateCount'\)::bigint=1/);
  assert.match(migration, /promotionCount'\)::bigint=0/);
  assert.match(migration, /promotionCommandCount'\)::bigint=0/);
  assert.match(migration, /exactUnlockCommandCount/);
  assert.match(migration, /unlockAuditCount/);
});

test('browser cannot call service-role RPC directly', () => {
  assert.match(migration, /revoke all on function public\.ecoflow_execute_commercial_wave2_canary_promotion[\s\S]*from public,anon,authenticated/);
  assert.match(migration, /grant execute on function public\.ecoflow_execute_commercial_wave2_canary_promotion[\s\S]*to service_role/);
  assert.doesNotMatch(repository, /service[_-]?role|SUPABASE_SERVICE_ROLE_KEY|access[_-]?token|jwt/i);
  assert.doesNotMatch(carrier, /service[_-]?role|SUPABASE_SERVICE_ROLE_KEY|access[_-]?token|jwt/i);
});

test('Edge carrier requires bearer identity and OWNER or ADMIN', () => {
  assert.match(edge, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(edge, /Authorization/);
  assert.match(edge, /auth\.getUser/);
  assert.match(edge, /\['OWNER', 'ADMIN'\]\.includes\(actor\.app_role\)/);
  assert.match(edge, /P2B_CANARY_PROMOTION_PREFLIGHT/);
  assert.match(edge, /P2B_CANARY_PROMOTION/);
  assert.match(edge, /ecoflow_read_commercial_wave2_canary_promotion_preflight/);
  assert.match(edge, /ecoflow_execute_commercial_wave2_canary_promotion/);
});

test('frontend keeps preflight and mutation as separate explicit boundaries', () => {
  assert.match(repository, /mode: 'P2B_CANARY_PROMOTION_PREFLIGHT'/);
  assert.match(repository, /mode: 'P2B_CANARY_PROMOTION'/);
  assert.ok(carrier.indexOf('assertCommercialWave2CanaryPromotionPreflight(preflight)') < carrier.indexOf('setPromotionAttempted(true)'));
  assert.ok(carrier.indexOf('setPromotionAttempted(true)') < carrier.indexOf('await promoteCommercialWave2Canary()'));
  assert.match(carrier, /P2B CANARY PROMOTED/);
  assert.match(carrier, /aria-label="P3 verification locked"/);
  assert.match(carrier, /aria-label="P4 expansion locked"/);
  assert.doesNotMatch(carrier, /expandCommercial|unlockCommercialWave2Expansion/);
});

test('P2B carrier is mounted independently without altering P2A carrier authority', () => {
  assert.match(wrapper, /<CommercialWave2PlanCarrier/);
  assert.match(wrapper, /<CommercialWave2CanaryPromotionCarrier/);
  assert.match(contract, /carrierBaseSha: '56931cb04a2ef95d5762d4445556f81b5c1a60d1'/);
  assert.match(contract, /physicalAuthorityCreated/);
  assert.match(contract, /inventoryAuthorityCreated/);
  assert.match(contract, /imageActionIncluded/);
});
