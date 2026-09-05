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

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isWarehouseStagingResult(value: unknown): value is WarehouseStagingResult {
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
    && isNonNegativeInteger(result.recordsStaged)
    && result.recordsStaged <= 1
    && isNonNegativeInteger(result.recordsInserted)
    && isNonNegativeInteger(result.recordsChanged)
    && isNonNegativeInteger(result.recordsUnchanged)
    && result.recordsStaged === result.recordsInserted + result.recordsChanged
    && result.recordsSeen === result.recordsInserted + result.recordsChanged + result.recordsUnchanged
    && result.recordsFailed === 0
    && Array.isArray(result.failedResources)
    && result.failedResources.length === 0
    && Array.isArray(result.pages)
    && result.pages.length === 1
    && result.pages.every((page) => page.resource === 'warehouses'
      && page.pageSize === 1
      && page.httpStatus === 200
      && page.recordsSeen === 1
      && page.recordsStaged <= 1
      && page.recordsStaged === page.recordsInserted + page.recordsChanged);
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
      reason: `#338 Batch 1B-1 warehouses single-resource non-dry staging; ${new Date().toISOString()}`,
    },
  });

  if (error) throw error;
  const connectorError = data as ConnectorError | null;
  if (connectorError?.error) {
    throw new Error(`${connectorError.error}${connectorError.details ? `: ${connectorError.details}` : ''}`);
  }
  if (!isWarehouseStagingResult(data)) {
    throw new Error('UNLEASHED_WAREHOUSE_STAGING_RESULT_REJECTED');
  }
  return data;
}
