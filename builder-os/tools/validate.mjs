#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
}
function fail(message) {
  console.error(`BUILDER_OS_VALIDATION_FAILED: ${message}`);
  process.exitCode = 1;
}
function uniqueIds(items, label) {
  const seen = new Set();
  for (const item of items) {
    if (!item?.id) fail(`${label} item missing id`);
    if (seen.has(item.id)) fail(`${label} duplicate id ${item.id}`);
    seen.add(item.id);
  }
  return seen;
}
function requireRef(ids, ref, from) {
  if (!ids.has(ref)) fail(`${from} references missing id ${ref}`);
}

const manifest = readJson('manifest.json');
const evidenceDoc = readJson('registries/evidence.json');
const patternsDoc = readJson('registries/patterns.json');
const standardsDoc = readJson('registries/standards.json');
const evalsDoc = readJson('registries/evals.json');
const crewDoc = readJson('registries/agent-crew.json');
const completion = readJson('registries/completion.json');

for (const [name, doc] of Object.entries({
  evidence: evidenceDoc,
  patterns: patternsDoc,
  standards: standardsDoc,
  evals: evalsDoc,
  crew: crewDoc,
  completion
})) {
  if (doc.version !== manifest.version) fail(`${name} version ${doc.version} != manifest ${manifest.version}`);
}

const evidenceIds = uniqueIds(evidenceDoc.records, 'evidence');
const patternIds = uniqueIds(patternsDoc.patterns, 'pattern');
const standardIds = uniqueIds(standardsDoc.standards, 'standard');
const evalIds = uniqueIds(evalsDoc.evals, 'eval');
const roleIds = uniqueIds(crewDoc.roles, 'role');

for (const p of patternsDoc.patterns) {
  if (!Array.isArray(p.evidence) || p.evidence.length === 0) fail(`${p.id} has no evidence`);
  if (!Array.isArray(p.standards) || p.standards.length === 0) fail(`${p.id} has no standards`);
  if (!Array.isArray(p.candidate_evals) || p.candidate_evals.length === 0) fail(`${p.id} has no evals`);
  for (const id of p.evidence) requireRef(evidenceIds, id, p.id);
  for (const id of p.standards) requireRef(standardIds, id, p.id);
  for (const id of p.candidate_evals) requireRef(evalIds, id, p.id);
}

for (const s of standardsDoc.standards) {
  if (s.maturity !== 'PROJECT_VERIFIED') fail(`${s.id} unexpected maturity ${s.maturity}`);
  if (s.portability !== 'CROSS_PROJECT_PENDING') fail(`${s.id} must remain cross-project pending in v0.1`);
  if (!Array.isArray(s.evidence) || s.evidence.length === 0) fail(`${s.id} has no evidence`);
  if (!Array.isArray(s.related_evals) || s.related_evals.length === 0) fail(`${s.id} has no related eval`);
  for (const id of s.evidence) requireRef(evidenceIds, id, s.id);
  for (const id of s.related_evals) requireRef(evalIds, id, s.id);
}

for (const e of evalsDoc.evals) {
  requireRef(patternIds, e.family, e.id);
  if (!['READY','CANDIDATE'].includes(e.status)) fail(`${e.id} invalid status ${e.status}`);
  if (e.status === 'READY' && (!Array.isArray(e.evidence) || e.evidence.length === 0)) {
    fail(`${e.id} READY without evidence`);
  }
  for (const id of e.evidence ?? []) requireRef(evidenceIds, id, e.id);
}

for (const r of crewDoc.roles) {
  for (const id of r.handoff_to ?? []) requireRef(roleIds, id, r.id);
  for (const id of r.independent_from ?? []) requireRef(roleIds, id, r.id);
}
const builder = crewDoc.roles.find(r => r.id === 'ROLE-BUILDER');
if (!builder?.independent_from?.includes('ROLE-REVIEWER') || !builder?.independent_from?.includes('ROLE-EVAL')) {
  fail('Builder must remain independent from Reviewer and Eval roles');
}

const requiredAxes = ['ENGINEERING_READY','DATA_READY','DEPLOYMENT_READY','PRODUCTION_READY','FIELD_READY'];
const axisIds = new Set(completion.axes.map(a => a.id));
for (const id of requiredAxes) requireRef(axisIds, id, 'completion');

const expectedCounts = {
  evidence: evidenceDoc.records.length,
  pattern_families: patternsDoc.patterns.length,
  standards: standardsDoc.standards.length,
  evals: evalsDoc.evals.length,
  crew_roles: crewDoc.roles.length
};
for (const [key, count] of Object.entries(expectedCounts)) {
  if (manifest.counts[key] !== count) fail(`manifest count ${key}=${manifest.counts[key]} actual=${count}`);
}

const requiredPaths = [
  ...Object.values(manifest.registries),
  ...Object.values(manifest.schemas),
  ...manifest.playbooks,
  ...manifest.templates
];
for (const rel of requiredPaths) {
  if (!fs.existsSync(path.join(root, rel))) fail(`manifest path missing: ${rel}`);
}

if (manifest.phase_status.generic_kernel_extraction !== 'BLOCKED_PENDING_CROSS_PROJECT_VALIDATION') {
  fail('generic kernel extraction must remain blocked in v0.1');
}

if (!process.exitCode) {
  console.log(`Builder OS ${manifest.version} validated: ${expectedCounts.evidence} evidence records, ${expectedCounts.pattern_families} patterns, ${expectedCounts.standards} standards, ${expectedCounts.evals} evals, ${expectedCounts.crew_roles} crew roles.`);
}
