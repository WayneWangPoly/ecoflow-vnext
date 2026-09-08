\set ON_ERROR_STOP on

-- #338 Physical Identity canary contract.
-- This is a PostgreSQL fixture only. It proves the incumbent bounded Product
-- Identity authority can carry one Survey-backed first identity from explicit
-- Owner inputs through publish without adding a new production RPC or touching
-- inventory quantity authority. No production BPB8 facts are encoded here.

-- Make a fixture SKU visible to the Survey context validator and Commercial
-- identity matcher. Names/units below are deliberately synthetic test values.
insert into public._warehouse_survey_002_sku_fixture(
  sku,product_name,category,fixed_shelf,primary_barcode
) values(
  'BPB8','BPB8 canary fixture product','Fixture','Z9',null
);

insert into public.skus(id,sku_code,display_name,category,setup_status) values
  ('aaaaaaaa-0000-4000-8000-000000000010','BPB8','BPB8 canary fixture product','Fixture','active');
insert into public.external_product_mappings(
  provider,external_product_code,internal_sku_id,default_unit_level,confidence,is_active
) values(
  'ORDERMENTUM','BPB8','aaaaaaaa-0000-4000-8000-000000000010','unconfigured','BOUNDED_COMMERCIAL_PROMOTION',true
);

set app.test_role='WAREHOUSE';
do $$
begin
  perform * from public.ecoflow_record_barcode_survey_observation_v3(
    '83800000-0000-4000-8000-000000000001'::uuid,
    'BPB8',
    'FIXTURE-BPB8-CARTON',
    'OBSERVED_NOW',
    'NO_SEPARATE_BARCODE',
    null,
    null,
    'Physical canary contract fixture only',
    'warehouse-device-bpb8-canary-contract'
  );
end
$$;
reset app.test_role;
set app.test_role='OWNER';

-- The direct physical observation must be independently READY before any batch
-- or draft authority is created.
do $$
declare queued record;
begin
  select * into queued
  from public.ecoflow_read_barcode_survey_reconciliation_queue_v1(100)
  where sku_context='BPB8' and carton_barcode='FIXTURE-BPB8-CARTON'
  order by survey_occurred_at desc limit 1;

  if queued.queue_status<>'READY_TO_RECONCILE'
     or queued.commercial_match_count<>1
     or queued.commercial_sku_id<>'aaaaaaaa-0000-4000-8000-000000000010'::uuid then
    raise exception 'BPB8 fixture did not enter READY_TO_RECONCILE uniquely: %',row_to_json(queued);
  end if;
end
$$;

create temporary table _bpb8_canary_batch as
select * from public.ecoflow_start_bounded_product_identity_batch(
  'BPB8 single-item physical canary fixture',
  array['aaaaaaaa-0000-4000-8000-000000000010'::uuid],
  '83800000-0000-4000-8000-000000000002'::uuid
);

do $$
declare
  v_batch uuid:=(select batch_id from _bpb8_canary_batch);
  denied boolean:=false;
begin
  if (select command_status from _bpb8_canary_batch)<>'APPLIED'
     or (select scoped_sku_count from _bpb8_canary_batch)<>1 then
    raise exception 'BPB8 bounded start was not exactly one applied SKU';
  end if;

  if (select count(*) from public.ecoflow_product_identity_batch_scope_items where batch_id=v_batch)<>1 then
    raise exception 'BPB8 bounded scope evidence is not exactly one row';
  end if;

  -- A first Commercial-family capture cannot be an alternative. This call is
  -- caught in a subtransaction and must leave no partial DRAFT authority.
  begin
    perform * from public.ecoflow_reconcile_barcode_survey_observation_v1(
      (select id from public.ecoflow_barcode_survey_observations
       where sku_context='BPB8' and carton_barcode='FIXTURE-BPB8-CARTON'
       order by occurred_at desc limit 1),
      v_batch,
      '83800000-0000-4000-8000-000000000003'::uuid,
      'PHY-BPB8-CANARY-FIXTURE','BPB8 fixture physical',null,null,
      'FAM-BPB8-CANARY-FIXTURE','BPB8 fixture family',
      'CARTON',12,'PROHIBITED',false,'must fail: first link is not preferred'
    );
  exception when others then
    if sqlerrm like '%PREFERRED_PHYSICAL_SKU_REQUIRED_BEFORE_ALTERNATIVE%' then
      denied:=true;
    else
      raise;
    end if;
  end;
  if not denied then raise exception 'first BPB8 family link accepted is_preferred=false'; end if;

  if exists(select 1 from public.ecoflow_barcode_survey_identity_reconciliations r
            where r.survey_observation_id=(select id from public.ecoflow_barcode_survey_observations
              where sku_context='BPB8' and carton_barcode='FIXTURE-BPB8-CARTON'
              order by occurred_at desc limit 1))
     or exists(select 1 from public.ecoflow_physical_skus p where p.created_in_batch_id=v_batch)
     or exists(select 1 from public.ecoflow_sku_families f where f.created_in_batch_id=v_batch)
     or exists(select 1 from public.ecoflow_physical_barcode_bindings b where b.created_in_batch_id=v_batch)
     or exists(select 1 from public.ecoflow_commercial_family_links l where l.created_in_batch_id=v_batch) then
    raise exception 'failed first-link attempt left partial Product Identity authority';
  end if;
end
$$;

-- Apply the same single observation with a complete explicit first-identity
-- payload. The values are synthetic and prove shape/authority only.
do $$
declare
  v_batch uuid:=(select batch_id from _bpb8_canary_batch);
  rec record;
  replay record;
  stored jsonb;
  before_inventory bigint;
  after_inventory bigint;
begin
  select count(*) into before_inventory from public.ecoflow_inventory_movements;

  select * into rec
  from public.ecoflow_reconcile_barcode_survey_observation_v1(
    (select id from public.ecoflow_barcode_survey_observations
     where sku_context='BPB8' and carton_barcode='FIXTURE-BPB8-CARTON'
     order by occurred_at desc limit 1),
    v_batch,
    '83800000-0000-4000-8000-000000000004'::uuid,
    'PHY-BPB8-CANARY-FIXTURE','BPB8 fixture physical',null,null,
    'FAM-BPB8-CANARY-FIXTURE','BPB8 fixture family',
    'CARTON',12,'PROHIBITED',true,
    'Explicit synthetic first-identity fixture'
  );

  if rec.reconciliation_status<>'DRAFTED' or rec.command_status<>'APPLIED' then
    raise exception 'BPB8 bounded Survey reconciliation did not draft: %',row_to_json(rec);
  end if;

  select o.payload into stored
  from public.ecoflow_product_identity_observations o
  where o.id=rec.product_identity_observation_id;

  if stored->>'physicalSkuCode'<>'PHY-BPB8-CANARY-FIXTURE'
     or stored->>'physicalName'<>'BPB8 fixture physical'
     or stored->>'familyCode'<>'FAM-BPB8-CANARY-FIXTURE'
     or stored->>'familyName'<>'BPB8 fixture family'
     or stored->>'packageLevel'<>'CARTON'
     or (stored->>'units')::numeric<>12
     or stored->>'policy'<>'PROHIBITED'
     or (stored->>'preferred')::boolean is distinct from true
     or stored->>'barcode'<>'FIXTURE-BPB8-CARTON' then
    raise exception 'stored first-identity payload differs from explicit input: %',stored;
  end if;

  if exists(select 1 from public.ecoflow_physical_sku_packages pk
            where pk.created_in_batch_id=v_batch and pk.units_in_base_unit<>12)
     or not exists(select 1 from public.ecoflow_commercial_family_links l
                   where l.created_in_batch_id=v_batch and l.identity_status='DRAFT'
                     and l.substitution_policy='PROHIBITED') then
    raise exception 'BPB8 draft package/link did not preserve explicit payload';
  end if;

  -- The reconciliation wrapper intentionally returns REPLAYED before comparing
  -- every caller field. Prove an uncertain retry cannot mutate the authoritative
  -- stored Product Identity payload; production pre/postflight must compare it.
  select * into replay
  from public.ecoflow_reconcile_barcode_survey_observation_v1(
    rec.survey_observation_id,
    v_batch,
    '83800000-0000-4000-8000-000000000004'::uuid,
    'CHANGED-REPLAY-MUST-NOT-WRITE','Changed replay',null,null,
    'CHANGED-FAMILY','Changed family','EACH',99,'ALLOWED',true,'changed replay'
  );
  if replay.command_status<>'REPLAYED' then
    raise exception 'same reconciliation command did not replay';
  end if;
  if (select o.payload from public.ecoflow_product_identity_observations o where o.id=rec.product_identity_observation_id)<>stored then
    raise exception 'reconciliation replay mutated the stored Product Identity payload';
  end if;

  select count(*) into after_inventory from public.ecoflow_inventory_movements;
  if after_inventory<>before_inventory then
    raise exception 'BPB8 bounded Survey draft mutated inventory';
  end if;
end
$$;

-- Revision-fenced submit and Owner publish must activate exactly the one bounded
-- first identity, resolve it canonically, and preserve inventory isolation.
do $$
declare
  v_batch uuid:=(select batch_id from _bpb8_canary_batch);
  v_revision bigint;
  submitted record;
  published record;
  resolved record;
  queued record;
  inventory_count bigint;
begin
  select revision into v_revision from public.ecoflow_product_identity_batches where id=v_batch;
  if v_revision<>1 then raise exception 'BPB8 draft expected revision 1, got %',v_revision; end if;

  select * into submitted from public.ecoflow_submit_product_identity_batch(
    v_batch,v_revision,'83800000-0000-4000-8000-000000000005'::uuid,
    'Synthetic BPB8 canary fixture submitted'
  );
  if submitted.batch_status<>'SUBMITTED' or submitted.command_status<>'APPLIED' then
    raise exception 'BPB8 bounded batch did not submit: %',row_to_json(submitted);
  end if;

  select revision into v_revision from public.ecoflow_product_identity_batches where id=v_batch;
  if v_revision<>2 then raise exception 'BPB8 submitted expected revision 2, got %',v_revision; end if;

  select * into published from public.ecoflow_publish_product_identity_batch(
    v_batch,v_revision,'83800000-0000-4000-8000-000000000006'::uuid,
    'Synthetic BPB8 canary fixture published'
  );
  if published.batch_status<>'PUBLISHED'
     or published.command_status<>'APPLIED'
     or published.published_families<>1
     or published.published_physical_skus<>1
     or published.published_barcodes<>1
     or published.published_links<>1 then
    raise exception 'BPB8 bounded publish count mismatch: %',row_to_json(published);
  end if;

  select * into resolved
  from public.ecoflow_resolve_published_physical_barcode('FIXTURE-BPB8-CARTON');
  if resolved.resolution_status<>'RESOLVED'
     or resolved.physical_sku_code<>'PHY-BPB8-CANARY-FIXTURE'
     or resolved.package_level<>'CARTON'
     or resolved.units_in_base_unit<>12 then
    raise exception 'BPB8 fixture did not resolve to its explicit physical payload: %',row_to_json(resolved);
  end if;

  select * into queued
  from public.ecoflow_read_barcode_survey_reconciliation_queue_v1(100)
  where sku_context='BPB8' and carton_barcode='FIXTURE-BPB8-CARTON'
  order by survey_occurred_at desc limit 1;
  if queued.queue_status<>'ALREADY_RECONCILED_PUBLISHED' then
    raise exception 'BPB8 fixture queue did not close after publish: %',row_to_json(queued);
  end if;

  select count(*) into inventory_count from public.ecoflow_inventory_movements;
  if inventory_count<>1 then raise exception 'BPB8 canary path changed inventory authority'; end if;

  if exists(select 1 from public.ecoflow_product_identity_tasks t
            where t.batch_id=v_batch and t.blocking and t.task_status in ('OPEN','CONFLICT')) then
    raise exception 'BPB8 published batch retained a blocking task';
  end if;
end
$$;

reset app.test_role;
