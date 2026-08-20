-- WAREHOUSE-SURVEY-001: smart packaging evidence reuse for field survey.
--
-- This remains staging-only physical evidence. It does not publish barcode mappings,
-- mutate Commercial SKU or Product Identity authority, change inventory, stocktake,
-- movement, location, quantity or package conversion state, or infer packaging from
-- external data. Historical evidence is reusable only for the exact server-validated
-- SKU + exact carton barcode and only when trusted physical observations agree.

alter table public.ecoflow_barcode_survey_observations
  add column if not exists evidence_source text,
  add column if not exists source_observation_id uuid;

-- Existing survey rows with a positive sleeve determination were physically captured
-- under the original survey contract. NOT_CHECKED remains explicitly non-verifying.
update public.ecoflow_barcode_survey_observations
set evidence_source = case
  when sleeve_status in ('SCANNED', 'NO_SEPARATE_BARCODE') then 'OBSERVED_NOW'
  else 'LEGACY_NOT_CHECKED'
end
where evidence_source is null;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'ecoflow_barcode_survey_evidence_source_valid'
      and conrelid = 'public.ecoflow_barcode_survey_observations'::regclass
  ) then
    alter table public.ecoflow_barcode_survey_observations
      add constraint ecoflow_barcode_survey_evidence_source_valid
      check (
        evidence_source is null
        or evidence_source in (
          'OBSERVED_NOW',
          'REUSED_EXACT_PACKAGE',
          'DEFERRED_INACCESSIBLE',
          'DEFERRED_OPENING_REQUIRED',
          'LEGACY_NOT_CHECKED'
        )
      );
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'ecoflow_barcode_survey_evidence_source_consistent'
      and conrelid = 'public.ecoflow_barcode_survey_observations'::regclass
  ) then
    alter table public.ecoflow_barcode_survey_observations
      add constraint ecoflow_barcode_survey_evidence_source_consistent
      check (
        evidence_source is null
        or (
          evidence_source = 'OBSERVED_NOW'
          and sleeve_status in ('SCANNED', 'NO_SEPARATE_BARCODE')
          and source_observation_id is null
        )
        or (
          evidence_source = 'REUSED_EXACT_PACKAGE'
          and sleeve_status in ('SCANNED', 'NO_SEPARATE_BARCODE')
          and source_observation_id is not null
        )
        or (
          evidence_source in ('DEFERRED_INACCESSIBLE', 'DEFERRED_OPENING_REQUIRED', 'LEGACY_NOT_CHECKED')
          and sleeve_status = 'NOT_CHECKED'
          and sleeve_barcode is null
          and source_observation_id is null
        )
      );
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'ecoflow_barcode_survey_source_observation_fk'
      and conrelid = 'public.ecoflow_barcode_survey_observations'::regclass
  ) then
    alter table public.ecoflow_barcode_survey_observations
      add constraint ecoflow_barcode_survey_source_observation_fk
      foreign key (source_observation_id)
      references public.ecoflow_barcode_survey_observations(id)
      on delete restrict;
  end if;
end
$$;

create index if not exists ecoflow_barcode_survey_exact_physical_idx
  on public.ecoflow_barcode_survey_observations (sku_context, carton_barcode, occurred_at desc)
  where evidence_source = 'OBSERVED_NOW';

create index if not exists ecoflow_barcode_survey_source_observation_idx
  on public.ecoflow_barcode_survey_observations (source_observation_id)
  where source_observation_id is not null;

comment on column public.ecoflow_barcode_survey_observations.evidence_source is
  'Survey provenance only. OBSERVED_NOW is direct physical evidence; REUSED_EXACT_PACKAGE references a matching direct observation; deferred states are not verification.';
comment on column public.ecoflow_barcode_survey_observations.source_observation_id is
  'Original direct physical observation used by REUSED_EXACT_PACKAGE. Never denotes a new physical scan.';

create or replace function public.ecoflow_get_barcode_survey_packaging_evidence_v1(
  p_sku_context text,
  p_carton_barcode text
)
returns table (
  status text,
  sku_context text,
  carton_barcode text,
  sleeve_barcode text,
  source_observation_id uuid,
  source_occurred_at timestamptz,
  physical_observation_count bigint
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text := public.ecoflow_active_app_role();
  v_requested_sku text := nullif(trim(p_sku_context), '');
  v_sku_context text;
  v_carton_barcode text := nullif(trim(p_carton_barcode), '');
  v_physical_count bigint := 0;
  v_signature_count bigint := 0;
  v_source_observation_id uuid;
  v_source_occurred_at timestamptz;
  v_source_sleeve_status text;
  v_source_sleeve_barcode text;
begin
  if v_actor_id is null then
    raise exception 'BARCODE_SURVEY_AUTH_REQUIRED';
  end if;

  if v_actor_role is null or v_actor_role not in ('OWNER', 'ADMIN', 'WAREHOUSE') then
    raise exception 'BARCODE_SURVEY_ROLE_FORBIDDEN';
  end if;

  if v_requested_sku is null or char_length(v_requested_sku) > 128 then
    raise exception 'BARCODE_SURVEY_SKU_REQUIRED';
  end if;

  select nullif(trim(s.sku), '')
    into v_sku_context
  from public.v_ecoflow_inventory_sku_control as s
  where s.sku is not null
    and lower(trim(s.sku)) = lower(v_requested_sku)
  order by lower(coalesce(s.product_name, ''))
  limit 1;

  if v_sku_context is null then
    raise exception 'BARCODE_SURVEY_SKU_UNKNOWN';
  end if;

  if v_carton_barcode is null or char_length(v_carton_barcode) > 128 then
    raise exception 'BARCODE_SURVEY_CARTON_INVALID';
  end if;

  select
    count(*),
    count(distinct case
      when o.sleeve_status = 'SCANNED' then 'SCANNED:' || o.sleeve_barcode
      when o.sleeve_status = 'NO_SEPARATE_BARCODE' then 'NO_SEPARATE_BARCODE'
      else null
    end)
  into v_physical_count, v_signature_count
  from public.ecoflow_barcode_survey_observations as o
  where o.sku_context = v_sku_context
    and o.carton_barcode = v_carton_barcode
    and o.evidence_source = 'OBSERVED_NOW'
    and o.sleeve_status in ('SCANNED', 'NO_SEPARATE_BARCODE');

  if v_physical_count = 0 then
    return query select
      'UNVERIFIED'::text,
      v_sku_context,
      v_carton_barcode,
      null::text,
      null::uuid,
      null::timestamptz,
      v_physical_count;
    return;
  end if;

  if v_signature_count <> 1 then
    return query select
      'CONFLICT'::text,
      v_sku_context,
      v_carton_barcode,
      null::text,
      null::uuid,
      null::timestamptz,
      v_physical_count;
    return;
  end if;

  select o.id, o.occurred_at, o.sleeve_status, o.sleeve_barcode
    into v_source_observation_id, v_source_occurred_at, v_source_sleeve_status, v_source_sleeve_barcode
  from public.ecoflow_barcode_survey_observations as o
  where o.sku_context = v_sku_context
    and o.carton_barcode = v_carton_barcode
    and o.evidence_source = 'OBSERVED_NOW'
    and o.sleeve_status in ('SCANNED', 'NO_SEPARATE_BARCODE')
  order by o.occurred_at desc, o.id desc
  limit 1;

  return query select
    case
      when v_source_sleeve_status = 'SCANNED' then 'VERIFIED_SCANNED'::text
      else 'VERIFIED_NO_SEPARATE_BARCODE'::text
    end,
    v_sku_context,
    v_carton_barcode,
    v_source_sleeve_barcode,
    v_source_observation_id,
    v_source_occurred_at,
    v_physical_count;
end;
$$;

create or replace function public.ecoflow_record_barcode_survey_observation_v3(
  p_idempotency_key uuid,
  p_sku_context text,
  p_carton_barcode text,
  p_capture_mode text,
  p_sleeve_status text,
  p_sleeve_barcode text,
  p_source_observation_id uuid,
  p_note text,
  p_device_id text
)
returns table (
  accepted boolean,
  replayed boolean,
  status text,
  command_id uuid,
  observation_id uuid,
  sku_context text,
  sku_product_name text,
  carton_barcode text,
  sleeve_status text,
  sleeve_barcode text,
  evidence_source text,
  source_observation_id uuid,
  occurred_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text := public.ecoflow_active_app_role();
  v_requested_sku text := nullif(trim(p_sku_context), '');
  v_sku_context text;
  v_sku_product_name text;
  v_carton_barcode text := nullif(trim(p_carton_barcode), '');
  v_capture_mode text := upper(nullif(trim(p_capture_mode), ''));
  v_requested_sleeve_status text := upper(nullif(trim(p_sleeve_status), ''));
  v_requested_sleeve_barcode text := nullif(trim(p_sleeve_barcode), '');
  v_sleeve_status text;
  v_sleeve_barcode text;
  v_source_observation_id uuid := p_source_observation_id;
  v_note text := nullif(trim(p_note), '');
  v_device_id text := nullif(trim(p_device_id), '');
  v_fingerprint text;
  v_evidence_status text;
  v_observation_id uuid;
  v_occurred_at timestamptz;
  v_existing public.ecoflow_barcode_survey_observations%rowtype;
  v_source public.ecoflow_barcode_survey_observations%rowtype;
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

  if v_requested_sku is null or char_length(v_requested_sku) > 128 then
    raise exception 'BARCODE_SURVEY_SKU_REQUIRED';
  end if;

  select nullif(trim(s.sku), ''), nullif(trim(s.product_name), '')
    into v_sku_context, v_sku_product_name
  from public.v_ecoflow_inventory_sku_control as s
  where s.sku is not null
    and lower(trim(s.sku)) = lower(v_requested_sku)
  order by lower(coalesce(s.product_name, ''))
  limit 1;

  if v_sku_context is null then
    raise exception 'BARCODE_SURVEY_SKU_UNKNOWN';
  end if;

  if v_carton_barcode is null or char_length(v_carton_barcode) > 128 then
    raise exception 'BARCODE_SURVEY_CARTON_INVALID';
  end if;

  if v_capture_mode is null or v_capture_mode not in (
    'OBSERVED_NOW',
    'REUSED_EXACT_PACKAGE',
    'DEFERRED_INACCESSIBLE',
    'DEFERRED_OPENING_REQUIRED'
  ) then
    raise exception 'BARCODE_SURVEY_CAPTURE_MODE_INVALID';
  end if;

  if v_capture_mode = 'OBSERVED_NOW' then
    if v_source_observation_id is not null then
      raise exception 'BARCODE_SURVEY_OBSERVED_SOURCE_NOT_ALLOWED';
    end if;

    if v_requested_sleeve_status is null
      or v_requested_sleeve_status not in ('SCANNED', 'NO_SEPARATE_BARCODE') then
      raise exception 'BARCODE_SURVEY_OBSERVED_SLEEVE_STATUS_INVALID';
    end if;

    v_sleeve_status := v_requested_sleeve_status;
    v_sleeve_barcode := v_requested_sleeve_barcode;

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
  elsif v_capture_mode = 'REUSED_EXACT_PACKAGE' then
    if v_source_observation_id is null then
      raise exception 'BARCODE_SURVEY_REUSE_SOURCE_REQUIRED';
    end if;
    if v_requested_sleeve_status is not null or v_requested_sleeve_barcode is not null then
      raise exception 'BARCODE_SURVEY_REUSE_DERIVES_SLEEVE';
    end if;

    select o.*
      into v_source
    from public.ecoflow_barcode_survey_observations as o
    where o.id = v_source_observation_id;

    if not found
      or v_source.evidence_source <> 'OBSERVED_NOW'
      or v_source.sku_context is distinct from v_sku_context
      or v_source.carton_barcode is distinct from v_carton_barcode
      or v_source.sleeve_status not in ('SCANNED', 'NO_SEPARATE_BARCODE') then
      raise exception 'BARCODE_SURVEY_REUSE_SOURCE_MISMATCH';
    end if;

    select e.status
      into v_evidence_status
    from public.ecoflow_get_barcode_survey_packaging_evidence_v1(
      v_sku_context,
      v_carton_barcode
    ) as e;

    if v_evidence_status = 'CONFLICT' then
      raise exception 'BARCODE_SURVEY_EVIDENCE_CONFLICT';
    end if;
    if v_evidence_status not in ('VERIFIED_SCANNED', 'VERIFIED_NO_SEPARATE_BARCODE') then
      raise exception 'BARCODE_SURVEY_REUSE_SOURCE_UNVERIFIED';
    end if;

    v_sleeve_status := v_source.sleeve_status;
    v_sleeve_barcode := v_source.sleeve_barcode;
  else
    if v_source_observation_id is not null
      or v_requested_sleeve_status is not null
      or v_requested_sleeve_barcode is not null then
      raise exception 'BARCODE_SURVEY_DEFER_DERIVES_SLEEVE';
    end if;
    v_sleeve_status := 'NOT_CHECKED';
    v_sleeve_barcode := null;
  end if;

  if v_note is not null and char_length(v_note) > 2000 then
    raise exception 'BARCODE_SURVEY_NOTE_TOO_LONG';
  end if;

  if v_device_id is null or char_length(v_device_id) > 128 then
    raise exception 'BARCODE_SURVEY_DEVICE_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ecoflow_barcode_survey:' || p_idempotency_key::text, 0)
  );

  v_fingerprint := pg_catalog.md5(
    pg_catalog.jsonb_build_object(
      'skuContext', v_sku_context,
      'cartonBarcode', v_carton_barcode,
      'captureMode', v_capture_mode,
      'sleeveStatus', v_sleeve_status,
      'sleeveBarcode', v_sleeve_barcode,
      'sourceObservationId', v_source_observation_id,
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
    select true, true, 'REPLAYED'::text, v_existing.command_id, v_existing.id,
      v_existing.sku_context, v_existing.sku_product_name,
      v_existing.carton_barcode, v_existing.sleeve_status, v_existing.sleeve_barcode,
      v_existing.evidence_source, v_existing.source_observation_id, v_existing.occurred_at;
    return;
  end if;

  v_observation_id := gen_random_uuid();
  v_occurred_at := clock_timestamp();

  insert into public.ecoflow_barcode_survey_observations (
    id, command_id, sku_context, sku_product_name, carton_barcode, sleeve_status,
    sleeve_barcode, evidence_source, source_observation_id, note,
    actor_user_id, actor_role, device_id, request_fingerprint, occurred_at
  ) values (
    v_observation_id, p_idempotency_key, v_sku_context, v_sku_product_name,
    v_carton_barcode, v_sleeve_status, v_sleeve_barcode, v_capture_mode,
    v_source_observation_id, v_note, v_actor_id, v_actor_role, v_device_id,
    v_fingerprint, v_occurred_at
  );

  return query
  select true, false, 'APPLIED'::text, p_idempotency_key, v_observation_id,
    v_sku_context, v_sku_product_name,
    v_carton_barcode, v_sleeve_status, v_sleeve_barcode,
    v_capture_mode, v_source_observation_id, v_occurred_at;
end;
$$;

revoke all on function public.ecoflow_get_barcode_survey_packaging_evidence_v1(text, text)
  from public, anon;
revoke all on function public.ecoflow_record_barcode_survey_observation_v3(uuid, text, text, text, text, text, uuid, text, text)
  from public, anon;

grant execute on function public.ecoflow_get_barcode_survey_packaging_evidence_v1(text, text)
  to authenticated;
grant execute on function public.ecoflow_record_barcode_survey_observation_v3(uuid, text, text, text, text, text, uuid, text, text)
  to authenticated;
