import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrationPath = 'supabase/migrations/20260727120450_restore_return_geofence_prerequisite.sql';
const driftFixturePath = 'scripts/legacy-return-four-arg-production-drift-fixture.sql';
const workflowPath = '.github/workflows/warehouse-productisation-check.yml';

const migration = fs.readFileSync(migrationPath, 'utf8');
const driftFixture = fs.readFileSync(driftFixturePath, 'utf8');
const workflow = fs.readFileSync(workflowPath, 'utf8');

const migrationChecks = [
  ['transaction boundary', /\bbegin;[\s\S]*\bcommit;\s*$/i],
  ['clear prerequisite error', /RETURN_GEOFENCE_PREREQUISITES_MISSING/],
  ['accepts legacy or geofence signature', /ecoflow_driver_drop_return\(uuid,text,text,text\)[\s\S]{0,400}double precision,double precision,numeric/],
  ['zone latitude column', /add column if not exists latitude double precision/],
  ['zone longitude column', /add column if not exists longitude double precision/],
  ['zone radius column', /add column if not exists radius_metres numeric not null default 500/],
  ['Adelaide returns coordinates', /-34\.8746[\s\S]{0,80}138\.5626/],
  ['exception latitude column', /driver_return_latitude double precision/],
  ['exception longitude column', /driver_return_longitude double precision/],
  ['exception accuracy column', /driver_return_accuracy_metres numeric/],
  ['exception distance column', /driver_return_distance_metres numeric/],
  ['legacy overload removed', /drop function if exists public\.ecoflow_driver_drop_return\(uuid,text,text,text\)/],
  ['seven-argument implementation', /create or replace function public\.ecoflow_driver_drop_return\([\s\S]{0,500}p_accuracy_metres numeric default null/],
  ['GPS required', /Phone location is required to confirm warehouse return/],
  ['accuracy threshold', /p_accuracy_metres > 200/],
  ['distance threshold', /v_distance > coalesce\(v_zone\.radius_metres, 500\)/],
  ['GPS values persisted', /driver_return_latitude = p_latitude[\s\S]{0,240}driver_return_distance_metres = round\(v_distance::numeric, 1\)/],
  ['PostgreSQL-safe format tokens', /GPS %s m from zone; accuracy %s m/],
  ['public and anon revoked', /revoke all on function public\.ecoflow_driver_drop_return\([\s\S]{0,180}from public, anon, authenticated/],
  ['authenticated compatibility grant', /grant execute on function public\.ecoflow_driver_drop_return\([\s\S]{0,180}to authenticated/],
  ['schema reload', /notify pgrst, 'reload schema'/],
];

for (const [name, pattern] of migrationChecks) {
  assert.match(migration, pattern, `Return geofence prerequisite audit failed: ${name}`);
}

const forbidden = [
  ['no printf float formatter in SQL', /format\(\s*['"][^'"]*%\.\d+f/i],
  ['no anon execute grant', /grant execute[\s\S]{0,180}\bto\s+anon\b/i],
  ['no edit to SEC implementation name', /_acl_impl/],
  ['no direct inventory mutation', /\becoflow_inventory_movements\b/i],
];

for (const [name, pattern] of forbidden) {
  assert.doesNotMatch(migration, pattern, `Return geofence prerequisite audit failed: ${name}`);
}

const fixtureChecks = [
  ['drops seven-argument function', /drop function if exists public\.ecoflow_driver_drop_return\([\s\S]{0,120}double precision,double precision,numeric/],
  ['recreates four-argument function', /create or replace function public\.ecoflow_driver_drop_return\([\s\S]{0,180}p_driver text default null/],
  ['asserts four-argument signature', /four-argument production drift fixture was not created/],
  ['asserts seven-argument absence', /seven-argument geofence function still exists in drift fixture/],
];

for (const [name, pattern] of fixtureChecks) {
  assert.match(driftFixture, pattern, `Return drift fixture audit failed: ${name}`);
}

const driftIndex = workflow.indexOf('scripts/legacy-return-four-arg-production-drift-fixture.sql');
const prerequisiteIndex = workflow.indexOf('20260727120450_restore_return_geofence_prerequisite.sql');
const securityIndex = workflow.indexOf('20260727120500_legacy_returns_acl_hardening.sql');

assert.ok(driftIndex >= 0, 'CI does not reproduce the four-argument production drift');
assert.ok(prerequisiteIndex >= 0, 'CI does not apply the geofence prerequisite migration');
assert.ok(securityIndex >= 0, 'CI does not apply SEC-DB-002');
assert.ok(
  driftIndex < prerequisiteIndex && prerequisiteIndex < securityIndex,
  'CI order must be drift fixture -> geofence prerequisite -> SEC-DB-002'
);

console.log(
  `Return geofence prerequisite static audit passed (${migrationChecks.length + forbidden.length + fixtureChecks.length + 4}/${migrationChecks.length + forbidden.length + fixtureChecks.length + 4}).`
);
