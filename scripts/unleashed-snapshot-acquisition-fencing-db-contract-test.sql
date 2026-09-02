\set ON_ERROR_STOP on

begin;

-- Browser roles must never see or mutate fencing leases or invoke the lease RPCs.
do $$
begin
  if has_table_privilege('anon','public.unleashed_snapshot_acquisition_leases','SELECT')
     or has_table_privilege('authenticated','public.unleashed_snapshot_acquisition_leases','SELECT')
     or has_table_privilege('anon','public.unleashed_snapshot_acquisition_leases','INSERT')
     or has_table_privilege('authenticated','public.unleashed_snapshot_acquisition_leases','UPDATE') then
    raise exception 'UNLEASHED_ACQUISITION_BROWSER_LEASE_PRIVILEGE_OPEN';
  end if;
  if has_function_privilege('anon','public.ecoflow_claim_unleashed_snapshot_acquisition(uuid,text,integer,uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.ecoflow_commit_unleashed_snapshot_page(uuid,uuid,text,text,integer,integer,integer,integer,integer,text,jsonb,jsonb,jsonb,jsonb,jsonb)','EXECUTE') then
    raise exception 'UNLEASHED_ACQUISITION_BROWSER_RPC_PRIVILEGE_OPEN';
  end if;
end;
$$;

-- Root claim serializes the resource. A second active worker must fail closed.
do $$
declare
  v_actor uuid := '11111111-1111-4111-8111-111111111111';
  v_run1 uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  v_run2 uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
  v_token uuid;
  v_result jsonb;
begin
  insert into public.unleashed_sync_runs(id,run_type,status,requested_by,dry_run,resource_set,page_size,max_pages,started_at,metadata)
  values
    (v_run1,'BOUNDED_SNAPSHOT','RUNNING',v_actor,false,array['products'],100,5,now(),jsonb_build_object('pagination_window',jsonb_build_object('start_page',1,'previous_run_id',null))),
    (v_run2,'BOUNDED_SNAPSHOT','RUNNING',v_actor,false,array['products'],100,5,now(),jsonb_build_object('pagination_window',jsonb_build_object('start_page',1,'previous_run_id',null)));

  insert into public.unleashed_resource_cursors(
    resource,cursor_status,high_watermark_at,next_modified_since,metadata
  ) values (
    'products','READY','2026-09-01T00:00:00Z','2026-09-01T00:00:00Z',
    jsonb_build_object('legacy_ready_checkpoint',true)
  );

  v_result := public.ecoflow_claim_unleashed_snapshot_acquisition(v_run1,'products',1,null);
  v_token := (v_result->>'leaseToken')::uuid;
  if v_token is null or (v_result->>'replayed')::boolean then
    raise exception 'UNLEASHED_ACQUISITION_ROOT_CLAIM_INVALID';
  end if;
  if not exists (
    select 1 from public.unleashed_resource_cursors c
    where c.resource='products' and c.cursor_status='RUNNING'
      and c.last_successful_run_id is null and c.high_watermark_at is null
      and c.next_modified_since is null
      and c.metadata->'pagination_window'->>'run_id'=v_run1::text
  ) then
    raise exception 'UNLEASHED_ACQUISITION_ROOT_CLAIM_DID_NOT_INVALIDATE_READY_CURSOR';
  end if;

  begin
    perform public.ecoflow_claim_unleashed_snapshot_acquisition(v_run2,'products',1,null);
    raise exception 'EXPECTED_BUSY_NOT_RAISED';
  exception when others then
    if sqlerrm not like '%UNLEASHED_ACQUISITION_RESOURCE_LEASE_BUSY%' then raise; end if;
  end;

  -- The same run may replay its exact claim idempotently.
  v_result := public.ecoflow_claim_unleashed_snapshot_acquisition(v_run1,'products',1,null);
  if not (v_result->>'replayed')::boolean or (v_result->>'leaseToken')::uuid<>v_token then
    raise exception 'UNLEASHED_ACQUISITION_CLAIM_REPLAY_CHANGED_TOKEN';
  end if;

  -- Only the current fencing token may commit a page.
  begin
    perform public.ecoflow_commit_unleashed_snapshot_page(
      gen_random_uuid(),v_run1,'products','/Products/1',1,100,200,1,1,repeat('a',64),
      '{}'::jsonb,'{"PageNumber":1,"NumberOfPages":2}'::jsonb,'{}'::jsonb,'[]'::jsonb,'[]'::jsonb
    );
    raise exception 'EXPECTED_FENCE_NOT_RAISED';
  exception when others then
    if sqlerrm not like '%UNLEASHED_ACQUISITION_LEASE_LOST%' then raise; end if;
  end;

  perform public.ecoflow_commit_unleashed_snapshot_page(
    v_token,v_run1,'products','/Products/1',1,100,200,1,1,repeat('a',64),
    '{}'::jsonb,'{"PageNumber":1,"NumberOfPages":2}'::jsonb,
    '{"records_inserted":1,"records_changed":0,"records_unchanged":0}'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'external_key','guid:product-1','external_guid','product-1','external_code','SKU-1',
      'external_number',null,'display_name','Product 1','source_last_modified_at','2026-09-02T00:00:00Z',
      'payload',jsonb_build_object('Guid','product-1','ProductCode','SKU-1'),
      'payload_sha256',repeat('b',64),'payload_object_keys',jsonb_build_array('Guid','ProductCode'),
      'metadata',jsonb_build_object('source','unleashed_api')
    )),
    jsonb_build_array(jsonb_build_object(
      'external_key','guid:product-1','external_guid','product-1','external_code','SKU-1',
      'external_number',null,'display_name','Product 1','latest_payload_sha256',repeat('b',64),
      'latest_source_last_modified_at','2026-09-02T00:00:00Z','metadata',jsonb_build_object('source','unleashed_api')
    ))
  );

  begin
    perform public.ecoflow_finalize_unleashed_snapshot_resource(
      v_token,v_run1,'products','RUNNING',
      jsonb_build_object(
        'start_page',1,'last_page',2,'number_of_pages',2,'window_complete',false,
        'next_page',3,'previous_run_id',null,'high_watermark','2026-09-02T00:00:00Z'
      ),null,'2026-09-02T00:00:00Z',null,null
    );
    raise exception 'EXPECTED_WINDOW_BATCH_MISMATCH_NOT_RAISED';
  exception when others then
    if sqlerrm not like '%UNLEASHED_ACQUISITION_WINDOW_BATCH_MISMATCH%' then raise; end if;
  end;

  perform public.ecoflow_finalize_unleashed_snapshot_resource(
    v_token,v_run1,'products','RUNNING',
    jsonb_build_object(
      'start_page',1,'last_page',1,'number_of_pages',2,'window_complete',false,
      'next_page',2,'previous_run_id',null,'high_watermark','2026-09-02T00:00:00Z'
    ),null,'2026-09-02T00:00:00Z',null,null
  );

  update public.unleashed_sync_runs set
    status='SUCCEEDED',completed_at=now(),
    metadata=jsonb_build_object('pagination_windows',jsonb_build_array(jsonb_build_object(
      'resource','products','start_page',1,'last_page',1,'number_of_pages',2,
      'window_complete',false,'next_page',2,'previous_run_id',null
    )))
  where id=v_run1;

  if not exists (
    select 1 from public.unleashed_resource_cursors c
    where c.resource='products' and c.cursor_status='RUNNING'
      and c.last_successful_run_id is null and c.next_modified_since is null
      and c.metadata->'pagination_window'->>'run_id'=v_run1::text
      and (c.metadata->'pagination_window'->>'next_page')::integer=2
  ) then
    raise exception 'UNLEASHED_ACQUISITION_INCOMPLETE_CURSOR_NOT_FENCED';
  end if;
end;
$$;

-- Continuation claim is bound to the cursor's exact prior run/next-page evidence.
do $$
declare
  v_actor uuid := '11111111-1111-4111-8111-111111111111';
  v_run1 uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  v_run3 uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
  v_bad uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
  v_token uuid;
begin
  insert into public.unleashed_sync_runs(id,run_type,status,requested_by,dry_run,resource_set,page_size,max_pages,started_at,metadata)
  values
    (v_run3,'BOUNDED_SNAPSHOT','RUNNING',v_actor,false,array['products'],100,5,now(),jsonb_build_object('pagination_window',jsonb_build_object('start_page',2,'previous_run_id',v_run1))),
    (v_bad,'BOUNDED_SNAPSHOT','RUNNING',v_actor,false,array['products'],100,5,now(),jsonb_build_object('pagination_window',jsonb_build_object('start_page',3,'previous_run_id',v_run1)));

  begin
    perform public.ecoflow_claim_unleashed_snapshot_acquisition(v_bad,'products',3,v_run1);
    raise exception 'EXPECTED_CONTINUATION_MISMATCH_NOT_RAISED';
  exception when others then
    if sqlerrm not like '%UNLEASHED_ACQUISITION_CONTINUATION_CURSOR_MISMATCH%' then raise; end if;
  end;

  v_token := (public.ecoflow_claim_unleashed_snapshot_acquisition(v_run3,'products',2,v_run1)->>'leaseToken')::uuid;
  perform public.ecoflow_commit_unleashed_snapshot_page(
    v_token,v_run3,'products','/Products/2',2,100,200,0,0,repeat('c',64),
    '{}'::jsonb,'{"PageNumber":2,"NumberOfPages":2}'::jsonb,'{}'::jsonb,'[]'::jsonb,'[]'::jsonb
  );
  perform public.ecoflow_finalize_unleashed_snapshot_resource(
    v_token,v_run3,'products','READY',
    jsonb_build_object(
      'start_page',2,'last_page',2,'number_of_pages',2,'window_complete',true,
      'next_page',null,'previous_run_id',v_run1,'high_watermark','2026-09-02T00:00:00Z'
    ),null,'2026-09-02T00:00:00Z',null,null
  );
  update public.unleashed_sync_runs set status='SUCCEEDED',completed_at=now(),metadata=jsonb_build_object(
    'pagination_windows',jsonb_build_array(jsonb_build_object(
      'resource','products','start_page',2,'last_page',2,'number_of_pages',2,
      'window_complete',true,'next_page',null,'previous_run_id',v_run1
    ))) where id=v_run3;

  if not exists (
    select 1 from public.unleashed_resource_cursors c
    where c.resource='products' and c.cursor_status='READY' and c.last_successful_run_id=v_run3
  ) then raise exception 'UNLEASHED_ACQUISITION_TERMINAL_CURSOR_NOT_READY'; end if;
end;
$$;

-- Lease takeover after expiry fences the old token permanently.
do $$
declare
  v_actor uuid := '11111111-1111-4111-8111-111111111111';
  v_old uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
  v_new uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
  v_old_token uuid;
  v_new_token uuid;
begin
  insert into public.unleashed_sync_runs(id,run_type,status,requested_by,dry_run,resource_set,page_size,max_pages,started_at,metadata)
  values
    (v_old,'BOUNDED_SNAPSHOT','RUNNING',v_actor,false,array['customers'],100,5,now(),jsonb_build_object('pagination_window',jsonb_build_object('start_page',1,'previous_run_id',null))),
    (v_new,'BOUNDED_SNAPSHOT','RUNNING',v_actor,false,array['customers'],100,5,now(),jsonb_build_object('pagination_window',jsonb_build_object('start_page',1,'previous_run_id',null)));

  v_old_token := (public.ecoflow_claim_unleashed_snapshot_acquisition(v_old,'customers',1,null)->>'leaseToken')::uuid;
  update public.unleashed_snapshot_acquisition_leases set
    acquired_at=clock_timestamp()-interval '20 minutes',
    expires_at=clock_timestamp()-interval '1 second'
  where resource='customers';
  v_new_token := (public.ecoflow_claim_unleashed_snapshot_acquisition(v_new,'customers',1,null)->>'leaseToken')::uuid;
  if v_new_token=v_old_token then raise exception 'UNLEASHED_ACQUISITION_TAKEOVER_REUSED_TOKEN'; end if;

  begin
    perform public.ecoflow_commit_unleashed_snapshot_page(
      v_old_token,v_old,'customers','/Customers/1',1,100,200,0,0,repeat('d',64),
      '{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'[]'::jsonb,'[]'::jsonb
    );
    raise exception 'EXPECTED_EXPIRED_WORKER_FENCE_NOT_RAISED';
  exception when others then
    if sqlerrm not like '%UNLEASHED_ACQUISITION_LEASE_LOST%' then raise; end if;
  end;
end;
$$;

-- Two full, validated chains must have identical ordered page-response hashes.
do $$
declare
  v_acq1 uuid := 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
  v_acq2 uuid := 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
  v_chk1 uuid := 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
  v_chk2 uuid := 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';
  v_result jsonb;
begin
  insert into public.unleashed_sync_runs(id,run_type,status,dry_run,resource_set,page_size,max_pages,metadata)
  values
    (v_acq1,'BOUNDED_SNAPSHOT','SUCCEEDED',false,array['suppliers'],100,1,jsonb_build_object('pagination_windows',jsonb_build_array(jsonb_build_object('resource','suppliers','start_page',1,'last_page',1,'number_of_pages',2,'window_complete',false,'next_page',2,'previous_run_id',null)))),
    (v_acq2,'BOUNDED_SNAPSHOT','SUCCEEDED',false,array['suppliers'],100,1,jsonb_build_object('pagination_windows',jsonb_build_array(jsonb_build_object('resource','suppliers','start_page',2,'last_page',2,'number_of_pages',2,'window_complete',true,'next_page',null,'previous_run_id',v_acq1)))),
    (v_chk1,'BOUNDED_SNAPSHOT','SUCCEEDED',true,array['suppliers'],100,1,jsonb_build_object('pagination_windows',jsonb_build_array(jsonb_build_object('resource','suppliers','start_page',1,'last_page',1,'number_of_pages',2,'window_complete',false,'next_page',2,'previous_run_id',null)))),
    (v_chk2,'BOUNDED_SNAPSHOT','SUCCEEDED',true,array['suppliers'],100,1,jsonb_build_object('pagination_windows',jsonb_build_array(jsonb_build_object('resource','suppliers','start_page',2,'last_page',2,'number_of_pages',2,'window_complete',true,'next_page',null,'previous_run_id',v_chk1))));

  insert into public.unleashed_sync_batches(run_id,resource,endpoint_path,page_number,page_size,status,http_status,response_sha256)
  values
    (v_acq1,'suppliers','/Suppliers/1',1,100,'SUCCEEDED',200,repeat('1',64)),
    (v_acq2,'suppliers','/Suppliers/2',2,100,'SUCCEEDED',200,repeat('2',64)),
    (v_chk1,'suppliers','/Suppliers/1',1,100,'SUCCEEDED',200,repeat('1',64)),
    (v_chk2,'suppliers','/Suppliers/2',2,100,'SUCCEEDED',200,repeat('2',64));

  v_result := public.ecoflow_verify_unleashed_snapshot_reconciliation('suppliers',array[v_acq1,v_acq2],array[v_chk1,v_chk2]);
  if coalesce((v_result->>'equivalent')::boolean,false) is not true
     or (v_result->>'pageCount')::integer<>2
     or v_result->>'acquisitionManifestSha256'<>v_result->>'recheckManifestSha256' then
    raise exception 'UNLEASHED_RECONCILIATION_PASS_RESULT_INVALID';
  end if;

  update public.unleashed_sync_runs set page_size=50 where id in (v_chk1,v_chk2);
  update public.unleashed_sync_batches set page_size=50 where run_id in (v_chk1,v_chk2);
  begin
    perform public.ecoflow_verify_unleashed_snapshot_reconciliation('suppliers',array[v_acq1,v_acq2],array[v_chk1,v_chk2]);
    raise exception 'EXPECTED_RECONCILIATION_PAGE_SIZE_MISMATCH_NOT_RAISED';
  exception when others then
    if sqlerrm not like '%UNLEASHED_RECONCILIATION_PAGE_SIZE_MISMATCH%' then raise; end if;
  end;
  update public.unleashed_sync_runs set page_size=100 where id in (v_chk1,v_chk2);
  update public.unleashed_sync_batches set page_size=100 where run_id in (v_chk1,v_chk2);

  update public.unleashed_sync_batches set response_sha256=repeat('3',64) where run_id=v_chk2 and page_number=2;
  begin
    perform public.ecoflow_verify_unleashed_snapshot_reconciliation('suppliers',array[v_acq1,v_acq2],array[v_chk1,v_chk2]);
    raise exception 'EXPECTED_RECONCILIATION_MISMATCH_NOT_RAISED';
  exception when others then
    if sqlerrm not like '%UNLEASHED_RECONCILIATION_MISMATCH%' then raise; end if;
  end;
end;
$$;

rollback;

select 'UNLEASHED-MIGRATION-002D acquisition fencing DB contract: PASS' as result;
