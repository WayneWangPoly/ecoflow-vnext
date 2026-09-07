import assert from 'node:assert/strict';

const predecessor = {
  id: '778cefff-eba6-4b49-8c59-95aebc2cb3ea',
  status: 'SUCCEEDED',
  assets_planned: 10,
  assets_copied: 10,
  assets_reused: 0,
  assets_failed: 0,
  bytes_copied: 1919184,
  authorization_id: '15612d15-f97e-462e-a24f-49889b4668c2',
};
const currentAuthorization = {
  id: '15612d15-f97e-462e-a24f-49889b4668c2',
  authorization_status: 'APPROVED', is_current: true, revision: 2,
  storage_budget_bytes: 134217728, max_object_bytes: 2097152, expires_at: null,
};
function acceptsPredecessor(row) { return Boolean(row) && row.id === predecessor.id && row.status === 'SUCCEEDED' && row.assets_planned === 10 && row.assets_copied === 10 && row.assets_reused === 0 && row.assets_failed === 0 && row.bytes_copied === 1919184 && row.authorization_id === predecessor.authorization_id; }
function acceptsAuthorization(row) { return Boolean(row) && row.id === currentAuthorization.id && row.authorization_status === 'APPROVED' && row.is_current === true && row.revision === 2 && row.storage_budget_bytes === 134217728 && row.max_object_bytes === 2097152 && row.expires_at === null; }
assert.equal(acceptsPredecessor(predecessor), true);
assert.equal(acceptsAuthorization(currentAuthorization), true);
assert.equal(acceptsPredecessor({...predecessor, assets_failed: 1}), false);
assert.equal(acceptsAuthorization({...currentAuthorization, revision: 1}), false);
const limit = 10;
function validResult(row) {
  if (!row || !['SUCCEEDED','PARTIAL','FAILED'].includes(String(row.status))) return false;
  for (const key of ['assetsPlanned','assetsCopied','assetsReused','assetsFailed','bytesCopied']) if (!Number.isSafeInteger(row[key]) || row[key] < 0) return false;
  return typeof row.runId === 'string' && row.runId.length > 0 && row.assetsPlanned <= limit && row.assetsCopied + row.assetsReused + row.assetsFailed === row.assetsPlanned;
}
assert.equal(validResult({runId:'r',status:'SUCCEEDED',assetsPlanned:10,assetsCopied:10,assetsReused:0,assetsFailed:0,bytesCopied:1}), true);
assert.equal(validResult({runId:'r',status:'SUCCEEDED',assetsPlanned:11,assetsCopied:11,assetsReused:0,assetsFailed:0,bytesCopied:1}), false);
console.log('W38 bounded predecessor/authorization/result checks passed');
