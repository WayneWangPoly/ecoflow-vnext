import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const edge = readFileSync('supabase/functions/trigger-unleashed-master-migration/index.ts', 'utf8');
const helper = readFileSync('supabase/functions/trigger-unleashed-master-migration/mappingPlanOnly.ts', 'utf8');
const client = readFileSync('src/features/team/unleashedMappingPlanOnly.ts', 'utf8');
const panel = readFileSync('src/features/settings/MappingPlanOnlyPanel.tsx', 'utf8');
const host = readFileSync('src/features/settings/UnleashedReadonlyProbePanel.tsx', 'utf8');

const BASELINE_MAIN = '4f463eedf8c8343739d032eb08dd862f7aa15fe1';
const BATCH = '4cdb85d3-06d8-44bf-96bb-93660e10c3c9';
const SET_SHA = '215e9abeef4f291ac4324c07e968bb6f6c6d065e34eaed726750ce61e312d77d';
const COHORT_SHA = '8e5974ea2ef8725977c2c38c135d517d1595cc2064bd6f03b9801e1b03adb020';
const FAILED_COMMAND = 'bf35619d-a5e9-444d-a35f-b4af95083ef8';

test('R5-006 preserves original frozen evidence and accepted final state', () => {
  for (const value of [BASELINE_MAIN, BATCH, SET_SHA, COHORT_SHA, FAILED_COMMAND]) {
    assert.match(helper, new RegExp(value));
  }
  for (const [field, value] of [
    ['referenceRowCount', 427],
    ['autoMatchableCount', 151],
    ['acceptedExactMappingCount', 164],
    ['acceptedReferenceCount', 153],
    ['acceptedOutsideReferenceCount', 11],
    ['acceptedCodeDriftReferenceCount', 2],
    ['finalPendingProductMappingCount', 94],
    ['finalPendingPhysicalIdentityCount', 329],
    ['finalReadyForLocationEvidenceCount', 4],
    ['plannerPlannedCount', 1300],
    ['plannerMatchedCount', 345],
    ['plannerUnmatchedCount', 954],
  ]) {
    assert.match(helper, new RegExp(`${field}: ${value}`));
  }
});

test('Edge R5-006 execution is permanently fail-closed', () => {
  assert.match(edge, /MAPPING_PLAN_ONLY_RECONCILE/);
  assert.match(edge, /R5_006_MAPPING_PLAN_ONLY_DISABLED_ACCEPTED_STATE/);
  assert.match(edge, /readR5006AcceptedMappingReconciliation/);

  const executionStart = edge.indexOf("if (body.mode === 'MAPPING_PLAN_ONLY')");
  const nextMode = edge.indexOf("if (body.mode === 'WAVE2_PLAN_PREFLIGHT')");
  assert.ok(executionStart >= 0 && nextMode > executionStart);
  const executionBlock = edge.slice(executionStart, nextMode);

  assert.match(executionBlock, /R5_006_MAPPING_PLAN_ONLY_DISABLED_ACCEPTED_STATE/);
  assert.doesNotMatch(executionBlock, /ecoflow_plan_unleashed_master_mappings/);
  assert.doesNotMatch(executionBlock, /planAssets\(/);
  assert.doesNotMatch(executionBlock, /ensureAssetBucket\(/);
  assert.doesNotMatch(executionBlock, /UNLEASHED_MAPPING_PLAN_ONLY_EXECUTED/);
});

test('reconciliation mode is read-only and does not write rejection audits on read failure', () => {
  assert.match(edge, /body\.mode === 'MAPPING_PLAN_ONLY_RECONCILE'/);
  assert.match(edge, /computeR5006AcceptedReconciliation/);
  assert.match(edge, /body\.mode !== 'MAPPING_PLAN_ONLY_RECONCILE'/);

  const reconcileStart = edge.indexOf("if (body.mode === 'MAPPING_PLAN_ONLY_RECONCILE')");
  const executionStart = edge.indexOf("if (body.mode === 'MAPPING_PLAN_ONLY')");
  assert.ok(reconcileStart >= 0 && executionStart > reconcileStart);
  const reconcileBlock = edge.slice(reconcileStart, executionStart);
  assert.doesNotMatch(reconcileBlock, /\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/);
  assert.doesNotMatch(reconcileBlock, /recordAudit/);
});

test('browser surface exposes reconciliation only and no PLAN command', () => {
  assert.match(client, /mode: 'MAPPING_PLAN_ONLY_RECONCILE'/);
  assert.doesNotMatch(client, /mode: 'MAPPING_PLAN_ONLY'/);
  assert.doesNotMatch(client, /runR5006MappingPlanOnly/);

  assert.match(panel, /执行入口已关闭/);
  assert.match(panel, /刷新只读核对/);
  assert.match(panel, /执行已永久禁用/);
  assert.doesNotMatch(panel, /runR5006MappingPlanOnly|void execute\(|function execute\(/);
  assert.doesNotMatch(panel, /checkbox/);
  assert.doesNotMatch(panel, /crypto\.randomUUID/);

  assert.match(host, /lazy\(async \(\) =>/);
  assert.match(host, /import\('\.\/MappingPlanOnlyPanel'\)/);
  assert.match(host, /default:\s*module\.MappingPlanOnlyPanel/);
  assert.match(host, /<Suspense/);
});

test('accepted reconciliation remains outside inventory and Physical Identity authority', () => {
  for (const source of [edge, client, panel, helper]) {
    assert.doesNotMatch(
      source.includes('MAPPING_PLAN_ONLY_RECONCILE')
        ? source.slice(
            source.indexOf('MAPPING_PLAN_ONLY_RECONCILE'),
            Math.max(source.indexOf('MAPPING_PLAN_ONLY_RECONCILE') + 1, source.length),
          )
        : source,
      /ecoflow_approve_stocktake_session|ecoflow_materialize_ready_initial_stocktake|ecoflow_record_ready_inventory_commissioning_location|ecoflow_publish_product_identity_batch|ecoflow_capture_product_identity/,
    );
  }
});
