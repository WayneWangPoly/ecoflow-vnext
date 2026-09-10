import fs from 'node:fs';
import path from 'node:path';

const inventory = JSON.parse(fs.readFileSync('docs/engineering/evidence/ordermentum-359-c-callers.inventory', 'utf8'));
const roots = ['scripts', '.github/workflows', 'supabase/functions'];
const pattern = /api\.ordermentum\.com|app\.ordermentum\.com|\/v1\/auth|ORDERMENTUM_USERNAME|ORDERMENTUM_API_KEY/;
const ignored = /\.test\.mjs$|audit-ordermentum-359-c-callers\.mjs$/;

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.posix.join(directory, entry.name);
    return entry.isDirectory() ? walk(candidate) : [candidate];
  });
}

const discovered = roots.flatMap(walk).filter((file) => !ignored.test(file) && pattern.test(fs.readFileSync(file, 'utf8'))).sort();
const classified = Object.keys(inventory.callers).sort();
const missing = discovered.filter((file) => !classified.includes(file));
const missingFiles = classified.filter((file) => !fs.existsSync(file));
if (inventory.baseline !== 'ce6358ceeadb143c4cd5eaad4d7f234112160c7d' || missing.length || missingFiles.length) {
  throw new Error(JSON.stringify({ inventory: 'HOLD', unclassified_direct: missing, missing_files: missingFiles }));
}

const activeLegacy = classified.filter((file) => /legacy/.test(inventory.callers[file]));
if (!activeLegacy.includes('scripts/ordermentum-sync-now-legacy.mjs')) throw new Error('Pre-D legacy surface was incorrectly retired.');
process.stdout.write(`${JSON.stringify({ inventory: 'PASS', classified: classified.length, direct_transport_surfaces: discovered.length, active_legacy_expected_pre_d: activeLegacy.length, retirement: 'HOLD' })}\n`);
