#!/usr/bin/env node
import fs from 'node:fs';

function replaceExactly(path, before, after) {
  const source = fs.readFileSync(path, 'utf8');
  if (source.includes(after)) return false;
  if (!source.includes(before)) {
    throw new Error(`${path}: expected block not found:\n${before}`);
  }
  fs.writeFileSync(path, source.replace(before, after));
  return true;
}

const migrationPath = 'supabase/migrations/20260714013000_ordermentum_complete_mirror_v1.sql';
const changed = replaceExactly(
  migrationPath,
  `select public.ecoflow_project_ordermentum_raw_invoices(10000);\nselect public.ecoflow_refresh_ui_active_order_keys();\n\nnotify pgrst, 'reload schema';`,
  `-- Data projection and active-key refresh are intentionally executed by the\n-- post-deployment complete-mirror workflow in bounded RPC batches. Running them\n-- inside the migration transaction exceeds production statement_timeout and can\n-- invoke a superseded refresh function before later corrective migrations apply.\n\nnotify pgrst, 'reload schema';`,
);

console.log(JSON.stringify({
  action: 'apply_supabase_migration_ordering_fix',
  changed: changed ? [migrationPath] : [],
}, null, 2));
