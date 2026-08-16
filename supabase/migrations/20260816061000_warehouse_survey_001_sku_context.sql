-- WAREHOUSE-SURVEY-001 follow-up: existing-SKU lookup context for field evidence.
--
-- SKU context is descriptive evidence only. This migration does not create or update
-- Commercial SKU authority, Product Identity, barcode mappings, inventory or locations.

alter table public.ecoflow_barcode_survey_observations
  add column if not exists sku_context text,
  add column if not exists sku_product_name text;

alter table public.ecoflow_barcode_survey_observations
  add constraint ecoflow_barcode_survey_sku_context_bounded
    check (sku_context is null or char_length(sku_context) between 1 and 128),
  add constraint ecoflow_barcode_survey_sku_product_name_bounded
    check (sku_product_name is null or char_length(sku_product_name) <= 512);

comment on column public.ecoflow_barcode_survey_observations.sku_context is
  'Validated existing SKU context captured with physical survey evidence; not a SKU-barcode mapping.';
comment on column public.ecoflow_barcode_survey_observations.sku_product_name is
  'Read-only product-name snapshot resolved server-side from the existing SKU read surface.';

create or replace function public.ecoflow_search_barcode_survey_skus_v1(
  p_query text,
  p_limit integer default 12
)
returns table (
  sku text,
  product_name text,
  category text,
  fixed_shelf text,
  primary_barcode text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text := public.ecoflow_active_app_role();
  v_query text := nullif(trim(p_query), '');
  v_limit integer := least(greatest(coalesce(p_limit, 12), 1), 20);
begin
  if v_actor_id is null then
    raise exception 'BARCODE_SURVEY_AUTH_REQUIRED';
  end if;

  if v_actor_role is null or v_actor_role not in ('OWNER', 'ADMIN', 'WAREHOUSE') then
    raise exception 'BARCODE_SURVEY_ROLE_FORBIDDEN';
  end if;

  if v_query is null or char_length(v_query) > 128 then
    return;
  end if;

  return query
  select
    nullif(trim(s.sku), '')::text,
    nullif(trim(s.product_name), '')::text,
    nullif(trim(s.category), '')::text,
    nullif(trim(s.fixed_shelf), '')::text,
    nullif(trim(s.primary_barcode), '')::text
  from public.v_ecoflow_inventory_sku_control as s
  where s.sku is not null
    and left(lower(trim(s.sku)), char_length(v_query)) = lower(v_query)
  order by
    case when lower(trim(s.sku)) = lower(v_query) then 0 else 1 end,
    char_length(trim(s.sku)),
    lower(trim(s.sku)),
    lower(coalesce(s.product_name, ''))
  limit v_limit;
end;
$$;

create or replace function public.ecoflow_record_barcode_survey_observation_v2(
  p_idempotency_key uuid,
  p_sku_context text,
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
  sku_context text,
  sku_product_name text,
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
  v_requested_sku text := nullif(trim(p_sku_context), '');
  v_sku_context text;
  v_sku_product_name text;
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

  if v_requested_sku is not null then
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ecoflow_barcode_survey:' || p_idempotency_key::text, 0)
  );

  v_fingerprint := pg_catalog.md5(
    pg_catalog.jsonb_build_object(
      'skuContext', v_sku_context,
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
    select true, true, 'REPLAYED'::text, v_existing.command_id, v_existing.id,
      v_existing.sku_context, v_existing.sku_product_name,
      v_existing.carton_barcode, v_existing.sleeve_status, v_existing.sleeve_barcode,
      v_existing.occurred_at;
    return;
  end if;

  v_observation_id := gen_random_uuid();
  v_occurred_at := clock_timestamp();

  insert into public.ecoflow_barcode_survey_observations (
    id, command_id, sku_context, sku_product_name, carton_barcode, sleeve_status,
    sleeve_barcode, note, actor_user_id, actor_role, device_id, request_fingerprint, occurred_at
  ) values (
    v_observation_id, p_idempotency_key, v_sku_context, v_sku_product_name,
    v_carton_barcode, v_sleeve_status, v_sleeve_barcode, v_note,
    v_actor_id, v_actor_role, v_device_id, v_fingerprint, v_occurred_at
  );

  return query
  select true, false, 'APPLIED'::text, p_idempotency_key, v_observation_id,
    v_sku_context, v_sku_product_name,
    v_carton_barcode, v_sleeve_status, v_sleeve_barcode, v_occurred_at;
end;
$$;

revoke all on function public.ecoflow_search_barcode_survey_skus_v1(text, integer)
  from public, anon;
revoke all on function public.ecoflow_record_barcode_survey_observation_v2(uuid, text, text, text, text, text, text)
  from public, anon;

grant execute on function public.ecoflow_search_barcode_survey_skus_v1(text, integer)
  to authenticated;
grant execute on function public.ecoflow_record_barcode_survey_observation_v2(uuid, text, text, text, text, text, text)
  to authenticated;
