begin;

-- UNLEASHED-MIGRATION-002D: database-owned fencing for bounded snapshot
-- acquisition. This is a #337 connector hardening prerequisite for #338; it
-- is intentionally separate from the single #338 master-data bridge migration.

do $deps$
declare
  v_missing text[] := '{}';
begin
  if to_regclass('public.unleashed_sync_runs') is null then
    v_missing := array_append(v_missing, 'unleashed_sync_runs');
  end if;
  if to_regclass('public.unleashed_sync_batches') is null then
    v_missing := array_append(v_missing, 'unleashed_sync_batches');
  end if;
  if to_regclass('public.unleashed_raw_snapshots') is null then
    v_missing := array_append(v_missing, 'unleashed_raw_snapshots');
  end if;
  if to_regclass('public.unleashed_external_identities') is null then
    v_missing := array_append(v_missing, 'unleashed_external_identities');
  end if;
  if to_regclass('public.unleashed_resource_cursors') is null then
    v_missing := array_append(v_missing, 'unleashed_resource_cursors');
  end if;
  if to_regprocedure('extensions.digest(text,text)') is null then
    v_missing := array_append(v_missing, 'extensions.digest(text,text)');
  end if;
  if array_length(v_missing, 1) is not null then
    raise exception 'UNLEASHED_ACQUISITION_FENCING_DEPENDENCIES_MISSING:%', array_to_string(v_missing, ',');
  end if;
end;
$deps$;

create table if not exists public.unleashed_snapshot_acquisition_leases (
  resource text primary key,
  lease_token uuid not null,
  run_id uuid not null references public.unleashed_sync_runs(id) on delete cascade,
  previous_run_id uuid references public.unleashed_sync_runs(id) on delete set null,
  start_page integer not null,
  generation bigint not null default 1,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unleashed_snapshot_acquisition_leases_start_page_check check (start_page >= 1),
  constraint unleashed_snapshot_acquisition_leases_generation_check check (generation >= 1),
  constraint unleashed_snapshot_acquisition_leases_expiry_check check (expires_at > acquired_at)
);

alter table public.unleashed_snapshot_acquisition_leases enable row level security;
revoke all on table public.unleashed_snapshot_acquisition_leases from public, anon, authenticated;
grant select, insert, update, delete on table public.unleashed_snapshot_acquisition_leases to service_role;

create or replace function public.ecoflow_claim_unleashed_snapshot_acquisition(
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
  v_cursor public.unleashed_resource_cursors%rowtype;
  v_lease public.unleashed_snapshot_acquisition_leases%rowtype;
  v_token uuid;
  v_generation bigint;
  v_cursor_run_id uuid;
  v_cursor_next_page integer;
begin
  if p_run_id is null or length(btrim(coalesce(p_resource,'')))=0 or coalesce(p_start_page,0)<1 then
    raise exception 'UNLEASHED_ACQUISITION_LEASE_INVALID';
  end if;

  -- Serialize claim/reclaim for one resource even when no lease row exists yet.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('unleashed_snapshot_acquisition:' || p_resource, 0)
  );

  select * into v_run
  from public.unleashed_sync_runs r
  where r.id=p_run_id
  for update;
  if not found or v_run.status<>'RUNNING' or v_run.dry_run
     or v_run.run_type<>'BOUNDED_SNAPSHOT' or v_run.max_pages not between 1 and 5 then
    raise exception 'UNLEASHED_ACQUISITION_RUN_NOT_WRITABLE';
  end if;
  if not (p_resource = any(v_run.resource_set)) then
    raise exception 'UNLEASHED_ACQUISITION_RESOURCE_NOT_IN_RUN';
  end if;
  if coalesce((v_run.metadata->'pagination_window'->>'start_page')::integer, 1) <> p_start_page
     or nullif(v_run.metadata->'pagination_window'->>'previous_run_id','')::uuid is distinct from p_previous_run_id then
    raise exception 'UNLEASHED_ACQUISITION_RUN_WINDOW_MISMATCH';
  end if;

  select * into v_cursor
  from public.unleashed_resource_cursors c
  where c.resource=p_resource
  for update;
  if found and v_cursor.cursor_status='DISABLED' then
    raise exception 'UNLEASHED_ACQUISITION_RESOURCE_DISABLED';
  end if;

  if p_start_page>1 then
    if not found or v_cursor.cursor_status<>'RUNNING' then
      raise exception 'UNLEASHED_ACQUISITION_CONTINUATION_CURSOR_MISSING';
    end if;
    begin
      v_cursor_run_id := nullif(v_cursor.metadata->'pagination_window'->>'run_id','')::uuid;
      v_cursor_next_page := nullif(v_cursor.metadata->'pagination_window'->>'next_page','')::integer;
    exception when others then
      raise exception 'UNLEASHED_ACQUISITION_CONTINUATION_CURSOR_INVALID';
    end;
    if v_cursor_run_id is distinct from p_previous_run_id or v_cursor_next_page is distinct from p_start_page then
      raise exception 'UNLEASHED_ACQUISITION_CONTINUATION_CURSOR_MISMATCH';
    end if;
  elsif p_previous_run_id is not null then
    raise exception 'UNLEASHED_ACQUISITION_ROOT_PREVIOUS_RUN_FORBIDDEN';
  end if;

  select * into v_lease
  from public.unleashed_snapshot_acquisition_leases l
  where l.resource=p_resource
  for update;

  if found and v_lease.expires_at>clock_timestamp() then
    if v_lease.run_id=p_run_id
       and v_lease.previous_run_id is not distinct from p_previous_run_id
       and v_lease.start_page=p_start_page then
      return jsonb_build_object(
        'resource',p_resource,
        'runId',p_run_id,
        'leaseToken',v_lease.lease_token,
        'generation',v_lease.generation,
        'expiresAt',v_lease.expires_at,
        'replayed',true
      );
    end if;
    raise exception 'UNLEASHED_ACQUISITION_RESOURCE_LEASE_BUSY';
  end if;

  v_token := pg_catalog.gen_random_uuid();
  v_generation := case when found then v_lease.generation+1 else 1 end;

  insert into public.unleashed_snapshot_acquisition_leases(
    resource,lease_token,run_id,previous_run_id,start_page,generation,acquired_at,expires_at,updated_at
  ) values (
    p_resource,v_token,p_run_id,p_previous_run_id,p_start_page,v_generation,
    clock_timestamp(),clock_timestamp()+interval '15 minutes',clock_timestamp()
  )
  on conflict (resource) do update set
    lease_token=excluded.lease_token,
    run_id=excluded.run_id,
    previous_run_id=excluded.previous_run_id,
    start_page=excluded.start_page,
    generation=excluded.generation,
    acquired_at=excluded.acquired_at,
    expires_at=excluded.expires_at,
    updated_at=excluded.updated_at;

  -- Root acquisition invalidates any older consumable READY checkpoint at
  -- claim time, not after the first network window has already completed.
  if p_start_page=1 then
    insert into public.unleashed_resource_cursors(
      resource,cursor_status,last_successful_run_id,last_successful_at,last_successful_modified_since,
      high_watermark_at,next_modified_since,last_error_code,last_error_message,metadata
    ) values (
      p_resource,'RUNNING',null,null,null,null,null,null,null,
      jsonb_build_object(
        'dry_run',false,
        'pagination_window',jsonb_build_object(
          'run_id',p_run_id,'start_page',1,'previous_run_id',null,'acquisition_in_progress',true
        )
      )
    )
    on conflict (resource) do update set
      cursor_status='RUNNING',
      last_successful_run_id=null,
      last_successful_at=null,
      last_successful_modified_since=null,
      high_watermark_at=null,
      next_modified_since=null,
      last_error_code=null,
      last_error_message=null,
      metadata=excluded.metadata;
  end if;

  return jsonb_build_object(
    'resource',p_resource,
    'runId',p_run_id,
    'leaseToken',v_token,
    'generation',v_generation,
    'expiresAt',clock_timestamp()+interval '15 minutes',
    'replayed',false
  );
end;
$$;

create or replace function public.ecoflow_commit_unleashed_snapshot_page(
  p_lease_token uuid,
  p_run_id uuid,
  p_resource text,
  p_endpoint_path text,
  p_page_number integer,
  p_page_size integer,
  p_http_status integer,
  p_records_seen integer,
  p_records_staged integer,
  p_response_sha256 text,
  p_query_params jsonb,
  p_pagination jsonb,
  p_batch_metadata jsonb,
  p_snapshot_rows jsonb,
  p_identity_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease public.unleashed_snapshot_acquisition_leases%rowtype;
  v_run public.unleashed_sync_runs%rowtype;
  v_batch_id uuid;
  v_snapshot_count integer := 0;
  v_identity_count integer := 0;
begin
  select * into v_lease
  from public.unleashed_snapshot_acquisition_leases l
  where l.resource=p_resource
  for update;
  if not found or v_lease.run_id<>p_run_id or v_lease.lease_token<>p_lease_token
     or v_lease.expires_at<=clock_timestamp() then
    raise exception 'UNLEASHED_ACQUISITION_LEASE_LOST';
  end if;

  select * into v_run
  from public.unleashed_sync_runs r
  where r.id=p_run_id
  for update;
  if not found or v_run.status<>'RUNNING' or v_run.dry_run or not (p_resource=any(v_run.resource_set)) then
    raise exception 'UNLEASHED_ACQUISITION_RUN_LOST';
  end if;
  if coalesce(p_page_number,0)<v_lease.start_page
     or p_page_number>v_lease.start_page+v_run.max_pages-1
     or coalesce(p_page_size,0) not between 1 and 200
     or p_page_size<>v_run.page_size
     or coalesce(p_http_status,0) not between 200 and 299
     or p_response_sha256 !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(coalesce(p_query_params,'{}'::jsonb))<>'object'
     or jsonb_typeof(coalesce(p_pagination,'{}'::jsonb))<>'object'
     or jsonb_typeof(coalesce(p_batch_metadata,'{}'::jsonb))<>'object'
     or jsonb_typeof(coalesce(p_snapshot_rows,'[]'::jsonb))<>'array'
     or jsonb_typeof(coalesce(p_identity_rows,'[]'::jsonb))<>'array' then
    raise exception 'UNLEASHED_ACQUISITION_PAGE_INVALID';
  end if;

  insert into public.unleashed_raw_snapshots(
    resource,external_key,external_guid,external_code,external_number,display_name,
    source_last_modified_at,payload,payload_sha256,payload_object_keys,
    first_seen_run_id,last_seen_run_id,metadata
  )
  select
    p_resource,x.external_key,x.external_guid,x.external_code,x.external_number,x.display_name,
    x.source_last_modified_at,x.payload,x.payload_sha256,coalesce(x.payload_object_keys,'{}'::text[]),
    p_run_id,p_run_id,coalesce(x.metadata,'{}'::jsonb)
  from jsonb_to_recordset(coalesce(p_snapshot_rows,'[]'::jsonb)) as x(
    external_key text,
    external_guid text,
    external_code text,
    external_number text,
    display_name text,
    source_last_modified_at timestamptz,
    payload jsonb,
    payload_sha256 text,
    payload_object_keys text[],
    metadata jsonb
  )
  on conflict (resource,external_key) do update set
    external_guid=excluded.external_guid,
    external_code=excluded.external_code,
    external_number=excluded.external_number,
    display_name=excluded.display_name,
    source_last_modified_at=excluded.source_last_modified_at,
    payload=excluded.payload,
    payload_sha256=excluded.payload_sha256,
    payload_object_keys=excluded.payload_object_keys,
    last_seen_run_id=p_run_id,
    last_seen_at=now(),
    version_count=public.unleashed_raw_snapshots.version_count+1,
    metadata=excluded.metadata;
  get diagnostics v_snapshot_count = row_count;

  insert into public.unleashed_external_identities(
    resource,external_key,external_guid,external_code,external_number,display_name,
    latest_payload_sha256,latest_source_last_modified_at,first_seen_run_id,last_seen_run_id,metadata
  )
  select
    p_resource,x.external_key,x.external_guid,x.external_code,x.external_number,x.display_name,
    x.latest_payload_sha256,x.latest_source_last_modified_at,p_run_id,p_run_id,coalesce(x.metadata,'{}'::jsonb)
  from jsonb_to_recordset(coalesce(p_identity_rows,'[]'::jsonb)) as x(
    external_key text,
    external_guid text,
    external_code text,
    external_number text,
    display_name text,
    latest_payload_sha256 text,
    latest_source_last_modified_at timestamptz,
    metadata jsonb
  )
  on conflict (resource,external_key) do update set
    external_guid=excluded.external_guid,
    external_code=excluded.external_code,
    external_number=excluded.external_number,
    display_name=excluded.display_name,
    latest_payload_sha256=excluded.latest_payload_sha256,
    latest_source_last_modified_at=excluded.latest_source_last_modified_at,
    last_seen_run_id=p_run_id,
    last_seen_at=now(),
    metadata=excluded.metadata;
  get diagnostics v_identity_count = row_count;

  insert into public.unleashed_sync_batches(
    run_id,resource,endpoint_path,page_number,page_size,status,responded_at,http_status,
    records_seen,records_staged,response_sha256,query_params,pagination,metadata
  ) values (
    p_run_id,p_resource,p_endpoint_path,p_page_number,p_page_size,'SUCCEEDED',clock_timestamp(),p_http_status,
    greatest(coalesce(p_records_seen,0),0),greatest(coalesce(p_records_staged,0),0),p_response_sha256,
    coalesce(p_query_params,'{}'::jsonb),coalesce(p_pagination,'{}'::jsonb),coalesce(p_batch_metadata,'{}'::jsonb)
  ) returning id into v_batch_id;

  update public.unleashed_snapshot_acquisition_leases set
    expires_at=clock_timestamp()+interval '15 minutes',
    updated_at=clock_timestamp()
  where resource=p_resource and run_id=p_run_id and lease_token=p_lease_token;

  return jsonb_build_object(
    'batchId',v_batch_id,
    'resource',p_resource,
    'pageNumber',p_page_number,
    'snapshotWrites',v_snapshot_count,
    'identityWrites',v_identity_count
  );
end;
$$;

create or replace function public.ecoflow_record_unleashed_snapshot_page_failure(
  p_lease_token uuid,
  p_run_id uuid,
  p_resource text,
  p_endpoint_path text,
  p_page_number integer,
  p_page_size integer,
  p_http_status integer,
  p_response_sha256 text,
  p_query_params jsonb,
  p_error_code text,
  p_error_message text,
  p_batch_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease public.unleashed_snapshot_acquisition_leases%rowtype;
  v_batch_id uuid;
begin
  select * into v_lease
  from public.unleashed_snapshot_acquisition_leases l
  where l.resource=p_resource
  for update;
  if not found or v_lease.run_id<>p_run_id or v_lease.lease_token<>p_lease_token
     or v_lease.expires_at<=clock_timestamp() then
    raise exception 'UNLEASHED_ACQUISITION_LEASE_LOST';
  end if;

  insert into public.unleashed_sync_batches(
    run_id,resource,endpoint_path,page_number,page_size,status,responded_at,http_status,
    response_sha256,query_params,error_code,error_message,metadata
  ) values (
    p_run_id,p_resource,p_endpoint_path,p_page_number,p_page_size,'FAILED',clock_timestamp(),p_http_status,
    p_response_sha256,coalesce(p_query_params,'{}'::jsonb),nullif(btrim(coalesce(p_error_code,'')),''),
    left(coalesce(p_error_message,p_error_code,'UNLEASHED_ACQUISITION_PAGE_FAILED'),1000),
    coalesce(p_batch_metadata,'{}'::jsonb)
  ) returning id into v_batch_id;

  return jsonb_build_object('batchId',v_batch_id,'resource',p_resource,'pageNumber',p_page_number,'status','FAILED');
end;
$$;

create or replace function public.ecoflow_finalize_unleashed_snapshot_resource(
  p_lease_token uuid,
  p_run_id uuid,
  p_resource text,
  p_cursor_status text,
  p_window jsonb,
  p_requested_modified_since text,
  p_high_watermark timestamptz,
  p_error_code text default null,
  p_error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease public.unleashed_snapshot_acquisition_leases%rowtype;
  v_run public.unleashed_sync_runs%rowtype;
  v_complete boolean;
  v_next_page integer;
  v_start_page integer;
  v_last_page integer;
  v_number_of_pages integer;
  v_previous_run_id uuid;
  v_metadata jsonb;
  v_page_count integer;
  v_distinct_pages integer;
  v_min_page integer;
  v_max_page integer;
  v_bad_batches integer;
begin
  select * into v_lease
  from public.unleashed_snapshot_acquisition_leases l
  where l.resource=p_resource
  for update;
  if not found or v_lease.run_id<>p_run_id or v_lease.lease_token<>p_lease_token
     or v_lease.expires_at<=clock_timestamp() then
    raise exception 'UNLEASHED_ACQUISITION_LEASE_LOST';
  end if;

  select * into v_run
  from public.unleashed_sync_runs r
  where r.id=p_run_id
  for update;
  if not found or v_run.status<>'RUNNING' or v_run.dry_run
     or v_run.run_type<>'BOUNDED_SNAPSHOT' or v_run.max_pages not between 1 and 5
     or not (p_resource=any(v_run.resource_set)) then
    raise exception 'UNLEASHED_ACQUISITION_RUN_LOST';
  end if;
  if p_cursor_status not in ('RUNNING','READY','FAILED') or jsonb_typeof(coalesce(p_window,'{}'::jsonb))<>'object' then
    raise exception 'UNLEASHED_ACQUISITION_FINALIZE_INVALID';
  end if;

  begin
    v_complete := coalesce((p_window->>'window_complete')::boolean,false);
    v_next_page := nullif(p_window->>'next_page','')::integer;
    v_start_page := nullif(p_window->>'start_page','')::integer;
    v_last_page := nullif(p_window->>'last_page','')::integer;
    v_number_of_pages := nullif(p_window->>'number_of_pages','')::integer;
    v_previous_run_id := nullif(p_window->>'previous_run_id','')::uuid;
  exception when others then
    raise exception 'UNLEASHED_ACQUISITION_WINDOW_INVALID';
  end;

  if v_start_page is distinct from v_lease.start_page
     or v_previous_run_id is distinct from v_lease.previous_run_id
     or v_last_page is null or v_last_page<v_start_page then
    raise exception 'UNLEASHED_ACQUISITION_WINDOW_LEASE_MISMATCH';
  end if;
  if p_cursor_status='READY' and (not v_complete or v_next_page is not null) then
    raise exception 'UNLEASHED_ACQUISITION_READY_REQUIRES_COMPLETE_WINDOW';
  end if;
  if p_cursor_status='RUNNING' and (v_complete or v_next_page is null or v_next_page<>v_last_page+1) then
    raise exception 'UNLEASHED_ACQUISITION_RUNNING_REQUIRES_CONTINUATION';
  end if;

  if p_cursor_status<>'FAILED' then
    select
      count(*),count(distinct b.page_number),min(b.page_number),max(b.page_number),
      count(*) filter (
        where b.status<>'SUCCEEDED' or b.response_sha256 is null or b.page_size<>v_run.page_size
      )
    into v_page_count,v_distinct_pages,v_min_page,v_max_page,v_bad_batches
    from public.unleashed_sync_batches b
    where b.run_id=p_run_id and b.resource=p_resource;

    if v_page_count=0 or v_bad_batches<>0 or v_distinct_pages<>v_page_count
       or v_min_page<>v_start_page or v_max_page<>v_last_page
       or v_page_count<>v_last_page-v_start_page+1 or v_page_count>v_run.max_pages then
      raise exception 'UNLEASHED_ACQUISITION_WINDOW_BATCH_MISMATCH';
    end if;
    if v_number_of_pages is not null and (
      v_number_of_pages<v_last_page or (p_cursor_status='READY' and v_last_page<>v_number_of_pages)
    ) then
      raise exception 'UNLEASHED_ACQUISITION_NUMBER_OF_PAGES_MISMATCH';
    end if;
  end if;

  v_metadata := jsonb_build_object(
    'dry_run',false,
    'pagination_window',coalesce(p_window,'{}'::jsonb) || jsonb_build_object('run_id',p_run_id)
  );

  insert into public.unleashed_resource_cursors(
    resource,cursor_status,last_successful_run_id,last_successful_at,last_successful_modified_since,
    high_watermark_at,next_modified_since,last_error_code,last_error_message,metadata
  ) values (
    p_resource,p_cursor_status,
    case when p_cursor_status='READY' then p_run_id else null end,
    case when p_cursor_status='READY' then clock_timestamp() else null end,
    case when p_cursor_status='READY' then p_requested_modified_since else null end,
    case when p_cursor_status='READY' then p_high_watermark else null end,
    case when p_cursor_status='READY' then p_high_watermark else null end,
    case when p_cursor_status='FAILED' then nullif(btrim(coalesce(p_error_code,'')),'') else null end,
    case when p_cursor_status='FAILED' then left(coalesce(p_error_message,p_error_code,'UNLEASHED_ACQUISITION_FAILED'),1000) else null end,
    v_metadata
  )
  on conflict (resource) do update set
    cursor_status=excluded.cursor_status,
    last_successful_run_id=excluded.last_successful_run_id,
    last_successful_at=excluded.last_successful_at,
    last_successful_modified_since=excluded.last_successful_modified_since,
    high_watermark_at=excluded.high_watermark_at,
    next_modified_since=excluded.next_modified_since,
    last_error_code=excluded.last_error_code,
    last_error_message=excluded.last_error_message,
    metadata=excluded.metadata;

  delete from public.unleashed_snapshot_acquisition_leases
  where resource=p_resource and run_id=p_run_id and lease_token=p_lease_token;
  if not found then raise exception 'UNLEASHED_ACQUISITION_LEASE_LOST'; end if;

  return jsonb_build_object(
    'resource',p_resource,
    'runId',p_run_id,
    'cursorStatus',p_cursor_status,
    'windowComplete',v_complete,
    'nextPage',v_next_page,
    'validatedPages',case when p_cursor_status='FAILED' then 0 else v_page_count end
  );
end;
$$;

create or replace function public.ecoflow_verify_unleashed_snapshot_reconciliation(
  p_resource text,
  p_acquisition_run_ids uuid[],
  p_recheck_run_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_expected_dry boolean;
  v_kind text;
  v_i integer;
  v_run public.unleashed_sync_runs%rowtype;
  v_window jsonb;
  v_window_count integer;
  v_prev_next_page integer;
  v_start_page integer;
  v_last_page integer;
  v_next_page integer;
  v_previous_run_id uuid;
  v_complete boolean;
  v_number_of_pages integer;
  v_chain_number_of_pages integer;
  v_page_size integer;
  v_manifest jsonb;
  v_acquisition_manifest jsonb;
  v_recheck_manifest jsonb;
  v_acquisition_hash text;
  v_recheck_hash text;
  v_page_count integer;
  v_acquisition_page_count integer;
  v_recheck_page_count integer;
  v_acquisition_page_size integer;
  v_recheck_page_size integer;
  v_acquisition_number_of_pages integer;
  v_recheck_number_of_pages integer;
  v_distinct_pages integer;
  v_min_page integer;
  v_max_page integer;
  v_bad_batches integer;
begin
  if length(btrim(coalesce(p_resource,'')))=0
     or coalesce(cardinality(p_acquisition_run_ids),0)=0
     or coalesce(cardinality(p_recheck_run_ids),0)=0
     or cardinality(p_acquisition_run_ids)>100
     or cardinality(p_recheck_run_ids)>100 then
    raise exception 'UNLEASHED_RECONCILIATION_INPUT_INVALID';
  end if;

  for v_kind,v_ids,v_expected_dry in
    select * from (values
      ('acquisition'::text,p_acquisition_run_ids,false),
      ('recheck'::text,p_recheck_run_ids,true)
    ) as chains(kind,ids,expected_dry)
  loop
    v_prev_next_page := null;
    v_page_size := null;
    v_chain_number_of_pages := null;

    for v_i in 1..cardinality(v_ids) loop
      select * into v_run from public.unleashed_sync_runs r where r.id=v_ids[v_i];
      if not found or v_run.status<>'SUCCEEDED' or v_run.dry_run<>v_expected_dry
         or v_run.run_type<>'BOUNDED_SNAPSHOT' or v_run.max_pages not between 1 and 5
         or not (p_resource=any(v_run.resource_set)) then
        raise exception 'UNLEASHED_RECONCILIATION_RUN_INVALID:%:%',v_kind,v_i;
      end if;
      if v_page_size is null then v_page_size := v_run.page_size;
      elsif v_page_size<>v_run.page_size then
        raise exception 'UNLEASHED_RECONCILIATION_PAGE_SIZE_DRIFT:%',v_kind;
      end if;

      select count(*) into v_window_count
      from jsonb_array_elements(coalesce(v_run.metadata->'pagination_windows','[]'::jsonb)) w(elem)
      where w.elem->>'resource'=p_resource;
      if v_window_count<>1 then
        raise exception 'UNLEASHED_RECONCILIATION_WINDOW_INVALID:%:%',v_kind,v_i;
      end if;
      select w.elem into v_window
      from jsonb_array_elements(coalesce(v_run.metadata->'pagination_windows','[]'::jsonb)) w(elem)
      where w.elem->>'resource'=p_resource
      limit 1;

      begin
        v_start_page := nullif(v_window->>'start_page','')::integer;
        v_last_page := nullif(v_window->>'last_page','')::integer;
        v_next_page := nullif(v_window->>'next_page','')::integer;
        v_previous_run_id := nullif(v_window->>'previous_run_id','')::uuid;
        v_complete := coalesce((v_window->>'window_complete')::boolean,false);
        v_number_of_pages := nullif(v_window->>'number_of_pages','')::integer;
      exception when others then
        raise exception 'UNLEASHED_RECONCILIATION_WINDOW_INVALID:%:%',v_kind,v_i;
      end;
      if v_start_page is null or v_last_page is null or v_last_page<v_start_page then
        raise exception 'UNLEASHED_RECONCILIATION_WINDOW_INVALID:%:%',v_kind,v_i;
      end if;
      if v_number_of_pages is not null then
        if v_number_of_pages<v_last_page then
          raise exception 'UNLEASHED_RECONCILIATION_DECLARED_PAGE_COUNT_INVALID:%:%',v_kind,v_i;
        end if;
        if v_chain_number_of_pages is null then v_chain_number_of_pages:=v_number_of_pages;
        elsif v_chain_number_of_pages<>v_number_of_pages then
          raise exception 'UNLEASHED_RECONCILIATION_DECLARED_PAGE_COUNT_DRIFT:%',v_kind;
        end if;
      end if;

      if v_i=1 then
        if v_start_page<>1 or v_previous_run_id is not null then
          raise exception 'UNLEASHED_RECONCILIATION_ROOT_INVALID:%',v_kind;
        end if;
      else
        if v_previous_run_id is distinct from v_ids[v_i-1] or v_start_page is distinct from v_prev_next_page then
          raise exception 'UNLEASHED_RECONCILIATION_CHAIN_GAP:%:%',v_kind,v_i;
        end if;
      end if;
      if v_i<cardinality(v_ids) and (v_complete or v_next_page is null or v_next_page<>v_last_page+1) then
        raise exception 'UNLEASHED_RECONCILIATION_EARLY_COMPLETE:%:%',v_kind,v_i;
      end if;
      if v_i=cardinality(v_ids) and (not v_complete or v_next_page is not null) then
        raise exception 'UNLEASHED_RECONCILIATION_TERMINAL_INCOMPLETE:%',v_kind;
      end if;
      v_prev_next_page := v_next_page;
    end loop;

    select
      count(*),count(distinct b.page_number),min(b.page_number),max(b.page_number),
      count(*) filter (where b.status<>'SUCCEEDED' or b.response_sha256 is null or b.page_size<>v_page_size),
      jsonb_agg(jsonb_build_object('page',b.page_number,'sha256',b.response_sha256) order by b.page_number)
    into v_page_count,v_distinct_pages,v_min_page,v_max_page,v_bad_batches,v_manifest
    from public.unleashed_sync_batches b
    where b.run_id=any(v_ids) and b.resource=p_resource;

    if v_page_count=0 or v_bad_batches<>0 or v_distinct_pages<>v_page_count
       or v_min_page<>1 or v_max_page<>v_page_count then
      raise exception 'UNLEASHED_RECONCILIATION_PAGE_MANIFEST_INVALID:%',v_kind;
    end if;
    if v_chain_number_of_pages is not null and v_chain_number_of_pages<>v_page_count then
      raise exception 'UNLEASHED_RECONCILIATION_DECLARED_PAGE_COUNT_MISMATCH:%',v_kind;
    end if;

    if v_kind='acquisition' then
      v_acquisition_manifest:=v_manifest;
      v_acquisition_page_count:=v_page_count;
      v_acquisition_page_size:=v_page_size;
      v_acquisition_number_of_pages:=v_chain_number_of_pages;
      v_acquisition_hash:=encode(extensions.digest(v_manifest::text,'sha256'),'hex');
    else
      v_recheck_manifest:=v_manifest;
      v_recheck_page_count:=v_page_count;
      v_recheck_page_size:=v_page_size;
      v_recheck_number_of_pages:=v_chain_number_of_pages;
      v_recheck_hash:=encode(extensions.digest(v_manifest::text,'sha256'),'hex');
    end if;
  end loop;

  if v_acquisition_page_size is distinct from v_recheck_page_size then
    raise exception 'UNLEASHED_RECONCILIATION_PAGE_SIZE_MISMATCH';
  end if;
  if v_acquisition_number_of_pages is distinct from v_recheck_number_of_pages then
    raise exception 'UNLEASHED_RECONCILIATION_DECLARED_PAGE_COUNT_MISMATCH';
  end if;
  if v_acquisition_page_count<>v_recheck_page_count or v_acquisition_manifest is distinct from v_recheck_manifest then
    raise exception 'UNLEASHED_RECONCILIATION_MISMATCH';
  end if;

  return jsonb_build_object(
    'resource',p_resource,
    'pageCount',v_acquisition_page_count,
    'pageSize',v_acquisition_page_size,
    'declaredNumberOfPages',v_acquisition_number_of_pages,
    'acquisitionManifestSha256',v_acquisition_hash,
    'recheckManifestSha256',v_recheck_hash,
    'equivalent',true
  );
end;
$$;

revoke all on function public.ecoflow_claim_unleashed_snapshot_acquisition(uuid,text,integer,uuid) from public, anon, authenticated;
revoke all on function public.ecoflow_commit_unleashed_snapshot_page(uuid,uuid,text,text,integer,integer,integer,integer,integer,text,jsonb,jsonb,jsonb,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.ecoflow_record_unleashed_snapshot_page_failure(uuid,uuid,text,text,integer,integer,integer,text,jsonb,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.ecoflow_finalize_unleashed_snapshot_resource(uuid,uuid,text,text,jsonb,text,timestamptz,text,text) from public, anon, authenticated;
revoke all on function public.ecoflow_verify_unleashed_snapshot_reconciliation(text,uuid[],uuid[]) from public, anon, authenticated;

grant execute on function public.ecoflow_claim_unleashed_snapshot_acquisition(uuid,text,integer,uuid) to service_role;
grant execute on function public.ecoflow_commit_unleashed_snapshot_page(uuid,uuid,text,text,integer,integer,integer,integer,integer,text,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.ecoflow_record_unleashed_snapshot_page_failure(uuid,uuid,text,text,integer,integer,integer,text,jsonb,text,text,jsonb) to service_role;
grant execute on function public.ecoflow_finalize_unleashed_snapshot_resource(uuid,uuid,text,text,jsonb,text,timestamptz,text,text) to service_role;
grant execute on function public.ecoflow_verify_unleashed_snapshot_reconciliation(text,uuid[],uuid[]) to service_role;

comment on table public.unleashed_snapshot_acquisition_leases is
  'Service-role-only fencing leases for bounded Unleashed snapshot acquisition. Lease tokens are never browser-visible.';
comment on function public.ecoflow_verify_unleashed_snapshot_reconciliation(text,uuid[],uuid[]) is
  'Compares two fully validated per-resource acquisition chains using page response hashes only; raises on any chain or manifest mismatch.';

notify pgrst, 'reload schema';
commit;
