-- Return receipt idempotency must not depend on free-text scan notes.

begin;

create table if not exists public.ecoflow_delivery_return_commands (
  command_id uuid primary key,
  command_type text not null check (command_type in ('RECEIVE_RETURN')),
  exception_id uuid not null references public.ecoflow_delivery_exceptions(id) on delete restrict,
  result_payload jsonb not null default '{}'::jsonb,
  actor_user_id uuid not null,
  actor_role text not null,
  created_at timestamptz not null default clock_timestamp()
);

alter table public.ecoflow_delivery_return_commands enable row level security;
revoke all on public.ecoflow_delivery_return_commands from public, anon, authenticated;

create or replace function public.ecoflow_receive_delivery_return(
  p_return_code text,
  p_warehouse_location text,
  p_note text,
  p_command_id uuid
)
returns table(
  exception_id uuid,
  return_code text,
  return_status text,
  warehouse_location text,
  received_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_variable
declare
  v_role text := public.ecoflow_require_product_identity_role(false);
  v_code text := upper(nullif(btrim(coalesce(p_return_code, '')), ''));
  v_location text := upper(coalesce(nullif(btrim(coalesce(p_warehouse_location, '')), ''), 'RETURNS-HOLD'));
  v_exception public.ecoflow_delivery_exceptions%rowtype;
  v_command public.ecoflow_delivery_return_commands%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_command_id is null then raise exception 'RETURN_COMMAND_ID_REQUIRED'; end if;
  if v_code is null then raise exception 'RETURN_CODE_REQUIRED'; end if;

  select * into v_command
  from public.ecoflow_delivery_return_commands c
  where c.command_id = p_command_id;
  if found then
    select * into v_exception
    from public.ecoflow_delivery_exceptions e
    where e.id = v_command.exception_id;
    return query select v_exception.id, v_exception.return_code, v_exception.return_status,
      v_exception.warehouse_location, v_exception.warehouse_received_at;
    return;
  end if;

  select * into v_exception
  from public.ecoflow_delivery_exceptions e
  where upper(e.return_code) = v_code
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'RETURN_CODE_NOT_FOUND'; end if;
  if v_exception.return_status in ('RESTOCKED','DISPOSED','MIXED_DISPOSITION','CANCELLED','NOT_REQUIRED') then
    raise exception 'RETURN_ALREADY_CLOSED';
  end if;

  update public.ecoflow_delivery_exceptions
  set return_status = case when return_status = 'WITH_DRIVER' then 'RETURNED_TO_WAREHOUSE' else return_status end,
      warehouse_location = v_location,
      warehouse_received_by = coalesce(warehouse_received_by, auth.uid()::text),
      warehouse_received_at = coalesce(warehouse_received_at, v_now),
      updated_at = v_now
  where id = v_exception.id
  returning * into v_exception;

  insert into public.ecoflow_delivery_return_scans(
    exception_id, return_code, scan_action, warehouse_location,
    scan_note, scanned_by, scanned_at
  ) values (
    v_exception.id, v_exception.return_code, 'RETURNED_TO_WAREHOUSE',
    v_location, nullif(btrim(coalesce(p_note, '')), ''),
    auth.uid()::text, v_now
  );

  insert into public.ecoflow_delivery_return_commands(
    command_id, command_type, exception_id, result_payload,
    actor_user_id, actor_role, created_at
  ) values (
    p_command_id, 'RECEIVE_RETURN', v_exception.id,
    jsonb_build_object(
      'returnCode', v_exception.return_code,
      'returnStatus', v_exception.return_status,
      'warehouseLocation', v_exception.warehouse_location,
      'receivedAt', v_exception.warehouse_received_at
    ),
    auth.uid(), v_role, v_now
  );

  return query select v_exception.id, v_exception.return_code, v_exception.return_status,
    v_exception.warehouse_location, v_exception.warehouse_received_at;
end;
$$;

grant execute on function public.ecoflow_receive_delivery_return(text, text, text, uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
