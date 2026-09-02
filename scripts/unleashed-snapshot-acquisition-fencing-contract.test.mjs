import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const edge = await readFile('supabase/functions/trigger-unleashed-readonly-sync/index.ts', 'utf8');
const loopStart = edge.indexOf('  for (const resource of resources) {');
const loopEnd = edge.indexOf("  finalStatus = recordsFailed === 0 ? 'SUCCEEDED' : pageResults.length ? 'PARTIAL' : 'FAILED';", loopStart);
assert.ok(loopStart >= 0 && loopEnd > loopStart, 'resource acquisition loop must be discoverable');
const loop = edge.slice(loopStart, loopEnd);

test('non-dry acquisition authority is DB fenced', () => {
  for (const table of ['unleashed_raw_snapshots', 'unleashed_external_identities', 'unleashed_resource_cursors']) {
    assert.ok(!loop.includes(".from('" + table + "')"), 'resource loop must not directly mutate ' + table);
  }
  assert.match(loop, /ecoflow_claim_unleashed_snapshot_acquisition/);
  assert.match(loop, /ecoflow_commit_unleashed_snapshot_page/);
  assert.match(loop, /ecoflow_record_unleashed_snapshot_page_failure/);
  assert.match(loop, /ecoflow_finalize_unleashed_snapshot_resource/);
  assert.match(loop, /ecoflow_release_unleashed_targeted_snapshot_acquisition/);
  assert.ok(loop.includes('p_snapshot_rows: semanticRows'));
  assert.ok(loop.includes('p_identity_rows: identitiesNeedingWrite'));
});

test('targeted writes release the lease without full-resource cursor publication', () => {
  const targetBranch = loop.indexOf('if (target) {');
  const releaseCall = loop.indexOf('ecoflow_release_unleashed_targeted_snapshot_acquisition', targetBranch);
  const finalizeCall = loop.indexOf('ecoflow_finalize_unleashed_snapshot_resource', releaseCall);
  assert.ok(targetBranch >= 0 && releaseCall > targetBranch && finalizeCall > releaseCall);
});

test('direct batch inserts are confined to the dry-run helper', () => {
  const marker = ".from('unleashed_sync_batches')";
  let count = 0;
  for (let offset = 0; ; ) {
    const found = edge.indexOf(marker, offset);
    if (found < 0) break;
    count += 1;
    offset = found + marker.length;
  }
  assert.equal(count, 1);
  assert.ok(edge.includes('async function insertDryRunBatch('));
  assert.ok(!loop.includes(marker));
});

test('fencing tokens are not returned or copied into audit evidence', () => {
  const finalEvidenceStart = edge.indexOf("  const { error: updateError } = await adminClient.from('unleashed_sync_runs').update({");
  assert.ok(finalEvidenceStart >= 0);
  const finalEvidence = edge.slice(finalEvidenceStart);
  assert.ok(!finalEvidence.includes('acquisitionLeaseToken'));
  assert.ok(!finalEvidence.includes('leaseToken'));
});
