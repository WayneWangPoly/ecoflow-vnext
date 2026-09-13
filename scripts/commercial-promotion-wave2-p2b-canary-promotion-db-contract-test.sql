\set ON_ERROR_STOP on

-- Reuse the complete P0/P1/P2A fixture and leave the database in the exact
-- post-P2A state: one PLAN, one CANARY unlock, one enabled canary, zero promotions.
\ir commercial-promotion-wave2-p2a-canary-unlock-db-contract-test.sql
\ir ../supabase/migrations/20260913065000_commercial_wave2_p2b_canary_promotion_carrier.sql

do $$
declare
  r jsonb;
  v_failed boolean:=false;
begin
  r:=public.ecoflow_read_commercial_wave2_canary_promotion_preflight(
    '10000000-0000-4000-8000-000000000001',
    '61b13a7c-18d1-48f0-b317-96d23607ddfb',
    '7900f15b-bdae-444f-b22c-04000730e260',
    '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
    '140010','3001d0f1-6c1b-4b15-98a0-91443ca6b525',0,
    '016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8',
    'guid:e80b9e1d-f33d-4ebf-b76d-dfdd9beb1a7b');

  if r->>'status'<>'READY'
     or not (r->>'ready')::boolean
     or r->>'stage'<>'P2B_SELECT_ONLY'
     or (r->>'candidateCount')::bigint<>164
     or (r->>'eligibleCandidateCount')::bigint<>163
     or (r->>'enabledCandidateCount')::bigint<>1
     or (r->>'phaseUnlockCount')::bigint<>1
     or (r->>'unlockCommandCount')::bigint<>1
     or (r->>'exactUnlockCommandCount')::bigint<>1
     or (r->>'unlockAuditCount')::bigint<>1
     or (r->>'promotionCount')::bigint<>0
     or (r->>'promotionCommandCount')::bigint<>0
     or (r->>'canarySkuCount')::bigint<>0
     or (r->>'canaryExternalMappingCount')::bigint<>0
     or r->>'promotionCommandId'<>'7900f15b-bdae-444f-b22c-04000730e260'
     or r->'canary'->>'externalProductCode'<>'140010'
     or not (r->'canary'->>'enabled')::boolean then
    raise exception 'post-P2A P2B preflight failed: %',r;
  end if;

  begin
    perform public.ecoflow_read_commercial_wave2_canary_promotion_preflight(
      '10000000-0000-4000-8000-000000000002',
      '61b13a7c-18d1-48f0-b317-96d23607ddfb','7900f15b-bdae-444f-b22c-04000730e260',
      '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
      '140010','3001d0f1-6c1b-4b15-98a0-91443ca6b525',0,
      '016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8',
      'guid:e80b9e1d-f33d-4ebf-b76d-dfdd9beb1a7b');
  exception when others then
    if position('COMMERCIAL_WAVE2_P2B_FORBIDDEN' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'VIEWER P2B preflight was not blocked'; end if;
end $$;

do $$
declare v_failed boolean:=false;
begin
  begin
    perform public.ecoflow_execute_commercial_wave2_canary_promotion(
      '7900f15b-bdae-444f-b22c-04000730e260','10000000-0000-4000-8000-000000000001',
      '140010','3001d0f1-6c1b-4b15-98a0-91443ca6b525',0,
      repeat('0',64),'79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
      'stale source must fail');
  exception when others then
    if position('COMMERCIAL_WAVE2_P2B_INVALID' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'stale source crossed P2B'; end if;

  if has_function_privilege('anon','public.ecoflow_execute_commercial_wave2_canary_promotion(uuid,uuid,text,uuid,bigint,text,text,text)','execute')
     or has_function_privilege('authenticated','public.ecoflow_execute_commercial_wave2_canary_promotion(uuid,uuid,text,uuid,bigint,text,text,text)','execute')
     or has_function_privilege('authenticated','public.ecoflow_read_commercial_wave2_canary_promotion_preflight(uuid,uuid,uuid,text,text,uuid,bigint,text,text)','execute')
     or not has_function_privilege('service_role','public.ecoflow_execute_commercial_wave2_canary_promotion(uuid,uuid,text,uuid,bigint,text,text,text)','execute') then
    raise exception 'P2B RPC grant boundary failed';
  end if;
end $$;

do $$
declare
  r jsonb;
  replay jsonb;
  v_failed boolean:=false;
begin
  r:=public.ecoflow_execute_commercial_wave2_canary_promotion(
    '7900f15b-bdae-444f-b22c-04000730e260','10000000-0000-4000-8000-000000000001',
    '140010','3001d0f1-6c1b-4b15-98a0-91443ca6b525',0,
    '016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8',
    '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
    '#338 Commercial Promotion Wave 2 P2B canary promotion for 140010 only; no Physical SKU, package, barcode, image or quantity authority.');

  if r->>'stage'<>'P2B_CANARY_PROMOTION'
     or r->>'status'<>'CANARY_PROMOTED'
     or (r->>'replayed')::boolean
     or r->>'commandId'<>'7900f15b-bdae-444f-b22c-04000730e260'
     or r->>'externalProductCode'<>'140010'
     or r->>'canaryExternalProductCode'<>'140010'
     or r->>'promotionPhase'<>'CANARY'
     or r->>'setupStatus'<>'mapping_draft'
     or (r->>'promotionCount')::bigint<>1
     or (r->>'promotionCommandCount')::bigint<>1
     or (r->>'enabledCandidateCount')::bigint<>1
     or (r->>'physicalAuthorityCreated')::boolean
     or (r->>'inventoryAuthorityCreated')::boolean
     or (r->>'imageActionIncluded')::boolean then
    raise exception 'P2B first execution failed: %',r;
  end if;

  replay:=public.ecoflow_execute_commercial_wave2_canary_promotion(
    '7900f15b-bdae-444f-b22c-04000730e260','10000000-0000-4000-8000-000000000001',
    '140010','3001d0f1-6c1b-4b15-98a0-91443ca6b525',0,
    '016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8',
    '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
    '#338 Commercial Promotion Wave 2 P2B canary promotion for 140010 only; no Physical SKU, package, barcode, image or quantity authority.');
  if not (replay->>'replayed')::boolean then raise exception 'same-command replay not reported'; end if;

  begin
    perform public.ecoflow_execute_commercial_wave2_canary_promotion(
      '7900f15b-bdae-444f-b22c-04000730e260','10000000-0000-4000-8000-000000000001',
      '140010','3001d0f1-6c1b-4b15-98a0-91443ca6b525',0,
      '016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8',
      '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
      'changed replay payload must fail');
  exception when others then
    if position('COMMAND_REPLAY_PAYLOAD_MISMATCH' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'changed replay payload was accepted'; end if;

  if (select count(*) from public.ecoflow_commercial_wave2_promotions)<>1
     or (select count(*) from public.ecoflow_commercial_wave2_promotion_commands)<>1
     or (select count(*) from public.skus where upper(btrim(sku_code))='140010')<>1
     or (select count(*) from public.external_product_mappings where provider='ORDERMENTUM' and upper(btrim(external_product_code))='140010')<>1
     or (select count(*) from public.ecoflow_physical_skus)<>0
     or (select count(*) from public.ecoflow_physical_sku_packages)<>0
     or (select count(*) from public.ecoflow_physical_barcode_bindings)<>0
     or (select count(*) from public.ecoflow_inventory_movements)<>0
     or (select count(*) from public.ecoflow_warehouse_movements)<>0
     or (select count(*) from public.ecoflow_warehouse_location_items)<>0
     or (select count(*) from public.stock_movements)<>0
     or (select count(*) from public.ecoflow_unleashed_product_assets)<>0
     or (select count(*) from public.ecoflow_unleashed_asset_copy_runs)<>0 then
    raise exception 'P2B separation or mutation sentinels failed';
  end if;

  if (select count(*) from public.app_security_audit_events where action='COMMERCIAL_WAVE2_SKU_PROMOTED')<>1 then
    raise exception 'P2B promotion audit missing';
  end if;
end $$;

select 'COMMERCIAL_PROMOTION_WAVE2_P2B_CANARY_PROMOTION_DB_CONTRACT_PASS' as result;
