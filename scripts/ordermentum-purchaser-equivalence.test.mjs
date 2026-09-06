import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  assertPurchaserEquivalent,
  comparePurchaserPayloads,
} from './ordermentum-purchaser-equivalence.mjs';

const targetId = '123e4567-e89b-42d3-a456-426614174000';
const otherId = '123e4567-e89b-42d3-a456-426614174001';

function legacyPayload() {
  return {
    id: targetId,
    name: 'Private Venue Name',
    retailerAddress: { street1: 'Private Street', postcode: '2000' },
    settings: { z: 2, a: 1 },
  };
}

function currentPayloadSameMeaning() {
  return {
    settings: { a: 1, z: 2 },
    retailerAddress: { postcode: '2000', street1: 'Private Street' },
    name: 'Private Venue Name',
    id: targetId,
  };
}

test('same purchaser payload is equal despite JSON object key ordering', () => {
  const evidence = comparePurchaserPayloads({
    targetId,
    legacyPayload: legacyPayload(),
    currentPayload: currentPayloadSameMeaning(),
  });

  assert.equal(evidence.identity_match, true);
  assert.equal(evidence.payload_equal, true);
  assert.equal(evidence.legacy_payload_sha256, evidence.current_payload_sha256);
  assert.match(evidence.target_sha256, /^[0-9a-f]{64}$/);
  assert.match(evidence.legacy_payload_sha256, /^[0-9a-f]{64}$/);
});

test('evidence output exposes only approved hashes and structural metadata', () => {
  const evidence = comparePurchaserPayloads({
    targetId,
    legacyPayload: legacyPayload(),
    currentPayload: currentPayloadSameMeaning(),
  });
  assert.deepEqual(Object.keys(evidence).sort(), [
    'current_payload_sha256',
    'current_top_level_key_count',
    'evidence',
    'identity_match',
    'legacy_payload_sha256',
    'legacy_top_level_key_count',
    'payload_equal',
    'target_sha256',
  ].sort());

  const serialized = JSON.stringify(evidence);
  assert.equal(serialized.includes(targetId), false);
  assert.equal(serialized.includes('Private Venue Name'), false);
  assert.equal(serialized.includes('Private Street'), false);
  assert.equal(serialized.includes('2000'), false);
});

test('same-target payload drift returns mismatch hashes without raw field diff', () => {
  const current = currentPayloadSameMeaning();
  current.name = 'Changed Private Venue Name';
  const evidence = comparePurchaserPayloads({
    targetId,
    legacyPayload: legacyPayload(),
    currentPayload: current,
  });

  assert.equal(evidence.identity_match, true);
  assert.equal(evidence.payload_equal, false);
  assert.notEqual(evidence.legacy_payload_sha256, evidence.current_payload_sha256);
  const serialized = JSON.stringify(evidence);
  assert.equal(serialized.includes('Changed Private Venue Name'), false);
  assert.equal(serialized.includes('Private Venue Name'), false);
});

test('assertion fails closed on payload drift using metadata-only error', () => {
  const current = currentPayloadSameMeaning();
  current.settings.a = 99;
  assert.throws(
    () => assertPurchaserEquivalent({ targetId, legacyPayload: legacyPayload(), currentPayload: current }),
    (error) => {
      assert.equal(error.code, 'ORDERMENTUM_PURCHASER_EQUIVALENCE_MISMATCH');
      assert.equal(error.message, 'Ordermentum purchaser same-target equivalence failed');
      assert.equal(error.message.includes('99'), false);
      assert.equal(error.message.includes(targetId), false);
      return true;
    },
  );
});

test('legacy identity mismatch fails before equivalence evidence is emitted', () => {
  const legacy = legacyPayload();
  legacy.id = otherId;
  assert.throws(
    () => comparePurchaserPayloads({ targetId, legacyPayload: legacy, currentPayload: currentPayloadSameMeaning() }),
    /legacy purchaser evidence identity mismatch/,
  );
});

test('current identity mismatch fails before equivalence evidence is emitted', () => {
  const current = currentPayloadSameMeaning();
  current.id = otherId;
  assert.throws(
    () => comparePurchaserPayloads({ targetId, legacyPayload: legacyPayload(), currentPayload: current }),
    /current purchaser evidence identity mismatch/,
  );
});

test('invalid target and non-object evidence fail closed', () => {
  assert.throws(
    () => comparePurchaserPayloads({ targetId: '../orders', legacyPayload: {}, currentPayload: {} }),
    /target must be a UUID/,
  );
  assert.throws(
    () => comparePurchaserPayloads({ targetId, legacyPayload: [], currentPayload: currentPayloadSameMeaning() }),
    /legacy purchaser evidence is not an object/,
  );
  assert.throws(
    () => comparePurchaserPayloads({ targetId, legacyPayload: legacyPayload(), currentPayload: null }),
    /current purchaser evidence is not an object/,
  );
});

test('offline comparator has no network, secret, filesystem write or Supabase dependency', () => {
  const source = readFileSync(new URL('./ordermentum-purchaser-equivalence.mjs', import.meta.url), 'utf8');
  assert.equal(/\bfetch\s*\(/.test(source), false);
  assert.equal(/https?:\/\//.test(source), false);
  assert.equal(/ORDERMENTUM_API_KEY|x-api-key|authorization/i.test(source), false);
  assert.equal(/supabase/i.test(source), false);
  assert.equal(/writeFile|appendFile|createWriteStream/.test(source), false);
  assert.equal(/ordermentum-api-key-probe|ordermentum-sync-common|ordermentum-auth/.test(source), false);
});
