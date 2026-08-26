\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Direct physical observation is captured by Warehouse, but reconciliation is
-- an Owner/Admin office-authority action.
-- ---------------------------------------------------------------------------
set app.test_role = 'WAREHOUSE';

do $$
declare
  observed record;
  denied boolean := false;
begin
  select * into observed
  from public.ecoflow_record_barcode_survey_observation_v3(
    '82111111-1111-4111-8111-111111111111'::uuid,
    'CUP-12W',
    'SURVEY-CARTON-12',
    'OBSERVED_NOW',
    'SCANNED',
    'SURVEY-SLEEVE-12',
    null,
    'real-world survey fixture',
    'warehouse-device-survey-002'
  );

  if observed.status <> 'APPLIED'
     or observed.evidence_source <> 'OBSERVED_NOW'
     or observed.sku_context <> 'CUP-12W' then
    raise exception 'direct Survey evidence was not captured correctly: %', row_to_json(observed);
  end if;

  begin
    perform * from public.ecoflow_read_barcode_survey_reconciliation_queue_v1(50);
  exception when sqlstate '42501' then
    denied := true;
  end;
  if not denied then
    raise exception 'WAREHOUSE unexpectedly read Owner/Admin reconciliation queue';
  end if;
end
$$;

reset app.test_role;
set app.test_role = 'OWNER';

-- ---------------------------------------------------------------------------
-- Queue classifies the direct observation as ready without guessing identity
-- fields that Survey never captured.
-- ---------------------------------------------------------------------------
do $$
declare
  queued record;
begin
  select * into queued
  from public.ecoflow_read_barcode_survey_reconciliation_queue_v1(50)
  where carton_barcode = 'SURVEY-CARTON-12';

  if queued.queue_status <> 'READY_TO_RECONCILE'
     or queued.commercial_match_count <> 1
     or queued.commercial_sku_code <> 'COM-CUP-12'
     or queued.ordermentum_sku <> 'CUP-12W' then
    raise exception 'ready Survey evidence was classified incorrectly: %', row_to_json(queued);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Reconciliation enters only the existing Product Identity DRAFT path and
-- preserves the inventory sentinel.
-- ---------------------------------------------------------------------------
do $$
declare
  batch_row record;
  rec record;
  replay record;
  existing record;
  before_inventory bigint;
  after_inventory bigint;
begin
  select count(*) into before_inventory from public.ecoflow_inventory_movements;

  select * into batch_row
  from public.ecoflow_start_product_identity_batch(
    'Survey reconciliation fixture',
    '82222222-2222-4222-8222-222222222222'::uuid
  );

  select * into rec
  from public.ecoflow_reconcile_barcode_survey_observation_v1(
    (select id from public.ecoflow_barcode_survey_observations where carton_barcode='SURVEY-CARTON-12' order by occurred_at desc limit 1),
    batch_row.batch_id,
    '82333333-3333-4333-8333-333333333333'::uuid,
    'PHY-CUP-12-SURVEY',
    '12oz White Cup - Survey Verified',
    'GreenPack',
    'Supplier A',
    'FAM-CUP-12',
    '12oz Compatible Cups',
    'CARTON',
    1000,
    'ALLOWED',
    true,
    'Owner confirmed physical identity from Survey evidence'
  );

  if rec.reconciliation_status <> 'DRAFTED'
     or rec.command_status <> 'APPLIED'
     or rec.barcode <> 'SURVEY-CARTON-12' then
    raise exception 'Survey reconciliation did not create a Product Identity draft: %', row_to_json(rec);
  end if;

  if not exists (
    select 1
    from public.ecoflow_product_identity_observations o
    where o.id = rec.product_identity_observation_id
      and o.observation_status = 'DRAFTED'
      and o.barcode = 'SURVEY-CARTON-12'
  ) then
    raise exception 'reconciliation did not preserve Product Identity observation provenance';
  end if;

  if not exists (
    select 1
    from public.ecoflow_barcode_survey_identity_reconciliations r
    where r.survey_observation_id = rec.survey_observation_id
      and r.product_identity_observation_id = rec.product_identity_observation_id
      and r.reconciled_role = 'OWNER'
  ) then
    raise exception 'Survey-to-Product-Identity provenance row missing';
  end if;

  select * into replay
  from public.ecoflow_reconcile_barcode_survey_observation_v1(
    rec.survey_observation_id,
    batch_row.batch_id,
    '82333333-3333-4333-8333-333333333333'::uuid,
    'PHY-CUP-12-SURVEY','12oz White Cup - Survey Verified','GreenPack','Supplier A',
    'FAM-CUP-12','12oz Compatible Cups','CARTON',1000,'ALLOWED',true,'replay'
  );
  if replay.command_status <> 'REPLAYED' or replay.reconciliation_id <> rec.reconciliation_id then
    raise exception 'same reconciliation command was not idempotent';
  end if;

  select * into existing
  from public.ecoflow_reconcile_barcode_survey_observation_v1(
    rec.survey_observation_id,
    batch_row.batch_id,
    '82444444-4444-4444-8444-444444444444'::uuid,
    'DIFFERENT-SHOULD-NOT-APPLY','Different should not apply',null,null,
    'DIFFERENT-FAMILY','Different family','EACH',1,'PROHIBITED',true,'must return existing'
  );
  if existing.command_status <> 'EXISTING' or existing.reconciliation_id <> rec.reconciliation_id then
    raise exception 'same Survey observation created more than one reconciliation';
  end if;

  select count(*) into after_inventory from public.ecoflow_inventory_movements;
  if after_inventory <> before_inventory then
    raise exception 'Survey reconciliation mutated inventory';
  end if;
end
$$;

-- Warehouse cannot use the reconciliation wrapper even though the underlying
-- Product Identity capture authority intentionally permits warehouse evidence.
set app.test_role = 'WAREHOUSE';
do $$
declare denied boolean := false;
begin
  begin
    perform * from public.ecoflow_reconcile_barcode_survey_observation_v1(
      (select id from public.ecoflow_barcode_survey_observations where carton_barcode='SURVEY-CARTON-12' limit 1),
      (select id from public.ecoflow_product_identity_batches where batch_status='DRAFT' limit 1),
      '82555555-5555-4555-8555-555555555555'::uuid,
      'PHY-NO','Denied',null,null,'FAM-NO','Denied','CARTON',1,'PROHIBITED',true,null
    );
  exception when sqlstate '42501' then denied := true;
  end;
  if not denied then raise exception 'WAREHOUSE unexpectedly reconciled Survey evidence'; end if;
end
$$;
reset app.test_role;
set app.test_role = 'OWNER';

-- ---------------------------------------------------------------------------
-- Owner publication makes the real Survey carton barcode canonical and leaves
-- the inventory sentinel untouched.
-- ---------------------------------------------------------------------------
do $$
declare
  batch_id uuid;
  batch_revision bigint;
  submitted record;
  published record;
  resolved record;
  queued record;
  inventory_count bigint;
begin
  select b.id, b.revision into batch_id, batch_revision
  from public.ecoflow_product_identity_batches b
  where b.batch_status='DRAFT'
  order by b.created_at desc limit 1;

  select * into submitted
  from public.ecoflow_submit_product_identity_batch(
    batch_id,
    batch_revision,
    '82666666-6666-4666-8666-666666666666'::uuid,
    'Survey evidence reviewed by Owner'
  );
  if submitted.batch_status <> 'SUBMITTED' then
    raise exception 'Survey-backed Product Identity batch did not submit';
  end if;

  select b.revision into batch_revision
  from public.ecoflow_product_identity_batches b where b.id=batch_id;

  select * into published
  from public.ecoflow_publish_product_identity_batch(
    batch_id,
    batch_revision,
    '82777777-7777-4777-8777-777777777777'::uuid,
    'Survey golden path publication'
  );
  if published.batch_status <> 'PUBLISHED' or published.published_barcodes <> 1 then
    raise exception 'Survey-backed Product Identity publication failed: %', row_to_json(published);
  end if;

  select * into resolved
  from public.ecoflow_resolve_published_physical_barcode('SURVEY-CARTON-12');
  if resolved.resolution_status <> 'RESOLVED'
     or resolved.physical_sku_code <> 'PHY-CUP-12-SURVEY'
     or resolved.package_level <> 'CARTON'
     or resolved.units_in_base_unit <> 1000 then
    raise exception 'published Survey barcode did not resolve canonically: %', row_to_json(resolved);
  end if;

  select * into queued
  from public.ecoflow_read_barcode_survey_reconciliation_queue_v1(50)
  where carton_barcode='SURVEY-CARTON-12';
  if queued.queue_status <> 'ALREADY_RECONCILED_PUBLISHED' then
    raise exception 'queue did not reflect publication: %', row_to_json(queued);
  end if;

  select count(*) into inventory_count from public.ecoflow_inventory_movements;
  if inventory_count <> 1 then raise exception 'publication or reconciliation mutated inventory'; end if;

  select * into resolved
  from public.ecoflow_resolve_published_physical_barcode('SURVEY-UNKNOWN-999');
  if resolved.resolution_status <> 'UNKNOWN' or resolved.physical_sku_id is not null then
    raise exception 'unknown barcode did not remain fail-closed';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Contradictory direct physical observations never use latest-wins.
-- ---------------------------------------------------------------------------
set app.test_role = 'WAREHOUSE';
do $$
begin
  perform * from public.ecoflow_record_barcode_survey_observation_v3(
    '82888888-8888-4888-8888-888888888888'::uuid,
    'CUP-16W','SURVEY-CONFLICT-16','OBSERVED_NOW','SCANNED','SLEEVE-A',null,
    'first conflicting direct observation','warehouse-device-survey-002'
  );
  perform * from public.ecoflow_record_barcode_survey_observation_v3(
    '82999999-9999-4999-8999-999999999999'::uuid,
    'CUP-16W','SURVEY-CONFLICT-16','OBSERVED_NOW','SCANNED','SLEEVE-B',null,
    'second conflicting direct observation','warehouse-device-survey-002'
  );
end
$$;
reset app.test_role;
set app.test_role = 'OWNER';

do $$
declare
  queued record;
  denied boolean := false;
begin
  select * into queued
  from public.ecoflow_read_barcode_survey_reconciliation_queue_v1(100)
  where carton_barcode='SURVEY-CONFLICT-16'
  order by survey_occurred_at desc limit 1;
  if queued.queue_status <> 'DUPLICATE_CONFLICT' then
    raise exception 'contradictory physical evidence was not quarantined: %', row_to_json(queued);
  end if;

  begin
    perform * from public.ecoflow_reconcile_barcode_survey_observation_v1(
      queued.survey_observation_id,
      '82f00000-0000-4000-8000-000000000001'::uuid,
      '82aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
      'PHY-CONFLICT','Conflict',null,null,'FAM-CONFLICT','Conflict','CARTON',1000,'ALLOWED',true,null
    );
  exception when others then
    if sqlerrm like '%SURVEY_RECONCILIATION_PHYSICAL_EVIDENCE_CONFLICT%' then denied := true; else raise; end if;
  end;
  if not denied then raise exception 'conflicting physical evidence was reconciled'; end if;
end
$$;

-- ---------------------------------------------------------------------------
-- A barcode already published to another physical SKU cannot be silently
-- adopted by a later Survey observation.
-- ---------------------------------------------------------------------------
insert into public.skus(id,sku_code,display_name,category,setup_status) values
  ('aaaaaaaa-0000-4000-8000-000000000002','COM-CUP-16','16oz White Cup','Cups','active');
insert into public.external_product_mappings(provider,external_product_code,internal_sku_id,default_unit_level,confidence,is_active) values
  ('ORDERMENTUM','CUP-16W','aaaaaaaa-0000-4000-8000-000000000002','carton','VERIFIED',true);
insert into public.ecoflow_sku_master_overrides(external_sku_code,internal_sku_id,classification,is_service_item,status) values
  ('CUP-16W','aaaaaaaa-0000-4000-8000-000000000002','PRODUCT',false,'ACTIVE');

set app.test_role = 'WAREHOUSE';
do $$
begin
  perform * from public.ecoflow_record_barcode_survey_observation_v3(
    '82bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
    'CUP-16W','SURVEY-CARTON-12','OBSERVED_NOW','NO_SEPARATE_BARCODE',null,null,
    'collision with already published carton','warehouse-device-survey-002'
  );
end
$$;
reset app.test_role;
set app.test_role = 'OWNER';

do $$
declare
  batch_row record;
  collision_id uuid;
  denied boolean := false;
begin
  select * into batch_row
  from public.ecoflow_start_product_identity_batch(
    'Collision fixture',
    '82cccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid
  );

  select id into collision_id
  from public.ecoflow_barcode_survey_observations
  where sku_context='CUP-16W' and carton_barcode='SURVEY-CARTON-12'
  order by occurred_at desc limit 1;

  begin
    perform * from public.ecoflow_reconcile_barcode_survey_observation_v1(
      collision_id,batch_row.batch_id,
      '82dddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid,
      'PHY-CUP-16-OTHER','16oz Other',null,null,'FAM-CUP-16','16oz Family','CARTON',1000,'ALLOWED',true,null
    );
  exception when others then
    if sqlerrm like '%SURVEY_RECONCILIATION_BARCODE_ALREADY_PUBLISHED%' then denied := true; else raise; end if;
  end;
  if not denied then raise exception 'published barcode collision was silently reconciled'; end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Even a privileged out-of-band change to Survey evidence is detected before
-- the existing reconciliation can be reused. Normal authenticated clients have
-- no direct write grant to the Survey table.
-- ---------------------------------------------------------------------------
reset app.test_role;
update public.ecoflow_barcode_survey_observations
set sku_product_name = 'CORRUPTED AFTER RECONCILIATION'
where carton_barcode='SURVEY-CARTON-12' and sku_context='CUP-12W';
set app.test_role = 'OWNER';

do $$
declare
  original_id uuid;
  denied boolean := false;
begin
  select survey_observation_id into original_id
  from public.ecoflow_barcode_survey_identity_reconciliations
  where carton_barcode='SURVEY-CARTON-12';

  begin
    perform * from public.ecoflow_reconcile_barcode_survey_observation_v1(
      original_id,
      (select batch_id from public.ecoflow_barcode_survey_identity_reconciliations where survey_observation_id=original_id),
      '82eeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid,
      'PHY-CUP-12-SURVEY','12oz White Cup - Survey Verified','GreenPack','Supplier A',
      'FAM-CUP-12','12oz Compatible Cups','CARTON',1000,'ALLOWED',true,null
    );
  exception when others then
    if sqlerrm like '%SURVEY_RECONCILIATION_SOURCE_CHANGED%' then denied := true; else raise; end if;
  end;
  if not denied then raise exception 'changed Survey source silently reused an existing reconciliation'; end if;
end
$$;

reset app.test_role;
