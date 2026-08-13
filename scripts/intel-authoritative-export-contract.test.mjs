import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync('supabase/migrations/20260813200000_authoritative_export.sql', 'utf8');
const repository = fs.readFileSync('src/data/repositories/authoritativeExport.ts', 'utf8');
const panel = fs.readFileSync('src/features/intelligence/analytics/productivity/AuthoritativeExportPanel.tsx', 'utf8');

test('table export sends a governed query rather than browser rows', () => {
  assert.match(migration, /v_export_kind='TABLE_VIEW'/);
  assert.match(migration, /public\.ecoflow_read_comparison_candidates_v1/);
  assert.match(repository, /mode: 'TABLE_VIEW'/);
  assert.doesNotMatch(repository, /tableExportRows|rows:\s*request\./);
});

test('selected export accepts stable selectors and re-resolves authority', () => {
  assert.match(migration, /jsonb_array_length\(p_selectors\)>8/);
  assert.match(migration, /AUTHORITATIVE_EXPORT_SELECTOR_STALE_OR_FORBIDDEN/);
  assert.match(migration, /l\.identity_status='ACTIVE'/);
  assert.match(migration, /p\.identity_status='ACTIVE'/);
  assert.match(migration, /r\.route_status='LOCKED'/);
  assert.match(panel, /comparisonTray\.items\.map/);
  assert.doesNotMatch(panel, /candidate\.context|candidate\.label.*export/i);
});

test('chart export preserves the governed shadow metric boundary', () => {
  assert.match(migration, /v_metric_key not in \('fill_rate','substitution_rate'\)/);
  assert.match(migration, /analytics\.get_initial_kpi_shadow_projection/);
  assert.match(migration, /ecoflow_active_app_role\(\) not in \('OWNER','ADMIN'\)/);
  assert.match(migration, /\(p_date_to-p_date_from\)>366/);
});

test('CSV serialization is deterministic and spreadsheet-safe', () => {
  assert.match(repository, /rows\.sort\(\(a, b\) => a\.rowIndex - b\.rowIndex\)/);
  assert.match(repository, /AUTHORITATIVE_EXPORT_ENVELOPE_MISMATCH/);
  assert.match(repository, /\/\^\[=\+\\-@\\t\\r\]\//);
  assert.match(repository, /slice\(0, 4000\)/);
  assert.match(repository, /replace\(\/\[\^A-Za-z0-9\._-\]\/g, '-'\)/);
});

test('repository remains RPC-only and browser rows are not request authority', () => {
  assert.match(repository, /rpc\('ecoflow_read_authoritative_export_v1'/);
  assert.doesNotMatch(repository, /\.from\(/);
  assert.doesNotMatch(repository, /selectedRecordExportRows|chartExportRows|exportColumns/);
});
