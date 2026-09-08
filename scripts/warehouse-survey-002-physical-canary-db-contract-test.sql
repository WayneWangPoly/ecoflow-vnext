\set ON_ERROR_STOP on

-- #338 Product Identity physical canary contract.
-- This is a synthetic canary-shaped fixture only. None of the fixture names,
-- quantities or policies are production BPB8 authority.
set app.test_role='OWNER';

insert into public._warehouse_survey_002_sku_fixture(sku,product_name,category,fixed_shelf,primary_barcode) values
  ('CANARY-BPB8','Catalog context only: 8oz Kraft Soup Bowl Carton - 250ml - 1000pcs','Bowls','C1',null),
  ('BOUND-1','Existing resolved bounded fixture','Cups','C2',null)
on conflict(sku) do update set product_name=excluded.product_name;

insert into public.skus(id,sku_code,display_name,category,setup_status) values
  ('c3380000-0000-4000-8000-000000000001','CANARY-BPB8','Catalog context only: 8oz Kraft Soup Bowl Carton - 250ml - 1000pcs','Bowls','mapping_draft');
insert into public.external_product_mappings(
  provider,external_product_code,internal_sku_id,default_unit_level,confidence,is_active
) values(
  'ORDERMENTUM','CANARY-BPB8','c3380000-0000-4000-8000-000000000001','unconfigured','BOUNDED_COMMERCIAL_PROMOTION',true
);

-- Capture one direct no-sleeve observation, one published-barcode collision, and
-- one out-of-scope observation for an already-resolved Commercial SKU.
set app.test_role='WAREHOUSE';
do $$
begin
  perform * from public.ecoflow_record_barcode_survey_observation_v3(
    '83100000-0000-4000-8000-000000000001'::uuid,
    'CANARY-BPB8','CANARY-CARTON-BPB8','OBSERVED_NOW','NO_SEPARATE_BARCODE',null,null,
    'synthetic direct physical canary evidence','warehouse-device-survey-002'
  );
  perform * from public.ecoflow_record_barcode_survey_observation_v3(
    '83100000-0000-4000-8000-000000000002'::uuid,
    'CANARY-BPB8','BOUND-CARTON-1','OBSERVED_NOW','NO_SEPARATE_BARCODE',null,null,
    'synthetic collision against previously published fixture','warehouse-device-survey-002'
  );
  perform * from public.ecoflow_record_barcode_survey_observation_v3(
    '83100000-0000-4000-8000-000000000003'::uuid,
    'BOUND-1','CANARY-OUT-OF-SCOPE','OBSERVED_NOW','NO_SEPARATE_BARCODE',null,null,
    'synthetic out-of-scope evidence','warehouse-device-survey-002'
  );
end
$$;
reset app.test_role;
set app.test_role='OWNER';

create temporary table _physical_canary_queue as
select * from public.ecoflow_read_barcode_survey_reconciliation_queue_v1(200)
where carton_barcode in ('CANARY-CARTON-BPB8','BOUND-CARTON-1','CANARY-OUT-OF-SCOPE');

do $$
declare q record;
begin
  select * into q from _physical_canary_queue where carton_barcode='CANARY-CARTON-BPB8';
  if q.queue_status<>'READY_TO_RECONCILE' or q.commercial_match_count<>1
     or q.commercial_sku_code<>'CANARY-BPB8' then
    raise exception 'synthetic canary was not uniquely READY: %',row_to_json(q);
  end if;

  select * into q from _physical_canary_queue where carton_barcode='BOUND-CARTON-1' and sku_context='CANARY-BPB8';
  if q.queue_status<>'DUPLICATE_CONFLICT' then
    raise exception 'published-barcode collision did not fail closed in queue: %',row_to_json(q);
  end if;

  select * into q from _physical_canary_queue where carton_barcode='CANARY-OUT-OF-SCOPE';
  if q.queue_status<>'READY_TO_RECONCILE' or q.commercial_sku_code<>'BOUND-1' then
    raise exception 'out-of-scope fixture did not resolve independently: %',row_to_json(q);
  end if;
end
$$;

create temporary table _physical_canary_batch as
select * from public.ecoflow_start_bounded_product_identity_batch(
  'Synthetic one-item physical canary',
  array['c3380000-0000-4000-8000-000000000001'::uuid],
  '83200000-0000-4000-8000-000000000001'::uuid
);

do $$
declare
  v_batch uuid:=(select batch_id from _physical_canary_batch);
  v_primary uuid:=(select survey_observation_id from _physical_canary_queue where carton_barcode='CANARY-CARTON-BPB8');
  v_collision uuid:=(select survey_observation_id from _physical_canary_queue where carton_barcode='BOUND-CARTON-1' and sku_context='CANARY-BPB8');
  v_out uuid:=(select survey_observation_id from _physical_canary_queue where carton_barcode='CANARY-OUT-OF-SCOPE');
  denied boolean;
begin
  if (select scoped_sku_count from _physical_canary_batch)<>1 then
    raise exception 'physical canary batch was not exactly one Commercial SKU';
  end if;

  -- Reconciliation itself is Owner/Admin-only.
  perform pg_catalog.set_config('app.test_role','WAREHOUSE',true);
  denied:=false;
  begin
    perform * from public.ecoflow_reconcile_barcode_survey_observation_v1(
      v_primary,v_batch,'83200000-0000-4000-8000-000000000002'::uuid,
      'PHY-CANARY-BPB8','Owner-confirmed physical canary',null,null,
      'FAM-CANARY-BPB8','Owner-confirmed canary family','CARTON',1000,'PROHIBITED',true,null
    );
  exception when sqlstate '42501' then denied:=true;
  end;
  if not denied then raise exception 'WAREHOUSE reconciled the physical canary'; end if;
  perform pg_catalog.set_config('app.test_role','OWNER',true);

  -- The first Commercial-family link cannot be smuggled in as a non-preferred
  -- alternative. The entire statement must roll back on this failure.
  denied:=false;
  begin
    perform * from public.ecoflow_reconcile_barcode_survey_observation_v1(
      v_primary,v_batch,'83200000-0000-4000-8000-000000000003'::uuid,
      'PHY-CANARY-BPB8','Owner-confirmed physical canary',null,null,
      'FAM-CANARY-BPB8','Owner-confirmed canary family','CARTON',1000,'PROHIBITED',false,
      'must fail before first preferred link authority exists'
    );
  exception when others then
    if sqlerrm like '%PREFERRED_PHYSICAL_SKU_REQUIRED_BEFORE_ALTERNATIVE%' then denied:=true; else raise; end if;
  end;
  if not denied then raise exception 'first-link preferred decision was bypassed'; end if;
  if exists(select 1 from public.ecoflow_physical_skus where physical_sku_code='PHY-CANARY-BPB8') then
    raise exception 'failed first-link attempt leaked a Physical SKU draft';
  end if;

  -- A READY observation for another Commercial SKU cannot cross the immutable
  -- one-SKU batch scope.
  denied:=false;
  begin
    perform * from public.ecoflow_reconcile_barcode_survey_observation_v1(
      v_out,v_batch,'83200000-0000-4000-8000-000000000004'::uuid,
      'PHY-BOUND-1','Bounded physical fixture','Fixture Brand','Fixture Supplier',
      'FAM-BOUND-1','Bounded family','CARTON',1000,'APPROVAL_REQUIRED',false,
      'must fail batch scope guard'
    );
  exception when others then
    if sqlerrm like '%PRODUCT_IDENTITY_COMMERCIAL_SKU_OUT_OF_BATCH_SCOPE%' then denied:=true; else raise; end if;
  end;
  if not denied then raise exception 'out-of-scope Survey reconciliation entered canary batch'; end if;
  if exists(select 1 from public.ecoflow_physical_barcode_bindings where barcode='CANARY-OUT-OF-SCOPE') then
    raise exception 'out-of-scope failure leaked a barcode binding';
  end if;

  -- A barcode already published by the preceding bounded golden path remains a
  -- hard collision even though this Survey row otherwise has direct evidence.
  denied:=false;
  begin
    perform * from public.ecoflow_reconcile_barcode_survey_observation_v1(
      v_collision,v_batch,'83200000-0000-4000-8000-000000000005'::uuid,
      'PHY-CANARY-COLLISION','Collision must not apply',null,null,
      'FAM-CANARY-COLLISION','Collision family','CARTON',1000,'PROHIBITED',true,null
    );
  exception when others then
    if sqlerrm like '%SURVEY_RECONCILIATION_BARCODE_ALREADY_PUBLISHED%' then denied:=true; else raise; end if;
  end;
  if not denied then raise exception 'published barcode collision was accepted'; end if;
end
$$;

-- Apply the one explicit physical payload. Values are fixture values only and
-- deliberately do not claim production BPB8 facts.
create temporary table _physical_canary_reconcile as
select * from public.ecoflow_reconcile_barcode_survey_observation_v1(
  (select survey_observation_id from _physical_canary_queue where carton_barcode='CANARY-CARTON-BPB8'),
  (select batch_id from _physical_canary_batch),
  '83300000-0000-4000-8000-000000000001'::uuid,
  'PHY-CANARY-BPB8','Owner-confirmed physical canary',null,null,
  'FAM-CANARY-BPB8','Owner-confirmed canary family','CARTON',1000,'PROHIBITED',true,
  'synthetic explicit Owner confirmation payload'
);

do $$
declare
  v_batch uuid:=(select batch_id from _physical_canary_batch);
  v_rec record:=(select r from _physical_canary_reconcile r limit 1);
  v_payload jsonb;
  v_inventory_before bigint;
  v_inventory_after bigint;
  replay record;
  existing record;
  denied boolean;
begin
  if v_rec.reconciliation_status<>'DRAFTED' or v_rec.command_status<>'APPLIED' then
    raise exception 'physical canary did not create one reviewable draft: %',row_to_json(v_rec);
  end if;
  if (select revision from public.ecoflow_product_identity_batches where id=v_batch)<>1 then
    raise exception 'physical canary capture did not advance batch revision to 1';
  end if;

  select o.payload into v_payload
  from public.ecoflow_product_identity_observations o
  where o.id=v_rec.product_identity_observation_id;
  if v_payload->>'physicalSkuCode'<>'PHY-CANARY-BPB8'
     or v_payload->>'physicalName'<>'Owner-confirmed physical canary'
     or v_payload->>'familyCode'<>'FAM-CANARY-BPB8'
     or v_payload->>'familyName'<>'Owner-confirmed canary family'
     or v_payload->>'packageLevel'<>'CARTON'
     or (v_payload->>'units')::numeric<>1000
     or v_payload->>'policy'<>'PROHIBITED'
     or (v_payload->>'preferred')::boolean is distinct from true then
    raise exception 'stored canary payload does not match the explicit confirmation: %',v_payload;
  end if;

  -- Document the incumbent bridge replay limitation: changed caller fields on
  -- the same reconciliation command return REPLAYED. Safety therefore depends
  -- on verifying the stored capture payload, which must remain unchanged.
  select * into replay
  from public.ecoflow_reconcile_barcode_survey_observation_v1(
    v_rec.survey_observation_id,v_batch,'83300000-0000-4000-8000-000000000001'::uuid,
    'CHANGED-MUST-NOT-APPLY','Changed must not apply',null,null,
    'CHANGED-FAMILY','Changed family','EACH',1,'ALLOWED',true,'changed replay'
  );
  if replay.command_status<>'REPLAYED' or replay.reconciliation_id<>v_rec.reconciliation_id then
    raise exception 'same-command Survey replay did not return the existing reconciliation';
  end if;

  select o.payload into v_payload
  from public.ecoflow_product_identity_observations o
  where o.id=v_rec.product_identity_observation_id;
  if v_payload->>'physicalSkuCode'<>'PHY-CANARY-BPB8'
     or v_payload->>'packageLevel'<>'CARTON'
     or (v_payload->>'units')::numeric<>1000
     or v_payload->>'policy'<>'PROHIBITED' then
    raise exception 'changed replay altered the stored canary payload: %',v_payload;
  end if;

  select * into existing
  from public.ecoflow_reconcile_barcode_survey_observation_v1(
    v_rec.survey_observation_id,v_batch,'83300000-0000-4000-8000-000000000002'::uuid,
    'OTHER-MUST-NOT-APPLY','Other must not apply',null,null,
    'OTHER-FAMILY','Other family','EACH',1,'ALLOWED',true,'new command same observation'
  );
  if existing.command_status<>'EXISTING' or existing.reconciliation_id<>v_rec.reconciliation_id then
    raise exception 'same Survey observation created a second physical reconciliation';
  end if;
  if (select count(*) from public.ecoflow_barcode_survey_identity_reconciliations where survey_observation_id=v_rec.survey_observation_id)<>1 then
    raise exception 'physical canary has more than one reconciliation provenance row';
  end if;

  select count(*) into v_inventory_before from public.ecoflow_inventory_movements;

  -- Stale revision must fail closed without changing batch state.
  denied:=false;
  begin
    perform * from public.ecoflow_submit_product_identity_batch(
      v_batch,0,'83400000-0000-4000-8000-000000000001'::uuid,'stale revision must fail'
    );
  exception when others then denied:=true;
  end;
  if not denied or (select batch_status from public.ecoflow_product_identity_batches where id=v_batch)<>'DRAFT' then
    raise exception 'stale submit revision did not fail closed';
  end if;

  perform * from public.ecoflow_submit_product_identity_batch(
    v_batch,1,'83400000-0000-4000-8000-000000000002'::uuid,'synthetic Owner review'
  );
  if (select batch_status from public.ecoflow_product_identity_batches where id=v_batch)<>'SUBMITTED' then
    raise exception 'physical canary did not enter SUBMITTED';
  end if;

  denied:=false;
  begin
    perform * from public.ecoflow_publish_product_identity_batch(
      v_batch,1,'83400000-0000-4000-8000-000000000003'::uuid,'stale publish revision must fail'
    );
  exception when others then denied:=true;
  end;
  if not denied or (select batch_status from public.ecoflow_product_identity_batches where id=v_batch)<>'SUBMITTED' then
    raise exception 'stale publish revision did not fail closed';
  end if;

  perform * from public.ecoflow_publish_product_identity_batch(
    v_batch,2,'83400000-0000-4000-8000-000000000004'::uuid,'synthetic bounded canary publish'
  );

  select count(*) into v_inventory_after from public.ecoflow_inventory_movements;
  if v_inventory_after<>v_inventory_before then
    raise exception 'physical canary lifecycle mutated inventory authority';
  end if;
end
$$;

-- Postflight: publication resolves exactly the stored explicit payload, activates
-- the first preferred family link, and leaves unrelated/out-of-scope facts alone.
do $$
declare
  resolved record;
  q record;
begin
  select * into resolved
  from public.ecoflow_resolve_published_physical_barcode('CANARY-CARTON-BPB8');
  if resolved.resolution_status<>'RESOLVED'
     or resolved.physical_sku_code<>'PHY-CANARY-BPB8'
     or resolved.package_level<>'CARTON'
     or resolved.units_in_base_unit<>1000 then
    raise exception 'published physical canary did not resolve exactly: %',row_to_json(resolved);
  end if;

  if not exists(
    select 1
    from public.ecoflow_commercial_family_links l
    join public.ecoflow_sku_families f on f.id=l.family_id
    join public.ecoflow_physical_skus p on p.id=l.preferred_physical_sku_id
    where l.commercial_sku_id='c3380000-0000-4000-8000-000000000001'::uuid
      and l.identity_status='ACTIVE'
      and l.substitution_policy='PROHIBITED'
      and f.family_code='FAM-CANARY-BPB8'
      and p.physical_sku_code='PHY-CANARY-BPB8'
  ) then raise exception 'first preferred Commercial-family link was not explicitly published'; end if;

  select * into q from public.ecoflow_read_barcode_survey_reconciliation_queue_v1(200)
  where carton_barcode='CANARY-CARTON-BPB8';
  if q.queue_status<>'ALREADY_RECONCILED_PUBLISHED' then
    raise exception 'physical canary queue did not close after publish: %',row_to_json(q);
  end if;

  if exists(select 1 from public.ecoflow_physical_barcode_bindings where barcode='CANARY-OUT-OF-SCOPE') then
    raise exception 'out-of-scope barcode gained canonical authority';
  end if;
  if (select count(*) from public.ecoflow_physical_barcode_bindings where barcode='BOUND-CARTON-1' and identity_status='ACTIVE')<>1 then
    raise exception 'existing published barcode collision owner changed';
  end if;
end
$$;

reset app.test_role;
