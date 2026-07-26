import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260726190000_ordermentum_packaging_signals.sql', 'utf8');
const component = fs.readFileSync('src/FirstStocktakePackagingSignal.tsx', 'utf8');
const repository = fs.readFileSync('src/data/repositories/stocktakePackagingSignals.ts', 'utf8');

const checks = [
  ['mixed classification', migration.includes("MIXED_CARTON_SLEEVE")],
  ['carton-only classification', migration.includes("CARTON_ONLY_EVIDENCE")],
  ['sleeve-only classification', migration.includes("SLEEVE_ONLY_EVIDENCE")],
  ['ambiguous unit protection', migration.includes("AMBIGUOUS")],
  ['read-only view source', migration.includes('v_ecoflow_ordermentum_order_lines')],
  ['authenticated read grant', migration.includes('grant select') && migration.includes('authenticated')],
  ['no inventory mutation', !/insert\s+into\s+public\.(inventory|warehouse_location_items|ecoflow_inventory_ledger)/i.test(migration)],
  ['repository reads evidence view', repository.includes("v_ecoflow_ordermentum_packaging_signals")],
  ['sealed-carton instruction', component.includes('Keep the carton sealed')],
  ['single representative opening', component.includes('Open only one representative carton')],
  ['physical truth disclaimer', component.includes('physical product label')],
];

const failed = checks.filter(([, passed]) => !passed);
for (const [name, passed] of checks) console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
if (failed.length) process.exit(1);
