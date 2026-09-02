import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runUnleashedConnectorAcceptance } from '../src/features/team/unleashedConnectorAcceptance.ts';

const migrationPath = 'supabase/migrations/20260830090000_unleashed_readonly_connector_foundation.sql';
const warehouseCatalogMigrationPath = 'supabase/migrations/20260830123000_unleashed_snapshot_catalog_warehouse_code.sql';
const functionPath = 'supabase/functions/trigger-unleashed-readonly-sync/index.ts';
const corePath = 'supabase/functions/trigger-unleashed-readonly-sync/core.ts';
const workPackagePath = 'docs/engineering/work-packages/UNLEASHED-MIGRATION-002-bounded-readonly-connector.md';
const workflowPath = '.github/workflows/unleashed-readonly-connector-check.yml';
const probeClientPath = 'src/features/team/unleashedReadonlyProbe.ts';
const acceptanceClientPath = 'src/features/team/unleashedConnectorAcceptance.ts';
const probePanelPath = 'src/features/settings/UnleashedReadonlyProbePanel.tsx';
const appPath = 'src/app/App.tsx';
const operationalSettingsPath = 'src/features/operationalStability/OperationalStabilityWorkspaceV2.tsx';

const [migration, warehouseCatalogMigration, edgeFunctionIndex, edgeFunctionCore, workPackage, workflow, probeClient, acceptanceClient, probePanel, app, operationalSettings] = await Promise.all([
  readFile(migrationPath, 'utf8'),
  readFile(warehouseCatalogMigrationPath, 'utf8'),
  readFile(functionPath, 'utf8'),
  readFile(corePath, 'utf8'),
  readFile(workPackagePath, 'utf8'),
  readFile(workflowPath, 'utf8'),
  readFile(probeClientPath, 'utf8'),
  readFile(acceptanceClientPath, 'utf8'),
  readFile(probePanelPath, 'utf8'),
  readFile(appPath, 'utf8'),
  readFile(operationalSettingsPath, 'utf8'),
]);
const edgeFunction = `${edgeFunctionIndex}\n${edgeFunctionCore}`;

test('Unleashed signature contract signs only the query string', () => {
  const query = 'customerCode=ACME&pageSize=1';
  const key = 'private-key-used-only-for-contract-test';
  const expected = createHmac('sha256', key).update(query).digest('base64');

  assert.equal(expected, 'yBBO4zWITg+azpKC+ZELhNqWJz79oqarOvdex2hoU2I=');
  assert.match(edgeFunction, /crypto\.subtle\.importKey\([\s\S]*\{ name: 'HMAC', hash: 'SHA-256' \}/);
  assert.match(edgeFunction, /crypto\.subtle\.sign\('HMAC', key, encoder\.encode\(queryString\)\)/);
  assert.doesNotMatch(edgeFunction, /encoder\.encode\(`\/\$\{definition\.endpoint\}/);
});

test('Edge Function keeps Unleashed credentials server-side and header-only', () => {
  for (const token of ['UNLEASHED_API_ID', 'UNLEASHED_API_KEY', 'UNLEASHED_CLIENT_TYPE']) {
    assert.match(edgeFunction, new RegExp(token));
  }
  assert.match(edgeFunction, /'api-auth-id': unleashedApiId/);
  assert.match(edgeFunction, /'api-auth-signature': signature/);
  assert.match(edgeFunction, /'client-type': clientType/);
  assert.match(edgeFunction, /credentials_location: 'supabase_edge_function_secrets'/);
  assert.doesNotMatch(edgeFunction, /console\.(?:log|warn|error|info)\([\s\S]*(?:unleashedApiId|unleashedApiKey|signature)/);
  assert.doesNotMatch(edgeFunction, /url\.searchParams\.append\(['"](?:api-auth-id|api-auth-signature|apiKey|token|secret)/i);
  assert.doesNotMatch(edgeFunction, /error_message:\s*responseText\.slice/is);
  assert.match(edgeFunction, /upstream_body_redacted: true/);
});

test('Edge Function is GET-only against allowlisted migration resources', () => {
  assert.match(edgeFunction, /const RESOURCE_DEFINITIONS = \{/);
  assert.match(edgeFunction, /method: 'GET'/);
  assert.doesNotMatch(edgeFunction, /method: 'PUT'/);
  assert.doesNotMatch(edgeFunction, /method: 'DELETE'/);
  assert.doesNotMatch(edgeFunction, /method: 'PATCH'/);
  assert.doesNotMatch(edgeFunction, /\/Complete\b|\/Obsolete\b|\/Delete\b/);
  assert.match(edgeFunction, /orderStatus: 'Parked,Placed,Backordered'/);
  assert.match(edgeFunction, /orderStatus: 'Parked,Placed,Unapproved,Costed,Receipted'/);
  assert.doesNotMatch(edgeFunction, /orderStatus: 'Open'/);

  for (const resource of [
    'products',
    'customers',
    'suppliers',
    'warehouses',
    'stock_on_hand',
    'sales_orders_open',
    'purchase_orders_open',
    'sales_invoices',
    'credit_notes',
    'sales_shipments',
    'warehouse_stock_transfers',
    'sell_price_tiers',
  ]) {
    assert.match(edgeFunction, new RegExp(`${resource}: \\{`));
  }
});

test('Connector execution is bounded and dry-run by default', () => {
  assert.match(edgeFunction, /const HARD_MAX_PAGE_SIZE = 200/);
  assert.match(edgeFunction, /const HARD_MAX_PAGES = 5/);
  assert.match(edgeFunction, /const dryRun = body\.dryRun !== false/);
  assert.match(edgeFunction, /pageSize = mode === 'probe' \|\| target[\s\S]*normalizeInteger\(body\.pageSize/);
  assert.match(edgeFunction, /maxPages = mode === 'probe' \|\| target[\s\S]*normalizeInteger\(body\.maxPages/);
});

test('Targeted reads accept only deterministic product, stock, sales-order, and purchase-order selectors', () => {
  assert.match(edgeFunction, /type TargetField = 'guid' \| 'productCode' \| 'productId' \| 'warehouseCode' \| 'orderNumber'/);
  assert.match(edgeFunction, /TARGET_REQUIRES_ONE_RESOURCE/);
  assert.match(edgeFunction, /TARGET_NOT_SUPPORTED_FOR_RESOURCE/);
  assert.match(edgeFunction, /resource === 'products'/);
  assert.match(edgeFunction, /resource === 'stock_on_hand'/);
  assert.match(edgeFunction, /resource === 'sales_orders_open' \|\| resource === 'purchase_orders_open'/);
  assert.match(edgeFunction, /encodeURIComponent\(target\.pathIdentifier\)/);
  assert.match(edgeFunction, /TARGET_WITH_MODIFIED_SINCE_UNSUPPORTED/);
  assert.match(edgeFunction, /UNLEASHED_TARGET_NOT_FOUND/);
  assert.match(edgeFunction, /UNLEASHED_TARGET_AMBIGUOUS/);
  assert.match(edgeFunction, /query: \{ productId: guid \}/);
  assert.match(edgeFunction, /serializeUnleashedQuery\(query\)/);
  assert.match(edgeFunction, /replaceAll\('%2C', ','\)/);
});

test('Upstream GET retries are bounded and limited to transient failures', () => {
  assert.match(edgeFunction, /const MAX_FETCH_ATTEMPTS = 3/);
  assert.match(edgeFunction, /status === 408 \|\| status === 429 \|\| \(status >= 500 && status <= 599\)/);
  assert.match(edgeFunction, /attempt <= MAX_FETCH_ATTEMPTS/);
  assert.match(edgeFunction, /method: 'GET'/);
  assert.match(edgeFunction, /UNLEASHED_API_RETRY_EXHAUSTED/);
  assert.match(edgeFunction, /fetch_attempts: fetchAttempts/);
});

test('A failed resource is recorded without hiding later resource evidence', () => {
  assert.match(edgeFunction, /const failedResources: ResourceName\[\] = \[\]/);
  assert.match(edgeFunction, /if \(resourceFailed\) \{\s*failedResources\.push\(resource\);\s*continue;\s*\}/);
  assert.doesNotMatch(edgeFunction, /if \(resourceFailed\) break/);
  assert.match(edgeFunction, /finalStatus = recordsFailed === 0 \? 'SUCCEEDED' : pageResults\.length \? 'PARTIAL' : 'FAILED'/);
  assert.match(edgeFunction, /failed_resources: failedResources/);
  assert.match(edgeFunction, /failedResources,/);
});

test('Snapshot replay writes only inserted or payload-changed records', () => {
  assert.match(edgeFunction, /select\('external_key,payload_sha256'\)/);
  assert.match(edgeFunction, /existingHash === row\.payload_sha256\) unchanged\.push\(row\)/);
  assert.match(edgeFunction, /const semanticRows = \[\.\.\.classifiedRows\.inserted, \.\.\.classifiedRows\.changed\]/);
  assert.match(edgeFunction, /upsert\(semanticRows, \{ onConflict: 'resource,external_key' \}\)/);
  assert.doesNotMatch(edgeFunction, /upsert\(snapshotRows, \{ onConflict: 'resource,external_key' \}\)/);
  assert.match(edgeFunction, /stagedOnPage = insertedOnPage \+ changedOnPage/);
  assert.match(edgeFunction, /records_unchanged: recordsUnchanged/);
  assert.match(edgeFunction, /select\('external_key,latest_payload_sha256'\)/);
  assert.match(edgeFunction, /upsert\(identitiesNeedingWrite, \{ onConflict: 'resource,external_key' \}\)/);
  assert.match(edgeFunction, /identity_writes: identityWritesOnPage/);
  assert.match(edgeFunction, /externalKey: `product:\$\{guid\.toLowerCase\(\)\}:warehouse:\$\{warehouseIdentity\.toLowerCase\(\)\}`/);
});

test('Migration creates source-owned staging tables with RLS and browser write denial', () => {
  for (const relation of [
    'unleashed_sync_runs',
    'unleashed_sync_batches',
    'unleashed_raw_snapshots',
    'unleashed_external_identities',
    'unleashed_resource_cursors',
  ]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${relation}`));
    assert.match(migration, new RegExp(`alter table public\\.${relation} enable row level security`));
    assert.match(migration, new RegExp(`revoke all on table public\\.${relation} from public, anon, authenticated`));
    assert.match(migration, new RegExp(`grant select, insert, update, delete on table public\\.${relation} to service_role`));
  }

  assert.match(migration, /UNLEASHED_READONLY_BROWSER_MUTATION_PRIVILEGE_OPEN/);
  assert.match(migration, /has_table_privilege\(v_role, c\.oid, 'TRUNCATE'\)/);
  assert.match(migration, /has_any_column_privilege\(v_role, c\.oid, 'UPDATE'\)/);
  assert.match(migration, /unleashed_raw_snapshots_owner_admin_read/);
});

test('Raw snapshots keep stable source identity and do not define business authority', () => {
  assert.match(migration, /payload_sha256 text not null/);
  assert.match(migration, /payload_object_keys text\[\] not null/);
  assert.match(migration, /create unique index if not exists unleashed_raw_snapshots_resource_key_uidx/);
  assert.match(migration, /create unique index if not exists unleashed_external_identities_resource_key_uidx/);
  assert.match(migration, /unleashed_preserve_raw_snapshot_first_seen/);
  assert.match(workPackage, /No production inventory authority change/);
  assert.match(workPackage, /Sales BI KPI definition change/);
});

test('Stock acceptance exposes only a derived warehouse selector through the protected catalog', () => {
  assert.match(warehouseCatalogMigration, /with \(security_invoker = true\)/);
  assert.match(warehouseCatalogMigration, /resource = 'stock_on_hand'/);
  assert.match(warehouseCatalogMigration, /payload ->> 'WarehouseCode'/);
  assert.match(warehouseCatalogMigration, /as warehouse_code/);
  assert.match(warehouseCatalogMigration, /revoke all on table public\.v_ecoflow_unleashed_snapshot_catalog from anon/);
  assert.doesNotMatch(warehouseCatalogMigration, /payload\s+as\s+/i);
});

test('CI runs the SQL DB contract for Unleashed staging privileges', () => {
  assert.match(workflow, /image: postgres:17/);
  assert.match(workflow, /psql -v ON_ERROR_STOP=1 -f scripts\/unleashed-readonly-connector-db-fixture\.sql/);
  assert.match(workflow, /psql -v ON_ERROR_STOP=1 -f supabase\/migrations\/20260830090000_unleashed_readonly_connector_foundation\.sql/);
  assert.match(workflow, /psql -v ON_ERROR_STOP=1 -f supabase\/migrations\/20260830123000_unleashed_snapshot_catalog_warehouse_code\.sql/);
  assert.match(workflow, /psql -v ON_ERROR_STOP=1 -f scripts\/unleashed-readonly-connector-db-contract-test\.sql/);
});

test('Admin probe UI can only request the one-page dry-run contract', () => {
  assert.match(probeClient, /functions\.invoke\('trigger-unleashed-readonly-sync'/);
  assert.match(probeClient, /mode: 'probe'/);
  assert.match(probeClient, /resources: \['warehouses'\]/);
  assert.match(probeClient, /dryRun: true/);
  assert.match(probeClient, /pageSize: 1/);
  assert.match(probeClient, /maxPages: 1/);
  assert.match(probeClient, /result\.recordsStaged === 0/);
  assert.doesNotMatch(probeClient, /dryRun: false/);
  assert.doesNotMatch(probeClient, /bounded_snapshot/);
});

test('Production acceptance requires a bounded four-resource write and proves unchanged replay', () => {
  for (const resource of ['products', 'stock_on_hand', 'sales_orders_open', 'purchase_orders_open']) {
    assert.match(acceptanceClient, new RegExp(`'${resource}'`));
  }
  assert.match(acceptanceClient, /mode: 'bounded_snapshot'/);
  assert.equal(acceptanceClient.match(/dryRun: false/g)?.length, 3);
  assert.match(acceptanceClient, /pageSize: 1/);
  assert.match(acceptanceClient, /maxPages: 1/);
  assert.match(acceptanceClient, /UNLEASHED_ACCEPTANCE_RESOURCES\.length/);
  assert.match(acceptanceClient, /replay\.recordsStaged !== 0/);
  assert.match(acceptanceClient, /replay\.recordsChanged !== 0/);
  assert.match(acceptanceClient, /replay\.recordsUnchanged !== 1/);
  assert.match(acceptanceClient, /allowPartial = false/);
  assert.match(acceptanceClient, /UNLEASHED_ACCEPTANCE_RESOURCES\.length, true/);
  assert.match(acceptanceClient, /seedStatus: seed\.status/);
  assert.match(acceptanceClient, /seed\.failedResources\.includes\(resource\)/);
  assert.match(acceptanceClient, /select\('resource,external_guid,external_code,external_number,warehouse_code,last_seen_at'\)/);
  assert.match(acceptanceClient, /\? \{ productId: row\.external_guid, warehouseCode: row\.warehouse_code \}/);
  assert.match(acceptanceClient, /: \{ productId: row\.external_guid \}/);
  assert.doesNotMatch(acceptanceClient, /select\([^)]*payload(?!_sha256)/i);
  assert.doesNotMatch(acceptanceClient, /API_KEY|API_ID|token|secret/i);

  assert.match(probePanel, /type="checkbox"/);
  assert.match(probePanel, /I confirm this bounded source-snapshot write/);
  assert.match(probePanel, /disabled=\{!acceptanceAcknowledged \|\| acceptanceRunning \|\| running\}/);
  assert.match(probePanel, /setAcceptanceAcknowledged\(false\)/);
  assert.match(probePanel, /Store sample and verify replay/);
});

test('A failed seed resource cannot be verified from an older catalog target', async () => {
  const catalogRows = {
    products: { external_guid: 'product-guid', warehouse_code: null },
    stock_on_hand: { external_guid: 'stock-product-guid', warehouse_code: null },
    sales_orders_open: { external_guid: 'sales-order-guid', external_number: 'SO-100', warehouse_code: null },
    purchase_orders_open: { external_guid: 'purchase-order-guid', external_number: 'PO-100', warehouse_code: null },
  };
  const targetedRequests = [];
  const successfulResult = (resources) => ({
    ok: true,
    runId: `run-${resources[0]}`,
    requestedAt: '2026-08-31T00:00:00.000Z',
    status: 'SUCCEEDED',
    dryRun: false,
    resources,
    pageSize: 1,
    maxPages: 1,
    recordsSeen: 1,
    recordsStaged: 0,
    recordsInserted: 0,
    recordsChanged: 0,
    recordsUnchanged: 1,
    recordsFailed: 0,
    failedResources: [],
    pages: [],
    errorCode: null,
    errorMessage: null,
  });
  const fakeSupabase = {
    functions: {
      invoke: async (_name, { body }) => {
        if (body.resources.length === 4) {
          return {
            error: null,
            data: {
              ...successfulResult(body.resources),
              runId: 'seed-run',
              status: 'PARTIAL',
              recordsSeen: 3,
              recordsUnchanged: 3,
              recordsFailed: 1,
              failedResources: ['products'],
              errorCode: 'UNLEASHED_API_REQUEST_FAILED',
              errorMessage: 'products page 1 returned HTTP 403',
            },
          };
        }
        targetedRequests.push({ resource: body.resources[0], target: body.target });
        return { error: null, data: successfulResult(body.resources) };
      },
    },
    from: (table) => {
      assert.equal(table, 'v_ecoflow_unleashed_snapshot_catalog');
      let selectedResource = null;
      const query = {
        select: () => query,
        eq: (_column, value) => {
          selectedResource = value;
          return query;
        },
        order: () => query,
        limit: async () => ({
          error: null,
          data: [{
            resource: selectedResource,
            external_guid: catalogRows[selectedResource].external_guid,
            external_code: null,
            external_number: catalogRows[selectedResource].external_number ?? null,
            warehouse_code: catalogRows[selectedResource].warehouse_code,
            last_seen_at: '2026-08-30T00:00:00.000Z',
          }],
        }),
      };
      return query;
    },
  };

  const result = await runUnleashedConnectorAcceptance(fakeSupabase);

  assert.equal(result.seedStatus, 'PARTIAL');
  assert.equal(result.complete, false);
  assert.equal(result.verifiedCount, 3);
  assert.equal(result.checks.find((check) => check.resource === 'products')?.status, 'FAILED');
  assert.equal(targetedRequests.some((request) => request.resource === 'products'), false);
  assert.deepEqual(
    targetedRequests.find((request) => request.resource === 'stock_on_hand')?.target,
    { productId: 'stock-product-guid' },
  );
  assert.deepEqual(
    targetedRequests.find((request) => request.resource === 'sales_orders_open')?.target,
    { orderNumber: 'SO-100' },
  );
  assert.deepEqual(
    targetedRequests.find((request) => request.resource === 'purchase_orders_open')?.target,
    { orderNumber: 'PO-100' },
  );
});

test('Unleashed probe is restricted to the existing Owner/Admin settings boundary', () => {
  assert.match(app, /canManageTeam\(authProfile\) && supabase[\s\S]*<UnleashedReadonlyProbePanel supabase=\{supabase\}/);
  assert.match(operationalSettings, /profile\.app_role === 'OWNER' \|\| profile\.app_role === 'ADMIN'/);
  assert.match(operationalSettings, /canTestUnleashed && supabase \? <UnleashedReadonlyProbePanel supabase=\{supabase\}/);
  assert.match(probePanel, /Run one-page test/);
  assert.match(probePanel, /Records imported/);
  assert.doesNotMatch(probePanel, /API_KEY|API_ID|token|secret/i);
});


test('windowed continuation is chained and cannot promote an incomplete cursor', () => {
  assert.match(edgeFunction, /const HARD_MAX_PAGES = 5/);
  assert.match(edgeFunction, /startPage\?: number/);
  assert.match(edgeFunction, /previousRunId\?: string \| null/);
  assert.match(edgeFunction, /CONTINUATION_REQUIRES_ONE_RESOURCE/);
  assert.match(edgeFunction, /CONTINUATION_WITH_MODIFIED_SINCE_UNSUPPORTED/);
  assert.match(edgeFunction, /CONTINUATION_PREVIOUS_RUN_REQUIRED/);
  assert.match(edgeFunction, /CONTINUATION_PREVIOUS_RUN_MISMATCH/);
  assert.match(edgeFunction, /previousNextPage !== startPage/);
  assert.match(edgeFunction, /UNLEASHED_PAGINATION_TOTAL_DRIFT/);
  assert.match(edgeFunction, /const windowEndPage = resourceStartPage \+ maxPages - 1/);
  assert.match(edgeFunction, /cursor_status: 'RUNNING'/);
  assert.match(edgeFunction, /else if \(windowEvidence\.windowComplete\)[\s\S]*cursor_status: 'READY'/);
  assert.match(edgeFunction, /all_resources_complete: allResourcesComplete/);
  assert.match(edgeFunction, /pagination_windows: resourceWindows\.map/);
  assert.match(edgeFunction, /next_modified_since: resourceHighWatermark/);
});
