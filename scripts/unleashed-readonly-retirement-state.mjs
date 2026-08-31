#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const EXPECTED_SUPABASE_PROJECT_REF = 'kauqwlzuyxcudoyognwf';

export const LEGACY_UNLEASHED_PROBES = Object.freeze([
  Object.freeze({
    slug: 'unleashed-readonly-probe-001c',
    version: 2,
    sha256: '226a3efe5569cf6f77c72971f08cee125cb35cf2e5822fd47af1f513d9e341d3',
  }),
  Object.freeze({
    slug: 'unleashed-readonly-probe-001c2',
    version: 3,
    sha256: '0098d3a5fd979b57861fe2733a24fbf46a058911f27c5f7894f3c6d10891f9ef',
  }),
  Object.freeze({
    slug: 'unleashed-readonly-probe-001c3',
    version: 2,
    sha256: 'cb42a8aee662d2e49f5c8367bda67e3397e7ab8cd6f1b66be2a5fb25663aa508',
  }),
]);

const REPLACEMENT_SLUG = 'trigger-unleashed-readonly-sync';

export function validateRetirementExecutionContext({
  githubRef,
  projectRef,
  accessTokenPresent,
}) {
  if (githubRef !== 'refs/heads/main') {
    throw new Error('UNLEASHED_RETIREMENT_REF_NOT_MAIN');
  }
  if (projectRef !== EXPECTED_SUPABASE_PROJECT_REF) {
    throw new Error('UNLEASHED_RETIREMENT_PROJECT_REF_MISMATCH');
  }
  if (accessTokenPresent !== true) {
    throw new Error('MISSING_SUPABASE_ACCESS_TOKEN');
  }

  return {
    githubRef,
    projectRef,
    accessTokenPresent: true,
  };
}

function parseRows(rawJson) {
  const parsed = JSON.parse(rawJson);
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.functions)
      ? parsed.functions
      : null;
  if (!rows) throw new Error('UNLEASHED_FUNCTION_LIST_SHAPE_INVALID');

  return rows.map((row) => ({
    slug: typeof row?.slug === 'string' ? row.slug : typeof row?.name === 'string' ? row.name : '',
    status: typeof row?.status === 'string' ? row.status.toUpperCase() : '',
    version: Number(row?.version),
    verifyJwt: row?.verify_jwt,
    sha256: typeof row?.ezbr_sha256 === 'string' ? row.ezbr_sha256.toLowerCase() : '',
  }));
}

function requireActiveJwtFunction(row, errorCode) {
  if (!row || row.status !== 'ACTIVE' || row.verifyJwt !== true) {
    throw new Error(errorCode);
  }
}

export function inspectUnleashedFunctionState(rawJson, phase) {
  if (!['before', 'after'].includes(phase)) throw new Error('UNLEASHED_RETIREMENT_PHASE_INVALID');
  const rows = parseRows(rawJson);
  const replacement = rows.find((row) => row.slug === REPLACEMENT_SLUG);
  requireActiveJwtFunction(replacement, 'UNLEASHED_REPLACEMENT_NOT_ACTIVE');
  if (!Number.isInteger(replacement.version) || replacement.version < 7) {
    throw new Error('UNLEASHED_REPLACEMENT_VERSION_TOO_OLD');
  }

  const targets = [];
  const legacy = [];
  for (const expected of LEGACY_UNLEASHED_PROBES) {
    const deployed = rows.find((row) => row.slug === expected.slug);
    if (!deployed) {
      legacy.push({ slug: expected.slug, state: 'ABSENT' });
      continue;
    }
    requireActiveJwtFunction(deployed, `LEGACY_UNLEASHED_PROBE_NOT_INERT_BASELINE:${expected.slug}`);
    if (deployed.version !== expected.version || deployed.sha256 !== expected.sha256) {
      throw new Error(`LEGACY_UNLEASHED_PROBE_DRIFT:${expected.slug}`);
    }
    targets.push(expected.slug);
    legacy.push({
      slug: expected.slug,
      state: 'MATCHED_INERT_BASELINE',
      version: deployed.version,
      sha256: deployed.sha256,
    });
  }

  if (phase === 'after' && targets.length) {
    throw new Error(`LEGACY_UNLEASHED_PROBES_STILL_PRESENT:${targets.join(',')}`);
  }

  return {
    phase,
    replacement: {
      slug: replacement.slug,
      status: replacement.status,
      version: replacement.version,
      verifyJwt: replacement.verifyJwt,
    },
    legacy,
    targets,
  };
}

export function inspectUnleashedLegacyTarget(rawJson, targetSlug, expectation) {
  if (!['present', 'absent'].includes(expectation)) {
    throw new Error('LEGACY_UNLEASHED_PROBE_EXPECTATION_INVALID');
  }
  if (!LEGACY_UNLEASHED_PROBES.some((probe) => probe.slug === targetSlug)) {
    throw new Error(`LEGACY_UNLEASHED_PROBE_TARGET_NOT_ALLOWLISTED:${targetSlug}`);
  }

  const state = inspectUnleashedFunctionState(rawJson, 'before');
  const target = state.legacy.find((probe) => probe.slug === targetSlug);
  if (!target) {
    throw new Error(`LEGACY_UNLEASHED_PROBE_TARGET_NOT_FOUND:${targetSlug}`);
  }
  if (expectation === 'present' && target.state !== 'MATCHED_INERT_BASELINE') {
    throw new Error(`LEGACY_UNLEASHED_PROBE_ABSENT_BEFORE_DELETE:${targetSlug}`);
  }
  if (expectation === 'absent' && target.state !== 'ABSENT') {
    throw new Error(`LEGACY_UNLEASHED_PROBE_STILL_PRESENT_AFTER_DELETE:${targetSlug}`);
  }

  return {
    slug: target.slug,
    state: target.state,
    ...(target.version === undefined ? {} : { version: target.version }),
    ...(target.sha256 === undefined ? {} : { sha256: target.sha256 }),
    replacement: state.replacement,
  };
}

async function main() {
  const [command, file, targetSlug] = process.argv.slice(2);
  if (command === 'guard') {
    const context = validateRetirementExecutionContext({
      githubRef: process.env.GITHUB_REF,
      projectRef: process.env.SUPABASE_PROJECT_REF,
      accessTokenPresent: Boolean(process.env.SUPABASE_ACCESS_TOKEN),
    });
    process.stdout.write(`${JSON.stringify(context, null, 2)}\n`);
    return;
  }
  if (!['before', 'targets', 'target', 'absent', 'after'].includes(command) || !file) {
    throw new Error('Usage: unleashed-readonly-retirement-state.mjs <guard|before|targets|target|absent|after> [function-list.json] [target-slug]');
  }
  const rawJson = await readFile(file, 'utf8');
  if (['target', 'absent'].includes(command)) {
    if (!targetSlug) throw new Error('LEGACY_UNLEASHED_PROBE_TARGET_REQUIRED');
    const target = inspectUnleashedLegacyTarget(
      rawJson,
      targetSlug,
      command === 'target' ? 'present' : 'absent',
    );
    process.stdout.write(`${JSON.stringify(target, null, 2)}\n`);
    return;
  }

  const state = inspectUnleashedFunctionState(rawJson, command === 'after' ? 'after' : 'before');
  if (command === 'targets') {
    process.stdout.write(state.targets.length ? `${state.targets.join('\n')}\n` : '');
    return;
  }
  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
