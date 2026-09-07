import assert from 'node:assert/strict';

const predecessor = {
  id: '2d8151ec-7e4a-4831-9377-802e905542cb',
  status: 'PARTIAL',
  assets_planned: 10,
  assets_copied: 5,
  assets_reused: 0,
  assets_failed: 5,
  bytes_copied: 1318029,
  authorization_id: '9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c',
};
const currentAuthorization = {
  id: '15612d15-f97e-462e-a24f-49889b4668c2',
  authorization_status: 'APPROVED',
  is_current: true,
  revision: 2,
  storage_budget_bytes: 134217728,
  max_object_bytes: 2097152,
  expires_at: null,
};

function acceptsPredecessor(row) {
  return Boolean(row)
    && row.id === predecessor.id
    && row.status === predecessor.status
    && row.assets_planned === 10
    && row.assets_copied === 5
    && row.assets_reused === 0
    && row.assets_failed === 5
    && row.bytes_copied === 1318029
    && row.authorization_id === predecessor.authorization_id;
}
function acceptsAuthorization(row) {
  return Boolean(row)
    && row.id === currentAuthorization.id
    && row.authorization_status === 'APPROVED'
    && row.is_current === true
    && row.revision === 2
    && row.storage_budget_bytes === 134217728
    && row.max_object_bytes === 2097152
    && row.expires_at === null;
}
assert.equal(acceptsPredecessor(predecessor), true);
assert.equal(acceptsAuthorization(currentAuthorization), true);
assert.equal(acceptsPredecessor({...predecessor, assets_failed: 4}), false);
assert.equal(acceptsAuthorization({...currentAuthorization, storage_budget_bytes: 67108864}), false);
assert.equal(acceptsAuthorization({...currentAuthorization, revision: 1}), false);

const limit = 10;
function validResult(row) {
  if (!row || !['SUCCEEDED', 'PARTIAL', 'FAILED'].includes(String(row.status))) return false;
  for (const key of ['assetsPlanned','assetsCopied','assetsReused','assetsFailed','bytesCopied']) {
    if (!Number.isSafeInteger(row[key]) || row[key] < 0) return false;
  }
  return typeof row.runId === 'string' && row.runId.length > 0
    && row.assetsPlanned <= limit
    && row.assetsCopied + row.assetsReused + row.assetsFailed === row.assetsPlanned;
}
assert.equal(validResult({runId:'r',status:'SUCCEEDED',assetsPlanned:10,assetsCopied:10,assetsReused:0,assetsFailed:0,bytesCopied:1}), true);
assert.equal(validResult({runId:'r',status:'SUCCEEDED',assetsPlanned:11,assetsCopied:11,assetsReused:0,assetsFailed:0,bytesCopied:1}), false);
console.log('W30 bounded predecessor/authorization/result checks passed');
