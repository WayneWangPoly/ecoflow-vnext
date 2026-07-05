import { env, ordermentumFetch } from './ordermentum-sync-common.mjs';
import { getOrdermentumBaseUrl } from './ordermentum-auth.mjs';

const supplierId = env('ORDERMENTUM_SUPPLIER_ID', { required: true });
const base = getOrdermentumBaseUrl();
const url = new URL(`${base}/v2/orders`);
url.searchParams.set('supplierId', supplierId);
url.searchParams.set('pageSize', '3');
url.searchParams.set('pageNo', '1');
const payload = await ordermentumFetch(url.toString(), { method: 'GET' });
const rows = Array.isArray(payload?.data) ? payload.data : (payload?.orders || payload?.items || []);
console.log(JSON.stringify({
  ok: true,
  base,
  supplierId,
  returned: rows.length,
  firstOrder: rows[0] ? {
    id: rows[0].id,
    orderNumber: rows[0].orderNumber || rows[0].order_number || rows[0].number,
    invoiceNumber: rows[0].invoiceNumber || rows[0].invoice_number,
    updatedAt: rows[0].updatedAt || rows[0].updated_at,
  } : null,
  meta: payload?.meta || null,
}, null, 2));
