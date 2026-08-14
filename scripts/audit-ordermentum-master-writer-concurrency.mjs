#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const WORKFLOW_DIR = path.join(ROOT, '.github', 'workflows');
const SCRIPT_DIR = path.join(ROOT, 'scripts');
const SHARED_GROUP = 'ordermentum-cloud-sync';

const KNOWN_MASTER_WRITERS = new Set([
  'ordermentum-cloud-sync.yml',
  'ordermentum-complete-mirror.yml',
  'recover-supabase-migration-ordering.yml',
  'refresh-master-catalog-after-migrations.yml',
  'refresh-customer-stores-on-release.yml',
]);

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function listFiles(dir, suffixes) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && suffixes.some((suffix) => entry.name.endsWith(suffix)))
    .map((entry) => entry.name)
    .sort();
}

const scriptNames = listFiles(SCRIPT_DIR, ['.mjs']);
const scriptSources = new Map(scriptNames.map((name) => [name, read(path.join(SCRIPT_DIR, name))]));

function addKnownScript(refs, candidate) {
  const basename = path.basename(candidate);
  if (scriptSources.has(basename)) refs.add(basename);
}

function workflowExecutedScripts(source) {
  const refs = new Set();
  const regex = /\bnode\s+scripts\/([A-Za-z0-9._/-]+\.mjs)\b/g;
  for (const match of source.matchAll(regex)) addKnownScript(refs, match[1]);
  return refs;
}

function scriptExecutedScripts(source) {
  const refs = new Set();
  const runNodeRegex = /\b(?:runNode|runScript)\(\s*['"]scripts\/([A-Za-z0-9._/-]+\.mjs)['"]/g;
  for (const match of source.matchAll(runNodeRegex)) addKnownScript(refs, match[1]);

  const spawnRegex = /\bspawn\(\s*process\.execPath\s*,\s*\[\s*['"]scripts\/([A-Za-z0-9._/-]+\.mjs)['"]/g;
  for (const match of source.matchAll(spawnRegex)) addKnownScript(refs, match[1]);
  return refs;
}

function directlyWritesMasterResources(source) {
  return /from\(\s*['"]ordermentum_raw_master_resources['"]\s*\)\s*\.(?:insert|upsert|update|delete)\s*\(/s.test(source);
}

const directWriterScripts = new Set(
  [...scriptSources.entries()]
    .filter(([, source]) => directlyWritesMasterResources(source))
    .map(([name]) => name),
);

if (!directWriterScripts.has('ordermentum-master-data-sync.mjs')) {
  throw new Error('Audit cannot prove ordermentum-master-data-sync.mjs is a direct master-resource writer.');
}

function reachesMasterWriter(initialScripts) {
  const queue = [...initialScripts];
  const seen = new Set();
  while (queue.length) {
    const script = queue.shift();
    if (!script || seen.has(script)) continue;
    seen.add(script);
    if (directWriterScripts.has(script)) return true;
    const source = scriptSources.get(script);
    if (!source) continue;
    for (const child of scriptExecutedScripts(source)) queue.push(child);
  }
  return false;
}

function serializationProblems(workflowName, source) {
  const problems = [];
  if (!/^concurrency:\s*$/m.test(source)) {
    problems.push(`${workflowName}: production master writer has no concurrency block.`);
  }
  if (!new RegExp(`^\\s*group:\\s*${SHARED_GROUP}\\s*$`, 'm').test(source)) {
    problems.push(`${workflowName}: production master writer must use concurrency group ${SHARED_GROUP}.`);
  }
  if (!/^\s*cancel-in-progress:\s*false\s*$/m.test(source)) {
    problems.push(`${workflowName}: production master writer must retain cancel-in-progress: false.`);
  }
  return problems;
}

const discoveredWriters = new Set();
const failures = [];
for (const workflowName of listFiles(WORKFLOW_DIR, ['.yml', '.yaml'])) {
  const source = read(path.join(WORKFLOW_DIR, workflowName));
  const entryScripts = workflowExecutedScripts(source);
  if (!entryScripts.size || !reachesMasterWriter(entryScripts)) continue;
  discoveredWriters.add(workflowName);
  failures.push(...serializationProblems(workflowName, source));
}

for (const expected of KNOWN_MASTER_WRITERS) {
  if (!discoveredWriters.has(expected)) {
    failures.push(`Expected master writer workflow was not discovered: ${expected}`);
  }
}

const recovery = read(path.join(WORKFLOW_DIR, 'recover-supabase-migration-ordering.yml'));
if (!/^concurrency:\n  group: ecoflow-supabase-production-migrations\n  cancel-in-progress: false$/m.test(recovery)) {
  failures.push('recover-supabase-migration-ordering.yml must retain the production migration concurrency boundary.');
}
if (!/\n  complete-mirror:\n[\s\S]*?\n    concurrency:\n      group: ordermentum-cloud-sync\n      cancel-in-progress: false\n/.test(recovery)) {
  failures.push('recover-supabase-migration-ordering.yml complete-mirror job must additionally acquire ordermentum-cloud-sync.');
}
if (!/^  SUPABASE_POOLER_HOST: aws-1-ap-southeast-2\.pooler\.supabase\.com$/m.test(recovery)) {
  failures.push('recover-supabase-migration-ordering.yml must use the production-proven IPv4 pooler host.');
}
if (!recovery.includes('postgresql://postgres.${SUPABASE_PROJECT_REF}:${ENCODED_PASSWORD}@${SUPABASE_POOLER_HOST}:5432/postgres')) {
  failures.push('recover-supabase-migration-ordering.yml must construct its pooler URL from stable runtime values.');
}
if (recovery.includes('supabase/.temp/pooler-url')) {
  failures.push('recover-supabase-migration-ordering.yml must not depend on checkout-local Supabase .temp pooler metadata.');
}

const maintenance = read(path.join(WORKFLOW_DIR, 'ordermentum-storage-maintenance.yml'));
failures.push(...serializationProblems('ordermentum-storage-maintenance.yml', maintenance));

const masterPolicy = read(path.join(SCRIPT_DIR, 'ordermentum-master-data-sync.mjs'));
for (const invariant of [
  'ordermentum_raw_master_resources',
  'ordermentum_raw_master_resource_versions',
  'shouldArchivePreviousVersion',
]) {
  if (!masterPolicy.includes(invariant)) {
    failures.push(`Master writer storage/backstop invariant missing: ${invariant}`);
  }
}

console.log(`Shared concurrency group: ${SHARED_GROUP}`);
console.log(`Direct master writer scripts: ${[...directWriterScripts].sort().join(', ')}`);
console.log(`Discovered writer workflows: ${[...discoveredWriters].sort().join(', ')}`);
console.log('Static audit workflows are excluded unless they actually execute a writer entry script.');

if (failures.length) {
  console.error('Ordermentum master writer concurrency audit failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Ordermentum master writer concurrency audit passed.');
console.log('Recovery retains the Supabase migration mutex and adds the Ordermentum writer mutex for its mirror job.');
console.log('Recovery pooler URL is resolved from the same stable runtime configuration proven by production deployment.');
console.log('Storage maintenance remains serialized on the same Ordermentum I/O boundary.');
