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

const recoverBlock = workflow.match(/\n  recover:\n[\s\S]*$/)?.[0] ?? '';
const reconcileBlock =
  hygieneWorkflow.match(/\n  reconcile-existing-incidents:\n[\s\S]*$/)?.[0] ?? '';

test('recovery is driven by a successful deployment workflow run', () => {
  assert.match(recoverBlock, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(
    recoverBlock,
    /RECOVERED_RUN_NUMBER: \$\{\{ github\.event\.workflow_run\.run_number \}\}/,
  );
  assert.match(
    recoverBlock,
    /RECOVERED_RUN_URL: \$\{\{ github\.event\.workflow_run\.html_url \}\}/,
  );
});

test('recovery only considers canonical machine-generated migration incidents', () => {
  assert.match(recoverBlock, /--state open/);
  assert.match(recoverBlock, /--limit 1000/);
  assert.match(
    recoverBlock,
    /startsWith|startswith\(\\?"Supabase migration failure · run /i,
  );
  assert.match(
    recoverBlock,
    /\^Supabase\\ migration\\ failure\\ ·\\ run\\ \(\[0-9\]\+\)\$/,
  );
});

test('a successful later run closes older failures but preserves any newer failure', () => {
  assert.match(recoverBlock, /failed_run_number > RECOVERED_RUN_NUMBER/);
  assert.match(recoverBlock, /Preserving newer failure run/);
  assert.match(
    recoverBlock,
    /Historical failure evidence for run \$failed_run_number is retained/,
  );
  assert.match(recoverBlock, /gh issue close "\$issue_number"/);
  assert.match(recoverBlock, /--reason completed/);
});

test('recovery does not depend on matching the repaired commit SHA', () => {
  assert.doesNotMatch(recoverBlock, /RECOVERED_SHA in:body/);
  assert.doesNotMatch(recoverBlock, /--search "\$RECOVERED_SHA/);
});

test('failure collection still archives exact evidence and publishes a diagnostic issue', () => {
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'failure'/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /gh issue create/);
  assert.match(workflow, /Supabase migration failure · run \$FAILED_RUN_NUMBER/);
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

test('backfill anchors cleanup to the latest successful production migration run', () => {
  assert.match(reconcileBlock, /gh run list/);
  assert.match(reconcileBlock, /--workflow deploy-supabase-migrations\.yml/);
  assert.match(reconcileBlock, /--status success/);
  assert.match(reconcileBlock, /--limit 1/);
  assert.match(reconcileBlock, /--json number,url/);
  assert.match(reconcileBlock, /recovered_run_number/);
  assert.match(reconcileBlock, /recovered_run_url/);
});

test('backfill only closes canonical incidents superseded by that successful run', () => {
  assert.match(reconcileBlock, /--state open/);
  assert.match(reconcileBlock, /--limit 1000/);
  assert.match(
    reconcileBlock,
    /\^Supabase\\ migration\\ failure\\ ·\\ run\\ \(\[0-9\]\+\)\$/,
  );
  assert.match(reconcileBlock, /failed_run_number > RECOVERED_RUN_NUMBER/);
  assert.match(reconcileBlock, /Preserving newer failure run/);
  assert.match(reconcileBlock, /gh issue comment "\$issue_number"/);
  assert.match(reconcileBlock, /gh issue close "\$issue_number"/);
  assert.match(reconcileBlock, /--reason completed/);
});
