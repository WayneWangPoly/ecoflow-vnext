-- Business Day Close must not carry completed delivery releases or staging facts.

create or replace function public.ecoflow_close_business_day(
  p_business_day date,
  p_next_business_day date,
  p_expected_revision bigint,
  p_reason text,
  p_command_id uuid,
  p_actor_label text default null
)
returns table (
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
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := public.ecoflow_active_app_role();
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_label text := left(coalesce(nullif(trim(coalesce(p_actor_label, '')), ''), v_role, 'Owner/Admin'), 200);
  v_current public.ecoflow_business_day_closes%rowtype;
  v_run_code text := 'A';
  v_count integer := 0;
begin
  if v_actor is null or v_role not in ('OWNER','ADMIN') then
    raise exception 'OWNER_OR_ADMIN_REQUIRED';
  end if;
  if p_business_day is null or p_next_business_day is null or p_next_business_day <= p_business_day then
    raise exception 'VALID_NEXT_BUSINESS_DAY_REQUIRED';
  end if;
  if v_reason is null then raise exception 'BUSINESS_DAY_CLOSE_REASON_REQUIRED'; end if;
  if p_command_id is null then raise exception 'BUSINESS_DAY_CLOSE_COMMAND_ID_REQUIRED'; end if;
  if coalesce(p_expected_revision, -1) < 0 then raise exception 'EXPECTED_REVISION_REQUIRED'; end if;

  perform pg_advisory_xact_lock(hashtextextended('day-close:' || p_business_day::text, 0));

  select c.* into v_current
  from public.ecoflow_business_day_closes c
  where c.business_day = p_business_day
  for update;

  if found then
    if v_current.command_id = p_command_id
       and v_current.next_business_day = p_next_business_day
       and v_current.reason = v_reason then
      return query select p_command_id, p_business_day, 'REPLAYED'::text,
        v_current.revision, v_current.next_business_day,
        v_current.carry_over_count, v_current.closed_at;
      return;
    end if;

    return query select p_command_id, p_business_day, 'CONFLICT'::text,
      v_current.revision, v_current.next_business_day,
      v_current.carry_over_count, v_current.closed_at;
    return;
  end if;

  if p_expected_revision <> 0 then
    return query select p_command_id, p_business_day, 'CONFLICT'::text,
      0::bigint, p_next_business_day, 0, null::timestamptz;
    return;
  end if;

  select upper(coalesce(nullif(d.payload ->> 'activeRunCode', ''), 'A'))
  into v_run_code
  from public.ecoflow_day_state d
  where d.business_day = p_business_day and d.scope = 'run-control'
  limit 1;
  v_run_code := coalesce(v_run_code, 'A');

  with relevant as (
    select d.*,
      case
        when d.scope like 'run:' || v_run_code || ':%' then substr(d.scope, length('run:' || v_run_code || ':') + 1)
        when v_run_code = 'A' and d.scope not like 'run:%' then d.scope
        else null
      end as local_scope
    from public.ecoflow_day_state d
    where d.business_day = p_business_day
  ), terminal_orders as (
    select substr(r.local_scope, length('stop:') + 1) as order_id
    from relevant r
    where r.local_scope like 'stop:%'
      and coalesce(r.payload ->> 'status', 'PENDING') in ('DELIVERED','FAILED')
  ), carryable as (
    select r.*,
      case
        when r.local_scope = 'meta' then 'ROUTE_PLAN'
        when r.local_scope like 'release:%' then 'ORDER_RELEASE'
        when r.local_scope like 'stop:%' then 'DRIVER_PROGRESS'
        when r.local_scope like 'task:%' then 'PICK_TASK'
        when r.local_scope like 'alloc:%' then 'PICK_ALLOCATION'
        when r.local_scope like 'stage:%' then 'STAGING'
        else null
      end as carry_type
    from relevant r
    where r.local_scope is not null
      and (
        (r.local_scope = 'meta' and nullif(r.payload ->> 'lockedAt', '') is not null)
        or (
          r.local_scope like 'release:%'
          and nullif(r.payload ->> 'releasedAt', '') is not null
          and substr(r.local_scope, length('release:') + 1) not in (select order_id from terminal_orders)
        )
        or (r.local_scope like 'stop:%' and coalesce(r.payload ->> 'status', 'PENDING') not in ('DELIVERED','FAILED'))
        or (r.local_scope like 'task:%' and coalesce(r.payload ->> 'status', 'PENDING') <> 'PICKED')
        or (r.local_scope like 'alloc:%' and coalesce((r.payload ->> 'done')::boolean, false) = false)
        or (
          r.local_scope like 'stage:%'
          and nullif(r.payload ->> 'stagedAt', '') is not null
          and substr(r.local_scope, length('stage:') + 1) not in (select order_id from terminal_orders)
        )
      )
  )
  insert into public.ecoflow_business_day_carry_over(
    source_business_day, target_business_day, source_scope, run_code,
    carry_type, payload, source_revision, created_by
  )
  select p_business_day, p_next_business_day, c.scope, v_run_code,
         c.carry_type, c.payload, c.revision, v_actor
  from carryable c
  where c.carry_type is not null
  on conflict(source_business_day, target_business_day, source_scope)
  do update set payload = excluded.payload,
                source_revision = excluded.source_revision,
                carry_type = excluded.carry_type,
                created_by = excluded.created_by,
                created_at = clock_timestamp(),
                status = 'OPEN',
                resolved_by = null,
                resolved_at = null,
                resolution_note = null;

  get diagnostics v_count = row_count;

  insert into public.ecoflow_business_day_closes(
    business_day, revision, next_business_day, reason, command_id,
    closed_by, closed_by_label, carry_over_count
  ) values (
    p_business_day, 1, p_next_business_day, v_reason, p_command_id,
    v_actor, v_label, v_count
  ) returning * into v_current;

  return query select p_command_id, p_business_day, 'APPLIED'::text,
    v_current.revision, v_current.next_business_day,
    v_current.carry_over_count, v_current.closed_at;
end;
$$;

grant execute on function public.ecoflow_close_business_day(date,date,bigint,text,uuid,text) to authenticated;
revoke execute on function public.ecoflow_close_business_day(date,date,bigint,text,uuid,text) from anon;
