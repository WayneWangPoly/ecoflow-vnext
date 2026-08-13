import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => { assert.ok(fs.existsSync(path), `Missing ${path}`); return fs.readFileSync(path, 'utf8'); };
const migration = read('supabase/migrations/20260813200000_authoritative_export.sql');
const repository = read('src/data/repositories/authoritativeExport.ts');
const exportPanel = read('src/features/intelligence/analytics/productivity/AuthoritativeExportPanel.tsx');
const parentPanel = read('src/features/intelligence/analytics/productivity/PersonalisationProductivityPanel.tsx');

for (const marker of [
  'ecoflow_can_read_authoritative_export',
  'ecoflow_read_authoritative_export_v1',
  "('OWNER','ADMIN','ACCOUNT','VIEWER')",
  "('TABLE_VIEW','SELECTED_RECORDS','CHART_DATASET')",
  "'COMPARISON_CANDIDATES'",
  "'COMPARISON_SELECTION'",
  "'INITIAL_KPI_SHADOW'",
  'public.ecoflow_read_comparison_candidates_v1',
  'AUTHORITATIVE_EXPORT_SELECTOR_STALE_OR_FORBIDDEN',
  'analytics.get_initial_kpi_shadow_projection',
  "public.ecoflow_active_app_role() not in ('OWNER','ADMIN')",
  '(p_date_to-p_date_from)>366',
  'security definer',
  'set search_path=pg_catalog,public,analytics',
  'revoke all on function public.ecoflow_read_authoritative_export_v1',
  'grant execute on function public.ecoflow_read_authoritative_export_v1',
  'row_number() over(order by',
]) assert.ok(migration.toLowerCase().includes(marker.toLowerCase()), `008C migration marker missing: ${marker}`);

const executableSql = migration.replace(/--[^\n]*/g, '').replace(/comment on[\s\S]*?;/gi, '');
assert.ok(!/\b(insert|update|delete)\s+(into|public\.|analytics\.|from)\b/i.test(executableSql), '008C export boundary must not mutate business rows');
assert.ok(repository.includes("rpc('ecoflow_read_authoritative_export_v1'"), '008C repository must use authoritative RPC');
assert.ok(!repository.includes('.from('), '008C repository must not read business tables directly');
for (const marker of ['AUTHORITATIVE_EXPORT_ROW_LIMIT_EXCEEDED','AUTHORITATIVE_EXPORT_ENVELOPE_MISMATCH','4000',"/^[=+\\-@\\t\\r]/",'replace(/[^A-Za-z0-9._-]/g']) {
  assert.ok(repository.includes(marker), `008C repository hardening marker missing: ${marker}`);
}
for (const marker of ['INTEL-PER-004','TABLE_VIEW','SELECTED_RECORDS','CHART_DATASET','comparisonTray.items.map','Shadow metric export preserves the existing Owner/Admin analytics access boundary']) {
  assert.ok(exportPanel.includes(marker), `008C presentation marker missing: ${marker}`);
}
assert.ok(parentPanel.includes('<AuthoritativeExportPanel'), '008C export panel is not mounted in productivity workspace');
assert.ok(!/permission\s*:\s*['"]ALLOWED['"]/.test(`${exportPanel}\n${parentPanel}`), 'Browser-authored ALLOWED permission detected');
assert.ok(!/Comparison entity ID|setEntityId\s*\(/.test(`${exportPanel}\n${parentPanel}`), 'Arbitrary entity ID input detected');
for (const forbidden of ['tableExportRows','selectedRecordExportRows','chartExportRows','exportColumns']) {
  assert.ok(!`${repository}\n${exportPanel}\n${parentPanel}`.includes(forbidden), `Browser row export authority detected: ${forbidden}`);
}
assert.ok(!/buildCsvExport\s*\(/.test(exportPanel), 'Dormant browser-row CSV builder must not become current-data authority');

console.log('TRANSFORM-008C authoritative export audit passed.');
console.log('- Table export re-runs governed server queries.');
console.log('- Selected export re-resolves stable selectors server-side.');
console.log('- Chart export re-runs approved shadow metric authority with its Owner/Admin boundary.');
