import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

export type ProductIdentityPackageLevel = 'CARTON' | 'SLEEVE' | 'INNER' | 'EACH';
export type ProductIdentityPolicy = 'ALLOWED' | 'APPROVAL_REQUIRED' | 'PROHIBITED';
export type ProductIdentityItemState = 'DRAFT' | 'CONFLICT' | 'REVIEW' | 'VERIFIED' | 'EXCLUDED';
export type ProductIdentityMappingStatus = 'UNMAPPED' | 'CONFLICT' | 'REVIEW' | 'READY_TO_PUBLISH' | 'PUBLISHED';

export type ProductIdentityReadiness = {
  batch_id: string | null;
  batch_name: string | null;
  batch_status: 'DRAFT' | 'REVIEW' | 'PUBLISHED' | 'CANCELLED' | null;
  batch_revision: number | string | null;
  total_commercial_skus: number | string | null;
  published_commercial_skus: number | string | null;
  staged_commercial_skus: number | string | null;
  covered_commercial_skus: number | string | null;
  unmapped_commercial_skus: number | string | null;
  physical_skus: number | string | null;
  sku_families: number | string | null;
  verified_barcodes: number | string | null;
  carton_barcodes: number | string | null;
  sleeve_barcodes: number | string | null;
  inner_barcodes: number | string | null;
  each_barcodes: number | string | null;
  conflict_items: number | string | null;
  review_items: number | string | null;
  verified_items: number | string | null;
  readiness_percent: number | string | null;
  publication_ready: boolean | null;
  latest_actor: string | null;
  latest_at: string | null;
};

export type ProductIdentityTask = {
  commercial_sku: string;
  product_name: string;
  mapping_status: ProductIdentityMappingStatus | string;
  physical_sku: string | null;
  family_code: string | null;
  family_name: string | null;
  substitution_policy: ProductIdentityPolicy | string | null;
  is_preferred: boolean | null;
  verified_barcode_count: number | string | null;
  carton_barcodes: number | string | null;
  sleeve_barcodes: number | string | null;
  inner_barcodes: number | string | null;
  each_barcodes: number | string | null;
  latest_barcode: string | null;
  current_batch_id: string | null;
  current_item_id: string | null;
  current_item_state: ProductIdentityItemState | string | null;
  conflict_codes: string[] | null;
  updated_at: string | null;
};

export type CommercialSkuOption = {
  commercial_sku: string;
  product_name: string;
  units_30d: number | string | null;
  order_count_30d: number | string | null;
};

export type PhysicalSkuOption = {
  physical_sku_id: string;
  physical_sku: string;
  product_name: string;
  brand: string | null;
  family_code: string | null;
  family_name: string | null;
  physical_status: string;
  revision: number | string;
  updated_at: string;
};

export type SkuFamilyOption = {
  family_id: string;
  family_code: string;
  family_name: string;
  description: string | null;
  family_status: string;
  revision: number | string;
  updated_at: string;
};

export type ProductIdentityBatchItem = {
  item_id: string;
  batch_id: string;
  barcode: string;
  physical_sku: string;
  product_name: string;
  brand: string | null;
  family_code: string;
  family_name: string;
  commercial_sku: string;
  package_level: ProductIdentityPackageLevel;
  units_per_barcode: number | string;
  substitution_policy: ProductIdentityPolicy;
  is_preferred: boolean;
  item_state: ProductIdentityItemState;
  conflict_codes: string[];
  note: string | null;
  item_revision: number | string;
  updated_at: string;
  reviewed_at: string | null;
  review_note: string | null;
};

export type ProductIdentityWorkspaceData = {
  readiness: ProductIdentityReadiness;
  tasks: ProductIdentityTask[];
  commercialSkus: CommercialSkuOption[];
  physicalSkus: PhysicalSkuOption[];
  families: SkuFamilyOption[];
  items: ProductIdentityBatchItem[];
};

export type ProductIdentityDraftInput = {
  batchId: string;
  barcode: string;
  physicalSku: string;
  productName: string;
  brand?: string | null;
  familyCode: string;
  familyName: string;
  commercialSku: string;
  packageLevel: ProductIdentityPackageLevel;
  unitsPerBarcode: number;
  substitutionPolicy: ProductIdentityPolicy;
  preferred: boolean;
  note?: string | null;
  expectedBatchRevision: number;
  autoVerify: boolean;
};

export type ProductIdentityScanValidation = {
  barcode: string;
  physical_sku: string;
  product_name: string;
  brand: string | null;
  family_code: string;
  family_name: string;
  commercial_sku: string | null;
  package_level: ProductIdentityPackageLevel;
  units_per_barcode: number | string;
  substitution_policy: ProductIdentityPolicy;
  is_preferred: boolean;
  requires_approval: boolean;
  validation_status: 'VALID' | 'APPROVAL_REQUIRED' | string;
};

export type ProductIdentityConflictGuidance = {
  title: string;
  detail: string;
  blocking: boolean;
};

const CONFLICT_GUIDANCE: Record<string, ProductIdentityConflictGuidance> = {
  COMMERCIAL_SKU_NOT_FOUND: {
    title: 'Commercial SKU is not in the live catalogue',
    detail: 'Choose the exact Ordermentum SKU. Do not create a similarly named replacement.',
    blocking: true,
  },
  BARCODE_ASSIGNED_TO_OTHER_PHYSICAL_SKU: {
    title: 'Barcode already belongs to another physical item',
    detail: 'Check the package and choose the existing physical SKU. A published barcode cannot be reassigned silently.',
    blocking: true,
  },
  PACKAGING_CONVERSION_CONFLICT: {
    title: 'Package level or conversion conflicts with the published mapping',
    detail: 'Verify whether this is carton, sleeve, inner pack or each and confirm the units printed on the package.',
    blocking: true,
  },
  FAMILY_CHANGE_REQUIRES_REVIEW: {
    title: 'Physical SKU is already assigned to another family',
    detail: 'Owner or Admin must confirm the family change before publication.',
    blocking: false,
  },
  MULTIPLE_PREFERRED_PHYSICAL_SKUS: {
    title: 'More than one preferred item is selected',
    detail: 'Keep one preferred physical SKU for this Commercial SKU. Other valid items remain allowed substitutes.',
    blocking: true,
  },
  APPROVAL_REQUIRED_POLICY: {
    title: 'This substitution requires approval',
    detail: 'Owner or Admin must review this item before it can be published.',
    blocking: false,
  },
};

function activeClient(client?: SupabaseClient | null) {
  const value = client ?? supabase;
  if (!value) throw new Error('Supabase is not configured.');
  return value;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const row = error as Record<string, unknown>;
    return [row.message, row.details, row.hint, row.code]
      .filter(Boolean)
      .map(String)
      .join(' · ') || JSON.stringify(row);
  }
  return String(error);
}

function commandId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  throw new Error('This browser cannot create a secure command ID.');
}

async function rpc<T>(name: string, args?: Record<string, unknown>, client?: SupabaseClient | null): Promise<T> {
  const result = await activeClient(client).rpc(name, args);
  if (result.error) throw new Error(errorMessage(result.error));
  return result.data as T;
}

function first<T>(rows: T[] | null | undefined, label: string) {
  const row = rows?.[0];
  if (!row) throw new Error(`${label} returned no result.`);
  return row;
}

export function productIdentityConflictGuidance(code: string): ProductIdentityConflictGuidance {
  return CONFLICT_GUIDANCE[code] ?? {
    title: code.replaceAll('_', ' '),
    detail: 'Review the captured evidence and correct the relationship before publication.',
    blocking: true,
  };
}

export function productIdentityFriendlyError(error: unknown) {
  const message = errorMessage(error);
  if (message.includes('PRODUCT_IDENTITY_STALE_REVISION') || message.includes('PRODUCT_IDENTITY_ITEM_STALE_REVISION')) {
    return 'This batch changed on another device. Reload the current server version before saving again.';
  }
  if (message.includes('PRODUCT_IDENTITY_BATCH_HAS_UNRESOLVED_ITEMS')) {
    return 'Every captured item must be verified before publication.';
  }
  if (message.includes('PRODUCT_IDENTITY_SCOPE_INCOMPLETE')) {
    return 'Active Commercial SKUs remain unmapped. Complete the generated site task list before publication.';
  }
  if (message.includes('BARCODE_ASSIGNED_TO_OTHER_PHYSICAL_SKU')) {
    return 'This barcode is already published against another Physical SKU. It was not overwritten.';
  }
  if (message.includes('UNKNOWN_OR_UNPUBLISHED_BARCODE')) {
    return 'This barcode has not been published. Capture it in Product Identity before using it operationally.';
  }
  if (message.includes('PRODUCT_IDENTITY_SUPERVISOR_REQUIRED')) {
    return 'Owner or Admin approval is required for this action.';
  }
  return message;
}

export async function startProductIdentityBatch(batchName?: string, client?: SupabaseClient | null) {
  const rows = await rpc<Array<{
    batch_id: string;
    batch_status: string;
    revision: number | string;
    batch_name: string;
    created_at: string;
  }>>('ecoflow_start_product_identity_batch', {
    p_batch_name: batchName?.trim() || 'Warehouse product identity commissioning',
    p_command_id: commandId(),
  }, client);
  return first(rows, 'Product identity batch');
}

export async function loadProductIdentityReadiness(client?: SupabaseClient | null) {
  const rows = await rpc<ProductIdentityReadiness[]>('ecoflow_read_product_identity_readiness', undefined, client);
  return first(rows, 'Product identity readiness');
}

export async function loadProductIdentityTasks(input?: {
  search?: string;
  state?: string;
  limit?: number;
}, client?: SupabaseClient | null) {
  return await rpc<ProductIdentityTask[]>('ecoflow_read_product_identity_tasks', {
    p_search: input?.search?.trim() || null,
    p_state: input?.state?.trim() || null,
    p_limit: input?.limit ?? 500,
  }, client) ?? [];
}

export async function loadCommercialSkuOptions(search?: string, client?: SupabaseClient | null) {
  return await rpc<CommercialSkuOption[]>('ecoflow_read_commercial_sku_options', {
    p_search: search?.trim() || null,
    p_limit: 500,
  }, client) ?? [];
}

export async function loadPhysicalSkuOptions(search?: string, client?: SupabaseClient | null) {
  return await rpc<PhysicalSkuOption[]>('ecoflow_read_physical_sku_options', {
    p_search: search?.trim() || null,
    p_limit: 500,
  }, client) ?? [];
}

export async function loadSkuFamilyOptions(client?: SupabaseClient | null) {
  return await rpc<SkuFamilyOption[]>('ecoflow_read_sku_family_options', undefined, client) ?? [];
}

export async function loadProductIdentityBatchItems(batchId: string, client?: SupabaseClient | null) {
  return await rpc<ProductIdentityBatchItem[]>('ecoflow_read_product_identity_batch_items', {
    p_batch_id: batchId,
  }, client) ?? [];
}

export async function loadProductIdentityWorkspace(input?: {
  search?: string;
  state?: string;
}, client?: SupabaseClient | null): Promise<ProductIdentityWorkspaceData> {
  let readiness = await loadProductIdentityReadiness(client);
  if (!readiness.batch_id) {
    await startProductIdentityBatch(undefined, client);
    readiness = await loadProductIdentityReadiness(client);
  }
  const batchId = readiness.batch_id;
  const [tasks, commercialSkus, physicalSkus, families, items] = await Promise.all([
    loadProductIdentityTasks(input, client),
    loadCommercialSkuOptions(undefined, client),
    loadPhysicalSkuOptions(undefined, client),
    loadSkuFamilyOptions(client),
    batchId ? loadProductIdentityBatchItems(batchId, client) : Promise.resolve([]),
  ]);
  return { readiness, tasks, commercialSkus, physicalSkus, families, items };
}

export async function saveProductIdentityDraft(input: ProductIdentityDraftInput, client?: SupabaseClient | null) {
  const rows = await rpc<Array<{
    batch_id: string;
    batch_revision: number | string;
    item_id: string;
    item_state: ProductIdentityItemState;
    item_revision: number | string;
    conflict_codes: string[];
    saved_at: string;
  }>>('ecoflow_save_product_identity_draft', {
    p_batch_id: input.batchId,
    p_barcode: input.barcode.trim(),
    p_physical_sku: input.physicalSku.trim().toUpperCase(),
    p_product_name: input.productName.trim(),
    p_brand: input.brand?.trim() || null,
    p_family_code: input.familyCode.trim().toUpperCase(),
    p_family_name: input.familyName.trim(),
    p_commercial_sku: input.commercialSku.trim().toUpperCase(),
    p_package_level: input.packageLevel,
    p_units_per_barcode: input.unitsPerBarcode,
    p_substitution_policy: input.substitutionPolicy,
    p_is_preferred: input.preferred,
    p_note: input.note?.trim() || null,
    p_expected_batch_revision: input.expectedBatchRevision,
    p_auto_verify: input.autoVerify,
    p_command_id: commandId(),
  }, client);
  return first(rows, 'Product identity save');
}

export async function reviewProductIdentityItem(input: {
  itemId: string;
  expectedItemRevision: number;
  decision: 'APPROVE' | 'REJECT';
  note: string;
}, client?: SupabaseClient | null) {
  const rows = await rpc<Array<{
    item_id: string;
    item_state: ProductIdentityItemState;
    item_revision: number | string;
    batch_id: string;
    batch_revision: number | string;
    reviewed_at: string;
  }>>('ecoflow_review_product_identity_item', {
    p_item_id: input.itemId,
    p_expected_item_revision: input.expectedItemRevision,
    p_decision: input.decision,
    p_note: input.note.trim(),
    p_command_id: commandId(),
  }, client);
  return first(rows, 'Product identity review');
}

export async function publishProductIdentityBatch(input: {
  batchId: string;
  expectedBatchRevision: number;
  note: string;
}, client?: SupabaseClient | null) {
  const rows = await rpc<Array<{
    batch_id: string;
    batch_status: string;
    batch_revision: number | string;
    published_items: number | string;
    published_at: string;
  }>>('ecoflow_publish_product_identity_batch', {
    p_batch_id: input.batchId,
    p_expected_batch_revision: input.expectedBatchRevision,
    p_publication_note: input.note.trim(),
    p_command_id: commandId(),
  }, client);
  return first(rows, 'Product identity publication');
}

export async function validateProductIdentityScan(input: {
  barcode: string;
  commercialSku?: string | null;
  operation: 'LOOKUP' | 'RECEIVING' | 'PICKING' | 'STOCKTAKE' | 'RETURN';
}, client?: SupabaseClient | null) {
  const rows = await rpc<ProductIdentityScanValidation[]>('ecoflow_validate_product_identity_scan', {
    p_barcode: input.barcode.trim(),
    p_commercial_sku: input.commercialSku?.trim().toUpperCase() || null,
    p_operation: input.operation,
  }, client);
  return first(rows, 'Product identity scan validation');
}
