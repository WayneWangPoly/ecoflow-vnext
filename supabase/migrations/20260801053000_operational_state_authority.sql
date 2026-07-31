-- Server-authoritative operational state for driver, pick, route and business-day work.
-- Browser storage is an offline cache only. Every shared write uses an idempotent
-- command and a per-scope compare-and-swap revision.

begin;

alter table public.ecoflow_day_state
  add column if not exists revision bigint,
  add column if not exists last_command_id uuid,
  add column if not exists updated_by_user_id uuid;

update public.ecoflow_day_state
set revision = 1
where revision is null or revision < 1;

alter table public.ecoflow_day_state
  alter column revision set default 1,
  alter column revision set not null;

create or replace function public.ecoflow_guard_day_state_revision()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if new.revision is null then new.revision := 1; end if;
    if new.revision <> 1 then
      raise exception 'DAY_STATE_INSERT_REVISION_MUST_BE_ONE';
    end if;
  elsif new.revision <> old.revision + 1 then
    raise exception 'DAY_STATE_REVISION_MUST_INCREMENT: scope %, current %, supplied %',
      old.scope, old.revision, new.revision;
  end if;
  return new;
end;
$$;

revoke all on function public.ecoflow_guard_day_state_revision() from public, anon, authenticated;

drop trigger if exists trg_ecoflow_day_state_revision_guard on public.ecoflow_day_state;
create trigger trg_ecoflow_day_state_revision_guard
before insert or update on public.ecoflow_day_state
for each row execute function public.ecoflow_guard_day_state_revision();

create table if not exists public.ecoflow_day_state_commands (
  command_id uuid primary key,
  business_day date not null,
  scope text not null,
  expected_revision bigint not null check (expected_revision >= 0),
  result_revision bigint not null check (result_revision = expected_revision + 1),
  payload jsonb not null,
  result_updated_by text,
  result_updated_at timestamptz not null,
  result_change_seq bigint not null,
  actor_user_id uuid not null,
  actor_label text,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists idx_ecoflow_day_state_commands_day_scope
  on public.ecoflow_day_state_commands(business_day, scope, created_at desc);

alter table public.ecoflow_day_state_commands enable row level security;
revoke all on public.ecoflow_day_state_commands from public, anon, authenticated;

-- Shared state is readable by active roles, but no browser may write the table
-- directly. All writes pass through ecoflow_apply_day_state_commands().
revoke insert, update, delete on public.ecoflow_day_state from anon, authenticated;
grant select on public.ecoflow_day_state to authenticated;

drop policy if exists ecoflow_day_state_scoped_insert on public.ecoflow_day_state;
drop policy if exists ecoflow_day_state_scoped_update on public.ecoflow_day_state;

create or replace function public.ecoflow_read_day_state(
  p_business_day date,
  p_after_change_seq bigint default 0,
  p_limit integer default 500
)
returns table (
  business_day date,
  scope text,
  payload jsonb,
  updated_by text,
  updated_at timestamptz,
  change_seq bigint,
  revision bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.ecoflow_active_app_role() is null then
    raise exception 'ACTIVE_AUTHENTICATED_ROLE_REQUIRED';
  end if;

  return query
  select d.business_day, d.scope, d.payload, d.updated_by, d.updated_at,
         d.change_seq, d.revision
  from public.ecoflow_day_state d
  where d.business_day = p_business_day
    and d.change_seq > greatest(coalesce(p_after_change_seq, 0), 0)
  order by d.change_seq asc
  limit greatest(1, least(coalesce(p_limit, 500), 500));
end;
$$;

create or replace function public.ecoflow_read_day_state_scope(
  p_business_day date,
  p_scope text
)
returns table (
  business_day date,
  scope text,
  payload jsonb,
  updated_by text,
  updated_at timestamptz,
  change_seq bigint,
  revision bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.ecoflow_active_app_role() is null then
    raise exception 'ACTIVE_AUTHENTICATED_ROLE_REQUIRED';
  end if;

  return query
  select d.business_day, d.scope, d.payload, d.updated_by, d.updated_at,
         d.change_seq, d.revision
  from public.ecoflow_day_state d
  where d.business_day = p_business_day
    and d.scope = nullif(trim(coalesce(p_scope, '')), '')
  limit 1;
end;
$$;

grant execute on function public.ecoflow_read_day_state(date,bigint,integer) to authenticated;
grant execute on function public.ecoflow_read_day_state_scope(date,text) to authenticated;
revoke execute on function public.ecoflow_read_day_state(date,bigint,integer) from anon;
revoke execute on function public.ecoflow_read_day_state_scope(date,text) from anon;

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
set search_path = public
as $$
declare
  v_day date := coalesce(p_business_day, (clock_timestamp() at time zone 'Australia/Adelaide')::date);
  v_actor uuid := auth.uid();
  v_actor_role text := public.ecoflow_active_app_role();
  v_actor_label text := left(coalesce(nullif(trim(coalesce(p_updated_by, '')), ''), v_actor_role, 'Operator'), 200);
  v_item jsonb;
  v_command_id uuid;
  v_scope text;
  v_payload jsonb;
  v_expected bigint;
  v_current_revision bigint;
  v_current_payload jsonb;
  v_current_updated_by text;
  v_current_updated_at timestamptz;
  v_current_change_seq bigint;
  v_existing public.ecoflow_day_state_commands%rowtype;
  v_seen_commands uuid[] := array[]::uuid[];
  v_count integer;
  v_has_conflict boolean := false;
  v_written_revision bigint;
  v_written_payload jsonb;
  v_written_by text;
  v_written_at timestamptz;
  v_written_change_seq bigint;
begin
  if v_actor is null or v_actor_role is null then
    raise exception 'ACTIVE_AUTHENTICATED_ROLE_REQUIRED';
  end if;
  if jsonb_typeof(p_commands) <> 'array' then
    raise exception 'DAY_STATE_COMMANDS_MUST_BE_ARRAY';
  end if;

  v_count := jsonb_array_length(p_commands);
  if v_count < 1 or v_count > 200 then
    raise exception 'DAY_STATE_COMMAND_COUNT_OUT_OF_RANGE: %', v_count;
  end if;

  -- Validate command shape and idempotency keys before any write.
  for v_item in select value from jsonb_array_elements(p_commands)
  loop
    begin
      v_command_id := (v_item ->> 'commandId')::uuid;
    exception when others then
      raise exception 'VALID_COMMAND_ID_REQUIRED';
    end;
    if v_command_id = any(v_seen_commands) then
      raise exception 'DUPLICATE_COMMAND_ID_IN_BATCH: %', v_command_id;
    end if;
    v_seen_commands := array_append(v_seen_commands, v_command_id);

    v_scope := nullif(trim(coalesce(v_item ->> 'scope', '')), '');
    if v_scope is null or length(v_scope) > 300 then
      raise exception 'VALID_DAY_STATE_SCOPE_REQUIRED';
    end if;
    if not public.ecoflow_can_write_day_scope(v_scope) then
      raise exception 'DAY_STATE_SCOPE_WRITE_FORBIDDEN: %', v_scope;
    end if;
    if coalesce(v_item ->> 'expectedRevision', '') !~ '^[0-9]+$' then
      raise exception 'EXPECTED_REVISION_REQUIRED: %', v_scope;
    end if;
    v_expected := (v_item ->> 'expectedRevision')::bigint;
    v_payload := v_item -> 'payload';
    if v_payload is null or jsonb_typeof(v_payload) <> 'object' then
      raise exception 'DAY_STATE_PAYLOAD_OBJECT_REQUIRED: %', v_scope;
    end if;
  end loop;

  -- One deterministic advisory lock per scope also protects first inserts, where
  -- SELECT FOR UPDATE has no row to lock.
  for v_scope in
    select distinct nullif(trim(value ->> 'scope'), '')
    from jsonb_array_elements(p_commands)
    order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_day::text || ':' || v_scope, 0));
  end loop;

  -- Preflight the full batch. Any stale scope rejects the whole batch, so route
  -- and shift facts cannot be partially committed.
  for v_item in select value from jsonb_array_elements(p_commands)
  loop
    v_command_id := (v_item ->> 'commandId')::uuid;
    v_scope := trim(v_item ->> 'scope');
    v_expected := (v_item ->> 'expectedRevision')::bigint;
    v_payload := v_item -> 'payload';

    select c.* into v_existing
    from public.ecoflow_day_state_commands c
    where c.command_id = v_command_id;

    if found then
      if v_existing.business_day <> v_day
         or v_existing.scope <> v_scope
         or v_existing.expected_revision <> v_expected
         or v_existing.payload <> v_payload then
        raise exception 'IDEMPOTENCY_KEY_REUSE: %', v_command_id;
      end if;
      continue;
    end if;

    select d.revision, d.payload, d.updated_by, d.updated_at, d.change_seq
      into v_current_revision, v_current_payload, v_current_updated_by,
           v_current_updated_at, v_current_change_seq
    from public.ecoflow_day_state d
    where d.business_day = v_day and d.scope = v_scope
    for update;

    if not found then
      v_current_revision := 0;
      v_current_payload := '{}'::jsonb;
      v_current_updated_by := null;
      v_current_updated_at := null;
      v_current_change_seq := 0;
    end if;

    if v_expected <> v_current_revision then
      v_has_conflict := true;
    end if;
  end loop;

  if v_has_conflict then
    for v_item in select value from jsonb_array_elements(p_commands)
    loop
      v_command_id := (v_item ->> 'commandId')::uuid;
      v_scope := trim(v_item ->> 'scope');
      v_expected := (v_item ->> 'expectedRevision')::bigint;
      v_payload := v_item -> 'payload';

      select c.* into v_existing
      from public.ecoflow_day_state_commands c
      where c.command_id = v_command_id;
      if found then continue; end if;

      select d.revision, d.payload, d.updated_by, d.updated_at, d.change_seq
        into v_current_revision, v_current_payload, v_current_updated_by,
             v_current_updated_at, v_current_change_seq
      from public.ecoflow_day_state d
      where d.business_day = v_day and d.scope = v_scope;

      if not found then
        v_current_revision := 0;
        v_current_payload := '{}'::jsonb;
        v_current_updated_by := null;
        v_current_updated_at := null;
        v_current_change_seq := 0;
      end if;

      if v_expected <> v_current_revision then
        return query select v_command_id, v_day, v_scope, 'CONFLICT'::text,
          v_current_revision, v_current_payload, v_current_updated_by,
          v_current_updated_at, v_current_change_seq;
      end if;
    end loop;
    return;
  end if;

  for v_item in select value from jsonb_array_elements(p_commands)
  loop
    v_command_id := (v_item ->> 'commandId')::uuid;
    v_scope := trim(v_item ->> 'scope');
    v_expected := (v_item ->> 'expectedRevision')::bigint;
    v_payload := v_item -> 'payload';

    select c.* into v_existing
    from public.ecoflow_day_state_commands c
    where c.command_id = v_command_id;

    if found then
      return query select v_existing.command_id, v_existing.business_day,
        v_existing.scope, 'REPLAYED'::text, v_existing.result_revision,
        v_existing.payload, v_existing.result_updated_by,
        v_existing.result_updated_at, v_existing.result_change_seq;
      continue;
    end if;

    if v_expected = 0 then
      insert into public.ecoflow_day_state(
        business_day, scope, payload, updated_by, revision,
        last_command_id, updated_by_user_id
      ) values (
        v_day, v_scope, v_payload, v_actor_label, 1,
        v_command_id, v_actor
      )
      returning ecoflow_day_state.revision, ecoflow_day_state.payload,
                ecoflow_day_state.updated_by, ecoflow_day_state.updated_at,
                ecoflow_day_state.change_seq
      into v_written_revision, v_written_payload, v_written_by,
           v_written_at, v_written_change_seq;
    else
      update public.ecoflow_day_state d
      set payload = v_payload,
          updated_by = v_actor_label,
          updated_by_user_id = v_actor,
          revision = d.revision + 1,
          last_command_id = v_command_id
      where d.business_day = v_day
        and d.scope = v_scope
        and d.revision = v_expected
      returning d.revision, d.payload, d.updated_by, d.updated_at, d.change_seq
      into v_written_revision, v_written_payload, v_written_by,
           v_written_at, v_written_change_seq;

      if not found then
        raise exception 'DAY_STATE_CONFLICT_DURING_APPLY: %', v_scope;
      end if;
    end if;

    insert into public.ecoflow_day_state_commands(
      command_id, business_day, scope, expected_revision, result_revision,
      payload, result_updated_by, result_updated_at, result_change_seq,
      actor_user_id, actor_label
    ) values (
      v_command_id, v_day, v_scope, v_expected, v_written_revision,
      v_written_payload, v_written_by, v_written_at, v_written_change_seq,
      v_actor, v_actor_label
    );

    return query select v_command_id, v_day, v_scope, 'APPLIED'::text,
      v_written_revision, v_written_payload, v_written_by,
      v_written_at, v_written_change_seq;
  end loop;
end;
$$;

grant execute on function public.ecoflow_apply_day_state_commands(date,jsonb,text) to authenticated;
revoke execute on function public.ecoflow_apply_day_state_commands(date,jsonb,text) from anon;

-- Explicit Business Day Close and carry-over records. Closing does not silently
-- mutate the next day; Phase 9/Day Close UI can review and apply these records.
create table if not exists public.ecoflow_business_day_closes (
  business_day date primary key,
  revision bigint not null default 1 check (revision >= 1),
  next_business_day date not null,
  status text not null default 'CLOSED' check (status = 'CLOSED'),
  reason text not null,
  command_id uuid not null unique,
  closed_by uuid not null,
  closed_by_label text,
  closed_at timestamptz not null default clock_timestamp(),
  carry_over_count integer not null default 0 check (carry_over_count >= 0)
);

create table if not exists public.ecoflow_business_day_carry_over (
  id uuid primary key default gen_random_uuid(),
  source_business_day date not null,
  target_business_day date not null,
  source_scope text not null,
  run_code text not null,
  carry_type text not null,
  payload jsonb not null,
  source_revision bigint not null,
  status text not null default 'OPEN' check (status in ('OPEN','APPLIED','DISMISSED')),
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_note text,
  unique(source_business_day, target_business_day, source_scope)
);

create index if not exists idx_ecoflow_business_day_carry_over_target
  on public.ecoflow_business_day_carry_over(target_business_day, status, created_at);

alter table public.ecoflow_business_day_closes enable row level security;
alter table public.ecoflow_business_day_carry_over enable row level security;
revoke insert, update, delete on public.ecoflow_business_day_closes from public, anon, authenticated;
revoke insert, update, delete on public.ecoflow_business_day_carry_over from public, anon, authenticated;
grant select on public.ecoflow_business_day_closes to authenticated;
grant select on public.ecoflow_business_day_carry_over to authenticated;

drop policy if exists ecoflow_business_day_closes_active_read on public.ecoflow_business_day_closes;
create policy ecoflow_business_day_closes_active_read
on public.ecoflow_business_day_closes for select to authenticated
using (public.ecoflow_active_app_role() is not null);

drop policy if exists ecoflow_business_day_carry_over_active_read on public.ecoflow_business_day_carry_over;
create policy ecoflow_business_day_carry_over_active_read
on public.ecoflow_business_day_carry_over for select to authenticated
using (public.ecoflow_active_app_role() is not null);

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
        or (r.local_scope like 'release:%' and nullif(r.payload ->> 'releasedAt', '') is not null)
        or (r.local_scope like 'stop:%' and coalesce(r.payload ->> 'status', 'PENDING') not in ('DELIVERED','FAILED'))
        or (r.local_scope like 'task:%' and coalesce(r.payload ->> 'status', 'PENDING') <> 'PICKED')
        or (r.local_scope like 'alloc:%' and coalesce((r.payload ->> 'done')::boolean, false) = false)
        or (r.local_scope like 'stage:%' and nullif(r.payload ->> 'stagedAt', '') is not null)
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

comment on column public.ecoflow_day_state.revision is
  'Per-scope compare-and-swap token. Unlike change_seq, it increments only for this scope.';
comment on table public.ecoflow_day_state_commands is
  'Idempotency ledger for server-authoritative operational state commands.';
comment on table public.ecoflow_business_day_carry_over is
  'Explicit unresolved operational work captured by Business Day Close; never an inferred next-day mutation.';

commit;
