import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync('supabase/migrations/20260914023000_commercial_wave2_p4d_promotion_authority_plan.sql', 'utf8');
const repo = fs.readFileSync('src/data/repositories/commercialWave2P4DPromotionReadiness.ts', 'utf8');
const contract = fs.readFileSync('src/features/productIdentity/commercialWave2P4DPromotionReadinessContract.ts', 'utf8');
const carrier = fs.readFileSync('src/features/productIdentity/CommercialWave2P4DPromotionReadinessCarrier.tsx', 'utf8');
const wrapper = fs.readFileSync('src/features/productIdentity/ProductIdentityCommissioningWithSurvey.tsx', 'utf8');

const planSha = '43a557ddf36347c8fa303d02dd4c27b8e0aa7f7e4310955a16f70a98f5f33888';

test('P4D closes completed P4C mutation authority and direct legacy promotion authority', () => {
  assert.match(migration, /revoke all on function public\.ecoflow_unlock_commercial_wave2_expansion_v2\(uuid,text,text\)[\s\S]*from public, anon, authenticated, service_role/i);
  assert.match(migration, /revoke all on function public\.ecoflow_promote_commercial_wave2_sku\(uuid,uuid,text,uuid,bigint,text,text\)[\s\S]*from public, anon, authenticated, service_role/i);
  assert.match(migration, /P4D_P4C_CLOSURE_NOT_PROVEN/);
});

test('P4D replacement derives the actor and delegates only the bounded incumbent promotion', () => {
  assert.match(migration, /ecoflow_promote_commercial_wave2_expansion_sku_v2/);
  assert.match(migration, /v_actor uuid := auth\.uid\(\)/);
  assert.match(migration, /public\.ecoflow_active_app_role\(\)/);
  assert.doesNotMatch(migration.match(/create or replace function public\.ecoflow_promote_commercial_wave2_expansion_sku_v2[\s\S]*?\$function\$;/i)?.[0] ?? '', /p_requested_by/);
  assert.match(migration, /public\.ecoflow_promote_commercial_wave2_sku\([\s\S]*v_actor/);
  assert.match(migration, /promotion_phase <> 'EXPANSION'/);
  assert.match(migration, /P4D_CALLER_AUTH_PROMOTION_V2/);
  assert.match(migration, /providerActionIncluded',false/);
});

test('P4D replacement remains dormant until P4E', () => {
  assert.match(migration, /revoke all on function public\.ecoflow_promote_commercial_wave2_expansion_sku_v2\(uuid,text,uuid,bigint,text,text\)[\s\S]*from public, anon, authenticated, service_role/i);
  assert.doesNotMatch(migration, /grant execute on function public\.ecoflow_promote_commercial_wave2_expansion_sku_v2/i);
  assert.match(carrier, /P4E · BATCH PROMOTION EXECUTION · LOCKED/);
});

test('P4D freezes a seven-batch 25-row promotion plan over the exact cohort', () => {
  assert.match(migration + contract, new RegExp(planSha));
  assert.match(migration, /batchSize',25/);
  assert.match(migration, /batchCount',7/);
  assert.match(migration, /eligibleForPromotionCount/);
  assert.match(contract, /batchSize: 25/);
  assert.match(contract, /batchCount: 7/);
});

test('P4D browser surface is SELECT-only and contains no promotion invocation', () => {
  assert.match(repo, /ecoflow_read_commercial_wave2_p4d_promotion_readiness/);
  assert.doesNotMatch(repo + carrier, /ecoflow_promote_commercial_wave2_expansion_sku_v2|ecoflow_promote_commercial_wave2_sku|functions\.invoke/);
  assert.match(carrier, /Run authenticated P4D promotion readiness-only/);
  assert.match(carrier, /PRODUCTION_PROMOTION_NOT_AUTHORIZED/);
  assert.match(wrapper, /CommercialWave2P4DPromotionReadinessCarrier/);
});
