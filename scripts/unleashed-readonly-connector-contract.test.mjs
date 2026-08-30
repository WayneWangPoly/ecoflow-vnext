import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath = 'supabase/migrations/20260830090000_unleashed_readonly_connector_foundation.sql';
const functionPath = 'supabase/functions/trigger-unleashed-readonly-sync/index.ts';
const workPackagePath = 'docs/engineering/work-packages/UNLEASHED-MIGRATION-002-bounded-readonly-connector.md';
const workflowPath = '.github/workflows/unleashed-readonly-connector-check.yml';
const probeClientPath = 'src/features/team/unleashedReadonlyProbe.ts';
const probePanelPath = 'src/features/settings/UnleashedReadonlyProbePanel.tsx';
const appPath = 'src/app/App.tsx';
const operationalSettingsPath = 'src/features/operationalStability/OperationalStabilityWorkspaceV2.tsx';

const [migration, edgeFunction, workPackage, workflow, probeClient, probePanel, app, operationalSettings] = await Promise.all([
  readFile(migrationPath, 'utf8'),
  readFile(functionPath, 'utf8'),
  readFile(workPackagePath, 'utf8'),
  readFile(workflowPath, 'utf8'),
  readFile(probeClientPath, 'utf8'),
  readFile(probePanelPath, 'utf8'),
  readFile(appPath, 'utf8'),
  readFile(operationalSettingsPath, 'utf8'),
]);

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
  assert.match(edgeFunction, /metadata: \{ upstream_body_redacted: true \}/);
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
  assert.match(edgeFunction, /mode === 'probe' \? 1 : normalizeInteger\(body\.pageSize/);
  assert.match(edgeFunction, /mode === 'probe' \? 1 : normalizeInteger\(body\.maxPages/);
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

test('CI runs the SQL DB contract for Unleashed staging privileges', () => {
  assert.match(workflow, /image: postgres:17/);
  assert.match(workflow, /psql -v ON_ERROR_STOP=1 -f scripts\/unleashed-readonly-connector-db-fixture\.sql/);
  assert.match(workflow, /psql -v ON_ERROR_STOP=1 -f supabase\/migrations\/20260830090000_unleashed_readonly_connector_foundation\.sql/);
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

test('Unleashed probe is restricted to the existing Owner/Admin settings boundary', () => {
  assert.match(app, /canManageTeam\(authProfile\) && supabase[\s\S]*<UnleashedReadonlyProbePanel supabase=\{supabase\}/);
  assert.match(operationalSettings, /profile\.app_role === 'OWNER' \|\| profile\.app_role === 'ADMIN'/);
  assert.match(operationalSettings, /canTestUnleashed && supabase \? <UnleashedReadonlyProbePanel supabase=\{supabase\}/);
  assert.match(probePanel, /Run one-page test/);
  assert.match(probePanel, /Records imported/);
  assert.doesNotMatch(probePanel, /API_KEY|API_ID|token|secret/i);
});
