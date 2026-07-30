-- INTEL-DATA-006A: governed Priority Work read model.
--
-- Priority Work is not a recency list. A current active exception is eligible only
-- when an explicit server-owned policy provides a complete impact statement,
-- next action and priority rank. Lifecycle ownership and suppression are joined
-- without mutating the source Order, warehouse, delivery or exception state.

begin;

do $preflight$
declare
  v_missing text[] := array[]::text[];
  v_column text;
begin
  if to_regclass('public.v_ecoflow_ordermentum_ui_active_exceptions') is null then
    v_missing := array_append(v_missing,'public.v_ecoflow_ordermentum_ui_active_exceptions');
  else
    foreach v_column in array array[
      'raw_order_id','external_order_id','external_order_number',
      'external_invoice_number','order_number','invoice_number',
      'exception_type','message','status','detected_at'
    ] loop
      if not exists(
        select 1
        from pg_catalog.pg_attribute
        where attrelid='public.v_ecoflow_ordermentum_ui_active_exceptions'::regclass
          and attname=v_column
          and attnum>0
          and not attisdropped
      ) then
        v_missing := array_append(
          v_missing,
          'public.v_ecoflow_ordermentum_ui_active_exceptions.'||v_column
        );
      end if;
    end loop;
  end if;

  if to_regclass('analytics.actionable_exception_lifecycle') is null then
    v_missing := array_append(v_missing,'analytics.actionable_exception_lifecycle');
  end if;
  if to_regclass('public.app_user_profiles') is null then
    v_missing := array_append(v_missing,'public.app_user_profiles');
  end if;

  if cardinality(v_missing)>0 then
    raise exception 'PRIORITY_WORK_PREREQUISITES_MISSING: %',
      array_to_string(v_missing,', ');
  end if;
end;
$preflight$;

create table analytics.actionable_exception_priority_policy (
  policy_key text primary key,
  match_phrase text not null unique,
  priority_rank integer not null,
  impact_statement text not null,
  next_action text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint priority_policy_key_format
    check (policy_key ~ '^[a-z0-9][a-z0-9_]{2,79}$'),
  constraint priority_policy_phrase
    check (
      btrim(match_phrase)=upper(btrim(match_phrase))
      and length(btrim(match_phrase)) between 5 and 160
    ),
  constraint priority_policy_rank check (priority_rank between 1 and 1000),
  constraint priority_policy_impact
    check (length(btrim(impact_statement)) between 10 and 500),
  constraint priority_policy_next_action
    check (length(btrim(next_action)) between 10 and 500),
  constraint priority_policy_time_order check (updated_at>=created_at)
);

revoke all on analytics.actionable_exception_priority_policy
  from public,anon,authenticated,service_role;

insert into analytics.actionable_exception_priority_policy(
  policy_key,
  match_phrase,
  priority_rank,
  impact_statement,
  next_action
)
values(
  'invoice_detail_missing',
  'INVOICE DETAIL MISSING',
  40,
  'EcoFlow cannot verify the Order from mirrored invoice or line detail.',
  'Open the Order and verify the mirrored invoice or line detail.'
);

create or replace function analytics.get_priority_work_queue(
  p_limit integer default 20
)
returns table(
  priority_item_id text,
  exception_id text,
  policy_key text,
  priority_rank integer,
  priority_capability text,
  order_entity_id text,
  order_display_label text,
  invoice_display_label text,
  cause_title text,
  cause_detail text,
  impact_statement text,
  detected_at timestamptz,
  age_seconds bigint,
  owner_team text,
  lifecycle_status text,
  next_action text,
  source_status text,
  read_at timestamptz
)
language plpgsql
security definer
set search_path=pg_catalog,analytics,public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_limit integer := coalesce(p_limit,20);
  v_read_at timestamptz := statement_timestamp();
begin
  if v_user is not null then
    select p.app_role
    into v_role
    from public.app_user_profiles p
    where p.user_id=v_user
      and p.is_active=true
      and p.team_status='ACTIVE';
  end if;

  if v_user is null
     or v_role is null
     or v_role not in ('OWNER','ADMIN','ACCOUNT','VIEWER') then
    raise exception using errcode='42501',
      message='PRIORITY_WORK_DESKTOP_ROLE_REQUIRED';
  end if;

  if v_limit<1 or v_limit>100 then
    raise exception using errcode='22023',
      message='PRIORITY_WORK_LIMIT_INVALID';
  end if;

  -- lifecycle_status='RESOLVED' rows are completed and not actionable.
  -- lifecycle_status='SNOOZED' rows remain suppressed while the snooze is active.
  return query
  with source_rows as (
    select
      e.raw_order_id::text as raw_order_id,
      e.external_order_id::text as external_order_id,
      e.external_order_number::text as external_order_number,
      e.external_invoice_number::text as external_invoice_number,
      e.order_number::text as order_number,
      e.invoice_number::text as invoice_number,
      nullif(btrim(e.exception_type::text),'') as exception_type,
      nullif(btrim(e.message::text),'') as message,
      nullif(btrim(e.status::text),'') as source_status,
      e.detected_at::timestamptz as detected_at,
      coalesce(
        nullif(btrim(e.raw_order_id::text),''),
        nullif(btrim(e.external_order_id::text),''),
        nullif(btrim(e.order_number::text),''),
        nullif(btrim(e.external_order_number::text),'')
      ) as handoff_order_id
    from public.v_ecoflow_ordermentum_ui_active_exceptions e
  ), identified as (
    select
      'ORDERMENTUM_ACTIVE:'||md5(concat_ws('|',
        coalesce(s.raw_order_id,''),
        coalesce(s.external_order_id,''),
        coalesce(s.external_order_number,''),
        coalesce(s.external_invoice_number,''),
        coalesce(s.order_number,''),
        coalesce(s.invoice_number,''),
        coalesce(s.exception_type,''),
        coalesce(s.source_status,''),
        coalesce(s.detected_at::text,'')
      )) as exception_id,
      s.*
    from source_rows s
  ), governed as (
    select
      i.*,
      p.policy_key,
      p.priority_rank,
      p.impact_statement,
      p.next_action,
      l.owner_team,
      coalesce(l.lifecycle_status,'OPEN') as lifecycle_status,
      l.snoozed_until
    from identified i
    join lateral (
      select candidate.*
      from analytics.actionable_exception_priority_policy candidate
      where candidate.enabled
        and position(
          candidate.match_phrase in upper(concat_ws(' ',
            coalesce(i.exception_type,''),
            coalesce(i.message,'')
          ))
        )>0
      order by candidate.priority_rank asc,
        length(candidate.match_phrase) desc,
        candidate.policy_key
      limit 1
    ) p on true
    left join analytics.actionable_exception_lifecycle l
      on l.exception_id=i.exception_id
    where i.handoff_order_id is not null
      and i.detected_at is not null
      and coalesce(l.lifecycle_status,'OPEN')<>'RESOLVED'
      and not (
        l.lifecycle_status='SNOOZED'
        and l.snoozed_until is not null
        and l.snoozed_until>v_read_at
      )
  )
  select
    g.exception_id as priority_item_id,
    g.exception_id,
    g.policy_key,
    g.priority_rank,
    'POLICY_GOVERNED'::text as priority_capability,
    g.handoff_order_id as order_entity_id,
    coalesce(
      nullif(btrim(g.external_order_number),''),
      nullif(btrim(g.order_number),''),
      nullif(btrim(g.external_order_id),''),
      g.handoff_order_id
    ) as order_display_label,
    coalesce(
      nullif(btrim(g.external_invoice_number),''),
      nullif(btrim(g.invoice_number),'')
    ) as invoice_display_label,
    g.exception_type as cause_title,
    g.message as cause_detail,
    g.impact_statement,
    g.detected_at,
    greatest(0,floor(extract(epoch from (v_read_at-g.detected_at))))::bigint
      as age_seconds,
    g.owner_team,
    g.lifecycle_status,
    g.next_action,
    g.source_status,
    v_read_at as read_at
  from governed g
  order by
    g.priority_rank asc,
    (g.owner_team is null) desc,
    g.detected_at asc,
    g.exception_id
  limit v_limit;
end;
$$;

revoke all on function analytics.get_priority_work_queue(integer)
  from public,anon,authenticated,service_role;
grant execute on function analytics.get_priority_work_queue(integer)
  to authenticated;

comment on table analytics.actionable_exception_priority_policy is
  'Server-owned exact evidence policies for Priority Work. Browser roles have no table access.';
comment on function analytics.get_priority_work_queue(integer) is
  'Bounded policy-ranked current Priority Work for active desktop roles. Returns complete Order, cause, qualitative impact, age, lifecycle owner and next action only; no operational writes.';

notify pgrst,'reload schema';

commit;
