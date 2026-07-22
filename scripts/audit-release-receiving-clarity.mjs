import fs from 'node:fs';

const files = {
  release: fs.readFileSync('src/ReleaseOperationsEnhancer.tsx', 'utf8'),
  releaseCss: fs.readFileSync('src/releaseOperationsEnhancer.css', 'utf8'),
  history: fs.readFileSync('src/DesktopReceivingHistory.tsx', 'utf8'),
  owner: fs.readFileSync('src/enhancers/OwnerEnhancers.tsx', 'utf8'),
  account: fs.readFileSync('src/enhancers/AccountEnhancers.tsx', 'utf8'),
  viewer: fs.readFileSync('src/enhancers/ViewerEnhancers.tsx', 'utf8'),
  warehouse: fs.readFileSync('src/enhancers/WarehouseOpsEnhancers.tsx', 'utf8'),
  nativeReceiving: fs.readFileSync('src/WarehouseReceivingFlow.tsx', 'utf8'),
};

const checks = [
  ['release step 1 remains visible', files.release.includes('1 · FIX BLOCKERS') && files.release.includes('1 · Fix blockers')],
  ['release step 2 remains visible', files.release.includes('2 · READY SHOWN') && files.release.includes('2 · Ready to release')],
  ['release step 3 remains visible', files.release.includes("3 · TODAY'S RUN")],
  ['diagnostics remain collapsible', files.release.includes('Show sync and gate diagnostics') && files.releaseCss.includes('release-diagnostics-open')],
  ['blocker cards do not open duplicate work items', files.release.includes('event.stopPropagation()') && files.release.includes('release-blocker-card')],
  ['SKU mapping points to barcode setup', files.release.includes('/?workspace=warehouse&mode=barcode')],
  ['stock blockers point to Inventory', files.release.includes("destination: 'Inventory'")],
  ['payment blockers point to Accounts', files.release.includes("destination: 'Accounts'")],
  ['customer blockers point to Customers', files.release.includes("destination: 'Customers'")],
  ['no-document inbound gets an auditable reference', files.nativeReceiving.includes('UNREFERENCED-${date}-${time}')],
  ['docket is visibly optional', files.nativeReceiving.includes('Delivery docket / order ref (optional)')],
  ['unreferenced identity is generated before the controlled RPC', files.nativeReceiving.includes('resolveDelivery()') && files.nativeReceiving.includes('startStagedReceivingBatch({')],
  ['first scan can natively create an unreferenced batch', !files.nativeReceiving.includes('before the first scan') && files.nativeReceiving.includes('const batchId = await ensureBatch()')],
  ['native receiving idempotency remains intact', files.nativeReceiving.includes('idempotencyKey: crypto.randomUUID()') && files.nativeReceiving.includes('Complete batch and post stock')],
  ['unknown barcode quarantine remains intact', files.nativeReceiving.includes('stageUnknownBarcodeIntake') && files.nativeReceiving.includes('stock remains unchanged')],
  ['desktop log reads receiving batch source', files.history.includes("v_ecoflow_warehouse_receiving_batches")],
  ['desktop log reads posted movement source', files.history.includes('loadWarehouseReceivingMovements')],
  ['Owner/Admin receives desktop receiving history', files.owner.includes('<DesktopReceivingHistory />')],
  ['Account receives desktop receiving history', files.account.includes('<DesktopReceivingHistory />')],
  ['Viewer receives read-only desktop receiving history', files.viewer.includes('<DesktopReceivingHistory />')],
  ['Warehouse loads optional-document receiving presentation', files.warehouse.includes("import '../warehouseUnreferencedInbound.css'")],
];

let failures = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failures += 1;
}

console.log(`\n${checks.length - failures}/${checks.length} release/receiving clarity checks passed.`);
if (failures) process.exit(1);
