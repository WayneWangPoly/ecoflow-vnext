import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const workflow = readFileSync(
  new URL('../.github/workflows/deploy-vercel-production.yml', import.meta.url),
  'utf8',
);

const deployJob = workflow.match(/\n  deploy:\n[\s\S]*$/)?.[0] ?? '';

test('Vercel Git integration cannot auto-deploy protected main', () => {
  assert.equal(config?.git?.deploymentEnabled?.main, false);
  assert.deepEqual(config.rewrites, [
    { source: '/(.*)', destination: '/index.html' },
  ]);
});

test('production carrier is manual-only and exact-head authorized', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n  push:/);
  assert.doesNotMatch(workflow, /\n  pull_request:/);
  assert.match(workflow, /expected_main_sha:/);
  assert.match(workflow, /DEPLOY_VERCEL_PRODUCTION/);
  assert.match(workflow, /GITHUB_EVENT_NAME.*workflow_dispatch/s);
  assert.match(workflow, /GITHUB_REF.*refs\/heads\/main/s);
  assert.match(workflow, /EXPECTED_MAIN_SHA.*GITHUB_SHA/s);
  assert.match(workflow, /git fetch origin main --depth=1/);
  assert.match(workflow, /CURRENT_MAIN_SHA=.*origin\/main/s);
  assert.match(workflow, /CURRENT_MAIN_SHA.*GITHUB_SHA/s);
});

test('manual carrier reasserts automatic-main containment before deploy', () => {
  assert.match(
    workflow,
    /config\?\.git\?\.deploymentEnabled\?\.main !== false/,
  );
  assert.match(
    workflow,
    /vercel\.json must keep automatic main Git deployment disabled/,
  );
});

test('production deploy uses bounded production environment and pinned CLI', () => {
  assert.match(deployJob, /needs: authority/);
  assert.match(deployJob, /environment: production/);
  assert.match(workflow, /VERCEL_CLI_VERSION: 59\.17\.0/);
  assert.match(workflow, /VERCEL_ORG_ID: team_oklEX8t5l9UolK9KmDwSAXYl/);
  assert.match(workflow, /VERCEL_PROJECT_ID: prj_wlAGaHrUNXaSV3Vlx33FXxD02Ioj/);
  assert.match(deployJob, /VERCEL_TOKEN: \$\{\{ secrets\.VERCEL_TOKEN \}\}/);
  assert.match(deployJob, /Missing VERCEL_TOKEN production secret/);
});

test('production mutation occurs only below the exact-head authority job', () => {
  const authorityIndex = workflow.indexOf('\n  authority:');
  const deployIndex = workflow.indexOf('\n  deploy:');
  const productionDeployIndex = workflow.indexOf('vercel deploy \\');
  assert.ok(authorityIndex >= 0);
  assert.ok(deployIndex > authorityIndex);
  assert.ok(productionDeployIndex > deployIndex);
  assert.doesNotMatch(workflow.slice(0, deployIndex), /vercel deploy\s/);
});

test('explicit deployment is built, production-targeted and exact-SHA tagged', () => {
  assert.match(deployJob, /vercel pull --yes --environment=production/);
  assert.match(deployJob, /vercel build --prod/);
  assert.match(deployJob, /--prebuilt/);
  assert.match(deployJob, /--prod/);
  assert.match(deployJob, /githubCommitSha=\$GITHUB_SHA/);
  assert.match(deployJob, /githubCommitRef=main/);
  assert.match(deployJob, /ecoflowAuthority=workflow_dispatch/);
});

test('success is published only after READY and exact-SHA verification', () => {
  const inspectIndex = deployJob.indexOf('vercel inspect "$DEPLOYMENT_URL" --wait');
  const listIndex = deployJob.indexOf('--meta "githubCommitSha=$GITHUB_SHA"');
  const successIndex = deployJob.indexOf("-f state='success'");
  assert.ok(inspectIndex >= 0);
  assert.ok(listIndex > inspectIndex);
  assert.ok(successIndex > listIndex);
  assert.match(deployJob, /context='Vercel'/);
  assert.match(
    deployJob,
    /Authorized exact-head Vercel production deployment completed/,
  );
  assert.match(deployJob, /if: \$\{\{ failure\(\) \}\}/);
  assert.match(deployJob, /Authorized Vercel production deployment failed/);
});
