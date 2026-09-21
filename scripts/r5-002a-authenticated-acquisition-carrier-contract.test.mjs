import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  R5_002_REQUEST,
  R5_008_REQUEST,
  runR5002Adl1StockOnHandAcquisition,
  runR5008Adl1StockOnHandAcquisition,
} from '../src/features/team/unleashedAdl1StockOnHandAcquisition.ts';

const migrationPath = 'supabase/migrations/20260914213123_unleashed_r5_002_request_key_fence.sql';
const functionPath = 'supabase/functions/trigger-unleashed-readonly-sync/index.ts';
const panelPath = 'src/features/settings/UnleashedReadonlyProbePanel.tsx';
const freshPanelPath = 'src/features/settings/FreshAdl1StockOnHandAcquisitionPanel.tsx';
const workflowPath = '.github/workflows/unleashed-readonly-connector-check.yml';
const workPackagePath = 'docs/engineering/work-packages/ECOFLOW-R5-002A-owner-admin-acquisition-carrier.md';

const [migration, edgeFunction, panel, freshPanel, workflow, workPackage] = await Promise.all([
  readFile(migrationPath, 'utf8'),
  readFile(functionPath, 'utf8'),
  readFile(panelPath, 'utf8'),
  readFile(freshPanelPath, 'utf8'),
  readFile(workflowPath, 'utf8'),
  readFile(workPackagePath, 'utf8'),
]);

const acceptedResult = {
  ok: true,
  runId: '11111111-1111-4111-8111-111111111111',
  requestKey: 'ECOFLOW-R5-002',
  requestedAt: '2026-09-14T00:00:00.000Z',
  status: 'SUCCEEDED',
  dryRun: false,
  resources: ['stock_on_hand'],
  pageSize: 200,
  maxPages: 5,
  startPage: 1,
  previousRunId: null,
  allResourcesComplete: true,
  target: { warehouseCode: 'ADL1' },
  recordsSeen: 2,
  recordsStaged: 2,
  recordsInserted: 2,
  recordsChanged: 0,
  recordsUnchanged: 0,
  recordsFailed: 0,
  failedResources: [],
  paginationWindows: [{
    resource: 'stock_on_hand',
    startPage: 1,
    lastPage: 1,
    numberOfPages: 1,
    windowComplete: true,
    nextPage: null,
    highWatermark: null,
  }],
  pages: [{
    resource: 'stock_on_hand',
    endpointPath: '/StockOnHand/1',
    pageNumber: 1,
    pageSize: 200,
    httpStatus: 200,
    responseSha256: 'a'.repeat(64),
    recordsSeen: 2,
    recordsStaged: 2,
    recordsInserted: 2,
    recordsChanged: 0,
    recordsUnchanged: 0,
    fetchAttempts: 1,
    highWatermark: null,
    pagination: {},
  }],
  errorCode: null,
  errorMessage: null,
};

function mockSupabase(data) {
  const bodies = [];
  return {
    bodies,
    client: {
      functions: {
        invoke: async (name, options) => {
          assert.equal(name, 'trigger-unleashed-readonly-sync');
          bodies.push(options.body);
          return { data, error: null };
        },
      },
    },
  };
}

test('client sends the exact frozen R5-002 request and accepts bounded evidence only', async () => {
  const mock = mockSupabase(acceptedResult);
  const result = await runR5002Adl1StockOnHandAcquisition(mock.client);

  assert.deepEqual(mock.bodies, [R5_002_REQUEST]);
  assert.deepEqual(R5_002_REQUEST, {
    requestKey: 'ECOFLOW-R5-002',
    mode: 'bounded_snapshot',
    resources: ['stock_on_hand'],
    reason: 'ECOFLOW-R5-002 production ADL1 warehouse-scoped StockOnHand acquisition',
    dryRun: false,
    pageSize: 200,
    maxPages: 5,
    target: { warehouseCode: 'ADL1' },
  });
  assert.equal(Object.hasOwn(R5_002_REQUEST, 'modifiedSince'), false);
  assert.equal(Object.hasOwn(R5_002_REQUEST, 'startPage'), false);
  assert.equal(Object.hasOwn(R5_002_REQUEST, 'previousRunId'), false);
  assert.equal(result.runId, acceptedResult.runId);
});

test('client fails closed on incomplete or shape-drifted evidence', async () => {
  for (const mutation of [
    { requestKey: 'ECOFLOW-R5-002-REPLAY' },
    { status: 'PARTIAL' },
    { allResourcesComplete: false },
    { target: { warehouseCode: 'OTHER' } },
    { recordsFailed: 1 },
    { paginationWindows: [{ ...acceptedResult.paginationWindows[0], windowComplete: false, nextPage: 2 }] },
    { pages: [{ ...acceptedResult.pages[0], endpointPath: '/StockOnHand/6', pageNumber: 6 }] },
  ]) {
    const mock = mockSupabase({ ...acceptedResult, ...mutation });
    await assert.rejects(
      runR5002Adl1StockOnHandAcquisition(mock.client),
      /R5_002_ACQUISITION_RESULT_REJECTED|R5_002_ACQUISITION_CONTRACT_VIOLATION/,
    );
  }
});

test('server reserves and validates R5-002 before run creation or fetch', () => {
  assert.match(edgeFunction, /const R5_002_REQUEST_KEY = 'ECOFLOW-R5-002'/);
  assert.match(edgeFunction, /function assertReservedRequestShape/);
  assert.match(edgeFunction, /R5_002_REQUEST_SHAPE_MISMATCH/);
  assert.match(edgeFunction, /assertReservedRequestShape\([\s\S]*body[\s\S]*mode[\s\S]*target/);
  const shapeCheck = edgeFunction.lastIndexOf('assertReservedRequestShape({');
  const runClaim = edgeFunction.indexOf(".from('unleashed_sync_runs')\n    .insert({");
  const providerFetch = edgeFunction.lastIndexOf('fetchUnleashedWithRetry(url,');
  assert.ok(shapeCheck > 0 && shapeCheck < runClaim);
  assert.ok(runClaim > 0 && runClaim < providerFetch);
  assert.match(edgeFunction, /runError\?\.code === '23505'/);
  assert.match(edgeFunction, /UNLEASHED_REQUEST_KEY_REPLAY_BLOCKED/);
  assert.match(edgeFunction, /request_key: requestKey/);
  assert.match(edgeFunction, /requestKey,/);
});

test('migration creates a replay-safe atomic request-key claim', () => {
  assert.match(migration, /create unique index if not exists unleashed_sync_runs_request_key_uidx/);
  assert.match(migration, /\(\(metadata ->> 'request_key'\)\)/);
  assert.match(migration, /where metadata \? 'request_key'/);
  assert.match(migration, /length\(btrim\(metadata ->> 'request_key'\)\) > 0/);
});

test('Owner/Admin UI requires acknowledgement and becomes non-retryable after first attempt', () => {
  assert.match(panel, /Review ADL1 acquisition/);
  assert.match(panel, /warehouse ADL1/);
  assert.match(panel, /No STAGE, opening balance, stocktake, inventory movement, or Product Identity mutation/);
  assert.match(panel, /type="checkbox"/);
  assert.match(panel, /acquisitionAttempted/);
  assert.match(panel, /setAcquisitionAttempted\(true\)/);
  assert.match(panel, /Do not retry\. Verify the production ledger first\./);
  assert.match(panel, /disabled=\{!acquisitionAcknowledged \|\| acquisitionRunning \|\| acquisitionAttempted/);
  assert.doesNotMatch(panel, /setAcquisitionAttempted\(false\)/);
});

test('CI includes the carrier and database replay contract', () => {
  assert.match(workflow, /r5-002a-authenticated-acquisition-carrier-contract\.test\.mjs/);
  assert.match(workflow, /20260914213123_unleashed_r5_002_request_key_fence\.sql/);
  assert.match(workflow, /r5-002a-authenticated-acquisition-carrier-db-contract-test\.sql/);
  assert.match(workflow, /agent\/unleashed\/r5-002a-\*/);
  assert.match(workPackage, /does\s+not execute the acquisition or authorize a retry/);
});


test('R5-008 fresh pre-stocktake acquisition is a new one-shot reserved shape', async () => {
  const accepted = { ...acceptedResult, requestKey: 'ECOFLOW-R5-008' };
  const mock = mockSupabase(accepted);
  const result = await runR5008Adl1StockOnHandAcquisition(mock.client);

  assert.deepEqual(mock.bodies, [R5_008_REQUEST]);
  assert.deepEqual(R5_008_REQUEST, {
    requestKey: 'ECOFLOW-R5-008',
    mode: 'bounded_snapshot',
    resources: ['stock_on_hand'],
    reason: 'ECOFLOW-R5-008 fresh pre-stocktake ADL1 StockOnHand acquisition',
    dryRun: false,
    pageSize: 200,
    maxPages: 5,
    target: { warehouseCode: 'ADL1' },
  });
  assert.equal(result.requestKey, 'ECOFLOW-R5-008');
  assert.match(edgeFunction, /const R5_008_REQUEST_KEY = 'ECOFLOW-R5-008'/);
  assert.match(edgeFunction, /R5_008_REASON = 'ECOFLOW-R5-008 fresh pre-stocktake ADL1 StockOnHand acquisition'/);
  assert.match(panel, /R5-002-R2 ADL1 StockOnHand recovery/);
  assert.match(panel, /Run R5-002-R2 once/);
  assert.match(panel, /FreshAdl1StockOnHandAcquisitionPanel/);
  assert.match(freshPanel, /R5-008 fresh ADL1 StockOnHand pre-stocktake snapshot/);
  assert.match(freshPanel, /Acquire fresh ADL1 snapshot once/);
});
