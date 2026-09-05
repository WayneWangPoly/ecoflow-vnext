// #338 customer staging groundwork only.
// Intentionally non-executable: no Supabase client, function invocation, or browser mutation path.
// Customer non-dry staging requires a fresh explicit authorization after a fresh dry preflight.

export const CUSTOMER_STAGING_PLAN = {
  resource: 'customers',
  mode: 'bounded_snapshot',
  sourceBaseline: {
    dryRunId: '90550288-1386-464a-9fc8-f860969e9e3b',
    pageSize: 200,
    totalItems: 623,
    totalPages: 4,
    highWatermark: '2026-09-03T00:41:50.599Z',
    pages: [
      {
        pageNumber: 1,
        recordsSeen: 200,
        responseSha256: '1e5305c744c62bd9a4d66c0c61892e978e906c07c13a1798c87b71ba53386051',
      },
      {
        pageNumber: 2,
        recordsSeen: 200,
        responseSha256: 'b45c925d1c0b89ce7f0c2b2b5e794a851b5da8e5c1d3927e2137e91434c6dcc0',
      },
      {
        pageNumber: 3,
        recordsSeen: 200,
        responseSha256: 'a60132a515a0637ca6f8e867ef45555aee7f143054f9fb4c6fe20807207b0264',
      },
      {
        pageNumber: 4,
        recordsSeen: 23,
        responseSha256: 'f076cca9429ed99ec6b2fc6ce9b1e6bfa481307ece3a7f447f28203a104cff93',
      },
    ],
  },
  freshPreflightRequired: true,
  nonDryAuthorized: false,
  proposedWindow: {
    pageSize: 200,
    maxPages: 1,
    maxRows: 200,
  },
  expectedSequence: [
    { startPage: 1, maxPages: 1, maxRows: 200 },
    { startPage: 2, maxPages: 1, maxRows: 200 },
    { startPage: 3, maxPages: 1, maxRows: 200 },
    { startPage: 4, maxPages: 1, maxRows: 23 },
  ],
  acceptance: {
    httpStatus: 200,
    recordsFailed: 0,
    recordsChanged: 0,
    requireExactFreshPreflightSha: true,
    requireCursorAndLeaseVerificationAfterEachWindow: true,
    requireDatabaseByteEvidenceAfterEachWindow: true,
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

export type CustomerStagingPlan = typeof CUSTOMER_STAGING_PLAN;
