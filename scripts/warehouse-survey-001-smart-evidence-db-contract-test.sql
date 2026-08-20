\set ON_ERROR_STOP on

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select set_config('request.jwt.claim.app_role', 'WAREHOUSE', false);

-- A direct physical observation verifies only its exact SKU + carton pair.
do $$
declare
  observed record;
  evidence record;
begin
  select * into observed
  from public.ecoflow_record_barcode_survey_observation_v3(
    '20111111-1111-4111-8111-111111111111'::uuid,
    'cup-12w',
    'SMART-CARTON-A',
    'OBSERVED_NOW',
    'SCANNED',
    'SMART-SLEEVE-A',
    null,
    'direct physical contract',
    'warehouse-device-smart'
  );

  if observed.status <> 'APPLIED'
     or observed.sku_context <> 'CUP-12W'
     or observed.sleeve_status <> 'SCANNED'
     or observed.sleeve_barcode <> 'SMART-SLEEVE-A'
     or observed.evidence_source <> 'OBSERVED_NOW'
     or observed.source_observation_id is not null then
    raise exception 'Direct physical evidence was not stored correctly: %', row_to_json(observed);
  end if;

  select * into evidence
  from public.ecoflow_get_barcode_survey_packaging_evidence_v1('CUP-12W', 'SMART-CARTON-A');

  if evidence.status <> 'VERIFIED_SCANNED'
     or evidence.sleeve_barcode <> 'SMART-SLEEVE-A'
     or evidence.source_observation_id <> observed.observation_id
     or evidence.physical_observation_count <> 1 then
    raise exception 'Exact physical evidence was not resolved: %', row_to_json(evidence);
  end if;
end
$$;

-- Same SKU with a different carton barcode is a new packaging variant.
do $$
declare
  evidence record;
begin
  select * into evidence
  from public.ecoflow_get_barcode_survey_packaging_evidence_v1('CUP-12W', 'SMART-CARTON-NEW');
  if evidence.status <> 'UNVERIFIED' or evidence.physical_observation_count <> 0 then
    raise exception 'Different carton barcode incorrectly inherited evidence: %', row_to_json(evidence);
  end if;
end
$$;

-- Same carton barcode under a different Commercial SKU does not cross-reuse.
do $$
declare
  evidence record;
begin
  select * into evidence
  from public.ecoflow_get_barcode_survey_packaging_evidence_v1('CUP-16W', 'SMART-CARTON-A');
  if evidence.status <> 'UNVERIFIED' or evidence.physical_observation_count <> 0 then
    raise exception 'Different SKU incorrectly inherited carton evidence: %', row_to_json(evidence);
  end if;
end
$$;

-- Reuse stores provenance and derives sleeve truth from the original direct observation.
do $$
declare
  source_id uuid;
  reused record;
  evidence record;
begin
  select source_observation_id into source_id
  from public.ecoflow_get_barcode_survey_packaging_evidence_v1('CUP-12W', 'SMART-CARTON-A');

  select * into reused
  from public.ecoflow_record_barcode_survey_observation_v3(
    '20222222-2222-4222-8222-222222222222'::uuid,
    'CUP-12W',
    'SMART-CARTON-A',
    'REUSED_EXACT_PACKAGE',
    null,
    null,
    source_id,
    'reuse contract',
    'warehouse-device-smart'
  );

  if reused.status <> 'APPLIED'
     or reused.evidence_source <> 'REUSED_EXACT_PACKAGE'
     or reused.source_observation_id <> source_id
     or reused.sleeve_status <> 'SCANNED'
     or reused.sleeve_barcode <> 'SMART-SLEEVE-A' then
    raise exception 'Reused evidence did not retain provenance: %', row_to_json(reused);
  end if;

  select * into evidence
  from public.ecoflow_get_barcode_survey_packaging_evidence_v1('CUP-12W', 'SMART-CARTON-A');
  if evidence.status <> 'VERIFIED_SCANNED' or evidence.physical_observation_count <> 1 then
    raise exception 'Reuse incorrectly became a second physical observation: %', row_to_json(evidence);
  end if;
end
$$;

-- A physical no-separate-barcode determination is independently reusable.
do $$
declare
  observed record;
  evidence record;
begin
  select * into observed
  from public.ecoflow_record_barcode_survey_observation_v3(
    '20333333-3333-4333-8333-333333333333'::uuid,
    'CUP-16W',
    'SMART-CARTON-NO-SLEEVE',
    'OBSERVED_NOW',
    'NO_SEPARATE_BARCODE',
    null,
    null,
    null,
    'warehouse-device-smart'
  );

  select * into evidence
  from public.ecoflow_get_barcode_survey_packaging_evidence_v1('CUP-16W', 'SMART-CARTON-NO-SLEEVE');
  if evidence.status <> 'VERIFIED_NO_SEPARATE_BARCODE'
     or evidence.sleeve_barcode is not null
     or evidence.source_observation_id <> observed.observation_id then
    raise exception 'No-separate-barcode evidence was not resolved: %', row_to_json(evidence);
  end if;
end
$$;

-- High-rack and opening-required deferrals are NOT_CHECKED evidence, never verification.
do $$
declare
  inaccessible record;
  opening_required record;
  evidence record;
begin
  select * into inaccessible
  from public.ecoflow_record_barcode_survey_observation_v3(
    '20444444-4444-4444-8444-444444444444'::uuid,
    'CUP-12W',
    'SMART-HIGH-RACK',
    'DEFERRED_INACCESSIBLE',
    null,
    null,
    null,
    'high rack',
    'warehouse-device-smart'
  );
  if inaccessible.sleeve_status <> 'NOT_CHECKED'
     or inaccessible.sleeve_barcode is not null
     or inaccessible.evidence_source <> 'DEFERRED_INACCESSIBLE' then
    raise exception 'Inaccessible defer was not stored as non-verifying: %', row_to_json(inaccessible);
  end if;

  select * into opening_required
  from public.ecoflow_record_barcode_survey_observation_v3(
    '20555555-5555-4555-8555-555555555555'::uuid,
    'CUP-12W',
    'SMART-SEALED-STOCK',
    'DEFERRED_OPENING_REQUIRED',
    null,
    null,
    null,
    'sealed stock',
    'warehouse-device-smart'
  );
  if opening_required.sleeve_status <> 'NOT_CHECKED'
     or opening_required.sleeve_barcode is not null
     or opening_required.evidence_source <> 'DEFERRED_OPENING_REQUIRED' then
    raise exception 'Opening-required defer was not stored as non-verifying: %', row_to_json(opening_required);
  end if;

  select * into evidence
  from public.ecoflow_get_barcode_survey_packaging_evidence_v1('CUP-12W', 'SMART-HIGH-RACK');
  if evidence.status <> 'UNVERIFIED' or evidence.physical_observation_count <> 0 then
    raise exception 'Deferred evidence incorrectly verified high-rack packaging: %', row_to_json(evidence);
  end if;
end
$$;

-- Contradictory direct physical observations fail closed; latest never wins.
do $$
declare
  first_source uuid;
  conflicting record;
  evidence record;
begin
  select source_observation_id into first_source
  from public.ecoflow_get_barcode_survey_packaging_evidence_v1('CUP-12W', 'SMART-CARTON-A');

  select * into conflicting
  from public.ecoflow_record_barcode_survey_observation_v3(
    '20666666-6666-4666-8666-666666666666'::uuid,
    'CUP-12W',
    'SMART-CARTON-A',
    'OBSERVED_NOW',
    'SCANNED',
    'SMART-SLEEVE-CONFLICT',
    null,
    'intentional conflict contract',
    'warehouse-device-smart'
  );

  select * into evidence
  from public.ecoflow_get_barcode_survey_packaging_evidence_v1('CUP-12W', 'SMART-CARTON-A');
  if evidence.status <> 'CONFLICT'
     or evidence.sleeve_barcode is not null
     or evidence.source_observation_id is not null
     or evidence.physical_observation_count <> 2 then
    raise exception 'Contradictory physical evidence did not fail closed: %', row_to_json(evidence);
  end if;

  begin
    perform * from public.ecoflow_record_barcode_survey_observation_v3(
      '20777777-7777-4777-8777-777777777777'::uuid,
      'CUP-12W',
      'SMART-CARTON-A',
      'REUSED_EXACT_PACKAGE',
      null,
      null,
      first_source,
      null,
      'warehouse-device-smart'
    );
    raise exception 'Expected BARCODE_SURVEY_EVIDENCE_CONFLICT';
  exception when others then
    if sqlerrm <> 'BARCODE_SURVEY_EVIDENCE_CONFLICT' then raise; end if;
  end;
end
$$;

-- A source observation cannot be reused under another SKU or carton.
do $$
declare
  source_id uuid;
begin
  select source_observation_id into source_id
  from public.ecoflow_get_barcode_survey_packaging_evidence_v1('CUP-16W', 'SMART-CARTON-NO-SLEEVE');

  begin
    perform * from public.ecoflow_record_barcode_survey_observation_v3(
      '20888888-8888-4888-8888-888888888888'::uuid,
      'CUP-12W',
      'SMART-CARTON-NO-SLEEVE',
      'REUSED_EXACT_PACKAGE',
      null,
      null,
      source_id,
      null,
      'warehouse-device-smart'
    );
    raise exception 'Expected BARCODE_SURVEY_REUSE_SOURCE_MISMATCH';
  exception when others then
    if sqlerrm <> 'BARCODE_SURVEY_REUSE_SOURCE_MISMATCH' then raise; end if;
  end;
end
$$;

-- New smart RPCs remain warehouse-role gated and browser direct DML stays closed.
select set_config('request.jwt.claim.app_role', 'ACCOUNT', false);
do $$
begin
  begin
    perform * from public.ecoflow_get_barcode_survey_packaging_evidence_v1('CUP-12W', 'SMART-CARTON-A');
    raise exception 'Expected BARCODE_SURVEY_ROLE_FORBIDDEN';
  exception when others then
    if sqlerrm <> 'BARCODE_SURVEY_ROLE_FORBIDDEN' then raise; end if;
  end;

  begin
    perform * from public.ecoflow_record_barcode_survey_observation_v3(
      '20999999-9999-4999-8999-999999999999'::uuid,
      'CUP-12W',
      'SMART-CARTON-ROLE',
      'DEFERRED_INACCESSIBLE',
      null,
      null,
      null,
      null,
      'warehouse-device-smart'
    );
    raise exception 'Expected BARCODE_SURVEY_ROLE_FORBIDDEN';
  exception when others then
    if sqlerrm <> 'BARCODE_SURVEY_ROLE_FORBIDDEN' then raise; end if;
  end;
end
$$;

select set_config('request.jwt.claim.app_role', 'WAREHOUSE', false);
do $$
begin
  if has_table_privilege('authenticated', 'public.ecoflow_barcode_survey_observations', 'INSERT')
     or has_table_privilege('authenticated', 'public.ecoflow_barcode_survey_observations', 'UPDATE')
     or has_table_privilege('authenticated', 'public.ecoflow_barcode_survey_observations', 'DELETE') then
    raise exception 'Authenticated browser role gained direct survey DML';
  end if;

  if not has_function_privilege('authenticated', 'public.ecoflow_get_barcode_survey_packaging_evidence_v1(text,text)', 'EXECUTE') then
    raise exception 'Authenticated warehouse UI cannot execute smart evidence lookup';
  end if;

  if not has_function_privilege('authenticated', 'public.ecoflow_record_barcode_survey_observation_v3(uuid,text,text,text,text,text,uuid,text,text)', 'EXECUTE') then
    raise exception 'Authenticated warehouse UI cannot execute smart evidence command';
  end if;
end
$$;
