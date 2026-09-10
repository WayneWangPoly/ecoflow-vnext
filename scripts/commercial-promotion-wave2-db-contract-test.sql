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

do $$
declare v_count bigint; v_hash text;
begin
  select count(*),encode(extensions.digest(string_agg(concat_ws('|',
    external_product_code,unleashed_mapping_id::text,expected_mapping_revision::text,
    expected_source_payload_sha256,expected_source_external_key),E'\n' order by external_product_code),'sha256'),'hex')
  into v_count,v_hash from public.ecoflow_commercial_wave2_candidates;
  if v_count<>164 or v_hash<>'79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a'
     or (select count(*) from public.ecoflow_commercial_wave2_candidates where enabled)<>0
     or (select count(*) from public.ecoflow_commercial_wave2_candidates where promotion_phase='CANARY')<>1
     or exists(select 1 from public.ecoflow_commercial_wave2_candidates where external_product_code in ('CCSB6-80','CCSKBM16-90')) then
    raise exception 'frozen cohort contract failed';
  end if;
end $$;

insert into public.app_user_profiles values
('10000000-0000-4000-8000-000000000001','OWNER',true,'ACTIVE'),
('10000000-0000-4000-8000-000000000002','VIEWER',true,'ACTIVE');

insert into public.ecoflow_unleashed_master_mappings(
  id,entity_type,mapping_status,source_external_code,source_external_key,
  source_payload_sha256,source_duplicate_count,revision,candidate_count
)
select unleashed_mapping_id,'PRODUCT','UNMATCHED',
  case when external_product_code='BCB-F-L' then ' BCB-F-L' else external_product_code end,
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
declare v_failed boolean:=false;
begin
  begin
    perform public.ecoflow_unlock_commercial_wave2_canary(
      '90000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',
      '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a','viewer denied');
  exception when others then
    if position('COMMERCIAL_WAVE2_FORBIDDEN' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'viewer unlock was not denied'; end if;

  v_failed:=false;
  begin
    perform public.ecoflow_unlock_commercial_wave2_expansion(
      '90000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',
      '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',1,
      repeat('0',64),'expansion too early');
  exception when others then
    if position('COMMERCIAL_WAVE2_EXPANSION_GATE_INVALID' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'expansion opened before canary'; end if;
end $$;

select public.ecoflow_unlock_commercial_wave2_canary(
  '90000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001',
  '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a','Wave 2 test canary unlock');
select public.ecoflow_unlock_commercial_wave2_canary(
  '90000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001',
  '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a','Wave 2 test canary unlock');

do $$
declare a public.ecoflow_commercial_wave2_candidates%rowtype; r jsonb; v_failed boolean:=false;
begin
  select * into a from public.ecoflow_commercial_wave2_candidates where promotion_phase='CANARY';
  r:=public.ecoflow_promote_commercial_wave2_sku(
    '91000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
    a.external_product_code,a.unleashed_mapping_id,a.expected_mapping_revision,
    a.expected_source_payload_sha256,'Wave 2 canary Commercial only');
  if r->>'promotionPhase'<>'CANARY' or r->>'setupStatus'<>'mapping_draft'
     or (r->>'physicalAuthorityCreated')::boolean or (r->>'inventoryAuthorityCreated')::boolean then
    raise exception 'canary result boundary failed: %',r;
  end if;
  begin
    perform public.ecoflow_promote_commercial_wave2_sku(
      '91000000-0000-4000-8000-000000000099','10000000-0000-4000-8000-000000000001',
      'CCSB6-80',a.unleashed_mapping_id,a.expected_mapping_revision,
      a.expected_source_payload_sha256,'hold must fail');
  exception when others then
    if position('COMMERCIAL_WAVE2_HOLD_BLOCKED' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'hold code was not blocked'; end if;
end $$;

do $$
declare a public.ecoflow_commercial_wave2_candidates%rowtype; p public.ecoflow_commercial_wave2_promotions%rowtype;
begin
  select * into a from public.ecoflow_commercial_wave2_candidates where promotion_phase='CANARY';
  select * into p from public.ecoflow_commercial_wave2_promotions where external_product_code=a.external_product_code;
  update public.ecoflow_unleashed_master_mappings set
    mapping_status='MATCHED',match_method='ORDERMENTUM_PRODUCT_CODE_EXACT',
    canonical_object_type='COMMERCIAL_SKU',canonical_object_id=p.commercial_sku_id,
    canonical_code=a.external_product_code,candidate_count=1,revision=revision+1
  where id=a.unleashed_mapping_id;
end $$;

do $$
declare a public.ecoflow_commercial_wave2_candidates%rowtype;
  c public.ecoflow_commercial_wave2_candidates%rowtype; v_failed boolean:=false;
begin
  select * into a from public.ecoflow_commercial_wave2_candidates where promotion_phase='CANARY';
  select * into c from public.ecoflow_commercial_wave2_candidates where promotion_phase='EXPANSION' order by external_product_code limit 1;
  update public.ecoflow_unleashed_master_mappings set revision=revision+1 where id=c.unleashed_mapping_id;
  begin
    perform public.ecoflow_unlock_commercial_wave2_expansion(
      '92000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
      a.candidate_set_sha256,a.expected_mapping_revision+1,a.expected_source_payload_sha256,'drift must fail');
  exception when others then
    if position('COMMERCIAL_WAVE2_EXPANSION_SET_DRIFT' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'expansion drift was not blocked'; end if;
  update public.ecoflow_unleashed_master_mappings set revision=revision-1 where id=c.unleashed_mapping_id;
end $$;

do $$
declare a public.ecoflow_commercial_wave2_candidates%rowtype; r jsonb;
begin
  select * into a from public.ecoflow_commercial_wave2_candidates where promotion_phase='CANARY';
  r:=public.ecoflow_unlock_commercial_wave2_expansion(
    '92000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',
    a.candidate_set_sha256,a.expected_mapping_revision+1,a.expected_source_payload_sha256,
    'Wave 2 test expansion unlock after exact PLAN');
  if (r->>'unlockedCandidateCount')::bigint<>163
     or (select count(*) from public.ecoflow_commercial_wave2_candidates where enabled)<>164 then
    raise exception 'expansion unlock result failed: %',r;
  end if;
end $$;

do $$
declare a public.ecoflow_commercial_wave2_candidates%rowtype; r jsonb;
  s public.skus%rowtype; e public.external_product_mappings%rowtype;
begin
  select * into a from public.ecoflow_commercial_wave2_candidates
    where external_product_code='BCB-F-L';
  r:=public.ecoflow_promote_commercial_wave2_sku(
    '93000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
    ' BCB-F-L ',a.unleashed_mapping_id,a.expected_mapping_revision,a.expected_source_payload_sha256,
    'normalized expansion Commercial only');
  select * into s from public.skus where sku_code='BCB-F-L';
  select * into e from public.external_product_mappings
    where provider='ORDERMENTUM' and external_product_code='BCB-F-L';
  if s.id is null or e.id is null or s.setup_status<>'mapping_draft'
     or s.default_storage_unit<>'unconfigured' or s.default_pick_unit<>'unconfigured'
     or s.can_sell_by_carton or s.can_sell_by_sleeve or s.can_mix_pack
     or e.default_unit_level<>'unconfigured' or e.confidence<>'BOUNDED_COMMERCIAL_PROMOTION'
     or not e.is_active or r->>'promotionPhase'<>'EXPANSION' then
    raise exception 'expansion Commercial-only boundary failed: %/%/%',s,e,r;
  end if;
end $$;

do $$
begin
  if has_table_privilege('service_role','public.ecoflow_commercial_wave2_candidates','select')
     or has_table_privilege('authenticated','public.ecoflow_commercial_wave2_candidates','select')
     or has_function_privilege('anon','public.ecoflow_unlock_commercial_wave2_canary(uuid,uuid,text,text)','execute')
     or has_function_privilege('authenticated','public.ecoflow_promote_commercial_wave2_sku(uuid,uuid,text,uuid,bigint,text,text)','execute')
     or not has_function_privilege('service_role','public.ecoflow_unlock_commercial_wave2_expansion(uuid,uuid,text,bigint,text,text)','execute')
     or to_regclass('public.sku_units') is not null
     or to_regclass('public.ecoflow_physical_skus') is not null
     or to_regclass('public.ecoflow_inventory_test_sentinel') is not null then
    raise exception 'security or authority boundary failed';
  end if;
  if (select count(*) from public.app_security_audit_events
      where action in ('COMMERCIAL_WAVE2_CANARY_UNLOCKED','COMMERCIAL_WAVE2_SKU_PROMOTED','COMMERCIAL_WAVE2_EXPANSION_UNLOCKED'))<>4 then
    raise exception 'audit event count failed';
  end if;
end $$;

\ir ../supabase/migrations/20260910010000_commercial_promotion_wave2.sql

select 'COMMERCIAL_PROMOTION_WAVE2_DB_CONTRACT_PASS' as result;
