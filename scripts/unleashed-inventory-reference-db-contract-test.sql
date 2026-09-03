\set ON_ERROR_STOP on

do $$
declare v_role text;
begin
  foreach v_role in array array['anon','authenticated','service_role'] loop
    if not exists(select 1 from pg_roles where rolname=v_role) then
      execute format('create role %I nologin',v_role);
    end if;
  end loop;
end $$;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists auth;

create table public.test_auth_users(id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable
as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;

create table public.app_user_profiles(
  user_id uuid primary key,
  app_role text not null,
  is_active boolean not null default true,
  team_status text not null default 'ACTIVE'
);
create or replace function public.ecoflow_active_app_role() returns text
language sql stable security definer set search_path=pg_catalog,public
as $$
  select p.app_role from public.app_user_profiles p
  where p.user_id=auth.uid() and p.is_active and p.team_status='ACTIVE'
$$;
create table public.app_security_audit_events(
  id uuid primary key default extensions.gen_random_uuid(),
  actor_user_id uuid,
  actor_role text,
  action text not null,
  target_type text,
  target_id text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create table public.unleashed_sync_runs(
  id uuid primary key,
  run_type text not null,
  status text not null,
  resource_set text[] not null,
  requested_by uuid,
  created_at timestamptz not null default now()
);
create table public.unleashed_sync_batches(
  id uuid primary key default extensions.gen_random_uuid(),
  run_id uuid not null references public.unleashed_sync_runs(id),
  resource text not null,
  status text not null,
  unique(run_id,resource)
);
create table public.unleashed_raw_snapshots(
  id uuid primary key,
  resource text not null,
  external_key text not null,
  payload jsonb not null,
  payload_sha256 text not null,
  source_last_modified_at timestamptz,
  last_seen_run_id uuid references public.unleashed_sync_runs(id),
  last_seen_at timestamptz not null,
  unique(resource,external_key)
);

create table public.warehouses(
  id uuid primary key,
  warehouse_code text not null unique
);
create table public.skus(
  id uuid primary key,
  sku_code text not null unique
);

-- Exact #338 columns consumed by 339A. The new migration must fail its
-- dependency preflight if this authority is absent; it never creates a
-- replacement mapping table.
create table public.ecoflow_unleashed_master_mappings(
  id uuid primary key default extensions.gen_random_uuid(),
  entity_type text not null,
  mapping_status text not null,
  source_external_guid text,
  canonical_object_type text,
  canonical_object_id uuid,
  canonical_code text,
  source_duplicate_count integer not null default 1,
  candidate_count integer not null default 0
);

create table public.ecoflow_sku_families(
  id uuid primary key,
  family_code text not null,
  family_name text not null,
  identity_status text not null
);
create table public.ecoflow_physical_skus(
  id uuid primary key,
  physical_sku_code text not null,
  family_id uuid not null references public.ecoflow_sku_families(id),
  identity_status text not null
);
create table public.ecoflow_commercial_family_links(
  id uuid primary key,
  commercial_sku_id uuid not null references public.skus(id),
  family_id uuid not null references public.ecoflow_sku_families(id),
  preferred_physical_sku_id uuid not null references public.ecoflow_physical_skus(id),
  substitution_policy text not null,
  identity_status text not null
);

create table public.ecoflow_warehouse_location_items(id uuid primary key);
create table public.ecoflow_warehouse_movements(id uuid primary key);
create table public.ecoflow_inventory_movements(id uuid primary key);
create table public.ecoflow_stocktake_sessions(id uuid primary key);

\ir ../supabase/migrations/20260903170435_unleashed_inventory_reference.sql

insert into public.app_user_profiles(user_id,app_role,is_active,team_status) values
  ('10000000-0000-4000-8000-000000000001','OWNER',true,'ACTIVE'),
  ('10000000-0000-4000-8000-000000000002','WAREHOUSE',true,'ACTIVE'),
  ('10000000-0000-4000-8000-000000000003','ADMIN',true,'ACTIVE');

insert into public.warehouses(id,warehouse_code) values
  ('40000000-0000-4000-8000-000000000001','MAIN');
insert into public.skus(id,sku_code) values
  ('30000000-0000-4000-8000-000000000001','READY-SKU'),
  ('30000000-0000-4000-8000-000000000002','NO-PHYSICAL-SKU');
insert into public.ecoflow_sku_families(id,family_code,family_name,identity_status) values
  ('50000000-0000-4000-8000-000000000001','READY-FAMILY','Ready family','ACTIVE');
insert into public.ecoflow_physical_skus(id,physical_sku_code,family_id,identity_status) values
  ('51000000-0000-4000-8000-000000000001','READY-PHYSICAL',
   '50000000-0000-4000-8000-000000000001','ACTIVE');
insert into public.ecoflow_commercial_family_links(
  id,commercial_sku_id,family_id,preferred_physical_sku_id,substitution_policy,identity_status
) values (
  '52000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001',
  'APPROVAL_REQUIRED','ACTIVE'
);

insert into public.ecoflow_unleashed_master_mappings(
  id,entity_type,mapping_status,source_external_guid,canonical_object_type,
  canonical_object_id,canonical_code,source_duplicate_count,candidate_count
) values
  ('60000000-0000-4000-8000-000000000001','PRODUCT','MATCHED','P-READY','COMMERCIAL_SKU',
   '30000000-0000-4000-8000-000000000001','READY-SKU',1,1),
  ('60000000-0000-4000-8000-000000000002','PRODUCT','MATCHED','P-NO-PHYSICAL','COMMERCIAL_SKU',
   '30000000-0000-4000-8000-000000000002','NO-PHYSICAL-SKU',1,1),
  ('60000000-0000-4000-8000-000000000003','PRODUCT','AMBIGUOUS','P-AMBIGUOUS',null,null,null,2,2),
  ('60000000-0000-4000-8000-000000000004','PRODUCT','UNMATCHED','P-UNMATCHED',null,null,null,1,0),
  ('61000000-0000-4000-8000-000000000001','WAREHOUSE','MATCHED','W-MAIN','WAREHOUSE',
   '40000000-0000-4000-8000-000000000001','MAIN',1,1),
  ('61000000-0000-4000-8000-000000000002','WAREHOUSE','AMBIGUOUS','W-AMBIGUOUS',null,null,null,2,2);

insert into public.unleashed_sync_runs(id,run_type,status,resource_set,requested_by) values
  ('20000000-0000-4000-8000-000000000001','BOUNDED_SNAPSHOT','SUCCEEDED',array['stock_on_hand'],
   '10000000-0000-4000-8000-000000000001');
insert into public.unleashed_sync_batches(run_id,resource,status) values
  ('20000000-0000-4000-8000-000000000001','stock_on_hand','SUCCEEDED');

insert into public.unleashed_raw_snapshots(
  id,resource,external_key,payload,payload_sha256,source_last_modified_at,last_seen_run_id,last_seen_at
)
select
  x.id,'stock_on_hand',x.external_key,x.payload,
  encode(extensions.digest(x.payload::text,'sha256'),'hex'),
  '2026-09-03 10:00:00+00'::timestamptz,
  '20000000-0000-4000-8000-000000000001'::uuid,
  '2026-09-03 11:00:00+00'::timestamptz
from (values
  ('70000000-0000-4000-8000-000000000001'::uuid,'ready-main',
   '{"ProductGuid":"P-READY","ProductCode":"READY","WarehouseId":"W-MAIN","WarehouseCode":"MAIN","QtyOnHand":10,"AllocatedQty":2,"OnPurchase":3,"AvailableQty":7}'::jsonb),
  ('70000000-0000-4000-8000-000000000002'::uuid,'pending-physical',
   '{"ProductGuid":"P-NO-PHYSICAL","ProductCode":"NO-PHYSICAL","WarehouseId":"W-MAIN","WarehouseCode":"MAIN","QtyOnHand":20,"AllocatedQty":4,"OnPurchase":5,"AvailableQty":16}'::jsonb),
  ('70000000-0000-4000-8000-000000000003'::uuid,'ambiguous-product',
   '{"ProductGuid":"P-AMBIGUOUS","ProductCode":"AMBIGUOUS","WarehouseId":"W-MAIN","WarehouseCode":"MAIN","QtyOnHand":30,"AllocatedQty":1,"OnPurchase":0,"AvailableQty":29}'::jsonb),
  ('70000000-0000-4000-8000-000000000004'::uuid,'pending-product',
   '{"ProductGuid":"P-UNMATCHED","ProductCode":"UNMATCHED","WarehouseId":"W-MAIN","WarehouseCode":"MAIN","QtyOnHand":40,"AllocatedQty":0,"OnPurchase":2,"AvailableQty":40}'::jsonb),
  ('70000000-0000-4000-8000-000000000005'::uuid,'pending-warehouse',
   '{"ProductGuid":"P-READY","ProductCode":"READY","WarehouseId":"W-UNKNOWN","WarehouseCode":"UNKNOWN","QtyOnHand":50,"AllocatedQty":0,"OnPurchase":0,"AvailableQty":50}'::jsonb),
  ('70000000-0000-4000-8000-000000000006'::uuid,'ambiguous-warehouse',
   '{"ProductGuid":"P-READY","ProductCode":"READY","WarehouseId":"W-AMBIGUOUS","WarehouseCode":"ALT","QtyOnHand":60,"AllocatedQty":10,"OnPurchase":4,"AvailableQty":50}'::jsonb)
) as x(id,external_key,payload);

create temporary table inventory_reference_test_state(key text primary key,value text not null);

select set_config('request.jwt.claim.role','service_role',false);
select set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  false
);

do $$
declare v_applied jsonb; v_replay jsonb; v_batch uuid; v_failed boolean:=false;
begin
  v_applied := public.ecoflow_stage_unleashed_inventory_reference(
    '80000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '2026-09-03 12:00:00+00','DB contract valid source set'
  );
  v_replay := public.ecoflow_stage_unleashed_inventory_reference(
    '80000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '2026-09-03 12:00:00+00','DB contract valid source set'
  );
  if v_applied is distinct from v_replay or (v_applied->>'sourceRowCount')::bigint<>6
    or v_applied->>'authorityEffect'<>'NONE' then
    raise exception 'stage replay/result mismatch: % / %',v_applied,v_replay;
  end if;
  v_batch := (v_applied->>'batchId')::uuid;
  insert into inventory_reference_test_state values('primary_batch',v_batch::text);

  begin
    perform public.ecoflow_stage_unleashed_inventory_reference(
      '80000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '2026-09-03 12:00:00+00','Changed replay reason'
    );
  exception when others then
    if position('COMMAND_REPLAY_PAYLOAD_MISMATCH' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'changed stage replay did not fail'; end if;

  v_failed:=false;
  begin
    perform public.ecoflow_stage_unleashed_inventory_reference(
      '80000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '2026-09-03 12:00:00+00','Different command same source set'
    );
  exception when others then
    if position('INVENTORY_REFERENCE_SOURCE_SET_ALREADY_STAGED' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'duplicate source set did not fail'; end if;
end $$;

do $$
declare v_batch uuid; v_counts jsonb; v_row record;
begin
  select value::uuid into v_batch from inventory_reference_test_state where key='primary_batch';
  select jsonb_object_agg(readiness_status,n) into v_counts
  from (
    select readiness_status,count(*)::bigint n
    from public.v_ecoflow_unleashed_inventory_reference_rows
    where batch_id=v_batch group by readiness_status
  ) s;
  if coalesce((v_counts->>'READY_FOR_LOCATION_EVIDENCE')::bigint,0)<>1
    or coalesce((v_counts->>'PENDING_PHYSICAL_IDENTITY')::bigint,0)<>1
    or coalesce((v_counts->>'AMBIGUOUS_PRODUCT_MAPPING')::bigint,0)<>1
    or coalesce((v_counts->>'PENDING_PRODUCT_MAPPING')::bigint,0)<>1
    or coalesce((v_counts->>'PENDING_WAREHOUSE_MAPPING')::bigint,0)<>1
    or coalesce((v_counts->>'AMBIGUOUS_WAREHOUSE_MAPPING')::bigint,0)<>1 then
    raise exception 'unexpected readiness counts: %',v_counts;
  end if;

  select * into v_row
  from public.v_ecoflow_unleashed_inventory_reference_rows
  where batch_id=v_batch and source_external_key='ready-main';
  if v_row.qty_on_hand<>10 or v_row.allocated_qty<>2 or v_row.on_purchase_qty<>3
    or v_row.available_qty_source<>7 or v_row.source_available_formula_delta<>-1
    or v_row.quantity_assigned_physical_sku_id is not null
    or v_row.quantity_assigned_location_id is not null
    or v_row.reference_quantity_scope<>'UNLEASHED_WAREHOUSE_TOTAL' then
    raise exception 'quantity/reference semantics changed: %',row_to_json(v_row);
  end if;
end $$;

-- Retention may remove raw JSON, but the durable row and source-set hash must
-- remain independently sealable.
delete from public.unleashed_raw_snapshots
where last_seen_run_id='20000000-0000-4000-8000-000000000001';

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false);
select set_config('request.jwt.claim.role','authenticated',false);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}',false);

do $$
declare v_batch uuid; v_failed boolean:=false;
begin
  select value::uuid into v_batch from inventory_reference_test_state where key='primary_batch';
  begin
    perform public.ecoflow_seal_unleashed_inventory_reference_batch(
      v_batch,0,'81000000-0000-4000-8000-000000000001','Warehouse must not seal'
    );
  exception when others then
    if position('OWNER_OR_ADMIN_REQUIRED' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'Warehouse unexpectedly sealed reference batch'; end if;
end $$;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',false);

do $$
declare v_batch uuid; v_result jsonb; v_replay jsonb; v_failed boolean:=false;
begin
  select value::uuid into v_batch from inventory_reference_test_state where key='primary_batch';
  v_result := public.ecoflow_seal_unleashed_inventory_reference_batch(
    v_batch,0,'81000000-0000-4000-8000-000000000002','Owner accepts durable reference evidence'
  );
  v_replay := public.ecoflow_seal_unleashed_inventory_reference_batch(
    v_batch,0,'81000000-0000-4000-8000-000000000002','Owner accepts durable reference evidence'
  );
  if v_result is distinct from v_replay or v_result->>'batchStatus'<>'SEALED'
    or (v_result->>'revision')::bigint<>1 then
    raise exception 'seal/replay mismatch: % / %',v_result,v_replay;
  end if;
  begin
    update public.ecoflow_unleashed_inventory_reference_rows set qty_on_hand=999
    where batch_id=v_batch;
  exception when others then
    if position('IMMUTABLE_INVENTORY_REFERENCE_ROW' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'reference row update did not fail'; end if;

  v_failed:=false;
  begin
    delete from public.ecoflow_unleashed_inventory_reference_rows where batch_id=v_batch;
  exception when others then
    if position('IMMUTABLE_INVENTORY_REFERENCE_ROW' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'reference row delete did not fail'; end if;

  v_failed:=false;
  begin
    update public.ecoflow_unleashed_inventory_reference_batches set as_at=as_at+interval '1 second'
    where id=v_batch;
  exception when others then
    if position('IMMUTABLE_INVENTORY_REFERENCE_BATCH_SOURCE' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'batch source mutation did not fail'; end if;

  v_failed:=false;
  begin
    update public.ecoflow_unleashed_inventory_reference_commands set result='{}'::jsonb
    where command_id='81000000-0000-4000-8000-000000000002';
  exception when others then
    if position('IMMUTABLE_INVENTORY_REFERENCE_COMMAND' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'command mutation did not fail'; end if;
end $$;

-- Invalid source-set contracts.
insert into public.unleashed_sync_runs(id,run_type,status,resource_set,requested_by) values
  ('20000000-0000-4000-8000-000000000010','BOUNDED_SNAPSHOT','SUCCEEDED',array['stock_on_hand'],'10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000011','BOUNDED_SNAPSHOT','SUCCEEDED',array['stock_on_hand'],'10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000012','BOUNDED_SNAPSHOT','SUCCEEDED',array['stock_on_hand'],'10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000013','BOUNDED_SNAPSHOT','SUCCEEDED',array['stock_on_hand'],'10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000014','BOUNDED_SNAPSHOT','PARTIAL',array['stock_on_hand'],'10000000-0000-4000-8000-000000000001');
insert into public.unleashed_sync_batches(run_id,resource,status)
select id,'stock_on_hand','SUCCEEDED' from public.unleashed_sync_runs where id::text like '20000000-0000-4000-8000-00000000001%';

insert into public.unleashed_raw_snapshots(
  id,resource,external_key,payload,payload_sha256,last_seen_run_id,last_seen_at
)
select id,'stock_on_hand',external_key,payload,encode(extensions.digest(payload::text,'sha256'),'hex'),run_id,observed_at
from (values
  ('70000000-0000-4000-8000-000000000010'::uuid,'missing-product-guid',
   '{"ProductCode":"BAD","WarehouseId":"W-MAIN","WarehouseCode":"MAIN","QtyOnHand":1,"AllocatedQty":0,"OnPurchase":0,"AvailableQty":1}'::jsonb,
   '20000000-0000-4000-8000-000000000010'::uuid,'2026-09-03 11:00:00+00'::timestamptz),
  ('70000000-0000-4000-8000-000000000011'::uuid,'missing-warehouse-id',
   '{"ProductGuid":"P-READY","ProductCode":"READY","WarehouseCode":"MAIN","QtyOnHand":1,"AllocatedQty":0,"OnPurchase":0,"AvailableQty":1}'::jsonb,
   '20000000-0000-4000-8000-000000000011'::uuid,'2026-09-03 11:00:00+00'::timestamptz),
  ('70000000-0000-4000-8000-000000000012'::uuid,'duplicate-a',
   '{"ProductGuid":"P-READY","ProductCode":"READY","WarehouseId":"W-MAIN","WarehouseCode":"MAIN","QtyOnHand":1,"AllocatedQty":0,"OnPurchase":0,"AvailableQty":1}'::jsonb,
   '20000000-0000-4000-8000-000000000012'::uuid,'2026-09-03 11:00:00+00'::timestamptz),
  ('70000000-0000-4000-8000-000000000013'::uuid,'duplicate-b',
   '{"ProductGuid":"P-READY","ProductCode":"READY","WarehouseId":"W-MAIN","WarehouseCode":"MAIN","QtyOnHand":2,"AllocatedQty":0,"OnPurchase":0,"AvailableQty":2}'::jsonb,
   '20000000-0000-4000-8000-000000000012'::uuid,'2026-09-03 11:00:00+00'::timestamptz),
  ('70000000-0000-4000-8000-000000000014'::uuid,'after-boundary',
   '{"ProductGuid":"P-READY","ProductCode":"READY","WarehouseId":"W-MAIN","WarehouseCode":"MAIN","QtyOnHand":1,"AllocatedQty":0,"OnPurchase":0,"AvailableQty":1}'::jsonb,
   '20000000-0000-4000-8000-000000000013'::uuid,'2026-09-03 13:00:00+00'::timestamptz),
  ('70000000-0000-4000-8000-000000000015'::uuid,'partial-run',
   '{"ProductGuid":"P-READY","ProductCode":"READY","WarehouseId":"W-MAIN","WarehouseCode":"MAIN","QtyOnHand":1,"AllocatedQty":0,"OnPurchase":0,"AvailableQty":1}'::jsonb,
   '20000000-0000-4000-8000-000000000014'::uuid,'2026-09-03 11:00:00+00'::timestamptz)
) x(id,external_key,payload,run_id,observed_at);

select set_config('request.jwt.claim.role','service_role',false);
select set_config('request.jwt.claims','{"role":"service_role"}',false);

do $$
declare
  v_case record;
  v_failed boolean;
begin
  for v_case in select * from (values
    ('20000000-0000-4000-8000-000000000010'::uuid,'82000000-0000-4000-8000-000000000010'::uuid,'INVENTORY_REFERENCE_SOURCE_ROW_INVALID'),
    ('20000000-0000-4000-8000-000000000011'::uuid,'82000000-0000-4000-8000-000000000011'::uuid,'INVENTORY_REFERENCE_SOURCE_ROW_INVALID'),
    ('20000000-0000-4000-8000-000000000012'::uuid,'82000000-0000-4000-8000-000000000012'::uuid,'INVENTORY_REFERENCE_DUPLICATE_PRODUCT_WAREHOUSE'),
    ('20000000-0000-4000-8000-000000000013'::uuid,'82000000-0000-4000-8000-000000000013'::uuid,'INVENTORY_REFERENCE_OBSERVED_AFTER_BOUNDARY'),
    ('20000000-0000-4000-8000-000000000014'::uuid,'82000000-0000-4000-8000-000000000014'::uuid,'INVENTORY_REFERENCE_SOURCE_RUN_NOT_SUCCESSFUL')
  ) c(run_id,command_id,error_code)
  loop
    v_failed:=false;
    begin
      perform public.ecoflow_stage_unleashed_inventory_reference(
        v_case.command_id,'10000000-0000-4000-8000-000000000001',v_case.run_id,
        '2026-09-03 12:00:00+00','Invalid source contract check'
      );
    exception when others then
      if position(v_case.error_code in sqlerrm)>0 then v_failed:=true; else raise; end if;
    end;
    if not v_failed then raise exception 'invalid case did not fail: %',v_case.error_code; end if;
  end loop;
end $$;

-- Governed reject and supersede transitions preserve historical evidence.
insert into public.unleashed_sync_runs(id,run_type,status,resource_set,requested_by) values
  ('20000000-0000-4000-8000-000000000020','BOUNDED_SNAPSHOT','SUCCEEDED',array['stock_on_hand'],'10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000021','BOUNDED_SNAPSHOT','SUCCEEDED',array['stock_on_hand'],'10000000-0000-4000-8000-000000000001');
insert into public.unleashed_sync_batches(run_id,resource,status) values
  ('20000000-0000-4000-8000-000000000020','stock_on_hand','SUCCEEDED'),
  ('20000000-0000-4000-8000-000000000021','stock_on_hand','SUCCEEDED');
insert into public.unleashed_raw_snapshots(
  id,resource,external_key,payload,payload_sha256,last_seen_run_id,last_seen_at
)
select id,'stock_on_hand',external_key,payload,encode(extensions.digest(payload::text,'sha256'),'hex'),run_id,observed_at
from (values
  ('70000000-0000-4000-8000-000000000020'::uuid,'later-accepted',
   '{"ProductGuid":"P-READY","ProductCode":"READY","WarehouseId":"W-MAIN","WarehouseCode":"MAIN","QtyOnHand":11,"AllocatedQty":2,"OnPurchase":3,"AvailableQty":9}'::jsonb,
   '20000000-0000-4000-8000-000000000020'::uuid,'2026-09-03 13:00:00+00'::timestamptz),
  ('70000000-0000-4000-8000-000000000021'::uuid,'rejected-candidate',
   '{"ProductGuid":"P-READY","ProductCode":"READY","WarehouseId":"W-MAIN","WarehouseCode":"MAIN","QtyOnHand":12,"AllocatedQty":2,"OnPurchase":3,"AvailableQty":10}'::jsonb,
   '20000000-0000-4000-8000-000000000021'::uuid,'2026-09-03 14:00:00+00'::timestamptz)
) x(id,external_key,payload,run_id,observed_at);

select set_config('request.jwt.claim.role','service_role',false);
select set_config('request.jwt.claims','{"role":"service_role"}',false);
do $$
declare v_later jsonb; v_reject jsonb;
begin
  v_later := public.ecoflow_stage_unleashed_inventory_reference(
    '83000000-0000-4000-8000-000000000020','10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000020','2026-09-03 14:00:00+00','Later accepted reference'
  );
  v_reject := public.ecoflow_stage_unleashed_inventory_reference(
    '83000000-0000-4000-8000-000000000021','10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000021','2026-09-03 15:00:00+00','Candidate to reject'
  );
  insert into inventory_reference_test_state values
    ('later_batch',v_later->>'batchId'),('reject_batch',v_reject->>'batchId');
end $$;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claim.role','authenticated',false);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',false);
do $$
declare v_primary uuid; v_later uuid; v_reject uuid; v_failed boolean:=false; v_result jsonb;
begin
  select value::uuid into v_primary from inventory_reference_test_state where key='primary_batch';
  select value::uuid into v_later from inventory_reference_test_state where key='later_batch';
  select value::uuid into v_reject from inventory_reference_test_state where key='reject_batch';

  perform public.ecoflow_seal_unleashed_inventory_reference_batch(
    v_later,0,'84000000-0000-4000-8000-000000000020','Accept later reference evidence'
  );
  v_result := public.ecoflow_supersede_unleashed_inventory_reference_batch(
    v_primary,v_later,1,'84000000-0000-4000-8000-000000000021','Replace older accepted reference'
  );
  if v_result->>'batchStatus'<>'SUPERSEDED' or v_result->>'supersedingBatchId'<>v_later::text then
    raise exception 'supersede result mismatch: %',v_result;
  end if;

  begin
    perform public.ecoflow_reject_unleashed_inventory_reference_batch(
      v_reject,9,'84000000-0000-4000-8000-000000000022','Wrong revision rejection'
    );
  exception when others then
    if position('INVENTORY_REFERENCE_REVISION_CONFLICT' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'revision conflict did not fail'; end if;

  v_result := public.ecoflow_reject_unleashed_inventory_reference_batch(
    v_reject,0,'84000000-0000-4000-8000-000000000023','Reject incomplete reference evidence'
  );
  if v_result->>'batchStatus'<>'REJECTED' then
    raise exception 'reject result mismatch: %',v_result;
  end if;
end $$;

do $$
declare v_batch uuid;
begin
  select value::uuid into v_batch from inventory_reference_test_state where key='primary_batch';
  if (select count(*) from public.ecoflow_unleashed_inventory_reference_batches)<>3
    or (select count(*) from public.ecoflow_unleashed_inventory_reference_rows where batch_id=v_batch)<>6
    or (select count(*) from public.ecoflow_unleashed_inventory_reference_commands)<>7 then
    raise exception 'unexpected durable batch/row/command counts';
  end if;
  if has_table_privilege('authenticated','public.ecoflow_unleashed_inventory_reference_rows','INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated','public.ecoflow_unleashed_inventory_reference_batches','INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated','public.ecoflow_unleashed_inventory_reference_commands','INSERT,UPDATE,DELETE') then
    raise exception 'authenticated retains direct DML privilege';
  end if;
  if not has_function_privilege('service_role',
      'public.ecoflow_stage_unleashed_inventory_reference(uuid,uuid,uuid,timestamptz,text)','EXECUTE')
    or has_function_privilege('authenticated',
      'public.ecoflow_stage_unleashed_inventory_reference(uuid,uuid,uuid,timestamptz,text)','EXECUTE') then
    raise exception 'stage RPC grants are not service-role-only';
  end if;
  if (select count(*) from public.ecoflow_warehouse_location_items)<>0
    or (select count(*) from public.ecoflow_warehouse_movements)<>0
    or (select count(*) from public.ecoflow_inventory_movements)<>0
    or (select count(*) from public.ecoflow_stocktake_sessions)<>0 then
    raise exception '339A created an authority effect';
  end if;
end $$;

select 'UNLEASHED_INVENTORY_REFERENCE_DB_CONTRACT_PASS' as result;
