import { extractArray as extractOrders, extractOrderIdentity, hasNextPage } from './ordermentum-full-sync-core.mjs';
import { extractArray as extractMaster, extractExternalId, extractTimestamp, hashPayload } from './ordermentum-master-data-common.mjs';
import { hashCanonicalPayload } from './ordermentum-api-key-probe.mjs';
import { extractOrderDates, extractOrderStatus } from './ordermentum-sync-common.mjs';
import { projectPurchaserToStoreRow } from './ordermentum-targeted-store-sync-core.mjs';
import { assertOrdermentumApiKeyRequestShape, assertOrdermentumApiRequestUrl, assertNoCredentialedOrdermentumRedirect } from './ordermentum-api-origin-guard.mjs';
import { sha256 } from './ordermentum-shadow-manifest.mjs';

const MISSING_ID_SENTINEL = '__ORDERMENTUM_359_C_MISSING_ID__';

function hold(message, code = 'ORDERMENTUM_C_SHADOW_HOLD', progress = null) {
  const error = new Error(message);
  error.code = code;
  if (progress) error.progress = { ...progress };
  throw error;
}

function withProgress(error, counts) {
  if (error && typeof error === 'object' && !error.progress) error.progress = { ...counts };
  return error;
}

function requestTimeout(manifest, deadlineEpochMs, counts) {
  const remaining = deadlineEpochMs - Date.now();
  if (remaining <= 0) hold('Window runtime cap exceeded.', 'ORDERMENTUM_C_WINDOW_CAP', counts);
  return Math.max(1, Math.min(manifest.limits.request_timeout_ms, remaining));
}

function reservePairBudget(manifest, counts, reserveRows) {
  if (counts.current_get + counts.legacy_get + 2 > manifest.limits.max_gets_per_window) {
    hold('GET request budget exhausted before dispatch.', 'ORDERMENTUM_C_REQUEST_CAP', counts);
  }
  if (counts.rows + reserveRows > manifest.limits.max_rows_per_window) {
    hold('Row budget exhausted before dispatch.', 'ORDERMENTUM_C_ROW_CAP', counts);
  }
  const remainingBytes = manifest.limits.max_decoded_bytes_per_window - counts.decoded_bytes;
  if (remainingBytes < 2) hold('Decoded byte budget exhausted before dispatch.', 'ORDERMENTUM_C_AGGREGATE_CAP', counts);
  return Math.min(manifest.limits.max_response_bytes, Math.floor(remainingBytes / 2));
}

export function buildListUrl(manifest, resource, window, supplierId, page) {
  const url = new URL(resource.list_path, manifest.approved_origins.current);
  url.searchParams.set(manifest.query.page_parameter, String(page));
  url.searchParams.set(manifest.query.page_size_parameter, String(manifest.limits.page_size));
  if (resource.supplier_filter) url.searchParams.set(manifest.query.supplier_parameter, supplierId);
  if (resource.window_filter) {
    url.searchParams.set(manifest.query.window_from_parameter, window.from);
    url.searchParams.set(manifest.query.window_to_parameter, window.to);
  }
  return assertOrdermentumApiRequestUrl(url.toString());
}

export function extractResourceItems(resourceName, payload) {
  return resourceName === 'orders' ? extractOrders(payload) : extractMaster(payload, resourceName);
}

export function stableIdentity(resourceName, item) {
  if (resourceName === 'orders') return String(extractOrderIdentity(item).id || '');
  const externalId = String(extractExternalId(item, MISSING_ID_SENTINEL) || '');
  return externalId.startsWith(`${MISSING_ID_SENTINEL}_`) ? '' : externalId;
}

export function canonicalProjection(resourceName, item, context = {}) {
  if (resourceName === 'orders') return { identity: extractOrderIdentity(item), dates: extractOrderDates(item), status: extractOrderStatus(item) };
  if (resourceName === 'purchaser_detail') return projectPurchaserToStoreRow(item, stableIdentity('purchasers', item));
  if (resourceName === 'invoice_detail') {
    const summaryUpdatedAt = context.summaryPayload
      ? extractTimestamp(context.summaryPayload, ['updatedAt', 'updated_at', 'modifiedAt', 'lastModifiedAt'])
      : null;
    return {
      external_id: stableIdentity('invoices', item),
      payload_hash: hashPayload(item),
      remote_created_at: extractTimestamp(item, ['createdAt', 'created_at', 'date', 'invoiceDate']),
      remote_updated_at: extractTimestamp(item, ['updatedAt', 'updated_at', 'modifiedAt', 'lastModifiedAt']) || summaryUpdatedAt,
    };
  }
  return { external_id: stableIdentity(resourceName.replace(/_detail$/, ''), item), payload_sha256: hashCanonicalPayload(item) };
}

export function comparePair(resourceName, currentPayload, legacyPayload) {
  const currentItems = extractResourceItems(resourceName, currentPayload);
  const legacyItems = extractResourceItems(resourceName, legacyPayload);
  const ids = (items) => items.map((item) => stableIdentity(resourceName, item));
  const currentIds = ids(currentItems);
  const legacyIds = ids(legacyItems);
  if (currentIds.some((id) => !id) || legacyIds.some((id) => !id)) hold(`${resourceName} contains an item without stable identity.`);
  if (new Set(currentIds).size !== currentIds.length || new Set(legacyIds).size !== legacyIds.length) hold(`${resourceName} contains duplicate stable identities.`);
  const currentProjection = currentItems.map((item) => canonicalProjection(resourceName, item));
  const legacyProjection = legacyItems.map((item) => canonicalProjection(resourceName, item));
  const evidence = {
    resource: resourceName,
    current_count: currentItems.length,
    legacy_count: legacyItems.length,
    current_payload_sha256: hashCanonicalPayload(currentPayload),
    legacy_payload_sha256: hashCanonicalPayload(legacyPayload),
    current_projection_sha256: hashCanonicalPayload(currentProjection),
    legacy_projection_sha256: hashCanonicalPayload(legacyProjection),
    identities_equal: hashCanonicalPayload(currentIds) === hashCanonicalPayload(legacyIds),
  };
  evidence.equal = evidence.current_payload_sha256 === evidence.legacy_payload_sha256 && evidence.current_projection_sha256 === evidence.legacy_projection_sha256 && evidence.identities_equal;
  if (!evidence.equal) hold(`${resourceName} current/legacy variance.`);
  return { evidence, currentItems, legacyItems };
}

export function replayTwice(resourceName, items) {
  const sink = new Map();
  const pass = () => {
    for (const item of items) {
      const id = stableIdentity(resourceName, item);
      if (!id) hold(`${resourceName} replay identity missing.`);
      const projection = canonicalProjection(resourceName, item);
      const digest = hashCanonicalPayload(projection);
      const existing = sink.get(id);
      if (existing && existing !== digest) hold(`${resourceName} replay conflict for stable identity.`);
      sink.set(id, digest);
    }
  };
  pass(); const once = hashCanonicalPayload([...sink.entries()]); pass(); const twice = hashCanonicalPayload([...sink.entries()]);
  if (once !== twice || sink.size !== items.length) hold(`${resourceName} replay is not idempotent.`);
  return { passes: 2, records: sink.size, semantic_duplicates: 0, replay_sha256: twice };
}

function continuation(payload, items, page, pageSize) {
  return hasNextPage(payload, items, page, pageSize);
}

export function selectDetailTarget(resource, currentItems, legacyItems, excludedTargetHash) {
  if (!resource.detail_path) return null;
  const legacy = new Set(legacyItems.map((item) => stableIdentity(resource.name, item)));
  return currentItems.map((item) => stableIdentity(resource.name, item)).filter((id) => id && legacy.has(id) && sha256(id) !== excludedTargetHash).sort()[0] || null;
}

export function classifyFailure(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'TIMEOUT';
  if (error?.code?.includes('ORIGIN') || error?.code?.includes('REDIRECT')) return 'TRANSPORT_GUARD';
  if (error?.code?.includes('CAP')) return 'CAP';
  if (Number(error?.status) === 401 || Number(error?.status) === 403) return 'AUTH';
  if (Number(error?.status) === 429) return 'RATE_LIMIT';
  if (Number(error?.status) >= 300) return 'PROVIDER_HTTP';
  return 'CONTRACT';
}

export async function readResponseTextBounded(response, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) hold('Response byte budget is exhausted.', 'ORDERMENTUM_C_RESPONSE_CAP');
  const declaredHeader = response.headers?.get?.('content-length');
  const declared = declaredHeader === null || declaredHeader === undefined || declaredHeader === '' ? null : Number(declaredHeader);
  if (declared !== null && Number.isFinite(declared) && declared > maxBytes) hold('Response byte cap exceeded.', 'ORDERMENTUM_C_RESPONSE_CAP');

  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let text = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunkBytes = value?.byteLength || 0;
        if (bytes + chunkBytes > maxBytes) {
          try { await reader.cancel(); } catch {}
          const error = new Error('Response byte cap exceeded.');
          error.code = 'ORDERMENTUM_C_RESPONSE_CAP';
          error.decoded_bytes = bytes;
          throw error;
        }
        bytes += chunkBytes;
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      return { text, bytes };
    } catch (error) {
      try { await reader.cancel(); } catch {}
      throw error;
    }
  }

  const text = await response.text();
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > maxBytes) {
    const error = new Error('Response byte cap exceeded.');
    error.code = 'ORDERMENTUM_C_RESPONSE_CAP';
    error.decoded_bytes = maxBytes;
    throw error;
  }
  return { text, bytes };
}

export async function boundedJsonFetch({ url, headers, timeoutMs, maxBytes, fetchImpl = fetch }) {
  const requestUrl = assertOrdermentumApiRequestUrl(url);
  if (headers?.['x-api-key']) {
    assertOrdermentumApiKeyRequestShape({ apiKey: headers['x-api-key'], requestUrl, body: undefined, callerHeaders: { accept: headers.accept } });
  }
  const startedAt = new Date().toISOString();
  const response = await fetchImpl(requestUrl, { method: 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
  assertNoCredentialedOrdermentumRedirect(response, requestUrl);
  if (!response.ok) { const error = new Error('Provider request rejected.'); error.status = response.status; throw error; }
  const { text, bytes } = await readResponseTextBounded(response, maxBytes);
  try {
    return { payload: text ? JSON.parse(text) : null, bytes, started_at: startedAt, completed_at: new Date().toISOString() };
  } catch {
    const error = new Error('Provider response was not JSON.');
    error.code = 'ORDERMENTUM_C_PARSE_HOLD';
    error.decoded_bytes = bytes;
    throw error;
  }
}

async function fetchPair({ manifest, counts, reserveRows, deadlineEpochMs, url, currentApiKey, legacyBearer, fetchImpl }) {
  const maxBytes = reservePairBudget(manifest, counts, reserveRows);
  const timeoutMs = requestTimeout(manifest, deadlineEpochMs, counts);
  counts.current_get += 1;
  counts.legacy_get += 1;
  const settled = await Promise.allSettled([
    boundedJsonFetch({ url, headers: { accept: 'application/json', 'x-api-key': currentApiKey }, timeoutMs, maxBytes, fetchImpl }),
    boundedJsonFetch({ url, headers: { accept: 'application/json', authorization: `Bearer ${legacyBearer}` }, timeoutMs, maxBytes, fetchImpl }),
  ]);
  for (const item of settled) {
    if (item.status === 'fulfilled') counts.decoded_bytes += item.value.bytes;
    else if (Number.isSafeInteger(item.reason?.decoded_bytes) && item.reason.decoded_bytes > 0) counts.decoded_bytes += item.reason.decoded_bytes;
  }
  const rejected = settled.find((item) => item.status === 'rejected');
  if (rejected) throw withProgress(rejected.reason, counts);
  return settled.map((item) => item.value);
}

export async function executeWindow({ manifest, windowId, supplierId, currentApiKey, legacyBearer, fetchImpl = fetch, initialCounts = null, deadlineEpochMs = null }) {
  const window = manifest.windows.find((candidate) => candidate.id === windowId);
  if (!window || Date.now() < Date.parse(window.to)) hold('Window is absent or has not closed.');
  const counts = {
    legacy_auth_posts: 0,
    current_get: 0,
    legacy_get: 0,
    decoded_bytes: 0,
    rows: 0,
    business_writes: 0,
    retries: 0,
    redirects: 0,
    ...(initialCounts || {}),
  };
  const deadline = deadlineEpochMs || (Date.now() + manifest.limits.window_timeout_ms);
  const evidence = [];

  try {
    for (const resource of manifest.resources) {
      const collected = { current: [], legacy: [] };
      for (let page = 1; page <= manifest.limits.max_pages_per_resource_per_auth; page += 1) {
        const url = buildListUrl(manifest, resource, window, supplierId, page);
        const [current, legacy] = await fetchPair({
          manifest,
          counts,
          reserveRows: manifest.limits.page_size * 2,
          deadlineEpochMs: deadline,
          url,
          currentApiKey,
          legacyBearer,
          fetchImpl,
        });
        const pair = comparePair(resource.name, current.payload, legacy.payload);
        if (pair.currentItems.length > manifest.limits.page_size || pair.legacyItems.length > manifest.limits.page_size) {
          hold(`${resource.name} exceeded the frozen page-size row bound.`, 'ORDERMENTUM_C_ROW_CAP', counts);
        }
        collected.current.push(...pair.currentItems); collected.legacy.push(...pair.legacyItems);
        counts.rows += pair.currentItems.length + pair.legacyItems.length;
        evidence.push({ ...pair.evidence, page, window: windowId, transform_version: manifest.transform_contract.version, current_bytes: current.bytes, legacy_bytes: legacy.bytes, current_started_at: current.started_at, current_completed_at: current.completed_at, legacy_started_at: legacy.started_at, legacy_completed_at: legacy.completed_at });
        const currentMore = continuation(current.payload, pair.currentItems, page, manifest.limits.page_size);
        const legacyMore = continuation(legacy.payload, pair.legacyItems, page, manifest.limits.page_size);
        if (currentMore !== legacyMore) hold(`${resource.name} pagination capability drift.`, 'ORDERMENTUM_C_SHADOW_HOLD', counts);
        if (!currentMore) break;
        if (page === manifest.limits.max_pages_per_resource_per_auth) hold(`${resource.name} remains partial after page cap.`, 'ORDERMENTUM_C_PAGE_CAP', counts);
      }
      if (!collected.current.length || !collected.legacy.length) hold(`${resource.name} returned empty required coverage.`, 'ORDERMENTUM_C_SHADOW_HOLD', counts);
      const detailId = selectDetailTarget(resource, collected.current, collected.legacy, manifest.excluded_target_sha256);
      if (resource.detail_path && !detailId) hold(`${resource.name} has no eligible overlapping detail target.`, 'ORDERMENTUM_C_SHADOW_HOLD', counts);
      if (detailId) {
        const detailUrl = assertOrdermentumApiRequestUrl(new URL(resource.detail_path.replace('{id}', encodeURIComponent(detailId)), manifest.approved_origins.current).toString());
        const [current, legacy] = await fetchPair({
          manifest,
          counts,
          reserveRows: 2,
          deadlineEpochMs: deadline,
          url: detailUrl,
          currentApiKey,
          legacyBearer,
          fetchImpl,
        });
        counts.rows += 2;
        const currentDetailId = stableIdentity(resource.name, current.payload);
        const legacyDetailId = stableIdentity(resource.name, legacy.payload);
        if (currentDetailId !== detailId || legacyDetailId !== detailId) hold(`${resource.name} detail identity mismatch.`, 'ORDERMENTUM_C_SHADOW_HOLD', counts);
        const detailName = resource.name === 'purchasers' ? 'purchaser_detail' : resource.name === 'invoices' ? 'invoice_detail' : resource.name;
        const currentSummary = collected.current.find((item) => stableIdentity(resource.name, item) === detailId) || null;
        const legacySummary = collected.legacy.find((item) => stableIdentity(resource.name, item) === detailId) || null;
        const currentProjection = canonicalProjection(detailName, current.payload, { summaryPayload: currentSummary });
        const legacyProjection = canonicalProjection(detailName, legacy.payload, { summaryPayload: legacySummary });
        if (hashCanonicalPayload(current.payload) !== hashCanonicalPayload(legacy.payload) || hashCanonicalPayload(currentProjection) !== hashCanonicalPayload(legacyProjection)) hold(`${resource.name} detail variance.`, 'ORDERMENTUM_C_SHADOW_HOLD', counts);
        evidence.push({ resource: `${resource.name}_detail`, window: windowId, transform_version: manifest.transform_contract.version, target_sha256: sha256(detailId), payload_sha256: hashCanonicalPayload(current.payload), projection_sha256: hashCanonicalPayload(currentProjection), current_bytes: current.bytes, legacy_bytes: legacy.bytes, current_started_at: current.started_at, current_completed_at: current.completed_at, legacy_started_at: legacy.started_at, legacy_completed_at: legacy.completed_at, equal: true });
      }
      evidence.push({ resource: `${resource.name}_replay`, current: replayTwice(resource.name, collected.current), legacy: replayTwice(resource.name, collected.legacy) });
    }
    return { status: 'PASS', window: windowId, request_counts: counts, evidence };
  } catch (error) {
    throw withProgress(error, counts);
  }
}
