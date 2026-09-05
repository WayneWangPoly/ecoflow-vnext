import type { SupabaseClient } from '@supabase/supabase-js';

const RESOURCE = 'customer_delivery_addresses' as const;
const PAGE_SIZE = 50 as const;
const MAX_PAGES = 2 as const;
const EXPECTED_ITEMS = 184;
const EXPECTED_TOTAL_PAGES = 4;
const EXPECTED_WINDOW_RECORDS = 100;

export type AddressStagingPage = {
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

export type AddressStagingWindow = {
  resource: typeof RESOURCE;
  startPage: number;
  lastPage: number | null;
  numberOfPages: number | null;
  windowComplete: boolean;
  nextPage: number | null;
  highWatermark: string | null;
};

export type AddressStagingResult = {
  ok: boolean;
  runId: string;
  requestedAt: string;
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  dryRun: boolean;
  resources: [typeof RESOURCE];
  pageSize: typeof PAGE_SIZE;
  maxPages: typeof MAX_PAGES;
  startPage: 1;
  previousRunId: null;
  allResourcesComplete: boolean;
  paginationWindows: AddressStagingWindow[];
  recordsSeen: number;
  recordsStaged: number;
  recordsInserted: number;
  recordsChanged: number;
  recordsUnchanged: number;
  recordsFailed: number;
  failedResources: string[];
  pages: AddressStagingPage[];
  errorCode: string | null;
  errorMessage: string | null;
};

type ConnectorError = { error?: string; details?: string };

function paginationNumber(page: AddressStagingPage | undefined, key: 'NumberOfItems' | 'NumberOfPages') {
  const value = page?.pagination?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return null;
}

function hasExactWindowShape(value: unknown, dryRun: boolean): value is AddressStagingResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<AddressStagingResult>;
  if (
    result.ok !== true
    || result.status !== 'SUCCEEDED'
    || result.dryRun !== dryRun
    || !Array.isArray(result.resources)
    || result.resources.length !== 1
    || result.resources[0] !== RESOURCE
    || result.pageSize !== PAGE_SIZE
    || result.maxPages !== MAX_PAGES
    || result.startPage !== 1
    || result.previousRunId !== null
    || result.allResourcesComplete !== false
    || result.recordsSeen !== EXPECTED_WINDOW_RECORDS
    || result.recordsFailed !== 0
    || !Array.isArray(result.failedResources)
    || result.failedResources.length !== 0
    || !Array.isArray(result.pages)
    || result.pages.length !== 2
    || !Array.isArray(result.paginationWindows)
    || result.paginationWindows.length !== 1
  ) return false;

  const [first, second] = result.pages;
  for (const [index, page] of result.pages.entries()) {
    if (
      page.resource !== RESOURCE
      || page.pageNumber !== index + 1
      || page.pageSize !== PAGE_SIZE
      || page.httpStatus !== 200
      || page.recordsSeen !== PAGE_SIZE
      || page.fetchAttempts !== 1
      || paginationNumber(page, 'NumberOfItems') !== EXPECTED_ITEMS
      || paginationNumber(page, 'NumberOfPages') !== EXPECTED_TOTAL_PAGES
    ) return false;
  }

  if (!first.responseSha256 || !second.responseSha256) return false;

  const window = result.paginationWindows[0];
  return window.resource === RESOURCE
    && window.startPage === 1
    && window.lastPage === 2
    && window.numberOfPages === EXPECTED_TOTAL_PAGES
    && window.windowComplete === false
    && window.nextPage === 3;
}

function isExactPreflight(value: unknown): value is AddressStagingResult {
  if (!hasExactWindowShape(value, true)) return false;
  return value.recordsStaged === 0
    && value.recordsInserted === 0
    && value.recordsChanged === 0
    && value.pages.every((page) => page.recordsStaged === 0);
}

function isExactFirstWindowStaging(value: unknown): value is AddressStagingResult {
  if (!hasExactWindowShape(value, false)) return false;
  return value.recordsStaged === EXPECTED_WINDOW_RECORDS
    && value.recordsInserted === EXPECTED_WINDOW_RECORDS
    && value.recordsChanged === 0
    && value.recordsUnchanged === 0
    && value.pages.every((page) => page.recordsStaged === PAGE_SIZE
      && page.recordsInserted === PAGE_SIZE
      && page.recordsChanged === 0
      && page.recordsUnchanged === 0);
}

function sameSourcePages(preflight: AddressStagingResult, staged: AddressStagingResult) {
  return preflight.pages.every((page, index) => {
    const stagedPage = staged.pages[index];
    return stagedPage?.pageNumber === page.pageNumber
      && stagedPage.responseSha256 === page.responseSha256
      && stagedPage.highWatermark === page.highWatermark;
  });
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

export async function runCustomerDeliveryAddressFirstWindow(
  supabase: SupabaseClient,
): Promise<AddressStagingResult> {
  const preflight = await invoke(supabase, {
    mode: 'bounded_snapshot',
    resources: [RESOURCE],
    dryRun: true,
    pageSize: PAGE_SIZE,
    maxPages: MAX_PAGES,
    reason: `#338 Batch 1B-5A customer_delivery_addresses dry preflight 184/4; ${new Date().toISOString()}`,
  });

  if (!isExactPreflight(preflight)) {
    throw new Error('UNLEASHED_ADDRESS_1B5A_PREFLIGHT_REJECTED');
  }

  const staged = await invoke(supabase, {
    mode: 'bounded_snapshot',
    resources: [RESOURCE],
    dryRun: false,
    pageSize: PAGE_SIZE,
    maxPages: MAX_PAGES,
    reason: `#338 Batch 1B-5A customer_delivery_addresses pages 1-2 bounded non-dry staging; ${new Date().toISOString()}`,
  });

  if (!isExactFirstWindowStaging(staged)) {
    throw new Error('UNLEASHED_ADDRESS_1B5A_RESULT_REJECTED');
  }
  if (!sameSourcePages(preflight, staged)) {
    throw new Error('UNLEASHED_ADDRESS_1B5A_SOURCE_CHANGED_BETWEEN_PREFLIGHT_AND_STAGING');
  }
  return staged;
}
