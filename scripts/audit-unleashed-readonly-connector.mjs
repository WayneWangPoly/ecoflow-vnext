#!/usr/bin/env node
import fs from 'node:fs';

const files = {
  migration: 'supabase/migrations/20260830090000_unleashed_readonly_connector_foundation.sql',
  warehouseCatalogMigration: 'supabase/migrations/20260830123000_unleashed_snapshot_catalog_warehouse_code.sql',
  edgeFunctionIndex: 'supabase/functions/trigger-unleashed-readonly-sync/index.ts',
  edgeFunctionCore: 'supabase/functions/trigger-unleashed-readonly-sync/core.ts',
  workflow: '.github/workflows/unleashed-readonly-connector-check.yml',
  retirementWorkflow: '.github/workflows/unleashed-readonly-production-retirement.yml',
  deploy: '.github/workflows/deploy-supabase-migrations.yml',
  workPackage: 'docs/engineering/work-packages/UNLEASHED-MIGRATION-002-bounded-readonly-connector.md',
};

const source = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, fs.readFileSync(file, 'utf8')]));
source.edgeFunction = `${source.edgeFunctionIndex}\n${source.edgeFunctionCore}`;
const failures = [];
const requireText = (area, needle, reason) => {
  if (!source[area].includes(needle)) failures.push(`${area}: ${reason} (${needle})`);
};
const forbid = (area, regex, reason) => {
  if (regex.test(source[area])) failures.push(`${area}: ${reason}`);
};

for (const relation of [
  'unleashed_sync_runs',
  'unleashed_sync_batches',
  'unleashed_raw_snapshots',
  'unleashed_external_identities',
  'unleashed_resource_cursors',
]) {
  requireText('migration', `create table if not exists public.${relation}`, `${relation} table must exist`);
  requireText('migration', `alter table public.${relation} enable row level security`, `${relation} must enable RLS`);
  requireText('migration', `revoke all on table public.${relation} from public, anon, authenticated`, `${relation} browser DML must be closed at privileges`);
}

requireText('migration', 'UNLEASHED_READONLY_BROWSER_MUTATION_PRIVILEGE_OPEN', 'migration must self-verify browser mutation denial');
requireText('migration', 'UNLEASHED_READONLY_ANON_SELECT_OPEN', 'migration must self-verify anon source read denial');
requireText('migration', 'unleashed_raw_snapshots_owner_admin_read', 'raw payload visibility must be Owner/Admin only');
requireText('migration', 'payload_sha256', 'raw snapshots must carry content hashes');
requireText('migration', 'unleashed_preserve_raw_snapshot_first_seen', 'snapshot upserts must preserve first-seen evidence');
requireText('migration', 'with (security_invoker = true)', 'read-model views must retain invoker security');
requireText('warehouseCatalogMigration', 'with (security_invoker = true)', 'warehouse selector view must retain invoker security');
requireText('warehouseCatalogMigration', "payload ->> 'WarehouseCode'", 'stock target reads need an exact warehouse code selector');
requireText('warehouseCatalogMigration', 'revoke all on table public.v_ecoflow_unleashed_snapshot_catalog from anon', 'derived warehouse selector must remain closed to anon');
forbid('warehouseCatalogMigration', /payload\s+as\s+/i, 'warehouse selector view must not return the raw payload');

requireText('edgeFunction', "Deno.env.get('UNLEASHED_API_ID')", 'API id must come from Edge Function secrets');
requireText('edgeFunction', "Deno.env.get('UNLEASHED_API_KEY')", 'API key must come from Edge Function secrets');
requireText('edgeFunction', "'api-auth-id': unleashedApiId", 'API id must be sent as an Unleashed auth header');
requireText('edgeFunction', "'api-auth-signature': signature", 'signature must be sent as an Unleashed auth header');
requireText('edgeFunction', "method: 'GET'", 'Unleashed API fetch must be GET-only');
requireText('edgeFunction', "const dryRun = body.dryRun !== false", 'connector must default to dry-run');
requireText('edgeFunction', 'const HARD_MAX_PAGES = 5', 'connector must enforce bounded pagination');
requireText('edgeFunction', 'const MAX_FETCH_ATTEMPTS = 3', 'transient GET retries must remain bounded');
requireText('edgeFunction', 'TARGET_REQUIRES_ONE_RESOURCE', 'targeted reads must be limited to one resource');
requireText('edgeFunction', 'TARGET_NOT_SUPPORTED_FOR_RESOURCE', 'targeted reads must reject resources outside the exact allowlist');
requireText('edgeFunction', 'UNLEASHED_TARGET_AMBIGUOUS', 'targeted reads must reject ambiguous results');
requireText('edgeFunction', 'const semanticRows = [...classifiedRows.inserted, ...classifiedRows.changed]', 'unchanged payloads must not be upserted');
requireText('edgeFunction', 'records_unchanged: recordsUnchanged', 'unchanged replay evidence must be durable');
requireText('edgeFunction', 'failedResources.push(resource)', 'failed resources must remain explicit in the run result');
requireText('edgeFunction', "finalStatus = recordsFailed === 0 ? 'SUCCEEDED' : pageResults.length ? 'PARTIAL' : 'FAILED'", 'final status must reflect all attempted resources');
forbid('edgeFunction', /if \(resourceFailed\) break/, 'one failed resource must not hide later resource evidence');
requireText('edgeFunction', 'identityRowsNeedingWrite', 'identity linkage must be independently repairable after a partial staging failure');
requireText('edgeFunction', 'sourceIdentityForItem', 'stock snapshots must include warehouse identity in their source key');
requireText('edgeFunction', 'SALES_INTELLIGENCE_RESOURCES', 'paid Sales BI seed resources must be explicit');
requireText('edgeFunction', ".from('app_user_profiles')", 'role check must be server-side');
requireText('edgeFunction', ".from('app_security_audit_events')", 'connector runs must audit completion/failure');
requireText('edgeFunction', "normalizeBaseUrl(Deno.env.get('UNLEASHED_API_BASE_URL')", 'API base URL must be validated and configurable');

forbid('edgeFunction', /console\.(log|warn|error|info)\(/, 'function must not log payloads or credentials');
forbid('edgeFunction', /method:\s*['"`](PUT|PATCH|DELETE)['"`]/, 'function must not contain Unleashed write methods');
forbid('edgeFunction', /fetch\([^)]*api-auth-id|fetch\([^)]*api-auth-signature|fetch\([^)]*UNLEASHED_API_KEY/is, 'credentials must not be placed in request URLs');
forbid('edgeFunction', /return json\([^)]*\bitems\b/is, 'function responses must not return raw Unleashed items');
forbid('edgeFunction', /\/(?:Complete|Obsolete|Delete)\b/, 'function must not call destructive Unleashed action endpoints');
forbid('edgeFunction', /Authorization:\s*`Bearer \$\{unleashedApiKey\}`/, 'Unleashed key must not be treated as a bearer token');
forbid('edgeFunction', /error_message:\s*responseText\.slice/is, 'upstream Unleashed error bodies must not be stored in broadly readable batch metadata');

requireText('workflow', 'node --experimental-strip-types --test scripts/unleashed-readonly-connector-contract.test.mjs scripts/unleashed-readonly-connector-core.test.mjs', 'CI must run static and executable connector contract tests');
requireText('workflow', 'node scripts/audit-unleashed-readonly-connector.mjs', 'CI must run connector static audit');
requireText('workflow', 'psql -v ON_ERROR_STOP=1 -f scripts/unleashed-readonly-connector-db-fixture.sql', 'CI must prepare the SQL DB contract fixture');
requireText('workflow', 'psql -v ON_ERROR_STOP=1 -f scripts/unleashed-readonly-connector-db-contract-test.sql', 'CI must run the SQL DB contract test');
requireText('retirementWorkflow', 'workflow_dispatch:', 'legacy probe retirement must be manual only');
requireText('retirementWorkflow', "test \"$GITHUB_REF\" = 'refs/heads/main'", 'legacy probe retirement must be pinned to main');
requireText('retirementWorkflow', 'RETIRE INERT UNLEASHED PROBES', 'legacy probe retirement must require exact operator confirmation');
requireText('retirementWorkflow', 'node scripts/unleashed-readonly-retirement-state.mjs', 'legacy probe retirement must validate deployed identity and drift');
requireText('retirementWorkflow', 'supabase functions delete "$function_name"', 'legacy probe retirement must delete only validated exact targets');
requireText('retirementWorkflow', 'supabase functions list', 'legacy probe retirement must capture before and after function state');
forbid('retirementWorkflow', /^\s{2}(?:push|pull_request|schedule):/m, 'legacy probe retirement must not have an automatic trigger');
forbid('retirementWorkflow', /supabase secrets (?:set|unset)/, 'legacy probe retirement must not mutate connector credentials');
requireText('deploy', 'supabase functions deploy trigger-unleashed-readonly-sync', 'production Supabase deploy must include the new function');
requireText('workPackage', 'No Unleashed write', 'work package must keep Unleashed write operations out of scope');
requireText('workPackage', 'UNLEASHED_API_ID', 'work package must document secret provisioning');

if (failures.length) {
  console.error('UNLEASHED-MIGRATION-002 connector audit: FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('UNLEASHED-MIGRATION-002 connector audit: PASS');
console.log('Connector is bounded, GET-only, dry-run by default, server-secret backed, and browser-write closed.');
