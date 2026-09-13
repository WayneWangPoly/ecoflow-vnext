export const COMMERCIAL_WAVE2_CANARY_PROMOTION_TARGET = {
  carrierBaseSha: '56931cb04a2ef95d5762d4445556f81b5c1a60d1',
  unlockCommandId: '61b13a7c-18d1-48f0-b317-96d23607ddfb',
  promotionCommandId: '7900f15b-bdae-444f-b22c-04000730e260',
  candidateSetSha256: '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
  canaryExternalProductCode: '140010',
  canaryMappingId: '3001d0f1-6c1b-4b15-98a0-91443ca6b525',
  canaryMappingRevision: 0,
  canarySourcePayloadSha256: '016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8',
  canarySourceExternalKey: 'guid:e80b9e1d-f33d-4ebf-b76d-dfdd9beb1a7b',
  promotionReason: '#338 Commercial Promotion Wave 2 P2B canary promotion for 140010 only; no Physical SKU, package, barcode, image or quantity authority.',
} as const;

export type CommercialWave2CanaryPromotionPreflight = Record<string, unknown>;
export type CommercialWave2CanaryPromotionResult = Record<string, unknown>;

function hold(detail: string, commandCrossedBoundary = false): never {
  if (!commandCrossedBoundary) throw new Error(`HOLD — ${detail}; Wave-2 P2B promotion was not called.`);
  throw new Error(`HOLD — Wave-2 P2B may have been called; ${detail}. Rehydrate server state before any retry and keep the frozen command ID.`);
}

function expect(value: unknown, expected: unknown, label: string) {
  if (value !== expected) hold(`${label} mismatch`);
}

export function buildCommercialWave2CanaryPromotionPreflightInput() {
  const t = COMMERCIAL_WAVE2_CANARY_PROMOTION_TARGET;
  return {
    expectedUnlockCommandId: t.unlockCommandId,
    expectedPromotionCommandId: t.promotionCommandId,
    expectedCandidateSetSha256: t.candidateSetSha256,
    expectedCanaryExternalProductCode: t.canaryExternalProductCode,
    expectedCanaryMappingId: t.canaryMappingId,
    expectedCanaryMappingRevision: t.canaryMappingRevision,
    expectedCanarySourcePayloadSha256: t.canarySourcePayloadSha256,
    expectedCanarySourceExternalKey: t.canarySourceExternalKey,
  };
}

export function buildCommercialWave2CanaryPromotionInput() {
  const t = COMMERCIAL_WAVE2_CANARY_PROMOTION_TARGET;
  return {
    commandId: t.promotionCommandId,
    expectedCandidateSetSha256: t.candidateSetSha256,
    expectedCanaryExternalProductCode: t.canaryExternalProductCode,
    expectedCanaryMappingId: t.canaryMappingId,
    expectedCanaryMappingRevision: t.canaryMappingRevision,
    expectedCanarySourcePayloadSha256: t.canarySourcePayloadSha256,
    reason: t.promotionReason,
  };
}

export function assertCommercialWave2CanaryPromotionPreflight(value: CommercialWave2CanaryPromotionPreflight) {
  const t = COMMERCIAL_WAVE2_CANARY_PROMOTION_TARGET;
  expect(value.ready, true, 'P2B ready');
  expect(value.status, 'READY', 'P2B status');
  expect(value.stage, 'P2B_SELECT_ONLY', 'P2B stage');
  expect(value.candidateCount, 164, 'candidate count');
  expect(value.distinctNormalizedCodes, 164, 'distinct normalized code count');
  expect(value.normalizedFailures, 0, 'normalized failures');
  expect(value.eligibleCandidateCount, 163, 'eligible candidate count');
  expect(value.enabledCandidateCount, 1, 'enabled candidate count');
  expect(value.phaseUnlockCount, 1, 'phase unlock count');
  expect(value.unlockCommandCount, 1, 'unlock command count');
  expect(value.exactUnlockCommandCount, 1, 'exact unlock command count');
  expect(value.unlockAuditCount, 1, 'unlock audit count');
  expect(value.promotionCount, 0, 'promotion count');
  expect(value.promotionCommandCount, 0, 'promotion command count');
  expect(value.canarySkuCount, 0, 'canary SKU count');
  expect(value.canaryExternalMappingCount, 0, 'canary external mapping count');
  expect(value.unlockCommandId, t.unlockCommandId, 'unlock command ID');
  expect(value.promotionCommandId, t.promotionCommandId, 'promotion command ID');
  expect(value.candidateSetSha256, t.candidateSetSha256, 'candidate hash');
  const canary = value.canary as Record<string, unknown> | undefined;
  if (!canary) hold('canary evidence missing');
  expect(canary.externalProductCode, t.canaryExternalProductCode, 'canary code');
  expect(canary.mappingId, t.canaryMappingId, 'canary mapping ID');
  expect(canary.mappingRevision, t.canaryMappingRevision, 'canary mapping revision');
  expect(canary.sourcePayloadSha256, t.canarySourcePayloadSha256, 'canary source SHA');
  expect(canary.sourceExternalKey, t.canarySourceExternalKey, 'canary source key');
  expect(canary.enabled, true, 'canary enabled');
  expect(value.physicalAuthorityCreated, false, 'Physical authority');
  expect(value.inventoryAuthorityCreated, false, 'inventory authority');
  expect(value.imagePlanningIncluded, false, 'image planning');
}

export function assertCommercialWave2CanaryPromotionResult(value: CommercialWave2CanaryPromotionResult) {
  const t = COMMERCIAL_WAVE2_CANARY_PROMOTION_TARGET;
  expect(value.stage, 'P2B_CANARY_PROMOTION', 'P2B result stage');
  expect(value.status, 'CANARY_PROMOTED', 'P2B result status');
  expect(value.commandId, t.promotionCommandId, 'promotion command ID');
  expect(value.promotionPhase, 'CANARY', 'promotion phase');
  expect(value.canaryExternalProductCode, t.canaryExternalProductCode, 'canary code');
  expect(value.externalProductCode, t.canaryExternalProductCode, 'promoted external code');
  expect(value.candidateSetSha256, t.candidateSetSha256, 'candidate hash');
  expect(value.enabledCandidateCount, 1, 'enabled candidate count');
  expect(value.phaseUnlockCount, 1, 'phase unlock count');
  expect(value.unlockCommandCount, 1, 'unlock command count');
  expect(value.promotionCount, 1, 'promotion count');
  expect(value.promotionCommandCount, 1, 'promotion command count');
  expect(value.setupStatus, 'mapping_draft', 'setup status');
  expect(value.physicalAuthorityCreated, false, 'Physical authority');
  expect(value.inventoryAuthorityCreated, false, 'inventory authority');
  expect(value.imageActionIncluded, false, 'image action');
  expect(value.replayed, false, 'initial replay state');
}

export function formatCommercialWave2CanaryPromotionFailure(error: unknown, commandCrossedBoundary: boolean) {
  const detail = error instanceof Error ? error.message : String(error);
  return commandCrossedBoundary
    ? `HOLD — Wave-2 P2B may have been called; ${detail}. Rehydrate server state before any retry and keep the frozen command ID.`
    : `HOLD — ${detail}; Wave-2 P2B promotion was not called.`;
}
