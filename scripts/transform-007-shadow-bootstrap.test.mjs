import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const requestPath = '.github/workflows/transform-007-shadow-request.yml';
const trustedPath = '.github/workflows/transform-007-shadow-trusted.yml';
const runnerPath = 'scripts/transform-007-shadow-runner.sh';
const ownershipPath = 'docs/engineering/FILE-OWNERSHIP.md';
const packagePath =
  'docs/engineering/work-packages/TRANSFORM-007-shadow-bootstrap.md';

const request = readFileSync(requestPath, 'utf8');
const trusted = readFileSync(trustedPath, 'utf8');
const runner = readFileSync(runnerPath, 'utf8');

function workflowStepRun(job) {
  const result = spawnSync(
    'python',
    [
      '-c',
      [
        'import sys, yaml',
        'with open(sys.argv[1], encoding="utf-8") as stream:',
        '  workflow = yaml.load(stream, Loader=yaml.BaseLoader)',
        'print(workflow["jobs"][sys.argv[2]]["steps"][0]["run"], end="")',
      ].join('\n'),
      trustedPath,
      job,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

const resolver = workflowStepRun('resolve');
const finalizer = workflowStepRun('finalize');

const headA = 'a'.repeat(40);
const headB = 'b'.repeat(40);
const mergeA = 'c'.repeat(40);
const mergeB = 'd'.repeat(40);

function pullRequest({ head = headA, merge = mergeA, changedFiles = 1 } = {}) {
  return {
    head: {
      sha: head,
      repo: { full_name: 'WayneWangPoly/ecoflow-vnext' },
    },
    merge_commit_sha: merge,
    mergeable: true,
    changed_files: changedFiles,
    base: { ref: 'main' },
    state: 'open',
  };
}

function runResolver({ initial, current = initial, files }) {
  const root = mkdtempSync(join(tmpdir(), 'transform-007-resolver-'));
  const bin = join(root, 'bin');
  const state = join(root, 'state');
  mkdirSync(bin);
  mkdirSync(state);
  const ghPath = join(bin, 'gh');
  writeFileSync(
    ghPath,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'if [[ " $* " == *" --paginate "* ]]; then',
      '  cat "$FAKE_GH_ROOT/files.json"',
      '  exit 0',
      'fi',
      'if [[ "$*" == *"/pulls/42"* ]]; then',
      '  count=0',
      '  [[ ! -f "$FAKE_GH_ROOT/count" ]] || read -r count < "$FAKE_GH_ROOT/count"',
      '  count=$((count + 1))',
      '  echo "$count" > "$FAKE_GH_ROOT/count"',
      '  if (( count == 1 )); then',
      '    cat "$FAKE_GH_ROOT/pr-initial.json"',
      '  else',
      '    cat "$FAKE_GH_ROOT/pr-current.json"',
      '  fi',
      '  exit 0',
      'fi',
      'exit 2',
      '',
    ].join('\n'),
  );
  chmodSync(ghPath, 0o755);
  writeFileSync(join(state, 'pr-initial.json'), JSON.stringify(initial));
  writeFileSync(join(state, 'pr-current.json'), JSON.stringify(current));
  writeFileSync(join(state, 'files.json'), JSON.stringify(files));
  writeFileSync(
    join(root, 'event.json'),
    JSON.stringify({ workflow_run: { pull_requests: [{ number: 42 }] } }),
  );

  const outputPath = join(root, 'output');
  const result = spawnSync('bash', ['-c', resolver], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      FAKE_GH_ROOT: state,
      GITHUB_EVENT_PATH: join(root, 'event.json'),
      GITHUB_OUTPUT: outputPath,
      GITHUB_REPOSITORY: 'WayneWangPoly/ecoflow-vnext',
      REQUEST_CONCLUSION: 'success',
      REQUEST_EVENT: 'pull_request',
      TARGET_MIGRATION_PATH:
        'supabase/migrations/20260811020000_transform_007_operational_records.sql',
    },
  });
  const output = existsSync(outputPath)
    ? Object.fromEntries(
        readFileSync(outputPath, 'utf8')
          .trim()
          .split('\n')
          .map((line) => line.split('=', 2)),
      )
    : {};
  rmSync(root, { recursive: true, force: true });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return output;
}

function interruptPublication({ failTarget, failState }) {
  const root = mkdtempSync(join(tmpdir(), 'transform-007-finalizer-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const ghPath = join(bin, 'gh');
  writeFileSync(
    ghPath,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'if [[ "$*" == *"/pulls/42"* ]]; then',
      '  cat "$FAKE_GH_ROOT/pr.json"',
      '  exit 0',
      'fi',
      'if [[ "$*" == *"/statuses/"* ]]; then',
      '  target=""',
      '  state=""',
      '  for argument in "$@"; do',
      '    [[ "$argument" != */statuses/* ]] || target="${argument##*/}"',
      '    [[ "$argument" != state=* ]] || state="${argument#state=}"',
      '  done',
      '  if [[ "$target" == "$EXPECTED_FAIL_SHA" && "$state" == "$EXPECTED_FAIL_STATE" ]]; then',
      '    exit 1',
      '  fi',
      '  printf "%s %s\\n" "$target" "$state" >> "$FAKE_GH_ROOT/accepted-statuses"',
      '  printf "{}\\n"',
      '  exit 0',
      'fi',
      'exit 2',
      '',
    ].join('\n'),
  );
  chmodSync(ghPath, 0o755);
  writeFileSync(join(root, 'pr.json'), JSON.stringify(pullRequest()));

  const result = spawnSync('bash', ['-c', finalizer], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      FAKE_GH_ROOT: root,
      EXPECTED_FAIL_SHA: failTarget,
      EXPECTED_FAIL_STATE: failState,
      GITHUB_REPOSITORY: 'WayneWangPoly/ecoflow-vnext',
      PR_NUMBER: '42',
      HEAD_SHA: headA,
      MERGE_SHA: mergeA,
      VERDICT: 'not_applicable',
      REASON: 'TARGET_MIGRATION_NOT_CHANGED',
      PREPARE_RESULT: 'skipped',
      SHADOW_RESULT: 'skipped',
      STATUS_CONTEXT: 'Supabase shadow gate (required)',
      STATUS_URL: 'https://github.example/actions/runs/1',
    },
  });
  const accepted = readFileSync(join(root, 'accepted-statuses'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => line.split(' '));
  rmSync(root, { recursive: true, force: true });
  return { result, accepted };
}

test('bootstrap scope contains every declared contract and policy file', () => {
  for (const path of [
    requestPath,
    trustedPath,
    runnerPath,
    ownershipPath,
    packagePath,
  ]) {
    assert.ok(existsSync(path), `${path} is required`);
  }
});

test('pull-request request is unprivileged and self-checks its trust boundary', () => {
  assert.match(request, /^name: TRANSFORM-007 shadow request$/m);
  assert.match(request, /^on:\n  pull_request:\n    branches: \[main\]/m);
  assert.match(request, /^permissions:\n  contents: read$/m);
  assert.doesNotMatch(
    request,
    /^\s{2}(?:pull_request_target|workflow_run|push|workflow_dispatch|schedule):/m,
  );
  assert.doesNotMatch(request, /secrets\.|environment:|psql|pg_dump/i);
  assert.match(request, /uses: actions\/checkout@v4/);
  assert.match(request, /persist-credentials: false/);
  assert.match(request, /node --test scripts\/transform-007-shadow-bootstrap\.test\.mjs/);
  assert.match(request, /This workflow has no production credential/);
});

test('credentialed workflow is default-branch workflow_run only', () => {
  assert.match(
    trusted,
    /^on:\n  workflow_run:\n    workflows: \['TRANSFORM-007 shadow request'\]\n    types: \[completed\]/m,
  );
  assert.match(trusted, /^permissions: \{\}$/m);
  assert.doesNotMatch(
    trusted,
    /^\s{2}(?:pull_request|pull_request_target|push|workflow_dispatch|schedule):/m,
  );
  assert.match(trusted, /REQUEST_EVENT: \$\{\{ github\.event\.workflow_run\.event \}\}/);
  assert.match(trusted, /REQUEST_CONCLUSION: \$\{\{ github\.event\.workflow_run\.conclusion \}\}/);
});

test('trusted resolver binds current same-repository PR and fixed 007A scope', () => {
  assert.match(trusted, /repos\/\$GITHUB_REPOSITORY\/pulls\/\$pr_number/);
  assert.match(trusted, /if \[\[ ! \"\$head_sha\" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
  assert.match(trusted, /\[\[ \"\$head_repo\" != \"\$GITHUB_REPOSITORY\" \]\]/);
  assert.match(trusted, /REQUEST_FORK_FORBIDDEN/);
  assert.match(trusted, /TRUST_BOUNDARY_CHANGED/);
  assert.match(trusted, /ADDITIONAL_MIGRATION_FORBIDDEN/);
  assert.match(
    trusted,
    /TARGET_MIGRATION_PATH: supabase\/migrations\/20260811020000_transform_007_operational_records\.sql/,
  );
  assert.match(trusted, /changed_migration_count/);
  assert.match(trusted, /if \(\( changed_files > 3000 \)\)/);
  assert.match(trusted, /enumerated_files.*changed_files/s);
  assert.match(trusted, /REQUEST_FILES_INCOMPLETE/);
  assert.match(trusted, /current_snapshot.*expected_snapshot/s);
  assert.match(trusted, /REQUEST_PR_CHANGED/);
  assert.match(trusted, /emit run TARGET_MIGRATION_REQUIRES_SHADOW/);
});

test('resolver blocks a capped or incomplete PR file listing', () => {
  const output = runResolver({
    initial: pullRequest({ changedFiles: 2 }),
    files: [
      {
        filename: 'src/visible.ts',
        status: 'modified',
        sha: headB,
      },
    ],
  });
  assert.equal(output.verdict, 'blocked');
  assert.equal(output.reason, 'REQUEST_FILES_INCOMPLETE');
});

test('resolver blocks PRs beyond the GitHub 3000-file response ceiling', () => {
  const output = runResolver({
    initial: pullRequest({ changedFiles: 3001 }),
    files: [],
  });
  assert.equal(output.verdict, 'blocked');
  assert.equal(output.reason, 'REQUEST_FILE_LIMIT_EXCEEDED');
});

test('resolver blocks a synchronize race after paginated file discovery', () => {
  const output = runResolver({
    initial: pullRequest(),
    current: pullRequest({ head: headB, merge: mergeB }),
    files: [
      {
        filename: 'src/unrelated.ts',
        status: 'modified',
        sha: headB,
      },
    ],
  });
  assert.equal(output.verdict, 'blocked');
  assert.equal(output.reason, 'REQUEST_PR_CHANGED');
  assert.equal(output.head_sha, headA);
  assert.equal(output.merge_sha, mergeA);
});

test('resolver treats a protected-file rename as a trust-boundary edit', () => {
  const output = runResolver({
    initial: pullRequest(),
    files: [
      {
        filename: 'docs/disguised-trusted-workflow.yml',
        previous_filename:
          '.github/workflows/transform-007-shadow-trusted.yml',
        status: 'renamed',
        sha: headB,
      },
    ],
  });
  assert.equal(output.verdict, 'blocked');
  assert.equal(output.reason, 'TRUST_BOUNDARY_CHANGED');
});

test('resolver protects the single-maintainer ownership policy', () => {
  const output = runResolver({
    initial: pullRequest(),
    files: [
      {
        filename: 'docs/engineering/FILE-OWNERSHIP.md',
        status: 'modified',
        sha: headB,
      },
    ],
  });
  assert.equal(output.verdict, 'blocked');
  assert.equal(output.reason, 'TRUST_BOUNDARY_CHANGED');
});

test('resolver never calls a renamed-away target migration not applicable', () => {
  const output = runResolver({
    initial: pullRequest(),
    files: [
      {
        filename: 'supabase/migrations/renamed-away.sql',
        previous_filename:
          'supabase/migrations/20260811020000_transform_007_operational_records.sql',
        status: 'renamed',
        sha: headB,
      },
    ],
  });
  assert.equal(output.verdict, 'blocked');
  assert.equal(output.reason, 'TARGET_MIGRATION_NOT_PRESENT');
});

test('trusted workflow never checks out pull-request code', () => {
  assert.equal(
    trusted.match(/uses: actions\/checkout@v4/g)?.length,
    1,
    'only one trusted-main checkout is allowed',
  );
  assert.match(
    trusted,
    /- name: Checkout trusted main only[\s\S]*?ref: \$\{\{ github\.sha \}\}[\s\S]*?persist-credentials: false/,
  );
  assert.doesNotMatch(
    trusted,
    /ref:\s*\$\{\{[^}]+(?:head_sha|pull_request|workflow_run\.head)/,
  );
  assert.match(trusted, /Fetch the fixed candidate blob as data/);
  assert.match(trusted, /application\/vnd\.github\.raw\+json/);
  assert.match(trusted, /git hash-object .*candidate\.sql/);
});

test('production secret is isolated to trusted main evidence preparation', () => {
  assert.equal(
    trusted.match(/secrets\.TRANSFORM_007_SHADOW_READ_DB_URL/g)?.length,
    1,
  );
  assert.match(
    trusted,
    /prepare_evidence:[\s\S]*?environment:\n      name: transform-007-shadow-read\n      deployment: false/,
  );
  assert.match(
    trusted,
    /TRANSFORM_007_SHADOW_READ_DB_URL: \$\{\{ secrets\.TRANSFORM_007_SHADOW_READ_DB_URL \}\}/,
  );
  assert.doesNotMatch(trusted, /actions: write/);
  const shadowJob = trusted.match(/\n  shadow:[\s\S]*?\n  finalize:/)?.[0] ?? '';
  assert.ok(shadowJob, 'shadow job is required');
  assert.doesNotMatch(shadowJob, /secrets\.|environment:|statuses: write/);
  assert.match(shadowJob, /permissions:\n      actions: read/);
  assert.match(shadowJob, /postgres:17/);
  assert.equal(trusted.match(/sudo apt-get update && sudo apt-get install -y postgresql-client/g)?.length, 2);
});

test('candidate SQL runs under a local non-superuser with psql escapes rejected', () => {
  const shadowFunction = runner.match(/\nshadow\(\) \{[\s\S]*?\n\}\n\ncase /)?.[0] ?? '';
  assert.ok(shadowFunction, 'shadow runner function is required');
  assert.doesNotMatch(shadowFunction, /TRANSFORM_007_SHADOW_READ_DB_URL/);
  assert.match(
    shadowFunction,
    /create role transform_007_shadow[\s\S]*?nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls/,
  );
  assert.match(shadowFunction, /grep -q '\\\\' \"\$input_dir\/candidate\.sql\"/);
  assert.match(shadowFunction, /Candidate SQL contains a psql meta-command escape/);
  assert.match(
    shadowFunction,
    /psql \"\$SHADOW_MIGRATOR_DB_URL\"[\s\S]*?--single-transaction -f \"\$input_dir\/candidate\.sql\"/,
  );
  assert.match(
    shadowFunction,
    /transform_007_shadow\|transform_007_shadow\|0\|0\|0\|0\|0/,
  );
});

test('reader identity, direct-mutation denial and schema-only dump are enforced', () => {
  assert.match(runner, /aws-1-ap-southeast-2\.pooler\.supabase\.com/);
  assert.match(runner, /ecoflow_shadow_read\.kauqwlzuyxcudoyognwf/);
  assert.match(runner, /query == \[\('sslmode', 'require'\)\]/);
  assert.match(runner, /current_setting\('transaction_read_only'\)/);
  assert.match(runner, /has_table_privilege\(current_user,c\.oid,'MAINTAIN'\)/);
  assert.match(runner, /from pg_shdepend d/);
  assert.match(
    runner,
    /ecoflow_shadow_read\|ecoflow_shadow_read\|0\|0\|0\|0\|0\|on\|0/,
  );
  assert.match(
    runner,
    /pg_dump \"\$TRANSFORM_007_SHADOW_READ_DB_URL\" --schema-only --schema=public --schema=analytics/,
  );
  assert.match(runner, /--no-owner --no-acl --no-publications --no-subscriptions/);
});

test('shadow rebuild restores public dependencies without masking dump errors', () => {
  const shadowFunction = runner.match(/\nshadow\(\) \{[\s\S]*?\n\}\n\ncase /)?.[0] ?? '';
  assert.ok(shadowFunction, 'shadow runner function is required');

  const schemaLoadMarker =
    'psql \"$SHADOW_ADMIN_DB_URL\" -X -v ON_ERROR_STOP=0';
  const schemaLoadIndex = shadowFunction.indexOf(schemaLoadMarker);
  assert.notEqual(schemaLoadIndex, -1, 'production schema load is required');

  const setupBeforeSchemaLoad = shadowFunction.slice(0, schemaLoadIndex);
  assert.match(setupBeforeSchemaLoad, /drop schema if exists public cascade;/);
  assert.doesNotMatch(
    setupBeforeSchemaLoad,
    /create schema public/,
    'the dump must recreate public exactly once',
  );
  assert.match(
    setupBeforeSchemaLoad,
    /create extension if not exists citext with schema extensions;/,
  );
  assert.match(
    shadowFunction,
    /UNEXPECTED_PRODUCTION_SCHEMA_LOAD_ERROR[\s\S]*?exit 1/,
  );
});

test('only final trusted job publishes fail-closed head and test-merge status', () => {
  assert.equal(trusted.match(/statuses: write/g)?.length, 1);
  assert.match(
    trusted,
    /finalize:[\s\S]*?HEAD_SHA: \$\{\{ needs\.resolve\.outputs\.head_sha \}\}/,
  );
  assert.match(
    trusted,
    /MERGE_SHA: \$\{\{ needs\.resolve\.outputs\.merge_sha \}\}/,
  );
  assert.match(trusted, /\[\[ \"\$HEAD_SHA\" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
  assert.match(trusted, /\[\[ \"\$MERGE_SHA\" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
  assert.match(trusted, /\.head\.sha == \$head_sha/);
  assert.match(trusted, /\.merge_commit_sha == \$merge_sha/);
  assert.match(
    trusted,
    /publish_status \"\$MERGE_SHA\" pending[\s\S]*?publish_status \"\$HEAD_SHA\" pending[\s\S]*?for target_sha in \"\$HEAD_SHA\" \"\$MERGE_SHA\"/,
  );
  assert.match(trusted, /context=\"\$STATUS_CONTEXT\"/);
  assert.match(trusted, /Supabase shadow gate \(required\)/);
  assert.match(trusted, /test \"\$final_state\" = success/);
});

test('interrupted success publication leaves the test merge pending', () => {
  const { result, accepted } = interruptPublication({
    failTarget: mergeA,
    failState: 'success',
  });
  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(accepted, [
    [mergeA, 'pending'],
    [headA, 'pending'],
    [headA, 'success'],
  ]);
});

test('interruption after first pending write leaves test merge blocking', () => {
  const { result, accepted } = interruptPublication({
    failTarget: headA,
    failState: 'pending',
  });
  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(accepted, [[mergeA, 'pending']]);
});

test('bootstrap has no production deployment command or broad credential', () => {
  const joined = `${request}\n${trusted}\n${runner}`;
  assert.doesNotMatch(joined, /SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD/);
  assert.doesNotMatch(
    joined,
    /supabase\s+(?:link|db\s+(?:push|reset)|migration\s+(?:up|repair)|functions\s+deploy|secrets\s+set)/i,
  );
  assert.doesNotMatch(joined, /pull_request_target/);
  assert.doesNotMatch(joined, /\beval\b|\bsource\s+\//);
});

test('workflow YAML and shell parse locally', () => {
  const yaml = spawnSync(
    'python',
    [
      '-c',
      [
        'import sys, yaml',
        'for path in sys.argv[1:]:',
        '  with open(path, encoding=\"utf-8\") as stream:',
        '    yaml.load(stream, Loader=yaml.BaseLoader)',
      ].join('\n'),
      requestPath,
      trustedPath,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(yaml.status, 0, `${yaml.stdout}\n${yaml.stderr}`);

  const shell = spawnSync('bash', ['-n', runnerPath], { encoding: 'utf8' });
  assert.equal(shell.status, 0, `${shell.stdout}\n${shell.stderr}`);
});

test('production read mode fails closed before any connection when secret is absent', () => {
  const env = { ...process.env };
  delete env.TRANSFORM_007_SHADOW_READ_DB_URL;
  const result = spawnSync('bash', [runnerPath, 'read-production', '/tmp/unused'], {
    encoding: 'utf8',
    env,
  });
  assert.equal(result.status, 64, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Missing dedicated TRANSFORM_007_SHADOW_READ_DB_URL/);
});
