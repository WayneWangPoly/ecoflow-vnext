#!/usr/bin/env node
import {
  RESOURCE_DEFINITIONS,
  extractArray,
  fetchOrdermentumJson,
  getLegacyBearerToken,
  optionalSupabase,
  parseArgs,
  requireEnv,
} from './ordermentum-master-data-common.mjs';

const args = parseArgs(process.argv);
const supplierId = process.env.ORDERMENTUM_SUPPLIER_ID || args.supplierId;
const resources = String(args.resources || Object.keys(RESOURCE_DEFINITIONS).join(','))
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean);
const pageSize = Number(args['page-size'] || args.pageSize || 5);
const token = await getLegacyBearerToken();
const supabase = optionalSupabase();
const results = [];

for (const resource of resources) {
  const def = RESOURCE_DEFINITIONS[resource];
  if (!def) {
    results.push({ resource, status: 'UNKNOWN_RESOURCE' });
    continue;
  }
  const queryWithSupplier = { pageNo: 1, pageSize };
  if (def.needsSupplierId !== false && supplierId) queryWithSupplier.supplierId = supplierId;
  let attempt = await fetchOrdermentumJson(token, def.path, queryWithSupplier);
  let usedSupplierFilter = Boolean(queryWithSupplier.supplierId);

  if (!attempt.ok && usedSupplierFilter) {
    const fallback = await fetchOrdermentumJson(token, def.path, { pageNo: 1, pageSize });
    if (fallback.ok || fallback.status !== attempt.status) {
      attempt = fallback;
      usedSupplierFilter = false;
    }
  }

  const items = extractArray(attempt.data, resource);
  const status = attempt.ok ? (items.length ? 'OK' : 'EMPTY') : (attempt.status === 401 || attempt.status === 403 ? 'AUTH_FAILED' : 'FAILED');
  const summary = {
    resource_type: resource,
    endpoint: def.path,
    method: 'GET',
    supplier_id: supplierId || '',
    status,
    http_status: attempt.status,
    supports_pagination: true,
    supports_supplier_filter: usedSupplierFilter,
    supports_updated_at_filter: null,
    sample_payload: attempt.data,
    last_error: attempt.ok ? null : JSON.stringify(attempt.data).slice(0, 1000),
  };
  results.push({ resource, status, httpStatus: attempt.status, count: items.length, usedSupplierFilter, url: attempt.url, error: summary.last_error });

  if (supabase) {
    await supabase.from('ordermentum_api_capabilities').upsert(summary, {
      onConflict: 'resource_type,endpoint,method,supplier_id',
    });
  }
}

console.log(JSON.stringify({ supplierId, checkedAt: new Date().toISOString(), results }, null, 2));
