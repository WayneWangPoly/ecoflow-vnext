-- WAREHOUSE-SURVEY-001: staging-only physical barcode evidence capture.
--
-- This relation is evidence, not inventory authority and not Product Identity
-- publication authority. It deliberately contains no commercial SKU, location,
-- stock quantity or packaging-conversion fields.

create table if not exists public.ecoflow_barcode_survey_observations (
  id uuid primary key default gen_random_uuid(),
  command_id uuid not null unique,
  carton_barcode text not null,
  sleeve_status text not null,
  sleeve_barcode text,
  note text,
  actor_user_id uuid not null,
  actor_role text not null,
  device_id text not null,
  request_fingerprint text not null,
  occurred_at timestamptz not null default clock_timestamp(),
  constraint ecoflow_barcode_survey_carton_bounded
    check (char_length(carton_barcode) between 1 and 128),
  constraint ecoflow_barcode_survey_sleeve_status_valid
    check (sleeve_status in ('SCANNED', 'NO_SEPARATE_BARCODE', 'NOT_CHECKED')),
  constraint ecoflow_barcode_survey_sleeve_bounded
    check (sleeve_barcode is null or char_length(sleeve_barcode) between 1 and 128),
  constraint ecoflow_barcode_survey_sleeve_consistent
    check (
      (sleeve_status = 'SCANNED' and sleeve_barcode is not null)
      or (sleeve_status <> 'SCANNED' and sleeve_barcode is null)
    ),
  constraint ecoflow_barcode_survey_distinct_barcodes
    check (sleeve_barcode is null or sleeve_barcode <> carton_barcode),
  constraint ecoflow_barcode_survey_note_bounded
    check (note is null or char_length(note) <= 2000),
  constraint ecoflow_barcode_survey_role_valid
    check (actor_role in ('OWNER', 'ADMIN', 'WAREHOUSE')),
  constraint ecoflow_barcode_survey_device_bounded
    check (char_length(device_id) between 1 and 128)
);

create index if not exists ecoflow_barcode_survey_observations_occurred_idx
  on public.ecoflow_barcode_survey_observations (occurred_at desc);
create index if not exists ecoflow_barcode_survey_observations_carton_idx
  on public.ecoflow_barcode_survey_observations (carton_barcode, occurred_at desc);

alter table public.ecoflow_barcode_survey_observations enable row level security;

-- Browser clients cannot make staging evidence authoritative by direct DML.
revoke all on table public.ecoflow_barcode_survey_observations
  from public, anon, authenticated;

create or replace function public.ecoflow_record_barcode_survey_observation_v1(
  p_idempotency_key uuid,
  p_carton_barcode text,
  p_sleeve_status text,
  p_sleeve_barcode text,
  p_note text,
  p_device_id text
)
returns table (
  accepted boolean,
  replayed boolean,
  status text,
  command_id uuid,
  observation_id uuid,
  carton_barcode text,
  sleeve_status text,
  sleeve_barcode text,
  occurred_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text := public.ecoflow_active_app_role();
  v_carton_barcode text := nullif(trim(p_carton_barcode), '');
  v_sleeve_status text := upper(nullif(trim(p_sleeve_status), ''));
  v_sleeve_barcode text := nullif(trim(p_sleeve_barcode), '');
  v_note text := nullif(trim(p_note), '');
  v_device_id text := nullif(trim(p_device_id), '');
  v_fingerprint text;
  v_observation_id uuid;
  v_occurred_at timestamptz;
  v_existing public.ecoflow_barcode_survey_observations%rowtype;
begin
  if v_actor_id is null then
    raise exception 'BARCODE_SURVEY_AUTH_REQUIRED';
  end if;

  if v_actor_role is null or v_actor_role not in ('OWNER', 'ADMIN', 'WAREHOUSE') then
    raise exception 'BARCODE_SURVEY_ROLE_FORBIDDEN';
  end if;

  if p_idempotency_key is null then
    raise exception 'BARCODE_SURVEY_IDEMPOTENCY_REQUIRED';
  end if;

  if v_carton_barcode is null or char_length(v_carton_barcode) > 128 then
    raise exception 'BARCODE_SURVEY_CARTON_INVALID';
  end if;

  if v_sleeve_status is null
    or v_sleeve_status not in ('SCANNED', 'NO_SEPARATE_BARCODE', 'NOT_CHECKED') then
    raise exception 'BARCODE_SURVEY_SLEEVE_STATUS_INVALID';
  end if;

  if v_sleeve_status = 'SCANNED' then
    if v_sleeve_barcode is null or char_length(v_sleeve_barcode) > 128 then
      raise exception 'BARCODE_SURVEY_SLEEVE_REQUIRED';
    end if;
    if v_sleeve_barcode = v_carton_barcode then
      raise exception 'BARCODE_SURVEY_SLEEVE_MUST_DIFFER';
    end if;
  elsif v_sleeve_barcode is not null then
    raise exception 'BARCODE_SURVEY_SLEEVE_NOT_ALLOWED';
  end if;

  if v_note is not null and char_length(v_note) > 2000 then
    raise exception 'BARCODE_SURVEY_NOTE_TOO_LONG';
  end if;

  if v_device_id is null or char_length(v_device_id) > 128 then
    raise exception 'BARCODE_SURVEY_DEVICE_INVALID';
  end if;

  -- Serialize duplicate/retry handling for this command UUID.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ecoflow_barcode_survey:' || p_idempotency_key::text, 0)
  );

  v_fingerprint := pg_catalog.md5(
    pg_catalog.jsonb_build_object(
      'cartonBarcode', v_carton_barcode,
      'sleeveStatus', v_sleeve_status,
      'sleeveBarcode', v_sleeve_barcode,
      'note', v_note,
      'deviceId', v_device_id
    )::text
  );

  select o.*
  into v_existing
  from public.ecoflow_barcode_survey_observations as o
  where o.command_id = p_idempotency_key;

  if found then
    if v_existing.actor_user_id <> v_actor_id
      or v_existing.request_fingerprint <> v_fingerprint then
      raise exception 'BARCODE_SURVEY_IDEMPOTENCY_CONFLICT';
    end if;

    return query
    select
      true,
      true,
      'REPLAYED'::text,
      v_existing.command_id,
      v_existing.id,
      v_existing.carton_barcode,
      v_existing.sleeve_status,
      v_existing.sleeve_barcode,
      v_existing.occurred_at;
    return;
  end if;

  v_observation_id := gen_random_uuid();
  v_occurred_at := clock_timestamp();

  insert into public.ecoflow_barcode_survey_observations (
    id,
    command_id,
    carton_barcode,
    sleeve_status,
    sleeve_barcode,
    note,
    actor_user_id,
    actor_role,
    device_id,
    request_fingerprint,
    occurred_at
  ) values (
    v_observation_id,
    p_idempotency_key,
    v_carton_barcode,
    v_sleeve_status,
    v_sleeve_barcode,
    v_note,
    v_actor_id,
    v_actor_role,
    v_device_id,
    v_fingerprint,
    v_occurred_at
  );

  return query
  select
    true,
    false,
    'APPLIED'::text,
    p_idempotency_key,
    v_observation_id,
    v_carton_barcode,
    v_sleeve_status,
    v_sleeve_barcode,
    v_occurred_at;
end;
$$;

create or replace function public.ecoflow_recover_barcode_survey_observation_v1(
  p_idempotency_key uuid
)
returns table (
  accepted boolean,
  replayed boolean,
  status text,
  command_id uuid,
  observation_id uuid,
  carton_barcode text,
  sleeve_status text,
  sleeve_barcode text,
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
    raise exception 'BARCODE_SURVEY_AUTH_REQUIRED';
  end if;

  if v_actor_role is null or v_actor_role not in ('OWNER', 'ADMIN', 'WAREHOUSE') then
    raise exception 'BARCODE_SURVEY_ROLE_FORBIDDEN';
  end if;

  if p_idempotency_key is null then
    raise exception 'BARCODE_SURVEY_IDEMPOTENCY_REQUIRED';
  end if;

  return query
  select
    true,
    true,
    'REPLAYED'::text,
    o.command_id,
    o.id,
    o.carton_barcode,
    o.sleeve_status,
    o.sleeve_barcode,
    o.occurred_at
  from public.ecoflow_barcode_survey_observations as o
  where o.command_id = p_idempotency_key
    and o.actor_user_id = v_actor_id;
end;
$$;

revoke all on function public.ecoflow_record_barcode_survey_observation_v1(uuid, text, text, text, text, text)
  from public, anon;
revoke all on function public.ecoflow_recover_barcode_survey_observation_v1(uuid)
  from public, anon;

grant execute on function public.ecoflow_record_barcode_survey_observation_v1(uuid, text, text, text, text, text)
  to authenticated;
grant execute on function public.ecoflow_recover_barcode_survey_observation_v1(uuid)
  to authenticated;
