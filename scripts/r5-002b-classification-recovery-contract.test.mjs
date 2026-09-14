import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  POSTGREST_CLASSIFICATION_IN_FILTER_BUDGET,
  classifyPayloadRows,
  partitionExternalKeysForInFilter,
} from '../supabase/functions/trigger-unleashed-readonly-sync/core.ts';

const edgePath = 'supabase/functions/trigger-unleashed-readonly-sync/index.ts';
const panelPath = 'src/features/settings/UnleashedReadonlyProbePanel.tsx';
const [edge, panel] = await Promise.all([
  readFile(edgePath, 'utf8'),
  readFile(panelPath, 'utf8'),
]);

function stockKey(index) {
  const suffix = index.toString(16).padStart(12, '0');
  return `product:00000000-0000-4000-8000-${suffix}:warehouse:5944dad4-74ff-46eb-b9b2-e7669938cb5f`;
}

function encodedChunkLength(chunk) {
  return chunk.reduce((total, key, index) => total + encodeURIComponent(key).length + (index ? 3 : 0), 0);
}

test('200 long StockOnHand keys are partitioned under the encoded PostgREST filter budget', () => {
  const keys = Array.from({ length: 200 }, (_, index) => stockKey(index));
  const chunks = partitionExternalKeysForInFilter(keys);
  assert.ok(chunks.length > 1);
  assert.deepEqual(chunks.flat(), keys);
  assert.equal(new Set(chunks.flat()).size, 200);
  assert.ok(chunks.every((chunk) => encodedChunkLength(chunk) <= POSTGREST_CLASSIFICATION_IN_FILTER_BUDGET));
});

test('classification semantics reconcile inserted/changed/unchanged exactly', () => {
  const rows = Array.from({ length: 200 }, (_, index) => ({
    external_key: stockKey(index),
    payload_sha256: `new-${index}`,
  }));
  const existing = [
    ...rows.slice(0, 70),
    ...rows.slice(70, 130).map((row, index) => ({ ...row, payload_sha256: `old-${index}` })),
  ];
  const result = classifyPayloadRows(existing, rows);
  assert.equal(result.unchanged.length, 70);
  assert.equal(result.changed.length, 60);
  assert.equal(result.inserted.length, 70);
  assert.equal(result.unchanged.length + result.changed.length + result.inserted.length, 200);
});

test('classification chunker rejects pages beyond the connector page bound', () => {
  assert.throws(
    () => partitionExternalKeysForInFilter(Array.from({ length: 201 }, (_, index) => stockKey(index))),
    /CLASSIFICATION_KEY_COUNT_EXCEEDS_PAGE_BOUND/,
  );
});

test('both classification readers are bounded and page commit remains after classification', () => {
  assert.equal((edge.match(/partitionExternalKeysForInFilter\(rows\.map\(\(row\) => row\.external_key\)\)/g) ?? []).length, 2);
  assert.doesNotMatch(edge, /\.in\('external_key', rows\.map\(/);
  const rawClassify = edge.indexOf('async function classifySnapshotRows');
  const identityClassify = edge.indexOf('async function identityRowsNeedingWrite');
  const pageCommit = edge.indexOf("adminClient.rpc('ecoflow_commit_unleashed_snapshot_page'");
  assert.ok(rawClassify >= 0 && identityClassify > rawClassify && pageCommit > identityClassify);
});

test('R5-002-R2 exists only as a dormant server-side recovery carrier', () => {
  assert.match(edge, /R5_002_R2_REQUEST_KEY = 'ECOFLOW-R5-002-R2'/);
  assert.match(edge, /R5_002_R2_DORMANT_NOT_ACTIVATED/);
  assert.match(edge, /R5_002_R2_ORIGINAL_FAILURE_MISMATCH/);
  assert.match(edge, /R5_002_R2_ORIGINAL_RUN_HAS_SNAPSHOT_WRITES/);
  assert.match(edge, /original\.records_staged === 0/);
  assert.match(edge, /original\.error_message\.startsWith\('UNLEASHED_RAW_SNAPSHOT_CLASSIFY_FAILED:'\)/);
  assert.doesNotMatch(panel, /ECOFLOW-R5-002-R2/);
});

test('warehouse MANY production boundary remains frozen', () => {
  assert.match(edge, /input\.body\.pageSize === 200/);
  assert.match(edge, /input\.body\.maxPages === 5/);
  assert.match(edge, /input\.body\.target\.warehouseCode === 'ADL1'/);
  assert.match(edge, /input\.modifiedSince === null/);
  assert.match(edge, /input\.startPage === 1/);
  assert.match(edge, /input\.previousRunId === null/);
  assert.match(edge, /ecoflow_abort_unleashed_warehouse_snapshot_acquisition/);
  assert.match(edge, /ecoflow_release_unleashed_warehouse_snapshot_acquisition/);
});
