import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const deployPath = '.github/workflows/deploy-supabase-migrations.yml';
const releaseSyncPath = '.github/workflows/release-sync-authority.yml';

const deploy = readFileSync(deployPath, 'utf8');
const releaseSync = readFileSync(releaseSyncPath, 'utf8');
const aliasHelperPath = 'scripts/normalize-supabase-production-migration-aliases.mjs';
const aliasHelper = readFileSync(aliasHelperPath, 'utf8');
const resolverMigrationPath = 'supabase/migrations/20260918234500_warehouse_survey_002_commercial_sku_resolver_repair.sql';
const resolverMigration = readFileSync(resolverMigrationPath);

test('main pushes remain shadow-only while production deployment is manual exact-head authority', () => {
  assert.match(deploy, /workflow_dispatch:\s*\n\s+inputs:/, 'workflow_dispatch inputs are required');
  assert.match(deploy, /expected_main_sha:/, 'manual deployment requires an expected main SHA');
  assert.match(deploy, /confirmation:/, 'manual deployment requires an explicit confirmation input');
  assert.match(deploy, /DEPLOY_SUPABASE_PRODUCTION/, 'manual deployment requires the frozen confirmation token');
  assert.match(deploy, /push:\s*\n\s+branches: \[main\]/, 'main push shadow gate must remain active');

  assert.match(deploy, /\n  authority:\n/, 'a no-secret authority preflight must run before production access');
  assert.match(deploy, /git fetch origin main --depth=1/, 'manual authority must refresh protected main');
  assert.match(deploy, /CURRENT_MAIN_SHA="\$\(git rev-parse origin\/main\)"/, 'manual authority must resolve protected main');
  assert.match(deploy, /test "\$EXPECTED_MAIN_SHA" = "\$GITHUB_SHA"/, 'authorized SHA must equal workflow SHA');
  assert.match(deploy, /test "\$CURRENT_MAIN_SHA" = "\$GITHUB_SHA"/, 'workflow SHA must still be current protected main');

  const deployJobIndex = deploy.indexOf('\n  deploy:\n');
  assert.ok(deployJobIndex > 0, 'deploy job must exist');
  const deployJob = deploy.slice(deployJobIndex);
  assert.match(
    deployJob,
    /if: \$\{\{ github\.event_name == 'workflow_dispatch' \}\}/,
    'production deploy job must be unreachable from push events',
  );

  const beforeDeploy = deploy.slice(0, deployJobIndex);
  assert.doesNotMatch(beforeDeploy, /supabase db push[^\n]*--yes/, 'no production db push may exist before the guarded deploy job');
  assert.doesNotMatch(beforeDeploy, /supabase functions deploy/, 'no Edge Function deploy may exist before the guarded deploy job');
  assert.match(deployJob, /supabase db push[^\n]*--yes/, 'guarded deploy job must retain migration application');
  assert.match(deployJob, /supabase functions deploy/, 'guarded deploy job must retain Edge Function deployment');

  assert.match(
    deploy,
    /EVENT_NAME: \$\{\{ github\.event_name \}\}/,
    'final status must know whether the run is push or workflow_dispatch',
  );
  assert.match(
    deploy,
    /Production deployment deferred to explicit manual exact-head gate/,
    'push completion must state that production deployment remains deferred',
  );
});


test('known production migration identity drift is normalized only in the ephemeral deployment workspace', async () => {
  assert.match(deploy, /scripts\/normalize-supabase-production-migration-aliases\.mjs/);
  assert.equal(
    deploy.match(/name: Normalize known production migration identity aliases/g)?.length,
    2,
    'shadow and deploy jobs must use the same migration alias normalizer',
  );
  assert.match(aliasHelper, /20260918234500_warehouse_survey_002_commercial_sku_resolver_repair\.sql/);
  assert.match(aliasHelper, /20260918135648_warehouse_survey_002_commercial_sku_resolver_repair\.sql/);
  assert.match(aliasHelper, /3fd51aea0e83d96621426c73182e374b516b4923/);
  assert.match(aliasHelper, /SUPABASE_MIGRATION_ALIAS_BOTH_PRESENT/);
  assert.match(aliasHelper, /SUPABASE_MIGRATION_ALIAS_SOURCE_MISSING/);
  assert.match(aliasHelper, /SUPABASE_MIGRATION_ALIAS_CONTENT_MISMATCH/);
  assert.doesNotMatch(deploy, /supabase migration repair/);
  assert.doesNotMatch(deploy, /supabase db pull/);

  const { normalizeKnownMigrationAlias, KNOWN_MIGRATION_ALIAS } = await import('./normalize-supabase-production-migration-aliases.mjs');
  const root = mkdtempSync(join(tmpdir(), 'ecoflow-migration-alias-'));
  try {
    const source = join(root, KNOWN_MIGRATION_ALIAS.source);
    const target = join(root, KNOWN_MIGRATION_ALIAS.target);
    mkdirSync(join(root, 'supabase', 'migrations'), { recursive: true });
    writeFileSync(source, resolverMigration);

    const first = normalizeKnownMigrationAlias(root);
    assert.equal(first.status, 'NORMALIZED');
    assert.equal(existsSync(source), false);
    assert.equal(existsSync(target), true);
    assert.deepEqual(readFileSync(target), resolverMigration);

    const replay = normalizeKnownMigrationAlias(root);
    assert.equal(replay.status, 'ALREADY_NORMALIZED');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release-sync authority distinguishes shadow-only pushes from production deployment runs', () => {
  assert.match(
    releaseSync,
    /UPSTREAM_EVENT: \$\{\{ github\.event\.workflow_run\.event \}\}/,
    'trusted release-sync authority must consume the upstream trigger type',
  );
  assert.match(
    releaseSync,
    /if \[ "\$UPSTREAM_EVENT" = 'push' \]; then/,
    'push runs must have an explicit shadow-only branch',
  );
  assert.match(
    releaseSync,
    /Production database unchanged; deployment deferred to explicit manual exact-head gate/,
    'push runs must never claim that the production database was deployed',
  );
  assert.match(
    releaseSync,
    /elif \[ "\$UPSTREAM_EVENT" != 'workflow_dispatch' \]; then/,
    'unexpected upstream trigger types must fail closed',
  );
});
