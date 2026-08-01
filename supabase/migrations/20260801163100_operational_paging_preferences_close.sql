-- Phase 9F/9G: assigned exception queue, explicit Business Day Close,
-- server pagination and authenticated Quick Actions.

begin;

create table if not exists public.ecoflow_user_quick_actions (
  user_id uuid primary key,
  action_keys text[] not null default '{}'::text[]
    check (cardinality(action_keys) between 0 and 4),
  revision bigint not null default 1 check (revision>=1),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.ecoflow_role_quick_action_defaults (
  app_role text primary key check (app_role in ('OWNER','ADMIN','ACCOUNT','VIEWER')),
  action_keys text[] not null check (cardinality(action_keys) between 0 and 4),
  revision bigint not null default 1 check (revision>=1),
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
  checklist jsonb not null check (jsonb_typeof(checklist)='object'),
  acknowledgement_note text not null check (btrim(acknowledgement_note)<>''),
  command_id uuid not null unique,
  recorded_by uuid not null,
  recorded_at timestamptz not null default clock_timestamp()
);

alter table public.ecoflow_user_quick_actions enable row level security;
alter table public.ecoflow_role_quick_action_defaults enable row level security;
alter table public.ecoflow_business_day_close_checklists enable row level security;

revoke all on public.ecoflow_user_quick_actions from public,anon,authenticated;
revoke all on public.ecoflow_role_quick_action_defaults from public,anon,authenticated;
revoke all on public.ecoflow_business_day_close_checklists from public,anon,authenticated;

create or replace function public.ecoflow_read_quick_actions()
returns table(action_keys text[],source text,revision bigint,read_at timestamptz)
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
declare
  v_role text:=public.ecoflow_active_app_role();
begin
  if auth.uid() is null or v_role not in ('OWNER','ADMIN','ACCOUNT','VIEWER') then
    raise exception using errcode='42501',message='DESKTOP_OPERATIONAL_ROLE_REQUIRED';
  end if;

  return query
    select u.action_keys,'USER'::text,u.revision,statement_timestamp()
    from public.ecoflow_user_quick_actions u
    where u.user_id=auth.uid();
  if found then return; end if;

  return query
    select d.action_keys,'ROLE_DEFAULT'::text,d.revision,statement_timestamp()
    from public.ecoflow_role_quick_action_defaults d
    where d.app_role=v_role;
end;
$$;

create or replace function public.ecoflow_set_quick_actions(
  p_action_keys text[],
  p_expected_revision bigint default 0
)
returns table(action_keys text[],revision bigint,updated_at timestamptz)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_role text:=public.ecoflow_active_app_role();
  v_allowed constant text[]:=array[
    'CONTROL_ROOM','ORDERS','INVENTORY','CUSTOMERS','DELIVERY',
    'RETURNS','ANALYTICS','EXCEPTIONS','LOGS','SETTINGS'
  ];
  v_row public.ecoflow_user_quick_actions%rowtype;
begin
  if auth.uid() is null or v_role not in ('OWNER','ADMIN','ACCOUNT','VIEWER') then
    raise exception using errcode='42501',message='DESKTOP_OPERATIONAL_ROLE_REQUIRED';
  end if;
  if p_action_keys is null or cardinality(p_action_keys)>4 then
    raise exception 'INVALID_QUICK_ACTION_CONFIGURATION';
  end if;
  if cardinality(p_action_keys)<>(select count(distinct x) from unnest(p_action_keys) x) then
    raise exception 'DUPLICATE_QUICK_ACTION_CONFIGURATION';
  end if;
  if exists(select 1 from unnest(p_action_keys) x where not(x=any(v_allowed))) then
    raise exception 'UNKNOWN_QUICK_ACTION';
  end if;

  select * into v_row
  from public.ecoflow_user_quick_actions
  where user_id=auth.uid()
  for update;

  if found and v_row.revision<>p_expected_revision then raise exception 'QUICK_ACTION_REVISION_CONFLICT'; end if;
  if not found and p_expected_revision<>0 then raise exception 'QUICK_ACTION_REVISION_CONFLICT'; end if;

  insert into public.ecoflow_user_quick_actions(user_id,action_keys,revision,updated_at)
  values(auth.uid(),p_action_keys,1,clock_timestamp())
  on conflict(user_id) do update set
    action_keys=excluded.action_keys,
    revision=public.ecoflow_user_quick_actions.revision+1,
    updated_at=clock_timestamp()
  returning * into v_row;

  return query select v_row.action_keys,v_row.revision,v_row.updated_at;
end;
$$;

create or replace function public.ecoflow_read_operational_page(
  p_resource text,
  p_page integer default 1,
  p_page_size integer default 25,
  p_search text default null,
  p_filter text default null,
  p_sort text default null
)
returns table(total_count bigint,row_data jsonb,read_at timestamptz)
language plpgsql
stable
security definer
set search_path=pg_catalog,public,analytics
as $$
declare
  v_role text:=public.ecoflow_active_app_role();
  v_resource text:=lower(btrim(coalesce(p_resource,'')));
  v_page integer:=coalesce(p_page,1);
  v_size integer:=coalesce(p_page_size,25);
  v_offset integer;
  v_search text:='%'||lower(btrim(coalesce(p_search,'')))||'%';
begin
  if auth.uid() is null or v_role not in ('OWNER','ADMIN','ACCOUNT','VIEWER') then
    raise exception using errcode='42501',message='DESKTOP_OPERATIONAL_ROLE_REQUIRED';
  end if;
  if v_resource in ('inventory','logs') and v_role='ACCOUNT' then
    raise exception using errcode='42501',message='WORKSPACE_NOT_AUTHORISED';
  end if;
  if v_resource='exceptions' and v_role='VIEWER' then
    raise exception using errcode='42501',message='EXCEPTION_ACTION_QUEUE_NOT_AUTHORISED';
  end if;
  if v_page<1 or v_size not in (10,20,25,50,100) then
    raise exception 'INVALID_OPERATIONAL_PAGE_REQUEST';
  end if;
  v_offset:=(v_page-1)*v_size;

  if v_resource='orders' then
    return query
    with q as (
      select o.*
      from public.v_ecoflow_ordermentum_ui_active_inbox o
      where (nullif(btrim(coalesce(p_search,'')),'') is null or
             lower(concat_ws(' ',o.order_number,o.external_order_number,o.invoice_number,
               o.external_invoice_number,o.order_status,o.payment_status)) like v_search)
        and (nullif(btrim(coalesce(p_filter,'')),'') is null or
             lower(coalesce(o.order_status,''))=lower(btrim(p_filter)) or
             lower(coalesce(o.payment_status,''))=lower(btrim(p_filter)))
    ), counted as (select count(*)::bigint as total from q), page_rows as (
      select * from q
      order by
        case when p_sort='oldest' then order_updated_at end asc nulls last,
        case when p_sort<>'oldest' then order_updated_at end desc nulls last,
        coalesce(order_number,external_order_number)
      limit v_size offset v_offset
    ), emitted as (
      select c.total,to_jsonb(p) as payload,statement_timestamp() as read_at
      from counted c cross join page_rows p
      union all
      select c.total,null::jsonb,statement_timestamp()
      from counted c where not exists(select 1 from page_rows)
    )
    select emitted.total,emitted.payload,emitted.read_at from emitted;

  elsif v_resource='stores' then
    return query
    with q as (
      select s.*
      from public.ecoflow_store_sites s
      where nullif(btrim(coalesce(p_search,'')),'') is null or
        lower(concat_ws(' ',s.store_name,s.suburb,s.formatted_address,
          s.contact_phone,s.price_group_id,s.retailer_id)) like v_search
    ), counted as (select count(*)::bigint as total from q), page_rows as (
      select * from q
      order by
        case when p_sort='suburb' then suburb end asc nulls last,
        store_name asc nulls last,retailer_id
      limit v_size offset v_offset
    ), emitted as (
      select c.total,to_jsonb(p),statement_timestamp()
      from counted c cross join page_rows p
      union all
      select c.total,null::jsonb,statement_timestamp()
      from counted c where not exists(select 1 from page_rows)
    )
    select * from emitted;

  elsif v_resource='inventory' then
    return query
    with q as (
      select l.location_code as location,i.sku,i.product_name,i.unit_level,
             i.quantity as on_hand_location,i.last_movement_at as latest_location_movement_at
      from public.ecoflow_warehouse_location_items i
      join public.ecoflow_warehouse_locations l on l.id=i.location_id
      where l.status='ACTIVE' and i.status='ACTIVE'
        and (nullif(btrim(coalesce(p_search,'')),'') is null or
             lower(concat_ws(' ',i.sku,i.product_name,l.location_code,i.unit_level)) like v_search)
        and (nullif(btrim(coalesce(p_filter,'')),'') is null or
             lower(l.location_code)=lower(btrim(p_filter)))
    ), counted as (select count(*)::bigint as total from q), page_rows as (
      select * from q
      order by
        case when p_sort='quantity-desc' then on_hand_location end desc nulls last,
        location,sku,unit_level
      limit v_size offset v_offset
    ), emitted as (
      select c.total,to_jsonb(p),statement_timestamp()
      from counted c cross join page_rows p
      union all
      select c.total,null::jsonb,statement_timestamp()
      from counted c where not exists(select 1 from page_rows)
    )
    select * from emitted;

  elsif v_resource='exceptions' then
    return query
    with source_rows as (
      select e.*,
        'ORDERMENTUM_ACTIVE:'||md5(concat_ws('|',
          coalesce(e.raw_order_id::text,''),coalesce(e.external_order_id::text,''),
          coalesce(e.external_order_number::text,''),coalesce(e.external_invoice_number::text,''),
          coalesce(e.order_number::text,''),coalesce(e.invoice_number::text,''),
          coalesce(e.exception_type::text,''),coalesce(e.status::text,''),
          coalesce(e.detected_at::text,'')
        )) as exception_id
      from public.v_ecoflow_ordermentum_ui_active_exceptions e
    ), q as (
      select s.*,
        coalesce(l.lifecycle_status,'OPEN') as lifecycle_status,
        coalesce(l.owner_team,'Operations queue') as owner_team,
        l.snoozed_until,l.resolution_note,l.version,
        greatest(0,extract(epoch from(statement_timestamp()-s.detected_at)))::bigint as age_seconds,
        case
          when upper(coalesce(s.exception_type,'')) like '%SYNC%' then 'SYNC'
          when upper(coalesce(s.exception_type,'')) like '%PAYMENT%'
            or upper(coalesce(s.exception_type,'')) like '%INVOICE%' then 'COMMERCIAL'
          when upper(coalesce(s.exception_type,'')) like '%RELEASE%'
            or upper(coalesce(s.exception_type,'')) like '%BARCODE%'
            or upper(coalesce(s.exception_type,'')) like '%STOCK%' then 'RELEASE'
          else 'DATA_QUALITY'
        end as category,
        case
          when upper(coalesce(s.exception_type,'')) like '%MISSING%'
            or upper(coalesce(s.exception_type,'')) like '%BLOCK%' then 'HIGH'
          else 'MEDIUM'
        end as severity,
        case
          when upper(coalesce(s.exception_type,'')) like '%SYNC%'
            then 'Review source sync and retry the governed sync job.'
          when upper(coalesce(s.exception_type,'')) like '%PAYMENT%'
            or upper(coalesce(s.exception_type,'')) like '%INVOICE%'
            then 'Open the Order and verify mirrored invoice and payment facts.'
          when upper(coalesce(s.exception_type,'')) like '%BARCODE%'
            or upper(coalesce(s.exception_type,'')) like '%STOCK%'
            then 'Open Release Control and resolve the warehouse blocker.'
          else 'Open the Order and resolve the source data exception.'
        end as recommended_action,
        s.detected_at+case
          when upper(coalesce(s.exception_type,'')) like '%MISSING%'
            or upper(coalesce(s.exception_type,'')) like '%BLOCK%' then interval '4 hours'
          else interval '1 day'
        end as due_at
      from source_rows s
      left join analytics.actionable_exception_lifecycle l on l.exception_id=s.exception_id
      where coalesce(l.lifecycle_status,'OPEN')<>'RESOLVED'
        and (nullif(btrim(coalesce(p_search,'')),'') is null or
          lower(concat_ws(' ',s.order_number,s.external_order_number,s.exception_type,
            s.message,coalesce(l.owner_team,'Operations queue'))) like v_search)
        and (nullif(btrim(coalesce(p_filter,'')),'') is null or
          lower(coalesce(l.lifecycle_status,'OPEN'))=lower(btrim(p_filter)))
    ), counted as (select count(*)::bigint as total from q), page_rows as (
      select * from q
      order by
        case when p_sort='latest' then detected_at end desc nulls last,
        case when p_sort<>'latest' then due_at end asc nulls last,
        detected_at asc nulls last,exception_id
      limit v_size offset v_offset
    ), emitted as (
      select c.total,to_jsonb(p),statement_timestamp()
      from counted c cross join page_rows p
      union all
      select c.total,null::jsonb,statement_timestamp()
      from counted c where not exists(select 1 from page_rows)
    )
    select * from emitted;

  elsif v_resource='logs' then
    return query
    with q as (
      select m.id,m.sku,m.product_name,m.movement_type,m.quantity,
             m.from_location,m.to_location,m.reference_type,m.reference_id,
             m.action_note,m.source,m.moved_by,m.moved_at
      from public.ecoflow_inventory_movements m
      where nullif(btrim(coalesce(p_search,'')),'') is null or
        lower(concat_ws(' ',m.sku,m.product_name,m.movement_type,m.from_location,
          m.to_location,m.reference_type,m.reference_id,m.action_note,m.source)) like v_search
    ), counted as (select count(*)::bigint as total from q), page_rows as (
      select * from q order by moved_at desc,id limit v_size offset v_offset
    ), emitted as (
      select c.total,to_jsonb(p),statement_timestamp()
      from counted c cross join page_rows p
      union all
      select c.total,null::jsonb,statement_timestamp()
      from counted c where not exists(select 1 from page_rows)
    )
    select * from emitted;
  else
    raise exception 'UNKNOWN_OPERATIONAL_PAGE_RESOURCE';
  end if;
end;
$$;

create or replace function public.ecoflow_business_day_close_readiness(p_business_day date)
returns table(
  check_key text,
  check_status text,
  detail text,
  blocking boolean,
  read_at timestamptz
)
language plpgsql
stable
security definer
set search_path=pg_catalog,public,analytics
as $$
declare
  v_role text:=public.ecoflow_active_app_role();
  v_open bigint:=0;
  v_unassigned bigint:=0;
  v_unfinished_stops bigint:=0;
  v_unfinished_tasks bigint:=0;
begin
  if auth.uid() is null or v_role not in ('OWNER','ADMIN','ACCOUNT','VIEWER') then
    raise exception using errcode='42501',message='DESKTOP_OPERATIONAL_ROLE_REQUIRED';
  end if;

  with source_rows as (
    select 'ORDERMENTUM_ACTIVE:'||md5(concat_ws('|',
      coalesce(e.raw_order_id::text,''),coalesce(e.external_order_id::text,''),
      coalesce(e.external_order_number::text,''),coalesce(e.external_invoice_number::text,''),
      coalesce(e.order_number::text,''),coalesce(e.invoice_number::text,''),
      coalesce(e.exception_type::text,''),coalesce(e.status::text,''),coalesce(e.detected_at::text,'')
    )) as exception_id
    from public.v_ecoflow_ordermentum_ui_active_exceptions e
  )
  select count(*),count(*) filter(where l.owner_team is null)
  into v_open,v_unassigned
  from source_rows s
  left join analytics.actionable_exception_lifecycle l on l.exception_id=s.exception_id
  where coalesce(l.lifecycle_status,'OPEN')<>'RESOLVED';

  select count(*) into v_unfinished_stops
  from public.ecoflow_day_state d
  where d.business_day=p_business_day
    and d.scope like '%stop:%'
    and coalesce(d.payload->>'status','PENDING') not in ('DELIVERED','FAILED');

  select count(*) into v_unfinished_tasks
  from public.ecoflow_day_state d
  where d.business_day=p_business_day
    and d.scope like '%task:%'
    and coalesce(d.payload->>'status','PENDING')<>'PICKED';

  return query values
    ('SYNC_CUTOFF',
      case when exists(select 1 from public.v_ecoflow_ordermentum_sync_health h where h.last_synced_at is not null) then 'READY' else 'REVIEW' end,
      'Confirm the latest Ordermentum sync and Adelaide cut-off.',false,statement_timestamp()),
    ('EXCEPTION_ASSIGNMENT',case when v_unassigned=0 then 'READY' else 'BLOCKED' end,
      format('%s unresolved exceptions; %s without a governed owner.',v_open,v_unassigned),v_unassigned>0,statement_timestamp()),
    ('DELIVERY_RECONCILIATION',case when v_unfinished_stops=0 then 'READY' else 'REVIEW' end,
      format('%s non-terminal delivery stops will carry over.',v_unfinished_stops),false,statement_timestamp()),
    ('PICK_STAGING_RECONCILIATION',case when v_unfinished_tasks=0 then 'READY' else 'REVIEW' end,
      format('%s unfinished pick tasks will carry over.',v_unfinished_tasks),false,statement_timestamp()),
    ('ACCOUNTS_VARIANCE','ACK_REQUIRED',
      'Owner/Admin must record the accounts variance acknowledgement before close.',true,statement_timestamp());
end;
$$;

create or replace function public.ecoflow_complete_business_day_close(
  p_business_day date,
  p_next_business_day date,
  p_expected_revision bigint,
  p_reason text,
  p_command_id uuid,
  p_checklist jsonb,
  p_acknowledgement_note text,
  p_actor_label text default null
)
returns table(
  command_id uuid,
  business_day date,
  close_status text,
  revision bigint,
  next_business_day date,
  carry_over_count integer,
  closed_at timestamptz
)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_role text:=public.ecoflow_active_app_role();
  v_blocking integer:=0;
begin
  if auth.uid() is null or v_role not in ('OWNER','ADMIN') then
    raise exception using errcode='42501',message='OWNER_OR_ADMIN_REQUIRED';
  end if;
  if p_command_id is null then raise exception 'BUSINESS_DAY_CLOSE_COMMAND_ID_REQUIRED'; end if;
  if jsonb_typeof(p_checklist)<>'object'
    or coalesce((p_checklist->>'accountsVarianceAcknowledged')::boolean,false)=false then
    raise exception 'BUSINESS_DAY_CHECKLIST_ACKNOWLEDGEMENT_REQUIRED';
  end if;
  if nullif(btrim(coalesce(p_acknowledgement_note,'')),'') is null then
    raise exception 'BUSINESS_DAY_ACKNOWLEDGEMENT_NOTE_REQUIRED';
  end if;

  select count(*) into v_blocking
  from public.ecoflow_business_day_close_readiness(p_business_day) r
  where r.blocking and r.check_key<>'ACCOUNTS_VARIANCE';
  if v_blocking>0 then raise exception 'BUSINESS_DAY_CLOSE_BLOCKED'; end if;

  insert into public.ecoflow_business_day_close_checklists(
    business_day,checklist,acknowledgement_note,command_id,recorded_by
  ) values (
    p_business_day,p_checklist,left(btrim(p_acknowledgement_note),2000),
    p_command_id,auth.uid()
  )
  on conflict(business_day) do update set
    checklist=excluded.checklist,
    acknowledgement_note=excluded.acknowledgement_note,
    command_id=excluded.command_id,
    recorded_by=excluded.recorded_by,
    recorded_at=clock_timestamp();

  return query
    select * from public.ecoflow_close_business_day(
      p_business_day,p_next_business_day,p_expected_revision,
      p_reason,p_command_id,p_actor_label
    );
end;
$$;

revoke all on function public.ecoflow_read_quick_actions() from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_set_quick_actions(text[],bigint) from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_read_operational_page(text,integer,integer,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_business_day_close_readiness(date) from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_complete_business_day_close(date,date,bigint,text,uuid,jsonb,text,text) from public,anon,authenticated,service_role;

grant execute on function public.ecoflow_read_quick_actions() to authenticated;
grant execute on function public.ecoflow_set_quick_actions(text[],bigint) to authenticated;
grant execute on function public.ecoflow_read_operational_page(text,integer,integer,text,text,text) to authenticated;
grant execute on function public.ecoflow_business_day_close_readiness(date) to authenticated;
grant execute on function public.ecoflow_complete_business_day_close(date,date,bigint,text,uuid,jsonb,text,text) to authenticated;

comment on function public.ecoflow_read_operational_page(text,integer,integer,text,text,text) is
  'Bounded server pagination for Orders, Stores, Inventory, Exceptions and Logs. Returns exact total and requested page only.';
comment on function public.ecoflow_complete_business_day_close(date,date,bigint,text,uuid,jsonb,text,text) is
  'Owner/Admin close wrapper requiring explicit reconciliation acknowledgement before the existing carry-over authority.';

notify pgrst,'reload schema';
commit;
