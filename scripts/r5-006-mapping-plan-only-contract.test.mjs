import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const edge = readFileSync('supabase/functions/trigger-unleashed-master-migration/index.ts', 'utf8');
const helper = readFileSync('supabase/functions/trigger-unleashed-master-migration/mappingPlanOnly.ts', 'utf8');
const client = readFileSync('src/features/team/unleashedMappingPlanOnly.ts', 'utf8');
const panel = readFileSync('src/features/settings/MappingPlanOnlyPanel.tsx', 'utf8');
const host = readFileSync('src/features/settings/UnleashedReadonlyProbePanel.tsx', 'utf8');

const MAIN = '2545fd0c455f36f157c5609eff36d147f0c925b3';
const BATCH = '4cdb85d3-06d8-44bf-96bb-93660e10c3c9';
const SET_SHA = '215e9abeef4f291ac4324c07e968bb6f6c6d065e34eaed726750ce61e312d77d';
const COHORT_SHA = '8e5974ea2ef8725977c2c38c135d517d1595cc2064bd6f03b9801e1b03adb020';

test('R5-006 freezes the production cohort and predicted readiness transition', () => {
  for (const value of [MAIN, BATCH, SET_SHA, COHORT_SHA]) assert.match(helper, new RegExp(value));
  for (const [field, value] of [
    ['referenceRowCount', 427],
    ['pendingProductMappingCount', 247],
    ['pendingPhysicalIdentityCount', 176],
    ['readyForLocationEvidenceCount', 4],
    ['autoMatchableCount', 151],
    ['autoMatchablePositiveRows', 128],
    ['autoMatchablePositiveQty', 1675],
    ['noTargetCount', 96],
    ['ambiguousTargetCount', 0],
    ['predictedPendingProductMappingCount', 96],
    ['predictedPendingPhysicalIdentityCount', 327],
    ['predictedReadyForLocationEvidenceCount', 4],
  ]) {
    assert.match(helper, new RegExp(`${field}: ${value}`));
  }
});

test('Edge carrier exposes mapping-only preflight and execution without asset planning', () => {
  assert.match(edge, /MAPPING_PLAN_ONLY_PREFLIGHT/);
  assert.match(edge, /MAPPING_PLAN_ONLY/);
  assert.match(edge, /readR5006MappingPlanOnlyEvidence/);
  assert.match(edge, /ecoflow_plan_unleashed_master_mappings/);
  assert.match(edge, /UNLEASHED_MAPPING_PLAN_ONLY_EXECUTED/);
  assert.match(edge, /R5_006_MAPPING_PLAN_PREFLIGHT_HOLD/);
  assert.match(edge, /R5_006_MAPPING_PLAN_POSTFLIGHT_HOLD/);

  const start = edge.indexOf("if (body.mode === 'MAPPING_PLAN_ONLY')");
  const end = edge.indexOf("if (body.mode === 'WAVE2_PLAN_PREFLIGHT')");
  assert.ok(start >= 0 && end > start);
  const bounded = edge.slice(start, end);
  assert.doesNotMatch(bounded, /planAssets\(/);
  assert.doesNotMatch(bounded, /ensureAssetBucket\(/);
  assert.doesNotMatch(bounded, /COPY_IMAGES|AUTHORIZE_ASSETS/);
});

test('browser carrier is authenticated, preflight-gated and explicit', () => {
  assert.match(client, /mode: 'MAPPING_PLAN_ONLY_PREFLIGHT'/);
  assert.match(client, /mode: 'MAPPING_PLAN_ONLY'/);
  assert.match(client, new RegExp(MAIN));
  assert.match(client, new RegExp(COHORT_SHA));
  assert.match(panel, /!preflight\?\.ready/);
  assert.match(panel, /!acknowledged/);
  assert.match(panel, /No image planning, provider traffic, Physical Identity creation/);
  assert.match(host, /lazy\(async \(\) =>/);
  assert.match(host, /import\('\.\/MappingPlanOnlyPanel'\)/);
  assert.match(host, /default:\s*module\.MappingPlanOnlyPanel/);
  assert.match(host, /<Suspense/);
  assert.match(host, /<MappingPlanOnlyPanel supabase=\{supabase\} \/>/);
  assert.doesNotMatch(host, /import \{ MappingPlanOnlyPanel \} from '\.\/MappingPlanOnlyPanel'/);
});

test('mapping-only carrier contains no direct inventory or Physical Identity mutation surface', () => {
  for (const source of [client, panel]) {
    assert.doesNotMatch(source, /ecoflow_approve_stocktake_session|ecoflow_materialize_ready_initial_stocktake|ecoflow_record_ready_inventory_commissioning_location/);
    assert.doesNotMatch(source, /ecoflow_publish_product_identity_batch|ecoflow_capture_product_identity/);
  }
});
