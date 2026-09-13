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
} as const;

export type CommercialWave2P3VerificationReport = {
  mode: 'P3_VERIFY_READ_ONLY';
  stage: 'P3_VERIFICATION_ONLY';
  verdict: 'PASS' | 'HOLD';
  verifiedAt: string;
  verifierRole: 'OWNER' | 'ADMIN';
  identity: {
    count: number;
    id: string | null;
    code: string | null;
    setupStatus: string | null;
    category: string | null;
    storageUnit: string | null;
    pickUnit: string | null;
  };
  mapping: {
    count: number;
    id: string | null;
    provider: string | null;
    isActive: boolean | null;
    internalSkuId: string | null;
    confidence: string | null;
  };
  provenance: {
    count: number;
    id: string | null;
    revision: number | null;
    sourcePayloadSha256: string | null;
    sourceExternalKey: string | null;
    sourceExternalCode: string | null;
    sourceDuplicateCount: number | null;
  };
  lineage: {
    commandCount: number;
    promotionCount: number;
    commandId: string | null;
    commandPayloadSha256: string | null;
    initialReplayed: boolean | null;
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
    replayed: boolean | null;
  };
  negativeSpace: {
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
    current: {
      commercialSkus: number;
      skuFamilies: number;
      physicalSkus: number;
      packages: number;
      barcodeBindings: number;
      commercialFamilyLinks: number;
      inventoryMovements: number;
      warehouseMovements: number;
      locationItems: number;
      stockMovements: number;
      locationQuantity: number;
      inventoryBalanceRows: number;
      inventoryQoh: number;
      imageAssets: number;
      imageCopyRuns: number;
    };
    sincePromotion: Record<string, number>;
    boundaries: {
      providerTraffic: number;
      callerSwitch: number;
      cutover: number;
      nonPromotionAudits: number;
    };
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

export function buildCommercialWave2P3VerificationInput() {
  const t = COMMERCIAL_WAVE2_P3_TARGET;
  return {
    expectedCommandId: t.promotionCommandId,
    expectedCandidateSetSha256: t.candidateSetSha256,
    expectedExternalProductCode: t.canaryExternalProductCode,
    expectedCommercialSkuId: t.commercialSkuId,
    expectedExternalMappingId: t.activeOrdermentumMappingId,
    expectedSourceMappingId: t.sourceMappingId,
    expectedSourcePayloadSha256: t.sourcePayloadSha256,
  };
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
  expect(value.provenance.sourceExternalCode, t.canaryExternalProductCode, 'source external code');
  expect(value.provenance.sourceDuplicateCount, 1, 'source duplicate count');
  expect(value.lineage.commandCount, 1, 'command count');
  expect(value.lineage.promotionCount, 1, 'promotion count');
  expect(value.lineage.commandId, t.promotionCommandId, 'command ID');
  expect(value.lineage.commandPayloadSha256, t.commandPayloadSha256, 'command payload SHA');
  expect(value.lineage.initialReplayed, false, 'initial replay state');
  expect(value.lineage.authorizationCommandId, t.promotionCommandId, 'promotion authorization command');
  expect(value.lineage.promotionExternalProductCode, t.canaryExternalProductCode, 'promotion external code');
  expect(value.lineage.commercialSkuId, t.commercialSkuId, 'promotion Commercial SKU');
  expect(value.lineage.externalMappingId, t.activeOrdermentumMappingId, 'promotion external mapping');
  expect(value.lineage.sourceMappingId, t.sourceMappingId, 'promotion source mapping');
  expect(value.lineage.sourcePayloadSha256, t.sourcePayloadSha256, 'promotion source SHA');
  expect(value.lineage.promotedAt, t.promotionTimestamp, 'promotion timestamp');
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
  expect(value.negativeSpace.enabledCandidates, 1, 'enabled candidate count');
  expect(value.negativeSpace.enabledCodes.join(','), t.canaryExternalProductCode, 'sole enabled candidate');
  expect(value.negativeSpace.p4EnabledCandidates, 0, 'P4 enabled candidates');
  expect(value.negativeSpace.nonCanaryPromotions, 0, 'non-canary promotions');
  expect(value.negativeSpace.secondPromotionCount, 0, 'second promotions');
  expect(value.sentinels.current.commercialSkus, 192, 'Commercial SKU total');
  for (const [label, actual, expected] of [
    ['SKU families', value.sentinels.current.skuFamilies, 4],
    ['Physical SKUs', value.sentinels.current.physicalSkus, 4],
    ['packages', value.sentinels.current.packages, 4],
    ['barcode bindings', value.sentinels.current.barcodeBindings, 4],
    ['Commercial-family links', value.sentinels.current.commercialFamilyLinks, 4],
    ['inventory movements', value.sentinels.current.inventoryMovements, 0],
    ['warehouse movements', value.sentinels.current.warehouseMovements, 0],
    ['warehouse location items', value.sentinels.current.locationItems, 0],
    ['stock movements', value.sentinels.current.stockMovements, 0],
    ['warehouse location quantity', value.sentinels.current.locationQuantity, 0],
    ['inventory balance rows', value.sentinels.current.inventoryBalanceRows, 1],
    ['inventory QOH', value.sentinels.current.inventoryQoh, 11],
    ['image assets', value.sentinels.current.imageAssets, 467],
    ['image copy runs', value.sentinels.current.imageCopyRuns, 45],
  ] as const) expect(actual, expected, label);
  for (const [label, count] of Object.entries(value.sentinels.sincePromotion)) expect(count, 0, `${label} since P2B`);
  expect(value.sentinels.boundaries.providerTraffic, 0, 'provider traffic');
  expect(value.sentinels.boundaries.callerSwitch, 0, 'caller switch');
  expect(value.sentinels.boundaries.cutover, 0, 'cutover');
  expect(value.sentinels.boundaries.nonPromotionAudits, 0, 'non-P2B boundary audits');
  expect(value.noProductionBusinessMutation, true, 'P3 mutation boundary');
  expect(value.p4Locked, true, 'P4 lock');
  expect(value.failedChecks.length, 0, 'server failed checks');
}

export function formatCommercialWave2P3VerificationFailure(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  return detail.startsWith('ECOFLOW-R3-P3') ? detail : `ECOFLOW-R3-P3 — HOLD_AT_P3 — ${detail}`;
}
