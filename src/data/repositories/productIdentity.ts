import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type ProductIdentityBatch = {
  batchId: string;
  batchName: string;
  batchStatus: 'DRAFT' | 'SUBMITTED' | 'PUBLISHED' | 'CANCELLED';
  revision: number;
  createdAt: string;
  submittedAt: string | null;
  publishedAt: string | null;
  openTasks: number;
  draftReadyTasks: number;
  conflictTasks: number;
  resolvedTasks: number;
  canSubmit: boolean;
  canPublish: boolean;
  readAt: string;
};

export type ProductIdentityRow = {
  commercialSkuId: string;
  commercialSkuCode: string;
  commercialName: string | null;
  ordermentumSku: string | null;
  taskStatus: 'OPEN' | 'DRAFT_READY' | 'CONFLICT' | 'RESOLVED' | 'CANCELLED';
  identityStatus: 'NEEDS_MAPPING' | 'DRAFT' | 'READY' | 'CONFLICT';
  familyCode: string | null;
  familyName: string | null;
  preferredPhysicalCode: string | null;
  preferredPhysicalName: string | null;
  brand: string | null;
  substitutionPolicy: 'ALLOWED' | 'APPROVAL_REQUIRED' | 'PROHIBITED' | null;
  publishedBarcodeCount: number;
  draftBarcodeCount: number;
  legacyBarcodeCount: number;
  legacyBarcodeExample: string | null;
  taskDetail: string;
};

export type ProductIdentityPage = {
  rows: ProductIdentityRow[];
  totalCount: number;
};

export type ProductIdentityFamilyReference = {
  id: string;
  code: string;
  name: string;
  status: 'DRAFT' | 'ACTIVE';
};

export type ProductIdentityPhysicalReference = {
  id: string;
  code: string;
  name: string;
  brand: string | null;
  familyId: string;
  status: 'DRAFT' | 'ACTIVE';
};

export type ProductIdentityReferences = {
  families: ProductIdentityFamilyReference[];
  physicalSkus: ProductIdentityPhysicalReference[];
  readAt: string;
};

export type ProductIdentityCaptureResult = {
  observationId: string;
  commandId: string;
  captureStatus: 'DRAFTED' | 'CONFLICT';
  detail: string;
  commercialSkuId: string;
  physicalSkuId: string | null;
  familyId: string | null;
  barcode: string;
  packageLevel: string;
};

export type ProductIdentityBatchCommandResult = {
  batchId: string;
  batchStatus: ProductIdentityBatch['batchStatus'];
  revision: number;
  commandStatus: 'APPLIED' | 'REPLAYED' | 'EXISTING' | 'CONFLICT';
};

export type ProductIdentityPublishResult = ProductIdentityBatchCommandResult & {
  publishedFamilies: number;
  publishedPhysicalSkus: number;
  publishedBarcodes: number;
  publishedLinks: number;
  publishedAt: string | null;
};

function activeClient(input?: SupabaseClient | null) {
  const client = input ?? supabase;
  if (!client) throw new Error('Supabase is not configured.');
  return client;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const row = error as Record<string, unknown>;
    return [row.message, row.details, row.hint, row.code].filter(Boolean).map(String).join(' · ') || JSON.stringify(row);
  }
  return String(error);
}

async function rpc<T>(name: string, args?: Record<string, unknown>, client?: SupabaseClient | null): Promise<T> {
  const result = await activeClient(client).rpc(name, args);
  if (result.error) throw new Error(errorMessage(result.error));
  return result.data as T;
}

function text(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function safeInteger(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function createProductIdentityCommandId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  throw new Error('This browser cannot create a secure Product Identity command ID.');
}

export async function readCurrentProductIdentityBatch(client?: SupabaseClient | null): Promise<ProductIdentityBatch | null> {
  const rows = await rpc<Array<Record<string, unknown>>>('ecoflow_read_current_product_identity_batch', undefined, client) ?? [];
  const row = rows[0];
  if (!row) return null;
  const status = text(row.batch_status);
  if (!status || !['DRAFT', 'SUBMITTED', 'PUBLISHED', 'CANCELLED'].includes(status)) {
    throw new Error('Product Identity batch authority returned an invalid status.');
  }
  return {
    batchId: String(row.batch_id),
    batchName: String(row.batch_name || 'Product identity commissioning'),
    batchStatus: status as ProductIdentityBatch['batchStatus'],
    revision: safeInteger(row.revision),
    createdAt: String(row.created_at || ''),
    submittedAt: text(row.submitted_at),
    publishedAt: text(row.published_at),
    openTasks: safeInteger(row.open_tasks),
    draftReadyTasks: safeInteger(row.draft_ready_tasks),
    conflictTasks: safeInteger(row.conflict_tasks),
    resolvedTasks: safeInteger(row.resolved_tasks),
    canSubmit: row.can_submit === true,
    canPublish: row.can_publish === true,
    readAt: String(row.read_at || ''),
  };
}

export async function startProductIdentityBatch(name: string, commandId: string, client?: SupabaseClient | null): Promise<ProductIdentityBatchCommandResult> {
  const rows = await rpc<Array<Record<string, unknown>>>('ecoflow_start_product_identity_batch', {
    p_batch_name: name,
    p_command_id: commandId,
  }, client) ?? [];
  const row = rows[0];
  if (!row) throw new Error('Product Identity batch start returned no result.');
  return {
    batchId: String(row.batch_id),
    batchStatus: String(row.batch_status) as ProductIdentityBatch['batchStatus'],
    revision: safeInteger(row.revision),
    commandStatus: String(row.command_status) as ProductIdentityBatchCommandResult['commandStatus'],
  };
}

export async function readProductIdentityPage(input: {
  batchId?: string | null;
  search?: string;
  filter?: string;
  page?: number;
  pageSize?: number;
}, client?: SupabaseClient | null): Promise<ProductIdentityPage> {
  const rows = await rpc<Array<Record<string, unknown>>>('ecoflow_read_product_identity_commissioning_v1', {
    p_batch_id: input.batchId || null,
    p_search: input.search || null,
    p_filter: input.filter || 'ALL',
    p_page: Math.max(1, input.page || 1),
    p_page_size: Math.min(100, Math.max(1, input.pageSize || 25)),
  }, client) ?? [];
  return {
    totalCount: rows.length ? safeInteger(rows[0].total_count) : 0,
    rows: rows.map((row) => ({
      commercialSkuId: String(row.commercial_sku_id),
      commercialSkuCode: String(row.commercial_sku_code || ''),
      commercialName: text(row.commercial_name),
      ordermentumSku: text(row.ordermentum_sku),
      taskStatus: String(row.task_status || 'OPEN') as ProductIdentityRow['taskStatus'],
      identityStatus: String(row.identity_status || 'NEEDS_MAPPING') as ProductIdentityRow['identityStatus'],
      familyCode: text(row.family_code),
      familyName: text(row.family_name),
      preferredPhysicalCode: text(row.preferred_physical_code),
      preferredPhysicalName: text(row.preferred_physical_name),
      brand: text(row.brand),
      substitutionPolicy: text(row.substitution_policy) as ProductIdentityRow['substitutionPolicy'],
      publishedBarcodeCount: safeInteger(row.published_barcode_count),
      draftBarcodeCount: safeInteger(row.draft_barcode_count),
      legacyBarcodeCount: safeInteger(row.legacy_barcode_count),
      legacyBarcodeExample: text(row.legacy_barcode_example),
      taskDetail: String(row.task_detail || ''),
    })),
  };
}

export async function readProductIdentityReferences(batchId: string | null, client?: SupabaseClient | null): Promise<ProductIdentityReferences> {
  const rows = await rpc<Array<Record<string, unknown>>>('ecoflow_read_product_identity_reference_v1', {
    p_batch_id: batchId,
  }, client) ?? [];
  const row = rows[0] || {};
  const families = Array.isArray(row.families) ? row.families : [];
  const physical = Array.isArray(row.physical_skus) ? row.physical_skus : [];
  return {
    families: families.map((entry) => {
      const value = entry as Record<string, unknown>;
      return { id: String(value.id), code: String(value.code || ''), name: String(value.name || ''), status: String(value.status || 'ACTIVE') as ProductIdentityFamilyReference['status'] };
    }),
    physicalSkus: physical.map((entry) => {
      const value = entry as Record<string, unknown>;
      return {
        id: String(value.id), code: String(value.code || ''), name: String(value.name || ''), brand: text(value.brand),
        familyId: String(value.familyId || value.family_id || ''), status: String(value.status || 'ACTIVE') as ProductIdentityPhysicalReference['status'],
      };
    }),
    readAt: String(row.read_at || ''),
  };
}

export async function captureProductIdentity(input: {
  batchId: string;
  commandId: string;
  commercialSkuId: string;
  physicalSkuCode: string;
  physicalName: string;
  brand?: string;
  supplierName?: string;
  familyCode: string;
  familyName: string;
  barcode: string;
  packageLevel: 'CARTON' | 'SLEEVE' | 'INNER' | 'EACH' | 'PALLET';
  unitsInBaseUnit: number;
  substitutionPolicy: 'ALLOWED' | 'APPROVAL_REQUIRED' | 'PROHIBITED';
  isPreferred: boolean;
  note?: string;
}, client?: SupabaseClient | null): Promise<ProductIdentityCaptureResult> {
  const rows = await rpc<Array<Record<string, unknown>>>('ecoflow_capture_product_identity', {
    p_batch_id: input.batchId,
    p_command_id: input.commandId,
    p_commercial_sku_id: input.commercialSkuId,
    p_physical_sku_code: input.physicalSkuCode,
    p_physical_name: input.physicalName,
    p_brand: input.brand || null,
    p_supplier_name: input.supplierName || null,
    p_family_code: input.familyCode,
    p_family_name: input.familyName,
    p_barcode: input.barcode,
    p_package_level: input.packageLevel,
    p_units_in_base_unit: input.unitsInBaseUnit,
    p_substitution_policy: input.substitutionPolicy,
    p_is_preferred: input.isPreferred,
    p_note: input.note || null,
  }, client) ?? [];
  const row = rows[0];
  if (!row) throw new Error('Product Identity capture returned no result.');
  return {
    observationId: String(row.observation_id),
    commandId: String(row.command_id),
    captureStatus: String(row.capture_status) as ProductIdentityCaptureResult['captureStatus'],
    detail: String(row.detail || ''),
    commercialSkuId: String(row.commercial_sku_id),
    physicalSkuId: text(row.physical_sku_id),
    familyId: text(row.family_id),
    barcode: String(row.barcode || ''),
    packageLevel: String(row.package_level || ''),
  };
}

export async function submitProductIdentityBatch(input: {
  batchId: string;
  expectedRevision: number;
  commandId: string;
  note?: string;
}, client?: SupabaseClient | null): Promise<ProductIdentityBatchCommandResult> {
  const rows = await rpc<Array<Record<string, unknown>>>('ecoflow_submit_product_identity_batch', {
    p_batch_id: input.batchId,
    p_expected_revision: input.expectedRevision,
    p_command_id: input.commandId,
    p_note: input.note || null,
  }, client) ?? [];
  const row = rows[0];
  if (!row) throw new Error('Product Identity submit returned no result.');
  return {
    batchId: String(row.batch_id),
    batchStatus: String(row.batch_status) as ProductIdentityBatch['batchStatus'],
    revision: safeInteger(row.revision),
    commandStatus: String(row.command_status) as ProductIdentityBatchCommandResult['commandStatus'],
  };
}

export async function reopenProductIdentityBatch(input: {
  batchId: string;
  expectedRevision: number;
  reason: string;
}, client?: SupabaseClient | null) {
  const rows = await rpc<Array<Record<string, unknown>>>('ecoflow_reopen_product_identity_batch', {
    p_batch_id: input.batchId,
    p_expected_revision: input.expectedRevision,
    p_reason: input.reason,
  }, client) ?? [];
  const row = rows[0];
  if (!row) throw new Error('Product Identity reopen returned no result.');
  return { batchId: String(row.batch_id), batchStatus: String(row.batch_status), revision: safeInteger(row.revision) };
}

export async function publishProductIdentityBatch(input: {
  batchId: string;
  expectedRevision: number;
  commandId: string;
  note?: string;
}, client?: SupabaseClient | null): Promise<ProductIdentityPublishResult> {
  const rows = await rpc<Array<Record<string, unknown>>>('ecoflow_publish_product_identity_batch', {
    p_batch_id: input.batchId,
    p_expected_revision: input.expectedRevision,
    p_command_id: input.commandId,
    p_note: input.note || null,
  }, client) ?? [];
  const row = rows[0];
  if (!row) throw new Error('Product Identity publish returned no result.');
  return {
    batchId: String(row.batch_id),
    batchStatus: String(row.batch_status) as ProductIdentityBatch['batchStatus'],
    revision: safeInteger(row.revision),
    commandStatus: String(row.command_status) as ProductIdentityBatchCommandResult['commandStatus'],
    publishedFamilies: safeInteger(row.published_families),
    publishedPhysicalSkus: safeInteger(row.published_physical_skus),
    publishedBarcodes: safeInteger(row.published_barcodes),
    publishedLinks: safeInteger(row.published_links),
    publishedAt: text(row.published_at),
  };
}

export async function retireProductIdentityBarcode(input: {
  barcode: string;
  reason: string;
  expectedRevision: number;
}, client?: SupabaseClient | null) {
  const rows = await rpc<Array<Record<string, unknown>>>('ecoflow_retire_product_identity_barcode', {
    p_barcode: input.barcode,
    p_reason: input.reason,
    p_expected_revision: input.expectedRevision,
  }, client) ?? [];
  const row = rows[0];
  if (!row) throw new Error('Barcode retirement returned no result.');
  return {
    bindingId: String(row.binding_id), barcode: String(row.barcode), physicalSkuId: String(row.physical_sku_id),
    retirementStatus: String(row.retirement_status), revision: safeInteger(row.revision), retiredAt: text(row.retired_at),
  };
}
