// #338 product staging authorization contract.
// Authorization scope: products P1-P3 only, one window at a time with production verification between windows.
// PLAN, COPY_IMAGES, Product Identity, inventory/opening-balance authority and cutover remain forbidden.

export const PRODUCT_STAGING_PLAN = {
  resource: 'products',
  mode: 'bounded_snapshot',
  authorization: {
    granted: true,
    scope: 'P1-P3',
    executionPolicy: 'ONE_WINDOW_THEN_VERIFY',
    currentExposedWindow: 'P1',
  },
  freshSourceEvidence: {
    dryRunId: '833490c8-040b-4b9b-b895-d491efb5a256',
    comparedBaselineDryRunId: '90550288-1386-464a-9fc8-f860969e9e3b',
    pageSize: 200,
    totalItems: 466,
    totalPages: 3,
    pages: [
      { pageNumber: 1, recordsSeen: 200, responseSha256: '7ee8898311233afe8b39fb775f5567d1714e26f2683d3b1da49a0194836b4234' },
      { pageNumber: 2, recordsSeen: 200, responseSha256: '87d71cce609c15d3830afa09498c03c85eeb348ed75e5a7d3ac9487f9f3f8ed4' },
      { pageNumber: 3, recordsSeen: 66, responseSha256: '4a62dde0aa694aa6bb0578a7e576da60ac7a5c98d57a609de51bca8972a67528' },
    ],
  },
  currentProductionBaseline: {
    snapshots: 1,
    identities: 1,
    activeLeaseCount: 0,
    cursorStatus: 'READY',
    cursorKind: 'HISTORICAL_TARGETED_SAMPLE',
    existingSample: {
      externalKey: 'guid:e80b9e1d-f33d-4ebf-b76d-dfdd9beb1a7b',
      guid: 'e80b9e1d-f33d-4ebf-b76d-dfdd9beb1a7b',
      productCode: '140010',
      displayName: '5L Rapid Clean - Manual Dishwashing Liquid',
      payloadSha256: '016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8',
      sourceLastModifiedAt: '2026-06-01T03:52:11.875Z',
    },
  },
  overlapBudget: {
    initial: 1,
    consumed: 0,
    remaining: 1,
    rule: 'Across P1-P3 exactly one row may classify as changed or unchanged because exactly one historical product snapshot already exists. Every other row must classify as inserted.',
  },
  expectedSequence: [
    { window: 'P1', startPage: 1, maxPages: 1, expectedRowsSeen: 200, previousRunId: null, expectedWindowComplete: false, expectedNextPage: 2, status: 'EXPOSED' },
    { window: 'P2', startPage: 2, maxPages: 1, expectedRowsSeen: 200, previousRunId: 'FROM_VERIFIED_P1_RUN_ID', expectedWindowComplete: false, expectedNextPage: 3, status: 'BLOCKED_PENDING_P1_VERIFICATION' },
    { window: 'P3', startPage: 3, maxPages: 1, expectedRowsSeen: 66, previousRunId: 'FROM_VERIFIED_P2_RUN_ID', expectedWindowComplete: true, expectedNextPage: null, status: 'BLOCKED_PENDING_P2_VERIFICATION' },
  ],
  executionShape: {
    pageSize: 200,
    maxPagesPerRun: 1,
    maxRowsPerRun: 200,
    oneWindowThenVerify: true,
    sameActorRequiredAcrossContinuationChain: true,
    previousRunIdRequiredFromWindow2Onward: true,
    requireExactDryShaPerPage: true,
    requireCursorAndLeaseVerificationAfterEachWindow: true,
    requireDatabaseByteEvidenceAfterEachWindow: true,
    requireHistoricalOverlapBudgetTracking: true,
    stopOnAnyMismatch: true,
  },
  acceptance: {
    totalUniqueRecords: 466,
    totalUniqueSnapshotsRequired: 466,
    totalUniqueIdentitiesRequired: 466,
    recordsFailed: 0,
    requireExactPageCountAndRowCountPerWindow: true,
    requireExactFreshPreflightShaPerPage: true,
    oneOverlapAcrossWholeChain: true,
  },
  forbiddenAuthorities: [
    'PLAN',
    'COPY_IMAGES',
    'Product Identity',
    'inventory',
    'opening balance',
    'cutover',
  ],
} as const;

export type ProductStagingPlan = typeof PRODUCT_STAGING_PLAN;
