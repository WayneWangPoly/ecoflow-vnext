export const COMMERCIAL_WAVE2_P3_TARGET = {
  carrierBaseSha: 'f57870c93b75acd041804ef17fd076d66d51341c',
  promotionCommandId: '7900f15b-bdae-444f-b22c-04000730e260',
  promotionTimestamp: '2026-09-13T11:35:14.960842Z',
  commandPayloadSha256: '0fca9742c34f623ae6dbf1614d5966513fdfa7d5167c7caf4c2a798e956599ef',
  candidateSetSha256: '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
  canaryExternalProductCode: '140010',
  commercialSkuId: '4710bb98-2706-42e5-866b-8788e36e1acc',
  setupStatus: 'mapping_draft',
  activeOrdermentumMappingId: '1995b15c-7ee7-466b-ba3e-daba596d71a3',
  sourceMappingId: '3001d0f1-6c1b-4b15-98a0-91443ca6b525',
  sourceMappingRevision: 0,
  sourcePayloadSha256: '016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8',
  sourceExternalKey: 'guid:e80b9e1d-f33d-4ebf-b76d-dfdd9beb1a7b',
  auditEvent: 'COMMERCIAL_WAVE2_SKU_PROMOTED',
  auditActorRole: 'ADMIN',
  auditId: '03dbe0fc-7188-4e70-a1fd-a33fb5524ba8',
  allowedProviderWorkflow: 'ordermentum-cloud-sync.yml',
  allowedProviderWorkflowRunId: '34767646363',
  allowedProviderOperationalRunId: '0bc9be6e-bc67-4e20-8e5c-c843451eb326',
} as const;

export type CommercialWave2P3VerificationReport = {
  mode: 'P3_VERIFY_READ_ONLY';
  stage: 'P3_VERIFICATION_ONLY';
  verdict: 'PASS' | 'HOLD';
  verifiedAt: string;
  verifierRole: 'OWNER' | 'ADMIN';
  identity: { count: number; id: string | null; code: string | null; setupStatus: string | null };
  mapping: { count: number; id: string | null; provider: string | null; internalSkuId: string | null; isActive: boolean };
  provenance: {
    count: number;
    id: string | null;
    revision: number | null;
    sourcePayloadSha256: string | null;
    sourceExternalKey: string | null;
    sourceExternalCode: string | null;
    sourceDuplicateCount: number | null;
  };
  candidate: {
    count: number;
    externalProductCode: string | null;
    promotionPhase: string | null;
    enabled: boolean;
    candidateSetSha256: string | null;
    sourceMappingId: string | null;
    expectedMappingRevision: number | null;
    expectedSourcePayloadSha256: string | null;
    expectedSourceExternalKey: string | null;
  };
  lineage: {
    commandCount: number;
    promotionCount: number;
    exactCommandCount: number;
    exactPromotionCount: number;
    commandId: string | null;
    commandPayloadSha256: string | null;
    initialReplayed: boolean;
    authorizationCommandId: string | null;
    promotionExternalProductCode: string | null;
    commercialSkuId: string | null;
    externalMappingId: string | null;
    sourceMappingId: string | null;
    sourcePayloadSha256: string | null;
    promotedAt: string | null;
  };
  audit: {
    count: number;
    id: string | null;
    event: string | null;
    actorRole: string | null;
    targetType: string | null;
    targetId: string | null;
    commandId: string | null;
    commercialSkuId: string | null;
    externalMappingId: string | null;
    replayed: boolean;
  };
  negativeSpace: {
    candidateCount: number;
    expansionCandidateCount: number;
    planCommands: number;
    canaryUnlocks: number;
    unlockCommands: number;
    enabledCandidates: number;
    enabledCodes: string[];
    p4EnabledCandidates: number;
    nonCanaryPromotions: number;
    secondPromotionCount: number;
  };
  sentinels: {
    current: Record<string, number>;
    sinceP2B: Record<string, number>;
  };
  providerSentinel: {
    status: 'NO_PROVIDER_ACTIVITY' | 'ATTRIBUTED_INCUMBENT_LEGACY_SYNC' | 'UNATTRIBUTED_PROVIDER_ACTIVITY';
    p3aEmittedProviderTraffic: number;
    allowedWorkflow: string;
    allowedWorkflowRunId: string;
    allowedOperationalRunId: string;
    authMode: string;
    syncRuns: number;
    rawApiEvents: number;
    syncStateRows: number;
    unattributedSyncRuns: number;
    unattributedRawApiEvents: number;
    currentApiShadowExecuted: boolean;
    legacyRetired: boolean;
  };
  noProductionBusinessMutation: true;
  p4Locked: boolean;
  failedChecks: string[];
};

function hold(detail: string): never {
  throw new Error(`ECOFLOW-R3-P3 — HOLD_AT_P3 — ${detail}`);
}

function expect(value: unknown, expected: unknown, label: string) {
  if (value !== expected) hold(`${label} mismatch`);
}

function expectTimestamp(value: string | null, expected: string, label: string) {
  if (!value || Date.parse(value) !== Date.parse(expected)) hold(`${label} mismatch`);
}

export function assertCommercialWave2P3VerificationReport(value: CommercialWave2P3VerificationReport) {
  const t = COMMERCIAL_WAVE2_P3_TARGET;
  expect(value.mode, 'P3_VERIFY_READ_ONLY', 'mode');
  expect(value.stage, 'P3_VERIFICATION_ONLY', 'stage');
  expect(value.verdict, 'PASS', 'verdict');
  if (!['OWNER', 'ADMIN'].includes(value.verifierRole)) hold('fresh verifier role is not OWNER/ADMIN');

  expect(value.identity.count, 1, 'Commercial SKU cardinality');
  expect(value.identity.id, t.commercialSkuId, 'Commercial SKU ID');
  expect(value.identity.code, t.canaryExternalProductCode, 'Commercial SKU code');
  expect(value.identity.setupStatus, t.setupStatus, 'Commercial SKU setup status');
  expect(value.mapping.count, 1, 'active Ordermentum mapping cardinality');
  expect(value.mapping.id, t.activeOrdermentumMappingId, 'active Ordermentum mapping ID');
  expect(value.mapping.provider, 'ORDERMENTUM', 'mapping provider');
  expect(value.mapping.isActive, true, 'mapping active state');
  expect(value.mapping.internalSkuId, t.commercialSkuId, 'mapping Commercial SKU link');

  expect(value.provenance.count, 1, 'source mapping cardinality');
  expect(value.provenance.id, t.sourceMappingId, 'source mapping ID');
  expect(value.provenance.revision, t.sourceMappingRevision, 'source mapping revision');
  expect(value.provenance.sourcePayloadSha256, t.sourcePayloadSha256, 'source payload SHA');
  expect(value.provenance.sourceExternalKey, t.sourceExternalKey, 'source external key');
  expect(value.provenance.sourceExternalCode?.trim().toUpperCase(), t.canaryExternalProductCode, 'source external code');
  expect(value.provenance.sourceDuplicateCount, 1, 'source duplicate count');

  expect(value.candidate.count, 1, 'candidate cardinality');
  expect(value.candidate.externalProductCode, t.canaryExternalProductCode, 'candidate code');
  expect(value.candidate.promotionPhase, 'CANARY', 'candidate phase');
  expect(value.candidate.enabled, true, 'candidate enabled state');
  expect(value.candidate.candidateSetSha256, t.candidateSetSha256, 'candidate-set SHA');
  expect(value.candidate.sourceMappingId, t.sourceMappingId, 'candidate source mapping');
  expect(value.candidate.expectedMappingRevision, t.sourceMappingRevision, 'candidate source revision');
  expect(value.candidate.expectedSourcePayloadSha256, t.sourcePayloadSha256, 'candidate source SHA');
  expect(value.candidate.expectedSourceExternalKey, t.sourceExternalKey, 'candidate source key');

  for (const [label, actual] of [
    ['command count', value.lineage.commandCount],
    ['promotion count', value.lineage.promotionCount],
    ['exact command count', value.lineage.exactCommandCount],
    ['exact promotion count', value.lineage.exactPromotionCount],
  ] as const) expect(actual, 1, label);
  expect(value.lineage.commandId, t.promotionCommandId, 'command ID');
  expect(value.lineage.commandPayloadSha256, t.commandPayloadSha256, 'command payload SHA');
  expect(value.lineage.initialReplayed, false, 'initial replay state');
  expect(value.lineage.authorizationCommandId, t.promotionCommandId, 'promotion authorization command');
  expect(value.lineage.promotionExternalProductCode, t.canaryExternalProductCode, 'promotion external code');
  expect(value.lineage.commercialSkuId, t.commercialSkuId, 'promotion Commercial SKU');
  expect(value.lineage.externalMappingId, t.activeOrdermentumMappingId, 'promotion external mapping');
  expect(value.lineage.sourceMappingId, t.sourceMappingId, 'promotion source mapping');
  expect(value.lineage.sourcePayloadSha256, t.sourcePayloadSha256, 'promotion source SHA');
  expectTimestamp(value.lineage.promotedAt, t.promotionTimestamp, 'promotion timestamp');

  expect(value.audit.count, 1, 'promotion audit cardinality');
  expect(value.audit.id, t.auditId, 'promotion audit ID');
  expect(value.audit.event, t.auditEvent, 'promotion audit event');
  expect(value.audit.actorRole, t.auditActorRole, 'promotion audit actor role');
  expect(value.audit.targetType, 'external_product_mappings', 'promotion audit target type');
  expect(value.audit.targetId, t.activeOrdermentumMappingId, 'promotion audit target ID');
  expect(value.audit.commandId, t.promotionCommandId, 'audit command lineage');
  expect(value.audit.commercialSkuId, t.commercialSkuId, 'audit Commercial SKU lineage');
  expect(value.audit.externalMappingId, t.activeOrdermentumMappingId, 'audit mapping lineage');
  expect(value.audit.replayed, false, 'audit replay state');

  expect(value.negativeSpace.candidateCount, 164, 'candidate count');
  expect(value.negativeSpace.expansionCandidateCount, 163, 'expansion candidate count');
  expect(value.negativeSpace.planCommands, 1, 'PLAN command count');
  expect(value.negativeSpace.canaryUnlocks, 1, 'CANARY unlock count');
  expect(value.negativeSpace.unlockCommands, 1, 'unlock command count');
  expect(value.negativeSpace.enabledCandidates, 1, 'enabled candidate count');
  expect(value.negativeSpace.enabledCodes.join(','), t.canaryExternalProductCode, 'sole enabled candidate');
  expect(value.negativeSpace.p4EnabledCandidates, 0, 'P4 enabled candidates');
  expect(value.negativeSpace.nonCanaryPromotions, 0, 'non-canary promotions');
  expect(value.negativeSpace.secondPromotionCount, 0, 'second promotions');

  const currentExpected = {
    commercialSkus: 192,
    skuFamilies: 4,
    physicalSkus: 4,
    packages: 4,
    barcodeBindings: 4,
    commercialFamilyLinks: 4,
    inventoryMovements: 0,
    warehouseMovements: 0,
    locationItems: 0,
    stockMovements: 0,
    locationQuantity: 0,
    inventoryBalanceRows: 1,
    inventoryQoh: 11,
    imageAssets: 467,
    imageCopyRuns: 45,
  } as const;
  for (const [label, expected] of Object.entries(currentExpected)) {
    expect(value.sentinels.current[label], expected, `current ${label}`);
  }
  for (const [label, count] of Object.entries(value.sentinels.sinceP2B)) {
    expect(count, 0, `${label} since P2B`);
  }

  if (!['NO_PROVIDER_ACTIVITY', 'ATTRIBUTED_INCUMBENT_LEGACY_SYNC'].includes(value.providerSentinel.status)) {
    hold('provider activity is not attributable');
  }
  expect(value.providerSentinel.p3aEmittedProviderTraffic, 0, 'P3A provider traffic');
  expect(value.providerSentinel.allowedWorkflow, t.allowedProviderWorkflow, 'allowed provider workflow');
  expect(value.providerSentinel.allowedWorkflowRunId, t.allowedProviderWorkflowRunId, 'allowed provider workflow run');
  expect(value.providerSentinel.allowedOperationalRunId, t.allowedProviderOperationalRunId, 'allowed operational run');
  expect(value.providerSentinel.authMode, 'legacy-bearer', 'allowed provider auth mode');
  expect(value.providerSentinel.unattributedSyncRuns, 0, 'unattributed provider runs');
  expect(value.providerSentinel.unattributedRawApiEvents, 0, 'unattributed provider events');
  expect(value.providerSentinel.currentApiShadowExecuted, false, '#359-C shadow execution');
  expect(value.providerSentinel.legacyRetired, false, 'legacy retirement');
  expect(value.noProductionBusinessMutation, true, 'P3 mutation boundary');
  expect(value.p4Locked, true, 'P4 lock');
  expect(value.failedChecks.length, 0, 'server failed checks');
}

export function formatCommercialWave2P3VerificationFailure(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  return detail.startsWith('ECOFLOW-R3-P3') ? detail : `ECOFLOW-R3-P3 — HOLD_AT_P3 — ${detail}`;
}
