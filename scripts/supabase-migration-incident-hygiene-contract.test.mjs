import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(
  '.github/workflows/collect-supabase-migration-failure.yml',
  'utf8',
);

const recoverBlock = workflow.match(/\n  recover:\n[\s\S]*$/)?.[0] ?? '';

test('recovery is driven by a successful deployment workflow run', () => {
  assert.match(recoverBlock, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(recoverBlock, /RECOVERED_RUN_NUMBER: \$\{\{ github\.event\.workflow_run\.run_number \}\}/);
  assert.match(recoverBlock, /RECOVERED_RUN_URL: \$\{\{ github\.event\.workflow_run\.html_url \}\}/);
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
  assert.match(recoverBlock, /Historical failure evidence for run \$failed_run_number is retained/);
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
