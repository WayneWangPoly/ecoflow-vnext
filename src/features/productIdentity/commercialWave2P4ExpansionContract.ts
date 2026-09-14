export const COMMERCIAL_WAVE2_P4C_TARGET = {
  baseSha: '02912f957d01a77e273095c52457e85c4c4f878c',
  commandId: '430e5bfe-e8b1-44dd-a004-9dfb0bbc46b8',
  candidateSetSha256: '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
  canaryExternalProductCode: '140010',
  canaryCommercialSkuId: '4710bb98-2706-42e5-866b-8788e36e1acc',
  expansionCandidateCount: 163,
  reason: 'P4C authorized bounded 163-candidate expansion activation',
} as const;

export type CommercialWave2P4CActivationReport = {
  mode: 'P4C_ACTIVATION_PREFLIGHT';
  stage: 'P4C_EXPANSION_ACTIVATION';
  verdict: 'PASS' | 'HOLD';
  status: 'READY_FOR_AUTHENTICATED_EXPANSION_EXECUTION' | 'HOLD';
  verifiedAt: string;
  verifierRole: 'OWNER' | 'ADMIN';
  cohort: {
    candidateSetSha256: string;
    eligibleExpansionCount: number;
    enabledExpansionCount: number;
  };
  lineage: {
    expansionUnlockCount: number;
    expansionCommandCount: number;
    nonCanaryPromotionCount: number;
  };
  authority: {
    legacyServiceRoleExecute: boolean;
    legacyAuthenticatedExecute: boolean;
    v2AuthenticatedExecute: boolean;
    v2ServiceRoleExecute: boolean;
    v2AnonExecute: boolean;
    productionExpansionAuthorized: boolean;
    providerActionIncluded: boolean;
    promotionIncluded: boolean;
    physicalAuthorityIncluded: boolean;
    inventoryAuthorityIncluded: boolean;
  };
  frozenCommand: {
    commandId: string;
    candidateSetSha256: string;
    reason: string;
  };
  failedChecks: string[];
};

export type CommercialWave2P4CExpansionResult = {
  authorityVersion: 'P4B_CALLER_AUTH_V2';
  promotionPhase: 'EXPANSION';
  unlockedCandidateCount: number;
  candidateSetSha256: string;
  canaryExternalProductCode: string;
  canaryMappingRevision: number;
  canaryCommercialSkuId: string;
  providerActionIncluded: boolean;
  promotionIncluded: boolean;
  physicalAuthorityCreated: boolean;
  inventoryAuthorityCreated: boolean;
  replayed: boolean;
};

function hold(detail: string): never {
  throw new Error(`ECOFLOW-R3-P4C — HOLD — ${detail}`);
}

function expect(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) hold(`${label} mismatch`);
}

export function assertCommercialWave2P4CActivation(value: CommercialWave2P4CActivationReport) {
  const t = COMMERCIAL_WAVE2_P4C_TARGET;
  expect(value.mode, 'P4C_ACTIVATION_PREFLIGHT', 'mode');
  expect(value.stage, 'P4C_EXPANSION_ACTIVATION', 'stage');
  expect(value.verdict, 'PASS', 'verdict');
  expect(value.status, 'READY_FOR_AUTHENTICATED_EXPANSION_EXECUTION', 'status');
  if (!['OWNER', 'ADMIN'].includes(value.verifierRole)) hold('verifier role is not OWNER/ADMIN');
  expect(value.cohort.candidateSetSha256, t.candidateSetSha256, 'cohort hash');
  expect(value.cohort.eligibleExpansionCount, t.expansionCandidateCount, 'eligible expansion count');
  expect(value.cohort.enabledExpansionCount, 0, 'enabled expansion count');
  expect(value.lineage.expansionUnlockCount, 0, 'expansion unlock count');
  expect(value.lineage.expansionCommandCount, 0, 'expansion command count');
  expect(value.lineage.nonCanaryPromotionCount, 0, 'non-canary promotion count');
  expect(value.authority.legacyServiceRoleExecute, false, 'legacy service-role execute');
  expect(value.authority.legacyAuthenticatedExecute, false, 'legacy authenticated execute');
  expect(value.authority.v2AuthenticatedExecute, true, 'v2 authenticated execute');
  expect(value.authority.v2ServiceRoleExecute, false, 'v2 service-role execute');
  expect(value.authority.v2AnonExecute, false, 'v2 anon execute');
  expect(value.authority.productionExpansionAuthorized, true, 'production expansion authorization');
  for (const [label, actual] of [
    ['provider action', value.authority.providerActionIncluded],
    ['promotion', value.authority.promotionIncluded],
    ['Physical authority', value.authority.physicalAuthorityIncluded],
    ['inventory authority', value.authority.inventoryAuthorityIncluded],
  ] as const) expect(actual, false, label);
  expect(value.frozenCommand.commandId, t.commandId, 'frozen command id');
  expect(value.frozenCommand.candidateSetSha256, t.candidateSetSha256, 'frozen command cohort');
  expect(value.frozenCommand.reason, t.reason, 'frozen command reason');
  expect(value.failedChecks.length, 0, 'server failed checks');
}

export function assertCommercialWave2P4CExpansionResult(value: CommercialWave2P4CExpansionResult) {
  const t = COMMERCIAL_WAVE2_P4C_TARGET;
  expect(value.authorityVersion, 'P4B_CALLER_AUTH_V2', 'authority version');
  expect(value.promotionPhase, 'EXPANSION', 'promotion phase');
  expect(value.unlockedCandidateCount, t.expansionCandidateCount, 'unlocked candidate count');
  expect(value.candidateSetSha256, t.candidateSetSha256, 'cohort hash');
  expect(value.canaryExternalProductCode, t.canaryExternalProductCode, 'canary code');
  expect(value.canaryMappingRevision, 0, 'canary mapping revision');
  expect(value.canaryCommercialSkuId, t.canaryCommercialSkuId, 'canary Commercial SKU');
  expect(value.providerActionIncluded, false, 'provider action');
  expect(value.promotionIncluded, false, 'promotion');
  expect(value.physicalAuthorityCreated, false, 'Physical authority');
  expect(value.inventoryAuthorityCreated, false, 'inventory authority');
}

export function formatCommercialWave2P4CFailure(error: unknown, commandCrossedBoundary: boolean) {
  const detail = error instanceof Error ? error.message : String(error);
  const prefix = commandCrossedBoundary ? 'ECOFLOW-R3-P4C — EXECUTION HOLD' : 'ECOFLOW-R3-P4C — HOLD';
  return detail.startsWith('ECOFLOW-R3-P4C') ? detail : `${prefix} — ${detail}`;
}
