-- ECOFLOW-R5-009 — fresh ADL1 reference membership + supersession bridge
--
-- Engineering only. This migration adds provenance and governed lifecycle
-- capabilities but performs no provider acquisition, reference staging/sealing,
-- commissioning supersession, stocktake, warehouse quantity, or inventory
-- movement during migration application.

begin;

do $deps$
begin
  if to_regclass('public.unleashed_sync_runs') is null
     or to_regclass('public.unleashed_sync_batches') is null
     or to_regclass('public.unleashed_raw_snapshots') is null
     or to_regclass('public.ecoflow_unleashed_inventory_reference_batches') is null
     or to_regclass('public.ecoflow_unleashed_inventory_reference_rows') is null
     or to_regclass('public.ecoflow_unleashed_inventory_reference_commands') is null
     or to_regclass('public.ecoflow_unleashed_inventory_commissioning_sets') is null
     or to_regclass('public.ecoflow_unleashed_inventory_commissioning_locations') is null
     or to_regclass('public.ecoflow_unleashed_inventory_provisional_reference_evidence') is null
     or to_regprocedure('public.ecoflow_commit_unleashed_snapshot_page(uuid,uuid,text,text,integer,integer,integer,integer,integer,text,jsonb,jsonb,jsonb,jsonb,jsonb)') is null
     or to_regprocedure('public.ecoflow_seal_unleashed_inventory_reference_batch(uuid,bigint,uuid,text)') is null
     or to_regprocedure('public.ecoflow_supersede_unleashed_inventory_reference_batch(uuid,uuid,bigint,uuid,text)') is null
     or to_regprocedure('public.ecoflow_active_app_role()') is null then
    raise exception 'R5_009_DEPENDENCIES_MISSING';
  end if;
end;
$deps$;

create table if not exists public.unleashed_snapshot_run_membership (
  run_id uuid not null references public.unleashed_sync_runs(id) on delete restrict,
  resource text not null check (length(btrim(resource)) > 0),
  external_key text not null check (length(btrim(external_key)) > 0),
  snapshot_id uuid not null references public.unleashed_raw_snapshots(id) on delete restrict,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  observed_at timestamptz not null,
  page_number integer check (page_number is null or page_number >= 1),
  provenance text not null check (provenance in ('LIVE_ACQUISITION','R5_008_RECONSTRUCTED')),
  created_at timestamptz not null default now(),
  primary key (run_id,resource,external_key),
  unique (run_id,resource,snapshot_id)
);

create index if not exists unleashed_snapshot_run_membership_snapshot_idx
  on public.unleashed_snapshot_run_membership(snapshot_id,run_id);
create index if not exists unleashed_snapshot_run_membership_resource_idx
  on public.unleashed_snapshot_run_membership(resource,run_id,page_number);

create table if not exists public.ecoflow_unleashed_inventory_bridge_commands (
  id uuid primary key default extensions.gen_random_uuid(),
  command_id uuid not null unique,
  command_type text not null
    check (command_type in ('RECONSTRUCT_R5_008_MEMBERSHIP','ACTIVATE_R5_009_FRESH_REFERENCE')),
  actor_user_id uuid not null,
  command_payload_sha256 text not null check (command_payload_sha256 ~ '^[0-9a-f]{64}$'),
  result jsonb not null check (jsonb_typeof(result)='object'),
  created_at timestamptz not null default now()
);

create or replace function public.ecoflow_guard_unleashed_snapshot_run_membership()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'IMMUTABLE_UNLEASHED_SNAPSHOT_RUN_MEMBERSHIP';
end;
$$;

drop trigger if exists unleashed_snapshot_run_membership_immutable
  on public.unleashed_snapshot_run_membership;
create trigger unleashed_snapshot_run_membership_immutable
before update or delete on public.unleashed_snapshot_run_membership
for each row execute function public.ecoflow_guard_unleashed_snapshot_run_membership();

create or replace function public.ecoflow_guard_unleashed_inventory_bridge_command()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'IMMUTABLE_UNLEASHED_INVENTORY_BRIDGE_COMMAND';
end;
$$;

drop trigger if exists ecoflow_unleashed_inventory_bridge_command_immutable
  on public.ecoflow_unleashed_inventory_bridge_commands;
create trigger ecoflow_unleashed_inventory_bridge_command_immutable
before update or delete on public.ecoflow_unleashed_inventory_bridge_commands
for each row execute function public.ecoflow_guard_unleashed_inventory_bridge_command();

alter table public.unleashed_snapshot_run_membership enable row level security;
alter table public.ecoflow_unleashed_inventory_bridge_commands enable row level security;

revoke all on table public.unleashed_snapshot_run_membership from public,anon,authenticated;
revoke all on table public.ecoflow_unleashed_inventory_bridge_commands from public,anon,authenticated;
grant select on table public.unleashed_snapshot_run_membership to authenticated,service_role;
grant select on table public.ecoflow_unleashed_inventory_bridge_commands to authenticated,service_role;

drop policy if exists unleashed_snapshot_run_membership_read
  on public.unleashed_snapshot_run_membership;
create policy unleashed_snapshot_run_membership_read
  on public.unleashed_snapshot_run_membership
  for select to authenticated
  using ((select public.ecoflow_active_app_role()) in ('OWNER','ADMIN','WAREHOUSE'));

drop policy if exists ecoflow_unleashed_inventory_bridge_commands_read
  on public.ecoflow_unleashed_inventory_bridge_commands;
create policy ecoflow_unleashed_inventory_bridge_commands_read
  on public.ecoflow_unleashed_inventory_bridge_commands
  for select to authenticated
  using ((select public.ecoflow_active_app_role()) in ('OWNER','ADMIN'));

-- New overload: preserve semantic snapshot versioning while atomically
-- recording every row actually observed on the provider page, including rows
-- whose payload was unchanged and therefore did not require a snapshot rewrite.
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
  p_identity_rows jsonb,
  p_seen_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_seen_count integer;
  v_distinct_keys integer;
  v_bad_rows integer;
  v_match_count integer;
  v_inserted integer;
begin
  if pg_catalog.jsonb_typeof(coalesce(p_seen_rows,'[]'::jsonb)) <> 'array' then
    raise exception 'UNLEASHED_ACQUISITION_SEEN_ROWS_INVALID';
  end if;

  select
    count(*)::integer,
    count(distinct x.external_key)::integer,
    count(*) filter (
      where nullif(btrim(coalesce(x.external_key,'')),'') is null
         or coalesce(x.payload_sha256,'') !~ '^[0-9a-f]{64}$'
    )::integer
  into v_seen_count,v_distinct_keys,v_bad_rows
  from pg_catalog.jsonb_to_recordset(coalesce(p_seen_rows,'[]'::jsonb))
    as x(external_key text,payload_sha256 text);

  if v_seen_count <> greatest(coalesce(p_records_seen,0),0)
     or v_distinct_keys <> v_seen_count
     or v_bad_rows <> 0 then
    raise exception 'UNLEASHED_ACQUISITION_SEEN_ROWS_COUNT_MISMATCH';
  end if;

  v_result := public.ecoflow_commit_unleashed_snapshot_page(
    p_lease_token,p_run_id,p_resource,p_endpoint_path,p_page_number,p_page_size,
    p_http_status,p_records_seen,p_records_staged,p_response_sha256,p_query_params,
    p_pagination,p_batch_metadata,p_snapshot_rows,p_identity_rows
  );

  select count(*)::integer into v_match_count
  from pg_catalog.jsonb_to_recordset(coalesce(p_seen_rows,'[]'::jsonb))
    as x(external_key text,payload_sha256 text)
  join public.unleashed_raw_snapshots s
    on s.resource=p_resource
   and s.external_key=x.external_key
   and s.payload_sha256=x.payload_sha256;

  if v_match_count <> v_seen_count then
    raise exception 'UNLEASHED_ACQUISITION_SEEN_ROW_SNAPSHOT_MISMATCH';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_to_recordset(coalesce(p_seen_rows,'[]'::jsonb))
      as x(external_key text,payload_sha256 text)
    join public.unleashed_snapshot_run_membership m
      on m.run_id=p_run_id and m.resource=p_resource and m.external_key=x.external_key
  ) then
    raise exception 'UNLEASHED_ACQUISITION_RUN_MEMBERSHIP_DUPLICATE';
  end if;

  insert into public.unleashed_snapshot_run_membership(
    run_id,resource,external_key,snapshot_id,payload_sha256,
    observed_at,page_number,provenance
  )
  select
    p_run_id,p_resource,x.external_key,s.id,x.payload_sha256,
    pg_catalog.clock_timestamp(),p_page_number,'LIVE_ACQUISITION'
  from pg_catalog.jsonb_to_recordset(coalesce(p_seen_rows,'[]'::jsonb))
    as x(external_key text,payload_sha256 text)
  join public.unleashed_raw_snapshots s
    on s.resource=p_resource
   and s.external_key=x.external_key
   and s.payload_sha256=x.payload_sha256;
  get diagnostics v_inserted = row_count;

  if v_inserted <> v_seen_count then
    raise exception 'UNLEASHED_ACQUISITION_RUN_MEMBERSHIP_WRITE_MISMATCH';
  end if;

  return v_result || pg_catalog.jsonb_build_object(
    'membershipWrites',v_inserted,
    'membershipProvenance','LIVE_ACQUISITION'
  );
end;
$$;

revoke all on function public.ecoflow_commit_unleashed_snapshot_page(
  uuid,uuid,text,text,integer,integer,integer,integer,integer,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb
) from public,anon,authenticated,service_role;
grant execute on function public.ecoflow_commit_unleashed_snapshot_page(
  uuid,uuid,text,text,integer,integer,integer,integer,integer,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb
) to service_role;

create or replace function public.ecoflow_reconstruct_r5_008_stock_membership(
  p_command_id uuid,
  p_requested_by uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claims jsonb := nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb;
  v_request_role text := coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.role',true),''),
    v_claims->>'role'
  );
  v_run constant uuid := 'bdca8012-8f78-4dff-b20c-5f5a7d0f8cce';
  v_prior_run constant uuid := '5cd0e73b-956d-4c80-9e70-6d841d27b163';
  v_old_batch constant uuid := '4cdb85d3-06d8-44bf-96bb-93660e10c3c9';
  v_source public.unleashed_sync_runs%rowtype;
  v_existing public.ecoflow_unleashed_inventory_bridge_commands%rowtype;
  v_old public.ecoflow_unleashed_inventory_reference_batches%rowtype;
  v_metadata jsonb;
  v_window jsonb;
  v_payload_hash text;
  v_total integer;
  v_new_seen integer;
  v_prior_seen integer;
  v_old_snapshot_members integer;
  v_new_only integer;
  v_inserted integer;
  v_result jsonb;
begin
  if session_user <> 'postgres' and v_request_role is distinct from 'service_role' then
    raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED';
  end if;
  if p_command_id is null or p_requested_by is null
     or char_length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then
    raise exception 'R5_009_RECONSTRUCT_CONTEXT_REQUIRED';
  end if;
  if not exists (
    select 1 from public.app_user_profiles p
    where p.user_id=p_requested_by
      and p.is_active
      and p.team_status='ACTIVE'
      and p.app_role in ('OWNER','ADMIN')
  ) then
    raise exception 'R5_009_REQUESTER_FORBIDDEN';
  end if;

  v_payload_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.jsonb_build_object(
        'command','RECONSTRUCT_R5_008_MEMBERSHIP',
        'requestedBy',p_requested_by,
        'sourceRunId',v_run,
        'priorRunId',v_prior_run,
        'priorBatchId',v_old_batch,
        'reason',btrim(p_reason)
      )::text,
      'sha256'
    ),
    'hex'
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('r5-009-reconstruct:'||p_command_id::text,0)
  );

  select * into v_existing
  from public.ecoflow_unleashed_inventory_bridge_commands
  where command_id=p_command_id;
  if found then
    if v_existing.command_type<>'RECONSTRUCT_R5_008_MEMBERSHIP'
       or v_existing.actor_user_id<>p_requested_by
       or v_existing.command_payload_sha256<>v_payload_hash then
      raise exception 'R5_009_RECONSTRUCT_COMMAND_REPLAY_MISMATCH';
    end if;
    return v_existing.result;
  end if;

  select * into v_source
  from public.unleashed_sync_runs
  where id=v_run;
  if not found then raise exception 'R5_009_R5_008_RUN_NOT_FOUND'; end if;

  v_metadata := coalesce(v_source.metadata,'{}'::jsonb);
  if pg_catalog.jsonb_typeof(v_metadata->'pagination_windows')='array'
     and pg_catalog.jsonb_array_length(v_metadata->'pagination_windows')=1 then
    v_window := v_metadata->'pagination_windows'->0;
  else
    v_window := '{}'::jsonb;
  end if;

  if v_source.status<>'SUCCEEDED'
     or v_source.dry_run
     or v_source.resource_set<>array['stock_on_hand']::text[]
     or v_source.page_size<>200
     or v_source.max_pages<>5
     or v_source.records_seen<>428
     or v_source.records_staged<>349
     or v_source.records_changed<>348
     or v_source.records_failed<>0
     or v_source.completed_at is distinct from '2026-09-21T14:03:56.489Z'::timestamptz
     or v_metadata->>'request_key'<>'ECOFLOW-R5-008'
     or v_metadata->'target'->>'warehouseCode'<>'ADL1'
     or coalesce((v_metadata->>'records_inserted')::integer,-1)<>1
     or coalesce((v_metadata->>'records_unchanged')::integer,-1)<>79
     or coalesce((v_metadata->>'all_resources_complete')::boolean,false) is not true
     or v_window->>'resource'<>'stock_on_hand'
     or coalesce((v_window->>'start_page')::integer,0)<>1
     or coalesce((v_window->>'last_page')::integer,0)<>3
     or coalesce((v_window->>'number_of_pages')::integer,0)<>3
     or coalesce((v_window->>'window_complete')::boolean,false) is not true
     or (v_window ? 'next_page' and v_window->>'next_page' is not null) then
    raise exception 'R5_009_R5_008_RUN_BINDING_MISMATCH';
  end if;

  select * into v_old
  from public.ecoflow_unleashed_inventory_reference_batches
  where id=v_old_batch;
  if not found
     or v_old.source_run_id<>v_prior_run
     or v_old.source_row_count<>427
     or v_old.batch_status<>'SEALED'
     or v_old.revision<>1 then
    raise exception 'R5_009_PRIOR_REFERENCE_BINDING_MISMATCH';
  end if;

  if exists (
    select 1 from public.unleashed_snapshot_run_membership
    where run_id=v_run and resource='stock_on_hand'
  ) then
    raise exception 'R5_009_R5_008_MEMBERSHIP_ALREADY_PRESENT';
  end if;

  select count(*)::integer into v_total
  from public.unleashed_raw_snapshots s
  where s.resource='stock_on_hand'
    and s.payload->>'WarehouseCode'='ADL1';

  select count(*)::integer into v_new_seen
  from public.unleashed_raw_snapshots s
  where s.resource='stock_on_hand'
    and s.payload->>'WarehouseCode'='ADL1'
    and s.last_seen_run_id=v_run;

  select count(*)::integer into v_prior_seen
  from public.unleashed_raw_snapshots s
  where s.resource='stock_on_hand'
    and s.payload->>'WarehouseCode'='ADL1'
    and s.last_seen_run_id=v_prior_run;

  select count(*)::integer into v_old_snapshot_members
  from public.unleashed_raw_snapshots s
  where s.resource='stock_on_hand'
    and s.payload->>'WarehouseCode'='ADL1'
    and exists (
      select 1
      from public.ecoflow_unleashed_inventory_reference_rows r
      where r.batch_id=v_old_batch and r.source_snapshot_id=s.id
    );

  select count(*)::integer into v_new_only
  from public.unleashed_raw_snapshots s
  where s.resource='stock_on_hand'
    and s.payload->>'WarehouseCode'='ADL1'
    and not exists (
      select 1
      from public.ecoflow_unleashed_inventory_reference_rows r
      where r.batch_id=v_old_batch and r.source_snapshot_id=s.id
    )
    and s.first_seen_run_id=v_run
    and s.last_seen_run_id=v_run;

  if v_total<>428
     or v_new_seen<>349
     or v_prior_seen<>79
     or v_old_snapshot_members<>427
     or v_new_only<>1
     or exists (
       select 1
       from public.unleashed_raw_snapshots s
       where s.resource='stock_on_hand'
         and s.payload->>'WarehouseCode'='ADL1'
         and s.last_seen_run_id not in (v_run,v_prior_run)
     ) then
    raise exception 'R5_009_R5_008_MEMBERSHIP_RECONSTRUCTION_PROOF_FAILED';
  end if;

  insert into public.unleashed_snapshot_run_membership(
    run_id,resource,external_key,snapshot_id,payload_sha256,
    observed_at,page_number,provenance
  )
  select
    v_run,'stock_on_hand',s.external_key,s.id,s.payload_sha256,
    v_source.completed_at,null,'R5_008_RECONSTRUCTED'
  from public.unleashed_raw_snapshots s
  where s.resource='stock_on_hand'
    and s.payload->>'WarehouseCode'='ADL1'
    and s.last_seen_run_id in (v_run,v_prior_run)
  order by s.external_key;
  get diagnostics v_inserted = row_count;

  if v_inserted<>428 then
    raise exception 'R5_009_R5_008_MEMBERSHIP_RECONSTRUCTION_WRITE_MISMATCH';
  end if;

  v_result := pg_catalog.jsonb_build_object(
    'sourceRunId',v_run,
    'membershipCount',v_inserted,
    'newRunBoundRows',v_new_seen,
    'provenUnchangedRows',v_prior_seen,
    'priorReferenceRows',v_old_snapshot_members,
    'newlyInsertedRows',v_new_only,
    'provenance','R5_008_RECONSTRUCTED',
    'authorityEffect','NONE'
  );

  insert into public.ecoflow_unleashed_inventory_bridge_commands(
    command_id,command_type,actor_user_id,command_payload_sha256,result
  ) values (
    p_command_id,'RECONSTRUCT_R5_008_MEMBERSHIP',p_requested_by,v_payload_hash,v_result
  );

  insert into public.app_security_audit_events(
    actor_user_id,actor_role,action,target_type,target_id,after_data
  ) values (
    p_requested_by,
    (select p.app_role from public.app_user_profiles p where p.user_id=p_requested_by),
    'UNLEASHED_R5_008_MEMBERSHIP_RECONSTRUCTED',
    'unleashed_sync_runs',
    v_run::text,
    v_result
  );

  return v_result;
end;
$$;

revoke all on function public.ecoflow_reconstruct_r5_008_stock_membership(uuid,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.ecoflow_reconstruct_r5_008_stock_membership(uuid,uuid,text)
  to service_role;

create or replace function public.ecoflow_stage_unleashed_inventory_reference_v2(
  p_command_id uuid,
  p_requested_by uuid,
  p_source_run_id uuid,
  p_as_at timestamptz,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claims jsonb := nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb;
  v_request_role text := coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.role',true),''),
    v_claims->>'role'
  );
  v_run public.unleashed_sync_runs%rowtype;
  v_existing public.ecoflow_unleashed_inventory_reference_commands%rowtype;
  v_rows jsonb;
  v_row_count bigint;
  v_membership_count bigint;
  v_batch_seen bigint;
  v_bad_membership bigint;
  v_source_set_hash text;
  v_payload_hash text;
  v_batch_id uuid := extensions.gen_random_uuid();
  v_result jsonb;
begin
  if session_user <> 'postgres' and v_request_role is distinct from 'service_role' then
    raise exception using errcode='42501',message='SERVICE_ROLE_REQUIRED';
  end if;
  if p_command_id is null or p_requested_by is null or p_source_run_id is null or p_as_at is null
     or char_length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then
    raise exception 'INVENTORY_REFERENCE_V2_STAGE_CONTEXT_REQUIRED';
  end if;
  if not exists (
    select 1 from public.app_user_profiles p
    where p.user_id=p_requested_by
      and p.is_active
      and p.team_status='ACTIVE'
      and p.app_role in ('OWNER','ADMIN')
  ) then
    raise exception 'INVENTORY_REFERENCE_V2_REQUESTER_FORBIDDEN';
  end if;

  select * into v_run
  from public.unleashed_sync_runs
  where id=p_source_run_id;
  if not found
     or v_run.status<>'SUCCEEDED'
     or v_run.dry_run
     or v_run.resource_set<>array['stock_on_hand']::text[]
     or v_run.records_failed<>0
     or coalesce((v_run.metadata->>'all_resources_complete')::boolean,false) is not true
     or v_run.metadata->'target'->>'warehouseCode'<>'ADL1'
     or v_run.completed_at is null
     or p_as_at<>v_run.completed_at then
    raise exception 'INVENTORY_REFERENCE_V2_SOURCE_RUN_NOT_EXACT';
  end if;

  v_payload_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.jsonb_build_object(
        'command','STAGE_V2',
        'requestedBy',p_requested_by,
        'sourceRunId',p_source_run_id,
        'asAt',pg_catalog.to_char(p_as_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'reason',btrim(p_reason)
      )::text,
      'sha256'
    ),
    'hex'
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ecoflow_unleashed_inventory_reference_v2_command:'||p_command_id::text,0)
  );

  select * into v_existing
  from public.ecoflow_unleashed_inventory_reference_commands
  where command_id=p_command_id;
  if found then
    if v_existing.command_type<>'STAGE'
       or v_existing.actor_user_id<>p_requested_by
       or v_existing.command_payload_sha256<>v_payload_hash then
      raise exception 'INVENTORY_REFERENCE_V2_COMMAND_REPLAY_MISMATCH';
    end if;
    return v_existing.result;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ecoflow_unleashed_inventory_reference_v2_source:'||p_source_run_id::text,0)
  );

  select count(*)::bigint into v_batch_seen
  from public.unleashed_sync_batches b
  where b.run_id=p_source_run_id
    and b.resource='stock_on_hand'
    and b.status='SUCCEEDED';

  if v_batch_seen<1
     or exists (
       select 1 from public.unleashed_sync_batches b
       where b.run_id=p_source_run_id
         and b.resource='stock_on_hand'
         and b.status<>'SUCCEEDED'
     )
     or (
       select coalesce(sum(b.records_seen),0)
       from public.unleashed_sync_batches b
       where b.run_id=p_source_run_id
         and b.resource='stock_on_hand'
         and b.status='SUCCEEDED'
     )<>v_run.records_seen then
    raise exception 'INVENTORY_REFERENCE_V2_PAGE_EVIDENCE_MISMATCH';
  end if;

  select count(*)::bigint into v_membership_count
  from public.unleashed_snapshot_run_membership m
  where m.run_id=p_source_run_id
    and m.resource='stock_on_hand';

  if v_membership_count<>v_run.records_seen then
    raise exception 'INVENTORY_REFERENCE_V2_MEMBERSHIP_COUNT_MISMATCH';
  end if;

  select count(*)::bigint into v_bad_membership
  from public.unleashed_snapshot_run_membership m
  left join public.unleashed_raw_snapshots s
    on s.id=m.snapshot_id
   and s.resource=m.resource
   and s.external_key=m.external_key
   and s.payload_sha256=m.payload_sha256
  where m.run_id=p_source_run_id
    and m.resource='stock_on_hand'
    and (
      s.id is null
      or s.payload->>'WarehouseCode'<>'ADL1'
      or length(btrim(coalesce(s.payload->>'ProductGuid','')))=0
      or length(btrim(coalesce(s.payload->>'ProductCode','')))=0
      or length(btrim(coalesce(s.payload->>'WarehouseId','')))=0
      or pg_catalog.jsonb_typeof(s.payload->'QtyOnHand') is distinct from 'number'
      or pg_catalog.jsonb_typeof(s.payload->'AllocatedQty') is distinct from 'number'
      or pg_catalog.jsonb_typeof(s.payload->'OnPurchase') is distinct from 'number'
      or pg_catalog.jsonb_typeof(s.payload->'AvailableQty') is distinct from 'number'
      or m.observed_at>p_as_at
    );

  if v_bad_membership<>0 then
    raise exception 'INVENTORY_REFERENCE_V2_MEMBERSHIP_PROVENANCE_MISMATCH';
  end if;

  if exists (
    select 1
    from public.unleashed_snapshot_run_membership m
    join public.unleashed_raw_snapshots s on s.id=m.snapshot_id
    where m.run_id=p_source_run_id
      and m.resource='stock_on_hand'
    group by lower(btrim(s.payload->>'ProductGuid')),lower(btrim(s.payload->>'WarehouseId'))
    having count(*)>1
  ) then
    raise exception 'INVENTORY_REFERENCE_V2_DUPLICATE_PRODUCT_WAREHOUSE';
  end if;

  select
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'sourceSnapshotId',s.id,
        'sourceExternalKey',s.external_key,
        'sourcePayloadSha256',s.payload_sha256,
        'productGuid',btrim(s.payload->>'ProductGuid'),
        'productCode',btrim(s.payload->>'ProductCode'),
        'warehouseId',btrim(s.payload->>'WarehouseId'),
        'warehouseCode',btrim(s.payload->>'WarehouseCode'),
        'qtyOnHand',(s.payload->>'QtyOnHand')::numeric,
        'allocatedQty',(s.payload->>'AllocatedQty')::numeric,
        'onPurchase',(s.payload->>'OnPurchase')::numeric,
        'availableQty',(s.payload->>'AvailableQty')::numeric,
        'sourceLastModifiedAt',case when s.source_last_modified_at is null then null else
          pg_catalog.to_char(s.source_last_modified_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
        'sourceObservedAt',pg_catalog.to_char(
          m.observed_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        )
      )
      order by s.external_key,btrim(s.payload->>'ProductGuid'),btrim(s.payload->>'WarehouseId'),s.id
    ),
    count(*)::bigint
  into v_rows,v_row_count
  from public.unleashed_snapshot_run_membership m
  join public.unleashed_raw_snapshots s
    on s.id=m.snapshot_id
   and s.resource=m.resource
   and s.external_key=m.external_key
   and s.payload_sha256=m.payload_sha256
  where m.run_id=p_source_run_id
    and m.resource='stock_on_hand';

  if v_row_count<>v_run.records_seen then
    raise exception 'INVENTORY_REFERENCE_V2_SOURCE_ROW_COUNT_MISMATCH';
  end if;

  v_source_set_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.jsonb_build_object(
        'sourceRunId',p_source_run_id,
        'asAt',pg_catalog.to_char(p_as_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'rows',v_rows
      )::text,
      'sha256'
    ),
    'hex'
  );

  if exists (
    select 1 from public.ecoflow_unleashed_inventory_reference_batches b
    where b.source_set_sha256=v_source_set_hash
       or b.source_run_id=p_source_run_id
  ) then
    raise exception 'INVENTORY_REFERENCE_V2_SOURCE_ALREADY_STAGED';
  end if;

  insert into public.ecoflow_unleashed_inventory_reference_batches(
    id,source_run_id,as_at,source_set_sha256,source_row_count,batch_status,
    revision,stage_command_id,requested_by,reason
  ) values (
    v_batch_id,p_source_run_id,p_as_at,v_source_set_hash,v_row_count,'STAGED',
    0,p_command_id,p_requested_by,btrim(p_reason)
  );

  insert into public.ecoflow_unleashed_inventory_reference_rows(
    batch_id,source_snapshot_id,source_external_key,source_payload_sha256,source_row_sha256,
    source_product_guid,source_product_code,source_warehouse_id,source_warehouse_code,
    qty_on_hand,allocated_qty,on_purchase_qty,available_qty_source,
    source_last_modified_at,source_observed_at
  )
  select
    v_batch_id,
    (j.row->>'sourceSnapshotId')::uuid,
    j.row->>'sourceExternalKey',
    j.row->>'sourcePayloadSha256',
    pg_catalog.encode(extensions.digest(j.row::text,'sha256'),'hex'),
    j.row->>'productGuid',
    j.row->>'productCode',
    j.row->>'warehouseId',
    j.row->>'warehouseCode',
    (j.row->>'qtyOnHand')::numeric,
    (j.row->>'allocatedQty')::numeric,
    (j.row->>'onPurchase')::numeric,
    (j.row->>'availableQty')::numeric,
    nullif(j.row->>'sourceLastModifiedAt','')::timestamptz,
    (j.row->>'sourceObservedAt')::timestamptz
  from pg_catalog.jsonb_array_elements(v_rows) as j(row);

  v_result := pg_catalog.jsonb_build_object(
    'batchId',v_batch_id,
    'batchStatus','STAGED',
    'revision',0,
    'sourceRunId',p_source_run_id,
    'asAt',p_as_at,
    'sourceSetSha256',v_source_set_hash,
    'sourceRowCount',v_row_count,
    'membershipBacked',true,
    'authorityEffect','NONE'
  );

  insert into public.ecoflow_unleashed_inventory_reference_commands(
    command_id,command_type,batch_id,actor_user_id,expected_revision,
    command_payload_sha256,result
  ) values (
    p_command_id,'STAGE',v_batch_id,p_requested_by,null,v_payload_hash,v_result
  );

  insert into public.app_security_audit_events(
    actor_user_id,actor_role,action,target_type,target_id,after_data
  ) values (
    p_requested_by,
    (select p.app_role from public.app_user_profiles p where p.user_id=p_requested_by),
    'UNLEASHED_INVENTORY_REFERENCE_STAGE_V2',
    'ecoflow_unleashed_inventory_reference_batches',
    v_batch_id::text,
    v_result
  );

  return v_result;
end;
$$;

revoke all on function public.ecoflow_stage_unleashed_inventory_reference_v2(uuid,uuid,uuid,timestamptz,text)
  from public,anon,authenticated,service_role;
grant execute on function public.ecoflow_stage_unleashed_inventory_reference_v2(uuid,uuid,uuid,timestamptz,text)
  to service_role;

alter table public.ecoflow_unleashed_inventory_provisional_reference_evidence
  add column if not exists superseded_by_reference_batch_id uuid
    references public.ecoflow_unleashed_inventory_reference_batches(id) on delete restrict,
  add column if not exists superseded_by_reference_row_id uuid
    references public.ecoflow_unleashed_inventory_reference_rows(id) on delete restrict,
  add column if not exists superseded_by uuid,
  add column if not exists superseded_at timestamptz,
  add column if not exists supersede_reason text,
  add column if not exists supersede_command_id uuid;

alter table public.ecoflow_unleashed_inventory_provisional_reference_evidence
  drop constraint if exists ecoflow_unleashed_inventory_provisional_reference__status_check;
alter table public.ecoflow_unleashed_inventory_provisional_reference_evidence
  add constraint ecoflow_unleashed_inventory_provisional_reference__status_check
  check (status in ('PROVISIONAL_REFERENCE','RECONCILED','SUPERSEDED_REFERENCE'));

alter table public.ecoflow_unleashed_inventory_provisional_reference_evidence
  drop constraint if exists ecoflow_unleashed_inventory_provisional_superseded_evidence;
alter table public.ecoflow_unleashed_inventory_provisional_reference_evidence
  add constraint ecoflow_unleashed_inventory_provisional_superseded_evidence check (
    status<>'SUPERSEDED_REFERENCE'
    or (
      superseded_by_reference_batch_id is not null
      and superseded_by_reference_row_id is not null
      and superseded_by is not null
      and superseded_at is not null
      and nullif(btrim(coalesce(supersede_reason,'')),'') is not null
      and supersede_command_id is not null
    )
  );

create or replace function public.ecoflow_read_r5_009_fresh_reference_bridge_gate()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := public.ecoflow_active_app_role();
  v_fresh public.ecoflow_unleashed_inventory_reference_batches%rowtype;
  v_membership integer;
  v_old_status text;
  v_old_revision bigint;
  v_commissionings integer;
  v_provisional integer;
  v_fresh_targets integer;
  v_ready_targets integer;
  v_quantity_rows integer;
  v_movement_rows integer;
  v_inventory_rows integer;
  v_stocktake_rows integer;
  v_safe boolean;
begin
  if v_actor is null then raise exception 'R5_009_AUTH_REQUIRED'; end if;
  if v_role not in ('OWNER','ADMIN') then
    raise exception using errcode='42501',message='OWNER_OR_ADMIN_REQUIRED';
  end if;

  select * into v_fresh
  from public.ecoflow_unleashed_inventory_reference_batches
  where source_run_id='bdca8012-8f78-4dff-b20c-5f5a7d0f8cce'::uuid
  order by created_at desc
  limit 1;

  select count(*)::integer into v_membership
  from public.unleashed_snapshot_run_membership
  where run_id='bdca8012-8f78-4dff-b20c-5f5a7d0f8cce'::uuid
    and resource='stock_on_hand';

  select batch_status,revision into v_old_status,v_old_revision
  from public.ecoflow_unleashed_inventory_reference_batches
  where id='4cdb85d3-06d8-44bf-96bb-93660e10c3c9'::uuid;

  select count(*)::integer into v_commissionings
  from public.ecoflow_unleashed_inventory_commissioning_sets c
  join public.ecoflow_unleashed_inventory_provisional_reference_evidence p
    on p.commissioning_id=c.id
  where p.reference_batch_id='4cdb85d3-06d8-44bf-96bb-93660e10c3c9'::uuid
    and p.source_product_code in ('R-360Y','SB24/32/40LBOX')
    and c.status='DRAFT'
    and c.revision=0
    and c.stocktake_session_id is null
    and c.finalized_at is null
    and c.materialized_at is null
    and not exists (
      select 1 from public.ecoflow_unleashed_inventory_commissioning_locations l
      where l.commissioning_id=c.id
    );

  select count(*)::integer into v_provisional
  from public.ecoflow_unleashed_inventory_provisional_reference_evidence p
  where p.reference_batch_id='4cdb85d3-06d8-44bf-96bb-93660e10c3c9'::uuid
    and p.source_product_code in ('R-360Y','SB24/32/40LBOX')
    and p.status='PROVISIONAL_REFERENCE'
    and p.reconciled_stocktake_session_id is null;

  if v_fresh.id is not null then
    select
      count(*)::integer,
      count(*) filter (
        where v.readiness_status='READY_FOR_LOCATION_EVIDENCE'
          and v.source_warehouse_code='ADL1'
          and v.qty_on_hand=1
      )::integer
    into v_fresh_targets,v_ready_targets
    from public.v_ecoflow_unleashed_inventory_reference_rows v
    where v.batch_id=v_fresh.id
      and v.source_product_code in ('R-360Y','SB24/32/40LBOX');
  else
    v_fresh_targets:=0;
    v_ready_targets:=0;
  end if;

  select count(*)::integer into v_quantity_rows
  from public.ecoflow_warehouse_location_items
  where upper(sku) in ('R-360Y','SB24/32/40LBOX') and quantity<>0;

  select count(*)::integer into v_movement_rows
  from public.ecoflow_warehouse_movements
  where upper(sku) in ('R-360Y','SB24/32/40LBOX');

  select count(*)::integer into v_inventory_rows
  from public.ecoflow_inventory_movements
  where upper(sku) in ('R-360Y','SB24/32/40LBOX');

  select count(*)::integer into v_stocktake_rows
  from public.ecoflow_stocktake_observations
  where upper(sku) in ('R-360Y','SB24/32/40LBOX');

  v_safe :=
    v_membership=428
    and v_fresh.id is not null
    and v_fresh.source_row_count=428
    and v_fresh.batch_status='STAGED'
    and v_fresh.revision=0
    and v_old_status='SEALED'
    and v_old_revision=1
    and v_commissionings=2
    and v_provisional=2
    and v_fresh_targets=2
    and v_ready_targets=2
    and v_quantity_rows=0
    and v_movement_rows=0
    and v_inventory_rows=0
    and v_stocktake_rows=0;

  return pg_catalog.jsonb_build_object(
    'freshBatchId',v_fresh.id,
    'freshBatchStatus',v_fresh.batch_status,
    'freshBatchRevision',v_fresh.revision,
    'freshSourceRowCount',v_fresh.source_row_count,
    'membershipCount',v_membership,
    'oldBatchStatus',v_old_status,
    'oldBatchRevision',v_old_revision,
    'staleDraftCommissioningCount',v_commissionings,
    'provisionalEvidenceCount',v_provisional,
    'freshTargetCount',v_fresh_targets,
    'freshReadyTargetCount',v_ready_targets,
    'warehouseQuantityRows',v_quantity_rows,
    'warehouseMovementRows',v_movement_rows,
    'inventoryMovementRows',v_inventory_rows,
    'stocktakeObservationRows',v_stocktake_rows,
    'safeToActivate',v_safe,
    'authorityEffect','NONE'
  );
end;
$$;

revoke all on function public.ecoflow_read_r5_009_fresh_reference_bridge_gate()
  from public,anon,authenticated,service_role;
grant execute on function public.ecoflow_read_r5_009_fresh_reference_bridge_gate()
  to authenticated;

create or replace function public.ecoflow_activate_r5_009_fresh_reference_bridge()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := public.ecoflow_active_app_role();
  v_command constant uuid := '481b3b1f-381a-4370-8fad-5e5396e05821';
  v_seal_command constant uuid := '719d298b-7c9e-417e-b190-f90d16208a7e';
  v_supersede_batch_command constant uuid := '308fbbd7-8c76-43e0-beb0-3004044ed17b';
  v_old_batch constant uuid := '4cdb85d3-06d8-44bf-96bb-93660e10c3c9';
  v_fresh_run constant uuid := 'bdca8012-8f78-4dff-b20c-5f5a7d0f8cce';
  v_existing public.ecoflow_unleashed_inventory_bridge_commands%rowtype;
  v_fresh public.ecoflow_unleashed_inventory_reference_batches%rowtype;
  v_old public.ecoflow_unleashed_inventory_reference_batches%rowtype;
  v_gate jsonb;
  v_payload_hash text;
  v_seal jsonb;
  v_supersede jsonb;
  v_old_sets integer;
  v_updated_sets integer;
  v_updated_evidence integer;
  v_result jsonb;
begin
  if v_actor is null then raise exception 'R5_009_AUTH_REQUIRED'; end if;
  if v_role not in ('OWNER','ADMIN') then
    raise exception using errcode='42501',message='OWNER_OR_ADMIN_REQUIRED';
  end if;

  v_payload_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.jsonb_build_object(
        'command','ACTIVATE_R5_009_FRESH_REFERENCE',
        'actorUserId',v_actor,
        'freshRunId',v_fresh_run,
        'oldBatchId',v_old_batch,
        'sealCommandId',v_seal_command,
        'supersedeBatchCommandId',v_supersede_batch_command
      )::text,
      'sha256'
    ),
    'hex'
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('r5-009-activate-fresh-reference',0)
  );

  select * into v_existing
  from public.ecoflow_unleashed_inventory_bridge_commands
  where command_id=v_command;
  if found then
    if v_existing.command_type<>'ACTIVATE_R5_009_FRESH_REFERENCE'
       or v_existing.actor_user_id<>v_actor
       or v_existing.command_payload_sha256<>v_payload_hash then
      raise exception 'R5_009_ACTIVATE_COMMAND_REPLAY_MISMATCH';
    end if;
    return v_existing.result;
  end if;

  v_gate := public.ecoflow_read_r5_009_fresh_reference_bridge_gate();
  if coalesce((v_gate->>'safeToActivate')::boolean,false) is not true then
    raise exception 'R5_009_ACTIVATION_PREFLIGHT_NOT_SAFE';
  end if;

  select * into v_fresh
  from public.ecoflow_unleashed_inventory_reference_batches
  where source_run_id=v_fresh_run
  order by created_at desc
  limit 1
  for update;

  select * into v_old
  from public.ecoflow_unleashed_inventory_reference_batches
  where id=v_old_batch
  for update;

  if not found
     or v_fresh.id is null
     or v_fresh.batch_status<>'STAGED'
     or v_fresh.revision<>0
     or v_fresh.source_row_count<>428
     or v_old.batch_status<>'SEALED'
     or v_old.revision<>1 then
    raise exception 'R5_009_ACTIVATION_BATCH_BINDING_MISMATCH';
  end if;

  select count(*)::integer into v_old_sets
  from public.ecoflow_unleashed_inventory_commissioning_sets c
  join public.ecoflow_unleashed_inventory_provisional_reference_evidence p
    on p.commissioning_id=c.id
  where p.reference_batch_id=v_old_batch
    and p.status='PROVISIONAL_REFERENCE'
    and p.reconciled_stocktake_session_id is null
    and c.status='DRAFT'
    and c.revision=0
    and c.stocktake_session_id is null
    and c.finalized_at is null
    and c.materialized_at is null
    and not exists (
      select 1 from public.ecoflow_unleashed_inventory_commissioning_locations l
      where l.commissioning_id=c.id
    )
    and (
      (p.source_product_code='R-360Y'
       and p.source_qty_on_hand=3
       and p.planned_location_code='A2-03-02A')
      or
      (p.source_product_code='SB24/32/40LBOX'
       and p.source_qty_on_hand=5
       and p.planned_location_code='A2-03-03A')
    );

  if v_old_sets<>2 then
    raise exception 'R5_009_STALE_COMMISSIONING_SCOPE_MISMATCH';
  end if;

  if (
    select count(*)
    from public.v_ecoflow_unleashed_inventory_reference_rows v
    where v.batch_id=v_fresh.id
      and v.source_product_code in ('R-360Y','SB24/32/40LBOX')
      and v.source_warehouse_code='ADL1'
      and v.qty_on_hand=1
      and v.readiness_status='READY_FOR_LOCATION_EVIDENCE'
  )<>2 then
    raise exception 'R5_009_FRESH_TARGET_REFERENCE_MISMATCH';
  end if;

  v_seal := public.ecoflow_seal_unleashed_inventory_reference_batch(
    v_fresh.id,0,v_seal_command,
    'ECOFLOW-R5-009 accept complete membership-backed R5-008 ADL1 reference evidence'
  );
  if v_seal->>'batchStatus'<>'SEALED' or (v_seal->>'revision')::bigint<>1 then
    raise exception 'R5_009_FRESH_REFERENCE_SEAL_FAILED';
  end if;

  v_supersede := public.ecoflow_supersede_unleashed_inventory_reference_batch(
    v_old_batch,v_fresh.id,1,v_supersede_batch_command,
    'ECOFLOW-R5-009 replace stale 3/5 planning reference with fresh R5-008 evidence'
  );
  if v_supersede->>'batchStatus'<>'SUPERSEDED' or (v_supersede->>'revision')::bigint<>2 then
    raise exception 'R5_009_OLD_REFERENCE_SUPERSEDE_FAILED';
  end if;

  update public.ecoflow_unleashed_inventory_commissioning_sets c
  set status='SUPERSEDED',
      revision=c.revision+1,
      updated_at=pg_catalog.clock_timestamp()
  from public.ecoflow_unleashed_inventory_provisional_reference_evidence p
  where p.commissioning_id=c.id
    and p.reference_batch_id=v_old_batch
    and p.source_product_code in ('R-360Y','SB24/32/40LBOX')
    and p.status='PROVISIONAL_REFERENCE'
    and c.status='DRAFT'
    and c.revision=0
    and c.stocktake_session_id is null;
  get diagnostics v_updated_sets = row_count;

  update public.ecoflow_unleashed_inventory_provisional_reference_evidence p
  set status='SUPERSEDED_REFERENCE',
      superseded_by_reference_batch_id=v_fresh.id,
      superseded_by_reference_row_id=(
        select r.id
        from public.ecoflow_unleashed_inventory_reference_rows r
        where r.batch_id=v_fresh.id
          and r.source_product_code=p.source_product_code
          and r.source_warehouse_code='ADL1'
        limit 1
      ),
      superseded_by=v_actor,
      superseded_at=pg_catalog.clock_timestamp(),
      supersede_reason='Fresh R5-008 QtyOnHand evidence supersedes relocation planning reference before physical stocktake.',
      supersede_command_id=v_command
  where p.reference_batch_id=v_old_batch
    and p.source_product_code in ('R-360Y','SB24/32/40LBOX')
    and p.status='PROVISIONAL_REFERENCE'
    and p.reconciled_stocktake_session_id is null;
  get diagnostics v_updated_evidence = row_count;

  if v_updated_sets<>2 or v_updated_evidence<>2 then
    raise exception 'R5_009_SUPERSESSION_WRITE_MISMATCH';
  end if;

  v_result := pg_catalog.jsonb_build_object(
    'freshBatchId',v_fresh.id,
    'freshBatchStatus','SEALED',
    'freshBatchRevision',1,
    'oldBatchId',v_old_batch,
    'oldBatchStatus','SUPERSEDED',
    'oldBatchRevision',2,
    'supersededCommissioningCount',v_updated_sets,
    'supersededProvisionalEvidenceCount',v_updated_evidence,
    'freshTargetQtyOnHand',pg_catalog.jsonb_build_object(
      'R-360Y',1,
      'SB24/32/40LBOX',1
    ),
    'physicalStocktakeRequired',true,
    'inventoryAuthorityCreated',false,
    'authorityEffect','NONE'
  );

  insert into public.ecoflow_unleashed_inventory_bridge_commands(
    command_id,command_type,actor_user_id,command_payload_sha256,result
  ) values (
    v_command,'ACTIVATE_R5_009_FRESH_REFERENCE',v_actor,v_payload_hash,v_result
  );

  insert into public.app_security_audit_events(
    actor_user_id,actor_role,action,target_type,target_id,before_data,after_data
  ) values (
    v_actor,v_role,
    'UNLEASHED_R5_009_FRESH_REFERENCE_ACTIVATED',
    'ecoflow_unleashed_inventory_reference_batches',
    v_fresh.id::text,
    pg_catalog.jsonb_build_object(
      'oldBatchId',v_old_batch,
      'oldQtyOnHand',pg_catalog.jsonb_build_object(
        'R-360Y',3,
        'SB24/32/40LBOX',5
      )
    ),
    v_result
  );

  return v_result;
end;
$$;

revoke all on function public.ecoflow_activate_r5_009_fresh_reference_bridge()
  from public,anon,authenticated,service_role;
grant execute on function public.ecoflow_activate_r5_009_fresh_reference_bridge()
  to authenticated;

comment on table public.unleashed_snapshot_run_membership is
  'Immutable per-run membership evidence for every source row actually observed, including unchanged semantic snapshots.';
comment on function public.ecoflow_reconstruct_r5_008_stock_membership(uuid,uuid,text) is
  'R5-009 one-time service-role reconstruction of the complete 428-row R5-008 ADL1 run membership from strict 349+79+1 provenance proof. Creates no inventory authority.';
comment on function public.ecoflow_stage_unleashed_inventory_reference_v2(uuid,uuid,uuid,timestamptz,text) is
  'Membership-backed immutable inventory-reference staging. It creates reference evidence only and no stocktake, warehouse quantity, movement, or inventory authority.';
comment on function public.ecoflow_activate_r5_009_fresh_reference_bridge() is
  'Owner/Admin one-shot lifecycle bridge: seal fresh R5-008 reference, supersede old 3/5 reference and untouched DRAFT commissionings, preserve provisional evidence as superseded history. No inventory authority.';

commit;
