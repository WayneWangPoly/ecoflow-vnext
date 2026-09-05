// #338 product staging groundwork only.
// This file is deliberately NON-EXECUTABLE: products non-dry is not authorized.
// PLAN, COPY_IMAGES, Product Identity, inventory/opening-balance authority and cutover remain forbidden.

export const PRODUCT_STAGING_PLAN = {
  resource: 'products',
  mode: 'bounded_snapshot',
  authorization: {
    granted: false,
    scope: 'NONE',
    reason: 'Customer C1-C4 authorization explicitly excluded products non-dry.',
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
  unresolvedBeforeAuthorization: {
    exactExistingSampleOverlapWithFullPage1: true,
    exactExpectedPage1InsertedChangedUnchangedSplit: true,
    rule: 'Do not authorize product non-dry until the one historical sample is explicitly accounted for in the full-page acceptance contract. Do not assume 200 inserts on P1.',
  },
  proposedSequence: [
    { window: 'P1', startPage: 1, maxPages: 1, expectedRowsSeen: 200, previousRunId: null, status: 'BLOCKED_NOT_AUTHORIZED' },
    { window: 'P2', startPage: 2, maxPages: 1, expectedRowsSeen: 200, previousRunId: 'FROM_VERIFIED_P1_RUN_ID', status: 'BLOCKED' },
    { window: 'P3', startPage: 3, maxPages: 1, expectedRowsSeen: 66, previousRunId: 'FROM_VERIFIED_P2_RUN_ID', status: 'BLOCKED' },
  ],
  executionShape: {
    pageSize: 200,
    maxPagesPerRun: 1,
    oneWindowThenVerify: true,
    sameActorRequiredAcrossContinuationChain: true,
    requireExactDryShaPerPage: true,
    requireCursorAndLeaseVerificationAfterEachWindow: true,
    requireDatabaseByteEvidenceAfterEachWindow: true,
  },
  forbiddenAuthorities: [
    'products non-dry until separately authorized',
    'PLAN',
    'COPY_IMAGES',
    'Product Identity',
    'inventory',
    'opening balance',
    'cutover',
  ],
} as const;

export type ProductStagingPlan = typeof PRODUCT_STAGING_PLAN;
