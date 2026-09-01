import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/20260831235500_unleashed_master_data_bridge.sql');
const edge = read('supabase/functions/trigger-unleashed-master-migration/index.ts');
const core = read('supabase/functions/trigger-unleashed-master-migration/core.ts');
const deploy = read('.github/workflows/deploy-supabase-migrations.yml');
const workPackage = read('docs/engineering/work-packages/UNLEASHED-MIGRATION-003-canonical-master-data-assets.md');

const checks = [];
const check = (name, pass, evidence) => checks.push({ name, pass: Boolean(pass), evidence });

check(
  'four governed mapping states',
  /mapping_status in \('MATCHED','AMBIGUOUS','UNMATCHED','RETIRED'\)/.test(migration),
  'MATCHED / AMBIGUOUS / UNMATCHED / RETIRED constraint',
);
check(
  'commercial and physical SKU separation',
  !/insert\s+into\s+public\.ecoflow_physical_skus/i.test(migration + edge)
    && !/update\s+public\.ecoflow_physical_skus/i.test(migration + edge),
  'no Physical SKU mutation path',
);
check(
  'inventory authority excluded',
  !/(insert\s+into|update|delete\s+from)\s+public\.(?:inventory_|ecoflow_inventory)/i.test(migration + edge),
  'no inventory table mutation',
);
check(
  'Unleashed API not called',
  !/api\.unleashedsoftware\.com|api-auth-id|api-auth-signature/.test(edge),
  '#338 consumes #337 snapshots only',
);
check(
  'image host allowlisted',
  /unlappcdn\.unleashedsoftware\.com/.test(core)
    && /UNLEASHED_IMAGE_HOST_NOT_ALLOWED/.test(core),
  'exact CDN host and fail-closed error',
);
check(
  'redirects rejected',
  /redirect: 'manual'/.test(edge) && /UNLEASHED_IMAGE_REDIRECT_REJECTED/.test(core),
  'manual redirect handling',
);
check(
  'rights and budget gated',
  /ASSET_RIGHTS_NOT_APPROVED/.test(edge)
    && /UNLEASHED_IMAGE_BUDGET_EXCEEDED/.test(core)
    && /storage_budget_bytes/.test(migration),
  'approval and byte budget required before upload',
);
check(
  'private service-written image bucket',
  /'unleashed-product-images','unleashed-product-images',false/.test(migration)
    && !/for insert to authenticated[\s\S]{0,240}unleashed-product-images/i.test(migration)
    && !/for delete to authenticated[\s\S]{0,240}unleashed-product-images/i.test(migration),
  'private bucket, no browser mutation policy',
);
check(
  'browser mapping mutation blocked',
  /revoke all on table public\.ecoflow_unleashed_master_mappings from public, anon, authenticated/.test(migration)
    && /ecoflow_review_unleashed_master_mapping/.test(migration),
  'direct grants revoked; server command provided',
);
check(
  'idempotent command evidence',
  (migration.match(/COMMAND_REPLAY_PAYLOAD_MISMATCH/g) ?? []).length >= 2
    && /command_payload_sha256/.test(migration),
  'mapping, authorization and copy commands are payload-bound',
);
check(
  'content-addressed assets',
  /contentAddressedObjectPath/.test(edge + core)
    && /content_sha256/.test(migration),
  'immutable object path and provenance hash',
);
check(
  'JWT-protected deployment',
  /supabase functions deploy trigger-unleashed-master-migration/.test(deploy)
    && !/functions deploy trigger-unleashed-master-migration[^\n]*--no-verify-jwt/.test(deploy),
  'central deployment uses CLI default JWT verification',
);
check(
  'bounded implementation scope recorded',
  /UNLEASHED-MIGRATION-003/.test(workPackage)
    && /No inventory quantities, opening balances/.test(workPackage),
  'approved work-package boundary present',
);

for (const item of checks) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}: ${item.evidence}`);
}
const failed = checks.filter((item) => !item.pass);
console.log(`UNLEASHED_MASTER_DATA_BRIDGE_AUDIT ${failed.length ? 'FAIL' : 'PASS'} (${checks.length - failed.length}/${checks.length})`);
if (failed.length) process.exitCode = 1;
