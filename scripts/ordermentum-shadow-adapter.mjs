import { extractArray as extractOrders, extractOrderIdentity, hasNextPage } from './ordermentum-full-sync-core.mjs';
import { extractArray as extractMaster, extractExternalId } from './ordermentum-master-data-common.mjs';
import { hashCanonicalPayload } from './ordermentum-api-key-probe.mjs';
import { extractOrderDates, extractOrderStatus } from './ordermentum-sync-common.mjs';
import { projectPurchaserToStoreRow } from './ordermentum-targeted-store-sync-core.mjs';
import { assertOrdermentumApiKeyRequestShape, assertOrdermentumApiRequestUrl, assertNoCredentialedOrdermentumRedirect } from './ordermentum-api-origin-guard.mjs';
import { sha256 } from './ordermentum-shadow-manifest.mjs';

function hold(message, code = 'ORDERMENTUM_C_SHADOW_HOLD') { const error = new Error(message); error.code = code; throw error; }

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
  return String(extractExternalId(item, resourceName) || '');
}

export function canonicalProjection(resourceName, item) {
  if (resourceName === 'orders') return { identity: extractOrderIdentity(item), dates: extractOrderDates(item), status: extractOrderStatus(item) };
  if (resourceName === 'purchaser_detail') return projectPurchaserToStoreRow(item, stableIdentity('purchasers', item));
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
  return currentItems.map((item) => stableIdentity(resource.name, item)).filter((id) => legacy.has(id) && sha256(id) !== excludedTargetHash).sort()[0] || null;
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

export async function boundedJsonFetch({ url, headers, timeoutMs, maxBytes, fetchImpl = fetch }) {
  const requestUrl = assertOrdermentumApiRequestUrl(url);
  if (headers?.['x-api-key']) {
    assertOrdermentumApiKeyRequestShape({ apiKey: headers['x-api-key'], requestUrl, body: undefined, callerHeaders: { accept: headers.accept } });
  }
  const startedAt = new Date().toISOString();
  const response = await fetchImpl(requestUrl, { method: 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
  assertNoCredentialedOrdermentumRedirect(response, requestUrl);
  if (!response.ok) { const error = new Error('Provider request rejected.'); error.status = response.status; throw error; }
  const declared = Number(response.headers?.get?.('content-length') || 0);
  if (declared > maxBytes) hold('Response byte cap exceeded.', 'ORDERMENTUM_C_RESPONSE_CAP');
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) hold('Response byte cap exceeded.', 'ORDERMENTUM_C_RESPONSE_CAP');
  try { return { payload: text ? JSON.parse(text) : null, bytes: Buffer.byteLength(text, 'utf8'), started_at: startedAt, completed_at: new Date().toISOString() }; }
  catch { hold('Provider response was not JSON.', 'ORDERMENTUM_C_PARSE_HOLD'); }
}

export async function executeWindow({ manifest, windowId, supplierId, currentApiKey, legacyBearer, fetchImpl = fetch }) {
  const window = manifest.windows.find((candidate) => candidate.id === windowId);
  if (!window || Date.now() < Date.parse(window.to)) hold('Window is absent or has not closed.');
  const counts = { current_get: 0, legacy_get: 0, decoded_bytes: 0, rows: 0, business_writes: 0, retries: 0, redirects: 0 };
  const evidence = [];
  for (const resource of manifest.resources) {
    const collected = { current: [], legacy: [] };
    for (let page = 1; page <= manifest.limits.max_pages_per_resource_per_auth; page += 1) {
      const url = buildListUrl(manifest, resource, window, supplierId, page);
      const [current, legacy] = await Promise.all([
        boundedJsonFetch({ url, headers: { accept: 'application/json', 'x-api-key': currentApiKey }, timeoutMs: manifest.limits.request_timeout_ms, maxBytes: manifest.limits.max_response_bytes, fetchImpl }),
        boundedJsonFetch({ url, headers: { accept: 'application/json', authorization: `Bearer ${legacyBearer}` }, timeoutMs: manifest.limits.request_timeout_ms, maxBytes: manifest.limits.max_response_bytes, fetchImpl }),
      ]);
      counts.current_get += 1; counts.legacy_get += 1; counts.decoded_bytes += current.bytes + legacy.bytes;
      const pair = comparePair(resource.name, current.payload, legacy.payload);
      collected.current.push(...pair.currentItems); collected.legacy.push(...pair.legacyItems);
      counts.rows += pair.currentItems.length + pair.legacyItems.length;
      evidence.push({ ...pair.evidence, page, window: windowId, transform_version: manifest.transform_contract.version, current_bytes: current.bytes, legacy_bytes: legacy.bytes, current_started_at: current.started_at, current_completed_at: current.completed_at, legacy_started_at: legacy.started_at, legacy_completed_at: legacy.completed_at });
      const currentMore = continuation(current.payload, pair.currentItems, page, manifest.limits.page_size);
      const legacyMore = continuation(legacy.payload, pair.legacyItems, page, manifest.limits.page_size);
      if (currentMore !== legacyMore) hold(`${resource.name} pagination capability drift.`);
      if (!currentMore) break;
      if (page === manifest.limits.max_pages_per_resource_per_auth) hold(`${resource.name} remains partial after page cap.`);
    }
    if (!collected.current.length || !collected.legacy.length) hold(`${resource.name} returned empty required coverage.`);
    const detailId = selectDetailTarget(resource, collected.current, collected.legacy, manifest.excluded_target_sha256);
    if (resource.detail_path && !detailId) hold(`${resource.name} has no eligible overlapping detail target.`);
    if (detailId) {
      const detailUrl = assertOrdermentumApiRequestUrl(new URL(resource.detail_path.replace('{id}', encodeURIComponent(detailId)), manifest.approved_origins.current).toString());
      const [current, legacy] = await Promise.all([
        boundedJsonFetch({ url: detailUrl, headers: { accept: 'application/json', 'x-api-key': currentApiKey }, timeoutMs: manifest.limits.request_timeout_ms, maxBytes: manifest.limits.max_response_bytes, fetchImpl }),
        boundedJsonFetch({ url: detailUrl, headers: { accept: 'application/json', authorization: `Bearer ${legacyBearer}` }, timeoutMs: manifest.limits.request_timeout_ms, maxBytes: manifest.limits.max_response_bytes, fetchImpl }),
      ]);
      counts.current_get += 1; counts.legacy_get += 1; counts.decoded_bytes += current.bytes + legacy.bytes; counts.rows += 2;
      const currentDetailId = stableIdentity(resource.name, current.payload);
      const legacyDetailId = stableIdentity(resource.name, legacy.payload);
      if (currentDetailId !== detailId || legacyDetailId !== detailId) hold(`${resource.name} detail identity mismatch.`);
      const detailName = resource.name === 'purchasers' ? 'purchaser_detail' : resource.name;
      const currentProjection = canonicalProjection(detailName, current.payload);
      const legacyProjection = canonicalProjection(detailName, legacy.payload);
      if (hashCanonicalPayload(current.payload) !== hashCanonicalPayload(legacy.payload) || hashCanonicalPayload(currentProjection) !== hashCanonicalPayload(legacyProjection)) hold(`${resource.name} detail variance.`);
      evidence.push({ resource: `${resource.name}_detail`, window: windowId, transform_version: manifest.transform_contract.version, target_sha256: sha256(detailId), payload_sha256: hashCanonicalPayload(current.payload), projection_sha256: hashCanonicalPayload(currentProjection), current_bytes: current.bytes, legacy_bytes: legacy.bytes, current_started_at: current.started_at, current_completed_at: current.completed_at, legacy_started_at: legacy.started_at, legacy_completed_at: legacy.completed_at, equal: true });
    }
    evidence.push({ resource: `${resource.name}_replay`, current: replayTwice(resource.name, collected.current), legacy: replayTwice(resource.name, collected.legacy) });
    if (counts.current_get + counts.legacy_get > manifest.limits.max_gets_per_window || counts.rows > manifest.limits.max_rows_per_window || counts.decoded_bytes > manifest.limits.max_decoded_bytes_per_window) hold('Aggregate package cap exceeded.', 'ORDERMENTUM_C_AGGREGATE_CAP');
  }
  return { status: 'PASS', window: windowId, request_counts: counts, evidence };
}
