\set ON_ERROR_STOP on

-- This contract runs after scripts/unleashed-master-data-bridge-db-contract-test.sql
-- in the same PostgreSQL 17 service. It proves the independent-review fixes
-- against the actual #354 retention mechanism and the established #338 fixture.

\ir ../supabase/migrations/20260831160000_unleashed_raw_snapshot_retention.sql
\ir ../supabase/migrations/20260901153000_unleashed_master_data_bridge_review_fixes.sql

-- 1. Durable product-asset provenance must not retain raw JSON forever.
do $$
declare
  v_identity uuid;
  v_snapshot uuid;
  v_payload_hash text;
  v_deleted bigint;
  v_asset uuid;
begin
  select i.id, s.id, s.payload_sha256
    into v_identity, v_snapshot, v_payload_hash
  from public.unleashed_external_identities i
  join public.unleashed_raw_snapshots s
    on s.resource=i.resource and s.external_key=i.external_key
  where i.resource='products'
    and i.external_key='guid:50000000-0000-4000-8000-000000000003';

  insert into public.ecoflow_unleashed_product_assets(
    identity_id,source_snapshot_id,source_payload_sha256,source_image_url,
    source_locator_sha256,source_host,asset_status,source_observed_at
  ) values(
    v_identity,v_snapshot,v_payload_hash,
    'https://unlappcdn.unleashedsoftware.com/images/retention.jpg',
    repeat('a',64),'unlappcdn.unleashedsoftware.com','PLANNED',now()-interval '15 days'
  ) returning id into v_asset;

  update public.unleashed_raw_snapshots
  set last_seen_at=now()-interval '15 days'
  where id=v_snapshot;

  select deleted_count into v_deleted
  from public.purge_expired_unleashed_raw_snapshots(500);

  if v_deleted<>1 then
    raise exception 'retention purge did not delete the planned-asset raw snapshot: %',v_deleted;
  end if;
  if exists(select 1 from public.unleashed_raw_snapshots where id=v_snapshot) then
    raise exception 'raw snapshot survived retention despite no active copy';
  end if;
  if not exists(
    select 1 from public.ecoflow_unleashed_product_assets
    where id=v_asset
      and source_snapshot_id is null
      and source_payload_sha256=v_payload_hash
      and identity_id=v_identity
  ) then
    raise exception 'durable asset provenance did not survive raw snapshot purge';
  end if;
end $$;

-- 1b. A COPY lease and retention purge must fail closed against each other.
do $$
declare
  v_identity uuid;
  v_snapshot uuid;
  v_payload_hash text;
  v_asset uuid;
  v_deleted bigint;
begin
  select i.id, s.id, s.payload_sha256
    into v_identity, v_snapshot, v_payload_hash
  from public.unleashed_external_identities i
  join public.unleashed_raw_snapshots s
    on s.resource=i.resource and s.external_key=i.external_key
  where i.resource='products'
    and i.external_key='guid:50000000-0000-4000-8000-000000000004';

  insert into public.ecoflow_unleashed_product_assets(
    identity_id,source_snapshot_id,source_payload_sha256,source_image_url,
    source_locator_sha256,source_host,asset_status,source_observed_at
  ) values(
    v_identity,v_snapshot,v_payload_hash,
    'https://unlappcdn.unleashedsoftware.com/images/copying.jpg',
    repeat('b',64),'unlappcdn.unleashedsoftware.com','COPYING',now()-interval '15 days'
  ) returning id into v_asset;

  update public.unleashed_raw_snapshots
  set last_seen_at=now()-interval '15 days'
  where id=v_snapshot;

  select deleted_count into v_deleted
  from public.purge_expired_unleashed_raw_snapshots(500);
  if v_deleted<>0 or not exists(select 1 from public.unleashed_raw_snapshots where id=v_snapshot) then
    raise exception 'retention purge crossed an active COPY lease: %',v_deleted;
  end if;

  update public.ecoflow_unleashed_product_assets
  set asset_status='PLANNED'
  where id=v_asset;

  select deleted_count into v_deleted
  from public.purge_expired_unleashed_raw_snapshots(500);
  if v_deleted<>1 or exists(select 1 from public.unleashed_raw_snapshots where id=v_snapshot) then
    raise exception 'released COPY lease did not become purgeable: %',v_deleted;
  end if;
end $$;

-- 2. An obsolete source may have a deterministic candidate, but Owner/Admin
-- must never promote it back to MATCHED.
do $$
declare
  v_run uuid := '20000000-0000-4000-8000-000000000001';
  v_sku uuid := '30000000-0000-4000-8000-000000000001';
  v_mapping uuid;
  v_candidate uuid;
  v_failed boolean := false;
  v_payload jsonb := '{"ProductCode":"RETMATCH","Obsolete":true}'::jsonb;
begin
  insert into public.external_product_mappings(provider,external_product_code,internal_sku_id,is_active)
  values('ORDERMENTUM','RETMATCH',v_sku,true)
  on conflict(provider,external_product_code)
  do update set internal_sku_id=excluded.internal_sku_id,is_active=true;

  insert into public.unleashed_external_identities(
    resource,external_key,external_guid,external_code,last_seen_run_id
  ) values(
    'products','guid:50000000-0000-4000-8000-000000000006',
    '50000000-0000-4000-8000-000000000006','RETMATCH',v_run
  ) on conflict(resource,external_key) do update set
    external_guid=excluded.external_guid,external_code=excluded.external_code,last_seen_run_id=excluded.last_seen_run_id;

  insert into public.unleashed_raw_snapshots(resource,external_key,payload,payload_sha256,last_seen_at)
  values(
    'products','guid:50000000-0000-4000-8000-000000000006',v_payload,
    encode(extensions.digest(v_payload::text,'sha256'),'hex'),now()
  ) on conflict(resource,external_key) do update set
    payload=excluded.payload,payload_sha256=excluded.payload_sha256,last_seen_at=excluded.last_seen_at;

  perform public.ecoflow_plan_unleashed_master_mappings(
    '10000000-0000-4000-8000-000000000001','Review-fix retired-source fixture'
  );

  select m.id into v_mapping
  from public.ecoflow_unleashed_master_mappings m
  where m.source_external_code='RETMATCH';
  if not exists(
    select 1 from public.ecoflow_unleashed_master_mappings m
    where m.id=v_mapping and m.mapping_status='RETIRED'
  ) then
    raise exception 'obsolete source was not planned as RETIRED';
  end if;
  select c.id into v_candidate
  from public.ecoflow_unleashed_master_candidates c
  where c.mapping_id=v_mapping and c.is_current
  limit 1;
  if v_candidate is null then
    raise exception 'retired-source fixture did not retain deterministic candidate evidence';
  end if;

  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
  begin
    perform public.ecoflow_review_unleashed_master_mapping(
      v_mapping,'a0000000-0000-4000-8000-000000000001',0,'MATCHED',v_candidate,
      'Attempted retired-source promotion'
    );
  exception when others then
    if position('RETIRED_SOURCE_CANNOT_BE_MATCHED' in sqlerrm)>0 then
      v_failed:=true;
    else
      raise;
    end if;
  end;
  if not v_failed then
    raise exception 'retired source was manually promoted to MATCHED';
  end if;
end $$;

-- 3. A stale PLAN-style update cannot erase an accepted REVIEW when source and
-- candidate hashes have not changed.
do $$
declare
  v_mapping uuid;
  v_revision bigint;
  v_reviewed_by uuid;
  v_after_revision bigint;
  v_after_reviewed_by uuid;
  v_after_source text;
begin
  select id,revision,reviewed_by
    into v_mapping,v_revision,v_reviewed_by
  from public.ecoflow_unleashed_master_mappings
  where source_external_code='NONE';

  if v_mapping is null or v_reviewed_by is null then
    raise exception 'expected reviewed NONE fixture is missing';
  end if;

  update public.ecoflow_unleashed_master_mappings
  set decision_source='AUTO',
      reviewed_by=null,
      reviewed_at=null,
      review_reason=null,
      revision=revision+1,
      updated_at=now()
  where id=v_mapping;

  select revision,reviewed_by,decision_source
    into v_after_revision,v_after_reviewed_by,v_after_source
  from public.ecoflow_unleashed_master_mappings
  where id=v_mapping;

  if v_after_revision<>v_revision
     or v_after_reviewed_by is distinct from v_reviewed_by
     or v_after_source<>'REVIEW' then
    raise exception 'stale planner update erased review authority: %/%/%',
      v_after_revision,v_after_reviewed_by,v_after_source;
  end if;
end $$;

-- 4. Missing provider GUID/code must never become empty-string authority.
do $$
declare
  v_failed boolean := false;
  v_run uuid := '20000000-0000-4000-8000-000000000001';
  v_payload jsonb := '{"CustomerName":"No explicit identifiers"}'::jsonb;
  v_status text;
begin
  begin
    insert into public.ecoflow_external_object_mappings(
      external_system,external_resource_type,external_id,
      internal_object_type,internal_object_id,internal_code,mapping_status
    ) values(
      'UNLEASHED','customers','',
      'CUSTOMER','70000000-0000-4000-8000-000000000099','BAD-BLANK','ACTIVE'
    );
  exception when check_violation then
    v_failed:=true;
  end;
  if not v_failed then
    raise exception 'blank external_id authority was accepted';
  end if;

  insert into public.unleashed_external_identities(
    resource,external_key,external_guid,external_code,last_seen_run_id
  ) values(
    'customers','key:missing-identifiers',null,null,v_run
  ) on conflict(resource,external_key) do update set
    external_guid=null,external_code=null,last_seen_run_id=excluded.last_seen_run_id;

  insert into public.unleashed_raw_snapshots(resource,external_key,payload,payload_sha256,last_seen_at)
  values(
    'customers','key:missing-identifiers',v_payload,
    encode(extensions.digest(v_payload::text,'sha256'),'hex'),now()
  ) on conflict(resource,external_key) do update set
    payload=excluded.payload,payload_sha256=excluded.payload_sha256,last_seen_at=excluded.last_seen_at;

  perform public.ecoflow_plan_unleashed_master_mappings(
    '10000000-0000-4000-8000-000000000001','Review-fix missing-identifier fixture'
  );
  select mapping_status into v_status
  from public.ecoflow_unleashed_master_mappings
  where source_external_key='key:missing-identifiers';
  if v_status<>'UNMATCHED' then
    raise exception 'missing GUID/code acquired accidental authority: %',v_status;
  end if;
end $$;

select 'UNLEASHED_MASTER_DATA_BRIDGE_REVIEW_FIXES_DB_CONTRACT_PASS' as result;
