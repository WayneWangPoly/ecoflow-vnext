\set ON_ERROR_STOP on

set app.test_role = 'OWNER';

-- Canonical Commercial SKU exists in public.skus but intentionally does NOT
-- exist in v_ecoflow_inventory_sku_control. This reproduces ECOFLOW-328 failure.
insert into public.ecoflow_barcode_survey_observations (
  id, command_id, sku_context, sku_product_name, carton_barcode, sleeve_status,
  sleeve_barcode, evidence_source, source_observation_id, note,
  actor_user_id, actor_role, device_id, request_fingerprint, occurred_at
) values (
  '83111111-1111-4111-8111-111111111111'::uuid,
  '83111111-1111-4111-8111-111111111112'::uuid,
  'COM-CUP-12',
  '12oz White Cup',
  'RESOLVER-CANONICAL-CARTON',
  'SCANNED',
  'RESOLVER-CANONICAL-SLEEVE',
  'OBSERVED_NOW',
  null,
  'canonical Commercial SKU absent from inventory projection',
  '11111111-1111-4111-8111-111111111111'::uuid,
  'OWNER',
  'resolver-contract',
  'resolver-canonical-fingerprint',
  now()
);

do $$
declare
  evidence record;
begin
  select * into evidence
  from public.ecoflow_get_barcode_survey_packaging_evidence_v1(
    'com-cup-12',
    'RESOLVER-CANONICAL-CARTON'
  );

  if evidence.status <> 'VERIFIED_SCANNED'
     or evidence.sku_context <> 'COM-CUP-12'
     or evidence.sleeve_barcode <> 'RESOLVER-CANONICAL-SLEEVE'
     or evidence.physical_observation_count <> 1 then
    raise exception 'canonical Commercial SKU resolver repair failed: %', row_to_json(evidence);
  end if;
end
$$;

-- Active Ordermentum aliases remain valid even when the alias is absent from
-- the inventory-control projection.
insert into public.external_product_mappings(
  provider,external_product_code,internal_sku_id,default_unit_level,confidence,is_active
) values (
  'ORDERMENTUM',
  'CUP-12-ALT',
  'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
  'carton',
  'VERIFIED',
  true
);

insert into public.ecoflow_barcode_survey_observations (
  id, command_id, sku_context, sku_product_name, carton_barcode, sleeve_status,
  sleeve_barcode, evidence_source, source_observation_id, note,
  actor_user_id, actor_role, device_id, request_fingerprint, occurred_at
) values (
  '83222222-2222-4222-8222-222222222222'::uuid,
  '83222222-2222-4222-8222-222222222223'::uuid,
  'CUP-12-ALT',
  '12oz White Cup alias',
  'RESOLVER-ALIAS-CARTON',
  'NO_SEPARATE_BARCODE',
  null,
  'OBSERVED_NOW',
  null,
  'active Ordermentum alias absent from inventory projection',
  '11111111-1111-4111-8111-111111111111'::uuid,
  'OWNER',
  'resolver-contract',
  'resolver-alias-fingerprint',
  now()
);

do $$
declare
  evidence record;
begin
  select * into evidence
  from public.ecoflow_get_barcode_survey_packaging_evidence_v1(
    'cup-12-alt',
    'RESOLVER-ALIAS-CARTON'
  );

  if evidence.status <> 'VERIFIED_NO_SEPARATE_BARCODE'
     or evidence.sku_context <> 'CUP-12-ALT'
     or evidence.sleeve_barcode is not null
     or evidence.physical_observation_count <> 1 then
    raise exception 'active Ordermentum alias resolver repair failed: %', row_to_json(evidence);
  end if;
end
$$;

-- Ambiguous authority fails closed instead of choosing one Commercial SKU.
insert into public.skus(id,sku_code,display_name,category,setup_status) values
  ('aaaaaaaa-0000-4000-8000-000000000099','AMBIG-CODE','Ambiguous direct SKU','Cups','active');
insert into public.external_product_mappings(
  provider,external_product_code,internal_sku_id,default_unit_level,confidence,is_active
) values (
  'ORDERMENTUM',
  'AMBIG-CODE',
  'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
  'carton',
  'VERIFIED',
  true
);

do $$
declare
  denied boolean := false;
begin
  begin
    perform * from public.ecoflow_get_barcode_survey_packaging_evidence_v1(
      'AMBIG-CODE',
      'DOES-NOT-MATTER'
    );
  exception when others then
    if sqlerrm = 'BARCODE_SURVEY_SKU_AMBIGUOUS' then
      denied := true;
    else
      raise;
    end if;
  end;

  if not denied then
    raise exception 'ambiguous Commercial SKU authority did not fail closed';
  end if;
end
$$;

-- Truly unknown SKU remains rejected.
do $$
declare
  denied boolean := false;
begin
  begin
    perform * from public.ecoflow_get_barcode_survey_packaging_evidence_v1(
      'NO-SUCH-SKU',
      'DOES-NOT-MATTER'
    );
  exception when others then
    if sqlerrm = 'BARCODE_SURVEY_SKU_UNKNOWN' then
      denied := true;
    else
      raise;
    end if;
  end;

  if not denied then
    raise exception 'unknown SKU was accepted';
  end if;
end
$$;
