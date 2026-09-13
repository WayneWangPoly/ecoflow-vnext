export const COMMERCIAL_WAVE2_PLAN_TARGET = {
  protectedMainSha: '101617435b787d4ac5f4b636e0dc8f9284ff473c',
  candidateCount: 164,
  candidateSetSha256: '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
  canaryExternalProductCode: '140010',
  canaryMappingId: '3001d0f1-6c1b-4b15-98a0-91443ca6b525',
  canaryMappingRevision: 0,
  canarySourcePayloadSha256: '016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8',
  canarySourceExternalKey: 'guid:e80b9e1d-f33d-4ebf-b76d-dfdd9beb1a7b',
  planCommandId: '18dc00fd-ffe5-4d96-9e91-830d2686ff8e',
  componentHashes: {
    code: 'd57e9fe728b7d2b272a6fd33e89e6f0e5d9dc7a5d32e525c95535912a9fe32ad',
    mapping: '3edf75311bbab34995b7beb2fba38b9715aef142f0481fa1dfe4a621b5b510d1',
    revision: 'b3397bd903a2a9569a90c2e6217af87764641b99e4af6c1a5baf7ef630bc3131',
    sourceSha: 'c852383af29ebd2dfe5713a487963ff1470a18c88646c3f448fbcac97b6aebd5',
    sourceKey: '40410822604cab1b49b8d5597a387c414b974adadc30b21f4b68ac75cbcb81f6',
  },
  planReason: '#338 Commercial Promotion Wave 2 production PLAN; exact frozen 164-row evidence only; no unlock, promotion, Product Identity, image or quantity authority.',
} as const;

export type CommercialWave2CanaryEvidence = {
  externalProductCode?: unknown;
  mappingId?: unknown;
  mappingRevision?: unknown;
  sourcePayloadSha256?: unknown;
  sourceExternalKey?: unknown;
  enabled?: unknown;
};

export type CommercialWave2PlanPreflight = {
  ready?: unknown;
  status?: unknown;
  stage?: unknown;
  expectedProtectedMainSha?: unknown;
  candidateCount?: unknown;
  distinctNormalizedCodes?: unknown;
  normalizedFailures?: unknown;
  eligibleCandidateCount?: unknown;
  enabledCandidateCount?: unknown;
  canaryCount?: unknown;
  expansionCount?: unknown;
  candidateSetSha256?: unknown;
  componentHashes?: Record<string, unknown> | null;
  canary?: CommercialWave2CanaryEvidence | null;
  excludedHoldRows?: unknown;
  phaseUnlockCount?: unknown;
  unlockCommandCount?: unknown;
  promotionCount?: unknown;
  promotionCommandCount?: unknown;
  planCommandCount?: unknown;
  physicalAuthorityCreated?: unknown;
  inventoryAuthorityCreated?: unknown;
  imagePlanningIncluded?: unknown;
};

export type CommercialWave2PlanResult = {
  stage?: unknown;
  status?: unknown;
  commandId?: unknown;
  protectedMainSha?: unknown;
  candidateCount?: unknown;
  candidateSetSha256?: unknown;
  canaryExternalProductCode?: unknown;
  enabledCandidateCount?: unknown;
  promotionCount?: unknown;
  phaseUnlockCount?: unknown;
  physicalAuthorityCreated?: unknown;
  inventoryAuthorityCreated?: unknown;
  imagePlanningIncluded?: unknown;
  replayed?: unknown;
};

function hold(detail: string): never {
  throw new Error(`HOLD — ${detail}; Wave-2 PLAN was not called.`);
}

function expect(value: unknown, expected: unknown, label: string) {
  if (value !== expected) hold(`${label} mismatch`);
}

export function assertCommercialWave2PlanPreflight(value: CommercialWave2PlanPreflight) {
  const target = COMMERCIAL_WAVE2_PLAN_TARGET;
  expect(value.ready, true, 'ready');
  expect(value.status, 'READY', 'status');
  expect(value.stage, 'P0_SELECT_ONLY', 'stage');
  expect(value.expectedProtectedMainSha, target.protectedMainSha, 'protected main');
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
  expect(value.phaseUnlockCount, 0, 'phase unlock count');
  expect(value.unlockCommandCount, 0, 'unlock command count');
  expect(value.promotionCount, 0, 'promotion count');
  expect(value.promotionCommandCount, 0, 'promotion command count');
  expect(value.planCommandCount, 0, 'PLAN command count');
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

export function buildCommercialWave2PlanInput() {
  const target = COMMERCIAL_WAVE2_PLAN_TARGET;
  return {
    commandId: target.planCommandId,
    expectedProtectedMainSha: target.protectedMainSha,
    expectedCandidateCount: target.candidateCount,
    expectedCandidateSetSha256: target.candidateSetSha256,
    expectedCanaryExternalProductCode: target.canaryExternalProductCode,
    reason: target.planReason,
  };
}

export function assertCommercialWave2PlanResult(value: CommercialWave2PlanResult) {
  const target = COMMERCIAL_WAVE2_PLAN_TARGET;
  expect(value.stage, 'P1_PLAN', 'PLAN stage');
  expect(value.status, 'PLANNED', 'PLAN status');
  expect(value.commandId, target.planCommandId, 'PLAN command ID');
  expect(value.protectedMainSha, target.protectedMainSha, 'protected main');
  expect(value.candidateCount, target.candidateCount, 'candidate count');
  expect(value.candidateSetSha256, target.candidateSetSha256, 'candidate hash');
  expect(value.canaryExternalProductCode, target.canaryExternalProductCode, 'canary');
  expect(value.enabledCandidateCount, 0, 'enabled candidate count');
  expect(value.promotionCount, 0, 'promotion count');
  expect(value.phaseUnlockCount, 0, 'phase unlock count');
  expect(value.physicalAuthorityCreated, false, 'Physical authority');
  expect(value.inventoryAuthorityCreated, false, 'inventory authority');
  expect(value.imagePlanningIncluded, false, 'image planning');
  expect(value.replayed, false, 'initial replay state');
}

export function formatCommercialWave2PlanFailure(error: unknown, commandCrossedBoundary: boolean) {
  const detail = error instanceof Error ? error.message : String(error);
  if (!commandCrossedBoundary) return `HOLD — ${detail}; Wave-2 PLAN was not called.`;
  return `HOLD — Wave-2 PLAN may have been called; ${detail}. Rehydrate server state before any retry. Do not change the frozen command ID.`;
}
