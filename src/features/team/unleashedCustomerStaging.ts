import type { SupabaseClient } from '@supabase/supabase-js';
import { CUSTOMER_STAGING_PLAN } from './unleashedCustomerStagingPlan';

const RESOURCE = 'customers' as const;
const PAGE_SIZE = 200 as const;
const TOTAL_ITEMS = 623;
const TOTAL_PAGES = 4;
const C1 = CUSTOMER_STAGING_PLAN.expectedSequence[0];
const C1_SHA = CUSTOMER_STAGING_PLAN.freshSourceEvidence.pages[0].responseSha256;

type ConnectorError = { error?: string; details?: string };

type CustomerPage = {
  resource: typeof RESOURCE;
  endpointPath: string;
  pageNumber: number;
  pageSize: number;
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

type CustomerWindow = {
  resource: typeof RESOURCE;
  startPage: number;
  lastPage: number | null;
  numberOfPages: number | null;
  windowComplete: boolean;
  nextPage: number | null;
  highWatermark: string | null;
  previousRunId?: string | null;
};

export type CustomerC1Result = {
  ok: boolean;
  runId: string;
  requestedAt: string;
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  dryRun: false;
  resources: [typeof RESOURCE];
  pageSize: typeof PAGE_SIZE;
  maxPages: 1;
  startPage: 1;
  previousRunId: null;
  allResourcesComplete: false;
  paginationWindows: CustomerWindow[];
  recordsSeen: number;
  recordsStaged: number;
  recordsInserted: number;
  recordsChanged: number;
  recordsUnchanged: number;
  recordsFailed: number;
  failedResources: string[];
  pages: CustomerPage[];
  errorCode: string | null;
  errorMessage: string | null;
};

function paginationNumber(page: CustomerPage | undefined, key: 'NumberOfItems' | 'NumberOfPages') {
  const value = page?.pagination?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return null;
}

function isExactC1(value: unknown): value is CustomerC1Result {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<CustomerC1Result>;
  if (
    result.ok !== true
    || result.status !== 'SUCCEEDED'
    || result.dryRun !== false
    || !Array.isArray(result.resources)
    || result.resources.length !== 1
    || result.resources[0] !== RESOURCE
    || result.pageSize !== PAGE_SIZE
    || result.maxPages !== 1
    || result.startPage !== C1.startPage
    || result.previousRunId !== null
    || result.allResourcesComplete !== false
    || result.recordsSeen !== C1.expectedRows
    || result.recordsStaged !== C1.expectedRows
    || result.recordsInserted !== C1.expectedRows
    || result.recordsChanged !== 0
    || result.recordsUnchanged !== 0
    || result.recordsFailed !== 0
    || !Array.isArray(result.failedResources)
    || result.failedResources.length !== 0
    || !Array.isArray(result.pages)
    || result.pages.length !== 1
    || !Array.isArray(result.paginationWindows)
    || result.paginationWindows.length !== 1
  ) return false;

  const page = result.pages[0];
  if (
    !page
    || page.resource !== RESOURCE
    || page.pageNumber !== C1.startPage
    || page.pageSize !== PAGE_SIZE
    || page.httpStatus !== 200
    || page.responseSha256 !== C1_SHA
    || page.recordsSeen !== C1.expectedRows
    || page.recordsStaged !== C1.expectedRows
    || page.recordsInserted !== C1.expectedRows
    || page.recordsChanged !== 0
    || page.recordsUnchanged !== 0
    || paginationNumber(page, 'NumberOfItems') !== TOTAL_ITEMS
    || paginationNumber(page, 'NumberOfPages') !== TOTAL_PAGES
  ) return false;

  const window = result.paginationWindows[0];
  return window.resource === RESOURCE
    && window.startPage === C1.startPage
    && window.lastPage === C1.startPage
    && window.numberOfPages === TOTAL_PAGES
    && window.windowComplete === C1.expectedWindowComplete
    && window.nextPage === C1.expectedNextPage
    && window.highWatermark === CUSTOMER_STAGING_PLAN.freshSourceEvidence.highWatermark;
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

export async function runAuthorizedCustomerC1(supabase: SupabaseClient): Promise<CustomerC1Result> {
  if (!CUSTOMER_STAGING_PLAN.authorization.granted || CUSTOMER_STAGING_PLAN.authorization.currentExposedWindow !== 'C1') {
    throw new Error('UNLEASHED_CUSTOMER_C1_NOT_AUTHORIZED');
  }

  const result = await invoke(supabase, {
    mode: CUSTOMER_STAGING_PLAN.mode,
    resources: [RESOURCE],
    dryRun: false,
    pageSize: PAGE_SIZE,
    maxPages: 1,
    startPage: C1.startPage,
    reason: `#338 authorized customer C1 only; fresh dry evidence ${CUSTOMER_STAGING_PLAN.freshSourceEvidence.dryRunId}; ${new Date().toISOString()}`,
  });

  if (!isExactC1(result)) {
    throw new Error('UNLEASHED_CUSTOMER_C1_RESULT_REJECTED');
  }
  return result;
}
