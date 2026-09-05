// #338 Batch 1B-5B continuation contract only.
// This file is intentionally non-executable: no Supabase client, no function invocation, no browser action.

export const ADDRESS_CONTINUATION_PLAN = {
  resource: 'customer_delivery_addresses',
  mode: 'bounded_snapshot',
  dryRun: false,
  pageSize: 50,
  maxPages: 2,
  startPage: 3,
  previousRunId: 'eb29994d-85b7-40d1-b098-d9f68c28c4da',
  expectedTotalItems: 184,
  expectedTotalPages: 4,
  expectedRecordsSeen: 84,
  expectedRecordsStaged: 84,
  expectedRecordsInserted: 84,
  expectedRecordsChanged: 0,
  expectedRecordsUnchanged: 0,
  expectedRecordsFailed: 0,
  expectedWindowComplete: true,
  expectedNextPage: null,
  expectedPages: [
    {
      pageNumber: 3,
      recordsSeen: 50,
      responseSha256: '5cb4b96d1fce74823a1d82dc093ced5f10b529c337f039c9bfda8d1c8af5c8f7',
    },
    {
      pageNumber: 4,
      recordsSeen: 34,
      responseSha256: '054945f71d40f5a8ef5300adaf4a024b13d5b93dbaf6bc05747df722a7703f5d',
    },
  ],
  forbiddenAuthorities: [
    'PLAN',
    'COPY_IMAGES',
    'Product Identity',
    'inventory',
    'cutover',
  ],
} as const;

export type AddressContinuationPlan = typeof ADDRESS_CONTINUATION_PLAN;
