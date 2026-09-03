\set ON_ERROR_STOP on

set app.test_role='OWNER';

insert into public.skus(id,sku_code,display_name,category,setup_status) values
  ('aaaaaaaa-0000-4000-8000-000000000009','BOUND-1','Bounded identity fixture','Cups','active');
insert into public.external_product_mappings(
  provider,external_product_code,internal_sku_id,default_unit_level,confidence,is_active
) values(
  'ORDERMENTUM','BOUND-1','aaaaaaaa-0000-4000-8000-000000000009','carton','VERIFIED',true
);
insert into public.ecoflow_product_identity_tasks(
  task_key,task_type,barcode,task_status,blocking,source,detail
) values(
  'BARCODE:UNRELATED-OPEN','UNKNOWN_BARCODE','UNRELATED-OPEN','OPEN',true,
  'CONTRACT_FIXTURE','Unrelated unresolved evidence must remain outside the bounded batch.'
);

do $$
declare
  denied boolean:=false;
begin
  perform pg_catalog.set_config('app.test_role','WAREHOUSE',true);
  begin
    perform * from public.ecoflow_start_bounded_product_identity_batch(
      'Denied warehouse scope',
      array['aaaaaaaa-0000-4000-8000-000000000009'::uuid],
      '83000000-0000-4000-8000-000000000000'::uuid
    );
  exception when sqlstate '42501' then denied:=true;
  end;
  if not denied then raise exception 'Warehouse started an Owner/Admin bounded batch'; end if;
  perform pg_catalog.set_config('app.test_role','OWNER',true);
end
$$;

create temporary table _bounded_batch_result as
select * from public.ecoflow_start_bounded_product_identity_batch(
  'One explicit Commercial SKU',
  array['aaaaaaaa-0000-4000-8000-000000000009'::uuid],
  '83000000-0000-4000-8000-000000000001'::uuid
);

do $$
declare
  v_batch_id uuid;
  v_status text;
  denied boolean;
begin
  select batch_id,command_status into v_batch_id,v_status from _bounded_batch_result;
  if v_status<>'APPLIED' then raise exception 'bounded start was not applied'; end if;
  if (select scoped_sku_count from _bounded_batch_result)<>1 then
    raise exception 'bounded start returned the wrong scope size';
  end if;
  if (select count(*) from public.ecoflow_product_identity_batch_scope_items where batch_id=v_batch_id)<>1 then
    raise exception 'bounded scope evidence was not stored';
  end if;
  if (select batch_id from public.ecoflow_product_identity_tasks where task_key='BARCODE:UNRELATED-OPEN') is not null then
    raise exception 'unrelated unresolved evidence was attached to the bounded batch';
  end if;
  if not exists(
    select 1 from public.ecoflow_product_identity_tasks
    where task_key='COMMERCIAL:aaaaaaaa-0000-4000-8000-000000000009'
      and batch_id=v_batch_id and task_status='OPEN'
  ) then raise exception 'selected Commercial SKU task was not attached'; end if;

  if (select command_status from public.ecoflow_start_bounded_product_identity_batch(
    'One explicit Commercial SKU',
    array['aaaaaaaa-0000-4000-8000-000000000009'::uuid],
    '83000000-0000-4000-8000-000000000001'::uuid
  ))<>'REPLAYED' then raise exception 'same-command replay was not idempotent'; end if;

  denied:=false;
  begin
    perform * from public.ecoflow_start_bounded_product_identity_batch(
      'Changed replay payload',
      array['aaaaaaaa-0000-4000-8000-000000000009'::uuid],
      '83000000-0000-4000-8000-000000000001'::uuid
    );
  exception when others then
    if sqlerrm like '%PRODUCT_IDENTITY_COMMAND_REPLAY_PAYLOAD_MISMATCH%' then denied:=true; else raise; end if;
  end;
  if not denied then raise exception 'changed command replay was accepted'; end if;

  denied:=false;
  begin
    perform * from public.ecoflow_start_bounded_product_identity_batch(
      'Second open scope',
      array['aaaaaaaa-0000-4000-8000-000000000009'::uuid],
      '83000000-0000-4000-8000-000000000002'::uuid
    );
  exception when others then
    if sqlerrm like '%PRODUCT_IDENTITY_OPEN_BATCH_SCOPE_CONFLICT%' then denied:=true; else raise; end if;
  end;
  if not denied then raise exception 'second open batch did not fail closed'; end if;

  denied:=false;
  begin
    insert into public.ecoflow_product_identity_observations(
      batch_id,command_id,commercial_sku_id,barcode,package_level,
      units_in_base_unit,substitution_policy,is_preferred,observation_status,detail,payload
    ) values(
      v_batch_id,'83000000-0000-4000-8000-000000000003'::uuid,
      'aaaaaaaa-0000-4000-8000-000000000001'::uuid,'OUT-OF-SCOPE','CARTON',
      1,'PROHIBITED',true,'CONFLICT','must fail before capture', '{}'::jsonb
    );
  exception when others then
    if sqlerrm like '%PRODUCT_IDENTITY_COMMERCIAL_SKU_OUT_OF_BATCH_SCOPE%' then denied:=true; else raise; end if;
  end;
  if not denied then raise exception 'out-of-scope Product Identity observation was accepted'; end if;

  denied:=false;
  begin
    update public.ecoflow_product_identity_batch_scope_items
    set command_payload_sha256=repeat('0',64)
    where batch_id=v_batch_id;
  exception when others then
    if sqlerrm like '%PRODUCT_IDENTITY_BATCH_SCOPE_IMMUTABLE%' then denied:=true; else raise; end if;
  end;
  if not denied then raise exception 'scope command evidence was mutable'; end if;
end
$$;

do $$
declare v_batch_id uuid:=(select batch_id from _bounded_batch_result);
begin
  perform * from public.ecoflow_capture_product_identity(
    v_batch_id,
    '83000000-0000-4000-8000-000000000004'::uuid,
    'aaaaaaaa-0000-4000-8000-000000000009'::uuid,
    'PHY-BOUND-1','Bounded physical fixture','Fixture Brand','Fixture Supplier',
    'FAM-BOUND-1','Bounded family','BOUND-CARTON-1','CARTON',1000,
    'APPROVAL_REQUIRED',true,'Explicit contract fixture'
  );
  if (select revision from public.ecoflow_product_identity_batches where id=v_batch_id)<>1 then
    raise exception 'capture did not advance bounded batch revision';
  end if;
  perform * from public.ecoflow_submit_product_identity_batch(
    v_batch_id,1,'83000000-0000-4000-8000-000000000005'::uuid,'Bounded review'
  );
  perform * from public.ecoflow_publish_product_identity_batch(
    v_batch_id,2,'83000000-0000-4000-8000-000000000006'::uuid,'Bounded publish'
  );
end
$$;

do $$
declare resolver_count bigint; resolved_code text;
begin
  select count(*),min(r.physical_sku_code)
  into resolver_count,resolved_code
  from public.ecoflow_resolve_published_physical_barcode('BOUND-CARTON-1') r
  where r.resolution_status='RESOLVED';
  if resolver_count<>1 or resolved_code<>'PHY-BOUND-1' then
    raise exception 'canonical barcode resolver did not return exactly one Physical SKU';
  end if;
  if (select count(*) from public.ecoflow_inventory_movements)<>1 then
    raise exception 'bounded identity path changed inventory authority';
  end if;
  if (select batch_id from public.ecoflow_product_identity_tasks where task_key='BARCODE:UNRELATED-OPEN') is not null then
    raise exception 'unrelated evidence changed during publication';
  end if;
  if has_table_privilege('authenticated','public.ecoflow_product_identity_batch_scope_items','INSERT')
    or has_table_privilege('authenticated','public.ecoflow_product_identity_batch_scope_items','UPDATE')
    or has_table_privilege('authenticated','public.ecoflow_product_identity_batch_scope_items','DELETE') then
    raise exception 'browser has direct scoped-batch DML';
  end if;
end
$$;

reset app.test_role;
