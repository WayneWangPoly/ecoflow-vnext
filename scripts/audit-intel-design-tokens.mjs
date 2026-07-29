import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`INTEL_FE_002A_FILE_MISSING: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

const css = read('src/features/intelligence/designSystem/tokens.css');
const contract = read('src/features/intelligence/designSystem/designTokenContract.ts');
const main = read('src/main.tsx');
const test = read('scripts/intel-design-token-contract.test.mjs');
const packageJson = JSON.parse(read('package.json'));

for (const group of ['space', 'radius', 'elevation', 'surface', 'status', 'type', 'motion', 'focus', 'density']) {
  if (!css.includes(`--ef-${group}-`)) throw new Error(`INTEL_FE_002A_TOKEN_GROUP_MISSING: ${group}`);
}

for (const status of ['success', 'warning', 'danger', 'information', 'neutral']) {
  if (!css.includes(`--ef-status-${status}-foreground`)
    || !css.includes(`--ef-status-${status}-background`)) {
    throw new Error(`INTEL_FE_002A_STATUS_TOKEN_MISSING: ${status}`);
  }
}

for (const required of [
  '--ef-density-compact-row',
  '--ef-density-standard-row',
  '--ef-density-comfortable-row',
  '--ef-touch-target-min',
  '@media (prefers-reduced-motion: reduce)',
]) {
  if (!css.includes(required)) throw new Error(`INTEL_FE_002A_CSS_CONTRACT_MISSING: ${required}`);
}

for (const banned of ['content:', 'url(', '!important', '.desktop-', '.mobile-', '.ops-', '#root']) {
  if (css.includes(banned)) throw new Error(`INTEL_FE_002A_VISUAL_SCOPE_EXPANSION: ${banned}`);
}

if (!main.includes("import './features/intelligence/designSystem/tokens.css';")) {
  throw new Error('INTEL_FE_002A_GLOBAL_TOKEN_IMPORT_MISSING');
}
if (!contract.includes('intelligenceDesignTokenContract')
  || !contract.includes('intelligenceDensityModes')
  || !contract.includes('intelligenceStatusTones')) {
  throw new Error('INTEL_FE_002A_TYPED_CONTRACT_MISSING');
}
for (const testName of [
  'design token groups expose unique CSS custom properties',
  'status tones remain semantic and bounded',
  'density modes remain bounded',
]) {
  if (!test.includes(testName)) throw new Error(`INTEL_FE_002A_TEST_MISSING: ${testName}`);
}

const auditCommand = packageJson.scripts?.['audit:intel-frontend'];
if (typeof auditCommand !== 'string'
  || !auditCommand.includes('audit-intel-design-tokens.mjs')
  || !auditCommand.includes('intel-design-token-contract.test.mjs')) {
  throw new Error('INTEL_FE_002A_PACKAGE_AUDIT_WIRING_MISSING');
}

console.log('INTEL-FE-002A design token audit passed.');
