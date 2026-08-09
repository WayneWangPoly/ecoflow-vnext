-- TRANSFORM-006: bind shared Driver execution writes to the office-assigned route.
--
-- Route read authority is insufficient if a DRIVER can still call the generic
-- day-state command RPC for another run. Keep the existing CAS/idempotency
-- implementation intact behind a private primitive, and add a server-side
-- assignment preflight for every DRIVER command before delegation.
--
-- The existing product has one active run-control scope per business day. The
-- legacy global `shift` scope is therefore allowed only for the Driver assigned
-- to that active run; all run-prefixed DRIVER scopes must match their own run.

begin;

create or replace function public.ecoflow_assert_driver_day_scope_assignment(
  p_business_day date,
  p_scope text
)
returns void
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
#variable_conflict error
declare
  v_role text:=public.ecoflow_active_app_role();
  v_scope text:=nullif(btrim(coalesce(p_scope,'')),'');
  v_run_code text;
  v_assigned_driver uuid;
  v_active_run text;
  v_assigned_count integer;
begin
  if v_role is distinct from 'DRIVER' then return; end if;
  if auth.uid() is null then
    raise exception using errcode='42501',message='ACTIVE_AUTHENTICATED_ROLE_REQUIRED';
  end if;
  if p_business_day is null then raise exception 'BUSINESS_DAY_REQUIRED'; end if;
  if v_scope is null then raise exception 'VALID_DAY_STATE_SCOPE_REQUIRED'; end if;

  if v_scope ~ '^run:[A-Z]+:' then
    v_run_code:=split_part(v_scope,':',2);
  elsif v_scope='shift' then
    select upper(nullif(btrim(coalesce(d.payload->>'activeRunCode','')),''))
      into v_active_run
    from public.ecoflow_day_state d
    where d.business_day=p_business_day and d.scope='run-control'
    limit 1;

    if v_active_run is null then
      select count(*),min(r.run_code)
        into v_assigned_count,v_active_run
      from public.ecoflow_delivery_route_snapshots r
      where r.business_day=p_business_day
        and r.route_status='LOCKED'
        and r.assigned_driver_user_id=auth.uid();
      if v_assigned_count<>1 then
        raise exception using errcode='42501',message='DRIVER_ACTIVE_RUN_ASSIGNMENT_REQUIRED';
      end if;
    end if;
    v_run_code:=v_active_run;
  else
    -- Existing scope-role policy remains the final authority for non-run scopes.
    return;
  end if;

  if v_run_code !~ '^[A-Z]+$' then
    raise exception using errcode='42501',message='DRIVER_RUN_SCOPE_REQUIRED';
  end if;

  select r.assigned_driver_user_id into v_assigned_driver
  from public.ecoflow_delivery_route_snapshots r
  where r.business_day=p_business_day
    and r.run_code=v_run_code
    and r.route_status='LOCKED'
  limit 1;

  if not found or v_assigned_driver is null or v_assigned_driver<>auth.uid() then
    raise exception using errcode='42501',message='DRIVER_RUN_ASSIGNMENT_REQUIRED';
  end if;
end;
$$;

revoke all on function public.ecoflow_assert_driver_day_scope_assignment(date,text)
  from public,anon,authenticated;

alter function public.ecoflow_apply_day_state_commands(date,jsonb,text)
  rename to ecoflow_apply_day_state_commands_pre_driver_assignment_20260809;

revoke all on function public.ecoflow_apply_day_state_commands_pre_driver_assignment_20260809(date,jsonb,text)
  from public,anon,authenticated;

create or replace function public.ecoflow_apply_day_state_commands(
  p_business_day date,
  p_commands jsonb,
  p_updated_by text default null
)
returns table (
  command_id uuid,
  business_day date,
  scope text,
  command_status text,
  revision bigint,
  payload jsonb,
  updated_by text,
  updated_at timestamptz,
  change_seq bigint
)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
#variable_conflict error
declare
  v_day date:=coalesce(p_business_day,(clock_timestamp() at time zone 'Australia/Adelaide')::date);
  v_item jsonb;
  v_scope text;
begin
  -- Preserve the original primitive's validation/error contract for malformed
  -- command payloads. Assignment preflight runs only when an array is present.
  if jsonb_typeof(p_commands)='array' then
    for v_item in select value from jsonb_array_elements(p_commands)
    loop
      v_scope:=nullif(btrim(coalesce(v_item->>'scope','')),'');
      if v_scope is not null then
        perform public.ecoflow_assert_driver_day_scope_assignment(v_day,v_scope);
      end if;
    end loop;
  end if;

  return query
  select r.command_id,r.business_day,r.scope,r.command_status,r.revision,
         r.payload,r.updated_by,r.updated_at,r.change_seq
  from public.ecoflow_apply_day_state_commands_pre_driver_assignment_20260809(
    p_business_day,p_commands,p_updated_by
  ) r;
end;
$$;

revoke all on function public.ecoflow_apply_day_state_commands(date,jsonb,text)
  from public,anon,authenticated;
grant execute on function public.ecoflow_apply_day_state_commands(date,jsonb,text)
  to authenticated;

comment on function public.ecoflow_apply_day_state_commands(date,jsonb,text) is
  'Shared operational-state command boundary. DRIVER writes are preflighted against the active office-assigned delivery route before the preserved CAS/idempotency primitive executes.';
comment on function public.ecoflow_apply_day_state_commands_pre_driver_assignment_20260809(date,jsonb,text) is
  'Private preserved pre-TRANSFORM-006 CAS/idempotency primitive. Never grant browser roles direct execution.';

notify pgrst,'reload schema';
commit;
