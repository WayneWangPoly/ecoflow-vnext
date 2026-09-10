begin;

-- #339: database-owned fencing for a bounded, warehouse-only StockOnHand
-- acquisition. This is source evidence only and never publishes the unfiltered
-- stock_on_hand resource cursor.

do $deps$
begin
  if to_regclass('public.unleashed_snapshot_acquisition_leases') is null
     or to_regprocedure('public.ecoflow_commit_unleashed_snapshot_page(uuid,uuid,text,text,integer,integer,integer,integer,integer,text,jsonb,jsonb,jsonb,jsonb,jsonb)') is null then
    raise exception 'UNLEASHED_WAREHOUSE_STOCK_SCOPE_DEPENDENCIES_MISSING';
  end if;
end;
$deps$;

create or replace function public.ecoflow_claim_unleashed_warehouse_snapshot_acquisition(
  p_run_id uuid,
  p_resource text,
  p_start_page integer,
  p_previous_run_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.unleashed_sync_runs%rowtype;
  v_lease public.unleashed_snapshot_acquisition_leases%rowtype;
  v_target jsonb;
  v_warehouse_code text;
  v_token uuid;
  v_generation bigint;
begin
  if p_run_id is null or p_resource<>'stock_on_hand' or p_start_page<>1 or p_previous_run_id is not null then
    raise exception 'UNLEASHED_WAREHOUSE_TARGET_WINDOW_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('unleashed_snapshot_acquisition:' || p_resource, 0)
  );

  select * into v_run
  from public.unleashed_sync_runs r
  where r.id=p_run_id
  for update;

  v_target := v_run.metadata->'target';
  v_warehouse_code := btrim(coalesce(v_target->>'warehouseCode',''));
  if not found or v_run.status<>'RUNNING' or v_run.dry_run
     or v_run.run_type<>'BOUNDED_SNAPSHOT'
     or v_run.resource_set<>array['stock_on_hand']::text[]
     or v_run.page_size not between 1 and 200
     or v_run.max_pages not between 1 and 5
     or jsonb_typeof(v_target)<>'object'
     or (select count(*) from jsonb_object_keys(v_target))<>1
     or v_warehouse_code !~ '^[A-Za-z0-9][A-Za-z0-9 ._/#-]{0,99}$' then
    raise exception 'UNLEASHED_WAREHOUSE_TARGET_RUN_INVALID';
  end if;
  if coalesce((v_run.metadata->'pagination_window'->>'start_page')::integer,0)<>1
     or nullif(v_run.metadata->'pagination_window'->>'previous_run_id','')::uuid is not null then
    raise exception 'UNLEASHED_WAREHOUSE_TARGET_RUN_WINDOW_MISMATCH';
  end if;

  select * into v_lease
  from public.unleashed_snapshot_acquisition_leases l
  where l.resource=p_resource
  for update;

  if found and v_lease.expires_at>clock_timestamp() then
    if v_lease.run_id=p_run_id and v_lease.previous_run_id is null and v_lease.start_page=1 then
      return jsonb_build_object(
        'resource',p_resource,'runId',p_run_id,'warehouseCode',v_warehouse_code,
        'leaseToken',v_lease.lease_token,'generation',v_lease.generation,
        'expiresAt',v_lease.expires_at,'targeted',true,'cardinality','MANY','replayed',true
      );
    end if;
    raise exception 'UNLEASHED_ACQUISITION_RESOURCE_LEASE_BUSY';
  end if;

  v_token := pg_catalog.gen_random_uuid();
  v_generation := case when found then v_lease.generation+1 else 1 end;
  insert into public.unleashed_snapshot_acquisition_leases(
    resource,lease_token,run_id,previous_run_id,start_page,generation,acquired_at,expires_at,updated_at
  ) values (
    p_resource,v_token,p_run_id,null,1,v_generation,
    clock_timestamp(),clock_timestamp()+interval '15 minutes',clock_timestamp()
  )
  on conflict (resource) do update set
    lease_token=excluded.lease_token,
    run_id=excluded.run_id,
    previous_run_id=null,
    start_page=1,
    generation=excluded.generation,
    acquired_at=excluded.acquired_at,
    expires_at=excluded.expires_at,
    updated_at=excluded.updated_at;

  return jsonb_build_object(
    'resource',p_resource,'runId',p_run_id,'warehouseCode',v_warehouse_code,
    'leaseToken',v_token,'generation',v_generation,
    'expiresAt',clock_timestamp()+interval '15 minutes',
    'targeted',true,'cardinality','MANY','replayed',false
  );
end;
$$;

create or replace function public.ecoflow_release_unleashed_warehouse_snapshot_acquisition(
  p_lease_token uuid,
  p_run_id uuid,
  p_resource text,
  p_window jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease public.unleashed_snapshot_acquisition_leases%rowtype;
  v_run public.unleashed_sync_runs%rowtype;
  v_target jsonb;
  v_warehouse_code text;
  v_batch_count integer;
  v_distinct_pages integer;
  v_min_page integer;
  v_max_page integer;
  v_bad_batches integer;
  v_failed_batches integer;
  v_window_complete boolean;
  v_number_of_pages integer;
  v_last_page integer;
  v_next_page integer;
begin
  select * into v_lease
  from public.unleashed_snapshot_acquisition_leases l
  where l.resource=p_resource
  for update;
  if not found or v_lease.run_id<>p_run_id or v_lease.lease_token<>p_lease_token
     or v_lease.expires_at<=clock_timestamp() or v_lease.start_page<>1
     or v_lease.previous_run_id is not null then
    raise exception 'UNLEASHED_ACQUISITION_LEASE_LOST';
  end if;

  select * into v_run
  from public.unleashed_sync_runs r
  where r.id=p_run_id
  for update;
  v_target := v_run.metadata->'target';
  v_warehouse_code := btrim(coalesce(v_target->>'warehouseCode',''));
  if not found or p_resource<>'stock_on_hand' or v_run.status<>'RUNNING' or v_run.dry_run
     or v_run.run_type<>'BOUNDED_SNAPSHOT'
     or v_run.resource_set<>array['stock_on_hand']::text[]
     or v_run.page_size not between 1 and 200 or v_run.max_pages not between 1 and 5
     or jsonb_typeof(v_target)<>'object'
     or (select count(*) from jsonb_object_keys(v_target))<>1
     or v_warehouse_code !~ '^[A-Za-z0-9][A-Za-z0-9 ._/#-]{0,99}$'
     or jsonb_typeof(coalesce(p_window,'null'::jsonb))<>'object' then
    raise exception 'UNLEASHED_WAREHOUSE_TARGET_RELEASE_INVALID';
  end if;

  begin
    v_last_page := (p_window->>'last_page')::integer;
    v_number_of_pages := nullif(p_window->>'number_of_pages','')::integer;
    v_next_page := nullif(p_window->>'next_page','')::integer;
    v_window_complete := (p_window->>'window_complete')::boolean;
  exception when others then
    raise exception 'UNLEASHED_WAREHOUSE_TARGET_WINDOW_EVIDENCE_INVALID';
  end;
  if coalesce((p_window->>'start_page')::integer,0)<>1
     or nullif(p_window->>'previous_run_id','')::uuid is not null
     or coalesce(v_last_page,0)<1
     or v_last_page>v_run.max_pages
     or v_number_of_pages is null or v_number_of_pages<1
     or (v_window_complete and (v_last_page<v_number_of_pages or v_next_page is not null))
     or (not v_window_complete and (v_last_page>=v_number_of_pages or v_next_page<>v_last_page+1)) then
    raise exception 'UNLEASHED_WAREHOUSE_TARGET_WINDOW_EVIDENCE_INVALID';
  end if;

  select
    count(*),count(distinct b.page_number),min(b.page_number),max(b.page_number),
    count(*) filter (
      where b.status not in ('SUCCEEDED','FAILED')
         or b.page_size<>v_run.page_size
         or b.endpoint_path<>('/StockOnHand/' || b.page_number::text)
         or upper(btrim(coalesce(b.query_params->>'warehouseCode','')))<>upper(v_warehouse_code)
         or b.query_params->>'pageSize'<>v_run.page_size::text
         or b.query_params ? 'productId'
         or (b.query_params - 'warehouseCode' - 'pageSize')<>'{}'::jsonb
    ),
    count(*) filter (where b.status='FAILED')
  into v_batch_count,v_distinct_pages,v_min_page,v_max_page,v_bad_batches,v_failed_batches
  from public.unleashed_sync_batches b
  where b.run_id=p_run_id and b.resource=p_resource;

  if v_batch_count<1 or v_batch_count>v_run.max_pages
     or v_distinct_pages<>v_batch_count or v_min_page<>1 or v_max_page<>v_batch_count
     or v_max_page<>v_last_page or v_bad_batches<>0 then
    raise exception 'UNLEASHED_WAREHOUSE_TARGET_BATCH_MISMATCH';
  end if;

  delete from public.unleashed_snapshot_acquisition_leases
  where resource=p_resource and run_id=p_run_id and lease_token=p_lease_token;
  if not found then raise exception 'UNLEASHED_ACQUISITION_LEASE_LOST'; end if;

  return jsonb_build_object(
    'resource',p_resource,'runId',p_run_id,'warehouseCode',v_warehouse_code,
    'targeted',true,'cardinality','MANY','released',true,
    'validatedPages',v_batch_count,'failedPages',v_failed_batches,
    'windowComplete',v_window_complete
  );
end;
$$;

revoke all on function public.ecoflow_claim_unleashed_warehouse_snapshot_acquisition(uuid,text,integer,uuid)
  from public,anon,authenticated;
revoke all on function public.ecoflow_release_unleashed_warehouse_snapshot_acquisition(uuid,uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.ecoflow_claim_unleashed_warehouse_snapshot_acquisition(uuid,text,integer,uuid)
  to service_role;
grant execute on function public.ecoflow_release_unleashed_warehouse_snapshot_acquisition(uuid,uuid,text,jsonb)
  to service_role;

commit;
