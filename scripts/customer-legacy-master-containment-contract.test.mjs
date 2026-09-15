import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const migrationDirectory = path.join(root, 'supabase', 'migrations');
const suffix = '_customer_legacy_master_containment.sql';
const targetTables = [
  'customers',
  'customer_sites',
  'addresses',
  'external_customer_mappings',
];

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

const migrationFiles = fs.readdirSync(migrationDirectory)
  .filter((name) => name.endsWith(suffix));

test('there is exactly one forward Customer legacy-master containment migration', () => {
  assert.deepEqual(migrationFiles, [
    '20260915230000_customer_legacy_master_containment.sql',
  ]);
});

test('the migration contains only the bounded RLS and browser privilege changes', () => {
  const migration = fs.readFileSync(
    path.join(migrationDirectory, migrationFiles[0]),
    'utf8',
  );
  const executableStatements = migration
    .replace(/--.*$/gm, '')
    .split(';')
    .map((statement) => statement.trim().replace(/\s+/g, ' '))
    .filter(Boolean);

  assert.equal(executableStatements[0].toLowerCase(), 'begin');
  assert.equal(executableStatements.at(-1)?.toLowerCase(), 'commit');
  assert.equal(executableStatements.length, 10);

  for (const table of targetTables) {
    assert.equal(
      executableStatements.filter((statement) => new RegExp(
        `^alter table public\\.${table} enable row level security$`,
        'i',
      ).test(statement)).length,
      1,
      `missing exact RLS statement for ${table}`,
    );
    assert.equal(
      executableStatements.filter((statement) => new RegExp(
        `^revoke all privileges on table public\\.${table} from anon, authenticated$`,
        'i',
      ).test(statement)).length,
      1,
      `missing exact browser revoke for ${table}`,
    );
  }

  for (const statement of executableStatements.slice(1, -1)) {
    assert.match(
      statement,
      /^(?:alter table public\.(?:customers|customer_sites|addresses|external_customer_mappings) enable row level security|revoke all privileges on table public\.(?:customers|customer_sites|addresses|external_customer_mappings) from anon, authenticated)$/i,
    );
  }

  assert.doesNotMatch(migration, /\b(?:create|alter|drop)\s+(?:or\s+replace\s+)?(?:function|policy|view|materialized\s+view|trigger)\b/i);
  assert.doesNotMatch(migration, /\b(?:insert|update|delete|truncate)\b/i);
  assert.doesNotMatch(migration, /\bgrant\b|\bservice_role\b|\bauth\.role\s*\(/i);
  assert.doesNotMatch(migration, /CUST-00000296|89\s+Customer|75\s+Site/i);
  assert.doesNotMatch(migration, /\b(?:skus|external_product_mappings|warehouses|inventory|wave2)\b/i);
});

test('browser, Edge, Node and workflow code has no direct legacy-table caller', () => {
  const codeFiles = [
    ...walk(path.join(root, 'src')),
    ...walk(path.join(root, 'supabase', 'functions')),
    ...walk(path.join(root, 'scripts')),
    ...walk(path.join(root, '.github', 'workflows')),
  ].filter((file) => /\.(?:ts|tsx|js|jsx|mjs|cjs|sh|ya?ml)$/.test(file))
    .filter((file) => !file.endsWith('customer-legacy-master-containment-contract.test.mjs'));

  const directFrom = new RegExp(
    String.raw`\.from\s*\(\s*['\"](?:${targetTables.join('|')})['\"]\s*\)`,
    'i',
  );
  const embeddedSql = new RegExp(
    String.raw`\b(?:from|join|insert\s+into|update|delete\s+from)\s+(?:public\.)?(?:${targetTables.join('|')})\b`,
    'i',
  );
  const violations = codeFiles.flatMap((file) => {
    const source = fs.readFileSync(file, 'utf8');
    return directFrom.test(source) || embeddedSql.test(source)
      ? [path.relative(root, file)]
      : [];
  });
  assert.deepEqual(violations, []);
});

test('repository SQL contains no incumbent function/view DML caller for the four tables', () => {
  const sqlFiles = [
    ...walk(path.join(root, 'supabase', 'migrations')),
    ...walk(path.join(root, 'scripts')),
  ].filter((file) => file.endsWith('.sql'))
    .filter((file) => !file.endsWith(suffix))
    .filter((file) => !file.endsWith('customer-legacy-master-containment-db-contract-test.sql'));
  const relationalReference = new RegExp(
    String.raw`\b(?:from|join|insert\s+into|update|delete\s+from)\s+(?:public\.)?(?:${targetTables.join('|')})\b`,
    'i',
  );
  const violations = sqlFiles.flatMap((file) => relationalReference.test(fs.readFileSync(file, 'utf8'))
    ? [path.relative(root, file)]
    : []);
  assert.deepEqual(violations, []);
});
