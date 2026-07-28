\set ON_ERROR_STOP on

insert into auth.users(id, email)
values
  ('22222222-2222-2222-2222-222222222222', 'warehouse@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'driver@example.test'),
  ('44444444-4444-4444-4444-444444444444', 'account@example.test')
on conflict (id) do nothing;

insert into public.app_user_profiles(user_id, app_role, is_active, team_status)
values
  ('22222222-2222-2222-2222-222222222222', 'WAREHOUSE', true, 'ACTIVE'),
  ('33333333-3333-3333-3333-333333333333', 'DRIVER', true, 'ACTIVE'),
  ('44444444-4444-4444-4444-444444444444', 'ACCOUNT', true, 'ACTIVE')
on conflict (user_id) do update
set app_role = excluded.app_role,
    is_active = excluded.is_active,
    team_status = excluded.team_status;

do $acl$
begin
  if has_table_privilege('authenticated', 'public.ecoflow_barcode_scan_sessions', 'INSERT')
     or has_table_privilege('authenticated', 'public.ecoflow_sku_barcode_registry', 'INSERT')
     or has_table_privilege('authenticated', 'public.ecoflow_barcode_scan_events', 'INSERT')
     or has_table_privilege('authenticated', 'public.ecoflow_sku_package_policies', 'INSERT')
     or has_table_privilege('authenticated', 'public.ecoflow_inventory_movements', 'INSERT')
     or has_table_privilege('authenticated', 'public.ecoflow_inventory_sku_controls', 'INSERT')
     or has_table_privilege('authenticated', 'public.ecoflow_inventory_sku_actions', 'INSERT') then
    raise exception 'authenticated retained a direct warehouse master/ledger INSERT privilege';
  end if;

  if has_table_privilege('authenticated', 'public.ecoflow_sku_barcode_registry', 'UPDATE')
     or has_table_privilege('authenticated', 'public.ecoflow_sku_package_policies', 'UPDATE')
     or has_table_privilege('authenticated', 'public.ecoflow_inventory_sku_controls', 'UPDATE') then
    raise exception 'authenticated retained a direct warehouse master UPDATE privilege';
  end if;

  if has_function_privilege(
    'anon',
    'public.ecoflow_record_barcode_scan(uuid,text,text,text,numeric,text,text,numeric,text,text)',
    'EXECUTE'
  ) then
    raise exception 'anon can execute ecoflow_record_barcode_scan';
  end if;

  if has_function_privilege(
    'anon',
    'public.ecoflow_record_inventory_movement(text,text,numeric,text,text,text,text,text,text,text)',
    'EXECUTE'
  ) then
    raise exception 'anon can execute ecoflow_record_inventory_movement';
  end if;
end;
$acl$;

select set_config(
  'request.jwt.claim.sub',
  '22222222-2222-2222-2222-222222222222',
  false
);
select set_config('request.jwt.claim.role', 'authenticated', false);

select *
from public.ecoflow_set_sku_package_policy(
  'CUP-12W',
  'CARTON_AND_SLEEVE',
  'A1-L-01-01A',
  'warehouse guard contract'
);

select *
from public.ecoflow_record_barcode_scan(
  null,
  'CUP-12W',
  '930000000099',
  'CARTON',
  20,
  '12 oz white cup',
  'A1-L-01-01A',
  1,
  'MAP_ONLY',
  'warehouse guard contract'
);

do $warehouse_rejections$
declare
  v_blocked boolean;
begin
  v_blocked := false;
  begin
    perform *
    from public.ecoflow_record_barcode_scan(
      null,
      'CUP-12W',
      '930000000099',
      'SLEEVE',
      10,
      '12 oz white cup',
      'A1-L-01-01A',
      1,
      'MAP_ONLY',
      'attempted remap'
    );
  exception when others then
    if position('BARCODE_CONFLICT' in sqlerrm) > 0 then
      v_blocked := true;
    else
      raise;
    end if;
  end;
  if not v_blocked then
    raise exception 'active barcode remap was accepted';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.ecoflow_record_barcode_scan(
      null,
      'CUP-12W',
      '930000000100',
      'CARTON',
      20,
      '12 oz white cup',
      'A1-L-01-01A',
      1,
      'MAP_AND_RECEIVE',
      'forbidden direct receive'
    );
  exception when others then
    if position('BARCODE_SETUP_CANNOT_RECEIVE_STOCK' in sqlerrm) > 0 then
      v_blocked := true;
    else
      raise;
    end if;
  end;
  if not v_blocked then
    raise exception 'MAP_AND_RECEIVE remained available';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.ecoflow_record_barcode_scan(
      null,
      'CUP-12W',
      '930000000101',
      'CARTON',
      1.5,
      '12 oz white cup',
      'A1-L-01-01A',
      1,
      'MAP_ONLY',
      'fractional conversion'
    );
  exception when others then
    if position('positive whole number' in sqlerrm) > 0 then
      v_blocked := true;
    else
      raise;
    end if;
  end;
  if not v_blocked then
    raise exception 'fractional units_per_barcode was accepted';
  end if;
end;
$warehouse_rejections$;

select set_config(
  'request.jwt.claim.sub',
  '33333333-3333-3333-3333-333333333333',
  false
);

do $driver_rejections$
declare
  v_blocked boolean;
begin
  v_blocked := false;
  begin
    perform *
    from public.ecoflow_set_sku_package_policy(
      'CUP-12W',
      'CARTON_ONLY',
      null,
      'driver attempt'
    );
  exception when sqlstate '42501' then
    if position('OWNER_ADMIN_OR_WAREHOUSE_REQUIRED' in sqlerrm) > 0 then
      v_blocked := true;
    else
      raise;
    end if;
  end;
  if not v_blocked then
    raise exception 'driver changed SKU package policy';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.ecoflow_record_barcode_scan(
      null,
      'CUP-12W',
      '930000000102',
      'CARTON',
      20,
      '12 oz white cup',
      null,
      1,
      'MAP_ONLY',
      'driver attempt'
    );
  exception when sqlstate '42501' then
    if position('OWNER_ADMIN_OR_WAREHOUSE_REQUIRED' in sqlerrm) > 0 then
      v_blocked := true;
    else
      raise;
    end if;
  end;
  if not v_blocked then
    raise exception 'driver recorded a barcode mapping';
  end if;

  v_blocked := false;
  begin
    perform *
    from public.ecoflow_record_inventory_movement(
      'CUP-12W',
      'ADJUST_IN',
      10,
      null,
      'A1-L-01-01A',
      'MANUAL',
      'driver-attempt',
      null,
      'driver attempt',
      'FORGED_SOURCE'
    );
  exception when sqlstate '42501' then
    if position('OWNER_ADMIN_OR_WAREHOUSE_REQUIRED' in sqlerrm) > 0 then
      v_blocked := true;
    else
      raise;
    end if;
  end;
  if not v_blocked then
    raise exception 'driver recorded an inventory movement';
  end if;
end;
$driver_rejections$;

select set_config(
  'request.jwt.claim.sub',
  '22222222-2222-2222-2222-222222222222',
  false
);

select *
from public.ecoflow_record_inventory_movement(
  'CUP-12W',
  'ADJUST_IN',
  2,
  null,
  'A1-L-01-01A',
  'MANUAL',
  'warehouse-guard-contract',
  null,
  'approved adjustment',
  'FORGED_SOURCE'
);

do $server_owned_metadata$
begin
  if not exists (
    select 1
    from public.ecoflow_inventory_movements movement
    where movement.reference_id = 'warehouse-guard-contract'
      and movement.moved_by = '22222222-2222-2222-2222-222222222222'
      and movement.source = 'INVENTORY_CONTROL'
  ) then
    raise exception 'movement actor/source were not server controlled';
  end if;
end;
$server_owned_metadata$;

select 'warehouse write guard contract passed' as result;
