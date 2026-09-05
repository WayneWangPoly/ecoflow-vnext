import type { SupabaseClient } from '@supabase/supabase-js';
import { ADDRESS_CONTINUATION_PLAN } from './unleashedCustomerDeliveryAddressContinuationPlan';

const RESOURCE = 'customer_delivery_addresses' as const;
const PAGE_SIZE = 50 as const;
const PREFLIGHT_MAX_PAGES = 4 as const;
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
  maxPages: typeof PREFLIGHT_MAX_PAGES;
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

export type AddressContinuationResult = {
  ok: boolean;
  runId: string;
  requestedAt: string;
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  dryRun: false;
  resources: [typeof RESOURCE];
  pageSize: typeof PAGE_SIZE;
  maxPages: typeof ADDRESS_CONTINUATION_PLAN.maxPages;
  startPage: typeof ADDRESS_CONTINUATION_PLAN.startPage;
  previousRunId: typeof ADDRESS_CONTINUATION_PLAN.previousRunId;
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
    || result.maxPages !== PREFLIGHT_MAX_PAGES
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

function isExactContinuation(value: unknown): value is AddressContinuationResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<AddressContinuationResult>;
  if (
    result.ok !== true
    || result.status !== 'SUCCEEDED'
    || result.dryRun !== false
    || !Array.isArray(result.resources)
    || result.resources.length !== 1
    || result.resources[0] !== RESOURCE
    || result.pageSize !== ADDRESS_CONTINUATION_PLAN.pageSize
    || result.maxPages !== ADDRESS_CONTINUATION_PLAN.maxPages
    || result.startPage !== ADDRESS_CONTINUATION_PLAN.startPage
    || result.previousRunId !== ADDRESS_CONTINUATION_PLAN.previousRunId
    || result.allResourcesComplete !== true
    || result.recordsSeen !== ADDRESS_CONTINUATION_PLAN.expectedRecordsSeen
    || result.recordsStaged !== ADDRESS_CONTINUATION_PLAN.expectedRecordsStaged
    || result.recordsInserted !== ADDRESS_CONTINUATION_PLAN.expectedRecordsInserted
    || result.recordsChanged !== ADDRESS_CONTINUATION_PLAN.expectedRecordsChanged
    || result.recordsUnchanged !== ADDRESS_CONTINUATION_PLAN.expectedRecordsUnchanged
    || result.recordsFailed !== ADDRESS_CONTINUATION_PLAN.expectedRecordsFailed
    || !Array.isArray(result.failedResources)
    || result.failedResources.length !== 0
    || !Array.isArray(result.pages)
    || result.pages.length !== ADDRESS_CONTINUATION_PLAN.expectedPages.length
    || !Array.isArray(result.paginationWindows)
    || result.paginationWindows.length !== 1
  ) return false;

  for (const [index, expectedPage] of ADDRESS_CONTINUATION_PLAN.expectedPages.entries()) {
    const page = result.pages[index];
    if (
      !page
      || page.resource !== RESOURCE
      || page.pageNumber !== expectedPage.pageNumber
      || page.pageSize !== ADDRESS_CONTINUATION_PLAN.pageSize
      || page.httpStatus !== 200
      || page.responseSha256 !== expectedPage.responseSha256
      || page.recordsSeen !== expectedPage.recordsSeen
      || page.recordsStaged !== expectedPage.recordsSeen
      || page.recordsInserted !== expectedPage.recordsSeen
      || page.recordsChanged !== 0
      || page.recordsUnchanged !== 0
      || paginationNumber(page, 'NumberOfItems') !== ADDRESS_CONTINUATION_PLAN.expectedTotalItems
      || paginationNumber(page, 'NumberOfPages') !== ADDRESS_CONTINUATION_PLAN.expectedTotalPages
    ) return false;
  }

  const window = result.paginationWindows[0];
  return window.resource === RESOURCE
    && window.startPage === ADDRESS_CONTINUATION_PLAN.startPage
    && window.lastPage === ADDRESS_CONTINUATION_PLAN.expectedPages[1].pageNumber
    && window.numberOfPages === ADDRESS_CONTINUATION_PLAN.expectedTotalPages
    && window.windowComplete === ADDRESS_CONTINUATION_PLAN.expectedWindowComplete
    && window.nextPage === ADDRESS_CONTINUATION_PLAN.expectedNextPage;
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
    maxPages: PREFLIGHT_MAX_PAGES,
    reason: `#338 Batch 1B-5B customer_delivery_addresses full dry preflight 184/4; ${new Date().toISOString()}`,
  });

  if (!isExactFullDryPreflight(result)) {
    throw new Error('UNLEASHED_ADDRESS_1B5B_DRY_PREFLIGHT_REJECTED');
  }
  return result;
}

export async function runCustomerDeliveryAddressContinuation(
  supabase: SupabaseClient,
): Promise<AddressContinuationResult> {
  const result = await invoke(supabase, {
    mode: ADDRESS_CONTINUATION_PLAN.mode,
    resources: [ADDRESS_CONTINUATION_PLAN.resource],
    dryRun: ADDRESS_CONTINUATION_PLAN.dryRun,
    pageSize: ADDRESS_CONTINUATION_PLAN.pageSize,
    maxPages: ADDRESS_CONTINUATION_PLAN.maxPages,
    startPage: ADDRESS_CONTINUATION_PLAN.startPage,
    previousRunId: ADDRESS_CONTINUATION_PLAN.previousRunId,
    reason: `#338 Batch 1B-5B authorized continuation; exact previous run ${ADDRESS_CONTINUATION_PLAN.previousRunId}; ${new Date().toISOString()}`,
  });

  if (!isExactContinuation(result)) {
    throw new Error('UNLEASHED_ADDRESS_1B5B_CONTINUATION_REJECTED');
  }
  return result;
}
