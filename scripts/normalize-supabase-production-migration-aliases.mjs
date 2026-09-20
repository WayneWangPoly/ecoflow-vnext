import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const KNOWN_MIGRATION_ALIAS = Object.freeze({
  source: 'supabase/migrations/20260918234500_warehouse_survey_002_commercial_sku_resolver_repair.sql',
  target: 'supabase/migrations/20260918135648_warehouse_survey_002_commercial_sku_resolver_repair.sql',
  expectedGitBlobSha: '3fd51aea0e83d96621426c73182e374b516b4923',
});

export function gitBlobSha(content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return createHash('sha1')
    .update(Buffer.from(`blob ${bytes.length}\0`))
    .update(bytes)
    .digest('hex');
}

export function normalizeKnownMigrationAlias(root = process.cwd()) {
  const source = resolve(root, KNOWN_MIGRATION_ALIAS.source);
  const target = resolve(root, KNOWN_MIGRATION_ALIAS.target);
  const sourceExists = existsSync(source);
  const targetExists = existsSync(target);

  if (sourceExists && targetExists) {
    throw new Error('SUPABASE_MIGRATION_ALIAS_BOTH_PRESENT');
  }

  if (!sourceExists && !targetExists) {
    throw new Error('SUPABASE_MIGRATION_ALIAS_SOURCE_MISSING');
  }

  const activePath = sourceExists ? source : target;
  const content = readFileSync(activePath);
  const actualBlobSha = gitBlobSha(content);
  if (actualBlobSha !== KNOWN_MIGRATION_ALIAS.expectedGitBlobSha) {
    throw new Error(
      `SUPABASE_MIGRATION_ALIAS_CONTENT_MISMATCH expected=${KNOWN_MIGRATION_ALIAS.expectedGitBlobSha} actual=${actualBlobSha}`,
    );
  }

  if (targetExists) {
    console.log(
      `Known production migration alias already normalized: ${KNOWN_MIGRATION_ALIAS.target}`,
    );
    return { status: 'ALREADY_NORMALIZED', source, target, gitBlobSha: actualBlobSha };
  }

  mkdirSync(dirname(target), { recursive: true });
  renameSync(source, target);
  console.log(
    `Normalized known production migration identity in ephemeral workspace: ${KNOWN_MIGRATION_ALIAS.source} -> ${KNOWN_MIGRATION_ALIAS.target}`,
  );
  return { status: 'NORMALIZED', source, target, gitBlobSha: actualBlobSha };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  normalizeKnownMigrationAlias();
}
