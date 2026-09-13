-- ECOFLOW-R3-P3A-R2: bounded authenticated evidence read authority.
--
-- This migration adds one no-argument, read-only RPC for the frozen Wave-2
-- canary. It deliberately leaves the three private Wave-2 ledgers without
-- direct authenticated table privileges or RLS policies.

begin;

do $dependencies$
begin
  if to_regclass('public.app_user_profiles') is null
     or to_regclass('public.app_security_audit_events') is null
     or to_regclass('public.skus') is null
     or to_regclass('public.external_product_mappings') is null
     or to_regclass('public.ecoflow_unleashed_master_mappings') is null
     or to_regclass('public.ecoflow_commercial_wave2_candidates') is null
     or to_regclass('public.ecoflow_commercial_wave2_plan_commands') is null
     or to_regclass('public.ecoflow_commercial_wave2_phase_unlocks') is null
     or to_regclass('public.ecoflow_commercial_wave2_unlock_commands') is null
     or to_regclass('public.ecoflow_commercial_wave2_promotions') is null
     or to_regclass('public.ecoflow_commercial_wave2_promotion_commands') is null
     or to_regclass('public.ecoflow_sku_families') is null
     or to_regclass('public.ecoflow_physical_skus') is null
     or to_regclass('public.ecoflow_physical_sku_packages') is null
     or to_regclass('public.ecoflow_physical_barcode_bindings') is null
     or to_regclass('public.ecoflow_commercial_family_links') is null
     or to_regclass('public.ecoflow_inventory_movements') is null
     or to_regclass('public.ecoflow_warehouse_movements') is null
     or to_regclass('public.ecoflow_warehouse_location_items') is null
     or to_regclass('public.stock_movements') is null
     or to_regclass('public.inventory_balances') is null
     or to_regclass('public.ecoflow_unleashed_product_assets') is null
     or to_regclass('public.ecoflow_unleashed_asset_copy_runs') is null
     or to_regclass('public.ecoflow_unleashed_inventory_reference_commands') is null
     or to_regclass('public.ecoflow_unleashed_inventory_reference_batches') is null
     or to_regclass('public.ecoflow_unleashed_inventory_reference_rows') is null
     or to_regclass('public.ordermentum_api_jobs') is null
     or to_regclass('public.ordermentum_master_sync_runs') is null
     or to_regclass('public.ordermentum_sync_batches') is null
     or to_regclass('public.unleashed_sync_runs') is null
     or to_regclass('public.unleashed_sync_batches') is null
     or to_regclass('public.ordermentum_api_capabilities') is null
     or to_regclass('public.ordermentum_sync_runs_v2') is null
     or to_regclass('public.ordermentum_raw_api_events_v2') is null
     or to_regclass('public.ordermentum_api_sync_state') is null
     or to_regprocedure('public.ecoflow_active_app_role()') is null
     or to_regprocedure('auth.uid()') is null then
    raise exception 'COMMERCIAL_WAVE2_P3A_DEPENDENCIES_MISSING';
  end if;
end;
$dependencies$;

create or replace function public.ecoflow_read_commercial_wave2_p3_verification()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_failures text[] := array[]::text[];
  v_identity jsonb;
  v_mapping jsonb;
  v_provenance jsonb;
  v_candidate jsonb;
  v_lineage jsonb;
  v_audit jsonb;
  v_negative_space jsonb;
  v_current jsonb;
  v_strict_since_p2b jsonb;
  v_provider jsonb;
  v_provider_status text;
  v_provider_runs bigint;
  v_allowed_provider_runs bigint;
  v_unattributed_provider_runs bigint;
  v_provider_events bigint;
  v_unattributed_provider_events bigint;
  v_provider_sync_state bigint;
  v_key text;
  v_p4_locked boolean;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'COMMERCIAL_WAVE2_P3_AUTHENTICATION_REQUIRED';
  end if;

  select p.app_role
    into v_actor_role
  from public.app_user_profiles p
  where p.user_id = v_actor
    and p.is_active
    and p.team_status = 'ACTIVE';

  if v_actor_role is null
     or v_actor_role not in ('OWNER', 'ADMIN')
     or public.ecoflow_active_app_role() is distinct from v_actor_role then
    raise exception using errcode = '42501', message = 'COMMERCIAL_WAVE2_P3_ACTIVE_OWNER_ADMIN_REQUIRED';
  end if;

  select pg_catalog.jsonb_build_object(
    'count', count(*),
    'id', max(s.id::text),
    'code', max(s.sku_code),
    'setupStatus', max(s.setup_status)
  )
  into v_identity
  from public.skus s
  where pg_catalog.upper(pg_catalog.btrim(s.sku_code)) = '140010';

  select pg_catalog.jsonb_build_object(
    'count', count(*),
    'id', max(m.id::text),
    'provider', max(m.provider),
    'internalSkuId', max(m.internal_sku_id::text),
    'isActive', coalesce(bool_and(m.is_active), false)
  )
  into v_mapping
  from public.external_product_mappings m
  where m.provider = 'ORDERMENTUM'
    and pg_catalog.upper(pg_catalog.btrim(m.external_product_code)) = '140010'
    and m.is_active;

  select pg_catalog.jsonb_build_object(
    'count', count(*),
    'id', max(m.id::text),
    'revision', max(m.revision),
    'sourcePayloadSha256', max(m.source_payload_sha256),
    'sourceExternalKey', max(m.source_external_key),
    'sourceExternalCode', max(m.source_external_code),
    'sourceDuplicateCount', max(m.source_duplicate_count)
  )
  into v_provenance
  from public.ecoflow_unleashed_master_mappings m
  where m.id = '3001d0f1-6c1b-4b15-98a0-91443ca6b525'::uuid;

  select pg_catalog.jsonb_build_object(
    'count', count(*),
    'externalProductCode', max(c.external_product_code),
    'promotionPhase', max(c.promotion_phase),
    'enabled', coalesce(bool_and(c.enabled), false),
    'candidateSetSha256', max(c.candidate_set_sha256),
    'sourceMappingId', max(c.unleashed_mapping_id::text),
    'expectedMappingRevision', max(c.expected_mapping_revision),
    'expectedSourcePayloadSha256', max(c.expected_source_payload_sha256),
    'expectedSourceExternalKey', max(c.expected_source_external_key)
  )
  into v_candidate
  from public.ecoflow_commercial_wave2_candidates c
  where c.external_product_code = '140010';

  select pg_catalog.jsonb_build_object(
    'commandCount', (select count(*) from public.ecoflow_commercial_wave2_promotion_commands),
    'promotionCount', (select count(*) from public.ecoflow_commercial_wave2_promotions),
    'exactCommandCount', count(*),
    'commandId', max(c.command_id::text),
    'commandPayloadSha256', max(c.command_payload_sha256),
    'initialReplayed', coalesce(bool_and((c.result ->> 'replayed')::boolean), true),
    'commandExternalProductCode', max(c.external_product_code),
    'commandSourceMappingId', max(c.unleashed_mapping_id::text),
    'commandExpectedMappingRevision', max(c.expected_mapping_revision),
    'commandExpectedSourcePayloadSha256', max(c.expected_source_payload_sha256),
    'exactPromotionCount', (
      select count(*)
      from public.ecoflow_commercial_wave2_promotions p
      where p.authorization_command_id = '7900f15b-bdae-444f-b22c-04000730e260'::uuid
        and p.external_product_code = '140010'
    ),
    'authorizationCommandId', (
      select max(p.authorization_command_id::text)
      from public.ecoflow_commercial_wave2_promotions p
      where p.external_product_code = '140010'
    ),
    'promotionExternalProductCode', (
      select max(p.external_product_code)
      from public.ecoflow_commercial_wave2_promotions p
      where p.external_product_code = '140010'
    ),
    'commercialSkuId', (
      select max(p.commercial_sku_id::text)
      from public.ecoflow_commercial_wave2_promotions p
      where p.external_product_code = '140010'
    ),
    'externalMappingId', (
      select max(p.external_mapping_id::text)
      from public.ecoflow_commercial_wave2_promotions p
      where p.external_product_code = '140010'
    ),
    'sourceMappingId', (
      select max(p.unleashed_mapping_id::text)
      from public.ecoflow_commercial_wave2_promotions p
      where p.external_product_code = '140010'
    ),
    'sourcePayloadSha256', (
      select max(p.source_payload_sha256)
      from public.ecoflow_commercial_wave2_promotions p
      where p.external_product_code = '140010'
    ),
    'promotedAt', (
      select pg_catalog.to_jsonb(max(p.promoted_at))
      from public.ecoflow_commercial_wave2_promotions p
      where p.external_product_code = '140010'
    )
  )
  into v_lineage
  from public.ecoflow_commercial_wave2_promotion_commands c
  where c.command_id = '7900f15b-bdae-444f-b22c-04000730e260'::uuid;

  select pg_catalog.jsonb_build_object(
    'count', count(*),
    'id', max(a.id::text),
    'event', max(a.action),
    'actorRole', max(a.actor_role),
    'targetType', max(a.target_type),
    'targetId', max(a.target_id),
    'commandId', (
      select max(p.authorization_command_id::text)
      from public.ecoflow_commercial_wave2_promotions p
      where p.external_product_code = '140010'
    ),
    'commercialSkuId', max(a.after_data ->> 'commercialSkuId'),
    'externalMappingId', max(a.after_data ->> 'externalMappingId'),
    'replayed', coalesce(bool_and((a.after_data ->> 'replayed')::boolean), true)
  )
  into v_audit
  from public.app_security_audit_events a
  where a.id = '03dbe0fc-7188-4e70-a1fd-a33fb5524ba8'::uuid
    and a.action = 'COMMERCIAL_WAVE2_SKU_PROMOTED';

  select pg_catalog.jsonb_build_object(
    'candidateCount', (select count(*) from public.ecoflow_commercial_wave2_candidates),
    'expansionCandidateCount', (
      select count(*) from public.ecoflow_commercial_wave2_candidates where promotion_phase = 'EXPANSION'
    ),
    'planCommands', (select count(*) from public.ecoflow_commercial_wave2_plan_commands),
    'canaryUnlocks', (
      select count(*) from public.ecoflow_commercial_wave2_phase_unlocks where promotion_phase = 'CANARY'
    ),
    'unlockCommands', (select count(*) from public.ecoflow_commercial_wave2_unlock_commands),
    'enabledCandidates', (
      select count(*) from public.ecoflow_commercial_wave2_candidates where enabled
    ),
    'enabledCodes', coalesce((
      select pg_catalog.jsonb_agg(c.external_product_code order by c.external_product_code collate "C")
      from public.ecoflow_commercial_wave2_candidates c where c.enabled
    ), '[]'::jsonb),
    'p4EnabledCandidates', (
      select count(*) from public.ecoflow_commercial_wave2_candidates
      where promotion_phase = 'EXPANSION' and enabled
    ),
    'nonCanaryPromotions', (
      select count(*) from public.ecoflow_commercial_wave2_promotions where external_product_code <> '140010'
    ),
    'secondPromotionCount', greatest(
      (select count(*) from public.ecoflow_commercial_wave2_promotions) - 1,
      0::bigint
    )
  )
  into v_negative_space;

  select pg_catalog.jsonb_build_object(
    'commercialSkus', (select count(*) from public.skus),
    'skuFamilies', (select count(*) from public.ecoflow_sku_families),
    'physicalSkus', (select count(*) from public.ecoflow_physical_skus),
    'packages', (select count(*) from public.ecoflow_physical_sku_packages),
    'barcodeBindings', (select count(*) from public.ecoflow_physical_barcode_bindings),
    'commercialFamilyLinks', (select count(*) from public.ecoflow_commercial_family_links),
    'inventoryMovements', (select count(*) from public.ecoflow_inventory_movements),
    'warehouseMovements', (select count(*) from public.ecoflow_warehouse_movements),
    'locationItems', (select count(*) from public.ecoflow_warehouse_location_items),
    'stockMovements', (select count(*) from public.stock_movements),
    'locationQuantity', coalesce((select sum(i.quantity) from public.ecoflow_warehouse_location_items i), 0),
    'inventoryBalanceRows', (select count(*) from public.inventory_balances),
    'inventoryQoh', coalesce((select sum(i.quantity_on_hand) from public.inventory_balances i), 0),
    'imageAssets', (select count(*) from public.ecoflow_unleashed_product_assets),
    'imageCopyRuns', (select count(*) from public.ecoflow_unleashed_asset_copy_runs)
  )
  into v_current;

  select pg_catalog.jsonb_build_object(
    'skuFamilies', (select count(*) from public.ecoflow_sku_families where created_at >= '2026-09-13T11:35:14.960842Z'::timestamptz or updated_at > '2026-09-13T11:35:14.960842Z'::timestamptz or retired_at >= '2026-09-13T11:35:14.960842Z'::timestamptz),
    'physicalSkus', (select count(*) from public.ecoflow_physical_skus where created_at >= '2026-09-13T11:35:14.960842Z'::timestamptz or updated_at > '2026-09-13T11:35:14.960842Z'::timestamptz or retired_at >= '2026-09-13T11:35:14.960842Z'::timestamptz),
    'packages', (select count(*) from public.ecoflow_physical_sku_packages where created_at >= '2026-09-13T11:35:14.960842Z'::timestamptz or retired_at >= '2026-09-13T11:35:14.960842Z'::timestamptz),
    'barcodeBindings', (select count(*) from public.ecoflow_physical_barcode_bindings where created_at >= '2026-09-13T11:35:14.960842Z'::timestamptz or retired_at >= '2026-09-13T11:35:14.960842Z'::timestamptz),
    'commercialFamilyLinks', (select count(*) from public.ecoflow_commercial_family_links where created_at >= '2026-09-13T11:35:14.960842Z'::timestamptz or retired_at >= '2026-09-13T11:35:14.960842Z'::timestamptz),
    'inventoryMovements', (select count(*) from public.ecoflow_inventory_movements where moved_at > '2026-09-13T11:35:14.960842Z'::timestamptz),
    'warehouseMovements', (select count(*) from public.ecoflow_warehouse_movements where created_at > '2026-09-13T11:35:14.960842Z'::timestamptz),
    'locationItems', (select count(*) from public.ecoflow_warehouse_location_items where created_at >= '2026-09-13T11:35:14.960842Z'::timestamptz or updated_at > '2026-09-13T11:35:14.960842Z'::timestamptz),
    'stockMovements', (select count(*) from public.stock_movements where created_at >= '2026-09-13T11:35:14.960842Z'::timestamptz or updated_at > '2026-09-13T11:35:14.960842Z'::timestamptz),
    'inventoryBalances', (select count(*) from public.inventory_balances where created_at >= '2026-09-13T11:35:14.960842Z'::timestamptz or updated_at > '2026-09-13T11:35:14.960842Z'::timestamptz),
    'imageAssets', (select count(*) from public.ecoflow_unleashed_product_assets where created_at >= '2026-09-13T11:35:14.960842Z'::timestamptz or updated_at > '2026-09-13T11:35:14.960842Z'::timestamptz or copied_at >= '2026-09-13T11:35:14.960842Z'::timestamptz),
    'imageCopyRuns', (select count(*) from public.ecoflow_unleashed_asset_copy_runs where started_at > '2026-09-13T11:35:14.960842Z'::timestamptz or completed_at > '2026-09-13T11:35:14.960842Z'::timestamptz),
    'inventoryReferenceCommands', (select count(*) from public.ecoflow_unleashed_inventory_reference_commands where created_at > '2026-09-13T11:35:14.960842Z'::timestamptz),
    'inventoryReferenceBatches', (select count(*) from public.ecoflow_unleashed_inventory_reference_batches where created_at >= '2026-09-13T11:35:14.960842Z'::timestamptz or updated_at > '2026-09-13T11:35:14.960842Z'::timestamptz),
    'inventoryReferenceRows', (select count(*) from public.ecoflow_unleashed_inventory_reference_rows where created_at > '2026-09-13T11:35:14.960842Z'::timestamptz),
    'ordermentumApiJobs', (select count(*) from public.ordermentum_api_jobs where created_at >= '2026-09-13T11:35:14.960842Z'::timestamptz or updated_at > '2026-09-13T11:35:14.960842Z'::timestamptz),
    'ordermentumMasterSyncRuns', (select count(*) from public.ordermentum_master_sync_runs where started_at > '2026-09-13T11:35:14.960842Z'::timestamptz or finished_at > '2026-09-13T11:35:14.960842Z'::timestamptz),
    'ordermentumSyncBatches', (select count(*) from public.ordermentum_sync_batches where created_at > '2026-09-13T11:35:14.960842Z'::timestamptz),
    'unleashedSyncRuns', (select count(*) from public.unleashed_sync_runs where created_at >= '2026-09-13T11:35:14.960842Z'::timestamptz or updated_at > '2026-09-13T11:35:14.960842Z'::timestamptz),
    'unleashedSyncBatches', (select count(*) from public.unleashed_sync_batches where created_at >= '2026-09-13T11:35:14.960842Z'::timestamptz or updated_at > '2026-09-13T11:35:14.960842Z'::timestamptz),
    'ordermentumCapabilities', (select count(*) from public.ordermentum_api_capabilities where last_checked_at > '2026-09-13T11:35:14.960842Z'::timestamptz),
    'callerSwitchAudits', (select count(*) from public.app_security_audit_events where created_at > '2026-09-13T11:35:14.960842Z'::timestamptz and action ilike '%CALLER%'),
    'legacyRetirementAudits', (select count(*) from public.app_security_audit_events where created_at > '2026-09-13T11:35:14.960842Z'::timestamptz and action ilike '%RETIRE%'),
    'cutoverAudits', (select count(*) from public.app_security_audit_events where created_at > '2026-09-13T11:35:14.960842Z'::timestamptz and action ilike '%CUTOVER%')
  )
  into v_strict_since_p2b;

  select
    count(*),
    count(*) filter (
      where r.id = '0bc9be6e-bc67-4e20-8e5c-c843451eb326'::uuid
        and r.status = 'SUCCEEDED'
        and r.auth_mode = 'legacy-bearer'
        and r.orders_seen = 8
        and r.orders_upserted = 8
        and r.orders_changed = 8
        and r.detail_fetch_attempted = 8
        and r.detail_fetch_succeeded = 8
        and r.detail_fetch_failed = 0
    ),
    count(*) filter (where r.id <> '0bc9be6e-bc67-4e20-8e5c-c843451eb326'::uuid)
  into v_provider_runs, v_allowed_provider_runs, v_unattributed_provider_runs
  from public.ordermentum_sync_runs_v2 r
  where r.created_at >= '2026-09-13T11:35:14.960842Z'::timestamptz
     or r.updated_at > '2026-09-13T11:35:14.960842Z'::timestamptz;

  select
    count(*),
    count(*) filter (where e.run_id is distinct from '0bc9be6e-bc67-4e20-8e5c-c843451eb326'::uuid)
  into v_provider_events, v_unattributed_provider_events
  from public.ordermentum_raw_api_events_v2 e
  where e.created_at > '2026-09-13T11:35:14.960842Z'::timestamptz;

  select count(*)
  into v_provider_sync_state
  from public.ordermentum_api_sync_state s
  where s.updated_at > '2026-09-13T11:35:14.960842Z'::timestamptz;

  v_provider_status := case
    when v_provider_runs = 0 and v_provider_events = 0 and v_provider_sync_state = 0
      then 'NO_PROVIDER_ACTIVITY'
    when v_provider_runs = 1
      and v_allowed_provider_runs = 1
      and v_unattributed_provider_runs = 0
      and v_provider_events = 8
      and v_unattributed_provider_events = 0
      and v_provider_sync_state = 1
      then 'ATTRIBUTED_INCUMBENT_LEGACY_SYNC'
    else 'UNATTRIBUTED_PROVIDER_ACTIVITY'
  end;

  v_provider := pg_catalog.jsonb_build_object(
    'status', v_provider_status,
    'p3aEmittedProviderTraffic', 0,
    'allowedWorkflow', 'ordermentum-cloud-sync.yml',
    'allowedWorkflowRunId', '34767646363',
    'allowedOperationalRunId', '0bc9be6e-bc67-4e20-8e5c-c843451eb326',
    'authMode', 'legacy-bearer',
    'syncRuns', v_provider_runs,
    'rawApiEvents', v_provider_events,
    'syncStateRows', v_provider_sync_state,
    'unattributedSyncRuns', v_unattributed_provider_runs,
    'unattributedRawApiEvents', v_unattributed_provider_events,
    'currentApiShadowExecuted', v_unattributed_provider_runs <> 0
      or (v_strict_since_p2b ->> 'ordermentumMasterSyncRuns')::bigint <> 0,
    'legacyRetired', (v_strict_since_p2b ->> 'legacyRetirementAudits')::bigint <> 0
  );

  if (v_identity ->> 'count')::bigint <> 1 then v_failures := array_append(v_failures, 'identity.count'); end if;
  if v_identity ->> 'id' <> '4710bb98-2706-42e5-866b-8788e36e1acc' then v_failures := array_append(v_failures, 'identity.id'); end if;
  if v_identity ->> 'code' <> '140010' then v_failures := array_append(v_failures, 'identity.code'); end if;
  if v_identity ->> 'setupStatus' <> 'mapping_draft' then v_failures := array_append(v_failures, 'identity.setupStatus'); end if;

  if (v_mapping ->> 'count')::bigint <> 1 then v_failures := array_append(v_failures, 'mapping.count'); end if;
  if v_mapping ->> 'id' <> '1995b15c-7ee7-466b-ba3e-daba596d71a3' then v_failures := array_append(v_failures, 'mapping.id'); end if;
  if v_mapping ->> 'provider' <> 'ORDERMENTUM' then v_failures := array_append(v_failures, 'mapping.provider'); end if;
  if v_mapping ->> 'internalSkuId' <> '4710bb98-2706-42e5-866b-8788e36e1acc' then v_failures := array_append(v_failures, 'mapping.internalSkuId'); end if;
  if not coalesce((v_mapping ->> 'isActive')::boolean, false) then v_failures := array_append(v_failures, 'mapping.isActive'); end if;

  if (v_provenance ->> 'count')::bigint <> 1 then v_failures := array_append(v_failures, 'provenance.count'); end if;
  if v_provenance ->> 'id' <> '3001d0f1-6c1b-4b15-98a0-91443ca6b525' then v_failures := array_append(v_failures, 'provenance.id'); end if;
  if (v_provenance ->> 'revision')::bigint <> 0 then v_failures := array_append(v_failures, 'provenance.revision'); end if;
  if v_provenance ->> 'sourcePayloadSha256' <> '016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8' then v_failures := array_append(v_failures, 'provenance.sourcePayloadSha256'); end if;
  if v_provenance ->> 'sourceExternalKey' <> 'guid:e80b9e1d-f33d-4ebf-b76d-dfdd9beb1a7b' then v_failures := array_append(v_failures, 'provenance.sourceExternalKey'); end if;
  if pg_catalog.upper(pg_catalog.btrim(coalesce(v_provenance ->> 'sourceExternalCode', ''))) <> '140010' then v_failures := array_append(v_failures, 'provenance.sourceExternalCode'); end if;
  if (v_provenance ->> 'sourceDuplicateCount')::bigint <> 1 then v_failures := array_append(v_failures, 'provenance.sourceDuplicateCount'); end if;

  if (v_candidate ->> 'count')::bigint <> 1 then v_failures := array_append(v_failures, 'candidate.count'); end if;
  if v_candidate ->> 'externalProductCode' <> '140010' then v_failures := array_append(v_failures, 'candidate.externalProductCode'); end if;
  if v_candidate ->> 'promotionPhase' <> 'CANARY' then v_failures := array_append(v_failures, 'candidate.promotionPhase'); end if;
  if not coalesce((v_candidate ->> 'enabled')::boolean, false) then v_failures := array_append(v_failures, 'candidate.enabled'); end if;
  if v_candidate ->> 'candidateSetSha256' <> '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a' then v_failures := array_append(v_failures, 'candidate.candidateSetSha256'); end if;
  if v_candidate ->> 'sourceMappingId' <> '3001d0f1-6c1b-4b15-98a0-91443ca6b525' then v_failures := array_append(v_failures, 'candidate.sourceMappingId'); end if;
  if (v_candidate ->> 'expectedMappingRevision')::bigint <> 0 then v_failures := array_append(v_failures, 'candidate.expectedMappingRevision'); end if;
  if v_candidate ->> 'expectedSourcePayloadSha256' <> '016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8' then v_failures := array_append(v_failures, 'candidate.expectedSourcePayloadSha256'); end if;
  if v_candidate ->> 'expectedSourceExternalKey' <> 'guid:e80b9e1d-f33d-4ebf-b76d-dfdd9beb1a7b' then v_failures := array_append(v_failures, 'candidate.expectedSourceExternalKey'); end if;

  if (v_lineage ->> 'commandCount')::bigint <> 1 then v_failures := array_append(v_failures, 'lineage.commandCount'); end if;
  if (v_lineage ->> 'promotionCount')::bigint <> 1 then v_failures := array_append(v_failures, 'lineage.promotionCount'); end if;
  if (v_lineage ->> 'exactCommandCount')::bigint <> 1 then v_failures := array_append(v_failures, 'lineage.exactCommandCount'); end if;
  if (v_lineage ->> 'exactPromotionCount')::bigint <> 1 then v_failures := array_append(v_failures, 'lineage.exactPromotionCount'); end if;
  if v_lineage ->> 'commandId' <> '7900f15b-bdae-444f-b22c-04000730e260' then v_failures := array_append(v_failures, 'lineage.commandId'); end if;
  if v_lineage ->> 'commandPayloadSha256' <> '0fca9742c34f623ae6dbf1614d5966513fdfa7d5167c7caf4c2a798e956599ef' then v_failures := array_append(v_failures, 'lineage.commandPayloadSha256'); end if;
  if coalesce((v_lineage ->> 'initialReplayed')::boolean, true) then v_failures := array_append(v_failures, 'lineage.initialReplayed'); end if;
  if v_lineage ->> 'authorizationCommandId' <> '7900f15b-bdae-444f-b22c-04000730e260' then v_failures := array_append(v_failures, 'lineage.authorizationCommandId'); end if;
  if v_lineage ->> 'commercialSkuId' <> '4710bb98-2706-42e5-866b-8788e36e1acc' then v_failures := array_append(v_failures, 'lineage.commercialSkuId'); end if;
  if v_lineage ->> 'externalMappingId' <> '1995b15c-7ee7-466b-ba3e-daba596d71a3' then v_failures := array_append(v_failures, 'lineage.externalMappingId'); end if;
  if v_lineage ->> 'sourceMappingId' <> '3001d0f1-6c1b-4b15-98a0-91443ca6b525' then v_failures := array_append(v_failures, 'lineage.sourceMappingId'); end if;
  if v_lineage ->> 'sourcePayloadSha256' <> '016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8' then v_failures := array_append(v_failures, 'lineage.sourcePayloadSha256'); end if;
  if (v_lineage ->> 'promotedAt')::timestamptz is distinct from '2026-09-13T11:35:14.960842Z'::timestamptz then v_failures := array_append(v_failures, 'lineage.promotedAt'); end if;

  if (v_audit ->> 'count')::bigint <> 1 then v_failures := array_append(v_failures, 'audit.count'); end if;
  if v_audit ->> 'id' <> '03dbe0fc-7188-4e70-a1fd-a33fb5524ba8' then v_failures := array_append(v_failures, 'audit.id'); end if;
  if v_audit ->> 'event' <> 'COMMERCIAL_WAVE2_SKU_PROMOTED' then v_failures := array_append(v_failures, 'audit.event'); end if;
  if v_audit ->> 'actorRole' <> 'ADMIN' then v_failures := array_append(v_failures, 'audit.actorRole'); end if;
  if v_audit ->> 'targetType' <> 'external_product_mappings' then v_failures := array_append(v_failures, 'audit.targetType'); end if;
  if v_audit ->> 'targetId' <> '1995b15c-7ee7-466b-ba3e-daba596d71a3' then v_failures := array_append(v_failures, 'audit.targetId'); end if;
  if v_audit ->> 'commercialSkuId' <> '4710bb98-2706-42e5-866b-8788e36e1acc' then v_failures := array_append(v_failures, 'audit.commercialSkuId'); end if;
  if v_audit ->> 'externalMappingId' <> '1995b15c-7ee7-466b-ba3e-daba596d71a3' then v_failures := array_append(v_failures, 'audit.externalMappingId'); end if;
  if coalesce((v_audit ->> 'replayed')::boolean, true) then v_failures := array_append(v_failures, 'audit.replayed'); end if;

  if (v_negative_space ->> 'candidateCount')::bigint <> 164 then v_failures := array_append(v_failures, 'negativeSpace.candidateCount'); end if;
  if (v_negative_space ->> 'expansionCandidateCount')::bigint <> 163 then v_failures := array_append(v_failures, 'negativeSpace.expansionCandidateCount'); end if;
  if (v_negative_space ->> 'planCommands')::bigint <> 1 then v_failures := array_append(v_failures, 'negativeSpace.planCommands'); end if;
  if (v_negative_space ->> 'canaryUnlocks')::bigint <> 1 then v_failures := array_append(v_failures, 'negativeSpace.canaryUnlocks'); end if;
  if (v_negative_space ->> 'unlockCommands')::bigint <> 1 then v_failures := array_append(v_failures, 'negativeSpace.unlockCommands'); end if;
  if (v_negative_space ->> 'enabledCandidates')::bigint <> 1 then v_failures := array_append(v_failures, 'negativeSpace.enabledCandidates'); end if;
  if v_negative_space -> 'enabledCodes' <> '["140010"]'::jsonb then v_failures := array_append(v_failures, 'negativeSpace.enabledCodes'); end if;
  if (v_negative_space ->> 'p4EnabledCandidates')::bigint <> 0 then v_failures := array_append(v_failures, 'negativeSpace.p4EnabledCandidates'); end if;
  if (v_negative_space ->> 'nonCanaryPromotions')::bigint <> 0 then v_failures := array_append(v_failures, 'negativeSpace.nonCanaryPromotions'); end if;
  if (v_negative_space ->> 'secondPromotionCount')::bigint <> 0 then v_failures := array_append(v_failures, 'negativeSpace.secondPromotionCount'); end if;

  if (v_current ->> 'commercialSkus')::bigint <> 192 then v_failures := array_append(v_failures, 'sentinels.current.commercialSkus'); end if;
  if (v_current ->> 'skuFamilies')::bigint <> 4 then v_failures := array_append(v_failures, 'sentinels.current.skuFamilies'); end if;
  if (v_current ->> 'physicalSkus')::bigint <> 4 then v_failures := array_append(v_failures, 'sentinels.current.physicalSkus'); end if;
  if (v_current ->> 'packages')::bigint <> 4 then v_failures := array_append(v_failures, 'sentinels.current.packages'); end if;
  if (v_current ->> 'barcodeBindings')::bigint <> 4 then v_failures := array_append(v_failures, 'sentinels.current.barcodeBindings'); end if;
  if (v_current ->> 'commercialFamilyLinks')::bigint <> 4 then v_failures := array_append(v_failures, 'sentinels.current.commercialFamilyLinks'); end if;
  if (v_current ->> 'inventoryMovements')::bigint <> 0 then v_failures := array_append(v_failures, 'sentinels.current.inventoryMovements'); end if;
  if (v_current ->> 'warehouseMovements')::bigint <> 0 then v_failures := array_append(v_failures, 'sentinels.current.warehouseMovements'); end if;
  if (v_current ->> 'locationItems')::bigint <> 0 then v_failures := array_append(v_failures, 'sentinels.current.locationItems'); end if;
  if (v_current ->> 'stockMovements')::bigint <> 0 then v_failures := array_append(v_failures, 'sentinels.current.stockMovements'); end if;
  if (v_current ->> 'locationQuantity')::numeric <> 0 then v_failures := array_append(v_failures, 'sentinels.current.locationQuantity'); end if;
  if (v_current ->> 'inventoryBalanceRows')::bigint <> 1 then v_failures := array_append(v_failures, 'sentinels.current.inventoryBalanceRows'); end if;
  if (v_current ->> 'inventoryQoh')::numeric <> 11 then v_failures := array_append(v_failures, 'sentinels.current.inventoryQoh'); end if;
  if (v_current ->> 'imageAssets')::bigint <> 467 then v_failures := array_append(v_failures, 'sentinels.current.imageAssets'); end if;
  if (v_current ->> 'imageCopyRuns')::bigint <> 45 then v_failures := array_append(v_failures, 'sentinels.current.imageCopyRuns'); end if;

  for v_key in select pg_catalog.jsonb_object_keys(v_strict_since_p2b)
  loop
    if (v_strict_since_p2b ->> v_key)::bigint <> 0 then
      v_failures := array_append(v_failures, 'sentinels.sinceP2B.' || v_key);
    end if;
  end loop;

  if v_provider_status = 'UNATTRIBUTED_PROVIDER_ACTIVITY' then
    v_failures := array_append(v_failures, 'provider.unattributedActivity');
  end if;

  v_p4_locked := (v_negative_space ->> 'p4EnabledCandidates')::bigint = 0
    and (v_negative_space ->> 'nonCanaryPromotions')::bigint = 0;

  return pg_catalog.jsonb_build_object(
    'mode', 'P3_VERIFY_READ_ONLY',
    'stage', 'P3_VERIFICATION_ONLY',
    'verdict', case when pg_catalog.cardinality(v_failures) = 0 and v_p4_locked then 'PASS' else 'HOLD' end,
    'verifiedAt', pg_catalog.statement_timestamp(),
    'verifierRole', v_actor_role,
    'identity', v_identity,
    'mapping', v_mapping,
    'provenance', v_provenance,
    'candidate', v_candidate,
    'lineage', v_lineage,
    'audit', v_audit,
    'negativeSpace', v_negative_space,
    'sentinels', pg_catalog.jsonb_build_object('current', v_current, 'sinceP2B', v_strict_since_p2b),
    'providerSentinel', v_provider,
    'noProductionBusinessMutation', true,
    'p4Locked', v_p4_locked,
    'failedChecks', pg_catalog.to_jsonb(v_failures)
  );
end;
$function$;

comment on function public.ecoflow_read_commercial_wave2_p3_verification() is
  'P3 verification-only: bounded frozen canary evidence for the authenticated ACTIVE OWNER/ADMIN caller; no DML, provider call, repair, replay, promotion, or P4 capability.';

-- Keep the private ledgers private. The function owner reads them only inside
-- the fixed frozen scope above; browser callers receive no direct table grant.
revoke all on table public.ecoflow_commercial_wave2_candidates
  from public, anon, authenticated;
revoke all on table public.ecoflow_commercial_wave2_promotions
  from public, anon, authenticated;
revoke all on table public.ecoflow_commercial_wave2_promotion_commands
  from public, anon, authenticated;

revoke all on function public.ecoflow_read_commercial_wave2_p3_verification()
  from public, anon, service_role;
grant execute on function public.ecoflow_read_commercial_wave2_p3_verification()
  to authenticated;

commit;
