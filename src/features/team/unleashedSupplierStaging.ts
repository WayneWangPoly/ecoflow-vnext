import type { SupabaseClient } from '@supabase/supabase-js';

export type SupplierStagingPage = {
  resource: 'suppliers';
  endpointPath: string;
  pageNumber: number;
  pageSize: 26;
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

export type SupplierStagingResult = {
  ok: boolean;
  runId: string;
  requestedAt: string;
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  dryRun: false;
  resources: ['suppliers'];
  pageSize: 26;
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
  pages: SupplierStagingPage[];
  errorCode: string | null;
  errorMessage: string | null;
};

type ConnectorError = { error?: string; details?: string };

type SupplierPreflightResult = {
  ok: boolean;
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  dryRun: boolean;
  resources: string[];
  pageSize: number;
  maxPages: number;
  recordsSeen: number;
  recordsStaged: number;
  recordsFailed: number;
  allResourcesComplete?: boolean;
  pages?: Array<{
    resource: string;
    pageSize: number;
    httpStatus: number;
    recordsSeen: number;
    recordsStaged: number;
    pagination?: Record<string, unknown>;
  }>;
};

function isExactSupplierIdempotencyPreflight(value: unknown): value is SupplierPreflightResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<SupplierPreflightResult>;
  const page = result.pages?.[0];
  const pageCount = Number(page?.pagination?.NumberOfPages ?? NaN);
  const itemCount = Number(page?.pagination?.NumberOfItems ?? NaN);
  return result.ok === true
    && result.status === 'SUCCEEDED'
    && result.dryRun === true
    && Array.isArray(result.resources)
    && result.resources.length === 1
    && result.resources[0] === 'suppliers'
    && result.pageSize === 26
    && result.maxPages === 1
    && result.recordsSeen === 26
    && result.recordsStaged === 0
    && result.recordsFailed === 0
    && result.allResourcesComplete === true
    && Array.isArray(result.pages)
    && result.pages.length === 1
    && page?.resource === 'suppliers'
    && page.pageSize === 26
    && page.httpStatus === 200
    && page.recordsSeen === 26
    && page.recordsStaged === 0
    && Number.isFinite(pageCount)
    && pageCount === 1
    && Number.isFinite(itemCount)
    && itemCount === 26;
}

function isExactSupplierIdempotentReplay(value: unknown): value is SupplierStagingResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<SupplierStagingResult>;
  const page = result.pages?.[0];
  const pageCount = Number(page?.pagination?.NumberOfPages ?? NaN);
  const itemCount = Number(page?.pagination?.NumberOfItems ?? NaN);
  return result.ok === true
    && result.status === 'SUCCEEDED'
    && result.dryRun === false
    && Array.isArray(result.resources)
    && result.resources.length === 1
    && result.resources[0] === 'suppliers'
    && result.pageSize === 26
    && result.maxPages === 1
    && result.startPage === 1
    && result.previousRunId === null
    && result.allResourcesComplete === true
    && result.recordsSeen === 26
    && result.recordsStaged === 0
    && result.recordsInserted === 0
    && result.recordsChanged === 0
    && result.recordsUnchanged === 26
    && result.recordsFailed === 0
    && Array.isArray(result.failedResources)
    && result.failedResources.length === 0
    && Array.isArray(result.pages)
    && result.pages.length === 1
    && page?.resource === 'suppliers'
    && page.pageSize === 26
    && page.httpStatus === 200
    && page.recordsSeen === 26
    && page.recordsStaged === 0
    && page.recordsInserted === 0
    && page.recordsChanged === 0
    && page.recordsUnchanged === 26
    && Number.isFinite(pageCount)
    && pageCount === 1
    && Number.isFinite(itemCount)
    && itemCount === 26;
}

async function invoke(supabase: SupabaseClient, body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('trigger-unleashed-readonly-sync', { body });
  if (error) throw error;
  const connectorError = data as ConnectorError | null;
  if (connectorError?.error) {
    throw new Error(`${connectorError.error}${connectorError.details ? `: ${connectorError.details}` : ''}`);
  }
  return data;
}

export async function runSupplierUnleashedStaging(
  supabase: SupabaseClient,
): Promise<SupplierStagingResult> {
  const preflight = await invoke(supabase, {
    mode: 'bounded_snapshot',
    resources: ['suppliers'],
    dryRun: true,
    pageSize: 26,
    maxPages: 1,
    reason: `#338 Batch 1B-4 suppliers idempotency preflight; ${new Date().toISOString()}`,
  });

  if (!isExactSupplierIdempotencyPreflight(preflight)) {
    throw new Error('UNLEASHED_SUPPLIER_IDEMPOTENCY_PREFLIGHT_REJECTED');
  }

  const replay = await invoke(supabase, {
    mode: 'bounded_snapshot',
    resources: ['suppliers'],
    dryRun: false,
    pageSize: 26,
    maxPages: 1,
    reason: `#338 Batch 1B-4 suppliers single-resource non-dry idempotent replay; ${new Date().toISOString()}`,
  });

  if (!isExactSupplierIdempotentReplay(replay)) {
    throw new Error('UNLEASHED_SUPPLIER_IDEMPOTENT_REPLAY_REJECTED');
  }
  return replay;
}
