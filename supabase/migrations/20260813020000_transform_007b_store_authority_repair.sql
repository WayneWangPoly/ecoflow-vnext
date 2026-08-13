-- TRANSFORM-007B production repair: validate Accounts commands against the
-- actual operational store master.
--
-- Production release verification proved public.ordermentum_stores does not
-- exist. The canonical Accounts/customer store_id is
-- public.ecoflow_store_sites.retailer_id::text, projected from the Ordermentum
-- purchaser master. Recreate only the three 007B functions that retained the
-- stale relation. CAS, idempotency, audit, role, device and action contracts are
-- otherwise unchanged.

begin;

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
    from public.ecoflow_store_sites as s
    where s.retailer_id::text = v_store_id
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
    from public.ecoflow_store_sites as s
    where s.retailer_id::text = v_store_id
  ) then
    raise exception 'ACCOUNT_HOLD_STORE_NOT_FOUND';
  end if;

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
    from public.ecoflow_store_sites as s
    where s.retailer_id::text = v_store_id
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

-- Reassert the intended browser execution boundary without broadening table DML.
revoke all on function public.ecoflow_read_account_hold_state_v1(text)
  from public, anon;
revoke all on function public.ecoflow_set_account_release_hold_v1(text, boolean, bigint, uuid, text, text)
  from public, anon;

grant execute on function public.ecoflow_read_account_hold_state_v1(text)
  to authenticated;
grant execute on function public.ecoflow_set_account_release_hold_v1(text, boolean, bigint, uuid, text, text)
  to authenticated;

comment on function public.ecoflow_read_account_hold_state_v1(text) is
  'TRANSFORM-007B authoritative hold state read; store existence is validated against ecoflow_store_sites.retailer_id.';
comment on function public.ecoflow_set_account_release_hold_v1(text, boolean, bigint, uuid, text, text) is
  'TRANSFORM-007B CAS/idempotent hold command; store existence is validated against ecoflow_store_sites.retailer_id.';

notify pgrst, 'reload schema';
commit;
