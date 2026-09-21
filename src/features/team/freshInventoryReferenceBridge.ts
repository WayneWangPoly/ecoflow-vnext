import type { SupabaseClient } from '@supabase/supabase-js';

export const R5_009_STAGE_REQUEST = {
  requestKey: 'ECOFLOW-R5-009A',
  confirm: true,
} as const;

export type R5009StageResult = {
  ok: true;
  requestKey: 'ECOFLOW-R5-009A';
  reconstructionCommandId: 'c2419a14-1423-4190-b7f5-d3f31f4e5225';
  stageCommandId: 'c3bd8b38-f909-4599-ae36-b84023143f04';
  sourceRunId: 'bdca8012-8f78-4dff-b20c-5f5a7d0f8cce';
  asAt: '2026-09-21T14:03:56.489Z';
  membershipCount: 428;
  batchId: string;
  batchStatus: 'STAGED';
  revision: 0;
  sourceSetSha256: string;
  sourceRowCount: 428;
  membershipBacked: true;
  authorityEffect: 'NONE';
};

export type R5009BridgeGate = {
  freshBatchId: string | null;
  freshBatchStatus: string | null;
  freshBatchRevision: number | null;
  freshSourceRowCount: number | null;
  membershipCount: number;
  oldBatchStatus: string | null;
  oldBatchRevision: number | null;
  staleDraftCommissioningCount: number;
  provisionalEvidenceCount: number;
  freshTargetCount: number;
  freshReadyTargetCount: number;
  warehouseQuantityRows: number;
  warehouseMovementRows: number;
  inventoryMovementRows: number;
  stocktakeObservationRows: number;
  safeToActivate: boolean;
  authorityEffect: 'NONE';
};

export type R5009ActivateResult = {
  freshBatchId: string;
  freshBatchStatus: 'SEALED';
  freshBatchRevision: 1;
  oldBatchId: '4cdb85d3-06d8-44bf-96bb-93660e10c3c9';
  oldBatchStatus: 'SUPERSEDED';
  oldBatchRevision: 2;
  supersededCommissioningCount: 2;
  supersededProvisionalEvidenceCount: 2;
  freshTargetQtyOnHand: {
    'R-360Y': 1;
    'SB24/32/40LBOX': 1;
  };
  physicalStocktakeRequired: true;
  inventoryAuthorityCreated: false;
  authorityEffect: 'NONE';
};

type CarrierError = { error?: string; details?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readCarrierError(value: unknown) {
  if (!isRecord(value) || typeof value.error !== 'string') return null;
  return `${value.error}${typeof value.details === 'string' ? `: ${value.details}` : ''}`;
}

function assertStage(value: unknown): R5009StageResult {
  if (!isRecord(value)) throw new Error('R5_009_STAGE_CONTRACT_VIOLATION');
  const carrierError = readCarrierError(value);
  if (carrierError) throw new Error(carrierError);
  if (
    value.ok !== true
    || value.requestKey !== 'ECOFLOW-R5-009A'
    || value.reconstructionCommandId !== 'c2419a14-1423-4190-b7f5-d3f31f4e5225'
    || value.stageCommandId !== 'c3bd8b38-f909-4599-ae36-b84023143f04'
    || value.sourceRunId !== 'bdca8012-8f78-4dff-b20c-5f5a7d0f8cce'
    || value.asAt !== '2026-09-21T14:03:56.489Z'
    || value.membershipCount !== 428
    || value.batchStatus !== 'STAGED'
    || value.revision !== 0
    || value.sourceRowCount !== 428
    || value.membershipBacked !== true
    || value.authorityEffect !== 'NONE'
    || typeof value.batchId !== 'string'
    || typeof value.sourceSetSha256 !== 'string'
    || !/^[0-9a-f]{64}$/.test(value.sourceSetSha256)
  ) {
    throw new Error('R5_009_STAGE_RESULT_REJECTED');
  }
  return value as R5009StageResult;
}

function assertGate(value: unknown): R5009BridgeGate {
  if (!isRecord(value)) throw new Error('R5_009_GATE_CONTRACT_VIOLATION');
  if (
    (value.freshBatchId !== null && typeof value.freshBatchId !== 'string')
    || (value.freshBatchStatus !== null && typeof value.freshBatchStatus !== 'string')
    || (value.freshBatchRevision !== null && typeof value.freshBatchRevision !== 'number')
    || (value.freshSourceRowCount !== null && typeof value.freshSourceRowCount !== 'number')
    || typeof value.membershipCount !== 'number'
    || typeof value.staleDraftCommissioningCount !== 'number'
    || typeof value.provisionalEvidenceCount !== 'number'
    || typeof value.freshTargetCount !== 'number'
    || typeof value.freshReadyTargetCount !== 'number'
    || typeof value.warehouseQuantityRows !== 'number'
    || typeof value.warehouseMovementRows !== 'number'
    || typeof value.inventoryMovementRows !== 'number'
    || typeof value.stocktakeObservationRows !== 'number'
    || typeof value.safeToActivate !== 'boolean'
    || value.authorityEffect !== 'NONE'
  ) {
    throw new Error('R5_009_GATE_RESULT_REJECTED');
  }
  return value as R5009BridgeGate;
}

function assertActivate(value: unknown): R5009ActivateResult {
  if (!isRecord(value) || !isRecord(value.freshTargetQtyOnHand)) {
    throw new Error('R5_009_ACTIVATE_CONTRACT_VIOLATION');
  }
  if (
    typeof value.freshBatchId !== 'string'
    || value.freshBatchStatus !== 'SEALED'
    || value.freshBatchRevision !== 1
    || value.oldBatchId !== '4cdb85d3-06d8-44bf-96bb-93660e10c3c9'
    || value.oldBatchStatus !== 'SUPERSEDED'
    || value.oldBatchRevision !== 2
    || value.supersededCommissioningCount !== 2
    || value.supersededProvisionalEvidenceCount !== 2
    || value.freshTargetQtyOnHand['R-360Y'] !== 1
    || value.freshTargetQtyOnHand['SB24/32/40LBOX'] !== 1
    || value.physicalStocktakeRequired !== true
    || value.inventoryAuthorityCreated !== false
    || value.authorityEffect !== 'NONE'
  ) {
    throw new Error('R5_009_ACTIVATE_RESULT_REJECTED');
  }
  return value as R5009ActivateResult;
}

export async function runR5009FreshReferenceStage(
  supabase: SupabaseClient,
): Promise<R5009StageResult> {
  const { data, error } = await supabase.functions.invoke('stage-unleashed-inventory-reference', {
    body: R5_009_STAGE_REQUEST,
  });
  if (error) throw error;
  const carrierError = readCarrierError(data as CarrierError | null);
  if (carrierError) throw new Error(carrierError);
  return assertStage(data);
}

export async function readR5009FreshReferenceBridgeGate(
  supabase: SupabaseClient,
): Promise<R5009BridgeGate> {
  const { data, error } = await supabase.rpc('ecoflow_read_r5_009_fresh_reference_bridge_gate');
  if (error) throw error;
  return assertGate(data);
}

export async function activateR5009FreshReferenceBridge(
  supabase: SupabaseClient,
): Promise<R5009ActivateResult> {
  const { data, error } = await supabase.rpc('ecoflow_activate_r5_009_fresh_reference_bridge');
  if (error) throw error;
  return assertActivate(data);
}
