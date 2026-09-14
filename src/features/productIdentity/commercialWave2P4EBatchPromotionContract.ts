export const COMMERCIAL_WAVE2_P4E_PLAN = {
  promotionPlanSha256: '43a557ddf36347c8fa303d02dd4c27b8e0aa7f7e4310955a16f70a98f5f33888',
  candidateSetSha256: '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
  totalCandidates: 163,
  batches: [
    { batchNo: 1, commandId: 'dbd1f89c-720f-4a44-bd31-59787b0d3bd3', candidateCount: 25, firstCode: '140280', lastCode: 'BP-SSD-TT', batchSha256: '7dc7e7aacb5891caa2905a241c68a57920c98173991d5d410cf27b6a2ccf55e3' },
    { batchNo: 2, commandId: '5ad4dd0c-0028-4cc2-9eed-1422f0ba2696', candidateCount: 25, firstCode: 'BPB12', lastCode: 'CCSA6-80', batchSha256: '82d6667c5a077bd7bcfbefd8e27feb37644b80cd0418b050a1f3d83d2ab955c0' },
    { batchNo: 3, commandId: 'e04af561-dd00-4a0b-88b7-aa185508130e', candidateCount: 25, firstCode: 'CCSKBM6-80', lastCode: 'EF-DWLQ20', batchSha256: '59c55ae2e4d40995234f002eabc1f714d3e634babcddc60db5be68cc5cc8584b' },
    { batchNo: 4, commandId: 'bdbd7dfb-ef13-442b-84b6-ce3dead08f8b', candidateCount: 25, firstCode: 'EF-RTUS05', lastCode: 'KNIFE165BULK', batchSha256: 'a03043367fb53ccc81b42e0ea74fe5db9fd6b5ff984ae89f8a56b9303aa05457' },
    { batchNo: 5, commandId: 'ed79bf21-245f-43bc-9722-a8a79be568bb', candidateCount: 25, firstCode: 'KOMCOFFEE12-80', lastCode: 'PCT5', batchSha256: 'f761569972fc8a23fa26cd0fe78516bcf37e648d5a07ace5ebd2d34207ab66d1' },
    { batchNo: 6, commandId: 'd326df14-63ba-4bac-b66e-c5c489a8a039', candidateCount: 25, firstCode: 'PROLL16W', lastCode: 'SCCSPW28BAG', batchSha256: 'ff2e9000c096485ed63b18dbf9adfb545e925a0d1ced8458122f68dd0151a15c' },
    { batchNo: 7, commandId: 'c3a0f311-4efb-4325-804b-d8eb39ef9291', candidateCount: 13, firstCode: 'SK1216', lastCode: 'WRCL', batchSha256: 'ca2ebb59ffbd31e5b8c488ea33b4c39d63ab9194025c3c1bd2157fad87b4f890' },
  ],
} as const;

export type CommercialWave2P4EExpectedBatch = (typeof COMMERCIAL_WAVE2_P4E_PLAN.batches)[number];

export type CommercialWave2P4EBatchGateReport = {
  mode: 'P4E_BATCH_GATE';
  stage: 'P4E_BATCH_PROMOTION';
  verdict: 'PASS' | 'HOLD';
  status: 'READY_FOR_BATCH_EXECUTION' | 'READY_FOR_POSTFLIGHT' | 'ALL_BATCHES_VERIFIED' | 'HOLD';
  action: 'EXECUTE' | 'POSTFLIGHT' | 'COMPLETE' | 'HOLD';
  verifiedAt: string;
  verifierRole: string;
  plan: {
    promotionPlanSha256: string;
    batchCount: number;
    candidateCount: number;
    batches: Array<{
      batchNo: number;
      candidateCount: number;
      firstCode: string;
      lastCode: string;
      batchSha256: string;
    }>;
  };
  programme: {
    verifiedBatchCount: number;
    nextBatchNo: number | null;
    nonCanaryPromotionCount: number;
    nonCanaryPromotionCommandCount: number;
  };
  batch: null | {
    expected: CommercialWave2P4EExpectedBatch;
    eligibleCount: number;
    promotedCount: number;
    commandExists: boolean;
    postflightVerified: boolean;
  };
  authority: {
    batchAuthenticatedExecute: boolean;
    batchServiceRoleExecute: boolean;
    batchAnonExecute: boolean;
    postflightAuthenticatedExecute: boolean;
    postflightServiceRoleExecute: boolean;
    singleSkuAuthenticatedExecute: boolean;
    singleSkuServiceRoleExecute: boolean;
    singleSkuAnonExecute: boolean;
    productionPromotionAuthorized: boolean;
  };
  failedChecks: string[];
};

export type CommercialWave2P4EItemResult = {
  itemPosition: number;
  itemCommandId: string;
  externalProductCode: string;
  commercialSkuId: string;
  externalMappingId: string;
  unleashedMappingId: string;
  sourcePayloadSha256: string;
  promotionPhase: 'EXPANSION';
  setupStatus: 'mapping_draft';
  authorityVersion: 'P4D_CALLER_AUTH_PROMOTION_V2';
  callerAuthenticated: true;
  providerActionIncluded: false;
  physicalAuthorityCreated: false;
  inventoryAuthorityCreated: false;
  replayed: boolean;
};

export type CommercialWave2P4EBatchExecutionResult = {
  mode: 'P4E_BATCH_EXECUTION';
  stage: 'P4E_BATCH_PROMOTION';
  batchNo: number;
  batchCommandId: string;
  candidateCount: number;
  promotionPlanSha256: string;
  batchSha256: string;
  firstCode: string;
  lastCode: string;
  promotedCount: number;
  cumulativePromotedCount: number;
  items: CommercialWave2P4EItemResult[];
  replayed: boolean;
  postflightRequired: true;
  providerActionIncluded: false;
  physicalAuthorityCreated: false;
  inventoryAuthorityCreated: false;
};

export type CommercialWave2P4EPostflightResult = {
  mode: 'P4E_BATCH_POSTFLIGHT';
  stage: 'P4E_BATCH_PROMOTION';
  verdict: 'PASS';
  batchNo: number;
  batchCommandId: string;
  promotionPlanSha256: string;
  batchSha256: string;
  verifiedCandidateCount: number;
  cumulativePromotedCount: number;
  nextBatchNo: number | null;
  programmeComplete: boolean;
  providerActionIncluded: false;
  physicalAuthorityCreated: false;
  inventoryAuthorityCreated: false;
  replayed: boolean;
};

function expectedBatch(batchNo: number) {
  return COMMERCIAL_WAVE2_P4E_PLAN.batches.find((batch) => batch.batchNo === batchNo);
}

export function assertCommercialWave2P4EBatchGate(report: CommercialWave2P4EBatchGateReport) {
  const plan = COMMERCIAL_WAVE2_P4E_PLAN;
  if (report.verdict !== 'PASS') throw new Error(`P4E gate HOLD: ${report.failedChecks.join(', ')}`);
  if (report.plan.promotionPlanSha256 !== plan.promotionPlanSha256 || report.plan.batchCount !== 7 || report.plan.candidateCount !== plan.totalCandidates) {
    throw new Error('P4E frozen promotion plan mismatch.');
  }
  if (report.plan.batches.length !== 7) throw new Error('P4E batch count mismatch.');
  for (const expected of plan.batches) {
    const actual = report.plan.batches.find((batch) => batch.batchNo === expected.batchNo);
    if (!actual || actual.candidateCount !== expected.candidateCount || actual.firstCode !== expected.firstCode || actual.lastCode !== expected.lastCode || actual.batchSha256 !== expected.batchSha256) {
      throw new Error(`P4E batch ${expected.batchNo} hash or range mismatch.`);
    }
  }
  if (!report.authority.batchAuthenticatedExecute || report.authority.batchServiceRoleExecute || report.authority.batchAnonExecute) {
    throw new Error('P4E batch mutation authority mismatch.');
  }
  if (!report.authority.postflightAuthenticatedExecute || report.authority.postflightServiceRoleExecute) {
    throw new Error('P4E postflight authority mismatch.');
  }
  if (report.authority.singleSkuAuthenticatedExecute || report.authority.singleSkuServiceRoleExecute || report.authority.singleSkuAnonExecute) {
    throw new Error('P4E single-SKU delegate is exposed.');
  }
  if (!report.authority.productionPromotionAuthorized) throw new Error('P4E production batch authority is not active.');
  if (report.failedChecks.length !== 0) throw new Error(`P4E failed checks: ${report.failedChecks.join(', ')}`);

  if (report.action === 'COMPLETE') {
    if (report.status !== 'ALL_BATCHES_VERIFIED' || report.programme.verifiedBatchCount !== 7 || report.programme.nonCanaryPromotionCount !== 163 || report.programme.nonCanaryPromotionCommandCount !== 163 || report.programme.nextBatchNo !== null) {
      throw new Error('P4E completion state mismatch.');
    }
    return;
  }

  if (!report.batch || report.programme.nextBatchNo === null) throw new Error('P4E current batch is missing.');
  const expected = expectedBatch(report.programme.nextBatchNo);
  if (!expected || report.batch.expected.batchNo !== expected.batchNo || report.batch.expected.commandId !== expected.commandId || report.batch.expected.batchSha256 !== expected.batchSha256 || report.batch.expected.candidateCount !== expected.candidateCount) {
    throw new Error('P4E current batch target mismatch.');
  }
  if (report.action === 'EXECUTE') {
    if (report.status !== 'READY_FOR_BATCH_EXECUTION' || report.batch.commandExists || report.batch.promotedCount !== 0 || report.batch.eligibleCount !== expected.candidateCount) {
      throw new Error('P4E batch execution preflight mismatch.');
    }
  } else if (report.action === 'POSTFLIGHT') {
    if (report.status !== 'READY_FOR_POSTFLIGHT' || !report.batch.commandExists || report.batch.postflightVerified || report.batch.promotedCount !== expected.candidateCount) {
      throw new Error('P4E postflight gate mismatch.');
    }
  } else {
    throw new Error(`Unexpected P4E action ${report.action}.`);
  }
}

export function assertCommercialWave2P4EBatchExecution(result: CommercialWave2P4EBatchExecutionResult, batchNo: number) {
  const expected = expectedBatch(batchNo);
  if (!expected) throw new Error(`Unknown P4E batch ${batchNo}.`);
  if (result.mode !== 'P4E_BATCH_EXECUTION' || result.stage !== 'P4E_BATCH_PROMOTION') throw new Error('P4E execution acknowledgement mismatch.');
  if (result.batchNo !== batchNo || result.batchCommandId !== expected.commandId || result.candidateCount !== expected.candidateCount || result.promotedCount !== expected.candidateCount) {
    throw new Error(`P4E batch ${batchNo} execution count mismatch.`);
  }
  if (result.promotionPlanSha256 !== COMMERCIAL_WAVE2_P4E_PLAN.promotionPlanSha256 || result.batchSha256 !== expected.batchSha256 || result.firstCode !== expected.firstCode || result.lastCode !== expected.lastCode) {
    throw new Error(`P4E batch ${batchNo} execution lineage mismatch.`);
  }
  if (result.items.length !== expected.candidateCount || !result.postflightRequired || result.providerActionIncluded || result.physicalAuthorityCreated || result.inventoryAuthorityCreated) {
    throw new Error(`P4E batch ${batchNo} execution boundary mismatch.`);
  }
}

export function assertCommercialWave2P4EPostflight(result: CommercialWave2P4EPostflightResult, batchNo: number) {
  const expected = expectedBatch(batchNo);
  if (!expected) throw new Error(`Unknown P4E batch ${batchNo}.`);
  if (result.mode !== 'P4E_BATCH_POSTFLIGHT' || result.stage !== 'P4E_BATCH_PROMOTION' || result.verdict !== 'PASS') throw new Error('P4E postflight acknowledgement mismatch.');
  if (result.batchNo !== batchNo || result.batchCommandId !== expected.commandId || result.batchSha256 !== expected.batchSha256 || result.verifiedCandidateCount !== expected.candidateCount) {
    throw new Error(`P4E batch ${batchNo} postflight lineage mismatch.`);
  }
  if (result.promotionPlanSha256 !== COMMERCIAL_WAVE2_P4E_PLAN.promotionPlanSha256 || result.providerActionIncluded || result.physicalAuthorityCreated || result.inventoryAuthorityCreated) {
    throw new Error(`P4E batch ${batchNo} postflight boundary mismatch.`);
  }
  if (batchNo < 7 && (result.programmeComplete || result.nextBatchNo !== batchNo + 1)) throw new Error('P4E next-batch gate mismatch.');
  if (batchNo === 7 && (!result.programmeComplete || result.nextBatchNo !== null || result.cumulativePromotedCount !== 163)) throw new Error('P4E final completion mismatch.');
}

export function formatCommercialWave2P4EFailure(error: unknown) {
  return `ECOFLOW-R3-P4E — HOLD / ${error instanceof Error ? error.message : String(error)}`;
}
