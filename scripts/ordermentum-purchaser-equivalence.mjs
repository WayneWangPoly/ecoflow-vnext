import crypto from 'node:crypto';
import { hashCanonicalPayload, validateProbePurchaserId } from './ordermentum-api-key-probe.mjs';

const EVIDENCE_NAME = 'ordermentum-purchaser-same-target-equivalence';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function validatePurchaserPayload(payload, targetId, source) {
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
    throw new Error(`Ordermentum ${source} purchaser evidence is not an object`);
  }
  const returnedId = String(payload.id || '').trim();
  if (returnedId !== targetId) {
    throw new Error(`Ordermentum ${source} purchaser evidence identity mismatch`);
  }
}

export function comparePurchaserPayloads({ targetId, legacyPayload, currentPayload }) {
  const id = validateProbePurchaserId(targetId);
  validatePurchaserPayload(legacyPayload, id, 'legacy');
  validatePurchaserPayload(currentPayload, id, 'current');

  const legacyHash = hashCanonicalPayload(legacyPayload);
  const currentHash = hashCanonicalPayload(currentPayload);

  return {
    evidence: EVIDENCE_NAME,
    target_sha256: sha256(id),
    identity_match: true,
    legacy_payload_sha256: legacyHash,
    current_payload_sha256: currentHash,
    payload_equal: legacyHash === currentHash,
    legacy_top_level_key_count: Object.keys(legacyPayload).length,
    current_top_level_key_count: Object.keys(currentPayload).length,
  };
}

export function assertPurchaserEquivalent(input) {
  const evidence = comparePurchaserPayloads(input);
  if (!evidence.payload_equal) {
    const error = new Error('Ordermentum purchaser same-target equivalence failed');
    error.code = 'ORDERMENTUM_PURCHASER_EQUIVALENCE_MISMATCH';
    throw error;
  }
  return evidence;
}
