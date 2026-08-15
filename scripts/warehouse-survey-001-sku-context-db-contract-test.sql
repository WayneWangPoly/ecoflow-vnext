\set ON_ERROR_STOP on

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select set_config('request.jwt.claim.app_role', 'WAREHOUSE', false);

-- Existing observations created before the SKU-context migration remain valid.
do $$
declare
  old_rows bigint;
begin
  select count(*) into old_rows
  from public.ecoflow_barcode_survey_observations
  where command_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
    and sku_context is null;
  if old_rows <> 1 then
    raise exception 'Historical no-SKU survey row was not preserved';
  end if;
end
$$;

-- Prefix search is bounded and progressively narrows the authoritative existing-SKU read surface.
do $$
declare
  cup_count bigint;
  exact_count bigint;
begin
  select count(*) into cup_count
  from public.ecoflow_search_barcode_survey_skus_v1('CUP-', 12);
  if cup_count <> 2 then
    raise exception 'Expected two CUP- suggestions, got %', cup_count;
  end if;

  select count(*) into exact_count
  from public.ecoflow_search_barcode_survey_skus_v1('cup-12w', 12)
  where sku = 'CUP-12W' and product_name = '12oz White Compostable Cup';
  if exact_count <> 1 then
    raise exception 'Case-insensitive exact SKU lookup failed';
  end if;
end
$$;

-- V2 stores only server-resolved contextual SKU evidence.
do $$
declare
  r record;
  stored_name text;
begin
  select * into r
  from public.ecoflow_record_barcode_survey_observation_v2(
    '12121212-1212-4212-8212-121212121212'::uuid,
    'cup-12w',
    'CARTON-SKU-CONTEXT',
    'NOT_CHECKED',
    null,
    'sku context contract',
    'warehouse-device-a'
  );

  if r.status <> 'APPLIED' or r.sku_context <> 'CUP-12W' or r.sku_product_name <> '12oz White Compostable Cup' then
    raise exception 'Server did not resolve canonical SKU context: %', row_to_json(r);
  end if;

  select sku_product_name into stored_name
  from public.ecoflow_barcode_survey_observations
  where command_id = '12121212-1212-4212-8212-121212121212'::uuid;
  if stored_name <> '12oz White Compostable Cup' then
    raise exception 'Resolved product-name snapshot was not stored';
  end if;
end
$$;

-- Unknown browser-provided SKU context fails closed.
do $$
begin
  begin
    perform * from public.ecoflow_record_barcode_survey_observation_v2(
      '13131313-1313-4313-8313-131313131313'::uuid,
      'NOT-A-REAL-SKU',
      'CARTON-UNKNOWN-SKU',
      'NOT_CHECKED',
      null,
      null,
      'warehouse-device-a'
    );
    raise exception 'Expected BARCODE_SURVEY_SKU_UNKNOWN';
  exception when others then
    if sqlerrm <> 'BARCODE_SURVEY_SKU_UNKNOWN' then raise; end if;
  end;
end
$$;

-- SKU context is part of the idempotency fingerprint.
do $$
begin
  begin
    perform * from public.ecoflow_record_barcode_survey_observation_v2(
      '12121212-1212-4212-8212-121212121212'::uuid,
      'CUP-16W',
      'CARTON-SKU-CONTEXT',
      'NOT_CHECKED',
      null,
      'sku context contract',
      'warehouse-device-a'
    );
    raise exception 'Expected BARCODE_SURVEY_IDEMPOTENCY_CONFLICT';
  exception when others then
    if sqlerrm <> 'BARCODE_SURVEY_IDEMPOTENCY_CONFLICT' then raise; end if;
  end;
end
$$;

-- Lookup and capture remain warehouse-role gated.
select set_config('request.jwt.claim.app_role', 'ACCOUNT', false);
do $$
begin
  begin
    perform * from public.ecoflow_search_barcode_survey_skus_v1('CUP', 12);
    raise exception 'Expected BARCODE_SURVEY_ROLE_FORBIDDEN';
  exception when others then
    if sqlerrm <> 'BARCODE_SURVEY_ROLE_FORBIDDEN' then raise; end if;
  end;
end
$$;

-- Survey code has no write privilege on the SKU fixture/source and direct evidence DML remains closed.
select set_config('request.jwt.claim.app_role', 'WAREHOUSE', false);
do $$
begin
  if has_table_privilege('authenticated', 'public.ecoflow_barcode_survey_observations', 'INSERT')
     or has_table_privilege('authenticated', 'public.ecoflow_barcode_survey_observations', 'UPDATE')
     or has_table_privilege('authenticated', 'public.ecoflow_barcode_survey_observations', 'DELETE') then
    raise exception 'Authenticated browser role gained direct survey DML';
  end if;

  if not has_function_privilege('authenticated', 'public.ecoflow_search_barcode_survey_skus_v1(text,integer)', 'EXECUTE') then
    raise exception 'Authenticated warehouse UI cannot execute bounded SKU lookup';
  end if;

  if not has_function_privilege('authenticated', 'public.ecoflow_record_barcode_survey_observation_v2(uuid,text,text,text,text,text,text)', 'EXECUTE') then
    raise exception 'Authenticated warehouse UI cannot execute SKU-context survey command';
  end if;
end
$$;
