\set ON_ERROR_STOP on

-- #338 Identity Unlock Batch 1B database contract.
-- Runs after the existing bridge + Batch 1A contracts in the shared PostgreSQL
-- 17 service. Extend only the simplified fixture columns needed by the real
-- production Commercial tables; no Product Identity / inventory authority is
-- introduced by the fixture.
alter table public.skus add column if not exists display_name text;
alter table public.skus add column if not exists category text;
alter table public.skus add column if not exists can_sell_by_carton boolean not null default true;
alter table public.skus add column if not exists can_sell_by_sleeve boolean not null default true;
alter table public.skus add column if not exists default_storage_unit text not null default 'carton';
alter table public.skus add column if not exists default_pick_unit text not null default 'sleeve';
alter table public.skus add column if not exists can_mix_pack boolean not null default true;
alter table public.skus add column if not exists setup_status text not null default 'active';
update public.skus set display_name=coalesce(display_name,sku_code);

alter table public.external_product_mappings add column if not exists default_unit_level text not null default 'sleeve';
alter table public.external_product_mappings add column if not exists confidence text not null default 'EXACT';
alter table public.external_product_mappings add column if not exists created_at timestamptz not null default now();
alter table public.external_product_mappings add column if not exists updated_at timestamptz not null default now();

create table if not exists public.sku_units(
  id uuid primary key default extensions.gen_random_uuid(),
  sku_id uuid not null references public.skus(id),
  unit_level text not null
);
create table if not exists public.ecoflow_physical_skus(
  id uuid primary key default extensions.gen_random_uuid(),
  commercial_sku_id uuid references public.skus(id)
);
create table if not exists public.ecoflow_physical_barcode_bindings(
  id uuid primary key default extensions.gen_random_uuid(),
  physical_sku_id uuid references public.ecoflow_physical_skus(id),
  barcode text
);
create table if not exists public.ecoflow_inventory_test_sentinel(
  id uuid primary key default extensions.gen_random_uuid(),
  marker text
);

create or replace view public.v_ecoflow_ordermentum_sku_mapping_workbench as
select * from (values
  ('CCSA8-90'::text,'(90mm) 8oz Art Series Single Wall - 1000pcs'::text,65::bigint,65::bigint),
  ('BPB8'::text,'8oz Kraft Soup Bowl'::text,5::bigint,5::bigint),
  ('CCSB6-80'::text,'(80mm) 6oz Compostable Black'::text,1::bigint,1::bigint)
) v(external_sku_code,external_product_name,line_count,order_count);

do $$
declare
  v_run uuid := '20000000-0000-4000-8000-000000000001';
  v_payload jsonb;
begin
  insert into public.unleashed_external_identities(
    resource,external_key,external_guid,external_code,last_seen_run_id
  ) values
    ('products','guid:91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','CCSA8-90',v_run),
    ('products','guid:91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000002','BPB8',v_run),
    ('products','guid:91000000-0000-4000-8000-000000000003','91000000-0000-4000-8000-000000000003','CCSB6-80',v_run)
  on conflict(resource,external_key) do update set
    external_guid=excluded.external_guid,
    external_code=excluded.external_code,
    last_seen_run_id=excluded.last_seen_run_id;

  v_payload := '{"ProductCode":"CCSA8-90","ProductDescription":"Unleashed canary display name","Obsolete":false}'::jsonb;
  insert into public.unleashed_raw_snapshots(resource,external_key,payload,payload_sha256,last_seen_at)
  values('products','guid:91000000-0000-4000-8000-000000000001',v_payload,
    encode(extensions.digest(v_payload::text,'sha256'),'hex'),now())
  on conflict(resource,external_key) do update set payload=excluded.payload,payload_sha256=excluded.payload_sha256,last_seen_at=excluded.last_seen_at;

  v_payload := '{"ProductCode":"BPB8","ProductDescription":"Future continuation row","Obsolete":false}'::jsonb;
  insert into public.unleashed_raw_snapshots(resource,external_key,payload,payload_sha256,last_seen_at)
  values('products','guid:91000000-0000-4000-8000-000000000002',v_payload,
    encode(extensions.digest(v_payload::text,'sha256'),'hex'),now())
  on conflict(resource,external_key) do update set payload=excluded.payload,payload_sha256=excluded.payload_sha256,last_seen_at=excluded.last_seen_at;

  v_payload := '{"ProductCode":"CCSB6-80","ProductDescription":"Conflict row","Obsolete":false}'::jsonb;
  insert into public.unleashed_raw_snapshots(resource,external_key,payload,payload_sha256,last_seen_at)
  values('products','guid:91000000-0000-4000-8000-000000000003',v_payload,
    encode(extensions.digest(v_payload::text,'sha256'),'hex'),now())
  on conflict(resource,external_key) do update set payload=excluded.payload,payload_sha256=excluded.payload_sha256,last_seen_at=excluded.last_seen_at;
end $$;

select public.ecoflow_plan_unleashed_master_mappings(
  '10000000-0000-4000-8000-000000000001','Batch 1B baseline plan'
);

\ir ../supabase/migrations/20260908094500_identity_unlock_batch1_commercial_sku_promotion.sql
\ir ../supabase/migrations/20260908094500_identity_unlock_batch1_commercial_sku_promotion.sql

-- Frozen allowlist: exactly 22 reviewed safe candidates, only CCSA8-90 enabled,
-- and the physical-evidence conflict CCSB6-80 is excluded entirely.
do $$
declare
  v_total bigint;
  v_enabled bigint;
  v_after_canary bigint;
begin
  select count(*),count(*) filter(where enabled),count(*) filter(where promotion_phase='AFTER_CANARY')
  into v_total,v_enabled,v_after_canary
  from public.ecoflow_bounded_commercial_sku_promotion_allowlist;
  if v_total<>22 or v_enabled<>1 or v_after_canary<>21 then
    raise exception 'unexpected Batch 1B allowlist shape: %/%/%',v_total,v_enabled,v_after_canary;
  end if;
  if not exists(select 1 from public.ecoflow_bounded_commercial_sku_promotion_allowlist where external_product_code='CCSA8-90' and promotion_phase='CANARY' and enabled)
     or exists(select 1 from public.ecoflow_bounded_commercial_sku_promotion_allowlist where external_product_code='CCSB6-80') then
    raise exception 'canary/conflict allowlist boundary failed';
  end if;
end $$;

-- Direct/browser mutation is unavailable; only service_role gets the bounded RPC.
do $$
begin
  if has_function_privilege('authenticated','public.ecoflow_promote_bounded_commercial_sku(uuid,uuid,text,uuid,bigint,text,text)','EXECUTE') then
    raise exception 'authenticated unexpectedly has commercial promotion execute';
  end if;
  if not has_function_privilege('service_role','public.ecoflow_promote_bounded_commercial_sku(uuid,uuid,text,uuid,bigint,text,text)','EXECUTE') then
    raise exception 'service_role missing commercial promotion execute';
  end if;
  if has_table_privilege('service_role','public.ecoflow_bounded_commercial_sku_promotions','INSERT')
     or has_table_privilege('authenticated','public.ecoflow_bounded_commercial_sku_promotion_allowlist','UPDATE') then
    raise exception 'bounded commercial authority tables are directly mutable';
  end if;
end $$;

-- Viewer/unknown actors, explicit conflict, unlisted codes, and the 21-row
-- continuation all fail before a Commercial row can be created.
do $$
declare
  v_canary public.ecoflow_unleashed_master_mappings%rowtype;
  v_future public.ecoflow_unleashed_master_mappings%rowtype;
  v_conflict public.ecoflow_unleashed_master_mappings%rowtype;
  v_failed boolean;
begin
  select * into v_canary from public.ecoflow_unleashed_master_mappings where source_external_code='CCSA8-90';
  select * into v_future from public.ecoflow_unleashed_master_mappings where source_external_code='BPB8';
  select * into v_conflict from public.ecoflow_unleashed_master_mappings where source_external_code='CCSB6-80';

  v_failed:=false;
  begin
    perform public.ecoflow_promote_bounded_commercial_sku(
      '92000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',
      'CCSA8-90',v_canary.id,v_canary.revision,v_canary.source_payload_sha256,'Viewer rejected'
    );
  exception when others then
    if position('COMMERCIAL_PROMOTION_FORBIDDEN' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'viewer promotion did not fail'; end if;

  v_failed:=false;
  begin
    perform public.ecoflow_promote_bounded_commercial_sku(
      '92000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000099',
      'CCSA8-90',v_canary.id,v_canary.revision,v_canary.source_payload_sha256,'Unknown actor rejected'
    );
  exception when others then
    if position('COMMERCIAL_PROMOTION_FORBIDDEN' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'unknown actor promotion did not fail'; end if;

  v_failed:=false;
  begin
    perform public.ecoflow_promote_bounded_commercial_sku(
      '92000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001',
      'BPB8',v_future.id,v_future.revision,v_future.source_payload_sha256,'Continuation remains locked'
    );
  exception when others then
    if position('COMMERCIAL_PROMOTION_PHASE_LOCKED' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'continuation promotion was not phase locked'; end if;

  v_failed:=false;
  begin
    perform public.ecoflow_promote_bounded_commercial_sku(
      '92000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001',
      'CCSB6-80',v_conflict.id,v_conflict.revision,v_conflict.source_payload_sha256,'Conflict must remain blocked'
    );
  exception when others then
    if position('COMMERCIAL_PROMOTION_CONFLICT_BLOCKED' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'CCSB6-80 conflict was not blocked'; end if;

  v_failed:=false;
  begin
    perform public.ecoflow_promote_bounded_commercial_sku(
      '92000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001',
      'NOT-APPROVED',v_canary.id,v_canary.revision,v_canary.source_payload_sha256,'Unlisted must fail'
    );
  exception when others then
    if position('COMMERCIAL_PROMOTION_NOT_ALLOWLISTED' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'unlisted promotion was not blocked'; end if;
end $$;

-- Source binding fails closed before promotion.
do $$
declare
  v_canary public.ecoflow_unleashed_master_mappings%rowtype;
  v_failed boolean := false;
begin
  select * into v_canary from public.ecoflow_unleashed_master_mappings where source_external_code='CCSA8-90';
  begin
    perform public.ecoflow_promote_bounded_commercial_sku(
      '92000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000001',
      'CCSA8-90',v_canary.id,v_canary.revision,repeat('0',64),'Wrong source hash must fail'
    );
  exception when others then
    if position('SOURCE_SNAPSHOT_CHANGED' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'stale source hash did not fail'; end if;
end $$;

-- Promote only the canary. This creates Commercial identity/mapping provenance,
-- but no units, Physical SKU/barcode, or inventory authority. The exact current
-- mapping revision is captured at execution time rather than assuming revision 0.
do $$
declare
  v_canary public.ecoflow_unleashed_master_mappings%rowtype;
  v_result jsonb;
  v_replay jsonb;
  v_sku public.skus%rowtype;
  v_external public.external_product_mappings%rowtype;
  v_units bigint;
  v_physical bigint;
  v_barcodes bigint;
  v_inventory bigint;
begin
  select * into v_canary from public.ecoflow_unleashed_master_mappings where source_external_code='CCSA8-90';
  if v_canary.mapping_status<>'UNMATCHED' then
    raise exception 'canary baseline unexpectedly changed status: %/%',v_canary.mapping_status,v_canary.revision;
  end if;

  v_result := public.ecoflow_promote_bounded_commercial_sku(
    '92000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000001',
    'CCSA8-90',v_canary.id,v_canary.revision,v_canary.source_payload_sha256,
    'Batch 1B canary commercial identity only'
  );
  v_replay := public.ecoflow_promote_bounded_commercial_sku(
    '92000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000001',
    'CCSA8-90',v_canary.id,v_canary.revision,v_canary.source_payload_sha256,
    'Batch 1B canary commercial identity only'
  );
  if v_result is distinct from v_replay then raise exception 'promotion replay mismatch'; end if;

  select * into v_sku from public.skus where sku_code='CCSA8-90';
  select * into v_external from public.external_product_mappings where provider='ORDERMENTUM' and external_product_code='CCSA8-90';
  select count(*) into v_units from public.sku_units where sku_id=v_sku.id;
  select count(*) into v_physical from public.ecoflow_physical_skus where commercial_sku_id=v_sku.id;
  select count(*) into v_barcodes from public.ecoflow_physical_barcode_bindings;
  select count(*) into v_inventory from public.ecoflow_inventory_test_sentinel;

  if v_sku.id is null or v_external.id is null
     or v_sku.can_sell_by_carton or v_sku.can_sell_by_sleeve or v_sku.can_mix_pack
     or v_sku.default_storage_unit<>'unconfigured' or v_sku.default_pick_unit<>'unconfigured'
     or v_sku.setup_status<>'mapping_draft'
     or v_external.internal_sku_id<>v_sku.id
     or v_external.default_unit_level<>'unconfigured'
     or v_external.confidence<>'BOUNDED_COMMERCIAL_PROMOTION'
     or not v_external.is_active
     or v_units<>0 or v_physical<>0 or v_barcodes<>0 or v_inventory<>0 then
    raise exception 'commercial-only promotion boundary failed: %/%/%/%/%/%',v_sku,v_external,v_units,v_physical,v_barcodes,v_inventory;
  end if;
end $$;

-- A changed replay payload is rejected while preserving the original current
-- revision used by the successful command.
do $$
declare
  v_canary public.ecoflow_unleashed_master_mappings%rowtype;
  v_command public.ecoflow_bounded_commercial_sku_promotion_commands%rowtype;
  v_failed boolean := false;
begin
  select * into v_canary from public.ecoflow_unleashed_master_mappings where source_external_code='CCSA8-90';
  select * into v_command from public.ecoflow_bounded_commercial_sku_promotion_commands where command_id='92000000-0000-4000-8000-000000000007';
  begin
    perform public.ecoflow_promote_bounded_commercial_sku(
      '92000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000001',
      'CCSA8-90',v_canary.id,v_command.expected_revision,v_canary.source_payload_sha256,'Changed replay payload'
    );
  exception when others then
    if position('COMMAND_REPLAY_PAYLOAD_MISMATCH' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'changed promotion replay did not fail'; end if;
end $$;

-- Existing governed PLAN must now discover the newly promoted exact Ordermentum
-- code and move the Unleashed product mapping to MATCHED by the existing method.
select public.ecoflow_plan_unleashed_master_mappings(
  '10000000-0000-4000-8000-000000000001','Batch 1B canary exact-code plan'
);

do $$
declare
  v_mapping public.ecoflow_unleashed_master_mappings%rowtype;
  v_sku uuid;
  v_current bigint;
  v_audit bigint;
begin
  select * into v_mapping from public.ecoflow_unleashed_master_mappings where source_external_code='CCSA8-90';
  select id into v_sku from public.skus where sku_code='CCSA8-90';
  select count(*) into v_current
  from public.ecoflow_unleashed_master_candidates c
  where c.mapping_id=v_mapping.id and c.is_current
    and c.match_method='ORDERMENTUM_PRODUCT_CODE_EXACT'
    and c.canonical_object_id=v_sku;
  select count(*) into v_audit
  from public.app_security_audit_events a
  where a.action='BOUNDED_COMMERCIAL_SKU_PROMOTED'
    and a.after_data->>'externalProductCode'='CCSA8-90';

  if v_mapping.mapping_status<>'MATCHED'
     or v_mapping.match_method<>'ORDERMENTUM_PRODUCT_CODE_EXACT'
     or v_mapping.canonical_object_type<>'COMMERCIAL_SKU'
     or v_mapping.canonical_object_id<>v_sku
     or v_mapping.canonical_code<>'CCSA8-90'
     or v_mapping.candidate_count<>1
     or v_current<>1
     or v_audit<>1 then
    raise exception 'canary exact-code PLAN contract failed: %/%/%',v_mapping,v_current,v_audit;
  end if;

  if exists(select 1 from public.skus where sku_code='BPB8')
     or exists(select 1 from public.external_product_mappings where external_product_code='BPB8') then
    raise exception 'continuation row was promoted before canary';
  end if;
end $$;

select 'identity-unlock-batch1-b-db-contract-pass' as result;
