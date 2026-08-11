import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const workflowPath = '.github/workflows/transform-007-supabase-shadow-check.yml';
const applyPendingPath = 'scripts/transform-007-apply-pending-to-shadow.sh';

test('TRANSFORM-007 shadow gate exists and is PR-only', () => {
  assert.ok(existsSync(workflowPath), `${workflowPath} is required`);
  const workflow = readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /^on:\n  pull_request:\n    branches: \[main\]/m);
  assert.doesNotMatch(workflow, /^    paths:/m);
  assert.doesNotMatch(workflow, /^\s{2}(?:push|pull_request_target|workflow_dispatch|workflow_run|schedule):/m);
  assert.match(
    workflow,
    /HEAD_REPOSITORY: \$\{\{ github\.event\.pull_request\.head\.repo\.full_name \}\}/,
    'fork provenance must be detected before the credentialed job',
  );
});

test('TRANSFORM-007 shadow gate has read-only GitHub permissions and no deployment capability', () => {
  const workflow = readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /^permissions:\n  contents: read$/m);
  assert.match(workflow, /environment:\n      name: transform-007-shadow-read\n      deployment: false/);
  assert.doesNotMatch(workflow, /^\s+(?:statuses|actions|deployments|id-token):\s*write$/m);
  assert.doesNotMatch(workflow, /^\s{2}deploy:/m);
  assert.doesNotMatch(workflow, /\bGH_TOKEN\b|gh api|\/statuses\//i);
  assert.doesNotMatch(workflow, /SUPABASE_ACCESS_TOKEN/);
  assert.doesNotMatch(workflow, /SUPABASE_DB_PASSWORD/);
  assert.doesNotMatch(
    workflow,
    /^    env:\n(?:      .*\n)*      TRANSFORM_007_SHADOW_READ_DB_URL:/m,
    'production credential must not exist at job scope',
  );
  assert.doesNotMatch(workflow, /TRANSFORM_007_SHADOW_READ_DB_URL=.*GITHUB_ENV/);
});

test('production reader is pinned to EcoFlow production and direct mutation paths are denied', () => {
  const workflow = readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /TRANSFORM_007_SHADOW_READ_DB_URL: \$\{\{ secrets\.TRANSFORM_007_SHADOW_READ_DB_URL \}\}/);
  assert.equal(
    workflow.match(/secrets\.TRANSFORM_007_SHADOW_READ_DB_URL/g)?.length,
    4,
    'only endpoint validation, the SQL contract, migration history and schema dump may receive the secret',
  );
  assert.match(workflow, /aws-1-ap-southeast-2\.pooler\.supabase\.com/);
  assert.match(workflow, /ecoflow_shadow_read\.kauqwlzuyxcudoyognwf/);
  assert.match(workflow, /query == \[\('sslmode', 'require'\)\]/);
  assert.match(workflow, /TRANSFORM_007_SHADOW_READER_IDENTITY_MISMATCH/);
  assert.equal(workflow.match(/psql "\$TRANSFORM_007_SHADOW_READ_DB_URL"/g)?.length, 2);
  assert.match(
    workflow,
    /select version::text from supabase_migrations\.schema_migrations order by version/,
  );
  assert.match(workflow, /postgres:17[\s\S]*pg_dump "\$TRANSFORM_007_SHADOW_READ_DB_URL" --schema-only --schema=public/);
  assert.match(workflow, /--no-owner --no-acl --no-publications --no-subscriptions/);
  assert.doesNotMatch(workflow, /supabase (?:migration list|db dump)/);
  assert.match(workflow, /current_setting\('transaction_read_only'\)/);
  assert.match(workflow, /has_database_privilege\(current_user,current_database\(\),'CREATE'\)/);
  assert.match(workflow, /has_schema_privilege\(current_user,n\.oid,'CREATE'\)/);
  assert.match(workflow, /has_any_column_privilege\(current_user,c\.oid,'INSERT'\)/);
  assert.match(workflow, /has_any_column_privilege\(current_user,c\.oid,'UPDATE'\)/);
  assert.match(workflow, /has_table_privilege\(current_user,c\.oid,'MAINTAIN'\)/);
  assert.match(workflow, /security_definer_execution/);
  assert.match(workflow, /p\.prosecdef/);
  assert.match(workflow, /owned_objects/);
  assert.match(workflow, /from pg_shdepend d/);
  assert.match(workflow, /d\.refclassid='pg_authid'::regclass/);
  assert.match(workflow, /d\.deptype='o'/);
  assert.match(workflow, /reachable_roles/);
  assert.match(workflow, /pg_has_role\(current_user,r\.oid,'MEMBER'\)/);
  assert.match(
    workflow,
    /test "\$reader_contract" = 'ecoflow_shadow_read\|ecoflow_shadow_read\|0\|0\|0\|0\|0\|on\|0'/,
  );
  assert.doesNotMatch(
    workflow,
    /supabase\s+(?:link|db\s+(?:push|reset)|migration\s+(?:up|repair)|functions\s+deploy|secrets\s+set)/i,
  );
});

test('only the local PostgreSQL 17 shadow receives pending migrations', () => {
  const workflow = readFileSync(workflowPath, 'utf8');
  const applyPending = readFileSync(applyPendingPath, 'utf8');

  assert.match(workflow, /image: postgres:17/);
  assert.match(workflow, /SHADOW_DB_URL: postgresql:\/\/postgres:shadow@localhost:54329\/postgres/);
  assert.match(workflow, /grep -qx '20260811020000' \/tmp\/pending-versions\.txt/);
  assert.match(workflow, /bash scripts\/transform-007-apply-pending-to-shadow\.sh/);
  assert.match(
    applyPending,
    /psql "\$SHADOW_DB_URL" -v ON_ERROR_STOP=1 --single-transaction -f "\$file"/,
  );
  assert.match(workflow, /UNEXPECTED_PRODUCTION_SCHEMA_LOAD_ERROR/);
  assert.match(workflow, /TRANSFORM-007A shadow verification passed without production writes/);
});

test('required gate is durable and reports truthful applicability on every pull request', () => {
  const workflow = readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /git diff --name-only "\$BASE_SHA\.\.\.\$HEAD_SHA"/);
  assert.doesNotMatch(workflow, /git diff --name-only "\$BASE_SHA" "\$HEAD_SHA"/);
  assert.match(workflow, /requires_shadow=true/);
  assert.match(workflow, /requires_shadow=false/);
  assert.match(workflow, /same_repository=true/);
  assert.match(workflow, /same_repository=false/);
  assert.match(workflow, /vars\.TRANSFORM_007_SHADOW_GATE_ENABLED == 'true'/);
  assert.match(workflow, /test "\$SHADOW_GATE_ENABLED" = 'true'/);
  assert.match(workflow, /name: Supabase shadow gate \(required\)/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /test "\$SHADOW_RESULT" = 'success'/);
  assert.match(workflow, /test "\$SHADOW_RESULT" = 'skipped'/);
});

test('pending migration applier executes the final unterminated version', () => {
  const root = mkdtempSync(join(tmpdir(), 'transform-007-shadow-'));
  try {
    const migrations = join(root, 'migrations');
    const bin = join(root, 'bin');
    const pending = join(root, 'pending.txt');
    const calls = join(root, 'psql-calls.txt');
    mkdirSync(migrations);
    mkdirSync(bin);

    const versions = ['20260811020000', '20260811030000'];
    writeFileSync(pending, versions.join('\n'));
    for (const version of versions) {
      writeFileSync(join(migrations, `${version}_fixture.sql`), 'select 1;\n');
    }

    const fakePsql = join(bin, 'psql');
    writeFileSync(
      fakePsql,
      '#!/usr/bin/env bash\nset -euo pipefail\nprintf \'%s\\n\' "$*" >> "$TRANSFORM_007_PSQL_CALL_LOG"\n',
    );
    chmodSync(fakePsql, 0o755);

    const result = spawnSync('bash', [applyPendingPath, pending, migrations], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        SHADOW_DB_URL: 'postgresql://postgres:shadow@localhost:54329/postgres',
        TRANSFORM_007_PSQL_CALL_LOG: calls,
      },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    const invocations = readFileSync(calls, 'utf8').trimEnd().split('\n');
    assert.equal(invocations.length, versions.length);
    for (const version of versions) {
      assert.ok(invocations.some((line) => line.includes(`${version}_fixture.sql`)), version);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('pending migration applier rejects duplicate versions before applying SQL', () => {
  const root = mkdtempSync(join(tmpdir(), 'transform-007-shadow-duplicate-'));
  try {
    const migrations = join(root, 'migrations');
    const bin = join(root, 'bin');
    const pending = join(root, 'pending.txt');
    const calls = join(root, 'psql-calls.txt');
    mkdirSync(migrations);
    mkdirSync(bin);

    const version = '20260811020000';
    writeFileSync(pending, `${version}\n${version}`);
    writeFileSync(join(migrations, `${version}_fixture.sql`), 'select 1;\n');

    const fakePsql = join(bin, 'psql');
    writeFileSync(
      fakePsql,
      '#!/usr/bin/env bash\nset -euo pipefail\nprintf \'%s\\n\' "$*" >> "$TRANSFORM_007_PSQL_CALL_LOG"\n',
    );
    chmodSync(fakePsql, 0o755);

    const result = spawnSync('bash', [applyPendingPath, pending, migrations], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        SHADOW_DB_URL: 'postgresql://postgres:shadow@localhost:54329/postgres',
        TRANSFORM_007_PSQL_CALL_LOG: calls,
      },
    });
    assert.equal(result.status, 65, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Duplicate pending migration version/);
    assert.equal(existsSync(calls), false, 'duplicate input must fail before psql is invoked');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
