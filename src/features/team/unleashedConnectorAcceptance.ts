import type { SupabaseClient } from '@supabase/supabase-js';

export const UNLEASHED_ACCEPTANCE_RESOURCES = [
  'products',
  'stock_on_hand',
  'sales_orders_open',
  'purchase_orders_open',
] as const;

export type UnleashedAcceptanceResource = typeof UNLEASHED_ACCEPTANCE_RESOURCES[number];

type SnapshotCatalogRow = {
  resource: string;
  external_guid: string | null;
  external_code: string | null;
  external_number: string | null;
  warehouse_code: string | null;
  last_seen_at: string | null;
};

type TargetSelector =
  | { guid: string }
  | { productCode: string }
  | { productId: string; warehouseCode?: string }
  | { orderNumber: string };

type ConnectorResult = {
  ok: boolean;
  runId: string;
  requestedAt: string;
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  dryRun: boolean;
  resources: string[];
  pageSize: number;
  maxPages: number;
  recordsSeen: number;
  recordsStaged: number;
  recordsInserted: number;
  recordsChanged: number;
  recordsUnchanged: number;
  recordsFailed: number;
  failedResources: string[];
  pages: Array<{
    resource: string;
    recordsSeen: number;
    recordsStaged: number;
    recordsInserted: number;
    recordsChanged: number;
    recordsUnchanged: number;
  }>;
  errorCode: string | null;
  errorMessage: string | null;
};

type ConnectorError = {
  error?: string;
  details?: string;
};

type AcceptedConnectorResult = ConnectorResult & { status: 'SUCCEEDED' | 'PARTIAL' };

export type UnleashedAcceptanceCheck = {
  resource: UnleashedAcceptanceResource;
  status: 'VERIFIED' | 'MISSING' | 'FAILED';
  firstRunId: string | null;
  replayRunId: string | null;
  firstRecordsStaged: number;
  replayRecordsStaged: number;
  replayRecordsUnchanged: number;
  error: string | null;
};

export type UnleashedAcceptanceResult = {
  completedAt: string;
  seedRunId: string;
  seedStatus: 'SUCCEEDED' | 'PARTIAL';
  seedRecordsSeen: number;
  seedRecordsStaged: number;
  seedRecordsUnchanged: number;
  seedRecordsFailed: number;
  seedErrorMessage: string | null;
  verifiedCount: number;
  complete: boolean;
  checks: UnleashedAcceptanceCheck[];
};

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isConnectorResult(value: unknown): value is ConnectorResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<ConnectorResult>;
  return typeof result.ok === 'boolean'
    && typeof result.runId === 'string'
    && typeof result.requestedAt === 'string'
    && ['SUCCEEDED', 'PARTIAL', 'FAILED'].includes(result.status ?? '')
    && typeof result.dryRun === 'boolean'
    && Array.isArray(result.resources)
    && isNonNegativeInteger(result.pageSize)
    && isNonNegativeInteger(result.maxPages)
    && isNonNegativeInteger(result.recordsSeen)
    && isNonNegativeInteger(result.recordsStaged)
    && isNonNegativeInteger(result.recordsInserted)
    && isNonNegativeInteger(result.recordsChanged)
    && isNonNegativeInteger(result.recordsUnchanged)
    && isNonNegativeInteger(result.recordsFailed)
    && Array.isArray(result.failedResources)
    && result.failedResources.every((resource) => typeof resource === 'string')
    && Array.isArray(result.pages);
}

function sameResources(actual: string[], expected: readonly string[]) {
  return actual.length === expected.length && actual.every((resource, index) => resource === expected[index]);
}

function assertSuccessfulResult(
  value: unknown,
  expectedResources: readonly UnleashedAcceptanceResource[],
  maximumRecords: number,
  allowPartial = false,
): AcceptedConnectorResult {
  if (!isConnectorResult(value)) throw new Error('UNLEASHED_ACCEPTANCE_CONTRACT_VIOLATION');
  const acceptedStatus = value.status === 'SUCCEEDED' || (allowPartial && value.status === 'PARTIAL');
  const statusIsConsistent = value.status === 'SUCCEEDED'
    ? value.recordsFailed === 0 && value.failedResources.length === 0
    : value.recordsFailed > 0 && value.failedResources.length > 0;
  if (
    !value.ok
    || !acceptedStatus
    || !statusIsConsistent
    || value.dryRun
    || value.pageSize !== 1
    || value.maxPages !== 1
    || value.recordsSeen > maximumRecords
    || value.recordsStaged > maximumRecords
    || !sameResources(value.resources, expectedResources)
    || value.failedResources.some((resource) => !expectedResources.includes(resource as UnleashedAcceptanceResource))
    || value.recordsStaged !== value.recordsInserted + value.recordsChanged
  ) {
    throw new Error('UNLEASHED_ACCEPTANCE_RESULT_REJECTED');
  }
  return value as AcceptedConnectorResult;
}

async function invokeConnector(
  supabase: SupabaseClient,
  body: Record<string, unknown>,
  expectedResources: readonly UnleashedAcceptanceResource[],
  maximumRecords: number,
  allowPartial = false,
) {
  const { data, error } = await supabase.functions.invoke('trigger-unleashed-readonly-sync', { body });
  if (error) throw error;
  const connectorError = data as ConnectorError | null;
  if (connectorError?.error) {
    throw new Error(`${connectorError.error}${connectorError.details ? `: ${connectorError.details}` : ''}`);
  }
  return assertSuccessfulResult(data, expectedResources, maximumRecords, allowPartial);
}

function buildTarget(resource: UnleashedAcceptanceResource, row: SnapshotCatalogRow): TargetSelector | null {
  if (resource === 'products') {
    if (row.external_guid) return { guid: row.external_guid };
    if (row.external_code) return { productCode: row.external_code };
    return null;
  }
  if (resource === 'stock_on_hand') {
    if (!row.external_guid) return null;
    return row.warehouse_code
      ? { productId: row.external_guid, warehouseCode: row.warehouse_code }
      : { productId: row.external_guid };
  }
  if (row.external_guid) return { guid: row.external_guid };
  if (row.external_number) return { orderNumber: row.external_number };
  return null;
}

async function loadAcceptanceTargets(supabase: SupabaseClient) {
  const targets = new Map<UnleashedAcceptanceResource, TargetSelector | null>();
  for (const resource of UNLEASHED_ACCEPTANCE_RESOURCES) {
    const { data, error } = await supabase
      .from('v_ecoflow_unleashed_snapshot_catalog')
      .select('resource,external_guid,external_code,external_number,warehouse_code,last_seen_at')
      .eq('resource', resource)
      .order('last_seen_at', { ascending: false })
      .limit(20);

    if (error) throw error;
    const rows = (data ?? []) as SnapshotCatalogRow[];
    const row = rows.find((candidate) => buildTarget(resource, candidate));
    targets.set(resource, row ? buildTarget(resource, row) : null);
  }
  return targets;
}

async function verifyTargetReplay(
  supabase: SupabaseClient,
  resource: UnleashedAcceptanceResource,
  target: TargetSelector,
): Promise<UnleashedAcceptanceCheck> {
  const reasonBase = `Admin bounded connector acceptance for ${resource} at ${new Date().toISOString()}`;
  try {
    const first = await invokeConnector(supabase, {
      mode: 'bounded_snapshot',
      resources: [resource],
      dryRun: false,
      pageSize: 1,
      maxPages: 1,
      target,
      reason: `${reasonBase}; exact target read`,
    }, [resource], 1);
    if (first.recordsSeen !== 1) throw new Error('UNLEASHED_ACCEPTANCE_TARGET_NOT_EXACT');

    const replay = await invokeConnector(supabase, {
      mode: 'bounded_snapshot',
      resources: [resource],
      dryRun: false,
      pageSize: 1,
      maxPages: 1,
      target,
      reason: `${reasonBase}; unchanged replay proof`,
    }, [resource], 1);
    if (
      replay.recordsSeen !== 1
      || replay.recordsStaged !== 0
      || replay.recordsInserted !== 0
      || replay.recordsChanged !== 0
      || replay.recordsUnchanged !== 1
    ) {
      throw new Error('UNLEASHED_ACCEPTANCE_REPLAY_NOT_IDEMPOTENT');
    }

    return {
      resource,
      status: 'VERIFIED',
      firstRunId: first.runId,
      replayRunId: replay.runId,
      firstRecordsStaged: first.recordsStaged,
      replayRecordsStaged: replay.recordsStaged,
      replayRecordsUnchanged: replay.recordsUnchanged,
      error: null,
    };
  } catch (error) {
    return {
      resource,
      status: 'FAILED',
      firstRunId: null,
      replayRunId: null,
      firstRecordsStaged: 0,
      replayRecordsStaged: 0,
      replayRecordsUnchanged: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runUnleashedConnectorAcceptance(supabase: SupabaseClient): Promise<UnleashedAcceptanceResult> {
  const seed = await invokeConnector(supabase, {
    mode: 'bounded_snapshot',
    resources: [...UNLEASHED_ACCEPTANCE_RESOURCES],
    dryRun: false,
    pageSize: 1,
    maxPages: 1,
    reason: `Admin-confirmed four-resource connector acceptance at ${new Date().toISOString()}`,
  }, UNLEASHED_ACCEPTANCE_RESOURCES, UNLEASHED_ACCEPTANCE_RESOURCES.length, true);

  const targets = await loadAcceptanceTargets(supabase);
  const checks: UnleashedAcceptanceCheck[] = [];
  for (const resource of UNLEASHED_ACCEPTANCE_RESOURCES) {
    if (seed.failedResources.includes(resource)) {
      checks.push({
        resource,
        status: 'FAILED',
        firstRunId: null,
        replayRunId: null,
        firstRecordsStaged: 0,
        replayRecordsStaged: 0,
        replayRecordsUnchanged: 0,
        error: `Initial source read failed for ${resource}.`,
      });
      continue;
    }
    const target = targets.get(resource);
    if (!target) {
      checks.push({
        resource,
        status: 'MISSING',
        firstRunId: null,
        replayRunId: null,
        firstRecordsStaged: 0,
        replayRecordsStaged: 0,
        replayRecordsUnchanged: 0,
        error: 'No exact source identifier is available for this resource.',
      });
      continue;
    }
    checks.push(await verifyTargetReplay(supabase, resource, target));
  }

  const verifiedCount = checks.filter((check) => check.status === 'VERIFIED').length;
  return {
    completedAt: new Date().toISOString(),
    seedRunId: seed.runId,
    seedStatus: seed.status,
    seedRecordsSeen: seed.recordsSeen,
    seedRecordsStaged: seed.recordsStaged,
    seedRecordsUnchanged: seed.recordsUnchanged,
    seedRecordsFailed: seed.recordsFailed,
    seedErrorMessage: seed.errorMessage,
    verifiedCount,
    complete: seed.status === 'SUCCEEDED'
      && seed.failedResources.length === 0
      && verifiedCount === UNLEASHED_ACCEPTANCE_RESOURCES.length,
    checks,
  };
}
