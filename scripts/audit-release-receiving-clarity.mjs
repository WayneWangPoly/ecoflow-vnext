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
  migration: fs.readFileSync('supabase/migrations/20260723090000_desktop_receiving_history.sql', 'utf8'),
};

const checks = [
  ['release step 1 remains visible', files.release.includes('1 · FIX BLOCKERS') && files.release.includes('1 · Fix blockers')],
  ['release step 2 remains visible', files.release.includes('2 · READY SHOWN') && files.release.includes('2 · Ready to release')],
  ['release step 3 remains visible', files.release.includes("3 · TODAY'S RUN")],
  ['diagnostics remain collapsible', files.release.includes('Show sync and gate diagnostics') && files.releaseCss.includes('release-diagnostics-open')],
  ['release layout uses CSS order without reparenting React panels', files.release.includes("classList.add('release-action-split')") && files.releaseCss.includes('display: contents !important') && !files.release.includes("syncPanel.insertAdjacentElement('afterend', exceptionPanel)")],
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
  ['desktop log uses role-gated batch RPC', files.history.includes("rpc('ecoflow_read_desktop_receiving_batches'")],
  ['desktop log uses role-gated movement RPC', files.history.includes("rpc('ecoflow_read_desktop_receiving_movements'")],
  ['desktop RPC roles are explicitly bounded', files.migration.includes("('OWNER','ADMIN','ACCOUNT','VIEWER')")],
  ['desktop history RPCs are read-only security definers', files.migration.includes('ecoflow_read_desktop_receiving_batches') && files.migration.includes('ecoflow_read_desktop_receiving_movements') && files.migration.match(/security definer/g)?.length >= 3],
  ['anonymous users cannot call receiving history RPCs', files.migration.includes('from public, anon') && files.migration.includes('to authenticated')],
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
