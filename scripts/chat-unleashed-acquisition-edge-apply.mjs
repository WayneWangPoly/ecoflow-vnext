import { readFile, writeFile } from 'node:fs/promises';

const indexPath = 'supabase/functions/trigger-unleashed-readonly-sync/index.ts';
const loopTemplatePath = 'scripts/chat-unleashed-acquisition-edge-loop.template.txt';
const staticPath = 'scripts/unleashed-snapshot-acquisition-fencing-contract.test.mjs';

function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0) throw new Error(`PATCH_ANCHOR_MISSING:${label}`);
  if (source.indexOf(search, first + search.length) >= 0) throw new Error(`PATCH_ANCHOR_AMBIGUOUS:${label}`);
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

function replaceBetween(source, start, end, replacement, label) {
  const a = source.indexOf(start);
  if (a < 0) throw new Error(`PATCH_START_MISSING:${label}`);
  const b = source.indexOf(end, a + start.length);
  if (b < 0) throw new Error(`PATCH_END_MISSING:${label}`);
  if (source.indexOf(start, a + start.length) >= 0) throw new Error(`PATCH_START_AMBIGUOUS:${label}`);
  return source.slice(0, a) + replacement + source.slice(b);
}

let index = await readFile(indexPath, 'utf8');
const loopReplacement = await readFile(loopTemplatePath, 'utf8');

const serveAnchor = '\nDeno.serve(async (req) => {';
const dryRunHelper = `
// Dry-run/recheck evidence is deliberately the only direct batch write left in
// the Edge Function. Every non-dry snapshot write is fenced by DB-owned RPCs.
async function insertDryRunBatch(
  adminClient: ReturnType<typeof createClient>,
  row: Record<string, unknown>,
) {
  const { data, error } = await adminClient
    .from('unleashed_sync_batches')
    .insert(row)
    .select('id')
    .single();
  if (error || !data) throw new Error('UNLEASHED_DRY_RUN_BATCH_CREATE_FAILED:' + (error?.message ?? 'UNKNOWN'));
  return data;
}
`;
index = replaceOnce(index, serveAnchor, `${dryRunHelper}${serveAnchor}`, 'dry-run batch helper');

const loopStart = '  for (const resource of resources) {';
const loopEnd = "  finalStatus = recordsFailed === 0 ? 'SUCCEEDED' : pageResults.length ? 'PARTIAL' : 'FAILED';";
index = replaceBetween(index, loopStart, loopEnd, loopReplacement, 'resource acquisition loop');
await writeFile(indexPath, index);

const staticContract = `import test from 'node:test';
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
  assert.match(loop, /p_snapshot_rows:\s*semanticRows/);
  assert.match(loop, /p_identity_rows:\s*identitiesNeedingWrite/);
});

test('targeted writes release the lease without full-resource cursor publication', () => {
  const targetBranch = loop.indexOf('if (target) {');
  const releaseCall = loop.indexOf('ecoflow_release_unleashed_targeted_snapshot_acquisition', targetBranch);
  const finalizeCall = loop.indexOf('ecoflow_finalize_unleashed_snapshot_resource', releaseCall);
  assert.ok(targetBranch >= 0 && releaseCall > targetBranch && finalizeCall > releaseCall);
});

test('direct batch inserts are confined to the dry-run helper', () => {
  const directBatchWrites = edge.match(/\.from\('unleashed_sync_batches'\)\s*\.insert\(/g) ?? [];
  assert.equal(directBatchWrites.length, 1);
  assert.match(edge, /async function insertDryRunBatch\(/);
  assert.ok(!loop.includes(".from('unleashed_sync_batches')"));
});

test('fencing tokens are not returned or copied into audit evidence', () => {
  const finalEvidenceStart = edge.indexOf("  const { error: updateError } = await adminClient.from('unleashed_sync_runs').update({");
  assert.ok(finalEvidenceStart >= 0);
  const finalEvidence = edge.slice(finalEvidenceStart);
  assert.ok(!finalEvidence.includes('acquisitionLeaseToken'));
  assert.ok(!finalEvidence.includes('leaseToken'));
});
`;
await writeFile(staticPath, staticContract);
