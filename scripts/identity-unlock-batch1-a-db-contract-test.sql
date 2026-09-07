\set ON_ERROR_STOP on

-- Runs after unleashed-master-data-bridge-db-contract-test.sql in the same
-- PostgreSQL 17 service. Apply the additive Batch 1A migration twice to prove
-- migration replay safety before exercising its production-shaped contract.
\ir ../supabase/migrations/20260908093000_identity_unlock_batch1_manual_warehouse_candidate.sql
\ir ../supabase/migrations/20260908093000_identity_unlock_batch1_manual_warehouse_candidate.sql

do $$
declare
  v_run uuid := '20000000-0000-4000-8000-000000000001';
  v_payload jsonb := '{"WarehouseCode":"ADL1","WarehouseName":"Main Warehouse"}'::jsonb;
begin
  insert into public.unleashed_external_identities(
    resource,external_key,external_guid,external_code,last_seen_run_id
  ) values (
    'warehouses','guid:60000000-0000-4000-8000-000000000002',
    '60000000-0000-4000-8000-000000000002','ADL1',v_run
  )
  on conflict(resource,external_key) do update set
    external_guid=excluded.external_guid,
    external_code=excluded.external_code,
    last_seen_run_id=excluded.last_seen_run_id;

  insert into public.unleashed_raw_snapshots(
    resource,external_key,payload,payload_sha256,last_seen_at
  ) values (
    'warehouses','guid:60000000-0000-4000-8000-000000000002',v_payload,
    encode(extensions.digest(v_payload::text,'sha256'),'hex'),now()
  )
  on conflict(resource,external_key) do update set
    payload=excluded.payload,
    payload_sha256=excluded.payload_sha256,
    last_seen_at=excluded.last_seen_at;
end $$;

select public.ecoflow_plan_unleashed_master_mappings(
  '10000000-0000-4000-8000-000000000001','Batch 1A ADL1 baseline plan'
);

-- Baseline must remain UNMATCHED. The new mechanism adds no implicit authority.
do $$
declare
  v_mapping public.ecoflow_unleashed_master_mappings%rowtype;
  v_current bigint;
begin
  select * into v_mapping
  from public.ecoflow_unleashed_master_mappings
  where entity_type='WAREHOUSE' and source_external_code='ADL1';
  select count(*) into v_current
  from public.ecoflow_unleashed_master_candidates c
  where c.mapping_id=v_mapping.id and c.is_current;

  if v_mapping.mapping_status<>'UNMATCHED'
     or v_mapping.candidate_count<>0
     or v_mapping.canonical_object_id is not null
     or v_mapping.revision<>0
     or v_current<>0 then
    raise exception 'ADL1 baseline was not fail-closed: %/%/%/%/%',
      v_mapping.mapping_status,v_mapping.candidate_count,
      v_mapping.canonical_object_id,v_mapping.revision,v_current;
  end if;
end $$;

-- The command surface is server-side only; the PLAN core cannot be called by
-- service_role to bypass manual-candidate refresh.
do $$
begin
  if has_function_privilege(
      'authenticated',
      'public.ecoflow_add_unleashed_manual_warehouse_candidate(uuid,uuid,uuid,bigint,text,text,text,text)',
      'EXECUTE'
    ) then
    raise exception 'authenticated role unexpectedly has manual candidate EXECUTE';
  end if;
  if not has_function_privilege(
      'service_role',
      'public.ecoflow_add_unleashed_manual_warehouse_candidate(uuid,uuid,uuid,bigint,text,text,text,text)',
      'EXECUTE'
    ) then
    raise exception 'service_role missing manual candidate EXECUTE';
  end if;
  if has_function_privilege(
      'service_role',
      'public.ecoflow_plan_unleashed_master_mappings_core(uuid,text)',
      'EXECUTE'
    ) then
    raise exception 'service_role can bypass PLAN wrapper';
  end if;
  if has_table_privilege('authenticated','public.ecoflow_unleashed_manual_mapping_candidates','INSERT')
     or has_table_privilege('service_role','public.ecoflow_unleashed_manual_mapping_candidates','INSERT') then
    raise exception 'manual candidate table unexpectedly directly writable';
  end if;
end $$;

-- Viewer/non-Owner calls fail even through the privileged command function.
do $$
declare
  v_mapping uuid;
  v_hash text;
  v_failed boolean := false;
begin
  select m.id,m.source_payload_sha256 into v_mapping,v_hash
  from public.ecoflow_unleashed_master_mappings m
  where m.entity_type='WAREHOUSE' and m.source_external_code='ADL1';

  begin
    perform public.ecoflow_add_unleashed_manual_warehouse_candidate(
      '81000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002',
      v_mapping,0,v_hash,'ADL1','MAIN','Viewer must be rejected'
    );
  exception when others then
    if position('MANUAL_WAREHOUSE_CANDIDATE_FORBIDDEN' in sqlerrm)>0 then
      v_failed:=true;
    else
      raise;
    end if;
  end;
  if not v_failed then raise exception 'viewer manual candidate request did not fail'; end if;
end $$;

-- The production-frozen scope is literal: no other source or target code can
-- pass the command contract.
do $$
declare
  v_mapping uuid;
  v_hash text;
  v_failed_source boolean := false;
  v_failed_target boolean := false;
begin
  select m.id,m.source_payload_sha256 into v_mapping,v_hash
  from public.ecoflow_unleashed_master_mappings m
  where m.entity_type='WAREHOUSE' and m.source_external_code='ADL1';

  begin
    perform public.ecoflow_add_unleashed_manual_warehouse_candidate(
      '81000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000001',
      v_mapping,0,v_hash,'OTHER','MAIN','Wrong source must fail'
    );
  exception when others then
    if position('MANUAL_WAREHOUSE_CANDIDATE_INVALID' in sqlerrm)>0 then
      v_failed_source:=true;
    else
      raise;
    end if;
  end;

  begin
    perform public.ecoflow_add_unleashed_manual_warehouse_candidate(
      '81000000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000001',
      v_mapping,0,v_hash,'ADL1','OTHER','Wrong target must fail'
    );
  exception when others then
    if position('MANUAL_WAREHOUSE_CANDIDATE_INVALID' in sqlerrm)>0 then
      v_failed_target:=true;
    else
      raise;
    end if;
  end;

  if not v_failed_source or not v_failed_target then
    raise exception 'frozen ADL1->MAIN boundary was not enforced';
  end if;
end $$;

-- Authorise exactly ADL1 -> MAIN. This creates a review candidate only: the
-- master mapping remains UNMATCHED and receives no canonical target until the
-- existing review command separately accepts the candidate.
do $$
declare
  v_mapping public.ecoflow_unleashed_master_mappings%rowtype;
  v_hash text;
  v_result jsonb;
  v_replay jsonb;
  v_candidate public.ecoflow_unleashed_master_candidates%rowtype;
  v_main uuid;
begin
  select * into v_mapping
  from public.ecoflow_unleashed_master_mappings m
  where m.entity_type='WAREHOUSE' and m.source_external_code='ADL1';
  v_hash := v_mapping.source_payload_sha256;
  select w.id into v_main from public.warehouses w where w.warehouse_code='MAIN';

  v_result := public.ecoflow_add_unleashed_manual_warehouse_candidate(
    '81000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000001',
    v_mapping.id,0,v_hash,'ADL1','MAIN','Owner confirms ADL1 is the MAIN warehouse'
  );
  v_replay := public.ecoflow_add_unleashed_manual_warehouse_candidate(
    '81000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000001',
    v_mapping.id,0,v_hash,'ADL1','MAIN','Owner confirms ADL1 is the MAIN warehouse'
  );

  select * into v_mapping
  from public.ecoflow_unleashed_master_mappings m where m.id=v_mapping.id;
  select * into v_candidate
  from public.ecoflow_unleashed_master_candidates c
  where c.mapping_id=v_mapping.id
    and c.match_method='OWNER_ADMIN_MANUAL_WAREHOUSE'
    and c.is_current;

  if v_result is distinct from v_replay
     or (v_result->>'revision')::bigint<>1
     or v_mapping.revision<>1
     or v_mapping.mapping_status<>'UNMATCHED'
     or v_mapping.canonical_object_id is not null
     or v_candidate.canonical_object_type<>'WAREHOUSE'
     or v_candidate.canonical_object_id<>v_main
     or v_candidate.canonical_code<>'MAIN'
     or v_candidate.ordermentum_external_id is not null then
    raise exception 'bounded manual candidate authority contract failed: %/%/%/%/%',
      v_result,v_mapping.revision,v_mapping.mapping_status,v_mapping.canonical_object_id,v_candidate;
  end if;
end $$;

-- Re-running the normal PLAN must not erase the authorised candidate.
select public.ecoflow_plan_unleashed_master_mappings(
  '10000000-0000-4000-8000-000000000001','Batch 1A authorised replay plan'
);

do $$
declare
  v_mapping public.ecoflow_unleashed_master_mappings%rowtype;
  v_candidate_count bigint;
  v_manual_count bigint;
begin
  select * into v_mapping
  from public.ecoflow_unleashed_master_mappings m
  where m.entity_type='WAREHOUSE' and m.source_external_code='ADL1';
  select count(*),count(*) filter (where c.match_method='OWNER_ADMIN_MANUAL_WAREHOUSE')
  into v_candidate_count,v_manual_count
  from public.ecoflow_unleashed_master_candidates c
  where c.mapping_id=v_mapping.id and c.is_current;

  if v_mapping.revision<>1
     or v_mapping.mapping_status<>'UNMATCHED'
     or v_candidate_count<>1
     or v_manual_count<>1 then
    raise exception 'PLAN erased or promoted manual candidate: %/%/%/%',
      v_mapping.revision,v_mapping.mapping_status,v_candidate_count,v_manual_count;
  end if;
end $$;

-- Source payload drift invalidates the manual candidate automatically. No fuzzy
-- or display-name inference is permitted to preserve it.
do $$
declare
  v_mapping public.ecoflow_unleashed_master_mappings%rowtype;
  v_current bigint;
begin
  update public.unleashed_raw_snapshots s set
    payload=s.payload||'{"AddressLine1":"changed"}'::jsonb,
    payload_sha256=encode(extensions.digest(
      (s.payload||'{"AddressLine1":"changed"}'::jsonb)::text,'sha256'
    ),'hex'),
    last_seen_at=now()
  where s.resource='warehouses'
    and s.external_key='guid:60000000-0000-4000-8000-000000000002';

  perform public.ecoflow_plan_unleashed_master_mappings(
    '10000000-0000-4000-8000-000000000001','Batch 1A source drift plan'
  );

  select * into v_mapping
  from public.ecoflow_unleashed_master_mappings m
  where m.entity_type='WAREHOUSE' and m.source_external_code='ADL1';
  select count(*) into v_current
  from public.ecoflow_unleashed_master_candidates c
  where c.mapping_id=v_mapping.id
    and c.match_method='OWNER_ADMIN_MANUAL_WAREHOUSE'
    and c.is_current;

  if v_mapping.revision<>2
     or v_mapping.mapping_status<>'UNMATCHED'
     or v_current<>0 then
    raise exception 'source drift did not invalidate manual candidate: %/%/%',
      v_mapping.revision,v_mapping.mapping_status,v_current;
  end if;
end $$;

-- The package is identity-only. There is deliberately no Physical SKU,
-- packaging, barcode, inventory, location, opening-balance, or cutover write.
select 'identity-unlock-batch1-a-db-contract-pass' as result;
