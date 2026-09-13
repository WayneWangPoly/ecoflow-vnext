import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const read = async (path) => readFile(new URL(path, root), 'utf8');
const [migration, edge, contract, repository, carrier, incumbent, p1Migration, p1Contract] = await Promise.all([
  read('supabase/migrations/20260913010000_commercial_wave2_p2a_canary_unlock_carrier.sql'),
  read('supabase/functions/trigger-unleashed-master-migration/index.ts'),
  read('src/features/productIdentity/commercialWave2CanaryUnlockContract.ts'),
  read('src/data/repositories/commercialWave2CanaryUnlock.ts'),
  read('src/features/productIdentity/CommercialWave2PlanCarrier.tsx'),
  read('supabase/migrations/20260910010000_commercial_promotion_wave2.sql'),
  read('supabase/migrations/20260913000000_commercial_wave2_plan_readiness.sql'),
  read('src/features/productIdentity/commercialWave2PlanContract.ts'),
]);

const planCommandId = '18dc00fd-ffe5-4d96-9e91-830d2686ff8e';
const unlockCommandId = '61b13a7c-18d1-48f0-b317-96d23607ddfb';
const cohortHash = '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a';
const canaryMappingId = '3001d0f1-6c1b-4b15-98a0-91443ca6b525';
const canarySourceSha = '016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8';
const canarySourceKey = 'guid:e80b9e1d-f33d-4ebf-b76d-dfdd9beb1a7b';

test('P2A freezes the incumbent post-P1 evidence and one unlock command', () => {
  for (const value of [planCommandId, unlockCommandId, cohortHash, canaryMappingId, canarySourceSha, canarySourceKey]) {
    assert.match(`${contract}\n${p1Contract}`, new RegExp(value));
    assert.match(migration, new RegExp(value));
  }
  assert.match(contract, /carrierBaseSha: '46a59b10e1846d9cd35c0bae83e93f81f5344218'/);
  assert.match(p1Contract, /candidateCount: 164/);
  assert.match(p1Contract, /canaryExternalProductCode: '140010'/);
  assert.match(p1Contract, /canaryMappingRevision: 0/);
});

test('post-P1 preflight requires the exact completed PLAN and does not reuse P0 readiness', () => {
  assert.match(migration, /\(v_evidence->>'planCommandCount'\)::bigint=1/);
  assert.match(migration, /v_exact_plan_commands=1/);
  assert.match(migration, /v_plan_audits=1/);
  assert.match(migration, /'p0Ready',coalesce\(\(v_evidence->>'ready'\)::boolean,false\)/);
  assert.match(migration, /'stage','P2A_SELECT_ONLY'/);
  assert.doesNotMatch(migration, /v_ready[^;]+planCommandCount'\)::bigint=0/s);
  assert.match(contract, /expect\(value\.p0Ready, false/);
  assert.match(contract, /expect\(value\.planCommandCount, 1/);
});

test('authenticated Edge modes keep preflight SELECT-only and mutation command-bound', () => {
  assert.match(edge, /'WAVE2_CANARY_UNLOCK_PREFLIGHT' \| 'WAVE2_CANARY_UNLOCK'/);
  assert.equal((edge.match(/body\.mode === 'WAVE2_CANARY_UNLOCK_PREFLIGHT'/g) ?? []).length, 1);
  assert.equal((edge.match(/body\.mode === 'WAVE2_CANARY_UNLOCK'/g) ?? []).length, 1);
  const preflight = edge.slice(
    edge.indexOf("if (body.mode === 'WAVE2_CANARY_UNLOCK_PREFLIGHT')"),
    edge.indexOf("if (body.mode === 'WAVE2_CANARY_UNLOCK')"),
  );
  const unlock = edge.slice(
    edge.indexOf("if (body.mode === 'WAVE2_CANARY_UNLOCK')"),
    edge.indexOf("if (body.mode === 'PLAN')"),
  );
  assert.match(preflight, /ecoflow_read_commercial_wave2_canary_unlock_preflight/);
  assert.doesNotMatch(preflight, /recordAudit|\.insert\(|\.update\(|COPY_IMAGES|planAssets|ensureAssetBucket/);
  assert.match(unlock, /ecoflow_execute_commercial_wave2_canary_unlock/);
  assert.doesNotMatch(unlock, /ecoflow_promote_commercial_wave2_sku|COPY_IMAGES|planAssets|ensureAssetBucket/);
  assert.match(edge, /body\.mode !== 'WAVE2_PLAN_PREFLIGHT' && body\.mode !== 'WAVE2_CANARY_UNLOCK_PREFLIGHT'/);
});

test('P2A wrapper delegates the only write to incumbent authority and reuses its ledger', () => {
  assert.match(migration, /public\.ecoflow_unlock_commercial_wave2_canary\(/);
  assert.equal((migration.match(/v_incumbent_result:=public\.ecoflow_unlock_commercial_wave2_canary\(/g) ?? []).length, 1);
  assert.doesNotMatch(migration, /create table/);
  assert.doesNotMatch(migration, /insert\s+into\s+public\.ecoflow_commercial_wave2_unlock_commands/i);
  assert.doesNotMatch(migration, /update\s+public\.ecoflow_commercial_wave2_candidates/i);
  assert.doesNotMatch(migration, /ecoflow_promote_commercial_wave2_sku/);
  assert.match(incumbent, /pg_advisory_xact_lock\(pg_catalog\.hashtextextended\('ecoflow_commercial_wave2_unlock:CANARY'/);
  assert.match(incumbent, /COMMAND_REPLAY_PAYLOAD_MISMATCH/);
});

test('P2A cannot create commercial, physical, quantity, image, or provider authority', () => {
  const implementation = `${migration}\n${repository}\n${carrier}`;
  assert.doesNotMatch(migration, /\b(?:insert\s+into|update|delete\s+from)\s+public\.(?:skus|external_product_mappings|ecoflow_product_identity|ecoflow_sku_families|ecoflow_physical|ecoflow_commercial_family_links|inventory|ecoflow_inventory|ecoflow_warehouse|stock|ecoflow_unleashed_product_assets|ecoflow_unleashed_asset_copy_runs)/i);
  assert.doesNotMatch(implementation, /fetch\s*\(|api\.unleashedsoftware\.com|api\.ordermentum\.com/);
  assert.match(migration, /'physicalAuthorityCreated',false/);
  assert.match(migration, /'inventoryAuthorityCreated',false/);
  assert.match(migration, /'imageActionIncluded',false/);
});

test('browser cannot combine P2A with P2B or expansion', () => {
  assert.match(carrier, /role === 'owner' \|\| role === 'admin'/);
  assert.match(carrier, /if \(!authorized\) return null/);
  assert.equal((carrier.match(/readCommercialWave2CanaryUnlockPreflight\(\)/g) ?? []).length, 1);
  assert.equal((carrier.match(/unlockCommercialWave2Canary\(\)/g) ?? []).length, 1);
  assert.ok(carrier.indexOf('assertCommercialWave2CanaryUnlockPreflight(preflight)') < carrier.indexOf('setUnlockAttempted(true)'));
  assert.ok(carrier.indexOf('setUnlockAttempted(true)') < carrier.indexOf('await unlockCommercialWave2Canary()'));
  for (const label of ['P0 complete read-only', 'P1 complete read-only', 'P2B promotion locked', 'P3 locked', 'P4 locked']) {
    assert.match(carrier, new RegExp(`aria-label="${label}"`));
  }
  assert.doesNotMatch(carrier, /promoteCommercial|expandCommercial/);
  assert.doesNotMatch(repository, /service[_-]?role|access[_-]?token|jwt/i);
});

test('repository sends one explicit preflight mode and one explicit unlock mode', () => {
  assert.equal((repository.match(/mode: 'WAVE2_CANARY_UNLOCK_PREFLIGHT'/g) ?? []).length, 1);
  assert.equal((repository.match(/mode: 'WAVE2_CANARY_UNLOCK'/g) ?? []).length, 1);
  assert.match(repository, /buildCommercialWave2CanaryUnlockPreflightInput/);
  assert.match(repository, /buildCommercialWave2CanaryUnlockInput/);
});

test('P0/P1 and incumbent Wave2 contracts remain present', () => {
  assert.match(edge, /body\.mode === 'WAVE2_PLAN_PREFLIGHT'/);
  assert.match(edge, /body\.mode === 'WAVE2_PLAN'/);
  assert.match(p1Migration, /create or replace function public\.ecoflow_plan_commercial_wave2/);
  assert.match(incumbent, /create or replace function public\.ecoflow_promote_commercial_wave2_sku/);
  assert.match(incumbent, /create or replace function public\.ecoflow_unlock_commercial_wave2_expansion/);
});

test('modified TypeScript files remain syntactically valid', () => {
  for (const [fileName, source] of [
    ['trigger-unleashed-master-migration/index.ts', edge],
    ['commercialWave2CanaryUnlockContract.ts', contract],
    ['commercialWave2CanaryUnlock.ts', repository],
    ['CommercialWave2PlanCarrier.tsx', carrier],
  ]) {
    const result = ts.transpileModule(source, {
      fileName,
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        jsx: ts.JsxEmit.ReactJSX,
        isolatedModules: true,
      },
    });
    const errors = (result.diagnostics ?? []).filter((item) => item.category === ts.DiagnosticCategory.Error);
    assert.deepEqual(errors.map((item) => ts.flattenDiagnosticMessageText(item.messageText, '\n')), []);
  }
});
