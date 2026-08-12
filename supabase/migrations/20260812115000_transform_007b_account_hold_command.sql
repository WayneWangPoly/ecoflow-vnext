-- TRANSFORM-007B: authoritative Accounts hold/release command.
--
-- Contract:
--   * the existing ecoflow_account_release_holds relation remains the sole
--     operational authority consumed by Orders;
--   * browser clients mutate that authority only through the command RPC;
--   * compare-and-set revision + UUID idempotency fail closed;
--   * actor identity is derived from auth.uid(), never accepted from clients;
--   * every accepted command records an immutable before/after audit event;
--   * release is a durable inactive state (never a row delete), preserving CAS.

alter table public.ecoflow_account_release_holds
  add column if not exists revision bigint;

update public.ecoflow_account_release_holds
set revision = 1
where revision is null;

alter table public.ecoflow_account_release_holds
  alter column revision set default 1,
  alter column revision set not null;

alter table public.ecoflow_account_release_holds
  drop constraint if exists ecoflow_account_release_holds_revision_nonnegative;

alter table public.ecoflow_account_release_holds
  add constraint ecoflow_account_release_holds_revision_nonnegative
  check (revision >= 0);

create table if not exists public.ecoflow_account_hold_commands (
  command_id uuid primary key,
  store_id text not null,
  target_active boolean not null,
  expected_revision bigint not null check (expected_revision >= 0),
  result_revision bigint not null check (result_revision > expected_revision),
  actor_user_id uuid not null,
  actor_role text not null check (actor_role in ('OWNER', 'ADMIN', 'ACCOUNT')),
  device_id text not null,
  reason text not null,
  request_fingerprint text not null,
  before_state jsonb not null,
  after_state jsonb not null,
  occurred_at timestamptz not null default clock_timestamp(),
  constraint ecoflow_account_hold_commands_device_bounded
    check (char_length(device_id) between 1 and 128),
  constraint ecoflow_account_hold_commands_reason_bounded
    check (char_length(reason) between 1 and 500)
);

create index if not exists ecoflow_account_hold_commands_store_occurred_idx
  on public.ecoflow_account_hold_commands (store_id, occurred_at desc);

alter table public.ecoflow_account_hold_commands enable row level security;

-- 007B closes the legacy direct-browser mutation path. The authenticated read
-- policy remains intact so existing read projections are not widened or broken.
drop policy if exists "account release holds write insert"
  on public.ecoflow_account_release_holds;
drop policy if exists "account release holds write update"
  on public.ecoflow_account_release_holds;
drop policy if exists "account release holds write delete"
  on public.ecoflow_account_release_holds;

revoke insert, update, delete
  on table public.ecoflow_account_release_holds
  from public, anon, authenticated;

revoke all
  on table public.ecoflow_account_hold_commands
  from public, anon, authenticated;

create or replace function public.ecoflow_read_account_hold_state_v1(
  p_store_id text
)
returns table (
  store_id text,
  active boolean,
  revision bigint,
  hold_reason text,
  source_action_id uuid,
  updated_by uuid,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text := public.ecoflow_active_app_role();
  v_store_id text := nullif(trim(p_store_id), '');
begin
  if v_actor_id is null then
    raise exception 'ACCOUNT_HOLD_AUTH_REQUIRED';
  end if;

  if v_actor_role is null or v_actor_role not in ('OWNER', 'ADMIN', 'ACCOUNT') then
    raise exception 'ACCOUNT_HOLD_ROLE_FORBIDDEN';
  end if;

  if v_store_id is null or char_length(v_store_id) > 160 then
    raise exception 'ACCOUNT_HOLD_STORE_INVALID';
  end if;

  if not exists (
    select 1
    from public.ordermentum_stores as s
    where nullif(trim(s.store_id), '') = v_store_id
  ) then
    raise exception 'ACCOUNT_HOLD_STORE_NOT_FOUND';
  end if;

  return query
  select
    v_store_id,
    coalesce(h.active, false),
    coalesce(h.revision, 0::bigint),
    h.hold_reason,
    h.source_action_id,
    h.updated_by,
    h.updated_at
  from (values (1)) as singleton(n)
  left join public.ecoflow_account_release_holds as h
    on h.store_id = v_store_id;
end;
$$;

create or replace function public.ecoflow_set_account_release_hold_v1(
  p_store_id text,
  p_target_active boolean,
  p_expected_revision bigint,
  p_idempotency_key uuid,
  p_device_id text,
  p_reason text
)
returns table (
  accepted boolean,
  replayed boolean,
  status text,
  command_id uuid,
  store_id text,
  active boolean,
  revision bigint,
  hold_reason text,
  source_action_id uuid,
  updated_by uuid,
  updated_at timestamptz,
  occurred_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text := public.ecoflow_active_app_role();
  v_store_id text := nullif(trim(p_store_id), '');
  v_device_id text := nullif(trim(p_device_id), '');
  v_reason text := nullif(trim(p_reason), '');
  v_fingerprint text;
  v_current_active boolean := false;
  v_current_revision bigint := 0;
  v_current_reason text;
  v_current_source_action_id uuid;
  v_current_updated_by uuid;
  v_current_updated_at timestamptz;
  v_next_revision bigint;
  v_applied_at timestamptz;
  v_before jsonb;
  v_after jsonb;
  v_existing public.ecoflow_account_hold_commands%rowtype;
begin
  if v_actor_id is null then
    raise exception 'ACCOUNT_HOLD_AUTH_REQUIRED';
  end if;

  if v_actor_role is null or v_actor_role not in ('OWNER', 'ADMIN', 'ACCOUNT') then
    raise exception 'ACCOUNT_HOLD_ROLE_FORBIDDEN';
  end if;

  if v_store_id is null or char_length(v_store_id) > 160 then
    raise exception 'ACCOUNT_HOLD_STORE_INVALID';
  end if;

  if p_target_active is null then
    raise exception 'ACCOUNT_HOLD_TARGET_REQUIRED';
  end if;

  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'ACCOUNT_HOLD_REVISION_INVALID';
  end if;

  if p_idempotency_key is null then
    raise exception 'ACCOUNT_HOLD_IDEMPOTENCY_REQUIRED';
  end if;

  if v_device_id is null or char_length(v_device_id) > 128 then
    raise exception 'ACCOUNT_HOLD_DEVICE_INVALID';
  end if;

  if v_reason is null or char_length(v_reason) > 500 then
    raise exception 'ACCOUNT_HOLD_REASON_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.ordermentum_stores as s
    where nullif(trim(s.store_id), '') = v_store_id
  ) then
    raise exception 'ACCOUNT_HOLD_STORE_NOT_FOUND';
  end if;

  -- Serialize all intents for one store before checking idempotency/CAS.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ecoflow_account_hold:' || v_store_id, 0)
  );

  v_fingerprint := pg_catalog.md5(
    pg_catalog.jsonb_build_object(
      'storeId', v_store_id,
      'targetActive', p_target_active,
      'expectedRevision', p_expected_revision,
      'deviceId', v_device_id,
      'reason', v_reason
    )::text
  );

  select c.*
  into v_existing
  from public.ecoflow_account_hold_commands as c
  where c.command_id = p_idempotency_key;

  if found then
    if v_existing.actor_user_id <> v_actor_id
      or v_existing.request_fingerprint <> v_fingerprint then
      raise exception 'ACCOUNT_HOLD_IDEMPOTENCY_CONFLICT';
    end if;

    return query
    select
      true,
      true,
      'REPLAYED'::text,
      v_existing.command_id,
      v_existing.store_id,
      coalesce((v_existing.after_state ->> 'active')::boolean, false),
      v_existing.result_revision,
      nullif(v_existing.after_state ->> 'holdReason', ''),
      nullif(v_existing.after_state ->> 'sourceActionId', '')::uuid,
      nullif(v_existing.after_state ->> 'updatedBy', '')::uuid,
      nullif(v_existing.after_state ->> 'updatedAt', '')::timestamptz,
      v_existing.occurred_at;
    return;
  end if;

  select
    h.active,
    h.revision,
    h.hold_reason,
    h.source_action_id,
    h.updated_by,
    h.updated_at
  into
    v_current_active,
    v_current_revision,
    v_current_reason,
    v_current_source_action_id,
    v_current_updated_by,
    v_current_updated_at
  from public.ecoflow_account_release_holds as h
  where h.store_id = v_store_id;

  if not found then
    v_current_active := false;
    v_current_revision := 0;
    v_current_reason := null;
    v_current_source_action_id := null;
    v_current_updated_by := null;
    v_current_updated_at := null;
  end if;

  if v_current_revision <> p_expected_revision then
    return query
    select
      false,
      false,
      'CONFLICT'::text,
      p_idempotency_key,
      v_store_id,
      v_current_active,
      v_current_revision,
      v_current_reason,
      v_current_source_action_id,
      v_current_updated_by,
      v_current_updated_at,
      null::timestamptz;
    return;
  end if;

  v_next_revision := v_current_revision + 1;
  v_applied_at := clock_timestamp();

  v_before := pg_catalog.jsonb_build_object(
    'storeId', v_store_id,
    'active', v_current_active,
    'revision', v_current_revision,
    'holdReason', v_current_reason,
    'sourceActionId', v_current_source_action_id,
    'updatedBy', v_current_updated_by,
    'updatedAt', v_current_updated_at
  );

  insert into public.ecoflow_account_release_holds as h (
    store_id,
    active,
    hold_reason,
    source_action_id,
    updated_by,
    updated_at,
    revision
  ) values (
    v_store_id,
    p_target_active,
    v_reason,
    p_idempotency_key,
    v_actor_id,
    v_applied_at,
    v_next_revision
  )
  on conflict on constraint ecoflow_account_release_holds_pkey do update
  set active = excluded.active,
      hold_reason = excluded.hold_reason,
      source_action_id = excluded.source_action_id,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at,
      revision = excluded.revision;

  v_after := pg_catalog.jsonb_build_object(
    'storeId', v_store_id,
    'active', p_target_active,
    'revision', v_next_revision,
    'holdReason', v_reason,
    'sourceActionId', p_idempotency_key,
    'updatedBy', v_actor_id,
    'updatedAt', v_applied_at
  );

  insert into public.ecoflow_account_hold_commands (
    command_id,
    store_id,
    target_active,
    expected_revision,
    result_revision,
    actor_user_id,
    actor_role,
    device_id,
    reason,
    request_fingerprint,
    before_state,
    after_state,
    occurred_at
  ) values (
    p_idempotency_key,
    v_store_id,
    p_target_active,
    p_expected_revision,
    v_next_revision,
    v_actor_id,
    v_actor_role,
    v_device_id,
    v_reason,
    v_fingerprint,
    v_before,
    v_after,
    v_applied_at
  );

  return query
  select
    true,
    false,
    'APPLIED'::text,
    p_idempotency_key,
    v_store_id,
    p_target_active,
    v_next_revision,
    v_reason,
    p_idempotency_key,
    v_actor_id,
    v_applied_at,
    v_applied_at;
end;
$$;

create or replace function public.ecoflow_recover_account_hold_command_v1(
  p_idempotency_key uuid
)
returns table (
  accepted boolean,
  replayed boolean,
  status text,
  command_id uuid,
  store_id text,
  active boolean,
  revision bigint,
  hold_reason text,
  source_action_id uuid,
  updated_by uuid,
  updated_at timestamptz,
  occurred_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text := public.ecoflow_active_app_role();
begin
  if v_actor_id is null then
    raise exception 'ACCOUNT_HOLD_AUTH_REQUIRED';
  end if;

  if v_actor_role is null or v_actor_role not in ('OWNER', 'ADMIN', 'ACCOUNT') then
    raise exception 'ACCOUNT_HOLD_ROLE_FORBIDDEN';
  end if;

  if p_idempotency_key is null then
    raise exception 'ACCOUNT_HOLD_IDEMPOTENCY_REQUIRED';
  end if;

  return query
  select
    true,
    true,
    'REPLAYED'::text,
    c.command_id,
    c.store_id,
    coalesce((c.after_state ->> 'active')::boolean, false),
    c.result_revision,
    nullif(c.after_state ->> 'holdReason', ''),
    nullif(c.after_state ->> 'sourceActionId', '')::uuid,
    nullif(c.after_state ->> 'updatedBy', '')::uuid,
    nullif(c.after_state ->> 'updatedAt', '')::timestamptz,
    c.occurred_at
  from public.ecoflow_account_hold_commands as c
  where c.command_id = p_idempotency_key
    and c.actor_user_id = v_actor_id;
end;
$$;

-- Preserve legacy statement recording but make hold/release impossible through
-- the old weak mutation path. Existing statement-only callers remain valid.
create or replace function public.ecoflow_record_accounts_statement_action(
  p_store_id text,
  p_action_kind text,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  id uuid,
  store_id text,
  action_kind text,
  action_metadata jsonb,
  created_at timestamptz
)
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text := public.ecoflow_active_app_role();
  v_store_id text := nullif(trim(p_store_id), '');
  v_action_kind text := upper(nullif(trim(p_action_kind), ''));
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_id uuid;
  v_created_at timestamptz;
begin
  if v_actor_id is null then
    raise exception 'ACCOUNTS_STATEMENT_AUTH_REQUIRED';
  end if;

  if v_actor_role is null or v_actor_role not in ('OWNER', 'ADMIN', 'ACCOUNT') then
    raise exception 'ACCOUNTS_STATEMENT_ROLE_FORBIDDEN';
  end if;

  if v_store_id is null or char_length(v_store_id) > 160 then
    raise exception 'ACCOUNTS_STATEMENT_STORE_INVALID';
  end if;

  if v_action_kind in ('RELEASE_HOLD', 'APPLY_HOLD') then
    raise exception 'ACCOUNT_HOLD_COMMAND_REQUIRED';
  end if;

  if v_action_kind not in ('STATEMENT_VIEWED', 'STATEMENT_DOWNLOADED', 'STATEMENT_SENT') then
    raise exception 'ACCOUNTS_STATEMENT_ACTION_INVALID';
  end if;

  if not exists (
    select 1
    from public.ordermentum_stores as s
    where nullif(trim(s.store_id), '') = v_store_id
  ) then
    raise exception 'ACCOUNTS_STATEMENT_STORE_NOT_FOUND';
  end if;

  insert into public.ecoflow_account_statement_actions (
    store_id,
    action_kind,
    action_metadata,
    created_by
  ) values (
    v_store_id,
    v_action_kind,
    v_metadata,
    v_actor_id
  )
  returning
    ecoflow_account_statement_actions.id,
    ecoflow_account_statement_actions.created_at
  into v_id, v_created_at;

  return query
  select v_id, v_store_id, v_action_kind, v_metadata, v_created_at;
end;
$$;

revoke all on function public.ecoflow_read_account_hold_state_v1(text)
  from public, anon;
revoke all on function public.ecoflow_set_account_release_hold_v1(text, boolean, bigint, uuid, text, text)
  from public, anon;
revoke all on function public.ecoflow_recover_account_hold_command_v1(uuid)
  from public, anon;

grant execute on function public.ecoflow_read_account_hold_state_v1(text)
  to authenticated;
grant execute on function public.ecoflow_set_account_release_hold_v1(text, boolean, bigint, uuid, text, text)
  to authenticated;
grant execute on function public.ecoflow_recover_account_hold_command_v1(uuid)
  to authenticated;
