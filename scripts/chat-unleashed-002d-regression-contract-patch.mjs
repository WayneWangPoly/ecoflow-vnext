import { readFile, writeFile } from 'node:fs/promises';

const path = 'scripts/unleashed-readonly-connector-contract.test.mjs';
let source = await readFile(path, 'utf8');
const before = `test('Snapshot replay writes only inserted or payload-changed records', () => {
  assert.match(edgeFunction, /select\\('external_key,payload_sha256'\\)/);
  assert.match(edgeFunction, /existingHash === row\\.payload_sha256\\) unchanged\\.push\\(row\\)/);
  assert.match(edgeFunction, /const semanticRows = \\[\\.\\.\\.classifiedRows\\.inserted, \\.\\.\\.classifiedRows\\.changed\\]/);
  assert.match(edgeFunction, /upsert\\(semanticRows, \\{ onConflict: 'resource,external_key' \\}\\)/);
  assert.doesNotMatch(edgeFunction, /upsert\\(snapshotRows, \\{ onConflict: 'resource,external_key' \\}\\)/);
  assert.match(edgeFunction, /stagedOnPage = insertedOnPage \\+ changedOnPage/);
  assert.match(edgeFunction, /records_unchanged: recordsUnchanged/);
  assert.match(edgeFunction, /select\\('external_key,latest_payload_sha256'\\)/);
  assert.match(edgeFunction, /upsert\\(identitiesNeedingWrite, \\{ onConflict: 'resource,external_key' \\}\\)/);
  assert.match(edgeFunction, /identity_writes: identityWritesOnPage/);
  assert.match(edgeFunction, /externalKey: \`product:\\\${guid\\.toLowerCase\\(\\)}:warehouse:\\\${warehouseIdentity\\.toLowerCase\\(\\)}\`/);
});`;
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
if (!source.includes(before)) throw new Error('REGRESSION_BLOCK_NOT_FOUND');
if (source.indexOf(before) !== source.lastIndexOf(before)) throw new Error('REGRESSION_BLOCK_AMBIGUOUS');
source = source.replace(before, after);
await writeFile(path, source);
