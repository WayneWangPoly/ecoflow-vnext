import { readFile, writeFile } from 'node:fs/promises';

const path = 'scripts/unleashed-readonly-connector-contract.test.mjs';
let source = await readFile(path, 'utf8');

function replaceTest(startMarker, nextMarker, replacement) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`START_NOT_FOUND:${startMarker}`);
  if (source.indexOf(startMarker, start + 1) >= 0) throw new Error(`START_AMBIGUOUS:${startMarker}`);
  const end = source.indexOf(nextMarker, start);
  if (end < 0) throw new Error(`END_NOT_FOUND:${nextMarker}`);
  source = source.slice(0, start) + replacement + source.slice(end);
}

replaceTest(
  "test('Snapshot replay writes only inserted or payload-changed records', () => {",
  "\ntest('Migration creates source-owned staging tables with RLS and browser write denial', () => {",
  `test('Snapshot replay stages only inserted or payload-changed records through the fenced DB commit', () => {
  assert.match(edgeFunction, /select\\('external_key,payload_sha256'\\)/);
  assert.match(edgeFunction, /existingHash === row\\.payload_sha256\\) unchanged\\.push\\(row\\)/);
  assert.match(edgeFunction, /semanticRows = \\[\\.\\.\\.classifiedRows\\.inserted, \\.\\.\\.classifiedRows\\.changed\\]/);
  assert.match(edgeFunction, /stagedOnPage = insertedOnPage \\+ changedOnPage/);
  assert.match(edgeFunction, /records_unchanged: recordsUnchanged/);
  assert.match(edgeFunction, /select\\('external_key,latest_payload_sha256'\\)/);
  assert.match(edgeFunction, /identityRowsNeedingWrite/);
  assert.match(edgeFunction, /ecoflow_commit_unleashed_snapshot_page/);
  assert.match(edgeFunction, /p_snapshot_rows: semanticRows/);
  assert.match(edgeFunction, /p_identity_rows: identitiesNeedingWrite/);
  assert.doesNotMatch(edgeFunction, /\\.from\\('unleashed_raw_snapshots'\\)[\\s\\S]{0,300}\\.upsert\\(/);
  assert.doesNotMatch(edgeFunction, /\\.from\\('unleashed_external_identities'\\)[\\s\\S]{0,300}\\.upsert\\(/);
  assert.match(edgeFunction, /identity_writes: identityWritesOnPage/);
  assert.match(edgeFunction, /externalKey: \`product:\\\${guid\\.toLowerCase\\(\\)}:warehouse:\\\${warehouseIdentity\\.toLowerCase\\(\\)}\`/);
});`,
);

replaceTest(
  "test('windowed continuation is chained and cannot promote an incomplete cursor', () => {",
  '',
  `test('windowed continuation is chained and cursor publication is DB-fenced', () => {
  assert.match(edgeFunction, /const HARD_MAX_PAGES = 5/);
  assert.match(edgeFunction, /startPage\\?: number/);
  assert.match(edgeFunction, /previousRunId\\?: string \\| null/);
  assert.match(edgeFunction, /CONTINUATION_REQUIRES_ONE_RESOURCE/);
  assert.match(edgeFunction, /CONTINUATION_WITH_MODIFIED_SINCE_UNSUPPORTED/);
  assert.match(edgeFunction, /CONTINUATION_PREVIOUS_RUN_REQUIRED/);
  assert.match(edgeFunction, /CONTINUATION_PREVIOUS_RUN_MISMATCH/);
  assert.match(edgeFunction, /const matchingPreviousWindows = previousWindows\\.filter/);
  assert.match(edgeFunction, /previousRun\\.resource_set\\.includes\\(resources\\[0\\]\\)/);
  assert.match(edgeFunction, /matchingPreviousWindows\\.length !== 1/);
  assert.match(edgeFunction, /previousNextPage !== startPage/);
  assert.match(edgeFunction, /UNLEASHED_PAGINATION_TOTAL_DRIFT/);
  assert.match(edgeFunction, /const windowEndPage = resourceStartPage \\+ maxPages - 1/);
  assert.match(edgeFunction, /const cursorStatus = resourceFailed \\? 'FAILED' : windowEvidence\\.windowComplete \\? 'READY' : 'RUNNING'/);
  assert.match(edgeFunction, /ecoflow_finalize_unleashed_snapshot_resource/);
  assert.match(edgeFunction, /p_cursor_status: cursorStatus/);
  assert.match(edgeFunction, /p_window: \\{[\\s\\S]*start_page: windowEvidence\\.startPage[\\s\\S]*window_complete: windowEvidence\\.windowComplete[\\s\\S]*next_page: windowEvidence\\.nextPage[\\s\\S]*previous_run_id: previousRunId/);
  assert.match(edgeFunction, /p_requested_modified_since: modifiedSince/);
  assert.match(edgeFunction, /p_high_watermark: resourceHighWatermark/);
  assert.match(edgeFunction, /if \\(target\\) \\{[\\s\\S]*ecoflow_release_unleashed_targeted_snapshot_acquisition[\\s\\S]*\\} else if \\(!resourceFailed \\|\\| resourceFailureEvidenceReady\\) \\{[\\s\\S]*ecoflow_finalize_unleashed_snapshot_resource/);
  assert.doesNotMatch(edgeFunction, /\\.from\\('unleashed_resource_cursors'\\)[\\s\\S]{0,400}\\.(?:upsert|update|insert)\\(/);
  assert.match(edgeFunction, /all_resources_complete: allResourcesComplete/);
  assert.match(edgeFunction, /pagination_windows: resourceWindows\\.map/);
});`,
);

await writeFile(path, source);
