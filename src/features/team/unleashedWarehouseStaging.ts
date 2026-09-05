import type { SupabaseClient } from '@supabase/supabase-js';

export type WarehouseStagingPage = {
  resource: 'warehouses';
  endpointPath: string;
  pageNumber: number;
  pageSize: 1;
  httpStatus: number;
  responseSha256: string;
  recordsSeen: number;
  recordsStaged: number;
  recordsInserted: number;
  recordsChanged: number;
  recordsUnchanged: number;
  fetchAttempts: number;
  highWatermark: string | null;
  pagination: Record<string, unknown>;
};

export type WarehouseStagingResult = {
  ok: boolean;
  runId: string;
  requestedAt: string;
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  dryRun: false;
  resources: ['warehouses'];
  pageSize: 1;
  maxPages: 1;
  startPage: 1;
  previousRunId: null;
  allResourcesComplete: boolean;
  recordsSeen: number;
  recordsStaged: number;
  recordsInserted: number;
  recordsChanged: number;
  recordsUnchanged: number;
  recordsFailed: number;
  failedResources: string[];
  pages: WarehouseStagingPage[];
  errorCode: string | null;
  errorMessage: string | null;
};

type ConnectorError = {
  error?: string;
  details?: string;
};

function isWarehouseIdempotentReplayResult(value: unknown): value is WarehouseStagingResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<WarehouseStagingResult>;
  return result.ok === true
    && result.status === 'SUCCEEDED'
    && result.dryRun === false
    && Array.isArray(result.resources)
    && result.resources.length === 1
    && result.resources[0] === 'warehouses'
    && result.pageSize === 1
    && result.maxPages === 1
    && result.startPage === 1
    && result.previousRunId === null
    && result.allResourcesComplete === true
    && result.recordsSeen === 1
    && result.recordsStaged === 0
    && result.recordsInserted === 0
    && result.recordsChanged === 0
    && result.recordsUnchanged === 1
    && result.recordsFailed === 0
    && Array.isArray(result.failedResources)
    && result.failedResources.length === 0
    && Array.isArray(result.pages)
    && result.pages.length === 1
    && result.pages.every((page) => page.resource === 'warehouses'
      && page.pageSize === 1
      && page.httpStatus === 200
      && page.recordsSeen === 1
      && page.recordsStaged === 0
      && page.recordsInserted === 0
      && page.recordsChanged === 0
      && page.recordsUnchanged === 1);
}

export async function runWarehouseUnleashedStaging(
  supabase: SupabaseClient,
): Promise<WarehouseStagingResult> {
  const { data, error } = await supabase.functions.invoke('trigger-unleashed-readonly-sync', {
    body: {
      mode: 'bounded_snapshot',
      resources: ['warehouses'],
      dryRun: false,
      pageSize: 1,
      maxPages: 1,
      reason: `#338 Batch 1B-2 warehouses single-resource non-dry idempotent replay; ${new Date().toISOString()}`,
    },
  });

  if (error) throw error;
  const connectorError = data as ConnectorError | null;
  if (connectorError?.error) {
    throw new Error(`${connectorError.error}${connectorError.details ? `: ${connectorError.details}` : ''}`);
  }
  if (!isWarehouseIdempotentReplayResult(data)) {
    throw new Error('UNLEASHED_WAREHOUSE_IDEMPOTENT_REPLAY_REJECTED');
  }
  return data;
}
