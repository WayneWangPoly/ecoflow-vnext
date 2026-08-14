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

function referencedScripts(source) {
  const refs = new Set();
  const regex = /scripts\/([A-Za-z0-9._/-]+\.mjs)/g;
  for (const match of source.matchAll(regex)) {
    const basename = path.basename(match[1]);
    if (scriptSources.has(basename)) refs.add(basename);
  }
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
    for (const child of referencedScripts(source)) queue.push(child);
  }
  return false;
}

function assertSerialized(workflowName, source) {
  if (!/^concurrency:\s*$/m.test(source)) {
    throw new Error(`${workflowName}: production master writer has no concurrency block.`);
  }
  if (!new RegExp(`^\\s*group:\\s*${SHARED_GROUP}\\s*$`, 'm').test(source)) {
    throw new Error(`${workflowName}: production master writer must use concurrency group ${SHARED_GROUP}.`);
  }
  if (!/^\s*cancel-in-progress:\s*false\s*$/m.test(source)) {
    throw new Error(`${workflowName}: production master writer must retain cancel-in-progress: false.`);
  }
}

const discoveredWriters = new Set();
for (const workflowName of listFiles(WORKFLOW_DIR, ['.yml', '.yaml'])) {
  const source = read(path.join(WORKFLOW_DIR, workflowName));
  const entryScripts = referencedScripts(source);
  if (!entryScripts.size || !reachesMasterWriter(entryScripts)) continue;
  discoveredWriters.add(workflowName);
  assertSerialized(workflowName, source);
}

for (const expected of KNOWN_MASTER_WRITERS) {
  if (!discoveredWriters.has(expected)) {
    throw new Error(`Expected master writer workflow was not discovered: ${expected}`);
  }
}

const maintenance = read(path.join(WORKFLOW_DIR, 'ordermentum-storage-maintenance.yml'));
assertSerialized('ordermentum-storage-maintenance.yml', maintenance);

const masterPolicy = read(path.join(SCRIPT_DIR, 'ordermentum-master-data-sync.mjs'));
for (const invariant of [
  'ordermentum_raw_master_resources',
  'ordermentum_raw_master_resource_versions',
  'shouldArchivePreviousVersion',
]) {
  if (!masterPolicy.includes(invariant)) {
    throw new Error(`Master writer storage/backstop invariant missing: ${invariant}`);
  }
}

console.log('Ordermentum master writer concurrency audit passed.');
console.log(`Shared concurrency group: ${SHARED_GROUP}`);
console.log(`Direct master writer scripts: ${[...directWriterScripts].sort().join(', ')}`);
console.log(`Serialized writer workflows: ${[...discoveredWriters].sort().join(', ')}`);
console.log('Storage maintenance remains serialized on the same Ordermentum I/O boundary.');
