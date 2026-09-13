\set ON_ERROR_STOP on

\ir commercial-promotion-wave2-plan-readiness-db-contract-test.sql
\ir ../supabase/migrations/20260913010000_commercial_wave2_p2a_canary_unlock_carrier.sql

create extension if not exists dblink;

create table public.ecoflow_product_identity_batches(id uuid primary key);
create table public.ecoflow_product_identity_tasks(id uuid primary key);
create table public.ecoflow_sku_families(id uuid primary key);
create table public.ecoflow_commercial_family_links(id uuid primary key);
create table public.ecoflow_inventory_movements(id uuid primary key);
create table public.ecoflow_warehouse_movements(id uuid primary key);
create table public.ecoflow_unleashed_product_assets(id uuid primary key);
create table public.ecoflow_unleashed_asset_copy_runs(id uuid primary key);

do $$
declare
  r jsonb;
  v_failed boolean:=false;
begin
  r:=public.ecoflow_read_commercial_wave2_canary_unlock_preflight(
    '10000000-0000-4000-8000-000000000001',
    '18dc00fd-ffe5-4d96-9e91-830d2686ff8e',
    '61b13a7c-18d1-48f0-b317-96d23607ddfb',
    164,'79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
    '140010','3001d0f1-6c1b-4b15-98a0-91443ca6b525',0,
    '016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8',
    'guid:e80b9e1d-f33d-4ebf-b76d-dfdd9beb1a7b');
  if r->>'status'<>'READY'
     or not (r->>'ready')::boolean
     or (r->>'p0Ready')::boolean
     or r->>'stage'<>'P2A_SELECT_ONLY'
     or (r->>'candidateCount')::bigint<>164
     or (r->>'eligibleCandidateCount')::bigint<>164
     or (r->>'distinctNormalizedCodes')::bigint<>164
     or (r->>'enabledCandidateCount')::bigint<>0
     or (r->>'canaryCount')::bigint<>1
     or (r->>'expansionCount')::bigint<>163
     or (r->>'planCommandCount')::bigint<>1
     or (r->>'exactPlanCommandCount')::bigint<>1
     or (r->>'planAuditCount')::bigint<>1
     or r->>'planCommandId'<>'18dc00fd-ffe5-4d96-9e91-830d2686ff8e'
     or r->>'unlockCommandId'<>'61b13a7c-18d1-48f0-b317-96d23607ddfb'
     or (r->>'phaseUnlockCount')::bigint<>0
     or (r->>'unlockCommandCount')::bigint<>0
     or (r->>'promotionCount')::bigint<>0
     or (r->>'promotionCommandCount')::bigint<>0
     or r->'canary'->>'externalProductCode'<>'140010'
     or r->'canary'->>'mappingId'<>'3001d0f1-6c1b-4b15-98a0-91443ca6b525'
     or (r->'canary'->>'mappingRevision')::bigint<>0
     or r->'canary'->>'sourcePayloadSha256'<>'016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8'
     or r->'canary'->>'sourceExternalKey'<>'guid:e80b9e1d-f33d-4ebf-b76d-dfdd9beb1a7b' then
    raise exception 'post-P1 P2A preflight failed: %',r;
  end if;

  begin
    perform public.ecoflow_read_commercial_wave2_canary_unlock_preflight(
      '10000000-0000-4000-8000-000000000002',
      '18dc00fd-ffe5-4d96-9e91-830d2686ff8e','61b13a7c-18d1-48f0-b317-96d23607ddfb',
      164,'79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
      '140010','3001d0f1-6c1b-4b15-98a0-91443ca6b525',0,
      '016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8',
      'guid:e80b9e1d-f33d-4ebf-b76d-dfdd9beb1a7b');
  exception when others then
    if position('COMMERCIAL_WAVE2_P2A_FORBIDDEN' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'VIEWER P2A preflight was not blocked'; end if;

  v_failed:=false;
  begin
    perform public.ecoflow_read_commercial_wave2_canary_unlock_preflight(
      null,'18dc00fd-ffe5-4d96-9e91-830d2686ff8e','61b13a7c-18d1-48f0-b317-96d23607ddfb',
      164,'79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
      '140010','3001d0f1-6c1b-4b15-98a0-91443ca6b525',0,
      '016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8',
      'guid:e80b9e1d-f33d-4ebf-b76d-dfdd9beb1a7b');
  exception when others then
    if position('COMMERCIAL_WAVE2_P2A_FORBIDDEN' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'missing auth identity was not blocked'; end if;

  v_failed:=false;
  begin
    perform public.ecoflow_read_commercial_wave2_canary_unlock_preflight(
      '10000000-0000-4000-8000-000000000001',
      '18dc00fd-ffe5-4d96-9e91-830d2686ff8e','61b13a7c-18d1-48f0-b317-96d23607ddfb',
      164,'79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
      'CCSB6-80','3001d0f1-6c1b-4b15-98a0-91443ca6b525',0,
      '016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8',
      'guid:e80b9e1d-f33d-4ebf-b76d-dfdd9beb1a7b');
  exception when others then
    if position('COMMERCIAL_WAVE2_P2A_INVALID' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'wrong canary was not blocked'; end if;
end $$;

begin;
update public.ecoflow_unleashed_master_mappings
set revision=1
where id='3001d0f1-6c1b-4b15-98a0-91443ca6b525';
do $$ declare r jsonb; begin
  r:=public.ecoflow_commercial_wave2_canary_unlock_evidence();
  if (r->>'ready')::boolean then raise exception 'stale mapping revision was accepted'; end if;
end $$;
rollback;

begin;
update public.ecoflow_unleashed_master_mappings
set source_payload_sha256=repeat('0',64)
where id='3001d0f1-6c1b-4b15-98a0-91443ca6b525';
do $$ declare r jsonb; begin
  r:=public.ecoflow_commercial_wave2_canary_unlock_evidence();
  if (r->>'ready')::boolean then raise exception 'stale source payload was accepted'; end if;
end $$;
rollback;

begin;
update public.ecoflow_commercial_wave2_candidates
set expected_source_external_key='guid:drift'
where external_product_code='140010';
do $$ declare r jsonb; begin
  r:=public.ecoflow_commercial_wave2_canary_unlock_evidence();
  if (r->>'ready')::boolean then raise exception 'source-key/cohort drift was accepted'; end if;
end $$;
rollback;

begin;
update public.ecoflow_commercial_wave2_candidates set enabled=true where external_product_code='140010';
do $$ declare r jsonb; begin
  r:=public.ecoflow_commercial_wave2_canary_unlock_evidence();
  if (r->>'ready')::boolean then raise exception 'wrong canary state was accepted'; end if;
end $$;
rollback;

begin;
insert into public.ecoflow_commercial_wave2_phase_unlocks(
  promotion_phase,candidate_set_sha256,unlocked_candidate_count,authorization_command_id,unlocked_by,reason
) values(
  'CANARY','79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',1,
  '61000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','unexpected unlock test');
do $$ declare r jsonb; begin
  r:=public.ecoflow_commercial_wave2_canary_unlock_evidence();
  if (r->>'ready')::boolean then raise exception 'unexpected phase unlock was accepted'; end if;
end $$;
rollback;

begin;
insert into public.ecoflow_commercial_wave2_promotion_commands(
  command_id,actor_user_id,external_product_code,unleashed_mapping_id,expected_mapping_revision,
  expected_source_payload_sha256,command_payload_sha256,result
) values(
  '62000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','140010',
  '3001d0f1-6c1b-4b15-98a0-91443ca6b525',0,
  '016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8',repeat('1',64),'{}');
do $$ declare r jsonb; begin
  r:=public.ecoflow_commercial_wave2_canary_unlock_evidence();
  if (r->>'ready')::boolean then raise exception 'existing promotion command was accepted'; end if;
end $$;
rollback;

begin;
delete from public.app_security_audit_events
where action='COMMERCIAL_WAVE2_PLAN_COMPLETED';
do $$ declare r jsonb; begin
  r:=public.ecoflow_commercial_wave2_canary_unlock_evidence();
  if (r->>'ready')::boolean then raise exception 'missing P1 audit was accepted'; end if;
end $$;
rollback;

do $$
declare v_failed boolean:=false;
begin
  begin
    perform public.ecoflow_execute_commercial_wave2_canary_unlock(
      '61b13a7c-18d1-48f0-b317-96d23607ddfb','10000000-0000-4000-8000-000000000001',
      repeat('0',64),'stale hash must fail');
  exception when others then
    if position('COMMERCIAL_WAVE2_P2A_INVALID' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'stale cohort hash crossed P2A'; end if;

  if has_function_privilege('anon','public.ecoflow_execute_commercial_wave2_canary_unlock(uuid,uuid,text,text)','execute')
     or has_function_privilege('authenticated','public.ecoflow_execute_commercial_wave2_canary_unlock(uuid,uuid,text,text)','execute')
     or has_function_privilege('authenticated','public.ecoflow_read_commercial_wave2_canary_unlock_preflight(uuid,uuid,uuid,bigint,text,text,uuid,bigint,text,text)','execute')
     or not has_function_privilege('service_role','public.ecoflow_execute_commercial_wave2_canary_unlock(uuid,uuid,text,text)','execute') then
    raise exception 'P2A RPC grant boundary failed';
  end if;
end $$;

select dblink_connect('p2a_a','host=127.0.0.1 port=5432 dbname=postgres user=postgres password=postgres');
select dblink_connect('p2a_b','host=127.0.0.1 port=5432 dbname=postgres user=postgres password=postgres');
select dblink_send_query('p2a_a',$q$
  select public.ecoflow_execute_commercial_wave2_canary_unlock(
    '61b13a7c-18d1-48f0-b317-96d23607ddfb','10000000-0000-4000-8000-000000000001',
    '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
    '#338 P2A exact canary eligibility unlock only; no promotion or quantity authority.')::text
$q$);
select dblink_send_query('p2a_b',$q$
  select public.ecoflow_execute_commercial_wave2_canary_unlock(
    '61b13a7c-18d1-48f0-b317-96d23607ddfb','10000000-0000-4000-8000-000000000001',
    '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
    '#338 P2A exact canary eligibility unlock only; no promotion or quantity authority.')::text
$q$);
select result from dblink_get_result('p2a_a') as t(result text);
select result from dblink_get_result('p2a_b') as t(result text);
select dblink_disconnect('p2a_a');
select dblink_disconnect('p2a_b');

do $$
declare
  r jsonb;
  v_failed boolean:=false;
begin
  r:=public.ecoflow_execute_commercial_wave2_canary_unlock(
    '61b13a7c-18d1-48f0-b317-96d23607ddfb','10000000-0000-4000-8000-000000000001',
    '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
    '#338 P2A exact canary eligibility unlock only; no promotion or quantity authority.');
  if r->>'stage'<>'P2A_CANARY_UNLOCK'
     or r->>'status'<>'CANARY_ENABLED'
     or not (r->>'replayed')::boolean
     or r->>'canaryExternalProductCode'<>'140010'
     or (r->>'enabledCandidateCount')::bigint<>1
     or (r->>'phaseUnlockCount')::bigint<>1
     or (r->>'unlockCommandCount')::bigint<>1
     or (r->>'promotionCount')::bigint<>0
     or (r->>'promotionCommandCount')::bigint<>0 then
    raise exception 'same-command replay evidence failed: %',r;
  end if;

  begin
    perform public.ecoflow_execute_commercial_wave2_canary_unlock(
      '61b13a7c-18d1-48f0-b317-96d23607ddfb','10000000-0000-4000-8000-000000000001',
      '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
      'same command changed evidence');
  exception when others then
    if position('COMMAND_REPLAY_PAYLOAD_MISMATCH' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'same command accepted changed evidence'; end if;

  if (select count(*) from public.ecoflow_commercial_wave2_candidates where enabled)<>1
     or not (select enabled from public.ecoflow_commercial_wave2_candidates where external_product_code='140010')
     or exists(select 1 from public.ecoflow_commercial_wave2_candidates where promotion_phase='EXPANSION' and enabled)
     or (select count(*) from public.ecoflow_commercial_wave2_phase_unlocks)<>1
     or (select count(*) from public.ecoflow_commercial_wave2_unlock_commands)<>1
     or (select count(*) from public.ecoflow_commercial_wave2_promotions)<>0
     or (select count(*) from public.ecoflow_commercial_wave2_promotion_commands)<>0
     or (select count(*) from public.skus)<>0
     or (select count(*) from public.external_product_mappings)<>0
     or (select count(*) from public.ecoflow_product_identity_batches)<>0
     or (select count(*) from public.ecoflow_product_identity_tasks)<>0
     or (select count(*) from public.ecoflow_sku_families)<>0
     or (select count(*) from public.ecoflow_physical_skus)<>0
     or (select count(*) from public.ecoflow_physical_sku_packages)<>0
     or (select count(*) from public.ecoflow_physical_barcode_bindings)<>0
     or (select count(*) from public.ecoflow_commercial_family_links)<>0
     or (select count(*) from public.inventory_balances)<>0
     or (select count(*) from public.ecoflow_inventory_movements)<>0
     or (select count(*) from public.ecoflow_warehouse_movements)<>0
     or (select count(*) from public.ecoflow_warehouse_location_items)<>0
     or (select count(*) from public.stock_movements)<>0
     or (select count(*) from public.ecoflow_unleashed_product_assets)<>0
     or (select count(*) from public.ecoflow_unleashed_asset_copy_runs)<>0 then
    raise exception 'P2A separation, concurrency, or mutation sentinels failed';
  end if;
end $$;

\ir ../supabase/migrations/20260913010000_commercial_wave2_p2a_canary_unlock_carrier.sql

select 'COMMERCIAL_PROMOTION_WAVE2_P2A_CANARY_UNLOCK_DB_CONTRACT_PASS' as result;
