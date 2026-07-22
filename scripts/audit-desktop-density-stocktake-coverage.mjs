import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const files = {
  desktop: read('src/desktopYoungDensity.css'),
  receiving: read('src/DesktopReceivingHistory.tsx'),
  stocktake: read('src/FirstStocktakeFlow.tsx'),
  coverageCss: read('src/firstStocktakeCoverage.css'),
  owner: read('src/enhancers/OwnerEnhancers.tsx'),
  account: read('src/enhancers/AccountEnhancers.tsx'),
  viewer: read('src/enhancers/ViewerEnhancers.tsx'),
};

const checks = [
  ['desktop sidebar is narrower', files.desktop.includes('grid-template-columns: 176px minmax(0, 1fr)')],
  ['sidebar retains restrained youthful accent', files.desktop.includes('radial-gradient') && files.desktop.includes('#65dda5')],
  ['customer rows allow real three-line identity height', files.desktop.includes('.owner-store-row') && files.desktop.includes('min-height: 62px')],
  ['accounts rows use a narrow-panel container layout', files.desktop.includes('@container (max-width: 650px)') && files.desktop.includes('grid-template-areas')],
  ['receiving log mounts in sidebar navigation', files.receiving.includes("document.querySelector<HTMLElement>('.sidebar-nav')")],
  ['receiving log anchors to warehouse inventory or stock', files.receiving.includes("label.includes('WAREHOUSE')") && files.receiving.includes("label.includes('INVENTORY')")],
  ['receiving log no longer chooses topbar as its host', !files.receiving.includes("const topbar = document.querySelector")],
  ['desktop polish loads for Owner Account and Viewer', [files.owner, files.account, files.viewer].every((source) => source.includes("import '../desktopYoungDensity.css'"))],
  ['stocktake coverage distinguishes missing live stock', files.stocktake.includes('system stock not found') && files.stocktake.includes('missingLive')],
  ['stocktake coverage distinguishes ordered catalog SKUs', files.stocktake.includes('ordered SKU not found') && files.stocktake.includes('missingWithOrders')],
  ['missing SKU is explicitly not auto-zeroed', files.stocktake.includes('Missing does not mean zero or retired.') && files.stocktake.includes('not automatically zeroed')],
  ['coverage confirmation is required before post', files.stocktake.includes('!coverageAcknowledged') && files.stocktake.includes('physical-location coverage declaration')],
  ['new stocktake lines revoke prior coverage confirmation', files.stocktake.includes('setCoverageAcknowledged(false)') && files.stocktake.includes('removeItem(coverageKey(batchId))')],
  ['coverage review has responsive warehouse styling', files.coverageCss.includes('.first-stocktake-coverage-review') && files.coverageCss.includes('@media (max-width: 720px)')],
];

let failures = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failures += 1;
}
console.log(`\n${checks.length - failures}/${checks.length} desktop density and stocktake coverage checks passed.`);
if (failures) process.exit(1);
