import { readFile, writeFile } from 'node:fs/promises';

const indexPath = 'supabase/functions/trigger-unleashed-readonly-sync/index.ts';
const workflowPath = '.github/workflows/unleashed-snapshot-acquisition-fencing-check.yml';
const staticPath = 'scripts/unleashed-snapshot-acquisition-fencing-contract.test.mjs';

function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0) throw new Error(`PATCH_ANCHOR_MISSING:${label}`);
  if (source.indexOf(search, first + search.length) >= 0) throw new Error(`PATCH_ANCHOR_AMBIGUOUS:${label}`);
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

function replaceBetween(source, start, end, replacement, label) {
  const a = source.indexOf(start);
  if (a < 0) throw new Error(`PATCH_START_MISSING:${label}`);
  const b = source.indexOf(end, a + start.length);
  if (b < 0) throw new Error(`PATCH_END_MISSING:${label}`);
  if (source.indexOf(start, a + start.length) >= 0) throw new Error(`PATCH_START_AMBIGUOUS:${label}`);
  return source.slice(0, a) + replacement + source.slice(b);
}

let index = await readFile(indexPath, 'utf8');

index = replaceOnce(
  index,
  "function summarizeHighWatermark(items: Record<string, unknown>[]) {\n  let highWatermark: string | null = null;\n  for (const item of items) {\n    const candidate = readDate(readString(item, ['LastModifiedOn', 'lastModifiedOn']));\n    if (!candidate) continue;\n    if (!highWatermark || candidate > highWatermark) highWatermark = candidate;\n  }\n  return highWatermark;\n}\n\nDeno.serve(async (req) => {",
  "function summarizeHighWatermark(items: Record<string, unknown>[]) {\n  let highWatermark: string | null = null;\n  for (const item of items) {\n    const candidate = readDate(readString(item, ['LastModifiedOn', 'lastModifiedOn']));\n    if (!candidate) continue;\n    if (!highWatermark || candidate > highWatermark) highWatermark = candidate;\n  }\n  return highWatermark;\n}\n\n// Dry-run/recheck evidence is deliberately the only direct batch write left in\n// the Edge Function. Every non-dry snapshot write is fenced by DB-owned RPCs.\nasync function insertDryRunBatch(\n  adminClient: ReturnType<typeof createClient>,\n  row: Record<string, unknown>,\n) {\n  const { data, error } = await adminClient\n    .from('unleashed_sync_batches')\n    .insert(row)\n    .select('id')\n    .single();\n  if (error || !data) throw new Error(`UNLEASHED_DRY_RUN_BATCH_CREATE_FAILED:${error?.message ?? 'UNKNOWN'}`);\n  return data;\n}\n\nDeno.serve(async (req) => {",
  'dry-run batch helper',
);

const loopStart = "  for (const resource of resources) {";
const loopEnd = "  finalStatus = recordsFailed === 0 ? 'SUCCEEDED' : pageResults.length ? 'PARTIAL' : 'FAILED';";
const loopReplacement = `  for (const resource of resources) {
    const definition = RESOURCE_DEFINITIONS[resource];
    const paginatedRequest = definition.paginated && !target?.pathIdentifier;
    const resourceStartPage = paginatedRequest ? startPage : 1;
    const windowEndPage = resourceStartPage + maxPages - 1;
    let pageNumber = resourceStartPage;
    let knownNumberOfPages: number | null = paginatedRequest ? continuationExpectedNumberOfPages : 1;
    let resourceHighWatermark: string | null = paginatedRequest ? continuationHighWatermark : null;
    let resourceFailed = false;
    let resourceFailureEvidenceReady = false;
    let lastPageRead: number | null = null;
    let terminalShortPage = false;
    let acquisitionLeaseToken: string | null = null;

    if (!dryRun) {
      const { data: claimData, error: claimError } = await adminClient.rpc(
        'ecoflow_claim_unleashed_snapshot_acquisition',
        {
          p_run_id: run.id,
          p_resource: resource,
          p_start_page: resourceStartPage,
          p_previous_run_id: previousRunId,
        },
      );
      const claim = isRecord(claimData) ? claimData : null;
      const leaseToken = claim && typeof claim.leaseToken === 'string' ? claim.leaseToken : null;
      if (claimError || !leaseToken) {
        recordsFailed += 1;
        resourceFailed = true;
        finalStatus = pageResults.length ? 'PARTIAL' : 'FAILED';
        finalErrorCode = 'UNLEASHED_ACQUISITION_CLAIM_FAILED';
        finalErrorMessage = claimError?.message?.slice(0, 1000) ?? 'DB-owned Unleashed acquisition lease was not granted';
      } else {
        acquisitionLeaseToken = leaseToken;
      }
    }

    const recordPageFailure = async (input: {
      endpointPath: string;
      pageNumber: number;
      queryParams: Record<string, string>;
      httpStatus: number | null;
      responseSha256: string | null;
      errorCode: string;
      errorMessage: string;
      metadata: Record<string, unknown>;
    }) => {
      if (!dryRun) {
        if (!acquisitionLeaseToken) throw new Error('UNLEASHED_ACQUISITION_LEASE_MISSING');
        const { error } = await adminClient.rpc('ecoflow_record_unleashed_snapshot_page_failure', {
          p_lease_token: acquisitionLeaseToken,
          p_run_id: run.id,
          p_resource: resource,
          p_endpoint_path: input.endpointPath,
          p_page_number: input.pageNumber,
          p_page_size: pageSize,
          p_http_status: input.httpStatus,
          p_response_sha256: input.responseSha256,
          p_query_params: input.queryParams,
          p_error_code: input.errorCode,
          p_error_message: input.errorMessage,
          p_batch_metadata: input.metadata,
        });
        if (error) throw new Error(`UNLEASHED_FENCED_FAILURE_RECORD_FAILED:${error.message}`);
        resourceFailureEvidenceReady = true;
        return;
      }
      await insertDryRunBatch(adminClient, {
        run_id: run.id,
        resource,
        endpoint_path: input.endpointPath,
        page_number: input.pageNumber,
        page_size: pageSize,
        status: 'FAILED',
        responded_at: new Date().toISOString(),
        http_status: input.httpStatus,
        response_sha256: input.responseSha256,
        query_params: input.queryParams,
        error_code: input.errorCode,
        error_message: input.errorMessage,
        metadata: input.metadata,
      });
    };

    while (!resourceFailed && pageNumber <= windowEndPage && pageNumber <= (knownNumberOfPages ?? windowEndPage)) {
      const endpointPath = `/${definition.endpoint}${target?.pathIdentifier ? `/${target.pathIdentifier}` : paginatedRequest ? `/${pageNumber}` : ''}`;
      let queryParams: Record<string, string> = {};
      let httpStatus: number | null = null;
      let responseSha256: string | null = null;
      let fetchAttempts = 0;
      let pageEvidenceCommitted = false;

      try {
        const query = buildQuery(definition, pageSize, modifiedSince, target);
        queryParams = Object.fromEntries(query.entries());
        const queryString = serializeUnleashedQuery(query);
        const url = buildRequestUrl(apiBaseUrl, definition, pageNumber, queryString, target);
        const signature = await hmacSha256Base64(queryString, unleashedApiKey);
        const fetched = await fetchUnleashedWithRetry(url, {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'api-auth-id': unleashedApiId,
          'api-auth-signature': signature,
          'client-type': clientType,
        });
        fetchAttempts = fetched.attempts;
        const response = fetched.response;
        httpStatus = response.status;
        const responseText = await response.text();
        responseSha256 = await sha256Hex(responseText);

        if (!response.ok) {
          recordsFailed += 1;
          resourceFailed = true;
          finalStatus = pageResults.length ? 'PARTIAL' : 'FAILED';
          finalErrorCode = 'UNLEASHED_API_REQUEST_FAILED';
          finalErrorMessage = `${resource} page ${pageNumber} returned HTTP ${response.status}`;
          try {
            await recordPageFailure({
              endpointPath,
              pageNumber,
              queryParams,
              httpStatus,
              responseSha256,
              errorCode: finalErrorCode,
              errorMessage: finalErrorMessage,
              metadata: {
                upstream_body_redacted: true,
                target: target?.audit ?? null,
                fetch_attempts: fetchAttempts,
              },
            });
          } catch (failureError) {
            finalErrorMessage = `${finalErrorMessage}; ${failureError instanceof Error ? failureError.message : 'failure evidence unavailable'}`.slice(0, 1000);
          }
          break;
        }

        let payload: unknown;
        try {
          payload = JSON.parse(responseText);
        } catch {
          recordsFailed += 1;
          resourceFailed = true;
          finalStatus = pageResults.length ? 'PARTIAL' : 'FAILED';
          finalErrorCode = 'UNLEASHED_API_NON_JSON_RESPONSE';
          finalErrorMessage = `${resource} page ${pageNumber} returned a non-JSON response`;
          try {
            await recordPageFailure({
              endpointPath,
              pageNumber,
              queryParams,
              httpStatus,
              responseSha256,
              errorCode: finalErrorCode,
              errorMessage: finalErrorMessage,
              metadata: { target: target?.audit ?? null, fetch_attempts: fetchAttempts },
            });
          } catch (failureError) {
            finalErrorMessage = `${finalErrorMessage}; ${failureError instanceof Error ? failureError.message : 'failure evidence unavailable'}`.slice(0, 1000);
          }
          break;
        }

        const pagination = getPagination(payload);
        const apiNumberOfPages = paginationNumber(pagination, 'NumberOfPages') ?? paginationNumber(pagination, 'numberOfPages');
        if (
          continuationExpectedNumberOfPages !== null
          && apiNumberOfPages !== null
          && apiNumberOfPages !== continuationExpectedNumberOfPages
        ) throw new Error('UNLEASHED_PAGINATION_TOTAL_DRIFT');
        if (apiNumberOfPages !== null && startPage > Math.max(1, apiNumberOfPages)) {
          throw new Error('UNLEASHED_CONTINUATION_PAGE_OUT_OF_RANGE');
        }
        const upstreamItems = getItems(payload, definition, Boolean(target?.pathIdentifier));
        const items = selectTargetItems(upstreamItems, target);
        const pageHighWatermark = summarizeHighWatermark(items);
        if (pageHighWatermark && (!resourceHighWatermark || pageHighWatermark > resourceHighWatermark)) {
          resourceHighWatermark = pageHighWatermark;
        }
        recordsSeen += items.length;

        let stagedOnPage = 0;
        let insertedOnPage = 0;
        let changedOnPage = 0;
        let unchangedOnPage = 0;
        let identityWritesOnPage = 0;
        let semanticRows: SnapshotRow[] = [];
        let identitiesNeedingWrite: IdentityRow[] = [];
        if (!dryRun && items.length) {
          const snapshotRows = await buildSnapshotRows(resource, run.id, items);
          const classifiedRows = await classifySnapshotRows(adminClient, resource, snapshotRows);
          semanticRows = [...classifiedRows.inserted, ...classifiedRows.changed];
          const identityRows: IdentityRow[] = snapshotRows.map((row) => ({
            resource: row.resource,
            external_key: row.external_key,
            external_guid: row.external_guid,
            external_code: row.external_code,
            external_number: row.external_number,
            display_name: row.display_name,
            latest_payload_sha256: row.payload_sha256,
            latest_source_last_modified_at: row.source_last_modified_at,
            first_seen_run_id: run.id,
            last_seen_run_id: run.id,
            metadata: { source: 'unleashed_api' },
          }));
          identitiesNeedingWrite = await identityRowsNeedingWrite(adminClient, resource, identityRows);
          insertedOnPage = classifiedRows.inserted.length;
          changedOnPage = classifiedRows.changed.length;
          unchangedOnPage = classifiedRows.unchanged.length;
          identityWritesOnPage = identitiesNeedingWrite.length;
          stagedOnPage = insertedOnPage + changedOnPage;
        }

        const batchMetadata = {
          dry_run: dryRun,
          target: target?.audit ?? null,
          upstream_records_seen: upstreamItems.length,
          records_inserted: insertedOnPage,
          records_changed: changedOnPage,
          records_unchanged: unchangedOnPage,
          identity_writes: identityWritesOnPage,
          fetch_attempts: fetchAttempts,
        };

        if (!dryRun) {
          if (!acquisitionLeaseToken) throw new Error('UNLEASHED_ACQUISITION_LEASE_MISSING');
          const { error: commitError } = await adminClient.rpc('ecoflow_commit_unleashed_snapshot_page', {
            p_lease_token: acquisitionLeaseToken,
            p_run_id: run.id,
            p_resource: resource,
            p_endpoint_path: endpointPath,
            p_page_number: pageNumber,
            p_page_size: pageSize,
            p_http_status: response.status,
            p_records_seen: items.length,
            p_records_staged: stagedOnPage,
            p_response_sha256: responseSha256,
            p_query_params: queryParams,
            p_pagination: pagination,
            p_batch_metadata: batchMetadata,
            p_snapshot_rows: semanticRows,
            p_identity_rows: identitiesNeedingWrite,
          });
          if (commitError) throw new Error(`UNLEASHED_FENCED_PAGE_COMMIT_FAILED:${commitError.message}`);
        } else {
          await insertDryRunBatch(adminClient, {
            run_id: run.id,
            resource,
            endpoint_path: endpointPath,
            page_number: pageNumber,
            page_size: pageSize,
            status: 'SUCCEEDED',
            responded_at: new Date().toISOString(),
            http_status: response.status,
            records_seen: items.length,
            records_staged: 0,
            response_sha256: responseSha256,
            query_params: queryParams,
            pagination,
            metadata: batchMetadata,
          });
        }
        pageEvidenceCommitted = true;

        recordsStaged += stagedOnPage;
        recordsInserted += insertedOnPage;
        recordsChanged += changedOnPage;
        recordsUnchanged += unchangedOnPage;
        lastPageRead = pageNumber;

        pageResults.push({
          resource,
          endpointPath,
          pageNumber,
          pageSize,
          httpStatus: response.status,
          responseSha256,
          pagination,
          recordsSeen: items.length,
          recordsStaged: stagedOnPage,
          recordsInserted: insertedOnPage,
          recordsChanged: changedOnPage,
          recordsUnchanged: unchangedOnPage,
          fetchAttempts,
          highWatermark: pageHighWatermark,
        });

        if (apiNumberOfPages !== null) knownNumberOfPages = Math.max(1, apiNumberOfPages);
        terminalShortPage = upstreamItems.length < pageSize;
        if (!paginatedRequest || terminalShortPage) break;
        pageNumber += 1;
      } catch (error) {
        recordsFailed += 1;
        resourceFailed = true;
        finalStatus = pageResults.length ? 'PARTIAL' : 'FAILED';
        finalErrorCode = 'UNLEASHED_CONNECTOR_PAGE_FAILED';
        finalErrorMessage = error instanceof Error ? error.message.slice(0, 1000) : 'Unknown Unleashed connector failure';
        if (!pageEvidenceCommitted) {
          try {
            await recordPageFailure({
              endpointPath,
              pageNumber,
              queryParams,
              httpStatus,
              responseSha256,
              errorCode: finalErrorCode,
              errorMessage: finalErrorMessage,
              metadata: { target: target?.audit ?? null, fetch_attempts: fetchAttempts },
            });
          } catch (failureError) {
            finalErrorMessage = `${finalErrorMessage}; ${failureError instanceof Error ? failureError.message : 'failure evidence unavailable'}`.slice(0, 1000);
          }
        }
        break;
      }
    }

    const summarizedWindow = summarizePaginationWindow({
      paginated: paginatedRequest,
      startPage: resourceStartPage,
      lastPageRead,
      numberOfPages: knownNumberOfPages,
      terminalShortPage,
      failed: resourceFailed,
      highWatermark: resourceHighWatermark,
    });
    const windowEvidence: ResourceWindowResult = { resource, ...summarizedWindow };
    resourceWindows.push(windowEvidence);

    if (!dryRun && acquisitionLeaseToken) {
      if (target) {
        if (!resourceFailed || resourceFailureEvidenceReady) {
          const { error: releaseError } = await adminClient.rpc(
            'ecoflow_release_unleashed_targeted_snapshot_acquisition',
            { p_lease_token: acquisitionLeaseToken, p_run_id: run.id, p_resource: resource },
          );
          if (releaseError) {
            recordsFailed += resourceFailed ? 0 : 1;
            resourceFailed = true;
            finalErrorCode = 'UNLEASHED_TARGET_ACQUISITION_RELEASE_FAILED';
            finalErrorMessage = releaseError.message.slice(0, 1000);
          }
        }
      } else if (!resourceFailed || resourceFailureEvidenceReady) {
        const cursorStatus = resourceFailed ? 'FAILED' : windowEvidence.windowComplete ? 'READY' : 'RUNNING';
        const { error: finalizeError } = await adminClient.rpc('ecoflow_finalize_unleashed_snapshot_resource', {
          p_lease_token: acquisitionLeaseToken,
          p_run_id: run.id,
          p_resource: resource,
          p_cursor_status: cursorStatus,
          p_window: {
            start_page: windowEvidence.startPage,
            last_page: windowEvidence.lastPage,
            number_of_pages: windowEvidence.numberOfPages,
            window_complete: windowEvidence.windowComplete,
            next_page: windowEvidence.nextPage,
            previous_run_id: previousRunId,
            high_watermark: windowEvidence.highWatermark,
          },
          p_requested_modified_since: modifiedSince,
          p_high_watermark: resourceHighWatermark,
          p_error_code: resourceFailed ? finalErrorCode : null,
          p_error_message: resourceFailed ? finalErrorMessage : null,
        });
        if (finalizeError) {
          recordsFailed += resourceFailed ? 0 : 1;
          resourceFailed = true;
          finalErrorCode = 'UNLEASHED_ACQUISITION_FINALIZE_FAILED';
          finalErrorMessage = finalizeError.message.slice(0, 1000);
        }
      }
    }

    if (resourceFailed) {
      failedResources.push(resource);
      continue;
    }
  }

`;
index = replaceBetween(index, loopStart, loopEnd, loopReplacement, 'resource acquisition loop');
await writeFile(indexPath, index);

const staticTest = `import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const index = await readFile('supabase/functions/trigger-unleashed-readonly-sync/index.ts', 'utf8');
const migration = await readFile('supabase/migrations/20260902041500_unleashed_snapshot_acquisition_fencing.sql', 'utf8');

const rpcNames = [
  'ecoflow_claim_unleashed_snapshot_acquisition',
  'ecoflow_commit_unleashed_snapshot_page',
  'ecoflow_record_unleashed_snapshot_page_failure',
  'ecoflow_finalize_unleashed_snapshot_resource',
  'ecoflow_release_unleashed_targeted_snapshot_acquisition',
];

test('non-dry Unleashed acquisition authority is DB-fenced', () => {
  for (const name of rpcNames) assert.match(index, new RegExp(name));
  assert.doesNotMatch(index, /from\('unleashed_raw_snapshots'\)[\s\S]{0,120}\.upsert\(/);
  assert.doesNotMatch(index, /from\('unleashed_external_identities'\)[\s\S]{0,120}\.upsert\(/);
  assert.doesNotMatch(index, /from\('unleashed_resource_cursors'\)[\s\S]{0,120}\.upsert\(/);
  assert.equal((index.match(/from\('unleashed_sync_batches'\)/g) ?? []).length, 1);
  assert.match(index, /async function insertDryRunBatch[\s\S]*from\('unleashed_sync_batches'\)/);
  assert.match(index, /if \(!dryRun\) \{[\s\S]{0,900}ecoflow_claim_unleashed_snapshot_acquisition/);
  assert.match(index, /ecoflow_claim_unleashed_snapshot_acquisition[\s\S]*fetchUnleashedWithRetry/);
});

test('targeted writes release fencing without resource cursor finalization', () => {
  assert.match(index, /if \(target\) \{[\s\S]{0,700}ecoflow_release_unleashed_targeted_snapshot_acquisition/);
  assert.match(migration, /UNLEASHED_TARGET_ACQUISITION_REQUIRES_RELEASE/);
  assert.match(migration, /ecoflow_release_unleashed_targeted_snapshot_acquisition/);
});

test('dry-run remains read-only while preserving reconciliation evidence', () => {
  assert.match(index, /if \(!dryRun\)[\s\S]*ecoflow_commit_unleashed_snapshot_page/);
  assert.match(index, /else \{\s*await insertDryRunBatch/);
  assert.match(index, /if \(!dryRun && acquisitionLeaseToken\)/);
  assert.doesNotMatch(index, /leaseToken[\s\S]{0,100}after_data/);
  assert.doesNotMatch(index, /leaseToken[\s\S]{0,100}return json/);
});

test('fencing RPCs are service-role only and connector bounds stay unchanged', () => {
  for (const name of rpcNames) {
    assert.match(migration, new RegExp('revoke all on function public\\.' + name));
    assert.match(migration, new RegExp('grant execute on function public\\.' + name + '[^;]* to service_role'));
  }
  assert.match(index, /const HARD_MAX_PAGE_SIZE = 200/);
  assert.match(index, /const HARD_MAX_PAGES = 5/);
  assert.match(index, /allowed_methods: \['GET'\]/);
});
`;
await writeFile(staticPath, staticTest);

let workflow = await readFile(workflowPath, 'utf8');
workflow = workflow.replace(
  "      - name: Run fencing static contract if present\n        run: |\n          if test -f scripts/unleashed-snapshot-acquisition-fencing-contract.test.mjs; then\n            node --experimental-strip-types --test scripts/unleashed-snapshot-acquisition-fencing-contract.test.mjs\n          fi",
  "      - name: Run connector and fencing regressions\n        run: |\n          node --experimental-strip-types --test \\\n            scripts/unleashed-readonly-connector-contract.test.mjs \\\n            scripts/unleashed-readonly-connector-core.test.mjs \\\n            scripts/unleashed-readonly-killswitch-retention.test.mjs \\\n            scripts/unleashed-snapshot-acquisition-fencing-contract.test.mjs",
);
if (!workflow.includes('Run connector and fencing regressions')) throw new Error('WORKFLOW_PATCH_FAILED');
await writeFile(workflowPath, workflow);

console.log('Unleashed Edge fencing integration staged');
