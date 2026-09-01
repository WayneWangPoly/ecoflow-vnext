\set ON_ERROR_STOP on

do $$
declare v_role text;
begin
  foreach v_role in array array['anon','authenticated','service_role'] loop
    if not exists(select 1 from pg_roles where rolname=v_role) then
      execute format('create role %I nologin',v_role);
    end if;
  end loop;
end $$;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists auth;
create schema if not exists storage;

create table if not exists auth.users(
  id uuid primary key default extensions.gen_random_uuid(),
  email text
);
create or replace function auth.uid() returns uuid language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;

create table if not exists storage.buckets(
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects(
  id uuid primary key default extensions.gen_random_uuid(),
  bucket_id text not null,
  name text not null,
  metadata jsonb
);
alter table storage.objects enable row level security;
grant usage on schema auth,storage,extensions to anon,authenticated,service_role;

create table if not exists public.app_user_profiles(
  user_id uuid primary key references auth.users(id),
  email text,
  app_role text not null,
  is_active boolean not null default true,
  team_status text not null default 'ACTIVE'
);
create or replace function public.ecoflow_active_app_role() returns text
language sql stable security definer set search_path=pg_catalog,public
as $$
  select p.app_role from public.app_user_profiles p
  where p.user_id=auth.uid() and p.is_active and p.team_status='ACTIVE'
$$;

create table if not exists public.app_security_audit_events(
  id uuid primary key default extensions.gen_random_uuid(),
  actor_user_id uuid,
  actor_email text,
  actor_role text,
  action text not null,
  target_type text,
  target_id text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.unleashed_sync_runs(
  id uuid primary key default extensions.gen_random_uuid()
);
create table if not exists public.unleashed_external_identities(
  id uuid primary key default extensions.gen_random_uuid(),
  resource text not null,
  external_key text not null,
  external_guid text,
  external_code text,
  last_seen_run_id uuid references public.unleashed_sync_runs(id),
  unique(resource,external_key)
);
create table if not exists public.unleashed_raw_snapshots(
  id uuid primary key default extensions.gen_random_uuid(),
  resource text not null,
  external_key text not null,
  payload jsonb not null,
  payload_sha256 text not null,
  last_seen_at timestamptz not null default now(),
  unique(resource,external_key)
);
create table if not exists public.skus(
  id uuid primary key default extensions.gen_random_uuid(),
  sku_code text not null unique
);
create table if not exists public.external_product_mappings(
  id uuid primary key default extensions.gen_random_uuid(),
  provider text not null,
  external_product_code text not null,
  internal_sku_id uuid not null references public.skus(id),
  is_active boolean not null default true,
  unique(provider,external_product_code)
);
create table if not exists public.warehouses(
  id uuid primary key default extensions.gen_random_uuid(),
  warehouse_code text not null unique
);
create table if not exists public.ecoflow_external_object_mappings(
  id uuid primary key default extensions.gen_random_uuid(),
  external_system text not null,
  external_resource_type text not null,
  external_id text not null,
  internal_object_type text not null,
  internal_object_id uuid,
  internal_code text,
  mapping_status text not null
);

\ir ../supabase/migrations/20260831235500_unleashed_master_data_bridge.sql
\ir ../supabase/migrations/20260831235500_unleashed_master_data_bridge.sql

do $$
declare
  v_owner uuid := '10000000-0000-4000-8000-000000000001';
  v_viewer uuid := '10000000-0000-4000-8000-000000000002';
  v_run uuid := '20000000-0000-4000-8000-000000000001';
  v_sku uuid := '30000000-0000-4000-8000-000000000001';
  v_warehouse uuid := '40000000-0000-4000-8000-000000000001';
begin
  insert into auth.users(id,email) values
    (v_owner,'owner@example.test'),(v_viewer,'viewer@example.test')
  on conflict(id) do nothing;
  insert into public.app_user_profiles(user_id,email,app_role,is_active,team_status) values
    (v_owner,'owner@example.test','OWNER',true,'ACTIVE'),
    (v_viewer,'viewer@example.test','VIEWER',true,'ACTIVE')
  on conflict(user_id) do update set app_role=excluded.app_role,is_active=true,team_status='ACTIVE';
  insert into public.unleashed_sync_runs(id) values(v_run) on conflict do nothing;
  insert into public.skus(id,sku_code) values(v_sku,'SKU-MATCH') on conflict do nothing;
  insert into public.external_product_mappings(provider,external_product_code,internal_sku_id,is_active)
  values('ORDERMENTUM','MATCH',v_sku,true),('ORDERMENTUM','DUP',v_sku,true)
  on conflict(provider,external_product_code) do update set internal_sku_id=excluded.internal_sku_id,is_active=true;
  insert into public.warehouses(id,warehouse_code) values(v_warehouse,'MAIN') on conflict do nothing;

  insert into public.unleashed_external_identities(
    resource,external_key,external_guid,external_code,last_seen_run_id
  ) values
    ('products','guid:50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','MATCH',v_run),
    ('products','guid:50000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000002','NONE',v_run),
    ('products','guid:50000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000003','DUP',v_run),
    ('products','guid:50000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000004','DUP',v_run),
    ('products','guid:50000000-0000-4000-8000-000000000005','50000000-0000-4000-8000-000000000005','OLD',v_run),
    ('warehouses','guid:60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','MAIN',v_run),
    ('customers','guid:70000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','CUSTOMER-X',v_run)
  on conflict(resource,external_key) do update set external_code=excluded.external_code,last_seen_run_id=excluded.last_seen_run_id;

  insert into public.unleashed_raw_snapshots(resource,external_key,payload,payload_sha256,last_seen_at)
  select x.resource,x.external_key,x.payload,
    encode(extensions.digest(x.payload::text,'sha256'),'hex'),now()
  from (values
    ('products','guid:50000000-0000-4000-8000-000000000001','{"ProductCode":"MATCH","Obsolete":false,"ImageUrl":"https://unlappcdn.unleashedsoftware.com/images/a.jpg"}'::jsonb),
    ('products','guid:50000000-0000-4000-8000-000000000002','{"ProductCode":"NONE","Obsolete":false}'::jsonb),
    ('products','guid:50000000-0000-4000-8000-000000000003','{"ProductCode":"DUP","Obsolete":false}'::jsonb),
    ('products','guid:50000000-0000-4000-8000-000000000004','{"ProductCode":"DUP","Obsolete":false}'::jsonb),
    ('products','guid:50000000-0000-4000-8000-000000000005','{"ProductCode":"OLD","Obsolete":true}'::jsonb),
    ('warehouses','guid:60000000-0000-4000-8000-000000000001','{"WarehouseCode":"MAIN"}'::jsonb),
    ('customers','guid:70000000-0000-4000-8000-000000000001','{"CustomerCode":"CUSTOMER-X"}'::jsonb)
  ) as x(resource,external_key,payload)
  on conflict(resource,external_key) do update set payload=excluded.payload,payload_sha256=excluded.payload_sha256,last_seen_at=excluded.last_seen_at;
end $$;

select public.ecoflow_plan_unleashed_master_mappings(
  '10000000-0000-4000-8000-000000000001','DB contract initial plan'
);

do $$
declare
  v_counts jsonb;
  v_rows bigint;
  v_candidates bigint;
  v_revision_sum bigint;
begin
  select jsonb_object_agg(mapping_status,row_count) into v_counts
  from (
    select mapping_status,count(*)::bigint row_count
    from public.ecoflow_unleashed_master_mappings group by mapping_status
  ) s;
  if coalesce((v_counts->>'MATCHED')::bigint,0)<>2
     or coalesce((v_counts->>'AMBIGUOUS')::bigint,0)<>2
     or coalesce((v_counts->>'UNMATCHED')::bigint,0)<>2
     or coalesce((v_counts->>'RETIRED')::bigint,0)<>1 then
    raise exception 'unexpected mapping status counts: %',v_counts;
  end if;
  select count(*),coalesce(sum(revision),0) into v_rows,v_revision_sum
  from public.ecoflow_unleashed_master_mappings;
  select count(*) into v_candidates from public.ecoflow_unleashed_master_candidates;
  if v_rows<>7 or v_candidates<>4 or v_revision_sum<>0 then
    raise exception 'unexpected plan rows/candidates/revisions: %/%/%',v_rows,v_candidates,v_revision_sum;
  end if;
end $$;

select public.ecoflow_plan_unleashed_master_mappings(
  '10000000-0000-4000-8000-000000000001','DB contract replay plan'
);

do $$
declare v_rows bigint; v_candidates bigint; v_revision_sum bigint;
begin
  select count(*),coalesce(sum(revision),0) into v_rows,v_revision_sum
  from public.ecoflow_unleashed_master_mappings;
  select count(*) into v_candidates from public.ecoflow_unleashed_master_candidates;
  if v_rows<>7 or v_candidates<>4 or v_revision_sum<>0 then
    raise exception 'planner replay was not idempotent: %/%/%',v_rows,v_candidates,v_revision_sum;
  end if;
end $$;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);

do $$
declare v_mapping uuid; v_result jsonb; v_replay jsonb; v_failed boolean := false;
begin
  select id into v_mapping from public.ecoflow_unleashed_master_mappings where source_external_code='NONE';
  v_result := public.ecoflow_review_unleashed_master_mapping(
    v_mapping,'80000000-0000-4000-8000-000000000001',0,'UNMATCHED',null,'Confirmed source exception'
  );
  v_replay := public.ecoflow_review_unleashed_master_mapping(
    v_mapping,'80000000-0000-4000-8000-000000000001',0,'UNMATCHED',null,'Confirmed source exception'
  );
  if (v_result->>'revision')::bigint<>1 or (v_replay->>'revision')::bigint<>1 then
    raise exception 'mapping command replay result mismatch';
  end if;
  begin
    perform public.ecoflow_review_unleashed_master_mapping(
      v_mapping,'80000000-0000-4000-8000-000000000001',0,'RETIRED',null,'Different replay payload'
    );
  exception when others then
    if position('COMMAND_REPLAY_PAYLOAD_MISMATCH' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'changed command replay did not fail'; end if;
  v_failed:=false;
  begin
    perform public.ecoflow_review_unleashed_master_mapping(
      v_mapping,'80000000-0000-4000-8000-000000000002',0,'UNMATCHED',null,'Stale revision attempt'
    );
  exception when others then
    if position('MAPPING_REVISION_CONFLICT' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'stale mapping revision did not fail'; end if;
end $$;

-- A reviewed MATCHED decision must survive an identical PLAN replay, and its
-- historical command/candidate evidence must remain intact after source drift.
do $$
declare
  v_mapping uuid;
  v_candidate uuid;
  v_command_candidate uuid;
  v_revision bigint;
  v_decision_source text;
  v_status text;
  v_current_candidates bigint;
  v_snapshot jsonb;
begin
  select m.id into v_mapping
  from public.ecoflow_unleashed_master_mappings m
  where m.source_external_code='MATCH';
  select c.id into v_candidate
  from public.ecoflow_unleashed_master_candidates c
  where c.mapping_id=v_mapping and c.is_current;

  perform public.ecoflow_review_unleashed_master_mapping(
    v_mapping,'80000000-0000-4000-8000-000000000003',0,'MATCHED',v_candidate,
    'Owner confirmed deterministic commercial identity'
  );
  perform public.ecoflow_plan_unleashed_master_mappings(
    '10000000-0000-4000-8000-000000000001','DB contract reviewed replay plan'
  );

  select m.revision,m.decision_source,m.mapping_status
  into v_revision,v_decision_source,v_status
  from public.ecoflow_unleashed_master_mappings m where m.id=v_mapping;
  if v_revision<>1 or v_decision_source<>'REVIEW' or v_status<>'MATCHED' then
    raise exception 'reviewed mapping was not preserved by identical PLAN: %/%/%',
      v_revision,v_decision_source,v_status;
  end if;

  update public.unleashed_raw_snapshots s set
    payload=s.payload||'{"Description":"source changed"}'::jsonb,
    payload_sha256=encode(extensions.digest(
      (s.payload||'{"Description":"source changed"}'::jsonb)::text,'sha256'
    ),'hex'),
    last_seen_at=now()
  where s.resource='products'
    and s.external_key='guid:50000000-0000-4000-8000-000000000001';
  perform public.ecoflow_plan_unleashed_master_mappings(
    '10000000-0000-4000-8000-000000000001','DB contract source-change plan'
  );

  select m.revision,m.decision_source,m.mapping_status
  into v_revision,v_decision_source,v_status
  from public.ecoflow_unleashed_master_mappings m where m.id=v_mapping;
  select count(*) into v_current_candidates
  from public.ecoflow_unleashed_master_candidates c
  where c.mapping_id=v_mapping and c.is_current;
  select c.requested_candidate_id,c.selected_candidate_snapshot
  into v_command_candidate,v_snapshot
  from public.ecoflow_unleashed_mapping_commands c
  where c.command_id='80000000-0000-4000-8000-000000000003';
  if v_revision<>2 or v_decision_source<>'AUTO' or v_status<>'MATCHED'
     or v_current_candidates<>1 or v_command_candidate<>v_candidate
     or v_snapshot->>'candidateId' is distinct from v_candidate::text then
    raise exception 'source-change candidate history contract failed: %/%/%/%/%/%',
      v_revision,v_decision_source,v_status,v_current_candidates,v_command_candidate,v_snapshot;
  end if;
end $$;

-- Canonical-side drift must invalidate a review even when the Unleashed
-- payload is unchanged; the accepted candidate remains durable evidence.
do $$
declare
  v_mapping uuid;
  v_candidate uuid;
  v_revision bigint;
  v_decision_source text;
  v_status text;
  v_current_candidates bigint;
  v_snapshot jsonb;
begin
  select m.id into v_mapping
  from public.ecoflow_unleashed_master_mappings m
  where m.source_external_code='MAIN';
  select c.id into v_candidate
  from public.ecoflow_unleashed_master_candidates c
  where c.mapping_id=v_mapping and c.is_current;

  perform public.ecoflow_review_unleashed_master_mapping(
    v_mapping,'80000000-0000-4000-8000-000000000004',0,'MATCHED',v_candidate,
    'Owner confirmed deterministic warehouse identity'
  );
  update public.warehouses set warehouse_code='MAIN-RENAMED'
  where id='40000000-0000-4000-8000-000000000001';
  perform public.ecoflow_plan_unleashed_master_mappings(
    '10000000-0000-4000-8000-000000000001','DB contract canonical-change plan'
  );

  select m.revision,m.decision_source,m.mapping_status
  into v_revision,v_decision_source,v_status
  from public.ecoflow_unleashed_master_mappings m where m.id=v_mapping;
  select count(*) into v_current_candidates
  from public.ecoflow_unleashed_master_candidates c
  where c.mapping_id=v_mapping and c.is_current;
  select c.selected_candidate_snapshot into v_snapshot
  from public.ecoflow_unleashed_mapping_commands c
  where c.command_id='80000000-0000-4000-8000-000000000004';
  if v_revision<>2 or v_decision_source<>'AUTO' or v_status<>'UNMATCHED'
     or v_current_candidates<>0
     or v_snapshot->>'canonicalObjectId' is distinct from
       '40000000-0000-4000-8000-000000000001' then
    raise exception 'canonical-change review invalidation failed: %/%/%/%/%',
      v_revision,v_decision_source,v_status,v_current_candidates,v_snapshot;
  end if;
end $$;

do $$
declare v_result jsonb; v_replay jsonb; v_failed boolean := false;
begin
  v_result := public.ecoflow_set_unleashed_asset_authorization(
    '90000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
    0,'APPROVED','RIGHTS-TICKET-1','P0 product catalogue',52428800,5242880,
    now()+interval '30 days','Owner approved bounded image migration'
  );
  v_replay := public.ecoflow_set_unleashed_asset_authorization(
    '90000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
    0,'APPROVED','RIGHTS-TICKET-1','P0 product catalogue',52428800,5242880,
    (select expires_at from public.ecoflow_unleashed_asset_authorizations where is_current),
    'Owner approved bounded image migration'
  );
  if (v_result->>'revision')::bigint<>1 or (v_replay->>'revision')::bigint<>1 then
    raise exception 'asset authorization replay result mismatch';
  end if;
  begin
    perform public.ecoflow_set_unleashed_asset_authorization(
      '90000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',
      0,'REVOKED',null,null,null,null,null,'Stale authorization revision'
    );
  exception when others then
    if position('ASSET_AUTHORIZATION_REVISION_CONFLICT' in sqlerrm)>0 then v_failed:=true; else raise; end if;
  end;
  if not v_failed then raise exception 'stale authorization revision did not fail'; end if;
end $$;

-- Only one image copy run may hold the storage-budget lease at a time.
do $$
declare
  v_authorization uuid;
  v_failed boolean := false;
begin
  select id into v_authorization
  from public.ecoflow_unleashed_asset_authorizations where is_current;
  insert into public.ecoflow_unleashed_asset_copy_runs(
    command_id,command_payload_sha256,requested_by,requested_limit,authorization_id
  ) values(
    '91000000-0000-4000-8000-000000000001',repeat('a',64),
    '10000000-0000-4000-8000-000000000001',1,v_authorization
  );
  begin
    insert into public.ecoflow_unleashed_asset_copy_runs(
      command_id,command_payload_sha256,requested_by,requested_limit,authorization_id
    ) values(
      '91000000-0000-4000-8000-000000000002',repeat('b',64),
      '10000000-0000-4000-8000-000000000001',1,v_authorization
    );
  exception when unique_violation then
    v_failed:=true;
  end;
  if not v_failed then raise exception 'parallel copy-run budget lease was not blocked'; end if;
  update public.ecoflow_unleashed_asset_copy_runs
  set status='FAILED',completed_at=now(),error_code='DB_CONTRACT_RELEASE'
  where command_id='91000000-0000-4000-8000-000000000001';
end $$;

do $$
declare
  v_function_count bigint;
begin
  select count(*) into v_function_count
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in (
    'ecoflow_plan_unleashed_master_mappings',
    'ecoflow_review_unleashed_master_mapping',
    'ecoflow_set_unleashed_asset_authorization'
  );
  if v_function_count<>3 then
    raise exception 'expected three privileged bridge functions, found %',v_function_count;
  end if;
  if exists(
    select 1
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'ecoflow_plan_unleashed_master_mappings',
      'ecoflow_review_unleashed_master_mapping',
      'ecoflow_set_unleashed_asset_authorization'
    ) and (
      p.proconfig is null
      or position('search_path=' in array_to_string(p.proconfig,','))=0
      or position('public' in array_to_string(p.proconfig,','))>0
    )
  ) then
    raise exception 'privileged bridge function search_path is not empty';
  end if;
  if exists(
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    where n.nspname='public'
      and p.proname in (
        'ecoflow_plan_unleashed_master_mappings',
        'ecoflow_review_unleashed_master_mapping',
        'ecoflow_set_unleashed_asset_authorization'
      )
      and acl.grantee=0
      and acl.privilege_type='EXECUTE'
  ) then
    raise exception 'PUBLIC can execute a privileged bridge function';
  end if;
end $$;

do $$
declare v_write_policies bigint;
begin
  if exists(select 1 from storage.buckets where id='unleashed-product-images') then
    raise exception 'schema deployment mutated the managed Storage bucket catalogue';
  end if;
  select count(*) into v_write_policies from pg_policies
  where schemaname='storage' and tablename='objects'
    and roles::text like '%authenticated%'
    and cmd in ('INSERT','UPDATE','DELETE')
    and coalesce(with_check,qual,'') like '%unleashed-product-images%';
  if v_write_policies<>0 then raise exception 'authenticated product image write policy exists'; end if;
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false);
do $$
declare v_visible bigint; v_blocked boolean := false;
begin
  select count(*) into v_visible from public.v_ecoflow_unleashed_master_review_queue;
  if v_visible<>0 then raise exception 'viewer can read master review queue'; end if;
  begin
    insert into public.ecoflow_unleashed_master_mappings(
      identity_id,entity_type,mapping_status,source_external_key,source_payload_sha256,source_observed_at
    ) values(
      extensions.gen_random_uuid(),'PRODUCT','UNMATCHED','forbidden',repeat('a',64),now()
    );
  exception when insufficient_privilege then v_blocked:=true;
  end;
  if not v_blocked then raise exception 'authenticated direct mapping insert was not blocked'; end if;
end $$;
reset role;

do $$
declare v_queue bigint; v_audits bigint;
begin
  select count(*) into v_queue from public.v_ecoflow_unleashed_master_review_queue;
  if v_queue<4 then raise exception 'owner review queue lost governed exceptions'; end if;
  select count(*) into v_audits from public.app_security_audit_events
  where action in (
    'UNLEASHED_MASTER_MAPPING_PLANNED',
    'UNLEASHED_MASTER_MAPPING_REVIEWED',
    'UNLEASHED_ASSET_AUTHORIZATION_CHANGED'
  );
  if v_audits<4 then raise exception 'governed audit evidence missing: %',v_audits; end if;
end $$;

select 'UNLEASHED_MASTER_DATA_BRIDGE_DB_CONTRACT_PASS' as result;
