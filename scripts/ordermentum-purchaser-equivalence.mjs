import crypto from 'node:crypto';

const EVIDENCE_NAME = 'ordermentum-purchaser-same-target-equivalence';
const UUID_RE = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashCanonicalPayload(payload) {
  return sha256(canonicalJson(payload));
}

function validateTargetId(value) {
  const id = String(value || '').trim();
  if (!UUID_RE.test(id)) throw new Error('Ordermentum equivalence target must be a UUID');
  return id;
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
  const id = validateTargetId(targetId);
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
