import { readFile, writeFile } from 'node:fs/promises';

function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0) throw new Error(`PATCH_ANCHOR_MISSING:${label}`);
  if (source.indexOf(search, first + search.length) >= 0) throw new Error(`PATCH_ANCHOR_AMBIGUOUS:${label}`);
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

async function patch(path, transform) {
  const before = await readFile(path, 'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`PATCH_NO_CHANGE:${path}`);
  await writeFile(path, after);
}

await patch('supabase/functions/trigger-unleashed-readonly-sync/core.ts', (source) => {
  if (source.includes('export function summarizePaginationWindow')) return source;
  return `${source}\n\nexport type PaginationWindowSummary = {\n  startPage: number;\n  lastPage: number | null;\n  numberOfPages: number | null;\n  windowComplete: boolean;\n  nextPage: number | null;\n  highWatermark: string | null;\n};\n\nexport function summarizePaginationWindow(input: {\n  paginated: boolean;\n  startPage: number;\n  lastPageRead: number | null;\n  numberOfPages: number | null;\n  terminalShortPage: boolean;\n  failed: boolean;\n  highWatermark: string | null;\n}): PaginationWindowSummary {\n  const windowComplete = !input.failed && (\n    !input.paginated\n    || (input.lastPageRead !== null && (\n      (input.numberOfPages !== null && input.lastPageRead >= input.numberOfPages)\n      || input.terminalShortPage\n    ))\n  );\n  return {\n    startPage: input.paginated ? input.startPage : 1,\n    lastPage: input.lastPageRead,\n    numberOfPages: input.numberOfPages,\n    windowComplete,\n    nextPage: windowComplete || input.failed || input.lastPageRead === null ? null : input.lastPageRead + 1,\n    highWatermark: input.highWatermark,\n  };\n}\n`;
});

await patch('scripts/unleashed-readonly-connector-core.test.mjs', (source) => {
  source = replaceOnce(
    source,
    "  sourceIdentityForItem,\n} from '../supabase/functions/trigger-unleashed-readonly-sync/core.ts';",
    "  sourceIdentityForItem,\n  summarizePaginationWindow,\n} from '../supabase/functions/trigger-unleashed-readonly-sync/core.ts';",
    'core-test-import',
  );
  if (source.includes("test('pagination windows distinguish bounded success from complete coverage'")) return source;
  return `${source}\n\ntest('pagination windows distinguish bounded success from complete coverage', () => {\n  assert.deepEqual(summarizePaginationWindow({\n    paginated: true,\n    startPage: 1,\n    lastPageRead: 5,\n    numberOfPages: 12,\n    terminalShortPage: false,\n    failed: false,\n    highWatermark: '2026-09-02T00:00:00.000Z',\n  }), {\n    startPage: 1,\n    lastPage: 5,\n    numberOfPages: 12,\n    windowComplete: false,\n    nextPage: 6,\n    highWatermark: '2026-09-02T00:00:00.000Z',\n  });\n\n  assert.deepEqual(summarizePaginationWindow({\n    paginated: true,\n    startPage: 11,\n    lastPageRead: 12,\n    numberOfPages: 12,\n    terminalShortPage: false,\n    failed: false,\n    highWatermark: '2026-09-02T01:00:00.000Z',\n  }), {\n    startPage: 11,\n    lastPage: 12,\n    numberOfPages: 12,\n    windowComplete: true,\n    nextPage: null,\n    highWatermark: '2026-09-02T01:00:00.000Z',\n  });\n\n  assert.equal(summarizePaginationWindow({\n    paginated: true,\n    startPage: 6,\n    lastPageRead: 7,\n    numberOfPages: null,\n    terminalShortPage: true,\n    failed: false,\n    highWatermark: null,\n  }).windowComplete, true);\n\n  assert.deepEqual(summarizePaginationWindow({\n    paginated: true,\n    startPage: 6,\n    lastPageRead: 6,\n    numberOfPages: 12,\n    terminalShortPage: false,\n    failed: true,\n    highWatermark: null,\n  }).nextPage, null);\n});\n`;
});

await patch('supabase/functions/trigger-unleashed-readonly-sync/index.ts', (source) => {
  source = replaceOnce(
    source,
    "  selectTargetItems,\n  sourceIdentityForItem,\n  type NormalizedTarget,",
    "  selectTargetItems,\n  sourceIdentityForItem,\n  summarizePaginationWindow,\n  type NormalizedTarget,",
    'index-import',
  );
  source = replaceOnce(
    source,
    "const modifiedSincePattern = /^\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,7})?Z?)?$/;",
    "const modifiedSincePattern = /^\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,7})?Z?)?$/;\nconst runIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;",
    'run-id-pattern',
  );
  source = replaceOnce(
    source,
    "  pageSize?: number;\n  maxPages?: number;\n  target?: unknown;",
    "  pageSize?: number;\n  maxPages?: number;\n  startPage?: number;\n  previousRunId?: string | null;\n  target?: unknown;",
    'request-body',
  );
  source = replaceOnce(
    source,
    "type PageResult = {\n  resource: ResourceName;\n  endpointPath: string;\n  pageNumber: number;\n  pageSize: number;\n  httpStatus: number;\n  responseSha256: string;\n  pagination: Record<string, unknown>;\n  recordsSeen: number;\n  recordsStaged: number;\n  recordsInserted: number;\n  recordsChanged: number;\n  recordsUnchanged: number;\n  fetchAttempts: number;\n  highWatermark: string | null;\n};",
    "type PageResult = {\n  resource: ResourceName;\n  endpointPath: string;\n  pageNumber: number;\n  pageSize: number;\n  httpStatus: number;\n  responseSha256: string;\n  pagination: Record<string, unknown>;\n  recordsSeen: number;\n  recordsStaged: number;\n  recordsInserted: number;\n  recordsChanged: number;\n  recordsUnchanged: number;\n  fetchAttempts: number;\n  highWatermark: string | null;\n};\n\ntype ResourceWindowResult = {\n  resource: ResourceName;\n  startPage: number;\n  lastPage: number | null;\n  numberOfPages: number | null;\n  windowComplete: boolean;\n  nextPage: number | null;\n  highWatermark: string | null;\n};",
    'window-result-type',
  );
  source = replaceOnce(
    source,
    "function normalizeModifiedSince(value: unknown) {\n  if (value === undefined || value === null || value === '') return null;\n  if (typeof value !== 'string') throw new Error('INVALID_MODIFIED_SINCE');\n  const trimmed = value.trim();\n  if (!modifiedSincePattern.test(trimmed)) throw new Error('INVALID_MODIFIED_SINCE');\n  return trimmed;\n}",
    "function normalizeModifiedSince(value: unknown) {\n  if (value === undefined || value === null || value === '') return null;\n  if (typeof value !== 'string') throw new Error('INVALID_MODIFIED_SINCE');\n  const trimmed = value.trim();\n  if (!modifiedSincePattern.test(trimmed)) throw new Error('INVALID_MODIFIED_SINCE');\n  return trimmed;\n}\n\nfunction normalizePreviousRunId(value: unknown) {\n  if (value === undefined || value === null || value === '') return null;\n  if (typeof value !== 'string' || !runIdPattern.test(value.trim())) throw new Error('INVALID_PREVIOUS_RUN_ID');\n  return value.trim().toLowerCase();\n}",
    'previous-run-normalizer',
  );
  source = replaceOnce(
    source,
    "  let pageSize: number;\n  let maxPages: number;\n  let target: NormalizedTarget | null;\n  try {",
    "  let pageSize: number;\n  let maxPages: number;\n  let startPage: number;\n  let previousRunId: string | null;\n  let target: NormalizedTarget | null;\n  const dryRun = body.dryRun !== false;\n  try {",
    'request-vars',
  );
  source = replaceOnce(
    source,
    "    maxPages = mode === 'probe' || target\n      ? 1\n      : normalizeInteger(body.maxPages, DEFAULT_MAX_PAGES, 1, HARD_MAX_PAGES, 'INVALID_MAX_PAGES');\n  } catch (error) {",
    "    maxPages = mode === 'probe' || target\n      ? 1\n      : normalizeInteger(body.maxPages, DEFAULT_MAX_PAGES, 1, HARD_MAX_PAGES, 'INVALID_MAX_PAGES');\n    startPage = mode === 'probe' || target\n      ? 1\n      : normalizeInteger(body.startPage, 1, 1, 1_000_000, 'INVALID_START_PAGE');\n    previousRunId = normalizePreviousRunId(body.previousRunId);\n    if ((mode === 'probe' || target) && body.startPage !== undefined && body.startPage !== 1) {\n      throw new Error('START_PAGE_NOT_ALLOWED_FOR_PROBE_OR_TARGET');\n    }\n    if (startPage === 1 && previousRunId) throw new Error('PREVIOUS_RUN_REQUIRES_CONTINUATION');\n    if (startPage > 1) {\n      if (resources.length !== 1) throw new Error('CONTINUATION_REQUIRES_ONE_RESOURCE');\n      if (!RESOURCE_DEFINITIONS[resources[0]].paginated) throw new Error('CONTINUATION_REQUIRES_PAGINATED_RESOURCE');\n      if (modifiedSince) throw new Error('CONTINUATION_WITH_MODIFIED_SINCE_UNSUPPORTED');\n      if (!previousRunId) throw new Error('CONTINUATION_PREVIOUS_RUN_REQUIRED');\n    }\n  } catch (error) {",
    'pagination-normalization',
  );
  source = replaceOnce(
    source,
    "\n  const dryRun = body.dryRun !== false;\n  const unleashedApiId = Deno.env.get('UNLEASHED_API_ID');",
    "\n  let continuationHighWatermark: string | null = null;\n  let continuationExpectedNumberOfPages: number | null = null;\n  if (previousRunId) {\n    const { data: previousRun, error: previousRunError } = await adminClient\n      .from('unleashed_sync_runs')\n      .select('id,status,requested_by,dry_run,resource_set,requested_modified_since,page_size,metadata')\n      .eq('id', previousRunId)\n      .maybeSingle();\n    if (previousRunError || !previousRun) return json(400, { error: 'CONTINUATION_PREVIOUS_RUN_NOT_FOUND' });\n    const previousMetadata = isRecord(previousRun.metadata) ? previousRun.metadata : {};\n    const previousWindows = Array.isArray(previousMetadata.pagination_windows)\n      ? previousMetadata.pagination_windows.filter(isRecord)\n      : [];\n    const previousWindow = previousWindows.find((entry) => entry.resource === resources[0]);\n    const previousNextPage = previousWindow && typeof previousWindow.next_page === 'number' ? previousWindow.next_page : null;\n    const previousNumberOfPages = previousWindow && typeof previousWindow.number_of_pages === 'number'\n      ? previousWindow.number_of_pages\n      : null;\n    const previousHighWatermark = previousWindow && typeof previousWindow.high_watermark === 'string'\n      ? previousWindow.high_watermark\n      : null;\n    const sameResource = Array.isArray(previousRun.resource_set)\n      && previousRun.resource_set.length === 1\n      && previousRun.resource_set[0] === resources[0];\n    if (\n      previousRun.status !== 'SUCCEEDED'\n      || previousRun.requested_by !== userData.user.id\n      || previousRun.dry_run !== dryRun\n      || !sameResource\n      || previousRun.requested_modified_since !== null\n      || previousRun.page_size !== pageSize\n      || previousWindow?.window_complete !== false\n      || previousNextPage !== startPage\n    ) {\n      return json(400, { error: 'CONTINUATION_PREVIOUS_RUN_MISMATCH' });\n    }\n    continuationHighWatermark = previousHighWatermark;\n    continuationExpectedNumberOfPages = previousNumberOfPages;\n  }\n\n  const unleashedApiId = Deno.env.get('UNLEASHED_API_ID');",
    'continuation-anchor-validation',
  );
  source = replaceOnce(
    source,
    "        target: target?.audit ?? null,\n      },\n    })",
    "        target: target?.audit ?? null,\n        pagination_window: { start_page: startPage, max_pages: maxPages, previous_run_id: previousRunId },\n      },\n    })",
    'run-create-metadata',
  );
  source = replaceOnce(
    source,
    "        pageSize,\n        maxPages,\n        status: 'FAILED',",
    "        pageSize,\n        maxPages,\n        startPage,\n        previousRunId,\n        status: 'FAILED',",
    'missing-secrets-audit',
  );
  source = replaceOnce(
    source,
    "  const failedResources: ResourceName[] = [];\n  let finalStatus:",
    "  const failedResources: ResourceName[] = [];\n  const resourceWindows: ResourceWindowResult[] = [];\n  let finalStatus:",
    'resource-window-array',
  );
  source = replaceOnce(
    source,
    "    const paginatedRequest = definition.paginated && !target?.pathIdentifier;\n    let pageNumber = 1;\n    let knownNumberOfPages: number | null = paginatedRequest ? null : 1;\n    let resourceHighWatermark: string | null = null;\n    let resourceFailed = false;\n\n    while (pageNumber <= maxPages && pageNumber <= (knownNumberOfPages ?? maxPages)) {",
    "    const paginatedRequest = definition.paginated && !target?.pathIdentifier;\n    const resourceStartPage = paginatedRequest ? startPage : 1;\n    const windowEndPage = resourceStartPage + maxPages - 1;\n    let pageNumber = resourceStartPage;\n    let knownNumberOfPages: number | null = paginatedRequest ? continuationExpectedNumberOfPages : 1;\n    let resourceHighWatermark: string | null = paginatedRequest ? continuationHighWatermark : null;\n    let resourceFailed = false;\n    let lastPageRead: number | null = null;\n    let terminalShortPage = false;\n\n    while (pageNumber <= windowEndPage && pageNumber <= (knownNumberOfPages ?? windowEndPage)) {",
    'page-window-loop',
  );
  source = replaceOnce(
    source,
    "        const pagination = getPagination(payload);\n        const upstreamItems = getItems(payload, definition, Boolean(target?.pathIdentifier));",
    "        const pagination = getPagination(payload);\n        const apiNumberOfPages = paginationNumber(pagination, 'NumberOfPages') ?? paginationNumber(pagination, 'numberOfPages');\n        if (\n          continuationExpectedNumberOfPages !== null\n          && apiNumberOfPages !== null\n          && apiNumberOfPages !== continuationExpectedNumberOfPages\n        ) throw new Error('UNLEASHED_PAGINATION_TOTAL_DRIFT');\n        if (apiNumberOfPages !== null && startPage > Math.max(1, apiNumberOfPages)) {\n          throw new Error('UNLEASHED_CONTINUATION_PAGE_OUT_OF_RANGE');\n        }\n        const upstreamItems = getItems(payload, definition, Boolean(target?.pathIdentifier));",
    'pagination-drift-check',
  );
  source = replaceOnce(
    source,
    "        const apiNumberOfPages = paginationNumber(pagination, 'NumberOfPages') ?? paginationNumber(pagination, 'numberOfPages');\n        if (apiNumberOfPages !== null) knownNumberOfPages = Math.max(1, apiNumberOfPages);\n        if (!paginatedRequest || upstreamItems.length < pageSize) break;\n        pageNumber += 1;",
    "        lastPageRead = pageNumber;\n        if (apiNumberOfPages !== null) knownNumberOfPages = Math.max(1, apiNumberOfPages);\n        terminalShortPage = upstreamItems.length < pageSize;\n        if (!paginatedRequest || terminalShortPage) break;\n        pageNumber += 1;",
    'page-advance',
  );
  source = replaceOnce(
    source,
    "    if (!dryRun) {\n      await adminClient.from('unleashed_resource_cursors').upsert({\n        resource,\n        cursor_status: resourceFailed ? 'FAILED' : 'READY',\n        last_successful_run_id: resourceFailed ? null : run.id,\n        last_successful_at: resourceFailed ? null : new Date().toISOString(),\n        last_successful_modified_since: resourceFailed ? null : modifiedSince,\n        high_watermark_at: resourceFailed ? null : resourceHighWatermark,\n        next_modified_since: resourceFailed ? null : resourceHighWatermark,\n        last_error_code: resourceFailed ? finalErrorCode : null,\n        last_error_message: resourceFailed ? finalErrorMessage : null,\n        metadata: { dry_run: dryRun, target: target?.audit ?? null },\n      }, { onConflict: 'resource' });\n    }",
    "    const summarizedWindow = summarizePaginationWindow({\n      paginated: paginatedRequest,\n      startPage: resourceStartPage,\n      lastPageRead,\n      numberOfPages: knownNumberOfPages,\n      terminalShortPage,\n      failed: resourceFailed,\n      highWatermark: resourceHighWatermark,\n    });\n    const windowEvidence: ResourceWindowResult = { resource, ...summarizedWindow };\n    resourceWindows.push(windowEvidence);\n\n    if (!dryRun) {\n      const cursorMetadata = {\n        dry_run: dryRun,\n        target: target?.audit ?? null,\n        pagination_window: {\n          start_page: windowEvidence.startPage,\n          last_page: windowEvidence.lastPage,\n          number_of_pages: windowEvidence.numberOfPages,\n          window_complete: windowEvidence.windowComplete,\n          next_page: windowEvidence.nextPage,\n          previous_run_id: previousRunId,\n          high_watermark: windowEvidence.highWatermark,\n        },\n      };\n      if (resourceFailed) {\n        await adminClient.from('unleashed_resource_cursors').upsert({\n          resource,\n          cursor_status: 'FAILED',\n          last_successful_run_id: null,\n          last_successful_at: null,\n          last_successful_modified_since: null,\n          high_watermark_at: null,\n          next_modified_since: null,\n          last_error_code: finalErrorCode,\n          last_error_message: finalErrorMessage,\n          metadata: cursorMetadata,\n        }, { onConflict: 'resource' });\n      } else if (windowEvidence.windowComplete) {\n        await adminClient.from('unleashed_resource_cursors').upsert({\n          resource,\n          cursor_status: 'READY',\n          last_successful_run_id: run.id,\n          last_successful_at: new Date().toISOString(),\n          last_successful_modified_since: modifiedSince,\n          high_watermark_at: resourceHighWatermark,\n          next_modified_since: resourceHighWatermark,\n          last_error_code: null,\n          last_error_message: null,\n          metadata: cursorMetadata,\n        }, { onConflict: 'resource' });\n      } else {\n        await adminClient.from('unleashed_resource_cursors').upsert({\n          resource,\n          cursor_status: 'RUNNING',\n          last_error_code: null,\n          last_error_message: null,\n          metadata: cursorMetadata,\n        }, { onConflict: 'resource' });\n      }\n    }",
    'cursor-window-semantics',
  );
  source = replaceOnce(
    source,
    "  finalStatus = recordsFailed === 0 ? 'SUCCEEDED' : pageResults.length ? 'PARTIAL' : 'FAILED';\n\n  const { error: updateError }",
    "  finalStatus = recordsFailed === 0 ? 'SUCCEEDED' : pageResults.length ? 'PARTIAL' : 'FAILED';\n  const allResourcesComplete = failedResources.length === 0\n    && resourceWindows.length === resources.length\n    && resourceWindows.every((window) => window.windowComplete);\n\n  const { error: updateError }",
    'all-resources-complete',
  );
  source = replaceOnce(
    source,
    "      failed_resources: failedResources,\n    },\n  }).eq('id', run.id);",
    "      failed_resources: failedResources,\n      all_resources_complete: allResourcesComplete,\n      pagination_windows: resourceWindows.map((window) => ({\n        resource: window.resource,\n        start_page: window.startPage,\n        last_page: window.lastPage,\n        number_of_pages: window.numberOfPages,\n        window_complete: window.windowComplete,\n        next_page: window.nextPage,\n        previous_run_id: previousRunId,\n        high_watermark: window.highWatermark,\n      })),\n    },\n  }).eq('id', run.id);",
    'final-run-metadata',
  );
  source = replaceOnce(
    source,
    "      maxPages,\n      target: target?.audit ?? null,\n      status: finalStatus,",
    "      maxPages,\n      startPage,\n      previousRunId,\n      target: target?.audit ?? null,\n      status: finalStatus,",
    'audit-request-window',
  );
  source = replaceOnce(
    source,
    "      failedResources,\n    },\n    user_agent:",
    "      failedResources,\n      allResourcesComplete,\n      paginationWindows: resourceWindows,\n    },\n    user_agent:",
    'audit-window-evidence',
  );
  source = replaceOnce(
    source,
    "    pageSize,\n    maxPages,\n    target: target?.audit ?? null,",
    "    pageSize,\n    maxPages,\n    startPage,\n    previousRunId,\n    allResourcesComplete,\n    paginationWindows: resourceWindows,\n    target: target?.audit ?? null,",
    'response-window-evidence',
  );
  return source;
});

await patch('scripts/unleashed-readonly-connector-contract.test.mjs', (source) => {
  if (source.includes("test('windowed continuation is chained and cannot promote an incomplete cursor'")) return source;
  return `${source}\n\ntest('windowed continuation is chained and cannot promote an incomplete cursor', () => {\n  assert.match(edgeFunction, /const HARD_MAX_PAGES = 5/);\n  assert.match(edgeFunction, /startPage\\?: number/);\n  assert.match(edgeFunction, /previousRunId\\?: string \\| null/);\n  assert.match(edgeFunction, /CONTINUATION_REQUIRES_ONE_RESOURCE/);\n  assert.match(edgeFunction, /CONTINUATION_WITH_MODIFIED_SINCE_UNSUPPORTED/);\n  assert.match(edgeFunction, /CONTINUATION_PREVIOUS_RUN_REQUIRED/);\n  assert.match(edgeFunction, /CONTINUATION_PREVIOUS_RUN_MISMATCH/);\n  assert.match(edgeFunction, /previousNextPage !== startPage/);\n  assert.match(edgeFunction, /UNLEASHED_PAGINATION_TOTAL_DRIFT/);\n  assert.match(edgeFunction, /const windowEndPage = resourceStartPage \\+ maxPages - 1/);\n  assert.match(edgeFunction, /cursor_status: 'RUNNING'/);\n  assert.match(edgeFunction, /else if \\(windowEvidence\\.windowComplete\\)[\\s\\S]*cursor_status: 'READY'/);\n  assert.match(edgeFunction, /all_resources_complete: allResourcesComplete/);\n  assert.match(edgeFunction, /pagination_windows: resourceWindows\\.map/);\n  assert.match(edgeFunction, /next_modified_since: resourceHighWatermark/);\n});\n`;
});

console.log('Unleashed windowed continuation patch staged.');
