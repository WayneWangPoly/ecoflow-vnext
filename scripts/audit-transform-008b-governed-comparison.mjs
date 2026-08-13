import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const read = (path) => { assert.ok(fs.existsSync(path), `Missing ${path}`); return fs.readFileSync(path, 'utf8'); };
const migration = read('supabase/migrations/20260813190000_governed_comparison_candidates.sql');
const repository = read('src/data/repositories/comparisonCandidates.ts');
const contract = read('src/features/intelligence/analytics/productivity/productivityContract.ts');
const panel = read('src/features/intelligence/analytics/productivity/PersonalisationProductivityPanel.tsx');
const exportPanel = read('src/features/intelligence/analytics/productivity/AuthoritativeExportPanel.tsx');
const exportRepository = read('src/data/repositories/authoritativeExport.ts');

for (const marker of [
  'ecoflow_can_read_comparison_candidates',
  'ecoflow_read_comparison_candidates_v1',
  "('OWNER','ADMIN','ACCOUNT','VIEWER')",
  "'COMMERCIAL_SKU'",
  "'PHYSICAL_SKU'",
  "'CUSTOMER'",
  "'DELIVERY_RUN'",
  "l.identity_status='ACTIVE'",
  "f.identity_status='ACTIVE'",
  "p.identity_status='ACTIVE'",
  "r.route_status='LOCKED'",
  "'ALLOWED'::text",
  'security definer',
  'stable',
  'revoke all on function public.ecoflow_read_comparison_candidates_v1',
]) assert.ok(migration.toLowerCase().includes(marker.toLowerCase()), `Migration marker missing: ${marker}`);

assert.ok(!/\b(insert|update|delete)\s+(into|public\.|from)\b/i.test(migration.replace(/comment on[\s\S]*?;/gi,'')), 'Comparison migration must not mutate business rows');
assert.ok(repository.includes(".rpc('ecoflow_read_comparison_candidates_v1'"), 'Repository must use governed RPC');
assert.ok(repository.includes("permission !== 'ALLOWED'"), 'Repository must fail closed on permission');
assert.ok(!repository.includes('.from('), 'Comparison repository must not read tables directly');
assert.ok(contract.includes("['CUSTOMER','COMMERCIAL_SKU','PHYSICAL_SKU','DELIVERY_RUN']"), 'Canonical comparison kinds missing');
assert.ok(!contract.includes("'PRODUCT'"), 'Ambiguous PRODUCT kind remains');
assert.ok(!contract.includes("permission ?? 'ALLOWED'"), 'Fail-open permission default remains');
assert.ok(contract.includes('CUSTOMER:2') && contract.includes('COMMERCIAL_SKU:2') && contract.includes('PHYSICAL_SKU:6') && contract.includes('DELIVERY_RUN:2'), 'Per-kind comparison limits missing');
assert.ok(panel.includes('comparisonRepository.readCandidates'), 'Panel does not read governed candidates');
assert.ok(panel.includes('Comparison Tray'), 'Comparison Tray is not restored');
assert.ok(!/Comparison entity ID|setEntityId\s*\(/.test(panel), 'Arbitrary comparison ID input returned');
assert.ok(!/permission\s*:\s*['"]ALLOWED['"]/.test(panel), 'Panel declares its own ALLOWED permission');
assert.ok(exportPanel.includes('comparisonTray.items.map'), 'Selected export must derive only stable selectors from governed tray');
assert.ok(exportRepository.includes("rpc('ecoflow_read_authoritative_export_v1'"), '008C export must remain behind its server authority');
for (const forbidden of ['tableExportRows','selectedRecordExportRows','chartExportRows','exportColumns']) assert.ok(!`${panel}\n${exportPanel}\n${exportRepository}`.includes(forbidden), `Unsafe browser export authority detected: ${forbidden}`);

for (const testFile of ['scripts/intel-comparison-candidate-contract.test.mjs','scripts/intel-personalisation-productivity-contract.test.mjs']) {
  const run = spawnSync(process.execPath, ['--experimental-strip-types','--test',testFile], { encoding:'utf8' });
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  assert.equal(run.status,0,`${testFile} failed`);
}

console.log('TRANSFORM-008B governed comparison audit passed.');
