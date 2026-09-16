export const CUSTOMER_SITE_WAVE1_PROMOTION = {
  customer: {
    commandId: 'bf66f8a0-2475-45be-ac05-0a2f923f4bc5',
    expectedMembershipSha256: '604c695c505dadf9d93ba251f1ff1edd8d27f8645406c060e4165ca93146e1c3',
    expectedSourceEvidenceSha256: 'f8c4144d1cb50708ca6c7a0fbf760ceaa9f6ac92ab5f33b9715e9ec6e22cecb7',
    reason: 'ECOFLOW-340B-2-R2P CUSTOMER_WAVE1 governed production promotion',
    expectedPromotedCount: 82,
    expectedHoldCount: 8,
  },
  site: {
    commandId: '36c9868b-3644-4469-a259-2e39faf6365e',
    expectedMembershipSha256: '5972b42f7541dfef576fe464a344d891434e78307325516708171287a418c1af',
    expectedSourceEvidenceSha256: 'a30654f80426baadd6b7965497e03fcc459513c811e86e23c1b9aca331c71d1a',
    reason: 'ECOFLOW-340B-2-R2P SITE_WAVE1 governed production promotion',
    expectedPromotedCount: 71,
    expectedDuplicateParentHoldCount: 4,
    expectedLocationHoldCount: 1,
  },
} as const;

export type CustomerWave1PromotionResult = {
  accepted: boolean;
  replayed: boolean;
  status: string;
  command_id: string;
  customer_count: number;
  held_customer_count: number;
  membership_sha256: string;
  source_evidence_sha256: string;
};

export type SiteWave1PromotionResult = {
  accepted: boolean;
  replayed: boolean;
  status: string;
  command_id: string;
  site_count: number;
  duplicate_parent_hold_count: number;
  location_hold_count: number;
  membership_sha256: string;
  source_evidence_sha256: string;
};

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} returned an invalid acknowledgement.`);
}

function assertBoolean(value: unknown, label: string) {
  if (typeof value !== 'boolean') throw new Error(`${label} returned an invalid replay flag.`);
}

export function assertCustomerWave1PromotionResult(value: unknown): asserts value is CustomerWave1PromotionResult {
  assertObject(value, 'Customer Wave-1 promotion');
  const expected = CUSTOMER_SITE_WAVE1_PROMOTION.customer;
  if (value.accepted !== true || value.status !== 'PROMOTED') throw new Error('Customer Wave-1 promotion did not return PROMOTED.');
  assertBoolean(value.replayed, 'Customer Wave-1 promotion');
  if (value.command_id !== expected.commandId) throw new Error('Customer Wave-1 command id mismatch.');
  if (value.customer_count !== expected.expectedPromotedCount || value.held_customer_count !== expected.expectedHoldCount) {
    throw new Error('Customer Wave-1 promotion footprint mismatch.');
  }
  if (value.membership_sha256 !== expected.expectedMembershipSha256 || value.source_evidence_sha256 !== expected.expectedSourceEvidenceSha256) {
    throw new Error('Customer Wave-1 evidence hash mismatch.');
  }
}

export function assertSiteWave1PromotionResult(value: unknown): asserts value is SiteWave1PromotionResult {
  assertObject(value, 'Site Wave-1 promotion');
  const expected = CUSTOMER_SITE_WAVE1_PROMOTION.site;
  if (value.accepted !== true || value.status !== 'PROMOTED') throw new Error('Site Wave-1 promotion did not return PROMOTED.');
  assertBoolean(value.replayed, 'Site Wave-1 promotion');
  if (value.command_id !== expected.commandId) throw new Error('Site Wave-1 command id mismatch.');
  if (
    value.site_count !== expected.expectedPromotedCount
    || value.duplicate_parent_hold_count !== expected.expectedDuplicateParentHoldCount
    || value.location_hold_count !== expected.expectedLocationHoldCount
  ) throw new Error('Site Wave-1 promotion footprint mismatch.');
  if (value.membership_sha256 !== expected.expectedMembershipSha256 || value.source_evidence_sha256 !== expected.expectedSourceEvidenceSha256) {
    throw new Error('Site Wave-1 evidence hash mismatch.');
  }
}

export function customerSiteWave1Error(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}
