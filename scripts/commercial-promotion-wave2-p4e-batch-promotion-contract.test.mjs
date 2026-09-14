import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync('supabase/migrations/20260914031500_commercial_wave2_p4e_batch_promotion_engineering.sql', 'utf8');
const repository = fs.readFileSync('src/data/repositories/commercialWave2P4EBatchPromotion.ts', 'utf8');
const contract = fs.readFileSync('src/features/productIdentity/commercialWave2P4EBatchPromotionContract.ts', 'utf8');
const carrier = fs.readFileSync('src/features/productIdentity/CommercialWave2P4EBatchPromotionCarrier.tsx', 'utf8');
const wrapper = fs.readFileSync('src/features/productIdentity/ProductIdentityCommissioningWithSurvey.tsx', 'utf8');

const planSha = '43a557ddf36347c8fa303d02dd4c27b8e0aa7f7e4310955a16f70a98f5f33888';
const batchShas = [
  '7dc7e7aacb5891caa2905a241c68a57920c98173991d5d410cf27b6a2ccf55e3',
  '82d6667c5a077bd7bcfbefd8e27feb37644b80cd0418b050a1f3d83d2ab955c0',
  '59c55ae2e4d40995234f002eabc1f714d3e634babcddc60db5be68cc5cc8584b',
  'a03043367fb53ccc81b42e0ea74fe5db9fd6b5ff984ae89f8a56b9303aa05457',
  'f761569972fc8a23fa26cd0fe78516bcf37e648d5a07ace5ebd2d34207ab66d1',
  'ff2e9000c096485ed63b18dbf9adfb545e925a0d1ced8458122f68dd0151a15c',
  'ca2ebb59ffbd31e5b8c488ea33b4c39d63ab9194025c3c1bd2157fad87b4f890',
];

const batchCommandIds = [
  'dbd1f89c-720f-4a44-bd31-59787b0d3bd3',
  '5ad4dd0c-0028-4cc2-9eed-1422f0ba2696',
  'e04af561-dd00-4a0b-88b7-aa185508130e',
  'bdbd7dfb-ef13-442b-84b6-ce3dead08f8b',
  'ed79bf21-245f-43bc-9722-a8a79be568bb',
  'd326df14-63ba-4bac-b66e-c5c489a8a039',
  'c3a0f311-4efb-4325-804b-d8eb39ef9291',
];

test('P4E freezes the exact seven-window promotion plan', () => {
  assert.match(migration + contract, new RegExp(planSha));
  for (const sha of batchShas) assert.match(migration + contract, new RegExp(sha));
  for (const id of batchCommandIds) assert.match(migration + contract, new RegExp(id));
  assert.match(migration, /candidateCount',25/);
  assert.match(migration, /candidateCount',13/);
  assert.match(migration, /p_batch_no between 1 and 7|batch_no between 1 and 7/i);
});

test('P4E exposes only the sequence-gated batch mutation to authenticated callers', () => {
  assert.match(migration, /grant execute on function public\.ecoflow_promote_commercial_wave2_expansion_batch_v1\(integer\) to authenticated/i);
  assert.match(migration, /grant execute on function public\.ecoflow_verify_commercial_wave2_expansion_batch_v1\(integer\) to authenticated/i);
  assert.match(migration, /grant execute on function public\.ecoflow_read_commercial_wave2_p4e_batch_gate\(\) to authenticated/i);
  assert.match(migration, /revoke all on function public\.ecoflow_promote_commercial_wave2_expansion_sku_v2\([\s\S]*from public,anon,authenticated,service_role/i);
  assert.doesNotMatch(migration, /grant execute on function public\.ecoflow_promote_commercial_wave2_expansion_sku_v2/i);
  assert.doesNotMatch(migration, /grant execute on function public\.ecoflow_promote_commercial_wave2_expansion_batch_v1\(integer\) to service_role/i);
  assert.match(migration, /v_actor uuid := auth\.uid\(\)/);
  assert.match(migration, /public\.ecoflow_active_app_role\(\)/);
});

test('P4E enforces exactly-once batches and postflight-before-next-batch sequencing', () => {
  assert.match(migration, /ecoflow_commercial_wave2_promotion_batch_commands/);
  assert.match(migration, /ecoflow_commercial_wave2_promotion_batch_verifications/);
  assert.match(migration, /COMMERCIAL_WAVE2_P4E_BATCH_REPLAY_PAYLOAD_MISMATCH/);
  assert.match(migration, /COMMERCIAL_WAVE2_P4E_PREVIOUS_BATCH_NOT_VERIFIED/);
  assert.match(migration, /COMMERCIAL_WAVE2_P4E_POSTFLIGHT_SEQUENCE_INVALID/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /READY_FOR_POSTFLIGHT/);
  assert.match(migration, /READY_FOR_BATCH_EXECUTION/);
});

test('P4E rechecks frozen source evidence and forbids provider Physical and inventory side effects', () => {
  assert.match(migration, /COMMERCIAL_WAVE2_P4E_BATCH_ELIGIBILITY_DRIFT/);
  assert.match(migration, /mapping_status='UNMATCHED'/);
  assert.match(migration, /source_payload_sha256=pm\.expected_source_payload_sha256/);
  assert.match(migration, /ORDERMENTUM/);
  assert.match(migration, /providerActionIncluded',false/);
  assert.match(migration, /physicalAuthorityCreated',false/);
  assert.match(migration, /inventoryAuthorityCreated',false/);
  assert.doesNotMatch(migration, /http_request|net\.http|functions\.invoke|fetch\(/i);
});

test('P4E browser carrier uses only the batch gate, batch execute and postflight RPCs', () => {
  assert.match(repository, /ecoflow_read_commercial_wave2_p4e_batch_gate/);
  assert.match(repository, /ecoflow_promote_commercial_wave2_expansion_batch_v1/);
  assert.match(repository, /ecoflow_verify_commercial_wave2_expansion_batch_v1/);
  assert.doesNotMatch(repository + carrier, /ecoflow_promote_commercial_wave2_expansion_sku_v2|ecoflow_promote_commercial_wave2_sku/);
  assert.match(carrier, /Run authenticated P4E batch gate/);
  assert.match(carrier, /Verify and close P4E batch/);
  assert.match(carrier, /window\.confirm/);
  assert.match(wrapper, /CommercialWave2P4EBatchPromotionCarrier/);
});
