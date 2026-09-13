import { COMMERCIAL_WAVE2_PLAN_TARGET } from './commercialWave2PlanContract';

export const COMMERCIAL_WAVE2_CANARY_UNLOCK_TARGET = {
  ...COMMERCIAL_WAVE2_PLAN_TARGET,
  carrierBaseSha: '46a59b10e1846d9cd35c0bae83e93f81f5344218',
  unlockCommandId: '61b13a7c-18d1-48f0-b317-96d23607ddfb',
  unlockReason: '#338 Commercial Promotion Wave 2 P2A canary eligibility unlock for 140010 only; no promotion, Product Identity, Physical SKU, image or quantity authority.',
} as const;

type CanaryEvidence = {
  externalProductCode?: unknown;
  mappingId?: unknown;
  mappingRevision?: unknown;
  sourcePayloadSha256?: unknown;
  sourceExternalKey?: unknown;
  enabled?: unknown;
};

export type CommercialWave2CanaryUnlockPreflight = {
  ready?: unknown;
  p0Ready?: unknown;
  status?: unknown;
  stage?: unknown;
  candidateCount?: unknown;
  distinctNormalizedCodes?: unknown;
  normalizedFailures?: unknown;
  eligibleCandidateCount?: unknown;
  enabledCandidateCount?: unknown;
  canaryCount?: unknown;
  expansionCount?: unknown;
  candidateSetSha256?: unknown;
  componentHashes?: Record<string, unknown> | null;
  canary?: CanaryEvidence | null;
  excludedHoldRows?: unknown;
  planCommandCount?: unknown;
  exactPlanCommandCount?: unknown;
  planAuditCount?: unknown;
  planCommandId?: unknown;
  planStatus?: unknown;
  unlockCommandId?: unknown;
  phaseUnlockCount?: unknown;
  unlockCommandCount?: unknown;
  promotionCount?: unknown;
  promotionCommandCount?: unknown;
  physicalAuthorityCreated?: unknown;
  inventoryAuthorityCreated?: unknown;
  imagePlanningIncluded?: unknown;
};

export type CommercialWave2CanaryUnlockResult = {
  stage?: unknown;
  status?: unknown;
  commandId?: unknown;
  promotionPhase?: unknown;
  canaryExternalProductCode?: unknown;
  unlockedCandidateCount?: unknown;
  enabledCandidateCount?: unknown;
  phaseUnlockCount?: unknown;
  unlockCommandCount?: unknown;
  promotionCount?: unknown;
  promotionCommandCount?: unknown;
  candidateSetSha256?: unknown;
  physicalAuthorityCreated?: unknown;
  inventoryAuthorityCreated?: unknown;
  imageActionIncluded?: unknown;
  replayed?: unknown;
};

function hold(detail: string, commandCrossedBoundary = false): never {
  if (!commandCrossedBoundary) {
    throw new Error(`HOLD — ${detail}; Wave-2 P2A unlock was not called.`);
  }
  throw new Error(`HOLD — Wave-2 P2A may have been called; ${detail}. Rehydrate server state before any retry and keep the frozen command ID.`);
}

function expect(value: unknown, expected: unknown, label: string) {
  if (value !== expected) hold(`${label} mismatch`);
}

export function buildCommercialWave2CanaryUnlockPreflightInput() {
  const target = COMMERCIAL_WAVE2_CANARY_UNLOCK_TARGET;
  return {
    expectedPlanCommandId: target.planCommandId,
    expectedUnlockCommandId: target.unlockCommandId,
    expectedCandidateCount: target.candidateCount,
    expectedCandidateSetSha256: target.candidateSetSha256,
    expectedCanaryExternalProductCode: target.canaryExternalProductCode,
    expectedCanaryMappingId: target.canaryMappingId,
    expectedCanaryMappingRevision: target.canaryMappingRevision,
    expectedCanarySourcePayloadSha256: target.canarySourcePayloadSha256,
    expectedCanarySourceExternalKey: target.canarySourceExternalKey,
  };
}

export function buildCommercialWave2CanaryUnlockInput() {
  const target = COMMERCIAL_WAVE2_CANARY_UNLOCK_TARGET;
  return {
    commandId: target.unlockCommandId,
    expectedCandidateSetSha256: target.candidateSetSha256,
    reason: target.unlockReason,
  };
}

export function assertCommercialWave2CanaryUnlockPreflight(value: CommercialWave2CanaryUnlockPreflight) {
  const target = COMMERCIAL_WAVE2_CANARY_UNLOCK_TARGET;
  expect(value.ready, true, 'P2A ready');
  expect(value.p0Ready, false, 'historical P0 ready state');
  expect(value.status, 'READY', 'P2A status');
  expect(value.stage, 'P2A_SELECT_ONLY', 'P2A stage');
  expect(value.candidateCount, target.candidateCount, 'candidate count');
  expect(value.distinctNormalizedCodes, target.candidateCount, 'distinct normalized code count');
  expect(value.normalizedFailures, 0, 'normalized failures');
  expect(value.eligibleCandidateCount, target.candidateCount, 'eligible candidate count');
  expect(value.enabledCandidateCount, 0, 'enabled candidate count');
  expect(value.canaryCount, 1, 'canary count');
  expect(value.expansionCount, 163, 'expansion count');
  expect(value.candidateSetSha256, target.candidateSetSha256, 'candidate hash');
  if (!value.componentHashes) hold('component hashes are missing');
  for (const [key, expected] of Object.entries(target.componentHashes)) {
    expect(value.componentHashes[key], expected, `${key} component hash`);
  }
  expect(value.excludedHoldRows, 0, 'excluded HOLD rows');
  expect(value.planCommandCount, 1, 'PLAN command count');
  expect(value.exactPlanCommandCount, 1, 'exact PLAN command count');
  expect(value.planAuditCount, 1, 'PLAN audit count');
  expect(value.planCommandId, target.planCommandId, 'PLAN command ID');
  expect(value.planStatus, 'PLANNED', 'PLAN status');
  expect(value.unlockCommandId, target.unlockCommandId, 'unlock command ID');
  expect(value.phaseUnlockCount, 0, 'phase unlock count');
  expect(value.unlockCommandCount, 0, 'unlock command count');
  expect(value.promotionCount, 0, 'promotion count');
  expect(value.promotionCommandCount, 0, 'promotion command count');
  expect(value.physicalAuthorityCreated, false, 'Physical authority');
  expect(value.inventoryAuthorityCreated, false, 'inventory authority');
  expect(value.imagePlanningIncluded, false, 'image planning');
  if (!value.canary) hold('canary evidence is missing');
  expect(value.canary.externalProductCode, target.canaryExternalProductCode, 'canary code');
  expect(value.canary.mappingId, target.canaryMappingId, 'canary mapping ID');
  expect(value.canary.mappingRevision, target.canaryMappingRevision, 'canary mapping revision');
  expect(value.canary.sourcePayloadSha256, target.canarySourcePayloadSha256, 'canary source payload hash');
  expect(value.canary.sourceExternalKey, target.canarySourceExternalKey, 'canary source key');
  expect(value.canary.enabled, false, 'canary enabled state');
}

export function assertCommercialWave2CanaryUnlockResult(value: CommercialWave2CanaryUnlockResult) {
  const target = COMMERCIAL_WAVE2_CANARY_UNLOCK_TARGET;
  expect(value.stage, 'P2A_CANARY_UNLOCK', 'P2A result stage');
  expect(value.status, 'CANARY_ENABLED', 'P2A result status');
  expect(value.commandId, target.unlockCommandId, 'unlock command ID');
  expect(value.promotionPhase, 'CANARY', 'promotion phase');
  expect(value.canaryExternalProductCode, target.canaryExternalProductCode, 'canary code');
  expect(value.unlockedCandidateCount, 1, 'unlocked candidate count');
  expect(value.enabledCandidateCount, 1, 'enabled candidate count');
  expect(value.phaseUnlockCount, 1, 'phase unlock count');
  expect(value.unlockCommandCount, 1, 'unlock command count');
  expect(value.promotionCount, 0, 'promotion count');
  expect(value.promotionCommandCount, 0, 'promotion command count');
  expect(value.candidateSetSha256, target.candidateSetSha256, 'candidate hash');
  expect(value.physicalAuthorityCreated, false, 'Physical authority');
  expect(value.inventoryAuthorityCreated, false, 'inventory authority');
  expect(value.imageActionIncluded, false, 'image action');
  expect(value.replayed, false, 'initial replay state');
}

export function formatCommercialWave2CanaryUnlockFailure(error: unknown, commandCrossedBoundary: boolean) {
  const detail = error instanceof Error ? error.message : String(error);
  if (!commandCrossedBoundary) return `HOLD — ${detail}; Wave-2 P2A unlock was not called.`;
  return `HOLD — Wave-2 P2A may have been called; ${detail}. Rehydrate server state before any retry and keep the frozen command ID.`;
}
