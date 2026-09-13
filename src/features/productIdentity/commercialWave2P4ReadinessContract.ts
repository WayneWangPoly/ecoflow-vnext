export const COMMERCIAL_WAVE2_P4A_TARGET = {
  baseSha: '88490baa22b7e2cede8f8a12fdb42087d4370e56',
  candidateSetSha256: '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
  canaryExternalProductCode: '140010',
  canarySourceMappingId: '3001d0f1-6c1b-4b15-98a0-91443ca6b525',
  canarySourceMappingRevision: 0,
  canarySourcePayloadSha256: '016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8',
  canaryCommercialSkuId: '4710bb98-2706-42e5-866b-8788e36e1acc',
  canaryActiveOrdermentumMappingId: '1995b15c-7ee7-466b-ba3e-daba596d71a3',
  expansionCandidateCount: 163,
} as const;

export type CommercialWave2P4AReadinessReport = {
  mode: 'P4A_READINESS_ONLY';
  stage: 'P4A_EXPANSION_READINESS';
  verdict: 'PASS' | 'HOLD';
  status: 'READY_FOR_P4B_ENGINEERING' | 'HOLD';
  verifiedAt: string;
  verifierRole: 'OWNER' | 'ADMIN';
  p3: {
    verdict: string;
    p4Locked: boolean;
    providerStatus: string | null;
    commercialSkuId: string | null;
    activeOrdermentumMappingId: string | null;
  };
  cohort: {
    candidateSetSha256: string | null;
    recomputedCandidateSetSha256: string | null;
    candidateCount: number;
    canaryCount: number;
    expansionCandidateCount: number;
    enabledCanaryCount: number;
    enabledExpansionCount: number;
    eligibleExpansionCount: number;
    ineligibleExpansionCount: number;
    ineligibleCodes: string[];
  };
  canary: {
    externalProductCode: string | null;
    sourceMappingId: string | null;
    sourceMappingStatus: string | null;
    sourceMappingRevision: number | null;
    sourcePayloadSha256: string | null;
    commercialSkuId: string | null;
    activeOrdermentumMappingId: string | null;
  };
  lineage: {
    expansionUnlockCount: number;
    nonCanaryPromotionCount: number;
  };
  legacyExpansionUnlock: {
    functionPresent: boolean;
    serviceRoleExecute: boolean;
    compatibleWithCurrentCanaryState: boolean;
    blocker: string;
    requiredNextGate: string;
  };
  authority: {
    p4aMutationCapabilityExposed: boolean;
    productionExpansionAuthorized: boolean;
    providerActionIncluded: boolean;
    inventoryAuthorityIncluded: boolean;
    physicalAuthorityIncluded: boolean;
    imageActionIncluded: boolean;
  };
  failedChecks: string[];
};

function hold(detail: string): never {
  throw new Error(`ECOFLOW-R3-P4A — HOLD — ${detail}`);
}

function expect(value: unknown, expected: unknown, label: string) {
  if (value !== expected) hold(`${label} mismatch`);
}

export function assertCommercialWave2P4AReadiness(value: CommercialWave2P4AReadinessReport) {
  const t = COMMERCIAL_WAVE2_P4A_TARGET;
  expect(value.mode, 'P4A_READINESS_ONLY', 'mode');
  expect(value.stage, 'P4A_EXPANSION_READINESS', 'stage');
  expect(value.verdict, 'PASS', 'verdict');
  expect(value.status, 'READY_FOR_P4B_ENGINEERING', 'status');
  if (!['OWNER', 'ADMIN'].includes(value.verifierRole)) hold('verifier role is not OWNER/ADMIN');

  expect(value.p3.verdict, 'PASS', 'P3 verdict');
  expect(value.p3.p4Locked, true, 'P3 P4 lock');
  if (!['NO_PROVIDER_ACTIVITY', 'ATTRIBUTED_INCUMBENT_LEGACY_ACTIVITY'].includes(value.p3.providerStatus ?? '')) {
    hold('P3 provider attribution');
  }
  expect(value.p3.commercialSkuId, t.canaryCommercialSkuId, 'P3 Commercial SKU');
  expect(value.p3.activeOrdermentumMappingId, t.canaryActiveOrdermentumMappingId, 'P3 active mapping');

  expect(value.cohort.candidateSetSha256, t.candidateSetSha256, 'stored cohort hash');
  expect(value.cohort.recomputedCandidateSetSha256, t.candidateSetSha256, 'recomputed cohort hash');
  expect(value.cohort.candidateCount, 164, 'candidate count');
  expect(value.cohort.canaryCount, 1, 'canary count');
  expect(value.cohort.expansionCandidateCount, t.expansionCandidateCount, 'expansion candidate count');
  expect(value.cohort.enabledCanaryCount, 1, 'enabled canary count');
  expect(value.cohort.enabledExpansionCount, 0, 'enabled expansion count');
  expect(value.cohort.eligibleExpansionCount, t.expansionCandidateCount, 'eligible expansion count');
  expect(value.cohort.ineligibleExpansionCount, 0, 'ineligible expansion count');
  expect(value.cohort.ineligibleCodes.length, 0, 'ineligible expansion codes');

  expect(value.canary.externalProductCode, t.canaryExternalProductCode, 'canary code');
  expect(value.canary.sourceMappingId, t.canarySourceMappingId, 'canary source mapping');
  expect(value.canary.sourceMappingStatus, 'UNMATCHED', 'canary source mapping status');
  expect(value.canary.sourceMappingRevision, t.canarySourceMappingRevision, 'canary source mapping revision');
  expect(value.canary.sourcePayloadSha256, t.canarySourcePayloadSha256, 'canary source payload SHA');
  expect(value.canary.commercialSkuId, t.canaryCommercialSkuId, 'canary Commercial SKU');
  expect(value.canary.activeOrdermentumMappingId, t.canaryActiveOrdermentumMappingId, 'canary active mapping');

  expect(value.lineage.expansionUnlockCount, 0, 'expansion unlock count');
  expect(value.lineage.nonCanaryPromotionCount, 0, 'non-canary promotion count');

  expect(value.legacyExpansionUnlock.functionPresent, true, 'legacy unlock function presence');
  expect(value.legacyExpansionUnlock.serviceRoleExecute, true, 'legacy service-role execute');
  expect(value.legacyExpansionUnlock.compatibleWithCurrentCanaryState, false, 'legacy unlock compatibility');
  expect(value.legacyExpansionUnlock.blocker, 'CANARY_SOURCE_MAPPING_REMAINS_UNMATCHED_BY_DESIGN', 'legacy blocker');
  expect(value.legacyExpansionUnlock.requiredNextGate, 'P4B_REPLACE_OR_REVOKE_LEGACY_UNLOCK', 'next gate');

  for (const [label, actual] of [
    ['P4A mutation capability', value.authority.p4aMutationCapabilityExposed],
    ['production expansion authorization', value.authority.productionExpansionAuthorized],
    ['provider action', value.authority.providerActionIncluded],
    ['inventory authority', value.authority.inventoryAuthorityIncluded],
    ['Physical authority', value.authority.physicalAuthorityIncluded],
    ['image action', value.authority.imageActionIncluded],
  ] as const) expect(actual, false, label);

  expect(value.failedChecks.length, 0, 'server failed checks');
}

export function formatCommercialWave2P4AReadinessFailure(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  return detail.startsWith('ECOFLOW-R3-P4A') ? detail : `ECOFLOW-R3-P4A — HOLD — ${detail}`;
}
