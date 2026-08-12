\set ON_ERROR_STOP on

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select set_config('request.jwt.claim.app_role', 'WAREHOUSE', false);

do $$
declare
  r record;
  row_count bigint;
begin
  select * into r
  from public.ecoflow_record_barcode_survey_observation_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
    '000123456789',
    'NOT_CHECKED',
    null,
    'first physical evidence',
    'warehouse-device-a'
  );

  if r.status <> 'APPLIED' or r.replayed is not false then
    raise exception 'Expected APPLIED on first observation, got % / replayed=%', r.status, r.replayed;
  end if;

  select * into r
  from public.ecoflow_record_barcode_survey_observation_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
    '000123456789',
    'NOT_CHECKED',
    null,
    'first physical evidence',
    'warehouse-device-a'
  );

  if r.status <> 'REPLAYED' or r.replayed is not true then
    raise exception 'Expected REPLAYED on exact retry, got % / replayed=%', r.status, r.replayed;
  end if;

  select count(*) into row_count
  from public.ecoflow_barcode_survey_observations
  where command_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;

  if row_count <> 1 then
    raise exception 'Exact retry created % rows instead of one', row_count;
  end if;
end
$$;

do $$
begin
  begin
    perform *
    from public.ecoflow_record_barcode_survey_observation_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
      'DIFFERENT-CARTON',
      'NOT_CHECKED',
      null,
      'changed payload',
      'warehouse-device-a'
    );
    raise exception 'Expected BARCODE_SURVEY_IDEMPOTENCY_CONFLICT';
  exception
    when others then
      if sqlerrm <> 'BARCODE_SURVEY_IDEMPOTENCY_CONFLICT' then
        raise;
      end if;
  end;
end
$$;

do $$
begin
  begin
    perform *
    from public.ecoflow_record_barcode_survey_observation_v1(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
      'CARTON-SAME',
      'SCANNED',
      'CARTON-SAME',
      null,
      'warehouse-device-a'
    );
    raise exception 'Expected BARCODE_SURVEY_SLEEVE_MUST_DIFFER';
  exception
    when others then
      if sqlerrm <> 'BARCODE_SURVEY_SLEEVE_MUST_DIFFER' then
        raise;
      end if;
  end;
end
$$;

do $$
begin
  begin
    perform *
    from public.ecoflow_record_barcode_survey_observation_v1(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid,
      'CARTON-001',
      'NO_SEPARATE_BARCODE',
      'SLEEVE-NOT-ALLOWED',
      null,
      'warehouse-device-a'
    );
    raise exception 'Expected BARCODE_SURVEY_SLEEVE_NOT_ALLOWED';
  exception
    when others then
      if sqlerrm <> 'BARCODE_SURVEY_SLEEVE_NOT_ALLOWED' then
        raise;
      end if;
  end;
end
$$;

select set_config('request.jwt.claim.app_role', 'ACCOUNT', false);

do $$
begin
  begin
    perform *
    from public.ecoflow_record_barcode_survey_observation_v1(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid,
      'CARTON-ACCOUNT',
      'NOT_CHECKED',
      null,
      null,
      'account-device'
    );
    raise exception 'Expected BARCODE_SURVEY_ROLE_FORBIDDEN';
  exception
    when others then
      if sqlerrm <> 'BARCODE_SURVEY_ROLE_FORBIDDEN' then
        raise;
      end if;
  end;
end
$$;

select set_config('request.jwt.claim.app_role', 'WAREHOUSE', false);
select set_config('request.jwt.claim.sub', '', false);

do $$
begin
  begin
    perform *
    from public.ecoflow_record_barcode_survey_observation_v1(
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid,
      'CARTON-ANON',
      'NOT_CHECKED',
      null,
      null,
      'anon-device'
    );
    raise exception 'Expected BARCODE_SURVEY_AUTH_REQUIRED';
  exception
    when others then
      if sqlerrm <> 'BARCODE_SURVEY_AUTH_REQUIRED' then
        raise;
      end if;
  end;
end
$$;

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select set_config('request.jwt.claim.app_role', 'ADMIN', false);

do $$
declare
  recovered bigint;
begin
  select count(*) into recovered
  from public.ecoflow_recover_barcode_survey_observation_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
  );
  if recovered <> 0 then
    raise exception 'Another actor recovered someone else''s command';
  end if;
end
$$;

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select set_config('request.jwt.claim.app_role', 'WAREHOUSE', false);

do $$
declare
  recovered bigint;
  forbidden_columns bigint;
begin
  select count(*) into recovered
  from public.ecoflow_recover_barcode_survey_observation_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
  );
  if recovered <> 1 then
    raise exception 'Owning actor could not recover its command';
  end if;

  if has_table_privilege('authenticated', 'public.ecoflow_barcode_survey_observations', 'INSERT')
     or has_table_privilege('authenticated', 'public.ecoflow_barcode_survey_observations', 'UPDATE')
     or has_table_privilege('authenticated', 'public.ecoflow_barcode_survey_observations', 'DELETE') then
    raise exception 'Authenticated browser role still has direct barcode survey DML';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.ecoflow_record_barcode_survey_observation_v1(uuid,text,text,text,text,text)',
    'EXECUTE'
  ) then
    raise exception 'Authenticated role cannot execute survey command';
  end if;

  select count(*) into forbidden_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'ecoflow_barcode_survey_observations'
    and column_name in (
      'commercial_sku_id', 'commercial_sku', 'location_id', 'location_code',
      'quantity', 'quantity_packages', 'units_per_package', 'inventory_balance_id'
    );

  if forbidden_columns <> 0 then
    raise exception 'Survey staging relation contains forbidden inventory/commercial columns';
  end if;
end
$$;
