-- Phase 9D–9G: complete the remaining operational-stability controls.
-- Observations remain non-posting until supervisor approval. Warehouse transfers
-- use a paired, idempotent transaction. Operational pages are server-paged.

begin;

create table if not exists public.ecoflow_stocktake_sessions (
  id uuid primary key default gen_random_uuid(),
  session_type text not null check (session_type in ('INITIAL','CYCLE_COUNT')),
  session_status text not null default 'OPEN' check (session_status in ('OPEN','IN_PROGRESS','REVIEW','APPROVED','CANCELLED')),
  title text not null,
  rack_id text,
  assigned_user_id uuid,
  blind_count boolean not null default false,
  reason text not null,
  revision bigint not null default 1 check (revision >= 1),
  command_id uuid not null unique,
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  submitted_by uuid,
  submitted_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  approval_note text,
  cancelled_by uuid,
  cancelled_at timestamptz,
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.ecoflow_stocktake_location_progress (
  session_id uuid not null references public.ecoflow_stocktake_sessions(id) on delete restrict,
  location_id uuid not null references public.ecoflow_warehouse_locations(id) on delete restrict,
  location_code text not null,
  progress_status text not null default 'NOT_STARTED' check (progress_status in ('NOT_STARTED','IN_PROGRESS','REVIEW_REQUIRED','COMPLETE','APPROVED')),
  observation_count integer not null default 0 check (observation_count >= 0),
  exception_count integer not null default 0 check (exception_count >= 0),
  completed_by uuid,
  completed_at timestamptz,
  reopened_by uuid,
  reopened_at timestamptz,
  reopen_reason text,
  revision bigint not null default 1 check (revision >= 1),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(session_id,location_id)
);

create table if not exists public.ecoflow_stocktake_observations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.ecoflow_stocktake_sessions(id) on delete restrict,
  location_id uuid not null references public.ecoflow_warehouse_locations(id) on delete restrict,
  location_code text not null,
  sku text not null,
  product_name text,
  barcode text,
  unit_level text not null check (unit_level in ('carton','sleeve','each')),
  units_per_package numeric not null check (units_per_package > 0 and units_per_package = trunc(units_per_package)),
  quantity_packages numeric not null check (quantity_packages >= 0 and quantity_packages = trunc(quantity_packages)),
  note text,
  exception_codes text[] not null default '{}'::text[],
  review_status text not null default 'PENDING' check (review_status in ('PENDING','ACCEPTED','RECOUNT_REQUIRED')),
  command_id uuid not null unique,
  observed_by uuid not null,
  observed_at timestamptz not null default clock_timestamp(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text
);

create index if not exists idx_ecoflow_stocktake_sessions_status on public.ecoflow_stocktake_sessions(session_status,created_at desc);
create index if not exists idx_ecoflow_stocktake_observations_session on public.ecoflow_stocktake_observations(session_id,location_code,sku,unit_level);

create table if not exists public.ecoflow_stocktake_events (
  event_id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.ecoflow_stocktake_sessions(id) on delete restrict,
  event_type text not null,
  location_code text,
  observation_id uuid,
  actor_user_id uuid not null,
  actor_role text not null,
  reason text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);

create or replace function public.ecoflow_prevent_stocktake_event_mutation()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public
as $$ begin raise exception 'STOCKTAKE_EVENT_IMMUTABLE'; end $$;
drop trigger if exists trg_ecoflow_stocktake_event_immutable on public.ecoflow_stocktake_events;
create trigger trg_ecoflow_stocktake_event_immutable before update or delete on public.ecoflow_stocktake_events
for each row execute function public.ecoflow_prevent_stocktake_event_mutation();

create table if not exists public.ecoflow_warehouse_transfer_commands (
  command_id uuid primary key,
  transfer_reference text not null unique,
  sku text not null,
  unit_level text not null,
  source_location text not null,
  destination_location text not null,
  quantity numeric not null,
  source_before numeric not null,
  source_after numeric not null,
  destination_before numeric not null,
  destination_after numeric not null,
  reason text not null,
  actor_user_id uuid not null,
  actor_role text not null,
  created_at timestamptz not null default clock_timestamp()
);

create table if not exists public.ecoflow_user_quick_actions (
  user_id uuid primary key,
  action_keys text[] not null default '{}'::text[] check (cardinality(action_keys) between 0 and 4),
  revision bigint not null default 1 check (revision >= 1),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.ecoflow_role_quick_action_defaults (
  app_role text primary key check (app_role in ('OWNER','ADMIN','ACCOUNT','VIEWER')),
  action_keys text[] not null check (cardinality(action_keys) between 0 and 4),
  revision bigint not null default 1 check (revision >= 1),
  updated_by uuid,
  updated_at timestamptz not null default clock_timestamp()
);

insert into public.ecoflow_role_quick_action_defaults(app_role,action_keys)
values
  ('OWNER',array['CONTROL_ROOM','ORDERS','INVENTORY','EXCEPTIONS']),
  ('ADMIN',array['CONTROL_ROOM','ORDERS','INVENTORY','EXCEPTIONS']),
  ('ACCOUNT',array['CONTROL_ROOM','ORDERS','CUSTOMERS','EXCEPTIONS']),
  ('VIEWER',array['CONTROL_ROOM','ORDERS','INVENTORY','CUSTOMERS'])
on conflict(app_role) do nothing;

create table if not exists public.ecoflow_business_day_close_checklists (
  business_day date primary key,
  checklist jsonb not null,
  acknowledgement_note text not null,
  command_id uuid not null unique,
  recorded_by uuid not null,
  recorded_at timestamptz not null default clock_timestamp()
);

alter table public.ecoflow_stocktake_sessions enable row level security;
alter table public.ecoflow_stocktake_location_progress enable row level security;
alter table public.ecoflow_stocktake_observations enable row level security;
alter table public.ecoflow_stocktake_events enable row level security;
alter table public.ecoflow_warehouse_transfer_commands enable row level security;
alter table public.ecoflow_user_quick_actions enable row level security;
alter table public.ecoflow_role_quick_action_defaults enable row level security;
alter table public.ecoflow_business_day_close_checklists enable row level security;

revoke all on public.ecoflow_stocktake_sessions, public.ecoflow_stocktake_location_progress,
  public.ecoflow_stocktake_observations, public.ecoflow_stocktake_events,
  public.ecoflow_warehouse_transfer_commands, public.ecoflow_user_quick_actions,
  public.ecoflow_role_quick_action_defaults, public.ecoflow_business_day_close_checklists
from public,anon,authenticated;

create or replace function public.ecoflow_current_operational_role()
returns text language sql stable security definer set search_path=pg_catalog,public
as $$
  select p.app_role::text from public.app_user_profiles p
  where p.user_id=auth.uid() and p.is_active=true and p.team_status='ACTIVE'
  limit 1
$$;
revoke all on function public.ecoflow_current_operational_role() from public,anon,authenticated;
grant execute on function public.ecoflow_current_operational_role() to authenticated;

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
language plpgsql security definer set search_path=pg_catalog,public
as $$
declare
  v_role text:=public.ecoflow_current_operational_role();
  v_type text:=upper(btrim(coalesce(p_session_type,'')));
  v_reason text:=nullif(btrim(coalesce(p_reason,'')),'');
  v_row public.ecoflow_stocktake_sessions%rowtype;
begin
  if v_role not in ('OWNER','ADMIN','WAREHOUSE') then raise exception using errcode='42501',message='WAREHOUSE_CONTROL_ROLE_REQUIRED'; end if;
  if v_type not in ('INITIAL','CYCLE_COUNT') then raise exception 'VALID_STOCKTAKE_SESSION_TYPE_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_title,'')),'') is null then raise exception 'STOCKTAKE_TITLE_REQUIRED'; end if;
  if v_reason is null then raise exception 'STOCKTAKE_REASON_REQUIRED'; end if;
  if p_command_id is null then raise exception 'STOCKTAKE_COMMAND_ID_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('stocktake-command:'||p_command_id::text,0));
  select * into v_row from public.ecoflow_stocktake_sessions where command_id=p_command_id;
  if found then return query select v_row.id,v_row.session_status,v_row.revision,v_row.created_at; return; end if;
  insert into public.ecoflow_stocktake_sessions(session_type,title,rack_id,assigned_user_id,blind_count,reason,command_id,created_by)
  values(v_type,left(btrim(p_title),160),nullif(btrim(coalesce(p_rack_id,'')),''),p_assigned_user_id,coalesce(p_blind_count,false),v_reason,p_command_id,auth.uid())
  returning * into v_row;
  insert into public.ecoflow_stocktake_events(session_id,event_type,actor_user_id,actor_role,reason,payload)
  values(v_row.id,'SESSION_STARTED',auth.uid(),v_role,v_reason,jsonb_build_object('sessionType',v_type,'rackId',v_row.rack_id,'blindCount',v_row.blind_count));
  return query select v_row.id,v_row.session_status,v_row.revision,v_row.created_at;
end $$;

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
language plpgsql security definer set search_path=pg_catalog,public
as $$
declare
  v_role text:=public.ecoflow_current_operational_role();
  v_session public.ecoflow_stocktake_sessions%rowtype;
  v_location public.ecoflow_warehouse_locations%rowtype;
  v_row public.ecoflow_stocktake_observations%rowtype;
  v_sku text:=upper(btrim(coalesce(p_sku,'')));
  v_barcode text:=nullif(btrim(coalesce(p_barcode,'')),'');
  v_level text:=lower(btrim(coalesce(p_unit_level,'')));
  v_exceptions text[]:=array[]::text[];
  v_mapped_sku text;
begin
  if v_role not in ('OWNER','ADMIN','WAREHOUSE') then raise exception using errcode='42501',message='WAREHOUSE_CONTROL_ROLE_REQUIRED'; end if;
  if p_command_id is null then raise exception 'STOCKTAKE_COMMAND_ID_REQUIRED'; end if;
  select * into v_row from public.ecoflow_stocktake_observations where command_id=p_command_id;
  if found then return query select v_row.id,v_row.review_status,v_row.exception_codes,v_row.observed_at; return; end if;
  select * into v_session from public.ecoflow_stocktake_sessions where id=p_session_id for update;
  if not found or v_session.session_status not in ('OPEN','IN_PROGRESS') then raise exception 'OPEN_STOCKTAKE_SESSION_REQUIRED'; end if;
  select * into v_location from public.ecoflow_warehouse_locations where upper(location_code)=upper(btrim(p_location_code)) and status='ACTIVE' limit 1;
  if not found then raise exception 'ACTIVE_WAREHOUSE_LOCATION_REQUIRED'; end if;
  if v_sku='' then raise exception 'STOCKTAKE_SKU_REQUIRED'; end if;
  if v_level not in ('carton','sleeve','each') then raise exception 'VALID_PACKAGE_LEVEL_REQUIRED'; end if;
  if p_units_per_package is null or p_units_per_package<=0 or p_units_per_package<>trunc(p_units_per_package) then raise exception 'VALID_UNITS_PER_PACKAGE_REQUIRED'; end if;
  if p_quantity_packages is null or p_quantity_packages<0 or p_quantity_packages<>trunc(p_quantity_packages) then raise exception 'VALID_PHYSICAL_COUNT_REQUIRED'; end if;
  if v_barcode is null then v_exceptions:=array_append(v_exceptions,'MISSING_BARCODE');
  else
    select upper(r.sku) into v_mapped_sku from public.ecoflow_sku_barcode_registry r where r.barcode=v_barcode limit 1;
    if v_mapped_sku is null then v_exceptions:=array_append(v_exceptions,'UNKNOWN_BARCODE');
    elsif v_mapped_sku<>v_sku then v_exceptions:=array_append(v_exceptions,'BARCODE_SKU_MISMATCH'); end if;
    if exists(select 1 from public.ecoflow_stocktake_observations o where o.session_id=p_session_id and o.barcode=v_barcode and upper(o.sku)<>v_sku) then
      v_exceptions:=array_append(v_exceptions,'DUPLICATE_BARCODE_CONFLICT');
    end if;
  end if;
  insert into public.ecoflow_stocktake_observations(session_id,location_id,location_code,sku,product_name,barcode,unit_level,units_per_package,quantity_packages,note,exception_codes,review_status,command_id,observed_by)
  values(p_session_id,v_location.id,v_location.location_code,v_sku,nullif(btrim(coalesce(p_product_name,'')),''),v_barcode,v_level,p_units_per_package,p_quantity_packages,nullif(btrim(coalesce(p_note,'')),''),v_exceptions,case when cardinality(v_exceptions)>0 then 'RECOUNT_REQUIRED' else 'PENDING' end,p_command_id,auth.uid())
  returning * into v_row;
  insert into public.ecoflow_stocktake_location_progress(session_id,location_id,location_code,progress_status,observation_count,exception_count)
  values(p_session_id,v_location.id,v_location.location_code,case when cardinality(v_exceptions)>0 then 'REVIEW_REQUIRED' else 'IN_PROGRESS' end,1,cardinality(v_exceptions))
  on conflict(session_id,location_id) do update set
    progress_status=case when excluded.exception_count>0 or public.ecoflow_stocktake_location_progress.exception_count>0 then 'REVIEW_REQUIRED' else 'IN_PROGRESS' end,
    observation_count=public.ecoflow_stocktake_location_progress.observation_count+1,
    exception_count=public.ecoflow_stocktake_location_progress.exception_count+excluded.exception_count,
    completed_by=null,completed_at=null,revision=public.ecoflow_stocktake_location_progress.revision+1,updated_at=clock_timestamp();
  update public.ecoflow_stocktake_sessions set session_status='IN_PROGRESS',revision=revision+1,updated_at=clock_timestamp() where id=p_session_id;
  insert into public.ecoflow_stocktake_events(session_id,event_type,location_code,observation_id,actor_user_id,actor_role,payload)
  values(p_session_id,'OBSERVATION_RECORDED',v_location.location_code,v_row.id,auth.uid(),v_role,jsonb_build_object('sku',v_sku,'unitLevel',v_level,'quantityPackages',p_quantity_packages,'exceptionCodes',v_exceptions));
  return query select v_row.id,v_row.review_status,v_row.exception_codes,v_row.observed_at;
end $$;

create or replace function public.ecoflow_review_stocktake_observation(
  p_observation_id uuid,p_accept boolean,p_note text,p_command_id uuid
)
returns table(observation_id uuid,review_status text,reviewed_at timestamptz)
language plpgsql security definer set search_path=pg_catalog,public
as $$
declare v_role text:=public.ecoflow_current_operational_role(); v_row public.ecoflow_stocktake_observations%rowtype;
begin
  if v_role not in ('OWNER','ADMIN') then raise exception using errcode='42501',message='STOCKTAKE_SUPERVISOR_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_note,'')),'') is null then raise exception 'STOCKTAKE_REVIEW_NOTE_REQUIRED'; end if;
  select * into v_row from public.ecoflow_stocktake_observations where id=p_observation_id for update;
  if not found then raise exception 'STOCKTAKE_OBSERVATION_NOT_FOUND'; end if;
  update public.ecoflow_stocktake_observations set review_status=case when p_accept then 'ACCEPTED' else 'RECOUNT_REQUIRED' end,reviewed_by=auth.uid(),reviewed_at=clock_timestamp(),review_note=left(btrim(p_note),2000) where id=p_observation_id returning * into v_row;
  update public.ecoflow_stocktake_location_progress p set exception_count=(select count(*) from public.ecoflow_stocktake_observations o where o.session_id=p.session_id and o.location_id=p.location_id and cardinality(o.exception_codes)>0 and o.review_status<>'ACCEPTED'),progress_status=case when exists(select 1 from public.ecoflow_stocktake_observations o where o.session_id=p.session_id and o.location_id=p.location_id and cardinality(o.exception_codes)>0 and o.review_status<>'ACCEPTED') then 'REVIEW_REQUIRED' else 'IN_PROGRESS' end,revision=revision+1,updated_at=clock_timestamp() where p.session_id=v_row.session_id and p.location_id=v_row.location_id;
  insert into public.ecoflow_stocktake_events(session_id,event_type,location_code,observation_id,actor_user_id,actor_role,reason,payload) values(v_row.session_id,'OBSERVATION_REVIEWED',v_row.location_code,v_row.id,auth.uid(),v_role,p_note,jsonb_build_object('accepted',p_accept,'commandId',p_command_id));
  return query select v_row.id,v_row.review_status,v_row.reviewed_at;
end $$;

create or replace function public.ecoflow_complete_stocktake_location(
  p_session_id uuid,p_location_code text,p_reason text,p_command_id uuid
)
returns table(location_code text,progress_status text,revision bigint)
language plpgsql security definer set search_path=pg_catalog,public
as $$
declare v_role text:=public.ecoflow_current_operational_role(); v_progress public.ecoflow_stocktake_location_progress%rowtype;
begin
  if v_role not in ('OWNER','ADMIN','WAREHOUSE') then raise exception using errcode='42501',message='WAREHOUSE_CONTROL_ROLE_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'LOCATION_COMPLETION_REASON_REQUIRED'; end if;
  select p.* into v_progress from public.ecoflow_stocktake_location_progress p where p.session_id=p_session_id and upper(p.location_code)=upper(btrim(p_location_code)) for update;
  if not found then raise exception 'STOCKTAKE_LOCATION_NOT_STARTED'; end if;
  if exists(select 1 from public.ecoflow_stocktake_observations o where o.session_id=p_session_id and o.location_id=v_progress.location_id and cardinality(o.exception_codes)>0 and o.review_status<>'ACCEPTED') then raise exception 'STOCKTAKE_LOCATION_HAS_UNRESOLVED_EXCEPTIONS'; end if;
  update public.ecoflow_stocktake_location_progress set progress_status='COMPLETE',completed_by=auth.uid(),completed_at=clock_timestamp(),reopened_by=null,reopened_at=null,reopen_reason=null,revision=revision+1,updated_at=clock_timestamp() where session_id=p_session_id and location_id=v_progress.location_id returning * into v_progress;
  insert into public.ecoflow_stocktake_events(session_id,event_type,location_code,actor_user_id,actor_role,reason,payload) values(p_session_id,'LOCATION_COMPLETED',v_progress.location_code,auth.uid(),v_role,p_reason,jsonb_build_object('commandId',p_command_id));
  return query select v_progress.location_code,v_progress.progress_status,v_progress.revision;
end $$;

create or replace function public.ecoflow_reopen_stocktake_location(
  p_session_id uuid,p_location_code text,p_reason text,p_command_id uuid
)
returns table(location_code text,progress_status text,revision bigint)
language plpgsql security definer set search_path=pg_catalog,public
as $$
declare v_role text:=public.ecoflow_current_operational_role(); v_progress public.ecoflow_stocktake_location_progress%rowtype;
begin
  if v_role not in ('OWNER','ADMIN') then raise exception using errcode='42501',message='STOCKTAKE_SUPERVISOR_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'LOCATION_REOPEN_REASON_REQUIRED'; end if;
  select p.* into v_progress from public.ecoflow_stocktake_location_progress p where p.session_id=p_session_id and upper(p.location_code)=upper(btrim(p_location_code)) for update;
  if not found or v_progress.progress_status not in ('COMPLETE','APPROVED') then raise exception 'COMPLETED_STOCKTAKE_LOCATION_REQUIRED'; end if;
  update public.ecoflow_stocktake_location_progress set progress_status='IN_PROGRESS',completed_by=null,completed_at=null,reopened_by=auth.uid(),reopened_at=clock_timestamp(),reopen_reason=left(btrim(p_reason),1000),revision=revision+1,updated_at=clock_timestamp() where session_id=p_session_id and location_id=v_progress.location_id returning * into v_progress;
  update public.ecoflow_stocktake_sessions set session_status='IN_PROGRESS',revision=revision+1,updated_at=clock_timestamp() where id=p_session_id and session_status<>'APPROVED';
  insert into public.ecoflow_stocktake_events(session_id,event_type,location_code,actor_user_id,actor_role,reason,payload) values(p_session_id,'LOCATION_REOPENED',v_progress.location_code,auth.uid(),v_role,p_reason,jsonb_build_object('commandId',p_command_id));
  return query select v_progress.location_code,v_progress.progress_status,v_progress.revision;
end $$;

create or replace function public.ecoflow_submit_stocktake_session(p_session_id uuid,p_reason text,p_command_id uuid)
returns table(session_id uuid,session_status text,revision bigint)
language plpgsql security definer set search_path=pg_catalog,public
as $$
declare v_role text:=public.ecoflow_current_operational_role(); v_session public.ecoflow_stocktake_sessions%rowtype;
begin
  if v_role not in ('OWNER','ADMIN','WAREHOUSE') then raise exception using errcode='42501',message='WAREHOUSE_CONTROL_ROLE_REQUIRED'; end if;
  select * into v_session from public.ecoflow_stocktake_sessions where id=p_session_id for update;
  if not found or v_session.session_status not in ('OPEN','IN_PROGRESS') then raise exception 'SUBMITTABLE_STOCKTAKE_SESSION_REQUIRED'; end if;
  if not exists(select 1 from public.ecoflow_stocktake_location_progress where session_id=p_session_id) then raise exception 'STOCKTAKE_REQUIRES_LOCATION_PROGRESS'; end if;
  if exists(select 1 from public.ecoflow_stocktake_location_progress where session_id=p_session_id and progress_status<>'COMPLETE') then raise exception 'ALL_STOCKTAKE_LOCATIONS_MUST_BE_COMPLETE'; end if;
  update public.ecoflow_stocktake_sessions set session_status='REVIEW',submitted_by=auth.uid(),submitted_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() where id=p_session_id returning * into v_session;
  insert into public.ecoflow_stocktake_events(session_id,event_type,actor_user_id,actor_role,reason,payload) values(p_session_id,'SESSION_SUBMITTED',auth.uid(),v_role,nullif(btrim(coalesce(p_reason,'')),''),jsonb_build_object('commandId',p_command_id));
  return query select v_session.id,v_session.session_status,v_session.revision;
end $$;

create or replace function public.ecoflow_approve_stocktake_session(
  p_session_id uuid,p_expected_revision bigint,p_approval_note text,p_command_id uuid
)
returns table(session_id uuid,session_status text,revision bigint,adjustment_count integer,approved_at timestamptz)
language plpgsql security definer set search_path=pg_catalog,public
as $$
declare
  v_role text:=public.ecoflow_current_operational_role(); v_session public.ecoflow_stocktake_sessions%rowtype;
  v_row record; v_current numeric; v_delta numeric; v_adjustments integer:=0; v_movement text; v_reference text;
begin
  if v_role not in ('OWNER','ADMIN') then raise exception using errcode='42501',message='STOCKTAKE_SUPERVISOR_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_approval_note,'')),'') is null then raise exception 'STOCKTAKE_APPROVAL_NOTE_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('stocktake-approve:'||p_session_id::text,0));
  select * into v_session from public.ecoflow_stocktake_sessions where id=p_session_id for update;
  if not found then raise exception 'STOCKTAKE_SESSION_NOT_FOUND'; end if;
  if v_session.session_status='APPROVED' and v_session.command_id=p_command_id then return query select v_session.id,v_session.session_status,v_session.revision,0,v_session.approved_at; return; end if;
  if v_session.session_status<>'REVIEW' then raise exception 'STOCKTAKE_SESSION_REVIEW_REQUIRED'; end if;
  if v_session.revision<>p_expected_revision then raise exception 'STOCKTAKE_REVISION_CONFLICT'; end if;
  if exists(select 1 from public.ecoflow_stocktake_location_progress where session_id=p_session_id and progress_status<>'COMPLETE') then raise exception 'ALL_STOCKTAKE_LOCATIONS_MUST_BE_COMPLETE'; end if;
  if exists(select 1 from public.ecoflow_stocktake_observations where session_id=p_session_id and cardinality(exception_codes)>0 and review_status<>'ACCEPTED') then raise exception 'UNRESOLVED_STOCKTAKE_EXCEPTIONS'; end if;
  for v_row in
    select o.location_id,o.location_code,upper(o.sku) sku,max(o.product_name) product_name,o.unit_level,max(o.barcode) barcode,max(o.units_per_package) units_per_package,sum(o.quantity_packages) quantity_packages
    from public.ecoflow_stocktake_observations o where o.session_id=p_session_id
    group by o.location_id,o.location_code,upper(o.sku),o.unit_level
  loop
    select coalesce(i.quantity,0) into v_current from public.ecoflow_warehouse_location_items i where i.location_id=v_row.location_id and upper(i.sku)=v_row.sku and i.unit_level=v_row.unit_level for update;
    v_current:=coalesce(v_current,0); v_delta:=v_row.quantity_packages-v_current;
    insert into public.ecoflow_warehouse_location_items(location_id,sku,product_name,source_barcode,unit_level,quantity,status,last_movement_at,last_note,created_at,updated_at)
    values(v_row.location_id,v_row.sku,v_row.product_name,v_row.barcode,v_row.unit_level,v_row.quantity_packages,'ACTIVE',clock_timestamp(),p_approval_note,clock_timestamp(),clock_timestamp())
    on conflict(location_id,sku,unit_level) do update set quantity=excluded.quantity,product_name=coalesce(excluded.product_name,public.ecoflow_warehouse_location_items.product_name),source_barcode=coalesce(excluded.source_barcode,public.ecoflow_warehouse_location_items.source_barcode),status='ACTIVE',last_movement_at=clock_timestamp(),last_note=excluded.last_note,updated_at=clock_timestamp();
    if v_delta<>0 then
      v_movement:=case when v_delta>0 then 'ADJUST_IN' else 'ADJUST_OUT' end;
      v_reference:='STOCKTAKE:'||p_session_id::text;
      insert into public.ecoflow_warehouse_movements(movement_type,location_id,to_location_id,sku,product_name,barcode,unit_level,quantity,note,actor_user_id,created_at,reference_type,reference_id)
      values(v_movement,v_row.location_id,v_row.location_id,v_row.sku,v_row.product_name,v_row.barcode,v_row.unit_level,abs(v_delta),p_approval_note,auth.uid(),clock_timestamp(),case when v_session.session_type='INITIAL' then 'OPENING_STOCKTAKE' else 'CYCLE_COUNT' end,v_reference);
      insert into public.ecoflow_inventory_movements(sku,product_name,movement_type,quantity,from_location,to_location,reference_type,reference_id,action_note,source,moved_by,moved_at)
      values(v_row.sku,v_row.product_name,v_movement,abs(v_delta*v_row.units_per_package),case when v_delta<0 then v_row.location_code else null end,case when v_delta>0 then v_row.location_code else null end,case when v_session.session_type='INITIAL' then 'OPENING_STOCKTAKE' else 'CYCLE_COUNT' end,v_reference,p_approval_note,'STOCKTAKE_APPROVAL',auth.uid(),clock_timestamp());
      v_adjustments:=v_adjustments+1;
    end if;
  end loop;
  update public.ecoflow_stocktake_sessions set session_status='APPROVED',approved_by=auth.uid(),approved_at=clock_timestamp(),approval_note=left(btrim(p_approval_note),2000),revision=revision+1,updated_at=clock_timestamp() where id=p_session_id returning * into v_session;
  update public.ecoflow_stocktake_location_progress set progress_status='APPROVED',revision=revision+1,updated_at=clock_timestamp() where session_id=p_session_id;
  insert into public.ecoflow_stocktake_events(session_id,event_type,actor_user_id,actor_role,reason,payload) values(p_session_id,'SESSION_APPROVED',auth.uid(),v_role,p_approval_note,jsonb_build_object('commandId',p_command_id,'adjustmentCount',v_adjustments));
  return query select v_session.id,v_session.session_status,v_session.revision,v_adjustments,v_session.approved_at;
end $$;

create or replace function public.ecoflow_move_warehouse_sku(
  p_source_location text,p_destination_location text,p_sku text,p_unit_level text,
  p_quantity numeric,p_move_all boolean,p_expected_source_quantity numeric,p_reason text,p_command_id uuid
)
returns table(transfer_reference text,source_quantity numeric,destination_quantity numeric,quantity_moved numeric,command_status text)
language plpgsql security definer set search_path=pg_catalog,public
as $$
declare
  v_role text:=public.ecoflow_current_operational_role(); v_existing public.ecoflow_warehouse_transfer_commands%rowtype;
  v_source public.ecoflow_warehouse_locations%rowtype; v_dest public.ecoflow_warehouse_locations%rowtype;
  v_item public.ecoflow_warehouse_location_items%rowtype; v_dest_before numeric:=0; v_move numeric; v_ref text;
begin
  if v_role not in ('OWNER','ADMIN','WAREHOUSE') then raise exception using errcode='42501',message='WAREHOUSE_CONTROL_ROLE_REQUIRED'; end if;
  if p_command_id is null then raise exception 'WAREHOUSE_TRANSFER_COMMAND_ID_REQUIRED'; end if;
  select * into v_existing from public.ecoflow_warehouse_transfer_commands where command_id=p_command_id;
  if found then return query select v_existing.transfer_reference,v_existing.source_after,v_existing.destination_after,v_existing.quantity,'REPLAYED'::text; return; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'WAREHOUSE_TRANSFER_REASON_REQUIRED'; end if;
  if upper(btrim(p_source_location))=upper(btrim(p_destination_location)) then raise exception 'WAREHOUSE_TRANSFER_LOCATIONS_MUST_DIFFER'; end if;
  select * into v_source from public.ecoflow_warehouse_locations where upper(location_code)=upper(btrim(p_source_location)) and status='ACTIVE' limit 1;
  select * into v_dest from public.ecoflow_warehouse_locations where upper(location_code)=upper(btrim(p_destination_location)) and status='ACTIVE' limit 1;
  if v_source.id is null or v_dest.id is null then raise exception 'ACTIVE_SOURCE_AND_DESTINATION_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('warehouse-move:'||least(v_source.id::text,v_dest.id::text)||':'||greatest(v_source.id::text,v_dest.id::text)||':'||upper(btrim(p_sku))||':'||lower(btrim(p_unit_level)),0));
  select * into v_item from public.ecoflow_warehouse_location_items where location_id=v_source.id and upper(sku)=upper(btrim(p_sku)) and unit_level=lower(btrim(p_unit_level)) for update;
  if not found then raise exception 'SOURCE_SKU_BALANCE_NOT_FOUND'; end if;
  if v_item.quantity<>p_expected_source_quantity then raise exception 'SOURCE_BALANCE_CONFLICT'; end if;
  v_move:=case when coalesce(p_move_all,false) then v_item.quantity else p_quantity end;
  if v_move is null or v_move<=0 or v_move<>trunc(v_move) or v_move>v_item.quantity then raise exception 'VALID_TRANSFER_QUANTITY_REQUIRED'; end if;
  select coalesce(quantity,0) into v_dest_before from public.ecoflow_warehouse_location_items where location_id=v_dest.id and upper(sku)=upper(v_item.sku) and unit_level=v_item.unit_level for update;
  v_dest_before:=coalesce(v_dest_before,0); v_ref:='MOVE-'||upper(substr(replace(p_command_id::text,'-',''),1,12));
  update public.ecoflow_warehouse_location_items set quantity=quantity-v_move,last_movement_at=clock_timestamp(),last_note=p_reason,updated_at=clock_timestamp() where id=v_item.id;
  insert into public.ecoflow_warehouse_location_items(location_id,sku,product_name,source_barcode,unit_level,quantity,status,last_movement_at,last_note,created_at,updated_at)
  values(v_dest.id,v_item.sku,v_item.product_name,v_item.source_barcode,v_item.unit_level,v_move,'ACTIVE',clock_timestamp(),p_reason,clock_timestamp(),clock_timestamp())
  on conflict(location_id,sku,unit_level) do update set quantity=public.ecoflow_warehouse_location_items.quantity+excluded.quantity,product_name=coalesce(excluded.product_name,public.ecoflow_warehouse_location_items.product_name),source_barcode=coalesce(excluded.source_barcode,public.ecoflow_warehouse_location_items.source_barcode),last_movement_at=clock_timestamp(),last_note=excluded.last_note,updated_at=clock_timestamp();
  insert into public.ecoflow_warehouse_movements(movement_type,location_id,to_location_id,sku,product_name,barcode,unit_level,quantity,note,actor_user_id,created_at,reference_type,reference_id)
  values
    ('MOVE_OUT',v_source.id,v_dest.id,v_item.sku,v_item.product_name,v_item.source_barcode,v_item.unit_level,v_move,p_reason,auth.uid(),clock_timestamp(),'WAREHOUSE_TRANSFER',v_ref),
    ('MOVE_IN',v_source.id,v_dest.id,v_item.sku,v_item.product_name,v_item.source_barcode,v_item.unit_level,v_move,p_reason,auth.uid(),clock_timestamp(),'WAREHOUSE_TRANSFER',v_ref);
  insert into public.ecoflow_warehouse_transfer_commands(command_id,transfer_reference,sku,unit_level,source_location,destination_location,quantity,source_before,source_after,destination_before,destination_after,reason,actor_user_id,actor_role)
  values(p_command_id,v_ref,v_item.sku,v_item.unit_level,v_source.location_code,v_dest.location_code,v_move,v_item.quantity,v_item.quantity-v_move,v_dest_before,v_dest_before+v_move,left(btrim(p_reason),1000),auth.uid(),v_role)
  returning * into v_existing;
  return query select v_ref,v_existing.source_after,v_existing.destination_after,v_move,'APPLIED'::text;
end $$;

create or replace function public.ecoflow_read_warehouse_control(p_session_id uuid default null,p_limit integer default 100)
returns table(record_kind text,record_data jsonb,read_at timestamptz)
language plpgsql stable security definer set search_path=pg_catalog,public
as $$
declare v_role text:=public.ecoflow_current_operational_role(); v_limit integer:=greatest(1,least(coalesce(p_limit,100),500));
begin
  if v_role not in ('OWNER','ADMIN','WAREHOUSE','VIEWER') then raise exception using errcode='42501',message='WAREHOUSE_CONTROL_READ_ROLE_REQUIRED'; end if;
  return query
  select 'SESSION',to_jsonb(s),statement_timestamp() from public.ecoflow_stocktake_sessions s where p_session_id is null or s.id=p_session_id order by s.created_at desc limit v_limit;
  return query
  select 'LOCATION',to_jsonb(p),statement_timestamp() from public.ecoflow_stocktake_location_progress p where p_session_id is not null and p.session_id=p_session_id order by p.location_code limit v_limit;
  return query
  select 'OBSERVATION',to_jsonb(o),statement_timestamp() from public.ecoflow_stocktake_observations o where p_session_id is not null and o.session_id=p_session_id order by o.observed_at desc limit v_limit;
  return query
  select 'BALANCE',to_jsonb(b),statement_timestamp() from public.v_ecoflow_inventory_sku_location_balance b order by b.location,b.sku limit v_limit;
end $$;

create or replace function public.ecoflow_read_operational_page(
  p_resource text,p_page integer default 1,p_page_size integer default 25,
  p_search text default null,p_filter text default null,p_sort text default null
)
returns table(total_count bigint,row_data jsonb,read_at timestamptz)
language plpgsql stable security definer set search_path=pg_catalog,public,analytics
as $$
declare
  v_role text:=public.ecoflow_current_operational_role(); v_resource text:=lower(btrim(coalesce(p_resource,'')));
  v_page integer:=coalesce(p_page,1); v_size integer:=coalesce(p_page_size,25); v_offset integer; v_search text:='%'||lower(btrim(coalesce(p_search,'')))||'%';
begin
  if v_role not in ('OWNER','ADMIN','ACCOUNT','VIEWER') then raise exception using errcode='42501',message='DESKTOP_OPERATIONAL_ROLE_REQUIRED'; end if;
  if v_page<1 or v_size not in (10,20,25,50,100) then raise exception 'INVALID_OPERATIONAL_PAGE_REQUEST'; end if;
  v_offset:=(v_page-1)*v_size;
  if v_resource='orders' then
    return query with q as (
      select o.* from public.v_ecoflow_ordermentum_ui_active_inbox o
      where (p_search is null or lower(concat_ws(' ',o.order_number,o.external_order_number,o.invoice_number,o.external_invoice_number,o.order_status)) like v_search)
        and (p_filter is null or p_filter='' or lower(coalesce(o.order_status,''))=lower(p_filter))
    ), n as (select count(*) c from q), p as (select * from q order by case when p_sort='oldest' then order_updated_at end asc nulls last,order_updated_at desc nulls last,coalesce(order_number,external_order_number) limit v_size offset v_offset)
    select n.c,to_jsonb(p),statement_timestamp() from n cross join p;
  elsif v_resource='stores' then
    return query with q as (
      select s.* from public.ecoflow_store_sites s
      where (p_search is null or lower(concat_ws(' ',s.store_name,s.suburb,s.formatted_address,s.contact_phone,s.price_group_id)) like v_search)
        and (p_filter is null or p_filter='' or lower(coalesce(s.state,''))=lower(p_filter))
    ), n as (select count(*) c from q), p as (select * from q order by case when p_sort='suburb' then suburb end,store_name limit v_size offset v_offset)
    select n.c,to_jsonb(p),statement_timestamp() from n cross join p;
  elsif v_resource='inventory' then
    return query with q as (
      select i.* from public.v_ecoflow_inventory_sku_location_balance i
      where (p_search is null or lower(concat_ws(' ',i.sku,i.product_name,i.location)) like v_search)
        and (p_filter is null or p_filter='' or lower(coalesce(i.location,''))=lower(p_filter))
    ), n as (select count(*) c from q), p as (select * from q order by case when p_sort='quantity-desc' then on_hand_location end desc nulls last,location,sku limit v_size offset v_offset)
    select n.c,to_jsonb(p),statement_timestamp() from n cross join p;
  elsif v_resource='exceptions' then
    return query with source_rows as (
      select e.*,'ORDERMENTUM_ACTIVE:'||md5(concat_ws('|',coalesce(e.raw_order_id::text,''),coalesce(e.external_order_id::text,''),coalesce(e.external_order_number::text,''),coalesce(e.external_invoice_number::text,''),coalesce(e.order_number::text,''),coalesce(e.invoice_number::text,''),coalesce(e.exception_type::text,''),coalesce(e.status::text,''),coalesce(e.detected_at::text,''))) exception_id
      from public.v_ecoflow_ordermentum_ui_active_exceptions e
    ), q as (
      select s.*,coalesce(l.lifecycle_status,'OPEN') lifecycle_status,coalesce(l.owner_team,'Operations queue') owner_team,l.snoozed_until,l.resolution_note,l.version,
        greatest(0,extract(epoch from(statement_timestamp()-s.detected_at)))::bigint age_seconds,
        case when upper(coalesce(s.exception_type,'')) like '%SYNC%' then 'SYNC' when upper(coalesce(s.exception_type,'')) like '%PAYMENT%' or upper(coalesce(s.exception_type,'')) like '%INVOICE%' then 'COMMERCIAL' when upper(coalesce(s.exception_type,'')) like '%RELEASE%' or upper(coalesce(s.exception_type,'')) like '%BARCODE%' or upper(coalesce(s.exception_type,'')) like '%STOCK%' then 'RELEASE' else 'DATA_QUALITY' end category,
        case when upper(coalesce(s.exception_type,'')) like '%MISSING%' or upper(coalesce(s.exception_type,'')) like '%BLOCK%' then 'HIGH' else 'MEDIUM' end severity,
        case when upper(coalesce(s.exception_type,'')) like '%SYNC%' then 'Review the source sync and retry the governed job.' when upper(coalesce(s.exception_type,'')) like '%PAYMENT%' or upper(coalesce(s.exception_type,'')) like '%INVOICE%' then 'Open the Order and verify mirrored invoice and payment facts.' when upper(coalesce(s.exception_type,'')) like '%BARCODE%' or upper(coalesce(s.exception_type,'')) like '%STOCK%' then 'Open Release Control and resolve the warehouse blocker.' else 'Open the Order and resolve the source data exception.' end recommended_action,
        s.detected_at+case when upper(coalesce(s.exception_type,'')) like '%MISSING%' or upper(coalesce(s.exception_type,'')) like '%BLOCK%' then interval '4 hours' else interval '1 day' end due_at
      from source_rows s left join analytics.actionable_exception_lifecycle l on l.exception_id=s.exception_id
      where coalesce(l.lifecycle_status,'OPEN')<>'RESOLVED'
        and (p_search is null or lower(concat_ws(' ',s.order_number,s.external_order_number,s.exception_type,s.message,coalesce(l.owner_team,'Operations queue'))) like v_search)
        and (p_filter is null or p_filter='' or lower(coalesce(l.lifecycle_status,'OPEN'))=lower(p_filter))
    ), n as (select count(*) c from q), p as (select * from q order by case when p_sort='oldest' then detected_at end asc nulls last,due_at asc,detected_at asc limit v_size offset v_offset)
    select n.c,to_jsonb(p),statement_timestamp() from n cross join p;
  elsif v_resource='logs' then
    return query with q as (
      select m.id,m.sku,m.product_name,m.movement_type,m.quantity,m.from_location,m.to_location,m.reference_type,m.reference_id,m.action_note,m.source,m.moved_by,m.moved_at
      from public.ecoflow_inventory_movements m
      where p_search is null or lower(concat_ws(' ',m.sku,m.product_name,m.movement_type,m.from_location,m.to_location,m.reference_type,m.reference_id,m.action_note,m.source)) like v_search
    ), n as (select count(*) c from q), p as (select * from q order by moved_at desc limit v_size offset v_offset)
    select n.c,to_jsonb(p),statement_timestamp() from n cross join p;
  else raise exception 'UNKNOWN_OPERATIONAL_PAGE_RESOURCE'; end if;
end $$;

create or replace function public.ecoflow_read_quick_actions()
returns table(action_keys text[],source text,revision bigint,read_at timestamptz)
language plpgsql stable security definer set search_path=pg_catalog,public
as $$
declare v_role text:=public.ecoflow_current_operational_role();
begin
  if v_role not in ('OWNER','ADMIN','ACCOUNT','VIEWER') then raise exception using errcode='42501',message='DESKTOP_OPERATIONAL_ROLE_REQUIRED'; end if;
  return query select u.action_keys,'USER'::text,u.revision,statement_timestamp() from public.ecoflow_user_quick_actions u where u.user_id=auth.uid();
  if found then return; end if;
  return query select d.action_keys,'ROLE_DEFAULT'::text,d.revision,statement_timestamp() from public.ecoflow_role_quick_action_defaults d where d.app_role=v_role;
end $$;

create or replace function public.ecoflow_set_quick_actions(p_action_keys text[],p_expected_revision bigint default 0)
returns table(action_keys text[],revision bigint,updated_at timestamptz)
language plpgsql security definer set search_path=pg_catalog,public
as $$
declare v_role text:=public.ecoflow_current_operational_role(); v_allowed constant text[]:=array['CONTROL_ROOM','ORDERS','INVENTORY','CUSTOMERS','DELIVERY','RETURNS','ANALYTICS','EXCEPTIONS','LOGS','SETTINGS']; v_row public.ecoflow_user_quick_actions%rowtype;
begin
  if v_role not in ('OWNER','ADMIN','ACCOUNT','VIEWER') then raise exception using errcode='42501',message='DESKTOP_OPERATIONAL_ROLE_REQUIRED'; end if;
  if p_action_keys is null or cardinality(p_action_keys)>4 or cardinality(p_action_keys)<>cardinality(array(select distinct x from unnest(p_action_keys) x)) or exists(select 1 from unnest(p_action_keys) x where not(x=any(v_allowed))) then raise exception 'INVALID_QUICK_ACTION_CONFIGURATION'; end if;
  select * into v_row from public.ecoflow_user_quick_actions where user_id=auth.uid() for update;
  if found and v_row.revision<>p_expected_revision then raise exception 'QUICK_ACTION_REVISION_CONFLICT'; end if;
  if not found and p_expected_revision<>0 then raise exception 'QUICK_ACTION_REVISION_CONFLICT'; end if;
  insert into public.ecoflow_user_quick_actions(user_id,action_keys,revision,updated_at) values(auth.uid(),p_action_keys,1,clock_timestamp())
  on conflict(user_id) do update set action_keys=excluded.action_keys,revision=public.ecoflow_user_quick_actions.revision+1,updated_at=clock_timestamp()
  returning * into v_row;
  return query select v_row.action_keys,v_row.revision,v_row.updated_at;
end $$;

create or replace function public.ecoflow_business_day_close_readiness(p_business_day date)
returns table(check_key text,check_status text,detail text,blocking boolean,read_at timestamptz)
language plpgsql stable security definer set search_path=pg_catalog,public,analytics
as $$
declare v_role text:=public.ecoflow_current_operational_role(); v_open bigint; v_unassigned bigint; v_unfinished bigint; v_unstaged bigint;
begin
  if v_role not in ('OWNER','ADMIN','ACCOUNT','VIEWER') then raise exception using errcode='42501',message='DESKTOP_OPERATIONAL_ROLE_REQUIRED'; end if;
  select count(*),count(*) filter(where l.owner_team is null) into v_open,v_unassigned
  from public.v_ecoflow_ordermentum_ui_active_exceptions e
  left join analytics.actionable_exception_lifecycle l on l.exception_id='ORDERMENTUM_ACTIVE:'||md5(concat_ws('|',coalesce(e.raw_order_id::text,''),coalesce(e.external_order_id::text,''),coalesce(e.external_order_number::text,''),coalesce(e.external_invoice_number::text,''),coalesce(e.order_number::text,''),coalesce(e.invoice_number::text,''),coalesce(e.exception_type::text,''),coalesce(e.status::text,''),coalesce(e.detected_at::text,'')))
  where coalesce(l.lifecycle_status,'OPEN')<>'RESOLVED';
  select count(*) into v_unfinished from public.ecoflow_day_state d where d.business_day=p_business_day and (d.scope like '%stop:%' or d.scope like 'stop:%') and coalesce(d.payload->>'status','PENDING') not in ('DELIVERED','FAILED');
  select count(*) into v_unstaged from public.ecoflow_day_state d where d.business_day=p_business_day and (d.scope like '%task:%' or d.scope like 'task:%') and coalesce(d.payload->>'status','PENDING')<>'PICKED';
  return query values
    ('SYNC_CUTOFF',case when exists(select 1 from public.v_ecoflow_ordermentum_sync_health h where h.last_synced_at is not null) then 'READY' else 'REVIEW' end,'Confirm the latest Ordermentum sync and Adelaide cut-off.',false,statement_timestamp()),
    ('EXCEPTION_ASSIGNMENT',case when v_unassigned=0 then 'READY' else 'BLOCKED' end,format('%s unresolved exceptions; %s without a governed lifecycle assignment.',v_open,v_unassigned),v_unassigned>0,statement_timestamp()),
    ('DELIVERY_RECONCILIATION',case when v_unfinished=0 then 'READY' else 'REVIEW' end,format('%s non-terminal delivery stops will carry over.',v_unfinished),false,statement_timestamp()),
    ('PICK_STAGING_RECONCILIATION',case when v_unstaged=0 then 'READY' else 'REVIEW' end,format('%s unfinished pick tasks will carry over.',v_unstaged),false,statement_timestamp()),
    ('ACCOUNTS_VARIANCE', 'ACK_REQUIRED','Owner/Admin must record the accounts variance acknowledgement in the close checklist.',true,statement_timestamp());
end $$;

create or replace function public.ecoflow_complete_business_day_close(
  p_business_day date,p_next_business_day date,p_expected_revision bigint,p_reason text,
  p_command_id uuid,p_checklist jsonb,p_acknowledgement_note text,p_actor_label text default null
)
returns table(command_id uuid,business_day date,close_status text,revision bigint,next_business_day date,carry_over_count integer,closed_at timestamptz)
language plpgsql security definer set search_path=pg_catalog,public
as $$
declare v_role text:=public.ecoflow_current_operational_role(); v_blocking integer; v_row record;
begin
  if v_role not in ('OWNER','ADMIN') then raise exception using errcode='42501',message='OWNER_OR_ADMIN_REQUIRED'; end if;
  if jsonb_typeof(p_checklist)<>'object' or coalesce((p_checklist->>'accountsVarianceAcknowledged')::boolean,false)=false then raise exception 'BUSINESS_DAY_CHECKLIST_ACKNOWLEDGEMENT_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_acknowledgement_note,'')),'') is null then raise exception 'BUSINESS_DAY_ACKNOWLEDGEMENT_NOTE_REQUIRED'; end if;
  select count(*) into v_blocking from public.ecoflow_business_day_close_readiness(p_business_day) r where r.blocking and r.check_key<>'ACCOUNTS_VARIANCE';
  if v_blocking>0 then raise exception 'BUSINESS_DAY_CLOSE_BLOCKED'; end if;
  insert into public.ecoflow_business_day_close_checklists(business_day,checklist,acknowledgement_note,command_id,recorded_by)
  values(p_business_day,p_checklist,left(btrim(p_acknowledgement_note),2000),p_command_id,auth.uid())
  on conflict(business_day) do update set checklist=excluded.checklist,acknowledgement_note=excluded.acknowledgement_note,command_id=excluded.command_id,recorded_by=excluded.recorded_by,recorded_at=clock_timestamp();
  return query select * from public.ecoflow_close_business_day(p_business_day,p_next_business_day,p_expected_revision,p_reason,p_command_id,p_actor_label);
end $$;

for grant_sql in
  select format('grant execute on function %s to authenticated',p.oid::regprocedure)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in (
    'ecoflow_start_stocktake_session','ecoflow_record_stocktake_observation','ecoflow_review_stocktake_observation',
    'ecoflow_complete_stocktake_location','ecoflow_reopen_stocktake_location','ecoflow_submit_stocktake_session',
    'ecoflow_approve_stocktake_session','ecoflow_move_warehouse_sku','ecoflow_read_warehouse_control',
    'ecoflow_read_operational_page','ecoflow_read_quick_actions','ecoflow_set_quick_actions',
    'ecoflow_business_day_close_readiness','ecoflow_complete_business_day_close'
  )
loop execute grant_sql; end loop;

notify pgrst,'reload schema';
commit;
