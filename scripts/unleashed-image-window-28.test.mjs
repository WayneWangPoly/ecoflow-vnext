import assert from 'node:assert/strict';

const predecessor = {
  id: '1cdfb299-5fca-4325-9ab8-2c03c808ddc7',
  status: 'SUCCEEDED',
  assets_planned: 10,
  assets_copied: 10,
  assets_reused: 0,
  assets_failed: 0,
  bytes_copied: 2686818,
  authorization_id: '9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c',
};

function accepts(row) {
  return Boolean(row)
    && row.id === predecessor.id
    && row.status === predecessor.status
    && row.assets_planned === 10
    && row.assets_copied === 10
    && row.assets_reused === 0
    && row.assets_failed === 0
    && row.bytes_copied === 2686818
    && row.authorization_id === predecessor.authorization_id;
}

assert.equal(accepts(predecessor), true);
for (const [key, value] of [
  ['id', 'wrong'], ['status', 'PARTIAL'], ['assets_planned', 9], ['assets_copied', 9],
  ['assets_reused', 1], ['assets_failed', 1], ['bytes_copied', 2686817], ['authorization_id', 'wrong'],
]) {
  assert.equal(accepts({ ...predecessor, [key]: value }), false, key);
}

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
console.log('W28 bounded predecessor/result checks passed');
