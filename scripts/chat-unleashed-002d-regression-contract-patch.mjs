import { readFile, writeFile } from 'node:fs/promises';

const path = 'scripts/unleashed-readonly-connector-contract.test.mjs';
let source = await readFile(path, 'utf8');

const startMarker = "test('Snapshot replay writes only inserted or payload-changed records', () => {";
const nextMarker = "\ntest('Migration creates source-owned staging tables with RLS and browser write denial', () => {";
const start = source.indexOf(startMarker);
if (start < 0) throw new Error('REGRESSION_START_NOT_FOUND');
if (source.indexOf(startMarker, start + 1) >= 0) throw new Error('REGRESSION_START_AMBIGUOUS');
const end = source.indexOf(nextMarker, start);
if (end < 0) throw new Error('REGRESSION_END_NOT_FOUND');

const after = `test('Snapshot replay stages only inserted or payload-changed records through the fenced DB commit', () => {
  assert.match(edgeFunction, /select\\('external_key,payload_sha256'\\)/);
  assert.match(edgeFunction, /existingHash === row\\.payload_sha256\\) unchanged\\.push\\(row\\)/);
  assert.match(edgeFunction, /const semanticRows = \\[\\.\\.\\.classifiedRows\\.inserted, \\.\\.\\.classifiedRows\\.changed\\]/);
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
});`;

source = source.slice(0, start) + after + source.slice(end);
await writeFile(path, source);
