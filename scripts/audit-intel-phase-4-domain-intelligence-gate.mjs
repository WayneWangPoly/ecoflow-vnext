import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  assert.ok(fs.existsSync(path), `Phase 4 gate prerequisite missing: ${path}`);
  return fs.readFileSync(path, 'utf8');
}

const root = 'src/features/intelligence/analytics/domainIntelligence';
const contract = read(`${root}/domainIntelligenceContract.ts`);
const factory = read(`${root}/domainManifestFactory.ts`);
const registry = read(`${root}/domainRegistry.ts`);
const panel = read(`${root}/Phase4DomainIntelligencePanel.tsx`);
const style = read(`${root}/phase4DomainIntelligenceWorkspace.css`);
const workspace = read('src/features/intelligence/analytics/OperationalPulseReadinessWorkspace.tsx');
const documentation = read('docs/INTEL-PHASE-4-DOMAIN-INTELLIGENCE.md');

const domains = [
  { id: 'inventory', symbol: 'inventoryDomainManifest', file: 'inventoryDomainManifest.ts', path: '/inventory' },
  { id: 'orders', symbol: 'ordersDomainManifest', file: 'ordersDomainManifest.ts', path: '/orders' },
  { id: 'customers', symbol: 'customersDomainManifest', file: 'customersDomainManifest.ts', path: '/customers' },
  { id: 'delivery', symbol: 'deliveryDomainManifest', file: 'deliveryDomainManifest.ts', path: '/delivery' },
  { id: 'returns', symbol: 'returnsDomainManifest', file: 'returnsDomainManifest.ts', path: '/returns' },
  { id: 'data-quality', symbol: 'dataQualityDomainManifest', file: 'dataQualityDomainManifest.ts', path: '/analytics' },
];

const capabilities = [
  'OVERVIEW',
  'FILTERS',
  'TREND',
  'BREAKDOWN',
  'TABLE',
  'DETAIL_DRAWER',
  'TIMELINE',
  'FRESHNESS',
  'EMPTY_DEGRADED_STATES',
  'OPERATIONAL_HANDOFF',
];

for (const domain of domains) {
  assert.ok(contract.includes(`'${domain.id}'`), `Phase 4 domain contract missing: ${domain.id}`);
  assert.ok(registry.includes(`import { ${domain.symbol} } from './${domain.file.replace('.ts', '')}';`), `Phase 4 registry import missing: ${domain.id}`);
  assert.ok(registry.includes(`  ${domain.symbol},`), `Phase 4 registry entry missing: ${domain.id}`);
  const manifest = read(`${root}/${domain.file}`);
  assert.ok(manifest.includes(`id: '${domain.id}'`), `Phase 4 manifest identity missing: ${domain.id}`);
  assert.ok(manifest.includes(`primaryPath: '${domain.path}'`), `Phase 4 canonical path missing: ${domain.id}`);
  assert.ok(manifest.includes("implementation: 'READY'") || manifest.includes('createPhase4Capabilities({'), `Phase 4 implementation evidence missing: ${domain.id}`);
  assert.ok(manifest.includes('breakdowns:'), `Phase 4 breakdown missing: ${domain.id}`);
  assert.ok(manifest.includes('trends:'), `Phase 4 trend missing: ${domain.id}`);
  assert.ok(manifest.includes('tables:'), `Phase 4 table missing: ${domain.id}`);
  assert.ok(manifest.includes('handoffs:'), `Phase 4 handoff missing: ${domain.id}`);
  assert.ok(manifest.includes('timeline:'), `Phase 4 timeline missing: ${domain.id}`);
  assert.ok(manifest.includes('freshness:'), `Phase 4 freshness missing: ${domain.id}`);
  for (const forbidden of [/\?\?\s*0/, /\|\|\s*0/, /Number\([^)]*\)\s*\|\|/, /parseFloat\([^)]*\)\s*\|\|/]) {
    assert.ok(!forbidden.test(manifest), `Phase 4 manifest silently converts missing evidence to zero: ${domain.id}`);
  }
}

const registryPositions = domains.map((domain) => registry.indexOf(`  ${domain.symbol},`));
assert.deepEqual([...registryPositions].sort((a, b) => a - b), registryPositions, 'Phase 4 domains are not registered in roadmap order');
assert.equal(new Set(registryPositions).size, 6, 'Phase 4 registry must contain six unique domains');

for (const capability of capabilities) {
  assert.ok(contract.includes(`'${capability}'`), `Phase 4 capability contract missing: ${capability}`);
}
assert.equal((contract.match(/^  '[A-Z_]+'[,]?$/gm) ?? []).filter((line) => capabilities.some((key) => line.includes(`'${key}'`))).length, 10, 'Phase 4 capability contract must contain ten governed surfaces');
assert.ok(factory.includes("implementation: 'READY'"), 'Phase 4 factory must publish READY implementation state');
assert.ok(factory.includes('phase4SurfaceCapabilities.map'), 'Phase 4 factory must derive every canonical capability');

for (const marker of [
  'Operational domain review surfaces',
  'All capabilities',
  'Governed time series',
  'Governed dimensions',
  'TABLE CONTRACTS',
  'DETAIL DRAWER',
  'TIMELINE',
  'FRESHNESS',
  'OPERATIONAL HANDOFF',
  'Manifest contract invalid',
  'No domain manifest is available.',
  'Missing evidence never becomes zero.',
]) {
  assert.ok(panel.includes(marker), `Phase 4 presentation marker missing: ${marker}`);
}
assert.ok(workspace.includes('<Phase4DomainIntelligencePanel />'), 'Phase 4 domain panel is not mounted in Analytics');
assert.ok(panel.includes('coverage.domainCount} / 6'), 'Phase 4 domain completion count is missing');
assert.ok(panel.includes('coverage.capabilityReady} / {coverage.capabilityTotal'), 'Phase 4 capability completion count is missing');

for (const marker of ['@media (max-width: 1100px)', '@media (max-width: 820px)', '@media (max-width: 560px)', '@media (prefers-reduced-motion: reduce)']) {
  assert.ok(style.includes(marker), `Phase 4 responsive/accessibility marker missing: ${marker}`);
}
for (const forbidden of ['!important', '@font-face', 'url(', '#root']) {
  assert.ok(!style.includes(forbidden), `Phase 4 style scope expansion: ${forbidden}`);
}

const inventory = read(`${root}/inventoryDomainManifest.ts`);
for (const marker of ['Commercial SKU', 'Physical SKU', 'global/base', 'location/package', 'supplier', 'brand', 'substitution', 'stockout']) {
  assert.ok(inventory.includes(marker), `Inventory Intelligence evidence missing: ${marker}`);
}
const orders = read(`${root}/ordersDomainManifest.ts`);
for (const marker of ['Order pipeline', 'release blockers', 'partial fulfilment', 'Fill rate', 'Commercial SKU', 'Physical SKU', 'payment']) {
  assert.ok(orders.includes(marker), `Orders Intelligence evidence missing: ${marker}`);
}
const customers = read(`${root}/customersDomainManifest.ts`);
for (const marker of ['Customer', 'Store', 'Revenue trend', 'Margin trend', 'pricing tier', 'payment exposure', 'concentration']) {
  assert.ok(customers.includes(marker), `Customer Intelligence evidence missing: ${marker}`);
}
const delivery = read(`${root}/deliveryDomainManifest.ts`);
for (const marker of ['Run status', 'sequence', 'Planned vs actual', 'Time per stop', 'Late stop', 'POD', 'failed delivery']) {
  assert.ok(delivery.includes(marker), `Delivery Intelligence evidence missing: ${marker}`);
}
const returns = read(`${root}/returnsDomainManifest.ts`);
for (const marker of ['Return reason', 'inspection', 'Resale / scrap', 'processing age', 'Financial impact', 'Recurring pattern']) {
  assert.ok(returns.includes(marker), `Returns Intelligence evidence missing: ${marker}`);
}
const dataQuality = read(`${root}/dataQualityDomainManifest.ts`);
for (const marker of ['Sync health', 'stale source', 'missing invoice', 'mapping', 'cost', 'Barcode', 'unavailable metric', 'snapshot refresh', 'never becomes numeric zero']) {
  assert.ok(dataQuality.toLowerCase().includes(marker.toLowerCase()), `Data Quality Intelligence evidence missing: ${marker}`);
}

for (const marker of ['6 domains', '60 / 60', 'missing evidence', 'canonical handoff', 'Commercial SKU', 'Physical SKU']) {
  assert.ok(documentation.toLowerCase().includes(marker.toLowerCase()), `Phase 4 documentation marker missing: ${marker}`);
}

console.log('INTEL-GATE-004 Phase 4 Domain Intelligence completion gate passed: 6 domains, 60/60 surface capabilities.');
