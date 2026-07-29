import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`INTEL_FE_002B_FILE_MISSING: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

const component = read('src/features/intelligence/designSystem/primitives/CorePrimitives.tsx');
const contract = read('src/features/intelligence/designSystem/primitives/corePrimitiveContract.ts');
const css = read('src/features/intelligence/designSystem/primitives/corePrimitives.css');
const barrel = read('src/features/intelligence/designSystem/primitives/index.ts');
const test = read('scripts/intel-core-primitives-contract.test.mjs');
const packageJson = JSON.parse(read('package.json'));

const components = [
  'ControlButton',
  'ControlFieldFrame',
  'ControlInput',
  'ControlSelect',
  'ControlStatus',
  'ControlPanel',
  'ControlTabs',
  'ControlTooltip',
  'ControlSkeleton',
  'ControlBanner',
];

for (const name of components) {
  if (!component.includes(`export ${name === 'ControlButton' || name === 'ControlInput' || name === 'ControlSelect' ? 'const' : 'function'} ${name}`)
    && !component.includes(`export const ${name}`)) {
    throw new Error(`INTEL_FE_002B_COMPONENT_MISSING: ${name}`);
  }
  if (!barrel.includes(name)) throw new Error(`INTEL_FE_002B_BARREL_EXPORT_MISSING: ${name}`);
}

for (const required of [
  'controlButtonVariants',
  'controlButtonSizes',
  'controlFieldDensities',
  'controlStatusTones',
  'controlPanelTones',
  'controlTabVariants',
  'controlTooltipPlacements',
  'controlSkeletonShapes',
]) {
  if (!contract.includes(required)) throw new Error(`INTEL_FE_002B_TYPED_CONTRACT_MISSING: ${required}`);
}

for (const required of [
  '.ef-control-button',
  '.ef-control-input-shell',
  '.ef-control-select-shell',
  '.ef-control-status',
  '.ef-control-panel',
  '.ef-control-tabs',
  '.ef-control-tooltip',
  '.ef-control-skeleton',
  '.ef-control-banner',
  '@media (prefers-reduced-motion: reduce)',
]) {
  if (!css.includes(required)) throw new Error(`INTEL_FE_002B_STYLE_CONTRACT_MISSING: ${required}`);
}

for (const token of [
  '--ef-focus-ring-color',
  '--ef-density-compact-row',
  '--ef-density-standard-row',
  '--ef-density-comfortable-row',
  '--ef-touch-target-min',
  '--ef-status-success-foreground',
  '--ef-status-warning-foreground',
  '--ef-status-danger-foreground',
  '--ef-status-information-foreground',
]) {
  if (!css.includes(`var(${token})`)) throw new Error(`INTEL_FE_002B_TOKEN_NOT_CONSUMED: ${token}`);
}

for (const banned of [
  'document.',
  'window.',
  'CustomEvent',
  'querySelector',
  'localStorage',
  'sessionStorage',
]) {
  if (component.includes(banned)) throw new Error(`INTEL_FE_002B_DOM_BRIDGE_FORBIDDEN: ${banned}`);
}

for (const banned of [
  '.desktop-',
  '.mobile-',
  '.ops-',
  '.warehouse-',
  '.driver-',
  '#root',
  '!important',
  'url(',
]) {
  if (css.includes(banned)) throw new Error(`INTEL_FE_002B_PAGE_SCOPE_EXPANSION: ${banned}`);
}

for (const phrase of [
  '>Loading<',
  '>Please ',
  '>Click ',
  '>Open ',
  '>Close<',
  '>Retry<',
  '>Learn more<',
  '>Need help<',
]) {
  if (component.includes(phrase)) throw new Error(`INTEL_FE_002B_DEFAULT_GUIDANCE_COPY_FORBIDDEN: ${phrase}`);
}

for (const testName of [
  'core primitive variants remain unique and bounded',
  'semantic status tones match the design token contract',
  'class composition omits false and empty modifiers',
]) {
  if (!test.includes(testName)) throw new Error(`INTEL_FE_002B_TEST_MISSING: ${testName}`);
}

const auditCommand = packageJson.scripts?.['audit:intel-frontend'];
if (typeof auditCommand !== 'string'
  || !auditCommand.includes('audit-intel-core-primitives.mjs')
  || !auditCommand.includes('intel-core-primitives-contract.test.mjs')) {
  throw new Error('INTEL_FE_002B_PACKAGE_AUDIT_WIRING_MISSING');
}

console.log('INTEL-FE-002B core primitive audit passed.');
