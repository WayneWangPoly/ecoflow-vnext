#!/usr/bin/env node
import fs from 'node:fs';

function patch(path, replacements) {
  let source = fs.readFileSync(path, 'utf8');
  let changed = false;
  for (const [before, after] of replacements) {
    if (source.includes(after)) continue;
    if (!source.includes(before)) {
      throw new Error(`${path}: expected source block was not found:\n${before.slice(0, 300)}`);
    }
    source = source.replace(before, after);
    changed = true;
  }
  if (changed) fs.writeFileSync(path, source);
  return changed;
}

const changed = [];

if (patch('src/app/App.tsx', [[
`  // Releasable: gate passed and either the internal order already exists (normal path) or it can be created.
  const releasable = (order: ImportedOrder) => order.status === 'RELEASE_READY' && (order.hasInternalOrder || order.canCreateInternalOrder !== false);`,
`  // Run release is step two: the authoritative gate must still pass and the
  // database-created internal order must already exist. Source orders that are
  // merely eligible for internalisation can never be inserted into a driver run.
  const releasable = (order: ImportedOrder) =>
    order.status === 'RELEASE_READY'
    && order.releaseGateStatus === 'READY_TO_RELEASE'
    && order.hasInternalOrder === true
    && !order.releaseBlockers;`,
]])) changed.push('src/app/App.tsx');

if (patch('src/data/repositories/supabaseOrdermentumViews.ts', [[
`function paymentStatus(value: string | null | undefined): PaymentStatus {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('paid')) return 'PAID';
  if (normalized.includes('overdue')) return 'OVERDUE';
  return 'UNPAID';
}`,
`function paymentStatus(value: string | null | undefined): PaymentStatus {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized.includes('hold') || normalized.includes('credit_review')) return 'CREDIT_HOLD';
  if (normalized.includes('overdue')) return 'OVERDUE';
  if (normalized === 'paid' || normalized === 'settled' || normalized === 'payment_received') return 'PAID';
  return 'UNPAID';
}

function isAccountHold(value: string | null | undefined) {
  const normalized = String(value || '').trim().toUpperCase();
  return ['HOLD_PAYMENT_REVIEW', 'REVIEW_PAYMENT', 'CREDIT_HOLD', 'ON_HOLD', 'HELD'].includes(normalized)
    || normalized.includes('HOLD');
}`,
], [
`  if (String(draft?.account_release_status || '') === 'HOLD_PAYMENT_REVIEW') return 'IMPORTED';`,
`  if (isAccountHold(draft?.account_release_status)) return 'IMPORTED';`,
], [
`  if (String(draft?.account_release_status || '') === 'HOLD_PAYMENT_REVIEW') return 'REVIEW_PAYMENT';`,
`  if (isAccountHold(draft?.account_release_status)) return 'REVIEW_PAYMENT';`,
], [
`  if (String(draft.account_release_status || '') === 'HOLD_PAYMENT_REVIEW') parts.push('Payment review hold');`,
`  if (isAccountHold(draft.account_release_status)) parts.push('EcoFlow account release hold');`,
]])) changed.push('src/data/repositories/supabaseOrdermentumViews.ts');

if (patch('src/data/repositories/resilientOrdermentumViews.ts', [[
`type LiveLocationBalanceRow = {
  sku: string | null;
  location: string | null;
  on_hand_location: number | string | null;
};`,
`type LiveLocationBalanceRow = {
  sku: string | null;
  location: string | null;
  on_hand_location: number | string | null;
};

type AccountReleaseHoldRow = {
  store_id: string;
  active: boolean | null;
  hold_reason: string | null;
};`,
], [
`export type ResilientOrdermentumViews = SupabaseOrdermentumViews & {
  diagnostics: OperationalSourceDiagnostic[];
};`,
`export type ResilientOrdermentumViews = SupabaseOrdermentumViews & {
  diagnostics: OperationalSourceDiagnostic[];
  accountHolds: AccountReleaseHoldRow[];
};`,
], [
`  'pending',
  'processing',`,
`  'pending',
  'placed',
  'processing',`,
], [
`  const draftByKey = new Map<string, SupabaseDraftRow>();
  views.drafts.forEach((draft) => addKeys(draftByKey, draft, [
    draft.raw_order_id,
    draft.external_order_id,
    draft.external_order_number,
    draft.order_number,
    draft.invoice_number,
  ]));

  const orders = projected.orders.map((order): ImportedOrder => {`,
`  const draftByKey = new Map<string, SupabaseDraftRow>();
  views.drafts.forEach((draft) => addKeys(draftByKey, draft, [
    draft.raw_order_id,
    draft.external_order_id,
    draft.external_order_number,
    draft.order_number,
    draft.invoice_number,
  ]));

  const omOrderByKey = new Map<string, SupabaseOmOrderRow>();
  views.omOrders.forEach((row) => addKeys(omOrderByKey, row, [row.id, row.order_number]));
  const holdByStoreId = new Map(
    views.accountHolds
      .filter((hold) => hold.active !== false && hold.store_id)
      .map((hold) => [hold.store_id, hold] as const),
  );

  const orders = projected.orders.map((order): ImportedOrder => {`,
], [
`    const draft = draftByKey.get(order.id)
      || draftByKey.get(order.externalOrderId)
      || draftByKey.get(order.orderNo)
      || draftByKey.get(order.invoiceNo);

    const liveWarehouseStatus = warehouseStatus(draft);
    if (liveWarehouseStatus) {
      return {
        ...order,
        status: liveWarehouseStatus,
        selected: false,
        canCreateInternalOrder: false,
        hasInternalOrder: true,
      };
    }

    if (draft?.internal_order_id) {
      return {
        ...order,
        selected: order.status === 'RELEASE_READY',
        canCreateInternalOrder: false,
        hasInternalOrder: true,
      };
    }

    const sourceStatus = String(row?.order_status || '').trim().toLowerCase();
    if (!EXPLICIT_CURRENT_SOURCE_STATUSES.has(sourceStatus)) {
      const blocker = sourceStatus
        ? \`Ordermentum status “\${row?.order_status}” requires review before release.\`
        : 'Ordermentum source status is missing; review before release.';
      return {
        ...order,
        status: 'IMPORTED',
        selected: false,
        canCreateInternalOrder: false,
        hasInternalOrder: false,
        releaseGateStatus: 'BLOCKED_DATA',
        releaseBlockers: blocker,
        changeSummary: blocker,
        openExceptionCount: Math.max(1, order.openExceptionCount),
      };
    }

    return {
      ...order,
      selected: order.status === 'RELEASE_READY' && order.canCreateInternalOrder !== false,
      hasInternalOrder: false,
    };`,
`    const draft = draftByKey.get(order.id)
      || draftByKey.get(order.externalOrderId)
      || draftByKey.get(order.orderNo)
      || draftByKey.get(order.invoiceNo);
    const omOrder = omOrderByKey.get(order.externalOrderId)
      || omOrderByKey.get(order.id)
      || omOrderByKey.get(order.orderNo);
    const accountHold = omOrder?.retailer_id ? holdByStoreId.get(omOrder.retailer_id) : undefined;
    const sourceStatus = String(row?.order_status || '').trim().toLowerCase();
    const sourceRecognised = EXPLICIT_CURRENT_SOURCE_STATUSES.has(sourceStatus);
    const liveWarehouseStatus = warehouseStatus(draft);

    if (!sourceRecognised) {
      const blocker = sourceStatus
        ? \`Ordermentum status “\${row?.order_status}” requires review before release.\`
        : 'Ordermentum source status is missing; review before release.';
      return {
        ...order,
        status: liveWarehouseStatus || 'IMPORTED',
        selected: false,
        canCreateInternalOrder: false,
        hasInternalOrder: Boolean(draft?.internal_order_id),
        releaseGateStatus: 'BLOCKED_DATA',
        releaseBlockers: blocker,
        changeSummary: blocker,
        openExceptionCount: Math.max(1, order.openExceptionCount),
      };
    }

    if (accountHold) {
      const blocker = \`EcoFlow account release hold · \${accountHold.hold_reason || 'Accounts review required'}\`;
      return {
        ...order,
        status: liveWarehouseStatus || 'IMPORTED',
        paymentStatus: 'CREDIT_HOLD',
        selected: false,
        canCreateInternalOrder: false,
        hasInternalOrder: Boolean(draft?.internal_order_id),
        releaseGateStatus: 'REVIEW_PAYMENT',
        releaseBlockers: blocker,
        changeSummary: blocker,
        openExceptionCount: Math.max(1, order.openExceptionCount),
      };
    }

    if (liveWarehouseStatus) {
      return {
        ...order,
        status: liveWarehouseStatus,
        selected: false,
        canCreateInternalOrder: false,
        hasInternalOrder: true,
      };
    }

    if (draft?.internal_order_id) {
      const releaseReady = order.status === 'RELEASE_READY'
        && order.releaseGateStatus === 'READY_TO_RELEASE'
        && !order.releaseBlockers;
      return {
        ...order,
        selected: releaseReady,
        canCreateInternalOrder: false,
        hasInternalOrder: true,
      };
    }

    // The source order may be eligible for database internalisation, but it is
    // not yet eligible for a driver run. The strict run-release predicate also
    // requires hasInternalOrder=true after the RPC completes and data reloads.
    return {
      ...order,
      selected: false,
      hasInternalOrder: false,
    };`,
], [
`  const [healthResult, skuResult, inventoryResult, barcodeResult, liveBalanceResult, storeResult, releaseResult, mappingResult] = await Promise.all([`,
`  const [healthResult, skuResult, inventoryResult, barcodeResult, liveBalanceResult, storeResult, releaseResult, mappingResult, holdResult] = await Promise.all([`,
], [
`    optionalFetch<SupabaseSkuMappingCandidateRow[]>('SKU mapping candidates', 'v_ecoflow_ordermentum_sku_mapping_candidates?select=*&order=order_count.desc&limit=1000', []),
  ]);`,
`    optionalFetch<SupabaseSkuMappingCandidateRow[]>('SKU mapping candidates', 'v_ecoflow_ordermentum_sku_mapping_candidates?select=*&order=order_count.desc&limit=1000', []),
    optionalFetch<AccountReleaseHoldRow[]>('account release holds', 'v_ecoflow_account_release_holds_v1?select=store_id,active,hold_reason&limit=1000', []),
  ]);`,
], [
`    skuMappingCandidates: mappingResult.data,
    diagnostics: [`,
`    skuMappingCandidates: mappingResult.data,
    accountHolds: holdResult.data,
    diagnostics: [`,
], [
`      mappingResult.diagnostic,
    ],`,
`      mappingResult.diagnostic,
      holdResult.diagnostic,
    ],`,
]])) changed.push('src/data/repositories/resilientOrdermentumViews.ts');

console.log(JSON.stringify({ action: 'apply_commercial_source_boundary_code_patches', changed }, null, 2));
