import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

const RECEIVING_BUCKET = 'receiving-documents';

export type PurchaseOrderSummary = {
  id: string;
  po_number: string;
  supplier_name: string;
  order_date: string;
  expected_date: string | null;
  currency: string;
  po_status: string;
  po_note: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
  line_count: number | string;
  ordered_units: number | string;
  received_units: number | string;
  variance_units: number | string;
  receipt_count: number | string;
};

export type OpenPurchaseOrder = {
  id: string;
  po_number: string;
  supplier_name: string;
  expected_date: string | null;
  po_status: string;
  ordered_units: number | string;
  received_units: number | string;
  remaining_units: number | string;
};

export type PurchaseOrderLine = {
  id: string;
  sku: string;
  product_name: string | null;
  package_level: string;
  ordered_packages: number | string;
  units_per_package: number | string;
  expected_units: number | string;
  received_packages: number | string;
  received_units: number | string;
  variance_units: number | string;
  unit_cost: number | string | null;
  line_note: string | null;
};

export type PurchaseOrderReceipt = {
  batch_id: string;
  batch_no: string;
  batch_status: string;
  delivery_docket_ref: string | null;
  delivery_document_path: string | null;
  supplier_name: string | null;
  posted_units: number | string;
  physically_received_at: string | null;
  created_at: string;
};

export type PurchaseOrderDraftLine = {
  sku: string;
  productName?: string;
  packageLevel: 'CARTON' | 'SLEEVE' | 'INNER' | 'EACH';
  orderedPackages: number;
  unitsPerPackage: number;
  unitCost?: number | null;
  note?: string;
};

function activeClient(client?: SupabaseClient | null) {
  const active = client ?? supabase;
  if (!active) throw new Error('Supabase is not configured.');
  return active;
}

function message(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    return [record.message, record.details, record.hint, record.code].filter(Boolean).map(String).join(' · ') || JSON.stringify(record);
  }
  return String(error);
}

export async function loadPurchaseOrders(client?: SupabaseClient | null) {
  const { data, error } = await activeClient(client).rpc('ecoflow_read_purchase_orders', { p_limit: 160 });
  if (error) throw new Error(message(error));
  return (data ?? []) as PurchaseOrderSummary[];
}

export async function loadOpenPurchaseOrders(client?: SupabaseClient | null) {
  const { data, error } = await activeClient(client).rpc('ecoflow_read_open_purchase_orders');
  if (error) throw new Error(message(error));
  return (data ?? []) as OpenPurchaseOrder[];
}

export async function loadPurchaseOrderLines(purchaseOrderId: string, client?: SupabaseClient | null) {
  const { data, error } = await activeClient(client).rpc('ecoflow_read_purchase_order_lines', { p_purchase_order_id: purchaseOrderId });
  if (error) throw new Error(message(error));
  return (data ?? []) as PurchaseOrderLine[];
}

export async function loadPurchaseOrderReceipts(purchaseOrderId: string, client?: SupabaseClient | null) {
  const { data, error } = await activeClient(client).rpc('ecoflow_read_purchase_order_receipts', { p_purchase_order_id: purchaseOrderId });
  if (error) throw new Error(message(error));
  return (data ?? []) as PurchaseOrderReceipt[];
}

export async function createPurchaseOrder(input: {
  poNumber: string;
  supplierName: string;
  orderDate: string;
  expectedDate?: string | null;
  currency?: string;
  note?: string | null;
  lines: PurchaseOrderDraftLine[];
}, client?: SupabaseClient | null) {
  const { data, error } = await activeClient(client).rpc('ecoflow_create_purchase_order', {
    p_po_number: input.poNumber.trim(),
    p_supplier_name: input.supplierName.trim(),
    p_order_date: input.orderDate,
    p_expected_date: input.expectedDate || null,
    p_currency: input.currency || 'AUD',
    p_note: input.note?.trim() || null,
    p_lines: input.lines,
  });
  if (error) throw new Error(message(error));
  return (data ?? []) as Array<{ purchase_order_id: string; po_number: string; po_status: string }>;
}

export async function startPurchaseOrderReceipt(input: {
  purchaseOrderId: string;
  deliveryDocketRef: string;
  note?: string | null;
}, client?: SupabaseClient | null) {
  const { data, error } = await activeClient(client).rpc('ecoflow_start_po_receiving_batch', {
    p_purchase_order_id: input.purchaseOrderId,
    p_delivery_docket_ref: input.deliveryDocketRef.trim(),
    p_note: input.note?.trim() || null,
  });
  if (error) throw new Error(message(error));
  return (data ?? []) as Array<{ batch_id: string; batch_no: string; batch_status: string; po_number: string; supplier_name: string }>;
}

export async function uploadReceivingDocument(batchId: string, file: File, client?: SupabaseClient | null) {
  const active = activeClient(client);
  const extension = (file.name.split('.').pop() || (file.type === 'application/pdf' ? 'pdf' : 'jpg')).toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${batchId}/delivery-docket-${Date.now()}.${extension}`;
  const { error: uploadError } = await active.storage.from(RECEIVING_BUCKET).upload(path, file, {
    upsert: true,
    contentType: file.type || undefined,
  });
  if (uploadError) throw new Error(message(uploadError));
  const { error } = await active.rpc('ecoflow_set_receiving_document', { p_batch_id: batchId, p_document_path: path });
  if (error) throw new Error(message(error));
  return path;
}

export async function createReceivingDocumentSignedUrl(path: string, client?: SupabaseClient | null) {
  const { data, error } = await activeClient(client).storage.from(RECEIVING_BUCKET).createSignedUrl(path, 60 * 20);
  if (error) throw new Error(message(error));
  return data.signedUrl;
}

export async function reviewPurchaseOrder(input: {
  purchaseOrderId: string;
  action: 'MATCH' | 'ACCEPT_VARIANCE' | 'REOPEN' | 'CLOSE' | 'CANCEL';
  note?: string | null;
}, client?: SupabaseClient | null) {
  const { data, error } = await activeClient(client).rpc('ecoflow_review_purchase_order', {
    p_purchase_order_id: input.purchaseOrderId,
    p_action: input.action,
    p_note: input.note?.trim() || null,
  });
  if (error) throw new Error(message(error));
  return data ?? [];
}
