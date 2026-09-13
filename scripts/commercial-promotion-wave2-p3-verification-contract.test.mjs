import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');

const edge = read('supabase/functions/commercial-wave2-p3-verification/index.ts');
const repository = read('src/data/repositories/commercialWave2CanaryVerification.ts');
const contract = read('src/features/productIdentity/commercialWave2CanaryVerificationContract.ts');
const carrier = read('src/features/productIdentity/CommercialWave2CanaryVerificationCarrier.tsx');
const wrapper = read('src/features/productIdentity/ProductIdentityCommissioningWithSurvey.tsx');

const frozen = [
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
];

test('P3 freezes the exact promoted canary lineage', () => {
  for (const token of frozen) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(edge, new RegExp(escaped));
    assert.match(contract, new RegExp(escaped));
  }
  assert.match(contract, /setupStatus: 'mapping_draft'/);
  assert.match(contract, /auditActorRole: 'ADMIN'/);
  assert.match(contract, /expect\(value\.lineage\.commandCount, 1/);
  assert.match(contract, /expect\(value\.lineage\.promotionCount, 1/);
  assert.match(contract, /expect\(value\.lineage\.initialReplayed, false/);
});

test('dedicated P3 server carrier has zero database mutation or RPC capability', () => {
  assert.match(edge, /P3_VERIFY_READ_ONLY/);
  assert.match(edge, /auth\.getUser/);
  assert.match(edge, /\['OWNER', 'ADMIN'\]\.includes\(actor\.app_role\)/);
  assert.match(edge, /\.select\(/);
  assert.doesNotMatch(edge, /\.(?:insert|update|upsert|delete|rpc)\s*\(/);
  assert.doesNotMatch(edge, /ecoflow_(?:execute|promote|unlock|reconcile|repair|publish)/i);
  assert.doesNotMatch(edge, /P2B_CANARY_PROMOTION|P4_(?:UNLOCK|PROMOTION)/);
  assert.doesNotMatch(edge, /method\s*:\s*['"](?:PUT|PATCH|DELETE)['"]/i);
});

test('browser repository invokes only the authenticated verification mode', () => {
  assert.match(repository, /functions\.invoke\('commercial-wave2-p3-verification'/);
  assert.match(repository, /mode: 'P3_VERIFY_READ_ONLY'/);
  assert.doesNotMatch(repository, /\.(?:insert|update|upsert|delete|rpc)\s*\(/);
  assert.doesNotMatch(repository, /service[_-]?role|SUPABASE_SERVICE_ROLE_KEY|access[_-]?token|jwt/i);
  assert.doesNotMatch(repository, /promot|unlock|reconcile|repair|publish/i);
});

test('P3 UI is visibly verification-only and has no mutation control', () => {
  assert.match(carrier, /P3 verification-only/);
  assert.match(carrier, /Run authenticated P3 verification-only/);
  assert.match(carrier, /PASS \/ CANARY_VERIFIED \/ HOLD_AT_P4/);
  assert.match(carrier, /formatCommercialWave2P3VerificationFailure/);
  assert.match(contract, /HOLD_AT_P3/);
  assert.match(carrier, /aria-label="P4 expansion locked"/);
  assert.match(wrapper, /<CommercialWave2CanaryVerificationCarrier/);
  assert.doesNotMatch(carrier, /run(?:Promotion|Unlock|Edit|Retry|Reconcile|Repair|Publish)|Execute separately authorized|onClick=.*(?:promot|unlock|edit|retry|reconcile|repair|publish)/i);
  assert.doesNotMatch(carrier, /onChanged/);
  assert.doesNotMatch(carrier, /service[_-]?role|SUPABASE_SERVICE_ROLE_KEY|access[_-]?token|jwt/i);
});

test('P3 report actively proves negative space and unchanged sentinels', () => {
  for (const token of [
    'p4EnabledCandidates', 'nonCanaryPromotions', 'physicalSkus', 'packages',
    'barcodeBindings', 'inventoryMovements', 'warehouseMovements', 'locationItems',
    'inventoryBalances', 'imageAssets', 'imageCopyRuns', 'inventoryReferenceCommands',
    'ordermentumApiJobs', 'providerTraffic', 'callerSwitch', 'cutover',
    'noProductionBusinessMutation', 'p4Locked',
  ]) assert.match(edge + contract, new RegExp(token));
});
