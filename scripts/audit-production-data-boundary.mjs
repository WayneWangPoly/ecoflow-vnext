import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (file) => fs.readFileSync(file, 'utf8');
const app = read('src/app/App.tsx');
const repository = read('src/data/repositories/ordermentumRepository.ts');
const sampleRepository = read('src/data/repositories/sampleOrdermentumRepository.ts');
const snapshot = read('src/data/ordermentumSnapshot.ts');
const ecoflowData = read('src/domain/ecoflowData.ts');
const ownerTracking = read('src/OwnerDriverTrackingMap.tsx');
const ownerGovernance = read('src/OwnerDeliveryGovernance.tsx');

assert.doesNotMatch(
  repository,
  /ordermentumSnapshot|createSampleOrdermentumRepository|activeOrdermentumRepository/,
  'The provider-neutral repository contract must not import or construct a sample fixture.',
);
assert.doesNotMatch(
  repository,
  /typeof\s+ordermentumSnapshot/,
  'The repository contract must use a structural snapshot type, not typeof a concrete fixture.',
);
assert.match(
  snapshot,
  /satisfies\s+OrdermentumSnapshot/,
  'The synthetic fixture must be checked against the provider-neutral structural type.',
);
assert.match(
  sampleRepository,
  /ordermentumSnapshot/,
  'The isolated development repository must remain able to load the synthetic fixture.',
);
assert.doesNotMatch(
  ecoflowData,
  /activeOrdermentumRepository|=\s*activeOrdermentumRepository/,
  'The data transformer must not have an implicit active sample repository.',
);

for (const [file, source] of [
  ['src/OwnerDriverTrackingMap.tsx', ownerTracking],
  ['src/OwnerDeliveryGovernance.tsx', ownerGovernance],
]) {
  assert.doesNotMatch(
    source,
    /buildEcoFlowData|ordermentumSnapshot|sampleOrdermentumRepository|sampleEcoflowData/,
    `${file} must use only live or production-empty data.`,
  );
}

assert.doesNotMatch(
  app,
  /^import\s+.*(?:sampleEcoflowData|ordermentumSnapshot|sampleOrdermentumRepository).*$/m,
  'App must not statically import the sample-data graph.',
);
assert.match(
  app,
  /if\s*\(!import\.meta\.env\.DEV\)\s+return;[\s\S]{0,220}import\(['"]@\/domain\/sampleEcoflowData['"]\)/,
  'The development sample must be loaded only behind the compile-time DEV boundary.',
);
assert.match(
  app,
  /resolveTrustedLiveSnapshot\(trustedLiveDataRef\.current,\s*null,/,
  'Production refresh failure must resolve to last-trusted live data or unavailable.',
);
assert.match(
  ownerTracking,
  /resolveTrustedLiveSnapshot\(base,\s*candidate,\s*tick\)/,
  'Owner tracking must resolve only fresh or last-trusted live data.',
);

assert.ok(fs.existsSync('dist'), 'Production dist is missing; run npm run build before this audit.');

function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(target) : [target];
  });
}

const artifactFiles = listFiles('dist');
assert.ok(artifactFiles.some((file) => file.endsWith('.js')), 'Production dist contains no JavaScript artifacts.');
const artifacts = artifactFiles
  .filter((file) => /\.(?:html|js|json|map|css|svg)$/i.test(file))
  .map((file) => `${file}\n${read(file)}`)
  .join('\n');

const forbiddenCanaries = [
  'SYNTHETIC_ONLY',
  'DEMO-ORDER-',
  'Demo Packaging Item',
  'Demo Packaging Variant',
  'Demo Store',
  'synthetic-ordermentum-fixture',
  'sample-snapshot',
  'Synthetic account terms',
  'clearly marked synthetic receiving entrance',
];

for (const canary of forbiddenCanaries) {
  assert.ok(
    !artifacts.includes(canary),
    `Production dist contains the synthetic fixture/sample fallback canary: ${canary}`,
  );
}

console.log(`Production data-boundary audit passed across ${artifactFiles.length} build artifacts.`);
