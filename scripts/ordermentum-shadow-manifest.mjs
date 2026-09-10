import crypto from 'node:crypto';
import fs from 'node:fs';

export const DEFAULT_MANIFEST_PATH = 'docs/engineering/evidence/ordermentum-359-c-shadow.manifest';
const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT_SHA = /^[0-9a-f]{40}$/;
const REQUIRED_RESOURCES = ['orders', 'products', 'variants', 'purchasers', 'price_groups', 'invoices', 'stock_locations', 'leads'];
const PATHS = ['/v2/orders', '/v2/products', '/v1/variants', '/v1/purchasers', '/v1/price-groups', '/v2/invoices', '/v1/stock-locations', '/v1/leads'];

function blocked(message, code = 'ORDERMENTUM_C_MANIFEST_BLOCKED') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function manifestDigest(manifest) {
  return sha256(canonicalJson(manifest));
}

export function loadManifest(path = DEFAULT_MANIFEST_PATH) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

export function validateManifest(manifest) {
  if (manifest?.schema_version !== 1) blocked('Unsupported manifest schema.');
  if (!COMMIT_SHA.test(manifest.source_baseline_sha || '')) blocked('Source baseline SHA is missing or invalid.');
  if (manifest.contract_pr !== 383) blocked('The reviewed #383 contract must remain bound.');
  if (manifest.execution_state !== 'ENGINEERING_FROZEN_LIVE_HOLD') blocked('Live HOLD marker is required.');
  const origins = manifest.approved_origins || {};
  if (origins.current !== 'https://api.ordermentum.com' || origins.legacy_api !== 'https://api.ordermentum.com' || origins.legacy_auth !== 'https://app.ordermentum.com') blocked('Approved origins changed.');
  if (manifest.supplier_binding?.algorithm !== 'sha256' || manifest.supplier_binding?.raw_value_env !== 'ORDERMENTUM_SUPPLIER_ID' || manifest.supplier_binding?.reviewed_hash_env !== 'ORDERMENTUM_C_SHADOW_SUPPLIER_SHA256') blocked('Supplier hash binding is incomplete.');
  if (!SHA256.test(manifest.excluded_target_sha256 || '')) blocked('B1 target exclusion hash is invalid.');
  if (manifest.overlap_minutes !== 15 || !String(manifest.prior_high_watermark_reference || '').includes('read-only')) blocked('High-watermark/overlap contract changed.');
  if (!Array.isArray(manifest.windows) || manifest.windows.length !== 2) blocked('Exactly W0 and W1 are required.');
  for (const [index, window] of manifest.windows.entries()) {
    if (window.id !== `W${index}` || !Number.isFinite(Date.parse(window.from)) || !Number.isFinite(Date.parse(window.to)) || Date.parse(window.from) >= Date.parse(window.to)) blocked('Invalid frozen window.');
    if (/now\s*\(/i.test(JSON.stringify(window))) blocked('Dynamic now() is forbidden.');
  }
  const resources = manifest.resources || [];
  if (resources.map((resource) => resource.name).join(',') !== REQUIRED_RESOURCES.join(',')) blocked('Resource order or coverage changed.');
  if (resources.map((resource) => resource.list_path).join(',') !== PATHS.join(',')) blocked('Endpoint plan changed.');
  const details = Object.fromEntries(resources.map((resource) => [resource.name, resource.detail_path]));
  if (details.purchasers !== '/v1/purchasers/{id}' || details.products !== '/v1/products/{id}' || details.invoices !== '/v1/invoices/{id}') blocked('Detail endpoint version is not pinned.');
  if (resources.find((resource) => resource.name === 'price_groups')?.supplier_filter !== false) blocked('Price groups must not invent a supplier filter.');
  const limits = manifest.limits || {};
  const expected = { page_size: 10, max_pages_per_resource_per_auth: 2, max_detail_targets_per_type: 1, max_gets_per_window: 38, max_legacy_auth_posts_per_window: 1, max_rows_per_window: 326, max_response_bytes: 1048576, max_decoded_bytes_per_window: 16777216, request_timeout_ms: 20000, window_timeout_ms: 600000, retries: 0, redirects: 0, writes: 0 };
  for (const [key, value] of Object.entries(expected)) if (limits[key] !== value) blocked(`Frozen limit changed: ${key}.`);
  if (manifest.query?.page_parameter !== 'pageNo' || manifest.query?.page_size_parameter !== 'pageSize' || manifest.query?.supplier_parameter !== 'supplierId' || manifest.query?.window_from_parameter !== 'updatedAt[gte]' || manifest.query?.window_to_parameter !== 'updatedAt[lte]') blocked('Query contract changed.');
  return { manifest, digest: manifestDigest(manifest) };
}

export function assertSupplierBinding(manifest, supplierId, reviewedHash) {
  const raw = String(supplierId || '').trim();
  const expected = String(reviewedHash || '').trim();
  if (!raw || !SHA256.test(expected) || sha256(raw) !== expected) blocked('Supplier identity does not match the externally reviewed hash.', 'ORDERMENTUM_C_SUPPLIER_BINDING_BLOCKED');
  return expected;
}

export function assertExternalBinding(manifest, { candidateSha, checkoutSha, currentMainSha, reviewedManifestDigest }) {
  if (!COMMIT_SHA.test(candidateSha || '') || candidateSha !== checkoutSha || candidateSha !== currentMainSha) blocked('Candidate, checkout and current main must be the same reviewed SHA.', 'ORDERMENTUM_C_SHA_BINDING_BLOCKED');
  const digest = manifestDigest(manifest);
  if (!SHA256.test(reviewedManifestDigest || '') || digest !== reviewedManifestDigest) blocked('Manifest digest does not match the external reviewed execution record.', 'ORDERMENTUM_C_DIGEST_BINDING_BLOCKED');
  return { candidate_sha: candidateSha, manifest_sha256: digest };
}
