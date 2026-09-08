\set ON_ERROR_STOP on

-- #338 Identity Unlock Batch 1B post-canary continuation contract.
-- Runs after the Batch 1B canary contract in the same PostgreSQL 17 service.
-- The canary is already exact MATCHED; build only the additional frozen 21-row
-- fixture needed to prove the continuation unlock and two exact Ordermentum
-- commercial-evidence paths. No Product Identity or inventory authority is added.

alter table public.ecoflow_physical_barcode_bindings
  add column if not exists identity_status text not null default 'ACTIVE';

create table if not exists public.ecoflow_barcode_survey_observations(
  id uuid primary key default extensions.gen_random_uuid(),
  sku_context text,
  carton_barcode text not null,
  sleeve_status text,
  sleeve_barcode text,
  evidence_source text,
  occurred_at timestamptz not null default now()
);

create table if not exists public.ecoflow_barcode_survey_identity_reconciliations(
  id uuid primary key default extensions.gen_random_uuid(),
  survey_observation_id uuid not null references public.ecoflow_barcode_survey_observations(id)
);

-- Production has one exact listed-SKU row for every frozen continuation code.
-- Two rows are currently not visible but have exact order-history evidence; keep
-- that shape here so both accepted commercial evidence paths are exercised.
create or replace view public.v_ecoflow_ordermentum_listed_skus as
select
  a.external_product_code::text as external_sku_code,
  (a.external_product_code || ' listed product')::text as listed_product_name,
  (a.external_product_code not in ('CCSKBM12-90','CCSKBM8-90'))::boolean as is_visible_on_ordermentum,
  now()::timestamptz as listed_updated_at
from public.ecoflow_bounded_commercial_sku_promotion_allowlist a
where a.promotion_phase='AFTER_CANARY';

create or replace view public.v_ecoflow_ordermentum_sku_mapping_workbench as
select * from (values
  ('CCSA8-90'::text,'(90mm) 8oz Art Series Single Wall - 1000pcs'::text,65::bigint,65::bigint),
  ('BPB8'::text,'8oz Kraft Soup Bowl'::text,5::bigint,5::bigint),
  ('CCSKBM12-90'::text,'12oz Black Matt Cup 90mm'::text,4::bigint,4::bigint),
  ('CCSKBM8-90'::text,'8oz Black Matt Cup 90mm'::text,3::bigint,3::bigint),
  ('CCSB6-80'::text,'(80mm) 6oz Compostable Black'::text,1::bigint,1::bigint)
) v(external_sku_code,external_product_name,line_count,order_count);

-- Materialize missing Unleashed identities/snapshots for every frozen
-- continuation code, then let the existing governed PLAN create the mappings.
do $$
declare
  r record;
  v_run uuid := '20000000-0000-4000-8000-000000000001';
  v_key text;
  v_payload jsonb;
begin
  for r in
    select external_product_code as code
    from public.ecoflow_bounded_commercial_sku_promotion_allowlist
    where promotion_phase='AFTER_CANARY'
    order by external_product_code
  loop
    if exists(
      select 1 from public.unleashed_external_identities i
      where i.resource='products' and upper(btrim(coalesce(i.external_code,'')))=r.code
    ) then
      continue;
    end if;

    v_key := 'continuation:' || r.code;
    v_payload := jsonb_build_object(
      'ProductCode',r.code,
      'ProductDescription','Continuation ' || r.code,
      'Obsolete',false
    );

    insert into public.unleashed_external_identities(
      resource,external_key,external_guid,external_code,last_seen_run_id
    ) values('products',v_key,null,r.code,v_run)
    on conflict(resource,external_key) do update set
      external_code=excluded.external_code,last_seen_run_id=excluded.last_seen_run_id;

    insert into public.unleashed_raw_snapshots(
      resource,external_key,payload,payload_sha256,last_seen_at
    ) values(
      'products',v_key,v_payload,encode(extensions.digest(v_payload::text,'sha256'),'hex'),now()
    ) on conflict(resource,external_key) do update set
      payload=excluded.payload,payload_sha256=excluded.payload_sha256,last_seen_at=excluded.last_seen_at;
  end loop;
end $$;

select public.ecoflow_plan_unleashed_master_mappings(
  '10000000-0000-4000-8000-000000000001','Batch 1B continuation baseline plan'
);

do $$
declare
  v_rows bigint;
  v_unmatched bigint;
begin
  select count(*),count(*) filter(where m.mapping_status='UNMATCHED')
  into v_rows,v_unmatched
  from public.ecoflow_bounded_commercial_sku_promotion_allowlist a
  join public.ecoflow_unleashed_master_mappings m
    on m.entity_type='PRODUCT' and upper(btrim(m.source_external_code))=a.external_product_code
  where a.promotion_phase='AFTER_CANARY';
  if v_rows<>21 or v_unmatched<>21 then
    raise exception 'continuation fixture mapping shape failed: %/%',v_rows,v_unmatched;
  end if;
end $$;

\ir ../supabase/migrations/20260908115000_identity_unlock_batch1_commercial_sku_continuation.sql
\ir ../supabase/migrations/20260908115000_identity_unlock_batch1_commercial_sku_continuation.sql

-- New authority remains server-command-only.
do $$
begin
  if has_function_privilege('authenticated','public.ecoflow_unlock_bounded_commercial_sku_after_canary(uuid,uuid,bigint,text,text)','EXECUTE')
     or has_function_privilege('authenticated','public.ecoflow_promote_bounded_commercial_sku_after_canary(uuid,uuid,text,uuid,bigint,text,text)','EXECUTE') then
    raise exception 'authenticated unexpectedly has continuation execute';
  end if;
  if not has_function_privilege('service_role','public.ecoflow_unlock_bounded_commercial_sku_after_canary(uuid,uuid,bigint,text,text)','EXECUTE')
     or not has_function_privilege('service_role','public.ecoflow_promote_bounded_commercial_sku_after_canary(uuid,uuid,text,uuid,bigint,text,text)','EXECUTE') then
    raise exception 'service_role missing continuation execute';
  end if;
  if has_table_privilege('service_role','public.ecoflow_bounded_commercial_sku_phase_unlocks','INSERT')
     or has_table_privilege('authenticated','public.ecoflow_bounded_commercial_sku_phase_unlock_commands','SELECT') then
    raise exception 'phase unlock evidence tables are directly accessible';
  end if;
end $$;

-- Continuation remains locked until the canary queue is objectively READY.
do $$
declare
  v_canary public.ecoflow_unleashed_master_mappings%rowtype;
  v_failed boolean := false;
begin
  select * into v_canary
  from public.ecoflow_unleashed_master_mappings
  where entity_type='PRODUCT' and source_external_code='CCSA8-90';

  begin
    perform public.ecoflow_unlock_bounded_commercial_sku_after_canary(
      '93000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      v_canary.revision,v_canary.source_payload_sha256,'Queue proof required before continuation'
    );
  exception when others then
    if position('COMMERCIAL_CONTINUATION_CANARY_QUEUE_NOT_READY' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'continuation unlocked without canary READY evidence'; end if;
end $$;

-- Viewer/unknown actor and stale canary binding fail closed.
do $$
declare
  v_canary public.ecoflow_unleashed_master_mappings%rowtype;
  v_failed boolean;
begin
  select * into v_canary from public.ecoflow_unleashed_master_mappings where source_external_code='CCSA8-90';

  v_failed:=false;
  begin
    perform public.ecoflow_unlock_bounded_commercial_sku_after_canary(
      '93000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',
      v_canary.revision,v_canary.source_payload_sha256,'Viewer rejected'
    );
  exception when others then
    if position('COMMERCIAL_CONTINUATION_UNLOCK_FORBIDDEN' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'viewer unlock did not fail'; end if;

  v_failed:=false;
  begin
    perform public.ecoflow_unlock_bounded_commercial_sku_after_canary(
      '93000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001',
      v_canary.revision+1,v_canary.source_payload_sha256,'Stale revision rejected'
    );
  exception when others then
    if position('COMMERCIAL_CONTINUATION_CANARY_EXACT_MATCH_NOT_PROVEN' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'stale canary revision did not fail'; end if;
end $$;

-- Add one direct physical canary observation that satisfies the existing queue
-- READY predicate. This is evidence only; no Product Identity draft is created.
insert into public.ecoflow_barcode_survey_observations(
  id,sku_context,carton_barcode,sleeve_status,sleeve_barcode,evidence_source,occurred_at
) values(
  '94000000-0000-4000-8000-000000000001','CCSA8-90','TEST-CANARY-CARTON',
  'NO_SEPARATE_BARCODE',null,'OBSERVED_NOW',now()
) on conflict(id) do nothing;

-- Unlock exactly the frozen 21 and prove idempotent replay.
do $$
declare
  v_canary public.ecoflow_unleashed_master_mappings%rowtype;
  v_result jsonb;
  v_replay jsonb;
  v_enabled bigint;
  v_unlocks bigint;
  v_audit bigint;
begin
  select * into v_canary from public.ecoflow_unleashed_master_mappings where source_external_code='CCSA8-90';

  v_result := public.ecoflow_unlock_bounded_commercial_sku_after_canary(
    '93000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001',
    v_canary.revision,v_canary.source_payload_sha256,'Canary passed exact MATCHED and READY; unlock frozen continuation'
  );
  v_replay := public.ecoflow_unlock_bounded_commercial_sku_after_canary(
    '93000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001',
    v_canary.revision,v_canary.source_payload_sha256,'Canary passed exact MATCHED and READY; unlock frozen continuation'
  );

  select count(*) into v_enabled
  from public.ecoflow_bounded_commercial_sku_promotion_allowlist
  where promotion_phase='AFTER_CANARY' and enabled;
  select count(*) into v_unlocks from public.ecoflow_bounded_commercial_sku_phase_unlocks;
  select count(*) into v_audit from public.app_security_audit_events
  where action='BOUNDED_COMMERCIAL_SKU_AFTER_CANARY_UNLOCKED';

  if v_result is distinct from v_replay
     or v_result->>'canaryQueueStatus'<>'READY_TO_RECONCILE'
     or (v_result->>'unlockedCandidateCount')::bigint<>21
     or v_enabled<>21 or v_unlocks<>1 or v_audit<>1
     or exists(select 1 from public.ecoflow_bounded_commercial_sku_promotion_allowlist where external_product_code='CCSB6-80') then
    raise exception 'continuation unlock contract failed: %/%/%/%',v_result,v_enabled,v_unlocks,v_audit;
  end if;
end $$;

-- Changed unlock replay payload is rejected.
do $$
declare
  v_canary public.ecoflow_unleashed_master_mappings%rowtype;
  v_failed boolean := false;
begin
  select * into v_canary from public.ecoflow_unleashed_master_mappings where source_external_code='CCSA8-90';
  begin
    perform public.ecoflow_unlock_bounded_commercial_sku_after_canary(
      '93000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001',
      v_canary.revision,v_canary.source_payload_sha256,'Changed unlock replay payload'
    );
  exception when others then
    if position('COMMAND_REPLAY_PAYLOAD_MISMATCH' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'changed unlock replay did not fail'; end if;
end $$;

-- The continuation RPC cannot be used for the canary, conflict, or an unlisted code.
do $$
declare
  v_canary public.ecoflow_unleashed_master_mappings%rowtype;
  v_conflict public.ecoflow_unleashed_master_mappings%rowtype;
  v_failed boolean;
begin
  select * into v_canary from public.ecoflow_unleashed_master_mappings where source_external_code='CCSA8-90';
  select * into v_conflict from public.ecoflow_unleashed_master_mappings where source_external_code='CCSB6-80';

  v_failed:=false;
  begin
    perform public.ecoflow_promote_bounded_commercial_sku_after_canary(
      '95000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
      'CCSA8-90',v_canary.id,v_canary.revision,v_canary.source_payload_sha256,'Canary cannot use continuation RPC'
    );
  exception when others then
    if position('COMMERCIAL_PROMOTION_CONTINUATION_ONLY' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'canary entered continuation RPC'; end if;

  v_failed:=false;
  begin
    perform public.ecoflow_promote_bounded_commercial_sku_after_canary(
      '95000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',
      'CCSB6-80',v_conflict.id,v_conflict.revision,v_conflict.source_payload_sha256,'Conflict remains blocked'
    );
  exception when others then
    if position('COMMERCIAL_PROMOTION_CONFLICT_BLOCKED' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'conflict entered continuation'; end if;
end $$;

-- Promote one currently visible listed SKU and one listing-hidden SKU backed by
-- exact order history. Neither path may create package/physical/inventory authority.
do $$
declare
  v_code text;
  v_mapping public.ecoflow_unleashed_master_mappings%rowtype;
  v_result jsonb;
  v_sku public.skus%rowtype;
  v_external public.external_product_mappings%rowtype;
  v_units bigint;
  v_physical bigint;
  v_barcodes bigint;
  v_inventory bigint;
begin
  foreach v_code in array array['BPB8','CCSKBM12-90'] loop
    select * into v_mapping
    from public.ecoflow_unleashed_master_mappings
    where entity_type='PRODUCT' and source_external_code=v_code;

    v_result := public.ecoflow_promote_bounded_commercial_sku_after_canary(
      case v_code
        when 'BPB8' then '95000000-0000-4000-8000-000000000003'::uuid
        else '95000000-0000-4000-8000-000000000004'::uuid
      end,
      '10000000-0000-4000-8000-000000000001',v_code,
      v_mapping.id,v_mapping.revision,v_mapping.source_payload_sha256,
      'Batch 1B continuation Commercial identity only'
    );

    select * into v_sku from public.skus where sku_code=v_code;
    select * into v_external from public.external_product_mappings
      where provider='ORDERMENTUM' and external_product_code=v_code;
    select count(*) into v_units from public.sku_units where sku_id=v_sku.id;
    select count(*) into v_physical from public.ecoflow_physical_skus where commercial_sku_id=v_sku.id;
    select count(*) into v_barcodes from public.ecoflow_physical_barcode_bindings;
    select count(*) into v_inventory from public.ecoflow_inventory_test_sentinel;

    if v_sku.id is null or v_external.id is null
       or v_sku.can_sell_by_carton or v_sku.can_sell_by_sleeve or v_sku.can_mix_pack
       or v_sku.default_storage_unit<>'unconfigured' or v_sku.default_pick_unit<>'unconfigured'
       or v_sku.setup_status<>'mapping_draft'
       or v_external.default_unit_level<>'unconfigured'
       or v_external.confidence<>'BOUNDED_COMMERCIAL_PROMOTION'
       or not v_external.is_active
       or v_units<>0 or v_physical<>0 or v_barcodes<>0 or v_inventory<>0 then
      raise exception 'continuation commercial-only boundary failed for %: %/%/%/%/%/%',
        v_code,v_sku,v_external,v_units,v_physical,v_barcodes,v_inventory;
    end if;

    if v_code='BPB8' and v_result->>'ordermentumCommercialEvidence'<>'ORDERMENTUM_LISTED_SKU_EXACT' then
      raise exception 'listed-SKU evidence path not recorded: %',v_result;
    end if;
    if v_code='CCSKBM12-90' and v_result->>'ordermentumCommercialEvidence'<>'ORDERMENTUM_ORDER_HISTORY_EXACT' then
      raise exception 'order-history evidence path not recorded: %',v_result;
    end if;
  end loop;
end $$;

-- Governed PLAN must exact-match both promoted continuation rows while preserving
-- the canary and leaving all other continuation rows unpromoted in this test.
select public.ecoflow_plan_unleashed_master_mappings(
  '10000000-0000-4000-8000-000000000001','Batch 1B continuation exact-code plan'
);

do $$
declare
  v_code text;
  v_mapping public.ecoflow_unleashed_master_mappings%rowtype;
  v_sku uuid;
  v_current bigint;
  v_promoted bigint;
  v_audit bigint;
begin
  foreach v_code in array array['CCSA8-90','BPB8','CCSKBM12-90'] loop
    select * into v_mapping from public.ecoflow_unleashed_master_mappings
      where entity_type='PRODUCT' and source_external_code=v_code;
    select id into v_sku from public.skus where sku_code=v_code;
    select count(*) into v_current from public.ecoflow_unleashed_master_candidates c
      where c.mapping_id=v_mapping.id and c.is_current
        and c.match_method='ORDERMENTUM_PRODUCT_CODE_EXACT'
        and c.canonical_object_id=v_sku;
    if v_mapping.mapping_status<>'MATCHED'
       or v_mapping.match_method<>'ORDERMENTUM_PRODUCT_CODE_EXACT'
       or v_mapping.canonical_object_type<>'COMMERCIAL_SKU'
       or v_mapping.canonical_object_id<>v_sku
       or v_mapping.canonical_code<>v_code
       or v_mapping.candidate_count<>1 or v_current<>1 then
      raise exception 'continuation exact PLAN failed for %: %/%',v_code,v_mapping,v_current;
    end if;
  end loop;

  select count(*) into v_promoted from public.ecoflow_bounded_commercial_sku_promotions
    where external_product_code in ('BPB8','CCSKBM12-90');
  select count(*) into v_audit from public.app_security_audit_events
    where action='BOUNDED_COMMERCIAL_SKU_CONTINUATION_PROMOTED';
  if v_promoted<>2 or v_audit<>2 then
    raise exception 'continuation provenance/audit mismatch: %/%',v_promoted,v_audit;
  end if;

  if exists(select 1 from public.skus where sku_code='CCSB6-80')
     or exists(select 1 from public.external_product_mappings where provider='ORDERMENTUM' and external_product_code='CCSB6-80') then
    raise exception 'CCSB6-80 conflict was mutated';
  end if;
end $$;

select 'identity-unlock-batch1-b-continuation-db-contract-pass' as result;