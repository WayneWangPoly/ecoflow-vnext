import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const target = {
  mode: 'P3_VERIFY_READ_ONLY',
  commandId: '7900f15b-bdae-444f-b22c-04000730e260',
  promotionTimestamp: '2026-09-13T11:35:14.960842Z',
  commandPayloadSha256: '0fca9742c34f623ae6dbf1614d5966513fdfa7d5167c7caf4c2a798e956599ef',
  candidateSetSha256: '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
  externalProductCode: '140010',
  commercialSkuId: '4710bb98-2706-42e5-866b-8788e36e1acc',
  externalMappingId: '1995b15c-7ee7-466b-ba3e-daba596d71a3',
  sourceMappingId: '3001d0f1-6c1b-4b15-98a0-91443ca6b525',
  sourceMappingRevision: 0,
  sourcePayloadSha256: '016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8',
  sourceExternalKey: 'guid:e80b9e1d-f33d-4ebf-b76d-dfdd9beb1a7b',
  auditId: '03dbe0fc-7188-4e70-a1fd-a33fb5524ba8',
  auditEvent: 'COMMERCIAL_WAVE2_SKU_PROMOTED',
} as const;

type Body = {
  mode?: string;
  expectedCommandId?: string;
  expectedCandidateSetSha256?: string;
  expectedExternalProductCode?: string;
  expectedCommercialSkuId?: string;
  expectedExternalMappingId?: string;
  expectedSourceMappingId?: string;
  expectedSourcePayloadSha256?: string;
};

type QueryResult = {
  data: unknown;
  error: { message: string } | null;
  count: number | null;
};

type Profile = { app_role: string; is_active: boolean; team_status: string };
type Row = Record<string, unknown>;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function exact(value: unknown, expected: string, code: string) {
  if (typeof value !== 'string' || value.trim().toLowerCase() !== expected.toLowerCase()) throw new Error(code);
}

function rows(label: string, result: QueryResult): Row[] {
  if (result.error) throw new Error(`${label}:${result.error.message}`);
  if (!Array.isArray(result.data) || result.data.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw new Error(`${label}:INVALID_RESULT`);
  }
  return result.data as Row[];
}

function count(label: string, result: QueryResult) {
  if (result.error) throw new Error(`${label}:${result.error.message}`);
  if (typeof result.count !== 'number') throw new Error(`${label}:COUNT_MISSING`);
  return result.count;
}

function stringValue(row: Row | undefined, key: string) {
  const value = row?.[key];
  return typeof value === 'string' ? value : null;
}

function numberValue(row: Row | undefined, key: string) {
  const value = row?.[key];
  return typeof value === 'number' ? value : null;
}

function booleanValue(row: Row | undefined, key: string) {
  const value = row?.[key];
  return typeof value === 'boolean' ? value : null;
}

function timestampValue(row: Row | undefined, key: string) {
  const value = stringValue(row, key);
  return value?.replace('+00:00', 'Z') ?? null;
}

function recordValue(row: Row | undefined, key: string): Row {
  const value = row?.[key];
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function sum(rowsToSum: Row[], key: string) {
  return rowsToSum.reduce((total, row) => {
    const value = row[key];
    return total + (typeof value === 'number' ? value : Number(value ?? 0));
  }, 0);
}

function mismatch(failures: string[], label: string, actual: unknown, expected: unknown) {
  if (actual !== expected) failures.push(`${label}:${String(actual)}`);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json(500, { error: 'MISSING_SUPABASE_SERVER_SECRETS' });

  const authorization = req.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json(401, { error: 'MISSING_AUTHORIZATION' });

  const readClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-ecoflow-boundary': 'P3_VERIFICATION_ONLY' } },
  });
  const { data: userData, error: userError } = await readClient.auth.getUser(authorization.slice('Bearer '.length));
  if (userError || !userData.user) return json(401, { error: 'INVALID_AUTHORIZATION' });

  const { data: profile, error: profileError } = await readClient.from('app_user_profiles')
    .select('app_role,is_active,team_status')
    .eq('user_id', userData.user.id)
    .single();
  if (profileError || !profile) return json(403, { error: 'ACTIVE_PROFILE_REQUIRED' });
  const actor = profile as Profile;
  if (!actor.is_active || actor.team_status !== 'ACTIVE' || !['OWNER', 'ADMIN'].includes(actor.app_role)) {
    return json(403, { error: 'OWNER_ADMIN_REQUIRED' });
  }

  let body: Body;
  try { body = await req.json(); }
  catch { return json(400, { error: 'INVALID_JSON_BODY' }); }

  try {
    exact(body.mode, target.mode, 'P3_MODE_MISMATCH');
    exact(body.expectedCommandId, target.commandId, 'P3_COMMAND_MISMATCH');
    exact(body.expectedCandidateSetSha256, target.candidateSetSha256, 'P3_COHORT_MISMATCH');
    exact(body.expectedExternalProductCode, target.externalProductCode, 'P3_CANARY_MISMATCH');
    exact(body.expectedCommercialSkuId, target.commercialSkuId, 'P3_COMMERCIAL_SKU_MISMATCH');
    exact(body.expectedExternalMappingId, target.externalMappingId, 'P3_EXTERNAL_MAPPING_MISMATCH');
    exact(body.expectedSourceMappingId, target.sourceMappingId, 'P3_SOURCE_MAPPING_MISMATCH');
    exact(body.expectedSourcePayloadSha256, target.sourcePayloadSha256, 'P3_SOURCE_SHA_MISMATCH');

    const changed = (created: string, updated?: string, retired?: string) => {
      const filters = [`${created}.gte.${target.promotionTimestamp}`];
      if (updated) filters.push(`${updated}.gt.${target.promotionTimestamp}`);
      if (retired) filters.push(`${retired}.gte.${target.promotionTimestamp}`);
      return filters.join(',');
    };

    const results = await Promise.all([
      readClient.from('skus').select('id,sku_code,category,setup_status,default_storage_unit,default_pick_unit').eq('sku_code', target.externalProductCode),
      readClient.from('external_product_mappings').select('id,provider,external_product_code,internal_sku_id,confidence,is_active').eq('provider', 'ORDERMENTUM').eq('external_product_code', target.externalProductCode).eq('is_active', true),
      readClient.from('ecoflow_unleashed_master_mappings').select('id,revision,source_payload_sha256,source_external_key,source_external_code,source_duplicate_count').eq('id', target.sourceMappingId),
      readClient.from('ecoflow_commercial_wave2_candidates').select('external_product_code,promotion_phase,enabled,candidate_set_sha256,unleashed_mapping_id,expected_mapping_revision,expected_source_payload_sha256,expected_source_external_key').eq('external_product_code', target.externalProductCode),
      readClient.from('ecoflow_commercial_wave2_promotion_commands').select('command_id,external_product_code,unleashed_mapping_id,expected_mapping_revision,expected_source_payload_sha256,command_payload_sha256,result,created_at').eq('command_id', target.commandId),
      readClient.from('ecoflow_commercial_wave2_promotions').select('external_product_code,unleashed_mapping_id,source_payload_sha256,commercial_sku_id,external_mapping_id,authorization_command_id,promoted_at').eq('external_product_code', target.externalProductCode),
      readClient.from('app_security_audit_events').select('id,actor_role,action,target_type,target_id,after_data,created_at').eq('id', target.auditId).eq('action', target.auditEvent),
      readClient.from('ecoflow_commercial_wave2_candidates').select('external_product_code,promotion_phase').eq('enabled', true),
      readClient.from('ecoflow_commercial_wave2_candidates').select('*', { count: 'exact', head: true }).eq('promotion_phase', 'EXPANSION').eq('enabled', true),
      readClient.from('ecoflow_commercial_wave2_promotions').select('*', { count: 'exact', head: true }),
      readClient.from('ecoflow_commercial_wave2_promotion_commands').select('*', { count: 'exact', head: true }),
      readClient.from('ecoflow_commercial_wave2_promotions').select('*', { count: 'exact', head: true }).neq('external_product_code', target.externalProductCode),
      readClient.from('ecoflow_commercial_wave2_plan_commands').select('*', { count: 'exact', head: true }),
      readClient.from('ecoflow_commercial_wave2_phase_unlocks').select('*', { count: 'exact', head: true }).eq('promotion_phase', 'CANARY'),
      readClient.from('ecoflow_commercial_wave2_unlock_commands').select('*', { count: 'exact', head: true }),
      readClient.from('skus').select('*', { count: 'exact', head: true }),
      readClient.from('ecoflow_sku_families').select('*', { count: 'exact', head: true }),
      readClient.from('ecoflow_physical_skus').select('*', { count: 'exact', head: true }),
      readClient.from('ecoflow_physical_sku_packages').select('*', { count: 'exact', head: true }),
      readClient.from('ecoflow_physical_barcode_bindings').select('*', { count: 'exact', head: true }),
      readClient.from('ecoflow_commercial_family_links').select('*', { count: 'exact', head: true }),
      readClient.from('ecoflow_inventory_movements').select('*', { count: 'exact', head: true }),
      readClient.from('ecoflow_warehouse_movements').select('*', { count: 'exact', head: true }),
      readClient.from('ecoflow_warehouse_location_items').select('quantity', { count: 'exact' }),
      readClient.from('stock_movements').select('*', { count: 'exact', head: true }),
      readClient.from('inventory_balances').select('quantity_on_hand', { count: 'exact' }),
      readClient.from('ecoflow_unleashed_product_assets').select('*', { count: 'exact', head: true }),
      readClient.from('ecoflow_unleashed_asset_copy_runs').select('*', { count: 'exact', head: true }),
      readClient.from('ecoflow_sku_families').select('*', { count: 'exact', head: true }).or(changed('created_at', 'updated_at', 'retired_at')),
      readClient.from('ecoflow_physical_skus').select('*', { count: 'exact', head: true }).or(changed('created_at', 'updated_at', 'retired_at')),
      readClient.from('ecoflow_physical_sku_packages').select('*', { count: 'exact', head: true }).or(changed('created_at', undefined, 'retired_at')),
      readClient.from('ecoflow_physical_barcode_bindings').select('*', { count: 'exact', head: true }).or(changed('created_at', undefined, 'retired_at')),
      readClient.from('ecoflow_commercial_family_links').select('*', { count: 'exact', head: true }).or(changed('created_at', undefined, 'retired_at')),
      readClient.from('ecoflow_inventory_movements').select('*', { count: 'exact', head: true }).gt('moved_at', target.promotionTimestamp),
      readClient.from('ecoflow_warehouse_movements').select('*', { count: 'exact', head: true }).gt('created_at', target.promotionTimestamp),
      readClient.from('ecoflow_warehouse_location_items').select('*', { count: 'exact', head: true }).or(changed('created_at', 'updated_at')),
      readClient.from('stock_movements').select('*', { count: 'exact', head: true }).or(changed('created_at', 'updated_at')),
      readClient.from('inventory_balances').select('*', { count: 'exact', head: true }).or(changed('created_at', 'updated_at')),
      readClient.from('ecoflow_unleashed_product_assets').select('*', { count: 'exact', head: true }).or(changed('created_at', 'updated_at', 'copied_at')),
      readClient.from('ecoflow_unleashed_asset_copy_runs').select('*', { count: 'exact', head: true }).or(`started_at.gt.${target.promotionTimestamp},completed_at.gt.${target.promotionTimestamp}`),
      readClient.from('ecoflow_unleashed_inventory_reference_commands').select('*', { count: 'exact', head: true }).gt('created_at', target.promotionTimestamp),
      readClient.from('ecoflow_unleashed_inventory_reference_batches').select('*', { count: 'exact', head: true }).or(changed('created_at', 'updated_at')),
      readClient.from('ecoflow_unleashed_inventory_reference_rows').select('*', { count: 'exact', head: true }).gt('created_at', target.promotionTimestamp),
      readClient.from('ordermentum_api_jobs').select('*', { count: 'exact', head: true }).or(changed('created_at', 'updated_at')),
      readClient.from('ordermentum_sync_runs_v2').select('*', { count: 'exact', head: true }).or(changed('created_at', 'updated_at')),
      readClient.from('ordermentum_master_sync_runs').select('*', { count: 'exact', head: true }).or(`started_at.gt.${target.promotionTimestamp},finished_at.gt.${target.promotionTimestamp}`),
      readClient.from('ordermentum_sync_batches').select('*', { count: 'exact', head: true }).gt('created_at', target.promotionTimestamp),
      readClient.from('ordermentum_raw_api_events_v2').select('*', { count: 'exact', head: true }).gt('created_at', target.promotionTimestamp),
      readClient.from('unleashed_sync_runs').select('*', { count: 'exact', head: true }).or(changed('created_at', 'updated_at')),
      readClient.from('unleashed_sync_batches').select('*', { count: 'exact', head: true }).or(changed('created_at', 'updated_at')),
      readClient.from('ordermentum_api_capabilities').select('*', { count: 'exact', head: true }).gt('last_checked_at', target.promotionTimestamp),
      readClient.from('ordermentum_api_sync_state').select('*', { count: 'exact', head: true }).gt('updated_at', target.promotionTimestamp),
      readClient.from('app_security_audit_events').select('action', { count: 'exact' }).gt('created_at', target.promotionTimestamp).or('action.ilike.%CUTOVER%,action.ilike.%CALLER%,action.ilike.%PROVIDER%,action.ilike.%RETIRE%,action.ilike.%WAREHOUSE%,action.ilike.%IMAGE%,action.ilike.%INVENTORY%'),
      readClient.from('app_security_audit_events').select('*', { count: 'exact', head: true }).gt('created_at', target.promotionTimestamp).ilike('action', '%CALLER%'),
      readClient.from('app_security_audit_events').select('*', { count: 'exact', head: true }).gt('created_at', target.promotionTimestamp).ilike('action', '%CUTOVER%'),
    ]);

    const [
      skuResult, externalMappingResult, provenanceResult, candidateResult, commandResult,
      promotionResult, auditResult, enabledResult, p4Result, promotionCountResult,
      commandCountResult, nonCanaryResult, planResult, canaryUnlockResult, unlockCommandResult,
      skuCountResult, familiesResult, physicalResult, packagesResult, barcodesResult,
      linksResult, inventoryMovementsResult, warehouseMovementsResult, locationItemsResult,
      stockMovementsResult, balancesResult, imageAssetsResult, imageRunsResult,
      familiesSinceResult, physicalSinceResult, packagesSinceResult, barcodesSinceResult,
      linksSinceResult, inventoryMovementsSinceResult, warehouseMovementsSinceResult,
      locationItemsSinceResult, stockMovementsSinceResult, balancesSinceResult,
      imageAssetsSinceResult, imageRunsSinceResult, inventoryRefCommandsResult,
      inventoryRefBatchesResult, inventoryRefRowsResult, ordermentumJobsResult,
      ordermentumRunsResult, ordermentumMasterRunsResult, ordermentumBatchesResult,
      ordermentumEventsResult, unleashedRunsResult, unleashedBatchesResult,
      capabilitiesResult, syncStateResult, boundaryAuditsResult, callerSwitchResult, cutoverResult,
    ] = results as QueryResult[];

    const skuRows = rows('P3_SKU_READ', skuResult);
    const externalMappingRows = rows('P3_EXTERNAL_MAPPING_READ', externalMappingResult);
    const provenanceRows = rows('P3_PROVENANCE_READ', provenanceResult);
    const candidateRows = rows('P3_CANDIDATE_READ', candidateResult);
    const commandRows = rows('P3_COMMAND_READ', commandResult);
    const promotionRows = rows('P3_PROMOTION_READ', promotionResult);
    const auditRows = rows('P3_AUDIT_READ', auditResult);
    const enabledRows = rows('P3_ENABLED_READ', enabledResult);
    const locationRows = rows('P3_LOCATION_QUANTITY_READ', locationItemsResult);
    const balanceRows = rows('P3_INVENTORY_QOH_READ', balancesResult);

    const sku = skuRows[0];
    const externalMapping = externalMappingRows[0];
    const provenance = provenanceRows[0];
    const candidate = candidateRows[0];
    const command = commandRows[0];
    const promotion = promotionRows[0];
    const audit = auditRows[0];
    const commandData = recordValue(command, 'result');
    const auditData = recordValue(audit, 'after_data');

    const sincePromotion = {
      skuFamilies: count('P3_FAMILIES_SINCE', familiesSinceResult),
      physicalSkus: count('P3_PHYSICAL_SINCE', physicalSinceResult),
      packages: count('P3_PACKAGES_SINCE', packagesSinceResult),
      barcodeBindings: count('P3_BARCODES_SINCE', barcodesSinceResult),
      commercialFamilyLinks: count('P3_LINKS_SINCE', linksSinceResult),
      inventoryMovements: count('P3_INVENTORY_MOVEMENTS_SINCE', inventoryMovementsSinceResult),
      warehouseMovements: count('P3_WAREHOUSE_MOVEMENTS_SINCE', warehouseMovementsSinceResult),
      locationItems: count('P3_LOCATION_ITEMS_SINCE', locationItemsSinceResult),
      stockMovements: count('P3_STOCK_MOVEMENTS_SINCE', stockMovementsSinceResult),
      inventoryBalances: count('P3_BALANCES_SINCE', balancesSinceResult),
      imageAssets: count('P3_IMAGE_ASSETS_SINCE', imageAssetsSinceResult),
      imageCopyRuns: count('P3_IMAGE_RUNS_SINCE', imageRunsSinceResult),
      inventoryReferenceCommands: count('P3_339_COMMANDS_SINCE', inventoryRefCommandsResult),
      inventoryReferenceBatches: count('P3_339_BATCHES_SINCE', inventoryRefBatchesResult),
      inventoryReferenceRows: count('P3_339_ROWS_SINCE', inventoryRefRowsResult),
      ordermentumApiJobs: count('P3_359_JOBS_SINCE', ordermentumJobsResult),
      ordermentumSyncRuns: count('P3_359_RUNS_SINCE', ordermentumRunsResult),
      ordermentumMasterSyncRuns: count('P3_359_MASTER_RUNS_SINCE', ordermentumMasterRunsResult),
      ordermentumSyncBatches: count('P3_359_BATCHES_SINCE', ordermentumBatchesResult),
      ordermentumRawApiEvents: count('P3_359_EVENTS_SINCE', ordermentumEventsResult),
      unleashedSyncRuns: count('P3_UNLEASHED_RUNS_SINCE', unleashedRunsResult),
      unleashedSyncBatches: count('P3_UNLEASHED_BATCHES_SINCE', unleashedBatchesResult),
      ordermentumCapabilities: count('P3_CAPABILITIES_SINCE', capabilitiesResult),
      ordermentumSyncState: count('P3_SYNC_STATE_SINCE', syncStateResult),
    };

    const report = {
      mode: target.mode,
      stage: 'P3_VERIFICATION_ONLY',
      verdict: 'HOLD',
      verifiedAt: new Date().toISOString(),
      verifierRole: actor.app_role,
      identity: {
        count: skuRows.length,
        id: stringValue(sku, 'id'),
        code: stringValue(sku, 'sku_code'),
        setupStatus: stringValue(sku, 'setup_status'),
        category: stringValue(sku, 'category'),
        storageUnit: stringValue(sku, 'default_storage_unit'),
        pickUnit: stringValue(sku, 'default_pick_unit'),
      },
      mapping: {
        count: externalMappingRows.length,
        id: stringValue(externalMapping, 'id'),
        provider: stringValue(externalMapping, 'provider'),
        isActive: booleanValue(externalMapping, 'is_active'),
        internalSkuId: stringValue(externalMapping, 'internal_sku_id'),
        confidence: stringValue(externalMapping, 'confidence'),
      },
      provenance: {
        count: provenanceRows.length,
        id: stringValue(provenance, 'id'),
        revision: numberValue(provenance, 'revision'),
        sourcePayloadSha256: stringValue(provenance, 'source_payload_sha256'),
        sourceExternalKey: stringValue(provenance, 'source_external_key'),
        sourceExternalCode: stringValue(provenance, 'source_external_code'),
        sourceDuplicateCount: numberValue(provenance, 'source_duplicate_count'),
      },
      lineage: {
        commandCount: count('P3_COMMAND_COUNT', commandCountResult),
        promotionCount: count('P3_PROMOTION_COUNT', promotionCountResult),
        commandId: stringValue(command, 'command_id'),
        commandPayloadSha256: stringValue(command, 'command_payload_sha256'),
        initialReplayed: booleanValue(commandData, 'replayed'),
        authorizationCommandId: stringValue(promotion, 'authorization_command_id'),
        promotionExternalProductCode: stringValue(promotion, 'external_product_code'),
        commercialSkuId: stringValue(promotion, 'commercial_sku_id'),
        externalMappingId: stringValue(promotion, 'external_mapping_id'),
        sourceMappingId: stringValue(promotion, 'unleashed_mapping_id'),
        sourcePayloadSha256: stringValue(promotion, 'source_payload_sha256'),
        promotedAt: timestampValue(promotion, 'promoted_at'),
      },
      audit: {
        count: auditRows.length,
        id: stringValue(audit, 'id'),
        event: stringValue(audit, 'action'),
        actorRole: stringValue(audit, 'actor_role'),
        targetType: stringValue(audit, 'target_type'),
        targetId: stringValue(audit, 'target_id'),
        commandId: stringValue(promotion, 'authorization_command_id'),
        commercialSkuId: stringValue(auditData, 'commercialSkuId'),
        externalMappingId: stringValue(auditData, 'externalMappingId'),
        replayed: booleanValue(auditData, 'replayed'),
      },
      negativeSpace: {
        planCommands: count('P3_PLAN_COUNT', planResult),
        canaryUnlocks: count('P3_CANARY_UNLOCK_COUNT', canaryUnlockResult),
        unlockCommands: count('P3_UNLOCK_COMMAND_COUNT', unlockCommandResult),
        enabledCandidates: enabledRows.length,
        enabledCodes: enabledRows.map((row) => stringValue(row, 'external_product_code')).filter((value): value is string => value !== null),
        p4EnabledCandidates: count('P3_P4_ENABLED_COUNT', p4Result),
        nonCanaryPromotions: count('P3_NON_CANARY_PROMOTIONS', nonCanaryResult),
        secondPromotionCount: Math.max(0, count('P3_TOTAL_PROMOTIONS', promotionCountResult) - 1),
      },
      sentinels: {
        current: {
          commercialSkus: count('P3_SKUS', skuCountResult),
          skuFamilies: count('P3_FAMILIES', familiesResult),
          physicalSkus: count('P3_PHYSICAL', physicalResult),
          packages: count('P3_PACKAGES', packagesResult),
          barcodeBindings: count('P3_BARCODES', barcodesResult),
          commercialFamilyLinks: count('P3_LINKS', linksResult),
          inventoryMovements: count('P3_INVENTORY_MOVEMENTS', inventoryMovementsResult),
          warehouseMovements: count('P3_WAREHOUSE_MOVEMENTS', warehouseMovementsResult),
          locationItems: locationRows.length,
          stockMovements: count('P3_STOCK_MOVEMENTS', stockMovementsResult),
          locationQuantity: sum(locationRows, 'quantity'),
          inventoryBalanceRows: balanceRows.length,
          inventoryQoh: sum(balanceRows, 'quantity_on_hand'),
          imageAssets: count('P3_IMAGE_ASSETS', imageAssetsResult),
          imageCopyRuns: count('P3_IMAGE_RUNS', imageRunsResult),
        },
        sincePromotion,
        boundaries: {
          providerTraffic: sincePromotion.ordermentumApiJobs + sincePromotion.ordermentumSyncRuns + sincePromotion.ordermentumMasterSyncRuns + sincePromotion.ordermentumSyncBatches + sincePromotion.ordermentumRawApiEvents + sincePromotion.unleashedSyncRuns + sincePromotion.unleashedSyncBatches,
          callerSwitch: count('P3_CALLER_SWITCH', callerSwitchResult) + sincePromotion.ordermentumCapabilities + sincePromotion.ordermentumSyncState,
          cutover: count('P3_CUTOVER', cutoverResult),
          nonPromotionAudits: count('P3_BOUNDARY_AUDITS', boundaryAuditsResult),
        },
      },
      noProductionBusinessMutation: true,
      p4Locked: false,
      failedChecks: [] as string[],
    };

    const failures = report.failedChecks;
    mismatch(failures, 'identity.count', report.identity.count, 1);
    mismatch(failures, 'identity.id', report.identity.id, target.commercialSkuId);
    mismatch(failures, 'identity.code', report.identity.code, target.externalProductCode);
    mismatch(failures, 'identity.setupStatus', report.identity.setupStatus, 'mapping_draft');
    mismatch(failures, 'mapping.count', report.mapping.count, 1);
    mismatch(failures, 'mapping.id', report.mapping.id, target.externalMappingId);
    mismatch(failures, 'mapping.provider', report.mapping.provider, 'ORDERMENTUM');
    mismatch(failures, 'mapping.isActive', report.mapping.isActive, true);
    mismatch(failures, 'mapping.internalSkuId', report.mapping.internalSkuId, target.commercialSkuId);
    mismatch(failures, 'provenance.count', report.provenance.count, 1);
    mismatch(failures, 'provenance.id', report.provenance.id, target.sourceMappingId);
    mismatch(failures, 'provenance.revision', report.provenance.revision, target.sourceMappingRevision);
    mismatch(failures, 'provenance.sourcePayloadSha256', report.provenance.sourcePayloadSha256, target.sourcePayloadSha256);
    mismatch(failures, 'provenance.sourceExternalKey', report.provenance.sourceExternalKey, target.sourceExternalKey);
    mismatch(failures, 'provenance.sourceExternalCode', report.provenance.sourceExternalCode, target.externalProductCode);
    mismatch(failures, 'provenance.sourceDuplicateCount', report.provenance.sourceDuplicateCount, 1);
    mismatch(failures, 'candidate.count', candidateRows.length, 1);
    mismatch(failures, 'candidate.enabled', booleanValue(candidate, 'enabled'), true);
    mismatch(failures, 'candidate.phase', stringValue(candidate, 'promotion_phase'), 'CANARY');
    mismatch(failures, 'candidate.cohort', stringValue(candidate, 'candidate_set_sha256'), target.candidateSetSha256);
    mismatch(failures, 'lineage.commandRows', commandRows.length, 1);
    mismatch(failures, 'lineage.promotionRows', promotionRows.length, 1);
    mismatch(failures, 'lineage.commandCount', report.lineage.commandCount, 1);
    mismatch(failures, 'lineage.promotionCount', report.lineage.promotionCount, 1);
    mismatch(failures, 'lineage.commandId', report.lineage.commandId, target.commandId);
    mismatch(failures, 'lineage.commandPayloadSha256', report.lineage.commandPayloadSha256, target.commandPayloadSha256);
    mismatch(failures, 'lineage.initialReplayed', report.lineage.initialReplayed, false);
    mismatch(failures, 'lineage.authorizationCommandId', report.lineage.authorizationCommandId, target.commandId);
    mismatch(failures, 'lineage.externalProductCode', report.lineage.promotionExternalProductCode, target.externalProductCode);
    mismatch(failures, 'lineage.commercialSkuId', report.lineage.commercialSkuId, target.commercialSkuId);
    mismatch(failures, 'lineage.externalMappingId', report.lineage.externalMappingId, target.externalMappingId);
    mismatch(failures, 'lineage.sourceMappingId', report.lineage.sourceMappingId, target.sourceMappingId);
    mismatch(failures, 'lineage.sourcePayloadSha256', report.lineage.sourcePayloadSha256, target.sourcePayloadSha256);
    mismatch(failures, 'lineage.promotedAt', report.lineage.promotedAt, target.promotionTimestamp);
    mismatch(failures, 'audit.count', report.audit.count, 1);
    mismatch(failures, 'audit.id', report.audit.id, target.auditId);
    mismatch(failures, 'audit.event', report.audit.event, target.auditEvent);
    mismatch(failures, 'audit.actorRole', report.audit.actorRole, 'ADMIN');
    mismatch(failures, 'audit.targetType', report.audit.targetType, 'external_product_mappings');
    mismatch(failures, 'audit.targetId', report.audit.targetId, target.externalMappingId);
    mismatch(failures, 'audit.commercialSkuId', report.audit.commercialSkuId, target.commercialSkuId);
    mismatch(failures, 'audit.externalMappingId', report.audit.externalMappingId, target.externalMappingId);
    mismatch(failures, 'audit.replayed', report.audit.replayed, false);
    mismatch(failures, 'planCommands', report.negativeSpace.planCommands, 1);
    mismatch(failures, 'canaryUnlocks', report.negativeSpace.canaryUnlocks, 1);
    mismatch(failures, 'unlockCommands', report.negativeSpace.unlockCommands, 1);
    mismatch(failures, 'enabledCandidates', report.negativeSpace.enabledCandidates, 1);
    mismatch(failures, 'enabledCodes', report.negativeSpace.enabledCodes.join(','), target.externalProductCode);
    mismatch(failures, 'p4EnabledCandidates', report.negativeSpace.p4EnabledCandidates, 0);
    mismatch(failures, 'nonCanaryPromotions', report.negativeSpace.nonCanaryPromotions, 0);
    mismatch(failures, 'secondPromotionCount', report.negativeSpace.secondPromotionCount, 0);

    const expectedCurrent: Record<string, number> = {
      commercialSkus: 192, skuFamilies: 4, physicalSkus: 4, packages: 4,
      barcodeBindings: 4, commercialFamilyLinks: 4, inventoryMovements: 0,
      warehouseMovements: 0, locationItems: 0, stockMovements: 0,
      locationQuantity: 0, inventoryBalanceRows: 1, inventoryQoh: 11,
      imageAssets: 467, imageCopyRuns: 45,
    };
    for (const [label, expected] of Object.entries(expectedCurrent)) {
      mismatch(failures, `sentinels.current.${label}`, report.sentinels.current[label as keyof typeof report.sentinels.current], expected);
    }
    for (const [label, actual] of Object.entries(sincePromotion)) mismatch(failures, `sentinels.sincePromotion.${label}`, actual, 0);
    mismatch(failures, 'boundaries.providerTraffic', report.sentinels.boundaries.providerTraffic, 0);
    mismatch(failures, 'boundaries.callerSwitch', report.sentinels.boundaries.callerSwitch, 0);
    mismatch(failures, 'boundaries.cutover', report.sentinels.boundaries.cutover, 0);
    mismatch(failures, 'boundaries.nonPromotionAudits', report.sentinels.boundaries.nonPromotionAudits, 0);

    report.p4Locked = report.negativeSpace.p4EnabledCandidates === 0 && report.negativeSpace.nonCanaryPromotions === 0;
    report.verdict = failures.length === 0 && report.p4Locked ? 'PASS' : 'HOLD';
    return json(200, report);
  } catch (error) {
    const code = error instanceof Error ? error.message : String(error);
    return json(code.includes('FORBIDDEN') ? 403 : 400, { error: code, stage: 'P3_VERIFICATION_ONLY', verdict: 'HOLD' });
  }
});
