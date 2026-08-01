-- Phase 9D/9E: governed initial stocktake, cycle count and paired SKU transfer.
-- Physical observations are evidence only until an Owner/Admin approval command.

begin;

alter table public.ecoflow_warehouse_movements
  add column if not exists transfer_reference text;

create index if not exists idx_ecoflow_warehouse_movements_transfer
  on public.ecoflow_warehouse_movements(transfer_reference,created_at)
  where transfer_reference is not null;

create table if not exists public.ecoflow_stocktake_sessions (
  id uuid primary key default gen_random_uuid(),
  session_type text not null check (session_type in ('INITIAL','CYCLE_COUNT')),
  session_status text not null default 'OPEN'
    check (session_status in ('OPEN','IN_PROGRESS','REVIEW','APPROVED','CANCELLED')),
  title text not null check (btrim(title)<>'' and length(title)<=160),
  rack_id text,
  assigned_user_id uuid,
  blind_count boolean not null default false,
  reason text not null check (btrim(reason)<>'' and length(reason)<=2000),
  revision bigint not null default 1 check (revision>=1),
  start_command_id uuid not null unique,
  approval_command_id uuid unique,
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  submitted_by uuid,
  submitted_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  approval_note text,
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.ecoflow_stocktake_location_progress (
  session_id uuid not null references public.ecoflow_stocktake_sessions(id) on delete restrict,
  location_id uuid not null references public.ecoflow_warehouse_locations(id) on delete restrict,
  location_code text not null,
  progress_status text not null default 'IN_PROGRESS'
    check (progress_status in ('IN_PROGRESS','REVIEW_REQUIRED','COMPLETE','APPROVED')),
  observation_count integer not null default 0 check (observation_count>=0),
  exception_count integer not null default 0 check (exception_count>=0),
  completed_by uuid,
  completed_at timestamptz,
  reopened_by uuid,
  reopened_at timestamptz,
  reopen_reason text,
  revision bigint not null default 1 check (revision>=1),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(session_id,location_id)
);

create table if not exists public.ecoflow_stocktake_observations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.ecoflow_stocktake_sessions(id) on delete restrict,
  location_id uuid not null references public.ecoflow_warehouse_locations(id) on delete restrict,
  location_code text not null,
  sku text not null check (btrim(sku)<>''),
  product_name text,
  barcode text,
  unit_level text not null check (unit_level in ('carton','sleeve','each')),
  units_per_package numeric not null
    check (units_per_package>0 and units_per_package=trunc(units_per_package)),
  quantity_packages numeric not null
    check (quantity_packages>=0 and quantity_packages=trunc(quantity_packages)),
  note text,
  exception_codes text[] not null default '{}'::text[],
  review_status text not null default 'PENDING'
    check (review_status in ('PENDING','ACCEPTED','RECOUNT_REQUIRED')),
  command_id uuid not null unique,
  observed_by uuid not null,
  observed_at timestamptz not null default clock_timestamp(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text
);

create index if not exists idx_ecoflow_stocktake_observations_session
  on public.ecoflow_stocktake_observations(session_id,location_code,sku,unit_level,observed_at);

create table if not exists public.ecoflow_stocktake_events (
  event_id uuid primary key default gen_random_uuid(),
  command_id uuid not null unique,
  session_id uuid not null references public.ecoflow_stocktake_sessions(id) on delete restrict,
  event_type text not null,
  location_code text,
  observation_id uuid,
  actor_user_id uuid not null,
  actor_role text not null,
  reason text,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload)='object'),
  created_at timestamptz not null default clock_timestamp()
);

create table if not exists public.ecoflow_warehouse_transfer_commands (
  command_id uuid primary key,
  transfer_reference text not null unique,
  sku text not null,
  unit_level text not null,
  source_location text not null,
  destination_location text not null,
  quantity numeric not null check (quantity>0),
  source_before numeric not null,
  source_after numeric not null check (source_after>=0),
  destination_before numeric not null,
  destination_after numeric not null,
  reason text not null,
  actor_user_id uuid not null,
  actor_role text not null,
  created_at timestamptz not null default clock_timestamp()
);

alter table public.ecoflow_stocktake_sessions enable row level security;
alter table public.ecoflow_stocktake_location_progress enable row level security;
alter table public.ecoflow_stocktake_observations enable row level security;
alter table public.ecoflow_stocktake_events enable row level security;
alter table public.ecoflow_warehouse_transfer_commands enable row level security;

revoke all on public.ecoflow_stocktake_sessions from public,anon,authenticated;
revoke all on public.ecoflow_stocktake_location_progress from public,anon,authenticated;
revoke all on public.ecoflow_stocktake_observations from public,anon,authenticated;
revoke all on public.ecoflow_stocktake_events from public,anon,authenticated;
revoke all on public.ecoflow_warehouse_transfer_commands from public,anon,authenticated;

create or replace function public.ecoflow_prevent_stocktake_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
begin
  raise exception using errcode='55000',message='STOCKTAKE_EVENT_IMMUTABLE';
end;
$$;

drop trigger if exists trg_ecoflow_stocktake_event_immutable on public.ecoflow_stocktake_events;
create trigger trg_ecoflow_stocktake_event_immutable
before update or delete on public.ecoflow_stocktake_events
for each row execute function public.ecoflow_prevent_stocktake_event_mutation();

create or replace function public.ecoflow_require_warehouse_control_role(p_supervisor boolean default false)
returns text
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
declare
  v_role text:=public.ecoflow_active_app_role();
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='AUTHENTICATED_USER_REQUIRED';
  end if;
  if p_supervisor and v_role not in ('OWNER','ADMIN') then
    raise exception using errcode='42501',message='STOCKTAKE_SUPERVISOR_REQUIRED';
  end if;
  if not p_supervisor and v_role not in ('OWNER','ADMIN','WAREHOUSE') then
    raise exception using errcode='42501',message='WAREHOUSE_CONTROL_ROLE_REQUIRED';
  end if;
  return v_role;
end;
$$;

create or replace function public.ecoflow_start_stocktake_session(
  p_session_type text,
  p_title text,
  p_rack_id text,
  p_assigned_user_id uuid,
  p_blind_count boolean,
  p_reason text,
  p_command_id uuid
)
returns table(session_id uuid,session_status text,revision bigint,created_at timestamptz)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_role text:=public.ecoflow_require_warehouse_control_role(false);
  v_type text:=upper(btrim(coalesce(p_session_type,'')));
  v_reason text:=nullif(btrim(coalesce(p_reason,'')),'');
  v_row public.ecoflow_stocktake_sessions%rowtype;
begin
  if v_type not in ('INITIAL','CYCLE_COUNT') then raise exception 'VALID_STOCKTAKE_SESSION_TYPE_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_title,'')),'') is null then raise exception 'STOCKTAKE_TITLE_REQUIRED'; end if;
  if v_reason is null then raise exception 'STOCKTAKE_REASON_REQUIRED'; end if;
  if p_command_id is null then raise exception 'STOCKTAKE_COMMAND_ID_REQUIRED'; end if;

  perform pg_advisory_xact_lock(hashtextextended('stocktake-start:'||p_command_id::text,0));
  select * into v_row from public.ecoflow_stocktake_sessions where start_command_id=p_command_id;
  if found then
    return query select v_row.id,v_row.session_status,v_row.revision,v_row.created_at;
    return;
  end if;

  insert into public.ecoflow_stocktake_sessions(
    session_type,title,rack_id,assigned_user_id,blind_count,reason,
    start_command_id,created_by
  ) values (
    v_type,left(btrim(p_title),160),nullif(btrim(coalesce(p_rack_id,'')),''),
    p_assigned_user_id,coalesce(p_blind_count,false),left(v_reason,2000),
    p_command_id,auth.uid()
  ) returning * into v_row;

  insert into public.ecoflow_stocktake_events(
    command_id,session_id,event_type,actor_user_id,actor_role,reason,payload
  ) values (
    p_command_id,v_row.id,'SESSION_STARTED',auth.uid(),v_role,v_reason,
    jsonb_build_object('sessionType',v_type,'rackId',v_row.rack_id,'blindCount',v_row.blind_count)
  );

  return query select v_row.id,v_row.session_status,v_row.revision,v_row.created_at;
end;
$$;

create or replace function public.ecoflow_record_stocktake_observation(
  p_session_id uuid,
  p_location_code text,
  p_sku text,
  p_product_name text,
  p_barcode text,
  p_unit_level text,
  p_units_per_package numeric,
  p_quantity_packages numeric,
  p_note text,
  p_command_id uuid
)
returns table(observation_id uuid,review_status text,exception_codes text[],observed_at timestamptz)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_role text:=public.ecoflow_require_warehouse_control_role(false);
  v_session public.ecoflow_stocktake_sessions%rowtype;
  v_location public.ecoflow_warehouse_locations%rowtype;
  v_row public.ecoflow_stocktake_observations%rowtype;
  v_sku text:=upper(btrim(coalesce(p_sku,'')));
  v_barcode text:=nullif(btrim(coalesce(p_barcode,'')),'');
  v_level text:=lower(btrim(coalesce(p_unit_level,'')));
  v_exceptions text[]:=array[]::text[];
  v_mapped_sku text;
begin
  if p_command_id is null then raise exception 'STOCKTAKE_COMMAND_ID_REQUIRED'; end if;
  select * into v_row from public.ecoflow_stocktake_observations where command_id=p_command_id;
  if found then
    return query select v_row.id,v_row.review_status,v_row.exception_codes,v_row.observed_at;
    return;
  end if;

  select * into v_session
  from public.ecoflow_stocktake_sessions
  where id=p_session_id
  for update;
  if not found or v_session.session_status not in ('OPEN','IN_PROGRESS') then
    raise exception 'OPEN_STOCKTAKE_SESSION_REQUIRED';
  end if;

  select * into v_location
  from public.ecoflow_warehouse_locations
  where upper(location_code)=upper(btrim(coalesce(p_location_code,'')))
    and status='ACTIVE'
  limit 1;
  if not found then raise exception 'ACTIVE_WAREHOUSE_LOCATION_REQUIRED'; end if;
  if v_sku='' then raise exception 'STOCKTAKE_SKU_REQUIRED'; end if;
  if v_level not in ('carton','sleeve','each') then raise exception 'VALID_PACKAGE_LEVEL_REQUIRED'; end if;
  if p_units_per_package is null or p_units_per_package<=0 or p_units_per_package<>trunc(p_units_per_package) then
    raise exception 'VALID_UNITS_PER_PACKAGE_REQUIRED';
  end if;
  if p_quantity_packages is null or p_quantity_packages<0 or p_quantity_packages<>trunc(p_quantity_packages) then
    raise exception 'VALID_PHYSICAL_COUNT_REQUIRED';
  end if;

  if v_barcode is null then
    v_exceptions:=array_append(v_exceptions,'MISSING_BARCODE');
  else
    select upper(r.sku) into v_mapped_sku
    from public.ecoflow_sku_barcode_registry r
    where r.barcode=v_barcode
    limit 1;
    if v_mapped_sku is null then
      v_exceptions:=array_append(v_exceptions,'UNKNOWN_BARCODE');
    elsif v_mapped_sku<>v_sku then
      v_exceptions:=array_append(v_exceptions,'BARCODE_SKU_MISMATCH');
    end if;
    if exists(
      select 1 from public.ecoflow_stocktake_observations o
      where o.session_id=p_session_id and o.barcode=v_barcode and upper(o.sku)<>v_sku
    ) then
      v_exceptions:=array_append(v_exceptions,'DUPLICATE_BARCODE_CONFLICT');
    end if;
  end if;

  insert into public.ecoflow_stocktake_observations(
    session_id,location_id,location_code,sku,product_name,barcode,
    unit_level,units_per_package,quantity_packages,note,exception_codes,
    review_status,command_id,observed_by
  ) values (
    p_session_id,v_location.id,v_location.location_code,v_sku,
    nullif(btrim(coalesce(p_product_name,'')),''),v_barcode,v_level,
    p_units_per_package,p_quantity_packages,nullif(btrim(coalesce(p_note,'')),''),
    v_exceptions,case when cardinality(v_exceptions)>0 then 'RECOUNT_REQUIRED' else 'PENDING' end,
    p_command_id,auth.uid()
  ) returning * into v_row;

  insert into public.ecoflow_stocktake_location_progress(
    session_id,location_id,location_code,progress_status,observation_count,exception_count
  ) values (
    p_session_id,v_location.id,v_location.location_code,
    case when cardinality(v_exceptions)>0 then 'REVIEW_REQUIRED' else 'IN_PROGRESS' end,
    1,cardinality(v_exceptions)
  )
  on conflict(session_id,location_id) do update set
    progress_status=case
      when public.ecoflow_stocktake_location_progress.exception_count+excluded.exception_count>0
        then 'REVIEW_REQUIRED'
      else 'IN_PROGRESS'
    end,
    observation_count=public.ecoflow_stocktake_location_progress.observation_count+1,
    exception_count=public.ecoflow_stocktake_location_progress.exception_count+excluded.exception_count,
    completed_by=null,completed_at=null,reopened_by=null,reopened_at=null,reopen_reason=null,
    revision=public.ecoflow_stocktake_location_progress.revision+1,
    updated_at=clock_timestamp();

  update public.ecoflow_stocktake_sessions
  set session_status='IN_PROGRESS',revision=revision+1,updated_at=clock_timestamp()
  where id=p_session_id;

  insert into public.ecoflow_stocktake_events(
    command_id,session_id,event_type,location_code,observation_id,
    actor_user_id,actor_role,payload
  ) values (
    p_command_id,p_session_id,'OBSERVATION_RECORDED',v_location.location_code,v_row.id,
    auth.uid(),v_role,jsonb_build_object(
      'sku',v_sku,'unitLevel',v_level,'quantityPackages',p_quantity_packages,
      'exceptionCodes',v_exceptions
    )
  );

  return query select v_row.id,v_row.review_status,v_row.exception_codes,v_row.observed_at;
end;
$$;

create or replace function public.ecoflow_review_stocktake_observation(
  p_observation_id uuid,
  p_accept boolean,
  p_note text,
  p_command_id uuid
)
returns table(observation_id uuid,review_status text,reviewed_at timestamptz)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_role text:=public.ecoflow_require_warehouse_control_role(true);
  v_row public.ecoflow_stocktake_observations%rowtype;
  v_status text:=case when coalesce(p_accept,false) then 'ACCEPTED' else 'RECOUNT_REQUIRED' end;
begin
  if p_command_id is null then raise exception 'STOCKTAKE_COMMAND_ID_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_note,'')),'') is null then raise exception 'STOCKTAKE_REVIEW_NOTE_REQUIRED'; end if;
  if exists(select 1 from public.ecoflow_stocktake_events where command_id=p_command_id) then
    select * into v_row from public.ecoflow_stocktake_observations where id=p_observation_id;
    return query select v_row.id,v_row.review_status,v_row.reviewed_at;
    return;
  end if;

  select * into v_row
  from public.ecoflow_stocktake_observations
  where id=p_observation_id
  for update;
  if not found then raise exception 'STOCKTAKE_OBSERVATION_NOT_FOUND'; end if;

  update public.ecoflow_stocktake_observations
  set review_status=v_status,reviewed_by=auth.uid(),reviewed_at=clock_timestamp(),
      review_note=left(btrim(p_note),2000)
  where id=p_observation_id
  returning * into v_row;

  update public.ecoflow_stocktake_location_progress p
  set exception_count=(
        select count(*) from public.ecoflow_stocktake_observations o
        where o.session_id=p.session_id and o.location_id=p.location_id
          and cardinality(o.exception_codes)>0 and o.review_status<>'ACCEPTED'
      ),
      progress_status=case when exists(
        select 1 from public.ecoflow_stocktake_observations o
        where o.session_id=p.session_id and o.location_id=p.location_id
          and cardinality(o.exception_codes)>0 and o.review_status<>'ACCEPTED'
      ) then 'REVIEW_REQUIRED' else 'IN_PROGRESS' end,
      revision=revision+1,updated_at=clock_timestamp()
  where p.session_id=v_row.session_id and p.location_id=v_row.location_id;

  insert into public.ecoflow_stocktake_events(
    command_id,session_id,event_type,location_code,observation_id,
    actor_user_id,actor_role,reason,payload
  ) values (
    p_command_id,v_row.session_id,'OBSERVATION_REVIEWED',v_row.location_code,v_row.id,
    auth.uid(),v_role,left(btrim(p_note),2000),jsonb_build_object('accepted',coalesce(p_accept,false))
  );

  return query select v_row.id,v_row.review_status,v_row.reviewed_at;
end;
$$;

create or replace function public.ecoflow_complete_stocktake_location(
  p_session_id uuid,
  p_location_code text,
  p_reason text,
  p_command_id uuid
)
returns table(location_code text,progress_status text,revision bigint)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_role text:=public.ecoflow_require_warehouse_control_role(false);
  v_progress public.ecoflow_stocktake_location_progress%rowtype;
begin
  if p_command_id is null then raise exception 'STOCKTAKE_COMMAND_ID_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'LOCATION_COMPLETION_REASON_REQUIRED'; end if;
  if exists(select 1 from public.ecoflow_stocktake_events where command_id=p_command_id) then
    select * into v_progress from public.ecoflow_stocktake_location_progress
    where session_id=p_session_id and upper(location_code)=upper(btrim(p_location_code));
    return query select v_progress.location_code,v_progress.progress_status,v_progress.revision;
    return;
  end if;

  select p.* into v_progress
  from public.ecoflow_stocktake_location_progress p
  where p.session_id=p_session_id and upper(p.location_code)=upper(btrim(p_location_code))
  for update;
  if not found then raise exception 'STOCKTAKE_LOCATION_NOT_STARTED'; end if;
  if exists(
    select 1 from public.ecoflow_stocktake_observations o
    where o.session_id=p_session_id and o.location_id=v_progress.location_id
      and cardinality(o.exception_codes)>0 and o.review_status<>'ACCEPTED'
  ) then raise exception 'STOCKTAKE_LOCATION_HAS_UNRESOLVED_EXCEPTIONS'; end if;

  update public.ecoflow_stocktake_location_progress
  set progress_status='COMPLETE',completed_by=auth.uid(),completed_at=clock_timestamp(),
      reopened_by=null,reopened_at=null,reopen_reason=null,
      revision=revision+1,updated_at=clock_timestamp()
  where session_id=p_session_id and location_id=v_progress.location_id
  returning * into v_progress;

  insert into public.ecoflow_stocktake_events(
    command_id,session_id,event_type,location_code,actor_user_id,actor_role,reason
  ) values (
    p_command_id,p_session_id,'LOCATION_COMPLETED',v_progress.location_code,
    auth.uid(),v_role,left(btrim(p_reason),2000)
  );

  return query select v_progress.location_code,v_progress.progress_status,v_progress.revision;
end;
$$;

create or replace function public.ecoflow_reopen_stocktake_location(
  p_session_id uuid,
  p_location_code text,
  p_reason text,
  p_command_id uuid
)
returns table(location_code text,progress_status text,revision bigint)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_role text:=public.ecoflow_require_warehouse_control_role(true);
  v_progress public.ecoflow_stocktake_location_progress%rowtype;
begin
  if p_command_id is null then raise exception 'STOCKTAKE_COMMAND_ID_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'LOCATION_REOPEN_REASON_REQUIRED'; end if;
  if exists(select 1 from public.ecoflow_stocktake_events where command_id=p_command_id) then
    select * into v_progress from public.ecoflow_stocktake_location_progress
    where session_id=p_session_id and upper(location_code)=upper(btrim(p_location_code));
    return query select v_progress.location_code,v_progress.progress_status,v_progress.revision;
    return;
  end if;

  select p.* into v_progress
  from public.ecoflow_stocktake_location_progress p
  where p.session_id=p_session_id and upper(p.location_code)=upper(btrim(p_location_code))
  for update;
  if not found or v_progress.progress_status not in ('COMPLETE','APPROVED') then
    raise exception 'COMPLETED_STOCKTAKE_LOCATION_REQUIRED';
  end if;

  update public.ecoflow_stocktake_location_progress
  set progress_status='IN_PROGRESS',completed_by=null,completed_at=null,
      reopened_by=auth.uid(),reopened_at=clock_timestamp(),
      reopen_reason=left(btrim(p_reason),2000),revision=revision+1,
      updated_at=clock_timestamp()
  where session_id=p_session_id and location_id=v_progress.location_id
  returning * into v_progress;

  update public.ecoflow_stocktake_sessions
  set session_status='IN_PROGRESS',submitted_by=null,submitted_at=null,
      revision=revision+1,updated_at=clock_timestamp()
  where id=p_session_id and session_status<>'APPROVED';

  insert into public.ecoflow_stocktake_events(
    command_id,session_id,event_type,location_code,actor_user_id,actor_role,reason
  ) values (
    p_command_id,p_session_id,'LOCATION_REOPENED',v_progress.location_code,
    auth.uid(),v_role,left(btrim(p_reason),2000)
  );

  return query select v_progress.location_code,v_progress.progress_status,v_progress.revision;
end;
$$;

create or replace function public.ecoflow_submit_stocktake_session(
  p_session_id uuid,
  p_reason text,
  p_command_id uuid
)
returns table(session_id uuid,session_status text,revision bigint)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_role text:=public.ecoflow_require_warehouse_control_role(false);
  v_session public.ecoflow_stocktake_sessions%rowtype;
begin
  if p_command_id is null then raise exception 'STOCKTAKE_COMMAND_ID_REQUIRED'; end if;
  if exists(select 1 from public.ecoflow_stocktake_events where command_id=p_command_id) then
    select * into v_session from public.ecoflow_stocktake_sessions where id=p_session_id;
    return query select v_session.id,v_session.session_status,v_session.revision;
    return;
  end if;

  select * into v_session
  from public.ecoflow_stocktake_sessions
  where id=p_session_id
  for update;
  if not found or v_session.session_status not in ('OPEN','IN_PROGRESS') then
    raise exception 'SUBMITTABLE_STOCKTAKE_SESSION_REQUIRED';
  end if;
  if not exists(select 1 from public.ecoflow_stocktake_location_progress where session_id=p_session_id) then
    raise exception 'STOCKTAKE_REQUIRES_LOCATION_PROGRESS';
  end if;
  if exists(select 1 from public.ecoflow_stocktake_location_progress where session_id=p_session_id and progress_status<>'COMPLETE') then
    raise exception 'ALL_STOCKTAKE_LOCATIONS_MUST_BE_COMPLETE';
  end if;

  update public.ecoflow_stocktake_sessions
  set session_status='REVIEW',submitted_by=auth.uid(),submitted_at=clock_timestamp(),
      revision=revision+1,updated_at=clock_timestamp()
  where id=p_session_id
  returning * into v_session;

  insert into public.ecoflow_stocktake_events(
    command_id,session_id,event_type,actor_user_id,actor_role,reason
  ) values (
    p_command_id,p_session_id,'SESSION_SUBMITTED',auth.uid(),v_role,
    nullif(btrim(coalesce(p_reason,'')),'')
  );

  return query select v_session.id,v_session.session_status,v_session.revision;
end;
$$;

create or replace function public.ecoflow_approve_stocktake_session(
  p_session_id uuid,
  p_expected_revision bigint,
  p_approval_note text,
  p_command_id uuid
)
returns table(
  session_id uuid,
  session_status text,
  revision bigint,
  adjustment_count integer,
  approved_at timestamptz
)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_role text:=public.ecoflow_require_warehouse_control_role(true);
  v_session public.ecoflow_stocktake_sessions%rowtype;
  v_row record;
  v_current numeric;
  v_delta numeric;
  v_adjustments integer:=0;
  v_movement text;
  v_reference text;
begin
  if p_command_id is null then raise exception 'STOCKTAKE_COMMAND_ID_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_approval_note,'')),'') is null then raise exception 'STOCKTAKE_APPROVAL_NOTE_REQUIRED'; end if;

  perform pg_advisory_xact_lock(hashtextextended('stocktake-approve:'||p_session_id::text,0));
  select * into v_session from public.ecoflow_stocktake_sessions where id=p_session_id for update;
  if not found then raise exception 'STOCKTAKE_SESSION_NOT_FOUND'; end if;
  if v_session.session_status='APPROVED' and v_session.approval_command_id=p_command_id then
    return query select v_session.id,v_session.session_status,v_session.revision,0,v_session.approved_at;
    return;
  end if;
  if v_session.session_status<>'REVIEW' then raise exception 'STOCKTAKE_SESSION_REVIEW_REQUIRED'; end if;
  if v_session.revision<>p_expected_revision then raise exception 'STOCKTAKE_REVISION_CONFLICT'; end if;
  if exists(select 1 from public.ecoflow_stocktake_location_progress where session_id=p_session_id and progress_status<>'COMPLETE') then
    raise exception 'ALL_STOCKTAKE_LOCATIONS_MUST_BE_COMPLETE';
  end if;
  if exists(
    select 1 from public.ecoflow_stocktake_observations
    where session_id=p_session_id and cardinality(exception_codes)>0 and review_status<>'ACCEPTED'
  ) then raise exception 'UNRESOLVED_STOCKTAKE_EXCEPTIONS'; end if;

  v_reference:='STOCKTAKE:'||p_session_id::text;
  for v_row in
    select o.location_id,o.location_code,upper(o.sku) as sku,
           max(o.product_name) as product_name,o.unit_level,max(o.barcode) as barcode,
           max(o.units_per_package) as units_per_package,
           sum(o.quantity_packages) as quantity_packages
    from public.ecoflow_stocktake_observations o
    where o.session_id=p_session_id
    group by o.location_id,o.location_code,upper(o.sku),o.unit_level
  loop
    select i.quantity into v_current
    from public.ecoflow_warehouse_location_items i
    where i.location_id=v_row.location_id
      and upper(i.sku)=v_row.sku
      and i.unit_level=v_row.unit_level
    for update;
    v_current:=coalesce(v_current,0);
    v_delta:=v_row.quantity_packages-v_current;

    insert into public.ecoflow_warehouse_location_items(
      location_id,sku,product_name,source_barcode,unit_level,quantity,status,
      last_movement_at,last_note,created_at,updated_at
    ) values (
      v_row.location_id,v_row.sku,v_row.product_name,v_row.barcode,v_row.unit_level,
      v_row.quantity_packages,'ACTIVE',clock_timestamp(),left(btrim(p_approval_note),2000),
      clock_timestamp(),clock_timestamp()
    )
    on conflict(location_id,sku,unit_level) do update set
      quantity=excluded.quantity,
      product_name=coalesce(excluded.product_name,public.ecoflow_warehouse_location_items.product_name),
      source_barcode=coalesce(excluded.source_barcode,public.ecoflow_warehouse_location_items.source_barcode),
      status='ACTIVE',last_movement_at=clock_timestamp(),last_note=excluded.last_note,
      updated_at=clock_timestamp();

    if v_delta<>0 then
      v_movement:=case when v_delta>0 then 'ADJUST_IN' else 'ADJUST_OUT' end;
      insert into public.ecoflow_warehouse_movements(
        movement_type,location_id,to_location_id,sku,product_name,barcode,
        unit_level,quantity,note,actor_user_id,created_at,transfer_reference
      ) values (
        v_movement,v_row.location_id,v_row.location_id,v_row.sku,v_row.product_name,
        v_row.barcode,v_row.unit_level,abs(v_delta),left(btrim(p_approval_note),2000),
        auth.uid(),clock_timestamp(),v_reference
      );
      insert into public.ecoflow_inventory_movements(
        sku,product_name,movement_type,quantity,from_location,to_location,
        reference_type,reference_id,action_note,source,moved_by,moved_at
      ) values (
        v_row.sku,v_row.product_name,v_movement,abs(v_delta*v_row.units_per_package),
        case when v_delta<0 then v_row.location_code else null end,
        case when v_delta>0 then v_row.location_code else null end,
        case when v_session.session_type='INITIAL' then 'OPENING_STOCKTAKE' else 'CYCLE_COUNT' end,
        v_reference,left(btrim(p_approval_note),2000),'STOCKTAKE_APPROVAL',auth.uid(),clock_timestamp()
      );
      v_adjustments:=v_adjustments+1;
    end if;
  end loop;

  update public.ecoflow_stocktake_sessions
  set session_status='APPROVED',approval_command_id=p_command_id,
      approved_by=auth.uid(),approved_at=clock_timestamp(),
      approval_note=left(btrim(p_approval_note),2000),revision=revision+1,
      updated_at=clock_timestamp()
  where id=p_session_id
  returning * into v_session;

  update public.ecoflow_stocktake_location_progress
  set progress_status='APPROVED',revision=revision+1,updated_at=clock_timestamp()
  where session_id=p_session_id;

  insert into public.ecoflow_stocktake_events(
    command_id,session_id,event_type,actor_user_id,actor_role,reason,payload
  ) values (
    p_command_id,p_session_id,'SESSION_APPROVED',auth.uid(),v_role,
    left(btrim(p_approval_note),2000),jsonb_build_object('adjustmentCount',v_adjustments)
  );

  return query select v_session.id,v_session.session_status,v_session.revision,v_adjustments,v_session.approved_at;
end;
$$;

create or replace function public.ecoflow_move_warehouse_sku(
  p_source_location text,
  p_destination_location text,
  p_sku text,
  p_unit_level text,
  p_quantity numeric,
  p_move_all boolean,
  p_expected_source_quantity numeric,
  p_reason text,
  p_command_id uuid
)
returns table(
  transfer_reference text,
  source_quantity numeric,
  destination_quantity numeric,
  quantity_moved numeric,
  command_status text
)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_role text:=public.ecoflow_require_warehouse_control_role(false);
  v_existing public.ecoflow_warehouse_transfer_commands%rowtype;
  v_source public.ecoflow_warehouse_locations%rowtype;
  v_destination public.ecoflow_warehouse_locations%rowtype;
  v_item public.ecoflow_warehouse_location_items%rowtype;
  v_destination_before numeric:=0;
  v_move numeric;
  v_reference text;
begin
  if p_command_id is null then raise exception 'WAREHOUSE_TRANSFER_COMMAND_ID_REQUIRED'; end if;
  select * into v_existing from public.ecoflow_warehouse_transfer_commands where command_id=p_command_id;
  if found then
    return query select v_existing.transfer_reference,v_existing.source_after,
      v_existing.destination_after,v_existing.quantity,'REPLAYED'::text;
    return;
  end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'WAREHOUSE_TRANSFER_REASON_REQUIRED'; end if;
  if upper(btrim(coalesce(p_source_location,'')))=upper(btrim(coalesce(p_destination_location,''))) then
    raise exception 'WAREHOUSE_TRANSFER_LOCATIONS_MUST_DIFFER';
  end if;

  select * into v_source from public.ecoflow_warehouse_locations
  where upper(location_code)=upper(btrim(p_source_location)) and status='ACTIVE' limit 1;
  select * into v_destination from public.ecoflow_warehouse_locations
  where upper(location_code)=upper(btrim(p_destination_location)) and status='ACTIVE' limit 1;
  if v_source.id is null or v_destination.id is null then raise exception 'ACTIVE_SOURCE_AND_DESTINATION_REQUIRED'; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'warehouse-move:'||least(v_source.id::text,v_destination.id::text)||':'||
    greatest(v_source.id::text,v_destination.id::text)||':'||
    upper(btrim(p_sku))||':'||lower(btrim(p_unit_level)),0
  ));

  select * into v_item
  from public.ecoflow_warehouse_location_items
  where location_id=v_source.id and upper(sku)=upper(btrim(p_sku))
    and unit_level=lower(btrim(p_unit_level))
  for update;
  if not found then raise exception 'SOURCE_SKU_BALANCE_NOT_FOUND'; end if;
  if v_item.quantity<>p_expected_source_quantity then raise exception 'SOURCE_BALANCE_CONFLICT'; end if;

  v_move:=case when coalesce(p_move_all,false) then v_item.quantity else p_quantity end;
  if v_move is null or v_move<=0 or v_move<>trunc(v_move) or v_move>v_item.quantity then
    raise exception 'VALID_TRANSFER_QUANTITY_REQUIRED';
  end if;

  select i.quantity into v_destination_before
  from public.ecoflow_warehouse_location_items i
  where i.location_id=v_destination.id and upper(i.sku)=upper(v_item.sku)
    and i.unit_level=v_item.unit_level
  for update;
  v_destination_before:=coalesce(v_destination_before,0);
  v_reference:='MOVE-'||upper(substr(replace(p_command_id::text,'-',''),1,12));

  update public.ecoflow_warehouse_location_items
  set quantity=quantity-v_move,last_movement_at=clock_timestamp(),
      last_note=left(btrim(p_reason),2000),updated_at=clock_timestamp()
  where id=v_item.id;

  insert into public.ecoflow_warehouse_location_items(
    location_id,sku,product_name,source_barcode,unit_level,quantity,status,
    last_movement_at,last_note,created_at,updated_at
  ) values (
    v_destination.id,v_item.sku,v_item.product_name,v_item.source_barcode,
    v_item.unit_level,v_move,'ACTIVE',clock_timestamp(),left(btrim(p_reason),2000),
    clock_timestamp(),clock_timestamp()
  )
  on conflict(location_id,sku,unit_level) do update set
    quantity=public.ecoflow_warehouse_location_items.quantity+excluded.quantity,
    product_name=coalesce(excluded.product_name,public.ecoflow_warehouse_location_items.product_name),
    source_barcode=coalesce(excluded.source_barcode,public.ecoflow_warehouse_location_items.source_barcode),
    last_movement_at=clock_timestamp(),last_note=excluded.last_note,updated_at=clock_timestamp();

  insert into public.ecoflow_warehouse_movements(
    movement_type,location_id,to_location_id,sku,product_name,barcode,
    unit_level,quantity,note,actor_user_id,created_at,transfer_reference
  ) values
    ('MOVE_OUT',v_source.id,v_destination.id,v_item.sku,v_item.product_name,
     v_item.source_barcode,v_item.unit_level,v_move,left(btrim(p_reason),2000),
     auth.uid(),clock_timestamp(),v_reference),
    ('MOVE_IN',v_source.id,v_destination.id,v_item.sku,v_item.product_name,
     v_item.source_barcode,v_item.unit_level,v_move,left(btrim(p_reason),2000),
     auth.uid(),clock_timestamp(),v_reference);

  insert into public.ecoflow_inventory_movements(
    sku,product_name,movement_type,quantity,from_location,to_location,
    reference_type,reference_id,action_note,source,moved_by,moved_at
  ) values (
    v_item.sku,v_item.product_name,'MOVE',v_move,v_source.location_code,
    v_destination.location_code,'WAREHOUSE_TRANSFER',v_reference,
    left(btrim(p_reason),2000),'WAREHOUSE_TRANSFER',auth.uid(),clock_timestamp()
  );

  insert into public.ecoflow_warehouse_transfer_commands(
    command_id,transfer_reference,sku,unit_level,source_location,destination_location,
    quantity,source_before,source_after,destination_before,destination_after,
    reason,actor_user_id,actor_role
  ) values (
    p_command_id,v_reference,v_item.sku,v_item.unit_level,v_source.location_code,
    v_destination.location_code,v_move,v_item.quantity,v_item.quantity-v_move,
    v_destination_before,v_destination_before+v_move,left(btrim(p_reason),2000),
    auth.uid(),v_role
  ) returning * into v_existing;

  return query select v_reference,v_existing.source_after,v_existing.destination_after,
    v_move,'APPLIED'::text;
end;
$$;

create or replace function public.ecoflow_read_warehouse_control(
  p_session_id uuid default null,
  p_limit integer default 100
)
returns table(record_kind text,record_data jsonb,read_at timestamptz)
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
declare
  v_role text:=public.ecoflow_active_app_role();
  v_limit integer:=greatest(1,least(coalesce(p_limit,100),500));
  v_blind_hidden boolean:=false;
begin
  if auth.uid() is null or v_role not in ('OWNER','ADMIN','WAREHOUSE','VIEWER') then
    raise exception using errcode='42501',message='WAREHOUSE_CONTROL_READ_ROLE_REQUIRED';
  end if;

  if p_session_id is not null then
    select coalesce(s.blind_count,false) and s.session_status in ('OPEN','IN_PROGRESS')
    into v_blind_hidden
    from public.ecoflow_stocktake_sessions s
    where s.id=p_session_id;
    v_blind_hidden:=coalesce(v_blind_hidden,false);
  end if;

  return query
    select 'SESSION',to_jsonb(s),statement_timestamp()
    from public.ecoflow_stocktake_sessions s
    where p_session_id is null or s.id=p_session_id
    order by s.created_at desc
    limit v_limit;

  if p_session_id is not null then
    return query
      select 'LOCATION',to_jsonb(p),statement_timestamp()
      from public.ecoflow_stocktake_location_progress p
      where p.session_id=p_session_id
      order by p.location_code
      limit v_limit;

    return query
      select 'OBSERVATION',to_jsonb(o),statement_timestamp()
      from public.ecoflow_stocktake_observations o
      where o.session_id=p_session_id
      order by o.observed_at desc
      limit v_limit;
  end if;

  if not v_blind_hidden then
    return query
      select 'BALANCE',jsonb_build_object(
        'location',l.location_code,
        'sku',i.sku,
        'product_name',i.product_name,
        'unit_level',i.unit_level,
        'on_hand_location',i.quantity,
        'latest_location_movement_at',i.last_movement_at
      ),statement_timestamp()
      from public.ecoflow_warehouse_location_items i
      join public.ecoflow_warehouse_locations l on l.id=i.location_id
      where l.status='ACTIVE' and i.status='ACTIVE'
      order by l.location_code,i.sku,i.unit_level
      limit v_limit;
  end if;
end;
$$;

revoke all on function public.ecoflow_prevent_stocktake_event_mutation() from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_require_warehouse_control_role(boolean) from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_start_stocktake_session(text,text,text,uuid,boolean,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_record_stocktake_observation(uuid,text,text,text,text,text,numeric,numeric,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_review_stocktake_observation(uuid,boolean,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_complete_stocktake_location(uuid,text,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_reopen_stocktake_location(uuid,text,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_submit_stocktake_session(uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_approve_stocktake_session(uuid,bigint,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_move_warehouse_sku(text,text,text,text,numeric,boolean,numeric,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_read_warehouse_control(uuid,integer) from public,anon,authenticated,service_role;

grant execute on function public.ecoflow_start_stocktake_session(text,text,text,uuid,boolean,text,uuid) to authenticated;
grant execute on function public.ecoflow_record_stocktake_observation(uuid,text,text,text,text,text,numeric,numeric,text,uuid) to authenticated;
grant execute on function public.ecoflow_review_stocktake_observation(uuid,boolean,text,uuid) to authenticated;
grant execute on function public.ecoflow_complete_stocktake_location(uuid,text,text,uuid) to authenticated;
grant execute on function public.ecoflow_reopen_stocktake_location(uuid,text,text,uuid) to authenticated;
grant execute on function public.ecoflow_submit_stocktake_session(uuid,text,uuid) to authenticated;
grant execute on function public.ecoflow_approve_stocktake_session(uuid,bigint,text,uuid) to authenticated;
grant execute on function public.ecoflow_move_warehouse_sku(text,text,text,text,numeric,boolean,numeric,text,uuid) to authenticated;
grant execute on function public.ecoflow_read_warehouse_control(uuid,integer) to authenticated;

comment on table public.ecoflow_stocktake_observations is
  'Non-posting physical count evidence. Approved balances are written only by ecoflow_approve_stocktake_session.';
comment on function public.ecoflow_move_warehouse_sku(text,text,text,text,numeric,boolean,numeric,text,uuid) is
  'Idempotent paired transfer with source compare-and-swap and non-negative balance enforcement.';

notify pgrst,'reload schema';
commit;
