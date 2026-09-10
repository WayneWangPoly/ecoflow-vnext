\set ON_ERROR_STOP on

begin;

do $$
declare
  v_actor uuid := '11111111-1111-4111-8111-111111111111';
  v_run uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
  v_token uuid;
  v_result jsonb;
begin
  if has_function_privilege('anon','public.ecoflow_claim_unleashed_warehouse_snapshot_acquisition(uuid,text,integer,uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.ecoflow_release_unleashed_warehouse_snapshot_acquisition(uuid,uuid,text,jsonb)','EXECUTE') then
    raise exception 'UNLEASHED_WAREHOUSE_TARGET_BROWSER_PRIVILEGE_OPEN';
  end if;

  insert into public.unleashed_sync_runs(
    id,run_type,status,requested_by,dry_run,resource_set,page_size,max_pages,started_at,metadata
  ) values (
    v_run,'BOUNDED_SNAPSHOT','RUNNING',v_actor,false,array['stock_on_hand'],200,5,now(),
    jsonb_build_object(
      'target',jsonb_build_object('warehouseCode','ADL1'),
      'pagination_window',jsonb_build_object('start_page',1,'previous_run_id',null)
    )
  );

  v_result := public.ecoflow_claim_unleashed_warehouse_snapshot_acquisition(v_run,'stock_on_hand',1,null);
  v_token := (v_result->>'leaseToken')::uuid;
  if v_token is null or v_result->>'warehouseCode'<>'ADL1'
     or (v_result->>'cardinality')<>'MANY' then
    raise exception 'UNLEASHED_WAREHOUSE_TARGET_CLAIM_INVALID';
  end if;

  perform public.ecoflow_commit_unleashed_snapshot_page(
    v_token,v_run,'stock_on_hand','/StockOnHand/1',1,200,200,2,0,repeat('a',64),
    '{"warehouseCode":"ADL1","pageSize":"200"}'::jsonb,
    '{"PageNumber":1,"NumberOfPages":2}'::jsonb,
    '{"target":{"warehouseCode":"ADL1"}}'::jsonb,'[]'::jsonb,'[]'::jsonb
  );
  perform public.ecoflow_commit_unleashed_snapshot_page(
    v_token,v_run,'stock_on_hand','/StockOnHand/2',2,200,200,1,0,repeat('b',64),
    '{"warehouseCode":"ADL1","pageSize":"200"}'::jsonb,
    '{"PageNumber":2,"NumberOfPages":2}'::jsonb,
    '{"target":{"warehouseCode":"ADL1"}}'::jsonb,'[]'::jsonb,'[]'::jsonb
  );

  v_result := public.ecoflow_release_unleashed_warehouse_snapshot_acquisition(
    v_token,v_run,'stock_on_hand',
    '{"start_page":1,"last_page":2,"number_of_pages":2,"window_complete":true,"next_page":null,"previous_run_id":null}'::jsonb
  );
  if coalesce((v_result->>'released')::boolean,false) is not true
     or (v_result->>'validatedPages')::integer<>2
     or coalesce((v_result->>'windowComplete')::boolean,false) is not true then
    raise exception 'UNLEASHED_WAREHOUSE_TARGET_RELEASE_RESULT_INVALID';
  end if;
  if exists(select 1 from public.unleashed_snapshot_acquisition_leases where run_id=v_run) then
    raise exception 'UNLEASHED_WAREHOUSE_TARGET_LEASE_NOT_RELEASED';
  end if;
  if exists(select 1 from public.unleashed_resource_cursors where resource='stock_on_hand') then
    raise exception 'UNLEASHED_WAREHOUSE_TARGET_PUBLISHED_GLOBAL_CURSOR';
  end if;
end;
$$;

do $$
declare
  v_actor uuid := '11111111-1111-4111-8111-111111111111';
  v_bad_query uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2';
  v_bad_continuation uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3';
  v_token uuid;
begin
  insert into public.unleashed_sync_runs(
    id,run_type,status,requested_by,dry_run,resource_set,page_size,max_pages,started_at,metadata
  ) values
    (
      v_bad_query,'BOUNDED_SNAPSHOT','RUNNING',v_actor,false,array['stock_on_hand'],200,5,now(),
      '{"target":{"warehouseCode":"ADL1"},"pagination_window":{"start_page":1,"previous_run_id":null}}'::jsonb
    ),
    (
      v_bad_continuation,'BOUNDED_SNAPSHOT','RUNNING',v_actor,false,array['stock_on_hand'],200,5,now(),
      jsonb_build_object(
        'target',jsonb_build_object('warehouseCode','MAIN'),
        'pagination_window',jsonb_build_object('start_page',6,'previous_run_id',v_bad_query)
      )
    );

  begin
    perform public.ecoflow_claim_unleashed_warehouse_snapshot_acquisition(
      v_bad_continuation,'stock_on_hand',6,v_bad_query
    );
    raise exception 'EXPECTED_WAREHOUSE_CONTINUATION_REJECTION_NOT_RAISED';
  exception when others then
    if sqlerrm not like '%UNLEASHED_WAREHOUSE_TARGET_WINDOW_INVALID%' then raise; end if;
  end;

  v_token := (
    public.ecoflow_claim_unleashed_warehouse_snapshot_acquisition(v_bad_query,'stock_on_hand',1,null)
    ->>'leaseToken'
  )::uuid;
  perform public.ecoflow_commit_unleashed_snapshot_page(
    v_token,v_bad_query,'stock_on_hand','/StockOnHand/1',1,200,200,1,0,repeat('c',64),
    '{"warehouseCode":"MAIN","pageSize":"200"}'::jsonb,
    '{"PageNumber":1,"NumberOfPages":1}'::jsonb,
    '{"target":{"warehouseCode":"ADL1"}}'::jsonb,'[]'::jsonb,'[]'::jsonb
  );
  begin
    perform public.ecoflow_release_unleashed_warehouse_snapshot_acquisition(
      v_token,v_bad_query,'stock_on_hand',
      '{"start_page":1,"last_page":1,"number_of_pages":1,"window_complete":true,"next_page":null,"previous_run_id":null}'::jsonb
    );
    raise exception 'EXPECTED_WAREHOUSE_QUERY_SCOPE_REJECTION_NOT_RAISED';
  exception when others then
    if sqlerrm not like '%UNLEASHED_WAREHOUSE_TARGET_BATCH_MISMATCH%' then raise; end if;
  end;
  delete from public.unleashed_snapshot_acquisition_leases where run_id=v_bad_query;
end;
$$;

do $$
declare
  v_actor uuid := '11111111-1111-4111-8111-111111111111';
  v_page1 uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4';
  v_page2 uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5';
  v_token uuid;
  v_result jsonb;
begin
  insert into public.unleashed_sync_runs(
    id,run_type,status,requested_by,dry_run,resource_set,page_size,max_pages,started_at,metadata
  ) values
    (
      v_page1,'BOUNDED_SNAPSHOT','RUNNING',v_actor,false,array['stock_on_hand'],200,5,now(),
      '{"target":{"warehouseCode":"ADL1"},"pagination_window":{"start_page":1,"previous_run_id":null}}'::jsonb
    ),
    (
      v_page2,'BOUNDED_SNAPSHOT','RUNNING',v_actor,false,array['stock_on_hand'],200,5,now(),
      '{"target":{"warehouseCode":"ADL1"},"pagination_window":{"start_page":1,"previous_run_id":null}}'::jsonb
    );

  v_token := (
    public.ecoflow_claim_unleashed_warehouse_snapshot_acquisition(v_page1,'stock_on_hand',1,null)
    ->>'leaseToken'
  )::uuid;
  perform public.ecoflow_record_unleashed_snapshot_page_failure(
    v_token,v_page1,'stock_on_hand','/StockOnHand/1',1,200,503,repeat('d',64),
    '{"warehouseCode":"ADL1","pageSize":"200"}'::jsonb,
    'UNLEASHED_HTTP_503','upstream unavailable','{"target":{"warehouseCode":"ADL1"}}'::jsonb
  );
  v_result := public.ecoflow_abort_unleashed_warehouse_snapshot_acquisition(
    v_token,v_page1,'stock_on_hand'
  );
  if coalesce((v_result->>'aborted')::boolean,false) is not true
     or (v_result->>'failedPage')::integer<>1
     or exists(select 1 from public.unleashed_snapshot_acquisition_leases where run_id=v_page1) then
    raise exception 'UNLEASHED_WAREHOUSE_TARGET_PAGE1_ABORT_INVALID';
  end if;

  v_token := (
    public.ecoflow_claim_unleashed_warehouse_snapshot_acquisition(v_page2,'stock_on_hand',1,null)
    ->>'leaseToken'
  )::uuid;
  perform public.ecoflow_commit_unleashed_snapshot_page(
    v_token,v_page2,'stock_on_hand','/StockOnHand/1',1,200,200,2,0,repeat('e',64),
    '{"warehouseCode":"ADL1","pageSize":"200"}'::jsonb,
    '{"PageNumber":1,"NumberOfPages":3}'::jsonb,
    '{"target":{"warehouseCode":"ADL1"}}'::jsonb,'[]'::jsonb,'[]'::jsonb
  );
  perform public.ecoflow_record_unleashed_snapshot_page_failure(
    v_token,v_page2,'stock_on_hand','/StockOnHand/2',2,200,500,repeat('f',64),
    '{"warehouseCode":"ADL1","pageSize":"200"}'::jsonb,
    'UNLEASHED_HTTP_500','later page failed','{"target":{"warehouseCode":"ADL1"}}'::jsonb
  );
  v_result := public.ecoflow_abort_unleashed_warehouse_snapshot_acquisition(
    v_token,v_page2,'stock_on_hand'
  );
  if coalesce((v_result->>'aborted')::boolean,false) is not true
     or (v_result->>'failedPage')::integer<>2
     or (v_result->>'validatedPages')::integer<>2
     or exists(select 1 from public.unleashed_snapshot_acquisition_leases where run_id=v_page2) then
    raise exception 'UNLEASHED_WAREHOUSE_TARGET_LATER_PAGE_ABORT_INVALID';
  end if;
  if exists(select 1 from public.unleashed_resource_cursors where resource='stock_on_hand') then
    raise exception 'UNLEASHED_WAREHOUSE_TARGET_ABORT_PUBLISHED_GLOBAL_CURSOR';
  end if;
end;
$$;

select 'UNLEASHED_WAREHOUSE_STOCK_SCOPE_DB_CONTRACT_PASS' as result;

rollback;
