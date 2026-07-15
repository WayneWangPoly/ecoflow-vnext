import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260714013000_ordermentum_complete_mirror_v1.sql', 'utf8');
const mirrorWorkflow = fs.readFileSync('.github/workflows/ordermentum-complete-mirror.yml', 'utf8');
const repairScript = fs.readFileSync('scripts/apply-supabase-migration-ordering-fix.mjs', 'utf8');

assert.ok(!migration.includes('select public.ecoflow_project_ordermentum_raw_invoices(10000);'), 'Schema migration must not project 10,000 invoices inside one transaction.');
assert.ok(!migration.includes('select public.ecoflow_refresh_ui_active_order_keys();'), 'Schema migration must not execute runtime active-key refresh.');
assert.ok(mirrorWorkflow.includes('workflow_run:'), 'Complete mirror must wait for the Supabase deployment workflow.');
assert.ok(mirrorWorkflow.includes('Deploy Supabase migrations'), 'Complete mirror must depend on the production migration workflow.');
assert.ok(mirrorWorkflow.includes("github.event.workflow_run.conclusion == 'success'"), 'Failed Supabase deployment must not start the complete mirror.');
assert.ok(!mirrorWorkflow.includes('Allow production migration to settle'), 'Fixed sleep is not a deployment dependency.');
assert.ok(!repairScript.includes("const workflowPath = '.github/workflows/ordermentum-complete-mirror.yml'"), 'One-shot Action must not attempt to push workflow changes.');

console.log('Supabase deployment ordering contract passed.');
