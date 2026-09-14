from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one anchor, found {count}')
    p.write_text(text.replace(old, new, 1))


core = 'supabase/functions/trigger-unleashed-readonly-sync/core.ts'
index = 'supabase/functions/trigger-unleashed-readonly-sync/index.ts'

replace_once(
    core,
    """export function classifyPayloadRows<T extends PayloadHashRow>(existing: PayloadHashRow[], rows: T[]) {
  const hashes = new Map(existing.map((row) => [row.external_key, row.payload_sha256]));
  const inserted: T[] = [];
  const changed: T[] = [];
  const unchanged: T[] = [];
  for (const row of rows) {
    const existingHash = hashes.get(row.external_key);
    if (existingHash === undefined) inserted.push(row);
    else if (existingHash === row.payload_sha256) unchanged.push(row);
    else changed.push(row);
  }
  return { inserted, changed, unchanged };
}
""",
    """export function classifyPayloadRows<T extends PayloadHashRow>(existing: PayloadHashRow[], rows: T[]) {
  const hashes = new Map(existing.map((row) => [row.external_key, row.payload_sha256]));
  const inserted: T[] = [];
  const changed: T[] = [];
  const unchanged: T[] = [];
  for (const row of rows) {
    const existingHash = hashes.get(row.external_key);
    if (existingHash === undefined) inserted.push(row);
    else if (existingHash === row.payload_sha256) unchanged.push(row);
    else changed.push(row);
  }
  return { inserted, changed, unchanged };
}

export const POSTGREST_CLASSIFICATION_IN_FILTER_BUDGET = 1_500;
export const POSTGREST_CLASSIFICATION_MAX_KEYS = 200;

function encodedInFilterKeyCost(value: string) {
  return encodeURIComponent(value).length;
}

export function partitionExternalKeysForInFilter(
  values: string[],
  encodedBudget = POSTGREST_CLASSIFICATION_IN_FILTER_BUDGET,
) {
  if (!Number.isInteger(encodedBudget) || encodedBudget < 256 || encodedBudget > 4_096) {
    throw new Error('INVALID_CLASSIFICATION_IN_FILTER_BUDGET');
  }
  if (values.length > POSTGREST_CLASSIFICATION_MAX_KEYS) {
    throw new Error('CLASSIFICATION_KEY_COUNT_EXCEEDS_PAGE_BOUND');
  }

  const unique = [...new Set(values)];
  const chunks: string[][] = [];
  let chunk: string[] = [];
  let encodedLength = 0;

  for (const value of unique) {
    if (typeof value !== 'string' || !value.length) throw new Error('INVALID_CLASSIFICATION_EXTERNAL_KEY');
    const valueLength = encodedInFilterKeyCost(value);
    if (valueLength > encodedBudget) throw new Error('CLASSIFICATION_EXTERNAL_KEY_EXCEEDS_FILTER_BUDGET');
    const separatorLength = chunk.length ? 3 : 0;
    if (chunk.length && encodedLength + separatorLength + valueLength > encodedBudget) {
      chunks.push(chunk);
      chunk = [];
      encodedLength = 0;
    }
    const nextSeparatorLength = chunk.length ? 3 : 0;
    chunk.push(value);
    encodedLength += nextSeparatorLength + valueLength;
  }

  if (chunk.length) chunks.push(chunk);
  return chunks;
}
""",
)

replace_once(
    index,
    """  isRecord,
  normalizeTarget,
  readString,
""",
    """  isRecord,
  normalizeTarget,
  partitionExternalKeysForInFilter,
  readString,
""",
)

replace_once(
    index,
    """const R5_002_REQUEST_KEY = 'ECOFLOW-R5-002';
const R5_002_REASON = 'ECOFLOW-R5-002 production ADL1 warehouse-scoped StockOnHand acquisition';
""",
    """const R5_002_REQUEST_KEY = 'ECOFLOW-R5-002';
const R5_002_REASON = 'ECOFLOW-R5-002 production ADL1 warehouse-scoped StockOnHand acquisition';
const R5_002_R2_REQUEST_KEY = 'ECOFLOW-R5-002-R2';
const R5_002_R2_REASON = 'ECOFLOW-R5-002-R2 recovery after classification-read defect';
""",
)

replace_once(
    index,
    """function normalizeRequestKey(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  if (value !== R5_002_REQUEST_KEY) throw new Error('UNSUPPORTED_REQUEST_KEY');
  return value;
}
""",
    """function normalizeRequestKey(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  if (value !== R5_002_REQUEST_KEY && value !== R5_002_R2_REQUEST_KEY) throw new Error('UNSUPPORTED_REQUEST_KEY');
  return value;
}
""",
)

replace_once(
    index,
    """  const bodyKeys = Object.keys(input.body).sort();
  const targetKeys = isRecord(input.body.target) ? Object.keys(input.body.target) : [];
  const exactShape = bodyKeys.length === allowedKeys.length
""",
    """  const bodyKeys = Object.keys(input.body).sort();
  const targetKeys = isRecord(input.body.target) ? Object.keys(input.body.target) : [];
  const expectedReason = input.requestKey === R5_002_R2_REQUEST_KEY ? R5_002_R2_REASON : R5_002_REASON;
  const exactShape = bodyKeys.length === allowedKeys.length
""",
)

replace_once(
    index,
    """    && input.body.resources.length === 1
    && input.body.resources[0] === 'stock_on_hand'
    && input.body.reason === R5_002_REASON
    && input.body.dryRun === false
""",
    """    && input.body.resources.length === 1
    && input.body.resources[0] === 'stock_on_hand'
    && input.body.reason === expectedReason
    && input.body.dryRun === false
""",
)

replace_once(
    index,
    """async function classifySnapshotRows(
  adminClient: ReturnType<typeof createClient>,
  resource: ResourceName,
  rows: SnapshotRow[],
) {
  if (!rows.length) return { inserted: [] as SnapshotRow[], changed: [] as SnapshotRow[], unchanged: [] as SnapshotRow[] };
  const { data, error } = await adminClient
    .from('unleashed_raw_snapshots')
    .select('external_key,payload_sha256')
    .eq('resource', resource)
    .in('external_key', rows.map((row) => row.external_key));
  if (error) throw new Error(`UNLEASHED_RAW_SNAPSHOT_CLASSIFY_FAILED:${error.message}`);
  return classifyPayloadRows(
    (data ?? []).map((row) => ({
      external_key: String(row.external_key),
      payload_sha256: String(row.payload_sha256),
    })),
    rows,
  );
}

async function identityRowsNeedingWrite(
  adminClient: ReturnType<typeof createClient>,
  resource: ResourceName,
  rows: IdentityRow[],
) {
  if (!rows.length) return [];
  const { data, error } = await adminClient
    .from('unleashed_external_identities')
    .select('external_key,latest_payload_sha256')
    .eq('resource', resource)
    .in('external_key', rows.map((row) => row.external_key));
  if (error) throw new Error(`UNLEASHED_EXTERNAL_IDENTITY_CLASSIFY_FAILED:${error.message}`);
  const hashes = new Map((data ?? []).map((row) => [String(row.external_key), String(row.latest_payload_sha256)]));
  return rows.filter((row) => hashes.get(row.external_key) !== row.latest_payload_sha256);
}
""",
    """async function classifySnapshotRows(
  adminClient: ReturnType<typeof createClient>,
  resource: ResourceName,
  rows: SnapshotRow[],
) {
  if (!rows.length) return { inserted: [] as SnapshotRow[], changed: [] as SnapshotRow[], unchanged: [] as SnapshotRow[] };
  const existing: Array<{ external_key: string; payload_sha256: string }> = [];
  for (const keys of partitionExternalKeysForInFilter(rows.map((row) => row.external_key))) {
    const { data, error } = await adminClient
      .from('unleashed_raw_snapshots')
      .select('external_key,payload_sha256')
      .eq('resource', resource)
      .in('external_key', keys);
    if (error) throw new Error(`UNLEASHED_RAW_SNAPSHOT_CLASSIFY_FAILED:${error.message}`);
    existing.push(...(data ?? []).map((row) => ({
      external_key: String(row.external_key),
      payload_sha256: String(row.payload_sha256),
    })));
  }
  return classifyPayloadRows(existing, rows);
}

async function identityRowsNeedingWrite(
  adminClient: ReturnType<typeof createClient>,
  resource: ResourceName,
  rows: IdentityRow[],
) {
  if (!rows.length) return [];
  const existing: Array<{ external_key: string; latest_payload_sha256: string }> = [];
  for (const keys of partitionExternalKeysForInFilter(rows.map((row) => row.external_key))) {
    const { data, error } = await adminClient
      .from('unleashed_external_identities')
      .select('external_key,latest_payload_sha256')
      .eq('resource', resource)
      .in('external_key', keys);
    if (error) throw new Error(`UNLEASHED_EXTERNAL_IDENTITY_CLASSIFY_FAILED:${error.message}`);
    existing.push(...(data ?? []).map((row) => ({
      external_key: String(row.external_key),
      latest_payload_sha256: String(row.latest_payload_sha256),
    })));
  }
  const hashes = new Map(existing.map((row) => [row.external_key, row.latest_payload_sha256]));
  return rows.filter((row) => hashes.get(row.external_key) !== row.latest_payload_sha256);
}
""",
)

replace_once(
    index,
    """async function insertDryRunBatch(
  adminClient: ReturnType<typeof createClient>,
  row: Record<string, unknown>,
) {
  const { data, error } = await adminClient
    .from('unleashed_sync_batches')
    .insert(row)
    .select('id')
    .single();
  if (error || !data) throw new Error('UNLEASHED_DRY_RUN_BATCH_CREATE_FAILED:' + (error?.message ?? 'UNKNOWN'));
  return data;
}

Deno.serve(async (req) => {
""",
    """async function insertDryRunBatch(
  adminClient: ReturnType<typeof createClient>,
  row: Record<string, unknown>,
) {
  const { data, error } = await adminClient
    .from('unleashed_sync_batches')
    .insert(row)
    .select('id')
    .single();
  if (error || !data) throw new Error('UNLEASHED_DRY_RUN_BATCH_CREATE_FAILED:' + (error?.message ?? 'UNKNOWN'));
  return data;
}

async function verifyR5002R2RecoveryPrerequisites(adminClient: ReturnType<typeof createClient>) {
  const { data: originalRuns, error: originalError } = await adminClient
    .from('unleashed_sync_runs')
    .select('id,status,resource_set,records_seen,records_staged,error_code,error_message,metadata')
    .contains('metadata', { request_key: R5_002_REQUEST_KEY });
  if (originalError) throw new Error(`R5_002_R2_ORIGINAL_LOOKUP_FAILED:${originalError.message}`);
  if ((originalRuns ?? []).length !== 1) throw new Error('R5_002_R2_ORIGINAL_RUN_CARDINALITY_MISMATCH');

  const original = originalRuns![0];
  const metadata = isRecord(original.metadata) ? original.metadata : {};
  const target = isRecord(metadata.target) ? metadata.target : {};
  const exactFailure = original.status === 'FAILED'
    && Array.isArray(original.resource_set)
    && original.resource_set.length === 1
    && original.resource_set[0] === 'stock_on_hand'
    && original.records_seen === 200
    && original.records_staged === 0
    && original.error_code === 'UNLEASHED_CONNECTOR_PAGE_FAILED'
    && typeof original.error_message === 'string'
    && original.error_message.startsWith('UNLEASHED_RAW_SNAPSHOT_CLASSIFY_FAILED:')
    && target.warehouseCode === 'ADL1';
  if (!exactFailure) throw new Error('R5_002_R2_ORIGINAL_FAILURE_MISMATCH');

  const [{ data: firstSeen, error: firstSeenError }, { data: lastSeen, error: lastSeenError }] = await Promise.all([
    adminClient.from('unleashed_raw_snapshots').select('id').eq('first_seen_run_id', original.id).limit(1),
    adminClient.from('unleashed_raw_snapshots').select('id').eq('last_seen_run_id', original.id).limit(1),
  ]);
  if (firstSeenError || lastSeenError) {
    throw new Error(`R5_002_R2_SNAPSHOT_PROOF_FAILED:${firstSeenError?.message ?? lastSeenError?.message ?? 'UNKNOWN'}`);
  }
  if ((firstSeen ?? []).length || (lastSeen ?? []).length) throw new Error('R5_002_R2_ORIGINAL_RUN_HAS_SNAPSHOT_WRITES');

  const { data: recoveryRuns, error: recoveryError } = await adminClient
    .from('unleashed_sync_runs')
    .select('id')
    .contains('metadata', { request_key: R5_002_R2_REQUEST_KEY });
  if (recoveryError) throw new Error(`R5_002_R2_RECOVERY_LOOKUP_FAILED:${recoveryError.message}`);
  if ((recoveryRuns ?? []).length !== 0) throw new Error('R5_002_R2_REQUEST_KEY_ALREADY_USED');
  return String(original.id);
}

Deno.serve(async (req) => {
""",
)

replace_once(
    index,
    """  } catch (error) {
    return json(400, { error: error instanceof Error ? error.message : 'INVALID_REQUEST' });
  }

  let continuationHighWatermark: string | null = null;
""",
    """  } catch (error) {
    return json(400, { error: error instanceof Error ? error.message : 'INVALID_REQUEST' });
  }

  if (requestKey === R5_002_R2_REQUEST_KEY) {
    try {
      const recoveryOf = await verifyR5002R2RecoveryPrerequisites(adminClient);
      return json(409, {
        error: 'R5_002_R2_DORMANT_NOT_ACTIVATED',
        requestKey,
        recoveryOf,
      });
    } catch (error) {
      return json(409, {
        error: 'R5_002_R2_RECOVERY_PREREQUISITE_FAILED',
        details: error instanceof Error ? error.message : 'UNKNOWN',
        requestKey,
      });
    }
  }

  let continuationHighWatermark: string | null = null;
""",
)

Path('scripts/r5-002b-classification-recovery-contract.test.mjs').write_text(r"""import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  POSTGREST_CLASSIFICATION_IN_FILTER_BUDGET,
  classifyPayloadRows,
  partitionExternalKeysForInFilter,
} from '../supabase/functions/trigger-unleashed-readonly-sync/core.ts';

const edgePath = 'supabase/functions/trigger-unleashed-readonly-sync/index.ts';
const panelPath = 'src/features/settings/UnleashedReadonlyProbePanel.tsx';
const [edge, panel] = await Promise.all([
  readFile(edgePath, 'utf8'),
  readFile(panelPath, 'utf8'),
]);

function stockKey(index) {
  const suffix = index.toString(16).padStart(12, '0');
  return `product:00000000-0000-4000-8000-${suffix}:warehouse:5944dad4-74ff-46eb-b9b2-e7669938cb5f`;
}

function encodedChunkLength(chunk) {
  return chunk.reduce((total, key, index) => total + encodeURIComponent(key).length + (index ? 3 : 0), 0);
}

test('200 long StockOnHand keys are partitioned under the encoded PostgREST filter budget', () => {
  const keys = Array.from({ length: 200 }, (_, index) => stockKey(index));
  const chunks = partitionExternalKeysForInFilter(keys);
  assert.ok(chunks.length > 1);
  assert.deepEqual(chunks.flat(), keys);
  assert.equal(new Set(chunks.flat()).size, 200);
  assert.ok(chunks.every((chunk) => encodedChunkLength(chunk) <= POSTGREST_CLASSIFICATION_IN_FILTER_BUDGET));
});

test('classification semantics reconcile inserted/changed/unchanged exactly', () => {
  const rows = Array.from({ length: 200 }, (_, index) => ({
    external_key: stockKey(index),
    payload_sha256: `new-${index}`,
  }));
  const existing = [
    ...rows.slice(0, 70),
    ...rows.slice(70, 130).map((row, index) => ({ ...row, payload_sha256: `old-${index}` })),
  ];
  const result = classifyPayloadRows(existing, rows);
  assert.equal(result.unchanged.length, 70);
  assert.equal(result.changed.length, 60);
  assert.equal(result.inserted.length, 70);
  assert.equal(result.unchanged.length + result.changed.length + result.inserted.length, 200);
});

test('classification chunker rejects pages beyond the connector page bound', () => {
  assert.throws(
    () => partitionExternalKeysForInFilter(Array.from({ length: 201 }, (_, index) => stockKey(index))),
    /CLASSIFICATION_KEY_COUNT_EXCEEDS_PAGE_BOUND/,
  );
});

test('both classification readers are bounded and page commit remains after classification', () => {
  assert.equal((edge.match(/partitionExternalKeysForInFilter\(rows\.map\(\(row\) => row\.external_key\)\)/g) ?? []).length, 2);
  assert.doesNotMatch(edge, /\.in\('external_key', rows\.map\(/);
  const rawClassify = edge.indexOf('async function classifySnapshotRows');
  const identityClassify = edge.indexOf('async function identityRowsNeedingWrite');
  const pageCommit = edge.indexOf("adminClient.rpc('ecoflow_commit_unleashed_snapshot_page'");
  assert.ok(rawClassify >= 0 && identityClassify > rawClassify && pageCommit > identityClassify);
});

test('R5-002-R2 exists only as a dormant server-side recovery carrier', () => {
  assert.match(edge, /R5_002_R2_REQUEST_KEY = 'ECOFLOW-R5-002-R2'/);
  assert.match(edge, /R5_002_R2_DORMANT_NOT_ACTIVATED/);
  assert.match(edge, /R5_002_R2_ORIGINAL_FAILURE_MISMATCH/);
  assert.match(edge, /R5_002_R2_ORIGINAL_RUN_HAS_SNAPSHOT_WRITES/);
  assert.match(edge, /original\.records_staged === 0/);
  assert.match(edge, /original\.error_message\.startsWith\('UNLEASHED_RAW_SNAPSHOT_CLASSIFY_FAILED:'\)/);
  assert.doesNotMatch(panel, /ECOFLOW-R5-002-R2/);
});

test('warehouse MANY production boundary remains frozen', () => {
  assert.match(edge, /input\.body\.pageSize === 200/);
  assert.match(edge, /input\.body\.maxPages === 5/);
  assert.match(edge, /input\.body\.target\.warehouseCode === 'ADL1'/);
  assert.match(edge, /input\.modifiedSince === null/);
  assert.match(edge, /input\.startPage === 1/);
  assert.match(edge, /input\.previousRunId === null/);
  assert.match(edge, /ecoflow_abort_unleashed_warehouse_snapshot_acquisition/);
  assert.match(edge, /ecoflow_release_unleashed_warehouse_snapshot_acquisition/);
});
""")

Path('.github/workflows/r5-002b-classification-recovery.yml').write_text("""name: R5-002B classification recovery

on:
  pull_request:
    paths:
      - 'supabase/functions/trigger-unleashed-readonly-sync/**'
      - 'scripts/r5-002b-classification-recovery-contract.test.mjs'
      - 'docs/engineering/work-packages/ECOFLOW-R5-002B-classification-recovery.md'
      - '.github/workflows/r5-002b-classification-recovery.yml'
  push:
    branches:
      - 'agent/unleashed/r5-002b-*'
    paths:
      - 'supabase/functions/trigger-unleashed-readonly-sync/**'
      - 'scripts/r5-002b-classification-recovery-contract.test.mjs'
      - 'docs/engineering/work-packages/ECOFLOW-R5-002B-classification-recovery.md'
      - '.github/workflows/r5-002b-classification-recovery.yml'

permissions:
  contents: read

jobs:
  contract:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - name: R5-002B contract
        run: node --experimental-strip-types --test scripts/r5-002b-classification-recovery-contract.test.mjs
      - name: Existing Unleashed audit
        run: npm run audit:unleashed
      - name: Typecheck
        run: npm run typecheck
      - name: Production build
        run: npm run build
""")

Path('docs/engineering/work-packages/ECOFLOW-R5-002B-classification-recovery.md').write_text("""# ECOFLOW-R5-002B — bulk snapshot classification repair + dormant recovery carrier

## Baseline

- Protected base: `a3a103a9cfe3ffc66e9bfe06656e243e6b12ba95`.
- Failed live run: `53c8bf37-ff65-473a-ae9f-ec899acc1770`.
- The original request key `ECOFLOW-R5-002` is permanently consumed and must not be replayed.
- Production failure evidence is frozen in #339 comment `5672192072` and #335 comment `5672195570`.

## Root cause and repair

Unleashed returned page 1 successfully with HTTP 200 and 200 ADL1 StockOnHand rows. Before any snapshot write, the Edge function attempted one PostgREST `in.(...)` lookup containing all 200 long `product:<uuid>:warehouse:<uuid>` keys. The generated REST URL failed in transport.

Existing-snapshot and external-identity classification now partition external keys by a conservative encoded filter-value budget of 1,500 bytes. The connector page maximum remains 200 rows. Every classification chunk must succeed before the page commit RPC is reached; any chunk failure therefore prevents partial page staging.

## Dormant R2 carrier

The Edge contract recognizes `ECOFLOW-R5-002-R2` with the same ADL1/page-size/page-count boundary and recovery-specific reason, but it is deliberately non-executable in this package. Before returning `R5_002_R2_DORMANT_NOT_ACTIVATED`, the server proves the original key exists exactly once, the original run failed on the snapshot-classification path after seeing 200 rows, staged zero rows, targeted ADL1, and left no snapshot first/last-seen evidence. It also proves the R2 key has never been used.

There is intentionally no R2 browser control. A later separately authorized activation must make the recovery carrier live.

## Safety boundary

This package authorizes no Unleashed provider request, no R5-002 replay, no R5-002-R2 execution, no inventory-reference STAGE, no INITIAL stocktake, no inventory/warehouse movement, no Product Identity mutation, no Commercial Wave-2 mutation, and no cutover.

## Verification

The dedicated test constructs 200 production-shaped StockOnHand keys, proves deterministic encoded-budget partitioning, proves 70 unchanged + 60 changed + 70 inserted reconciliation, rejects 201-key pages, verifies both classification readers use chunking, and verifies R2 remains dormant. Existing Unleashed audits, typecheck and production build are required on the exact PR head.

## Merge boundary

Engineering PASS is not merge authorization. Merge/deployment remain a separate gate. Even after a later merge/deploy, live R2 provider traffic requires a separate explicit authorization and activation step.
""")

print('R5-002B exact transformations applied')
