#!/usr/bin/env node
import fs from 'node:fs';

// One-shot main-branch repair. The script removes itself after committing the corrected release files.
function replaceExactly(path, before, after) {
  const source = fs.readFileSync(path, 'utf8');
  if (source.includes(after)) return false;
  if (!source.includes(before)) {
    throw new Error(`${path}: expected block not found:\n${before}`);
  }
  fs.writeFileSync(path, source.replace(before, after));
  return true;
}

const changed = [];

const migrationPath = 'supabase/migrations/20260714013000_ordermentum_complete_mirror_v1.sql';
if (replaceExactly(
  migrationPath,
  `select public.ecoflow_project_ordermentum_raw_invoices(10000);\nselect public.ecoflow_refresh_ui_active_order_keys();\n\nnotify pgrst, 'reload schema';`,
  `-- Data projection and active-key refresh are intentionally executed by the\n-- post-deployment complete-mirror workflow in bounded RPC batches. Running them\n-- inside the migration transaction exceeds production statement_timeout and can\n-- invoke a superseded refresh function before later corrective migrations apply.\n\nnotify pgrst, 'reload schema';`,
)) changed.push(migrationPath);

const workflowPath = '.github/workflows/ordermentum-complete-mirror.yml';
if (replaceExactly(
  workflowPath,
  `  push:\n    branches: [main]\n    paths:\n      - 'ops/ordermentum-complete-mirror-v1.md'\n      - 'ops/commercial-source-boundary-v1.md'`,
  `  workflow_run:\n    workflows: ["Deploy Supabase migrations"]\n    types: [completed]`,
)) changed.push(workflowPath);

if (replaceExactly(
  workflowPath,
  `  complete-mirror:\n    runs-on: ubuntu-latest`,
  `  complete-mirror:\n    if: github.event_name != 'workflow_run' || github.event.workflow_run.conclusion == 'success'\n    runs-on: ubuntu-latest`,
)) changed.push(workflowPath);

if (replaceExactly(
  workflowPath,
  `          if [ "\${{ github.event_name }}" = "push" ]; then\n            echo "MIRROR_SCOPE=full_history" >> "$GITHUB_ENV"\n            echo "MIRROR_REASON=Commercial source boundary release" >> "$GITHUB_ENV"`,
  `          if [ "\${{ github.event_name }}" = "workflow_run" ]; then\n            echo "MIRROR_SCOPE=full_history" >> "$GITHUB_ENV"\n            echo "MIRROR_REASON=Supabase production migrations completed successfully" >> "$GITHUB_ENV"`,
)) changed.push(workflowPath);

if (replaceExactly(
  workflowPath,
  `\n      - name: Allow production migration to settle\n        if: github.event_name == 'push'\n        run: sleep 120\n`,
  `\n`,
)) changed.push(workflowPath);

const self = 'scripts/apply-supabase-migration-ordering-fix.mjs';
const oneShotWorkflow = '.github/workflows/apply-supabase-migration-ordering-fix.yml';
if (fs.existsSync(self)) fs.unlinkSync(self);
if (fs.existsSync(oneShotWorkflow)) fs.unlinkSync(oneShotWorkflow);

console.log(JSON.stringify({
  action: 'apply_supabase_migration_ordering_fix',
  changed: [...new Set(changed)],
}, null, 2));
