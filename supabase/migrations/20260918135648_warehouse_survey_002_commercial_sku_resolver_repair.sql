-- ECOFLOW-328-BATCH-NEXT-DRAFT-R1:
-- repair Barcode Survey packaging-evidence SKU resolution so canonical Commercial
-- SKUs do not depend on the narrower inventory-control projection.
--
-- Safety boundary:
--   * function-only authority repair;
--   * no Product Identity START/RECONCILE/SUBMIT/PUBLISH is executed here;
--   * no barcode reassignment;
--   * no inventory, stocktake, location, receiving, pick, delivery or quantity mutation;
--   * exact physical Survey evidence requirements remain unchanged.

begin;

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
  v_match_count bigint := 0;
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

  -- Prefer canonical Commercial SKU authority plus active Ordermentum aliases.
  -- This fixes false SKU_UNKNOWN for valid Commercial SKUs that have not yet
  -- reached the narrower inventory-control projection.
  with candidates as (
    select
      s.id as commercial_sku_id,
      nullif(trim(s.sku_code), '') as resolved_context,
      0 as source_priority
    from public.skus s
    where s.sku_code is not null
      and lower(trim(s.sku_code)) = lower(v_requested_sku)

    union all

    select
      s.id as commercial_sku_id,
      nullif(trim(m.external_product_code), '') as resolved_context,
      1 as source_priority
    from public.external_product_mappings m
    join public.skus s on s.id = m.internal_sku_id
    where m.provider = 'ORDERMENTUM'
      and m.is_active
      and m.external_product_code is not null
      and lower(trim(m.external_product_code)) = lower(v_requested_sku)
  ),
  distinct_matches as (
    select distinct commercial_sku_id
    from candidates
  )
  select
    (select count(*)::bigint from distinct_matches),
    (
      select c.resolved_context
      from candidates c
      order by c.source_priority, lower(c.resolved_context), c.commercial_sku_id
      limit 1
    )
  into v_match_count, v_sku_context;

  if v_match_count > 1 then
    raise exception 'BARCODE_SURVEY_SKU_AMBIGUOUS';
  end if;

  -- Preserve the incumbent Survey-first workflow: a warehouse SKU may have
  -- physical evidence before Commercial mapping exists. Inventory control is a
  -- fallback evidence namespace only, never preferred over Commercial authority.
  if v_match_count = 0 then
    select nullif(trim(s.sku), '')
      into v_sku_context
    from public.v_ecoflow_inventory_sku_control s
    where s.sku is not null
      and lower(trim(s.sku)) = lower(v_requested_sku)
    order by lower(coalesce(s.product_name, ''))
    limit 1;
  end if;

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
  from public.ecoflow_barcode_survey_observations o
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
  from public.ecoflow_barcode_survey_observations o
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

revoke all on function public.ecoflow_get_barcode_survey_packaging_evidence_v1(text, text)
  from public, anon;
grant execute on function public.ecoflow_get_barcode_survey_packaging_evidence_v1(text, text)
  to authenticated;

comment on function public.ecoflow_get_barcode_survey_packaging_evidence_v1(text, text) is
  'Authenticated Barcode Survey evidence lookup. Prefer canonical Commercial SKU / active Ordermentum authority, with inventory-control fallback for Survey-first evidence; exact SKU + carton OBSERVED_NOW semantics remain unchanged.';

commit;
