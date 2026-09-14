import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync('supabase/migrations/20260914013000_commercial_wave2_p4c_authenticated_expansion_activation.sql', 'utf8');
const repository = fs.readFileSync('src/data/repositories/commercialWave2P4Expansion.ts', 'utf8');
const contract = fs.readFileSync('src/features/productIdentity/commercialWave2P4ExpansionContract.ts', 'utf8');
const carrier = fs.readFileSync('src/features/productIdentity/CommercialWave2P4ExpansionCarrier.tsx', 'utf8');
const wrapper = fs.readFileSync('src/features/productIdentity/ProductIdentityCommissioningWithSurvey.tsx', 'utf8');

const commandId = '430e5bfe-e8b1-44dd-a004-9dfb0bbc46b8';
const cohort = '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a';

test('P4C activates v2 for authenticated only and preserves every revoked bypass', () => {
  assert.match(migration, /grant execute on function public\.ecoflow_unlock_commercial_wave2_expansion_v2\(uuid,text,text\)[\s\S]*to authenticated/i);
  assert.match(migration, /revoke all on function public\.ecoflow_unlock_commercial_wave2_expansion_v2\(uuid,text,text\)[\s\S]*from public, anon, service_role/i);
  assert.match(migration, /revoke all on function public\.ecoflow_unlock_commercial_wave2_expansion\(uuid,uuid,text,bigint,text,text\)[\s\S]*from public, anon, authenticated, service_role/i);
  assert.doesNotMatch(migration, /grant execute[\s\S]{0,120}service_role/i);
});

test('P4C preflight proves exact zero-to-163 boundary and frozen command', () => {
  for (const token of [commandId, cohort, 'READY_FOR_AUTHENTICATED_EXPANSION_EXECUTION', 'productionExpansionAuthorized']) {
    assert.match(migration + contract, new RegExp(token));
  }
  assert.match(migration, /eligibleExpansionCount/);
  assert.match(migration, /enabledExpansionCount/);
  assert.match(migration, /expansionUnlockCount/);
  assert.match(migration, /expansionCommandCount/);
  assert.match(migration, /nonCanaryPromotionCount/);
});

test('browser carrier requires fresh authenticated preflight and explicit confirmation', () => {
  assert.match(repository, /ecoflow_read_commercial_wave2_p4c_activation/);
  assert.match(repository, /ecoflow_unlock_commercial_wave2_expansion_v2/);
  assert.match(repository, /p_command_id: target\.commandId/);
  assert.match(repository, /p_expected_candidate_set_sha256: target\.candidateSetSha256/);
  assert.match(carrier, /Run authenticated P4C preflight/);
  assert.match(carrier, /window\.confirm/);
  assert.match(carrier, /enable exactly 163/i);
  assert.match(carrier, /if \(!preflight\) throw new Error/);
  assert.match(carrier, /HOLD_BEFORE_NON_CANARY_PROMOTION/);
});

test('P4C contains no non-canary promotion or provider mutation path', () => {
  assert.doesNotMatch(repository + carrier, /promoteCommercialWave2|providerAction|ordermentum-cloud-sync|service_role/i);
  assert.match(contract, /promotionIncluded: boolean/);
  assert.match(contract, /providerActionIncluded: boolean/);
  assert.match(wrapper, /CommercialWave2P4ExpansionCarrier/);
  assert.ok(wrapper.indexOf('<CommercialWave2P4ReadinessCarrier') < wrapper.indexOf('<CommercialWave2P4ExpansionCarrier'));
});
