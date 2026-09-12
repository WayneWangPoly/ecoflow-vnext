import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const read = async (path) => readFile(new URL(path, root), 'utf8');
const [migration, edge, contract, repository, carrier, wrapper, incumbent] = await Promise.all([
  read('supabase/migrations/20260913000000_commercial_wave2_plan_readiness.sql'),
  read('supabase/functions/trigger-unleashed-master-migration/index.ts'),
  read('src/features/productIdentity/commercialWave2PlanContract.ts'),
  read('src/data/repositories/commercialWave2Plan.ts'),
  read('src/features/productIdentity/CommercialWave2PlanCarrier.tsx'),
  read('src/features/productIdentity/ProductIdentityCommissioningWithSurvey.tsx'),
  read('supabase/migrations/20260910010000_commercial_promotion_wave2.sql'),
]);

const mainSha = '101617435b787d4ac5f4b636e0dc8f9284ff473c';
const cohortHash = '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a';
const commandId = '18dc00fd-ffe5-4d96-9e91-830d2686ff8e';

test('P1 freezes exact main, cohort, canary and one command', () => {
  for (const value of [mainSha, cohortHash, commandId]) assert.match(contract, new RegExp(value));
  assert.match(contract, /candidateCount: 164/);
  assert.match(contract, /canaryExternalProductCode: '140010'/);
  assert.match(contract, /canaryMappingRevision: 0/);
  assert.match(contract, /buildCommercialWave2PlanInput/);
});

test('server evidence recomputes the exact 164-row hash and fails closed', () => {
  assert.match(migration, /count\(distinct upper\(btrim\(a\.external_product_code\)\)\)/);
  assert.match(migration, /chr\(10\) order by a\.external_product_code collate "C"/);
  assert.match(migration, new RegExp(cohortHash));
  assert.match(migration, /v_count=164/);
  assert.match(migration, /v_eligible=164/);
  assert.match(migration, /v_hold_rows=0/);
  assert.match(migration, /COMMERCIAL_WAVE2_PLAN_GATE_DRIFT/);
  assert.match(migration, /COMMERCIAL_WAVE2_PLAN_POSTCONDITION_DRIFT/);
});

test('P0 and P1 are distinct authenticated edge modes without image planning', () => {
  assert.match(edge, /'WAVE2_PLAN_PREFLIGHT' \| 'WAVE2_PLAN'/);
  assert.equal((edge.match(/body\.mode === 'WAVE2_PLAN_PREFLIGHT'/g) ?? []).length, 1);
  assert.equal((edge.match(/body\.mode === 'WAVE2_PLAN'/g) ?? []).length, 1);
  const p0 = edge.slice(edge.indexOf("if (body.mode === 'WAVE2_PLAN_PREFLIGHT')"), edge.indexOf("if (body.mode === 'WAVE2_PLAN')"));
  const p1 = edge.slice(edge.indexOf("if (body.mode === 'WAVE2_PLAN')"), edge.indexOf("if (body.mode === 'PLAN')"));
  assert.match(p0, /ecoflow_read_commercial_wave2_plan_preflight/);
  assert.doesNotMatch(p0, /ensureAssetBucket|planAssets|COPY_IMAGES/);
  assert.match(p1, /ecoflow_plan_commercial_wave2/);
  assert.doesNotMatch(p1, /ensureAssetBucket|planAssets|COPY_IMAGES/);
  assert.match(edge, /body\.mode !== 'WAVE2_PLAN_PREFLIGHT'/);
});

test('modified Edge Function remains syntactically valid TypeScript', () => {
  const result = ts.transpileModule(edge, {
    fileName: 'supabase/functions/trigger-unleashed-master-migration/index.ts',
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      isolatedModules: true,
    },
  });
  const errors = (result.diagnostics ?? []).filter((item) => item.category === ts.DiagnosticCategory.Error);
  assert.deepEqual(errors.map((item) => ts.flattenDiagnosticMessageText(item.messageText, '\n')), []);
});

test('command ledger binds replay payload and preserves incumbent planner', () => {
  assert.match(migration, /create table if not exists public\.ecoflow_commercial_wave2_plan_commands/);
  assert.match(migration, /COMMAND_REPLAY_PAYLOAD_MISMATCH/);
  assert.match(migration, /public\.ecoflow_plan_unleashed_master_mappings\(/);
  assert.doesNotMatch(migration, /public\.ecoflow_plan_unleashed_master_mappings_core\(/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /COMMERCIAL_WAVE2_PLAN_COMPLETED/);
});

test('PLAN cannot unlock, promote, or create physical and quantity authority', () => {
  assert.doesNotMatch(migration, /\b(?:insert\s+into|update|delete\s+from)\s+public\.(?:ecoflow_physical_|inventory_|ecoflow_inventory|stock_|soh_|opening_)/i);
  assert.doesNotMatch(migration, /update\s+public\.ecoflow_commercial_wave2_candidates\s+set\s+enabled/i);
  assert.doesNotMatch(migration, /insert\s+into\s+public\.skus/i);
  assert.doesNotMatch(migration, /insert\s+into\s+public\.external_product_mappings/i);
  assert.match(migration, /'physicalAuthorityCreated',false/);
  assert.match(migration, /'inventoryAuthorityCreated',false/);
  assert.match(migration, /'imagePlanningIncluded',false/);
});

test('incumbent P2 and P4 authorities stay separate and retain their gates', () => {
  assert.match(incumbent, /create or replace function public\.ecoflow_unlock_commercial_wave2_canary/);
  assert.match(incumbent, /create or replace function public\.ecoflow_promote_commercial_wave2_sku/);
  assert.match(incumbent, /create or replace function public\.ecoflow_unlock_commercial_wave2_expansion/);
  assert.match(incumbent, /COMMERCIAL_WAVE2_HOLD_BLOCKED/);
  assert.match(incumbent, /COMMERCIAL_WAVE2_CANARY_EXACT_MATCH_NOT_PROVEN/);
  assert.match(incumbent, /v_eligible<>163/);
});

test('browser carrier requires P0 before one P1 attempt and locks P2-P4', () => {
  assert.match(carrier, /role === 'owner' \|\| role === 'admin'/);
  assert.match(carrier, /if \(!authorized\) return null/);
  assert.equal((carrier.match(/readCommercialWave2PlanPreflight\(\)/g) ?? []).length, 1);
  assert.equal((carrier.match(/planCommercialWave2\(\)/g) ?? []).length, 1);
  assert.ok(carrier.indexOf('assertCommercialWave2PlanPreflight(preflight)') < carrier.indexOf('setPlanAttempted(true)'));
  assert.ok(carrier.indexOf('setPlanAttempted(true)') < carrier.indexOf('await planCommercialWave2()'));
  for (const stage of ['P0 · SELECT-only preflight', 'P1 · PLAN', 'P2 · CANARY UNLOCK / PROMOTION', 'P3 · CANARY SELECT-only verification', 'P4 · 163-candidate expansion']) {
    assert.match(carrier, new RegExp(stage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(carrier, /disabled aria-label="P2/);
  assert.match(carrier, /disabled aria-label="P3/);
  assert.match(carrier, /disabled aria-label="P4/);
  assert.doesNotMatch(carrier, /unlockCommercial|promoteCommercial|expandCommercial/);
  assert.doesNotMatch(repository, /service[_-]?role|access[_-]?token|jwt/i);
  assert.match(wrapper, /<CommercialWave2PlanCarrier/);
});

test('P0 repository is read-only and P1 cannot be implicit', () => {
  assert.equal((repository.match(/mode: 'WAVE2_PLAN_PREFLIGHT'/g) ?? []).length, 1);
  assert.equal((repository.match(/mode: 'WAVE2_PLAN'/g) ?? []).length, 1);
  assert.doesNotMatch(repository, /\.from\(|\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
  assert.doesNotMatch(repository, /AUTHORIZE_ASSETS|COPY_IMAGES|PUBLISH/);
});
