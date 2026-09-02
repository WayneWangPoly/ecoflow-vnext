import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const requestPath = '.github/workflows/transform-007-shadow-request.yml';
const trustedPath = '.github/workflows/transform-007-shadow-trusted.yml';
const runnerPath = 'scripts/transform-007-shadow-runner.sh';
const ownershipPath = 'docs/engineering/FILE-OWNERSHIP.md';
const packagePath = 'docs/engineering/work-packages/TRANSFORM-007-shadow-bootstrap.md';

const request = readFileSync(requestPath, 'utf8');
const trusted = readFileSync(trustedPath, 'utf8');
const runner = readFileSync(runnerPath, 'utf8');

function workflowStepRun(job) {
  const result = spawnSync('python', ['-c', [
    'import sys, yaml',
    'with open(sys.argv[1], encoding="utf-8") as stream:',
    '  workflow = yaml.load(stream, Loader=yaml.BaseLoader)',
    'print(workflow["jobs"][sys.argv[2]]["steps"][0]["run"], end="")',
  ].join('\n'), trustedPath, job], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

const resolver = workflowStepRun('resolve');
const finalizer = workflowStepRun('finalize');
const headA = 'a'.repeat(40);
const baseA = 'b'.repeat(40);
const mergeA = 'c'.repeat(40);
const mergeB = 'd'.repeat(40);
const blobA = 'e'.repeat(40);
const targetPath = 'supabase/migrations/20260812010000_transform_007b_account_hold_command.sql';
const warehouseTargetPath = 'supabase/migrations/20260816061000_warehouse_survey_001_sku_context.sql';

function pullRequest({
  changedFiles = 1,
  headSha = headA,
  baseSha = baseA,
  mergeSha = mergeA,
  mergeable = true,
  headRepo = 'WayneWangPoly/ecoflow-vnext',
  baseRef = 'main',
  state = 'open',
} = {}) {
  return {
    head: { sha: headSha, repo: { full_name: headRepo } },
    merge_commit_sha: mergeSha,
    mergeable,
    changed_files: changedFiles,
    base: { ref: baseRef, sha: baseSha },
    state,
  };
}

function runResolver(files, { changedFiles = files.length, rereadPr = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'transform-007-resolver-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(root, 'pr.json'), JSON.stringify(pullRequest({ changedFiles })));
  if (rereadPr) writeFileSync(join(root, 'pr-reread.json'), JSON.stringify(rereadPr));
  writeFileSync(join(root, 'files.json'), JSON.stringify(files));
  writeFileSync(join(root, 'event.json'), JSON.stringify({ workflow_run: { pull_requests: [{ number: 42 }] } }));
  const gh = join(bin, 'gh');
  writeFileSync(gh, [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'if [[ " $* " == *" --paginate "* ]]; then cat "$FAKE_ROOT/files.json"; exit 0; fi',
    'if [[ "$*" == *"/pulls/42"* ]]; then',
    '  count_file="$FAKE_ROOT/pr-call-count"',
    '  count=0',
    '  [[ -f "$count_file" ]] && count="$(cat "$count_file")"',
    '  count=$((count + 1))',
    '  printf "%s" "$count" > "$count_file"',
    '  if (( count >= 2 )) && [[ -f "$FAKE_ROOT/pr-reread.json" ]]; then cat "$FAKE_ROOT/pr-reread.json"; else cat "$FAKE_ROOT/pr.json"; fi',
    '  exit 0',
    'fi',
    'exit 2',
    '',
  ].join('\n'));
  chmodSync(gh, 0o755);
  const outputPath = join(root, 'output');
  const result = spawnSync('bash', ['-c', resolver], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      FAKE_ROOT: root,
      GITHUB_EVENT_PATH: join(root, 'event.json'),
      GITHUB_OUTPUT: outputPath,
      GITHUB_REPOSITORY: 'WayneWangPoly/ecoflow-vnext',
      REQUEST_CONCLUSION: 'success',
      REQUEST_EVENT: 'pull_request',
    },
  });
  const output = existsSync(outputPath)
    ? Object.fromEntries(readFileSync(outputPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => line.split('=', 2)))
    : {};
  rmSync(root, { recursive: true, force: true });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return output;
}

function runFinalizer(currentPr, envOverrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'transform-007-finalizer-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(root, 'pr.json'), JSON.stringify(currentPr));
  const gh = join(bin, 'gh');
  writeFileSync(gh, [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'if [[ "$*" == *"/pulls/42"* ]] && [[ " $* " != *" --method POST "* ]]; then cat "$FAKE_ROOT/pr.json"; exit 0; fi',
    'if [[ " $* " == *" --method POST "* ]] && [[ "$*" == *"/statuses/"* ]]; then printf "%s\\n" "$*" >> "$FAKE_ROOT/statuses.log"; exit 0; fi',
    'exit 2',
    '',
  ].join('\n'));
  chmodSync(gh, 0o755);
  const result = spawnSync('bash', ['-c', finalizer], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      FAKE_ROOT: root,
      GITHUB_REPOSITORY: 'WayneWangPoly/ecoflow-vnext',
      PR_NUMBER: '42',
      HEAD_SHA: headA,
      BASE_SHA: baseA,
      MERGE_SHA: mergeA,
      VERDICT: 'not_applicable',
      REASON: 'SUPABASE_MIGRATION_NOT_CHANGED',
      PREPARE_RESULT: 'skipped',
      SHADOW_RESULT: 'skipped',
      STATUS_CONTEXT: 'Supabase shadow gate (required)',
      STATUS_URL: 'https://example.invalid/run/1',
      ...envOverrides,
    },
  });
  const statuses = existsSync(join(root, 'statuses.log')) ? readFileSync(join(root, 'statuses.log'), 'utf8') : '';
  rmSync(root, { recursive: true, force: true });
  return { result, statuses };
}

function migration(path = targetPath, status = 'added', sha = blobA) {
  return { filename: path, status, sha };
}

test('bootstrap scope contains every declared trust-boundary file', () => {
  for (const path of [requestPath, trustedPath, runnerPath, ownershipPath, packagePath]) {
    assert.ok(existsSync(path), `${path} is required`);
  }
});

test('pull-request request stays unprivileged', () => {
  assert.match(request, /^name: TRANSFORM-007 shadow request$/m);
  assert.match(request, /^permissions:\n  contents: read$/m);
  assert.doesNotMatch(request, /secrets\.|environment:|psql|pg_dump/i);
  assert.match(request, /persist-credentials: false/);
  assert.match(request, /node --test scripts\/transform-007-shadow-bootstrap\.test\.mjs/);
});

test('credentialed workflow remains default-branch workflow_run only', () => {
  assert.match(trusted, /^on:\n  workflow_run:\n    workflows: \['TRANSFORM-007 shadow request'\]\n    types: \[completed\]/m);
  assert.match(trusted, /^permissions: \{\}$/m);
  assert.doesNotMatch(trusted, /^\s{2}(?:pull_request|pull_request_target|push|workflow_dispatch|schedule):/m);
  assert.equal(trusted.match(/secrets\.TRANSFORM_007_SHADOW_READ_DB_URL/g)?.length, 1);
  assert.doesNotMatch(trusted.match(/\n  shadow:[\s\S]*?\n  finalize:/)?.[0] ?? '', /secrets\.|environment:|statuses: write/);
});

test('resolver accepts one newly added sequenced migration', () => {
  const output = runResolver([migration()]);
  assert.equal(output.verdict, 'run');
  assert.equal(output.reason, 'TARGET_MIGRATION_REQUIRES_SHADOW');
  assert.equal(output.target_path, targetPath);
  assert.equal(output.target_version, '20260812010000');
  assert.equal(output.candidate_blob_sha, blobA);
  assert.equal(output.base_sha, baseA);
});

test('resolver accepts WAREHOUSE-SURVEY-001 migration instead of reporting false not-applicable', () => {
  const output = runResolver([migration(warehouseTargetPath)]);
  assert.equal(output.verdict, 'run');
  assert.equal(output.reason, 'TARGET_MIGRATION_REQUIRES_SHADOW');
  assert.equal(output.target_path, warehouseTargetPath);
  assert.equal(output.target_version, '20260816061000');
  assert.equal(output.candidate_blob_sha, blobA);
});

test('resolver tolerates synthetic merge SHA churn when stable authority inputs are unchanged', () => {
  const output = runResolver([migration()], {
    rereadPr: pullRequest({ changedFiles: 1, mergeSha: mergeB }),
  });
  assert.equal(output.verdict, 'run');
  assert.equal(output.reason, 'TARGET_MIGRATION_REQUIRES_SHADOW');
  assert.equal(output.head_sha, headA);
  assert.equal(output.base_sha, baseA);
  assert.equal(output.merge_sha, mergeB);
});

test('resolver still fails closed when stable base identity changes during file enumeration', () => {
  const output = runResolver([migration()], {
    rereadPr: pullRequest({ changedFiles: 1, mergeSha: mergeB, baseSha: 'f'.repeat(40) }),
  });
  assert.equal(output.verdict, 'blocked');
  assert.equal(output.reason, 'REQUEST_PR_CHANGED');
});

test('resolver makes migration-free PRs not applicable', () => {
  const output = runResolver([{ filename: 'src/example.ts', status: 'modified', sha: blobA }]);
  assert.equal(output.verdict, 'not_applicable');
  assert.equal(output.reason, 'SUPABASE_MIGRATION_NOT_CHANGED');
});

test('resolver forbids editing a deployed migration', () => {
  const output = runResolver([migration(targetPath, 'modified')]);
  assert.equal(output.verdict, 'blocked');
  assert.equal(output.reason, 'DEPLOYED_MIGRATION_EDIT_FORBIDDEN');
});

test('resolver forbids additional migration files beside the candidate', () => {
  const output = runResolver([
    migration(),
    migration('supabase/migrations/20260812010100_other_change.sql'),
  ]);
  assert.equal(output.verdict, 'blocked');
  assert.equal(output.reason, 'ADDITIONAL_MIGRATION_FORBIDDEN');
});

test('resolver fails closed for a non-sequenced migration filename', () => {
  const output = runResolver([migration('supabase/migrations/warehouse_survey_change.sql')]);
  assert.equal(output.verdict, 'blocked');
  assert.equal(output.reason, 'TARGET_MIGRATION_FILENAME_INVALID');
});

test('resolver protects trusted workflow, runner, bootstrap and ownership files', () => {
  const output = runResolver([{ filename: runnerPath, status: 'modified', sha: blobA }]);
  assert.equal(output.verdict, 'blocked');
  assert.equal(output.reason, 'TRUST_BOUNDARY_CHANGED');
});

test('resolver fails closed on incomplete file enumeration', () => {
  const output = runResolver([migration()], { changedFiles: 2 });
  assert.equal(output.verdict, 'blocked');
  assert.equal(output.reason, 'REQUEST_FILES_INCOMPLETE');
});

test('trusted resolver binds same-repository current PR and exact candidate blob', () => {
  assert.match(trusted, /REQUEST_FORK_FORBIDDEN/);
  assert.match(trusted, /REQUEST_PR_CHANGED/);
  assert.match(trusted, /TRUST_BOUNDARY_CHANGED/);
  assert.match(trusted, /ADDITIONAL_MIGRATION_FORBIDDEN/);
  assert.match(trusted, /TARGET_MIGRATION_FILENAME_INVALID/);
  assert.match(trusted, /DEPLOYED_MIGRATION_EDIT_FORBIDDEN/);
  assert.match(trusted, /candidate_blob_sha/);
  assert.match(trusted, /base_sha/);
  assert.match(trusted, /git hash-object .*candidate\.sql/);
  assert.match(trusted, /EXPECTED_TARGET_PATH/);
  assert.match(trusted, /EXPECTED_TARGET_VERSION/);
  assert.doesNotMatch(trusted, /20260811020000_transform_007_operational_records/);
});

test('trusted workflow never checks out pull-request code', () => {
  assert.equal(trusted.match(/uses: actions\/checkout@v4/g)?.length, 1);
  assert.match(trusted, /Checkout trusted main only[\s\S]*?ref: \$\{\{ github\.sha \}\}[\s\S]*?persist-credentials: false/);
  assert.doesNotMatch(trusted, /ref:\s*\$\{\{[^}]+(?:head_sha|pull_request|workflow_run\.head)/);
  assert.match(trusted, /application\/vnd\.github\.raw\+json/);
});

test('reader identity and direct-mutation denial remain pinned', () => {
  assert.match(runner, /aws-1-ap-southeast-2\.pooler\.supabase\.com/);
  assert.match(runner, /ecoflow_shadow_read\.kauqwlzuyxcudoyognwf/);
  assert.match(runner, /query == \[\('sslmode', 'require'\)\]/);
  assert.match(runner, /transaction_read_only/);
  assert.match(runner, /has_table_privilege\(current_user,c\.oid,'MAINTAIN'\)/);
  assert.match(runner, /ecoflow_shadow_read\|ecoflow_shadow_read\|0\|0\|0\|0\|0\|on\|0/);
  assert.match(runner, /pg_dump[\s\S]*?--schema=public --schema=analytics/);
  assert.match(runner, /--no-owner --no-acl --no-publications --no-subscriptions/);
});

test('runner binds generic sequenced target and production migration parity before reading schema', () => {
  assert.match(runner, /TRANSFORM_007_TARGET_PATH/);
  assert.match(runner, /TRANSFORM_007_TARGET_VERSION/);
  assert.ok(runner.includes('[0-9]{14}_[a-z0-9][a-z0-9_-]*\\.sql'));
  assert.match(runner, /TARGET_MIGRATION_ALREADY_IN_TRUSTED_MAIN/);
  assert.match(runner, /TARGET_MIGRATION_ALREADY_DEPLOYED/);
  assert.match(runner, /MAIN_MIGRATION_NOT_DEPLOYED/);
  assert.match(runner, /REMOTE_MIGRATION_MISSING_FROM_MAIN/);
  assert.doesNotMatch(runner, /readonly target_(?:path|version)=/);
});

test('candidate executes only in credential-free PostgreSQL under a non-superuser', () => {
  assert.match(trusted, /postgres:17/);
  assert.match(trusted, /permissions:\n      actions: read/);
  assert.match(runner, /create role transform_007_shadow login password 'shadow-candidate'[\s\S]*?nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls/);
  assert.match(runner, /Candidate SQL contains a psql meta-command escape and is forbidden/);
  assert.match(runner, /git hash-object \"\$input_dir\/candidate\.sql\"/);
  assert.match(runner, /--single-transaction -f \"\$input_dir\/candidate\.sql\"/);
  assert.match(runner, /alter schema public owner to transform_007_shadow/);
  assert.doesNotMatch(runner.match(/\nshadow\(\) \{[\s\S]*?\n\}\n\ncase /)?.[0] ?? '', /TRANSFORM_007_SHADOW_READ_DB_URL/);
});

test('shadow ownership handoff excludes table-owned serial and identity sequences', () => {
  const tableOwners = runner.indexOf("c.relkind in ('r','p','v','m','f')");
  const sequenceOwners = runner.indexOf("c.relkind='S'", tableOwners);
  assert.ok(tableOwners >= 0 && sequenceOwners > tableOwners, 'table-like relations must be re-owned before standalone sequences');
  assert.match(runner, /from pg_depend d[\s\S]*?d\.objid=c\.oid[\s\S]*?d\.deptype in \('a','i'\)/);
  assert.match(runner, /not exists \([\s\S]*?from pg_depend d/);
  assert.doesNotMatch(runner, /case r\.relkind when 'S' then 'SEQUENCE'/);
});

test('finalizer publishes fail-closed status to exact head and freshly revalidated test-merge', () => {
  assert.match(finalizer, /final_state=failure/);
  assert.match(finalizer, /\.base\.sha == \$base_sha/);
  assert.match(finalizer, /current_merge_sha/);
  assert.match(finalizer, /MERGE_SHA=\"\$current_merge_sha\"/);
  assert.match(finalizer, /publish_status \"\$MERGE_SHA\" pending/);
  assert.match(finalizer, /publish_status \"\$HEAD_SHA\" pending/);
  assert.match(finalizer, /for target_sha in \"\$HEAD_SHA\" \"\$MERGE_SHA\"/);
  assert.match(finalizer, /test \"\$final_state\" = success/);
  assert.match(trusted, /STATUS_CONTEXT: Supabase shadow gate \(required\)/);
  assert.match(trusted, /Supabase migration shadow is not applicable to this PR/);
});

test('finalizer accepts synthetic merge SHA churn and publishes to current merge SHA', () => {
  const { result, statuses } = runFinalizer(pullRequest({ mergeSha: mergeB }));
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(statuses, new RegExp(`/statuses/${headA}`));
  assert.match(statuses, new RegExp(`/statuses/${mergeB}`));
  assert.doesNotMatch(statuses, new RegExp(`/statuses/${mergeA}`));
});

test('finalizer fails closed if stable base identity changed', () => {
  const { result, statuses } = runFinalizer(pullRequest({ mergeSha: mergeB, baseSha: 'f'.repeat(40) }));
  assert.notEqual(result.status, 0);
  assert.equal(statuses, '');
});
