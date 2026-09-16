import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const deployPath = '.github/workflows/deploy-supabase-migrations.yml';
const releaseSyncPath = '.github/workflows/release-sync-authority.yml';

const deploy = readFileSync(deployPath, 'utf8');
const releaseSync = readFileSync(releaseSyncPath, 'utf8');

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
