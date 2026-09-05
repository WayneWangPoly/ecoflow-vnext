import type { SupabaseClient } from '@supabase/supabase-js';

const RESOURCE = 'customer_delivery_addresses' as const;
const PAGE_SIZE = 50 as const;
const MAX_PAGES = 4 as const;
const EXPECTED_ITEMS = 184;
const EXPECTED_TOTAL_PAGES = 4;

export type AddressDryPage = {
  resource: typeof RESOURCE;
  endpointPath: string;
  pageNumber: number;
  pageSize: typeof PAGE_SIZE;
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

export type AddressDryWindow = {
  resource: typeof RESOURCE;
  startPage: number;
  lastPage: number | null;
  numberOfPages: number | null;
  windowComplete: boolean;
  nextPage: number | null;
  highWatermark: string | null;
};

export type AddressContinuationPreflightResult = {
  ok: boolean;
  runId: string;
  requestedAt: string;
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  dryRun: true;
  resources: [typeof RESOURCE];
  pageSize: typeof PAGE_SIZE;
  maxPages: typeof MAX_PAGES;
  startPage: 1;
  previousRunId: null;
  allResourcesComplete: true;
  paginationWindows: AddressDryWindow[];
  recordsSeen: number;
  recordsStaged: number;
  recordsInserted: number;
  recordsChanged: number;
  recordsUnchanged: number;
  recordsFailed: number;
  failedResources: string[];
  pages: AddressDryPage[];
  errorCode: string | null;
  errorMessage: string | null;
};

type ConnectorError = { error?: string; details?: string };

function paginationNumber(page: AddressDryPage | undefined, key: 'NumberOfItems' | 'NumberOfPages') {
  const value = page?.pagination?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return null;
}

function isExactFullDryPreflight(value: unknown): value is AddressContinuationPreflightResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<AddressContinuationPreflightResult>;
  if (
    result.ok !== true
    || result.status !== 'SUCCEEDED'
    || result.dryRun !== true
    || !Array.isArray(result.resources)
    || result.resources.length !== 1
    || result.resources[0] !== RESOURCE
    || result.pageSize !== PAGE_SIZE
    || result.maxPages !== MAX_PAGES
    || result.startPage !== 1
    || result.previousRunId !== null
    || result.allResourcesComplete !== true
    || result.recordsSeen !== EXPECTED_ITEMS
    || result.recordsStaged !== 0
    || result.recordsInserted !== 0
    || result.recordsChanged !== 0
    || result.recordsFailed !== 0
    || !Array.isArray(result.failedResources)
    || result.failedResources.length !== 0
    || !Array.isArray(result.pages)
    || result.pages.length !== EXPECTED_TOTAL_PAGES
    || !Array.isArray(result.paginationWindows)
    || result.paginationWindows.length !== 1
  ) return false;

  for (const [index, page] of result.pages.entries()) {
    const expectedSeen = index < 3 ? PAGE_SIZE : 34;
    if (
      page.resource !== RESOURCE
      || page.pageNumber !== index + 1
      || page.pageSize !== PAGE_SIZE
      || page.httpStatus !== 200
      || page.recordsSeen !== expectedSeen
      || page.recordsStaged !== 0
      || page.recordsInserted !== 0
      || page.recordsChanged !== 0
      || page.fetchAttempts !== 1
      || !page.responseSha256
      || paginationNumber(page, 'NumberOfItems') !== EXPECTED_ITEMS
      || paginationNumber(page, 'NumberOfPages') !== EXPECTED_TOTAL_PAGES
    ) return false;
  }

  const window = result.paginationWindows[0];
  return window.resource === RESOURCE
    && window.startPage === 1
    && window.lastPage === 4
    && window.numberOfPages === EXPECTED_TOTAL_PAGES
    && window.windowComplete === true
    && window.nextPage === null;
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

export async function runCustomerDeliveryAddressContinuationPreflight(
  supabase: SupabaseClient,
): Promise<AddressContinuationPreflightResult> {
  const result = await invoke(supabase, {
    mode: 'bounded_snapshot',
    resources: [RESOURCE],
    dryRun: true,
    pageSize: PAGE_SIZE,
    maxPages: MAX_PAGES,
    reason: `#338 Batch 1B-5B customer_delivery_addresses full dry preflight 184/4; ${new Date().toISOString()}`,
  });

  if (!isExactFullDryPreflight(result)) {
    throw new Error('UNLEASHED_ADDRESS_1B5B_DRY_PREFLIGHT_REJECTED');
  }
  return result;
}
