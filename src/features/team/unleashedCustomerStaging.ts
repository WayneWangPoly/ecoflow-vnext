import type { SupabaseClient } from '@supabase/supabase-js';
import { CUSTOMER_STAGING_PLAN } from './unleashedCustomerStagingPlan';

const RESOURCE = 'customers' as const;
const PAGE_SIZE = 200 as const;
const TOTAL_ITEMS = 623;
const TOTAL_PAGES = 4;
const C2 = CUSTOMER_STAGING_PLAN.expectedSequence[1];
const C2_SHA = CUSTOMER_STAGING_PLAN.freshSourceEvidence.pages[1].responseSha256;
const C2_PREVIOUS_RUN_ID = CUSTOMER_STAGING_PLAN.c1Verification.continuationAnchorRunId;

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

export type CustomerC2Result = {
  ok: boolean;
  runId: string;
  requestedAt: string;
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  dryRun: false;
  resources: [typeof RESOURCE];
  pageSize: typeof PAGE_SIZE;
  maxPages: 1;
  startPage: 2;
  previousRunId: string;
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

function isExactC2(value: unknown): value is CustomerC2Result {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<CustomerC2Result>;
  if (
    result.ok !== true
    || result.status !== 'SUCCEEDED'
    || result.dryRun !== false
    || !Array.isArray(result.resources)
    || result.resources.length !== 1
    || result.resources[0] !== RESOURCE
    || result.pageSize !== PAGE_SIZE
    || result.maxPages !== 1
    || result.startPage !== C2.startPage
    || result.previousRunId !== C2_PREVIOUS_RUN_ID
    || result.allResourcesComplete !== false
    || result.recordsSeen !== C2.expectedRows
    || result.recordsStaged !== C2.expectedRows
    || result.recordsInserted !== C2.expectedRows
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
    || page.pageNumber !== C2.startPage
    || page.pageSize !== PAGE_SIZE
    || page.httpStatus !== 200
    || page.responseSha256 !== C2_SHA
    || page.recordsSeen !== C2.expectedRows
    || page.recordsStaged !== C2.expectedRows
    || page.recordsInserted !== C2.expectedRows
    || page.recordsChanged !== 0
    || page.recordsUnchanged !== 0
    || paginationNumber(page, 'NumberOfItems') !== TOTAL_ITEMS
    || paginationNumber(page, 'NumberOfPages') !== TOTAL_PAGES
  ) return false;

  const window = result.paginationWindows[0];
  return window.resource === RESOURCE
    && window.startPage === C2.startPage
    && window.lastPage === C2.startPage
    && window.numberOfPages === TOTAL_PAGES
    && window.windowComplete === C2.expectedWindowComplete
    && window.nextPage === C2.expectedNextPage
    && window.previousRunId === C2_PREVIOUS_RUN_ID
    && typeof window.highWatermark === 'string'
    && window.highWatermark.length > 0;
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

export async function runAuthorizedCustomerC2(supabase: SupabaseClient): Promise<CustomerC2Result> {
  if (!CUSTOMER_STAGING_PLAN.authorization.granted || CUSTOMER_STAGING_PLAN.authorization.currentExposedWindow !== 'C2') {
    throw new Error('UNLEASHED_CUSTOMER_C2_NOT_AUTHORIZED');
  }

  const result = await invoke(supabase, {
    mode: CUSTOMER_STAGING_PLAN.mode,
    resources: [RESOURCE],
    dryRun: false,
    pageSize: PAGE_SIZE,
    maxPages: 1,
    startPage: C2.startPage,
    previousRunId: C2_PREVIOUS_RUN_ID,
    reason: `#338 authorized customer C2 only; continuation anchor ${C2_PREVIOUS_RUN_ID}; fresh dry evidence ${CUSTOMER_STAGING_PLAN.freshSourceEvidence.dryRunId}; ${new Date().toISOString()}`,
  });

  if (!isExactC2(result)) {
    throw new Error('UNLEASHED_CUSTOMER_C2_RESULT_REJECTED');
  }
  return result;
}
