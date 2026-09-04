import type { SupabaseClient } from '@supabase/supabase-js';
import {
  readProductIdentityPage,
  type ProductIdentityRow,
} from './productIdentity';
import { readOperationalRecordDetail } from './operationalRecords';
import {
  toProductMasterIdentitySummary,
  type ProductMasterIdentityEvidence,
} from './productMaster';

function clean(value: string | null | undefined) {
  return String(value || '').trim();
}

function nullableText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nullableNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Read the already-governed Product Identity projection without creating authority. */
export async function readProductMasterIdentityRows(client?: SupabaseClient | null): Promise<ProductIdentityRow[]> {
  const pageSize = 100;
  const rows: ProductIdentityRow[] = [];
  let page = 1;
  let totalCount = Number.POSITIVE_INFINITY;
  while (rows.length < totalCount && page <= 20) {
    const result = await readProductIdentityPage({ filter: 'ALL', page, pageSize }, client);
    totalCount = result.totalCount;
    rows.push(...result.rows);
    if (!result.rows.length) break;
    page += 1;
  }
  return rows;
}

/**
 * Detail-only composition over existing governed read RPCs. Inventory quantities
 * are deliberately discarded; this returns identity evidence, never stock truth.
 */
export async function readProductMasterIdentityEvidence(
  productCode: string,
  client?: SupabaseClient | null,
): Promise<ProductMasterIdentityEvidence> {
  const code = clean(productCode);
  if (!code) return { summary: null, barcodes: [], readAt: null, state: 'UNAVAILABLE', issues: ['Commercial SKU code is required.'] };
  const [identityPage, detail] = await Promise.all([
    readProductIdentityPage({ search: code, filter: 'ALL', page: 1, pageSize: 100 }, client),
    readOperationalRecordDetail({ workspace: 'inventory', recordId: code, limit: 100 }, client),
  ]);
  const identity = identityPage.rows.find((row) =>
    row.commercialSkuCode.toUpperCase() === code.toUpperCase()
      || clean(row.ordermentumSku).toUpperCase() === code.toUpperCase()) ?? null;
  const barcodes = detail
    .filter((entry) => entry.kind === 'BARCODE')
    .flatMap((entry) => {
      const barcode = nullableText(entry.data.barcode);
      if (!barcode) return [];
      return [{
        barcode,
        physicalSkuCode: nullableText(entry.data.physical_sku_code),
        packageLevel: nullableText(entry.data.package_level),
        unitsInBaseUnit: nullableNumber(entry.data.units_in_base_unit),
      }];
    });
  const readAt = detail.map((entry) => entry.readAt).find(Boolean) ?? null;
  if (!identity) {
    return {
      summary: null,
      barcodes,
      readAt,
      state: 'UNAVAILABLE',
      issues: ['No governed Product Identity row is visible for this Commercial SKU.'],
    };
  }
  return {
    summary: toProductMasterIdentitySummary(identity),
    barcodes,
    readAt,
    state: identity.identityStatus === 'READY' ? 'READY' : 'DEGRADED',
    issues: identity.identityStatus === 'READY' ? [] : [identity.taskDetail || 'Physical SKU identity remains unresolved.'],
  };
}
