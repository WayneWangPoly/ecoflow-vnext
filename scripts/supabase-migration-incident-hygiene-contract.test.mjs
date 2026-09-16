import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(
  '.github/workflows/collect-supabase-migration-failure.yml',
  'utf8',
);
const hygieneWorkflow = await readFile(
  '.github/workflows/supabase-migration-incident-hygiene-check.yml',
  'utf8',
);

const collectBlock = workflow.match(/\n  collect:\n[\s\S]*?\n  recover:\n/)?.[0] ?? '';
const recoverBlock = workflow.match(/\n  recover:\n[\s\S]*$/)?.[0] ?? '';
const reconcileBlock =
  hygieneWorkflow.match(/\n  reconcile-existing-incidents:\n[\s\S]*$/)?.[0] ?? '';

test('failure evidence records upstream authority class', () => {
  assert.match(
    collectBlock,
    /FAILED_RUN_EVENT: \$\{\{ github\.event\.workflow_run\.event \}\}/,
  );
  assert.match(
    collectBlock,
    /Supabase migration failure · \$FAILED_RUN_EVENT · run \$FAILED_RUN_NUMBER/,
  );
  assert.match(collectBlock, /Authority class \/ trigger:/);
  assert.match(collectBlock, /push\|workflow_dispatch/);
});

test('failure status distinguishes shadow verification from production deployment', () => {
  assert.match(
    collectBlock,
    /Supabase shadow verification failed; exact error archived/,
  );
  assert.match(
    collectBlock,
    /Supabase production deployment workflow failed; exact error archived/,
  );
});

test('recovery is classified by the successful upstream workflow event', () => {
  assert.match(recoverBlock, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(
    recoverBlock,
    /RECOVERED_RUN_NUMBER: \$\{\{ github\.event\.workflow_run\.run_number \}\}/,
  );
  assert.match(
    recoverBlock,
    /RECOVERED_RUN_EVENT: \$\{\{ github\.event\.workflow_run\.event \}\}/,
  );
  assert.match(
    recoverBlock,
    /RECOVERED_RUN_URL: \$\{\{ github\.event\.workflow_run\.html_url \}\}/,
  );
});

test('recovery closes only same-authority canonical incidents', () => {
  assert.match(
    recoverBlock,
    /\^Supabase\\ migration\\ failure\\ ·\\ \(push\|workflow_dispatch\)\\ ·\\ run\\ \(\[0-9\]\+\)\$/,
  );
  assert.match(recoverBlock, /failed_run_event.*RECOVERED_RUN_EVENT/s);
  assert.match(recoverBlock, /Preserving .* failure during .* recovery/);
  assert.match(recoverBlock, /failed_run_number > RECOVERED_RUN_NUMBER/);
  assert.match(recoverBlock, /gh issue close "\$issue_number"/);
  assert.match(recoverBlock, /--reason completed/);
});

test('legacy unclassified incidents are fail-closed rather than auto-resolved', () => {
  assert.match(
    recoverBlock,
    /Preserving legacy or non-canonical unclassified diagnostic/,
  );
  assert.doesNotMatch(
    recoverBlock,
    /\^Supabase\\ migration\\ failure\\ ·\\ run\\ \(\[0-9\]\+\)\$/,
  );
});

test('push recovery explicitly does not imply production deployment', () => {
  assert.match(
    recoverBlock,
    /Resolved by later successful Supabase shadow-verification run/,
  );
  assert.match(recoverBlock, /Production deployment is not implied/);
  assert.match(
    recoverBlock,
    /Supabase shadow verification succeeded; production deployment deferred/,
  );
});

test('manual recovery may claim production deployment only for workflow_dispatch', () => {
  assert.match(
    recoverBlock,
    /explicitly dispatched Supabase production deployment run/,
  );
  assert.match(
    recoverBlock,
    /Supabase production deployment completed successfully/,
  );
  assert.match(recoverBlock, /workflow_dispatch/);
});

test('failure collection still archives exact evidence and publishes a diagnostic issue', () => {
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'failure'/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /gh issue create/);
  assert.match(workflow, /Supabase migration diagnostic/);
});

test('hygiene backfill runs only when the hygiene files reach main', () => {
  assert.match(hygieneWorkflow, /\n  push:\n\s+branches: \[main\]/);
  assert.match(
    hygieneWorkflow,
    /'\.github\/workflows\/collect-supabase-migration-failure\.yml'/,
  );
  assert.match(
    hygieneWorkflow,
    /'\.github\/workflows\/supabase-migration-incident-hygiene-check\.yml'/,
  );
  assert.match(
    hygieneWorkflow,
    /'scripts\/supabase-migration-incident-hygiene-contract\.test\.mjs'/,
  );
  assert.match(reconcileBlock, /if: github\.event_name == 'push'/);
});

test('backfill has least-privilege issue mutation permissions', () => {
  assert.match(reconcileBlock, /permissions:\n\s+actions: read/);
  assert.match(reconcileBlock, /contents: read/);
  assert.match(reconcileBlock, /issues: write/);
});

test('backfill anchors cleanup to a successful push shadow-verification run', () => {
  assert.match(reconcileBlock, /gh run list/);
  assert.match(reconcileBlock, /--workflow deploy-supabase-migrations\.yml/);
  assert.match(reconcileBlock, /--event push/);
  assert.match(reconcileBlock, /--status success/);
  assert.match(reconcileBlock, /--limit 1/);
  assert.match(reconcileBlock, /--json number,url/);
  assert.match(reconcileBlock, /recovered_run_number/);
  assert.match(reconcileBlock, /recovered_run_url/);
});

test('backfill never closes production-authority or legacy-unclassified incidents', () => {
  assert.match(
    reconcileBlock,
    /\^Supabase\\ migration\\ failure\\ ·\\ \(push\|workflow_dispatch\)\\ ·\\ run\\ \(\[0-9\]\+\)\$/,
  );
  assert.match(
    reconcileBlock,
    /Preserving production-authority incident during shadow hygiene/,
  );
  assert.match(
    reconcileBlock,
    /Preserving legacy or non-canonical unclassified diagnostic/,
  );
  assert.match(reconcileBlock, /failed_run_number > RECOVERED_RUN_NUMBER/);
  assert.match(reconcileBlock, /Production deployment is not implied/);
});

test('stale deployment-success wording is absent from push recovery paths', () => {
  assert.doesNotMatch(
    workflow,
    /Supabase deployment completed successfully; prior diagnostics cleared/,
  );
  assert.doesNotMatch(
    hygieneWorkflow,
    /Resolved by later successful Supabase deployment workflow run/,
  );
});
