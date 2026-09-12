\set ON_ERROR_STOP on

create schema extensions;
create extension pgcrypto with schema extensions;
do $$ begin
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
exception when duplicate_object then null; end $$;

create table public.skus(
  id uuid primary key default extensions.gen_random_uuid(),
  sku_code text not null, display_name text not null, category text not null,
  can_sell_by_carton boolean not null, can_sell_by_sleeve boolean not null,
  default_storage_unit text not null, default_pick_unit text not null,
  can_mix_pack boolean not null, setup_status text not null
);
create table public.external_product_mappings(
  id uuid primary key default extensions.gen_random_uuid(),
  provider text not null, external_product_code text not null, internal_sku_id uuid not null,
  default_unit_level text not null, confidence text not null, is_active boolean not null
);
create table public.ecoflow_unleashed_master_mappings(
  id uuid primary key, entity_type text not null, mapping_status text not null,
  source_external_code text, source_external_key text not null,
  source_payload_sha256 text not null, source_duplicate_count integer not null,
  revision bigint not null, match_method text, canonical_object_type text,
  canonical_object_id uuid, canonical_code text, candidate_count integer not null default 0
);
create table public.unleashed_raw_snapshots(
  resource text not null, external_key text not null, payload_sha256 text not null, payload jsonb not null
);
create table public.v_ecoflow_ordermentum_listed_skus(
  external_sku_code text, listed_product_name text, is_visible_on_ordermentum boolean
);
create table public.app_user_profiles(
  user_id uuid primary key, app_role text not null, is_active boolean not null, team_status text not null
);
create table public.app_security_audit_events(
  id uuid primary key default extensions.gen_random_uuid(), actor_user_id uuid, actor_role text,
  action text, target_type text, target_id text, before_data jsonb, after_data jsonb
);
create function public.ecoflow_unleashed_json_boolean(p_value jsonb) returns boolean
language sql immutable as $$ select lower(coalesce(p_value#>>'{}','false')) in ('true','t','1','yes') $$;

\ir ../supabase/migrations/20260910010000_commercial_promotion_wave2.sql

create table public.test_wave2_plan_invocations(id bigint generated always as identity primary key);
create function public.ecoflow_plan_unleashed_master_mappings(p_requested_by uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=''
as $$
begin
  insert into public.test_wave2_plan_invocations default values;
  return jsonb_build_object('planned',164,'matched',0,'unmatched',164,'reason',p_reason);
end;
$$;

create table public.ecoflow_bounded_commercial_sku_promotion_allowlist(
  external_product_code text primary key, unlocked boolean not null
);
insert into public.ecoflow_bounded_commercial_sku_promotion_allowlist values ('BATCH1-COMPLETE',true);

create table public.ecoflow_physical_skus(id uuid primary key);
create table public.ecoflow_physical_sku_packages(id uuid primary key);
create table public.ecoflow_physical_barcode_bindings(id uuid primary key);
create table public.inventory_balances(id uuid primary key);
create table public.stock_movements(id uuid primary key);
create table public.ecoflow_warehouse_location_items(id uuid primary key);

\ir ../supabase/migrations/20260913000000_commercial_wave2_plan_readiness.sql

insert into public.app_user_profiles values
('10000000-0000-4000-8000-000000000001','OWNER',true,'ACTIVE'),
('10000000-0000-4000-8000-000000000002','VIEWER',true,'ACTIVE');

insert into public.ecoflow_unleashed_master_mappings(
  id,entity_type,mapping_status,source_external_code,source_external_key,
  source_payload_sha256,source_duplicate_count,revision,candidate_count
)
select unleashed_mapping_id,'PRODUCT','UNMATCHED',
  case when external_product_code='BCB-F-L' then ' BCB-F-L ' else external_product_code end,
  expected_source_external_key,expected_source_payload_sha256,1,expected_mapping_revision,0
from public.ecoflow_commercial_wave2_candidates;

insert into public.unleashed_raw_snapshots(resource,external_key,payload_sha256,payload)
select 'products',expected_source_external_key,expected_source_payload_sha256,
  jsonb_build_object('ProductCode',external_product_code,'Obsolete',false,'Status','Active')
from public.ecoflow_commercial_wave2_candidates;

insert into public.v_ecoflow_ordermentum_listed_skus
select external_product_code,external_product_code||' display',true
from public.ecoflow_commercial_wave2_candidates;

do $$
declare r jsonb; v_failed boolean:=false; v_mapping uuid;
begin
  r:=public.ecoflow_read_commercial_wave2_plan_preflight(
    '10000000-0000-4000-8000-000000000001',
    '101617435b787d4ac5f4b636e0dc8f9284ff473c',164,
    '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a','140010');
  if r->>'status'<>'READY' or (r->>'candidateCount')::bigint<>164
     or (r->>'eligibleCandidateCount')::bigint<>164
     or (r->>'enabledCandidateCount')::bigint<>0
     or r->'canary'->>'externalProductCode'<>'140010'
     or r->'componentHashes'->>'mapping'<>'3edf75311bbab34995b7beb2fba38b9715aef142f0481fa1dfe4a621b5b510d1'
     or r->'componentHashes'->>'revision'<>'b3397bd903a2a9569a90c2e6217af87764641b99e4af6c1a5baf7ef630bc3131'
     or (r->>'imagePlanningIncluded')::boolean then
    raise exception 'fresh P0 contract failed: %',r;
  end if;

  begin
    perform public.ecoflow_read_commercial_wave2_plan_preflight(
      '10000000-0000-4000-8000-000000000002',
      '101617435b787d4ac5f4b636e0dc8f9284ff473c',164,
      '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a','140010');
  exception when others then
    if position('COMMERCIAL_WAVE2_PLAN_FORBIDDEN' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'Viewer P0 was not denied'; end if;

  v_failed:=false;
  begin
    perform public.ecoflow_read_commercial_wave2_plan_preflight(
      '10000000-0000-4000-8000-000000000001',
      '101617435b787d4ac5f4b636e0dc8f9284ff473c',164,
      '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a','CCSB6-80');
  exception when others then
    if position('COMMERCIAL_WAVE2_PLAN_INVALID' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'wrong canary was accepted'; end if;

  select unleashed_mapping_id into v_mapping
  from public.ecoflow_commercial_wave2_candidates order by external_product_code collate "C" limit 1;
  update public.ecoflow_unleashed_master_mappings set revision=revision+1 where id=v_mapping;
  r:=public.ecoflow_read_commercial_wave2_plan_preflight(
    '10000000-0000-4000-8000-000000000001',
    '101617435b787d4ac5f4b636e0dc8f9284ff473c',164,
    '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a','140010');
  if r->>'status'<>'HOLD' or (r->>'eligibleCandidateCount')::bigint<>163 then
    raise exception 'stale revision did not fail P0 closed: %',r;
  end if;
  v_failed:=false;
  begin
    perform public.ecoflow_plan_commercial_wave2(
      '18000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
      '101617435b787d4ac5f4b636e0dc8f9284ff473c',164,
      '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a','140010','stale must fail');
  exception when others then
    if position('COMMERCIAL_WAVE2_PLAN_GATE_DRIFT' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'stale revision crossed PLAN'; end if;
  update public.ecoflow_unleashed_master_mappings set revision=revision-1 where id=v_mapping;
end $$;

select public.ecoflow_plan_commercial_wave2(
  '18dc00fd-ffe5-4d96-9e91-830d2686ff8e','10000000-0000-4000-8000-000000000001',
  '101617435b787d4ac5f4b636e0dc8f9284ff473c',164,
  '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a','140010',
  '#338 Commercial Promotion Wave 2 production PLAN; exact frozen 164-row evidence only; no unlock, promotion, Product Identity, image or quantity authority.');
select public.ecoflow_plan_commercial_wave2(
  '18dc00fd-ffe5-4d96-9e91-830d2686ff8e','10000000-0000-4000-8000-000000000001',
  '101617435b787d4ac5f4b636e0dc8f9284ff473c',164,
  '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a','140010',
  '#338 Commercial Promotion Wave 2 production PLAN; exact frozen 164-row evidence only; no unlock, promotion, Product Identity, image or quantity authority.');

do $$
declare v_failed boolean:=false;
begin
  if (select count(*) from public.test_wave2_plan_invocations)<>1
     or (select count(*) from public.ecoflow_commercial_wave2_plan_commands)<>1
     or (select count(*) from public.ecoflow_commercial_wave2_candidates where enabled)<>0
     or (select count(*) from public.ecoflow_commercial_wave2_phase_unlocks)<>0
     or (select count(*) from public.ecoflow_commercial_wave2_promotions)<>0
     or (select count(*) from public.ecoflow_commercial_wave2_unlock_commands)<>0
     or (select count(*) from public.ecoflow_commercial_wave2_promotion_commands)<>0
     or (select count(*) from public.skus)<>0
     or (select count(*) from public.external_product_mappings)<>0
     or (select count(*) from public.ecoflow_physical_skus)<>0
     or (select count(*) from public.ecoflow_physical_sku_packages)<>0
     or (select count(*) from public.ecoflow_physical_barcode_bindings)<>0
     or (select count(*) from public.inventory_balances)<>0
     or (select count(*) from public.stock_movements)<>0
     or (select count(*) from public.ecoflow_warehouse_location_items)<>0 then
    raise exception 'PLAN side-effect or replay contract failed';
  end if;
  if exists(select 1 from public.ecoflow_commercial_wave2_candidates
      where external_product_code in ('CCSB6-80','CCSKBM16-90')) then
    raise exception 'HOLD code admitted';
  end if;
  begin
    perform public.ecoflow_plan_commercial_wave2(
      '18dc00fd-ffe5-4d96-9e91-830d2686ff8e','10000000-0000-4000-8000-000000000001',
      '101617435b787d4ac5f4b636e0dc8f9284ff473c',164,
      '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a','140010',
      'same command different evidence');
  exception when others then
    if position('COMMAND_REPLAY_PAYLOAD_MISMATCH' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'same command accepted different evidence'; end if;
  if has_table_privilege('service_role','public.ecoflow_commercial_wave2_plan_commands','select')
     or has_function_privilege('authenticated','public.ecoflow_plan_commercial_wave2(uuid,uuid,text,bigint,text,text,text)','execute')
     or not has_function_privilege('service_role','public.ecoflow_plan_commercial_wave2(uuid,uuid,text,bigint,text,text,text)','execute') then
    raise exception 'PLAN grant or RLS boundary failed';
  end if;
end $$;

\ir ../supabase/migrations/20260913000000_commercial_wave2_plan_readiness.sql

select 'COMMERCIAL_PROMOTION_WAVE2_PLAN_READINESS_DB_CONTRACT_PASS' as result;
