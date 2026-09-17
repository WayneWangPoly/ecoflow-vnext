import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const clientPath = 'src/features/team/readyPositiveStockCommissioning.ts';
const panelPath = 'src/features/settings/ReadyPositiveStockCommissioningPanel.tsx';
const hostPath = 'src/features/settings/InventoryReferenceStagePanel.tsx';

const client = readFileSync(clientPath, 'utf8');
const panel = readFileSync(panelPath, 'utf8');
const host = readFileSync(hostPath, 'utf8');

test('R5-005B freezes only the two positive-stock READY candidates', () => {
  assert.match(client, /'R-360Y'[\s\S]*sourceQtyOnHand:\s*3/);
  assert.match(client, /'SB24\/32\/40LBOX'[\s\S]*sourceQtyOnHand:\s*5/);
  assert.match(client, /referenceRowId:\s*'2a710fa3-0467-4c05-9317-033fb863815e'/);
  assert.match(client, /referenceRowId:\s*'44aca94f-bb82-457d-9998-c397b687140a'/);
  assert.match(client, /R5_005B_REFERENCE_BATCH_ID\s*=\s*'4cdb85d3-06d8-44bf-96bb-93660e10c3c9'/);
  assert.match(client, /R5_005B_SOURCE_RUN_ID\s*=\s*'5cd0e73b-956d-4c80-9e70-6d841d27b163'/);
});

test('R5-005B explicitly holds the zero-stock READY row instead of inventing location evidence', () => {
  assert.match(client, /R5_005B_ZERO_STOCK_HOLD/);
  assert.match(client, /sourceProductCode:\s*'FL115PLABOX'/);
  assert.match(client, /sourceQtyOnHand:\s*0/);
  assert.match(client, /ZERO_STOCK_LOCATION_EVIDENCE_SEMANTICS_UNRESOLVED/);
  assert.match(panel, /ZERO-STOCK HOLD/);
  assert.match(panel, /不得为它虚构仓位证据/);
  assert.doesNotMatch(client, /FL115PLABOX[\s\S]{0,180}R5_005B_EXECUTABLE_CANDIDATES/);
});

test('R5-005B consumes the generic R5-005A kernel and never exposes approval', () => {
  for (const fn of [
    'ecoflow_read_ready_inventory_commissioning_gate',
    'ecoflow_start_ready_inventory_commissioning',
    'ecoflow_record_ready_inventory_commissioning_location',
    'ecoflow_finalize_ready_inventory_commissioning',
    'ecoflow_materialize_ready_initial_stocktake',
  ]) {
    assert.match(client, new RegExp(fn));
  }
  assert.doesNotMatch(client, /ecoflow_approve_stocktake_session/i);
  assert.doesNotMatch(panel, /onClick[^\n]*approve/i);
  assert.match(panel, /本页面没有 APPROVE 控件/);
  assert.match(client, /stocktakeSessionStatus !== 'REVIEW'/);
  assert.match(client, /after\.inventoryAuthorityCreated/);
});

test('R5-005B refuses zero/invalid START and requires real physical evidence before FINALIZE', () => {
  assert.match(client, /before\.sourceQtyOnHand <= 0/);
  assert.match(client, /R5_005B_START_NOT_ELIGIBLE/);
  assert.match(client, /R5_005B_REAL_LOCATION_REQUIRED/);
  assert.match(client, /R5_005B_PHYSICAL_EVIDENCE_NOTE_REQUIRED/);
  assert.match(client, /before\.locations\.length < 1/);
  assert.match(client, /R5_005B_REFERENCE_ALLOCATION_MUST_RECONCILE/);
  assert.match(client, /R5_005B_EXPLICIT_VARIANCE_ACCEPTANCE_REQUIRED/);
  assert.match(client, /R5_005B_VARIANCE_REASON_REQUIRED/);
  assert.match(panel, /Counted quantity 必须来自现场实盘，不得从系统数字反推/);
});

test('R5-005B binds RPC responses back to the frozen identity before showing them', () => {
  assert.match(client, /R5_005B_FROZEN_READY_ROW_BINDING_MISMATCH/);
  assert.match(client, /value\.referenceRowId !== frozen\.referenceRowId/);
  assert.match(client, /value\.sourceRowSha256 !== frozen\.sourceRowSha256/);
  assert.match(client, /value\.physicalSkuId !== frozen\.physicalSkuId/);
  assert.match(client, /value\.packageId !== frozen\.packageId/);
  assert.match(client, /value\.barcode !== frozen\.barcode/);
  assert.match(client, /value\.packageLevel !== 'CARTON'/);
});

test('R5-005B preserves exact command ids across retry-capable actions', () => {
  assert.match(panel, /startCommandId \?\? crypto\.randomUUID\(\)/);
  assert.match(panel, /locationCommandId \?\? crypto\.randomUUID\(\)/);
  assert.match(panel, /finalizeCommandId \?\? crypto\.randomUUID\(\)/);
  assert.match(panel, /materializeCommandId \?\? crypto\.randomUUID\(\)/);
  assert.match(panel, /重试同一 START command/);
  assert.match(panel, /重试同一仓位 command/);
  assert.match(panel, /重试同一 FINALIZE command/);
  assert.match(panel, /重试同一 MATERIALIZE command/);
});

test('R5-005B is wired into the existing inventory reference surface', () => {
  assert.match(host, /import \{ ReadyPositiveStockCommissioningPanel \} from '\.\/ReadyPositiveStockCommissioningPanel'/);
  assert.match(host, /<ReadyPositiveStockCommissioningPanel supabase=\{supabase\} \/>/);
});
