-- WAREHOUSE-SURVEY-002: reconcile trusted Barcode Survey evidence into
-- canonical Product Identity DRAFT commissioning data.
--
-- Safety boundary:
--   * Survey evidence remains staging evidence and never publishes mappings itself.
--   * Reconciliation is OWNER / ADMIN only.
--   * The existing Product Identity capture function remains the only draft writer.
--   * This migration never mutates inventory, receiving, stocktake, pick or delivery quantities.
--   * Ambiguous SKU context, conflicting physical evidence and published barcode collisions fail closed.

begin;

create table if not exists public.ecoflow_barcode_survey_identity_reconciliations (
  id uuid primary key default extensions.gen_random_uuid(),
  survey_observation_id uuid not null unique
    references public.ecoflow_barcode_survey_observations(id) on delete restrict,
  source_observation_id uuid
    references public.ecoflow_barcode_survey_observations(id) on delete restrict,
  batch_id uuid not null
    references public.ecoflow_product_identity_batches(id) on delete restrict,
  product_identity_observation_id uuid not null unique
    references public.ecoflow_product_identity_observations(id) on delete restrict,
  command_id uuid not null unique,
  commercial_sku_id uuid not null references public.skus(id) on delete restrict,
  sku_context text not null,
  carton_barcode text not null,
  source_fingerprint text not null,
  reconciliation_status text not null
    check (reconciliation_status in ('DRAFTED','CONFLICT')),
  detail text not null,
  reconciled_by uuid not null default auth.uid(),
  reconciled_role text not null,
  reconciled_at timestamptz not null default now(),
  constraint ecoflow_survey_reconciliation_role_valid
    check (reconciled_role in ('OWNER','ADMIN')),
  constraint ecoflow_survey_reconciliation_sku_bounded
    check (char_length(sku_context) between 1 and 128),
  constraint ecoflow_survey_reconciliation_barcode_bounded
    check (char_length(carton_barcode) between 1 and 128)
);

create index if not exists idx_ecoflow_survey_reconciliation_batch
  on public.ecoflow_barcode_survey_identity_reconciliations(batch_id, reconciled_at desc);
create index if not exists idx_ecoflow_survey_reconciliation_commercial
  on public.ecoflow_barcode_survey_identity_reconciliations(commercial_sku_id, reconciled_at desc);
create index if not exists idx_ecoflow_survey_reconciliation_barcode
  on public.ecoflow_barcode_survey_identity_reconciliations(carton_barcode, reconciled_at desc);

alter table public.ecoflow_barcode_survey_identity_reconciliations enable row level security;

revoke all on table public.ecoflow_barcode_survey_identity_reconciliations
  from public, anon, authenticated;
grant select on table public.ecoflow_barcode_survey_identity_reconciliations
  to authenticated;

drop policy if exists ecoflow_survey_reconciliation_owner_admin_read
  on public.ecoflow_barcode_survey_identity_reconciliations;
create policy ecoflow_survey_reconciliation_owner_admin_read
  on public.ecoflow_barcode_survey_identity_reconciliations
  for select to authenticated
  using (public.ecoflow_can_publish_product_identity());

comment on table public.ecoflow_barcode_survey_identity_reconciliations is
  'Append-only provenance bridge from Barcode Survey physical evidence to an existing Product Identity draft observation. It is not barcode publication authority.';

-- Owner/Admin queue over existing Survey observations. The Commercial SKU match
-- must be unique across canonical Commercial SKU code and active Ordermentum code.
-- Reused/deferred evidence is displayed but cannot become ready automatically.
create or replace function public.ecoflow_read_barcode_survey_reconciliation_queue_v1(
  p_limit integer default 200
)
returns table (
  survey_observation_id uuid,
  source_observation_id uuid,
  sku_context text,
  sku_product_name text,
  carton_barcode text,
  sleeve_status text,
  sleeve_barcode text,
  evidence_source text,
  survey_note text,
  survey_occurred_at timestamptz,
  commercial_match_count bigint,
  commercial_sku_id uuid,
  commercial_sku_code text,
  commercial_name text,
  ordermentum_sku text,
  existing_physical_sku_code text,
  queue_status text,
  queue_reason text,
  reconciliation_id uuid,
  product_identity_observation_id uuid,
  reconciliation_status text,
  reconciled_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
begin
  if not public.ecoflow_can_publish_product_identity() then
    raise exception using errcode='42501', message='OWNER_OR_ADMIN_REQUIRED';
  end if;

  return query
  with source_rows as (
    select o.*
    from public.ecoflow_barcode_survey_observations o
    order by o.occurred_at desc, o.id desc
    limit v_limit
  )
  select
    o.id,
    o.source_observation_id,
    o.sku_context::text,
    o.sku_product_name::text,
    o.carton_barcode::text,
    o.sleeve_status::text,
    o.sleeve_barcode::text,
    o.evidence_source::text,
    o.note::text,
    o.occurred_at,
    coalesce(cm.match_count, 0)::bigint,
    cm.commercial_sku_id,
    cm.commercial_sku_code,
    cm.commercial_name,
    cm.ordermentum_sku,
    active_physical.physical_sku_code::text,
    case
      when r.id is not null
        and active_binding.id is not null
        and pi.physical_sku_id = active_binding.physical_sku_id
        then 'ALREADY_RECONCILED_PUBLISHED'
      when r.id is not null and r.reconciliation_status = 'CONFLICT'
        then 'DUPLICATE_CONFLICT'
      when r.id is not null
        then 'DRAFT_CREATED'
      when o.sku_context is null
        or o.evidence_source is distinct from 'OBSERVED_NOW'
        or o.sleeve_status not in ('SCANNED','NO_SEPARATE_BARCODE')
        then 'INSUFFICIENT_EVIDENCE'
      when coalesce(ds.physical_observation_count, 0) = 0
        then 'INSUFFICIENT_EVIDENCE'
      when coalesce(ds.signature_count, 0) <> 1
        then 'DUPLICATE_CONFLICT'
      when coalesce(cm.match_count, 0) <> 1
        then 'NEEDS_IDENTITY_CONFIRMATION'
      when active_binding.id is not null
        then 'DUPLICATE_CONFLICT'
      else 'READY_TO_RECONCILE'
    end::text,
    case
      when r.id is not null
        and active_binding.id is not null
        and pi.physical_sku_id = active_binding.physical_sku_id
        then 'This Survey observation produced a Product Identity draft that is now published.'
      when r.id is not null and r.reconciliation_status = 'CONFLICT'
        then coalesce(r.detail, 'The prior reconciliation failed closed.')
      when r.id is not null
        then 'Draft exists. Owner/Admin must review the batch before submit/publish.'
      when o.sku_context is null
        then 'The observation predates validated SKU context and cannot be guessed.'
      when o.evidence_source is distinct from 'OBSERVED_NOW'
        then 'Only direct OBSERVED_NOW physical evidence can seed a Product Identity draft.'
      when o.sleeve_status not in ('SCANNED','NO_SEPARATE_BARCODE')
        then 'The package was not physically verified.'
      when coalesce(ds.physical_observation_count, 0) = 0
        then 'No direct physical evidence is available for this exact SKU + carton barcode.'
      when coalesce(ds.signature_count, 0) <> 1
        then 'Direct physical observations disagree for this exact SKU + carton barcode; latest never wins.'
      when coalesce(cm.match_count, 0) = 0
        then 'Survey SKU context does not uniquely match a Commercial SKU or active Ordermentum SKU.'
      when coalesce(cm.match_count, 0) > 1
        then 'Survey SKU context matches more than one Commercial SKU; explicit identity confirmation is required.'
      when active_binding.id is not null
        then 'This barcode already has a published canonical owner and cannot be silently reassigned.'
      else 'Trusted physical evidence is ready to create a reviewable Product Identity draft.'
    end::text,
    r.id,
    r.product_identity_observation_id,
    r.reconciliation_status,
    r.reconciled_at
  from source_rows o
  left join lateral (
    select
      count(*)::bigint as match_count,
      (array_agg(c.id order by c.id))[1] as commercial_sku_id,
      (array_agg(c.sku_code order by c.id))[1] as commercial_sku_code,
      (array_agg(c.display_name order by c.id))[1] as commercial_name,
      (array_agg(c.ordermentum_sku order by c.id))[1] as ordermentum_sku
    from (
      select distinct
        s.id,
        s.sku_code::text as sku_code,
        s.display_name::text as display_name,
        (
          select m.external_product_code::text
          from public.external_product_mappings m
          where m.internal_sku_id = s.id
            and m.provider = 'ORDERMENTUM'
            and m.is_active
          order by m.updated_at desc nulls last, m.id desc
          limit 1
        ) as ordermentum_sku
      from public.skus s
      where o.sku_context is not null
        and (
          lower(btrim(s.sku_code::text)) = lower(btrim(o.sku_context))
          or exists (
            select 1
            from public.external_product_mappings m
            where m.internal_sku_id = s.id
              and m.provider = 'ORDERMENTUM'
              and m.is_active
              and lower(btrim(m.external_product_code::text)) = lower(btrim(o.sku_context))
          )
        )
    ) c
  ) cm on true
  left join lateral (
    select
      count(*) filter (
        where d.evidence_source = 'OBSERVED_NOW'
          and d.sleeve_status in ('SCANNED','NO_SEPARATE_BARCODE')
      )::bigint as physical_observation_count,
      count(distinct case
        when d.evidence_source = 'OBSERVED_NOW' and d.sleeve_status = 'SCANNED'
          then 'SCANNED:' || d.sleeve_barcode
        when d.evidence_source = 'OBSERVED_NOW' and d.sleeve_status = 'NO_SEPARATE_BARCODE'
          then 'NO_SEPARATE_BARCODE'
        else null
      end)::bigint as signature_count
    from public.ecoflow_barcode_survey_observations d
    where d.sku_context is not distinct from o.sku_context
      and d.carton_barcode = o.carton_barcode
  ) ds on true
  left join public.ecoflow_barcode_survey_identity_reconciliations r
    on r.survey_observation_id = o.id
  left join public.ecoflow_product_identity_observations pi
    on pi.id = r.product_identity_observation_id
  left join public.ecoflow_physical_barcode_bindings active_binding
    on active_binding.barcode = o.carton_barcode
   and active_binding.identity_status = 'ACTIVE'
  left join public.ecoflow_physical_skus active_physical
    on active_physical.id = active_binding.physical_sku_id
  order by
    case
      when r.id is null
        and o.evidence_source = 'OBSERVED_NOW'
        and o.sku_context is not null
        and coalesce(ds.signature_count, 0) = 1
        and coalesce(cm.match_count, 0) = 1
        and active_binding.id is null then 0
      when r.id is null then 1
      else 2
    end,
    o.occurred_at desc,
    o.id desc;
end;
$$;

-- Convert one direct Survey observation into the existing Product Identity DRAFT
-- authority. Every identity/conversion field remains explicit input: the Survey
-- may prefill barcode/SKU evidence but may not infer family, physical SKU, units
-- or substitution policy.
create or replace function public.ecoflow_reconcile_barcode_survey_observation_v1(
  p_survey_observation_id uuid,
  p_batch_id uuid,
  p_command_id uuid,
  p_physical_sku_code text,
  p_physical_name text,
  p_brand text,
  p_supplier_name text,
  p_family_code text,
  p_family_name text,
  p_package_level text,
  p_units_in_base_unit numeric,
  p_substitution_policy text,
  p_is_preferred boolean default true,
  p_note text default null
)
returns table (
  reconciliation_id uuid,
  survey_observation_id uuid,
  product_identity_observation_id uuid,
  commercial_sku_id uuid,
  barcode text,
  reconciliation_status text,
  command_status text,
  detail text,
  reconciled_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text := public.ecoflow_active_app_role();
  v_observation public.ecoflow_barcode_survey_observations%rowtype;
  v_existing public.ecoflow_barcode_survey_identity_reconciliations%rowtype;
  v_capture record;
  v_reconciliation public.ecoflow_barcode_survey_identity_reconciliations%rowtype;
  v_commercial_sku_id uuid;
  v_match_count bigint := 0;
  v_evidence_status text;
  v_source_fingerprint text;
  v_note text;
begin
  if v_actor_id is null then
    raise exception 'SURVEY_RECONCILIATION_AUTH_REQUIRED';
  end if;
  if v_actor_role is null or v_actor_role not in ('OWNER','ADMIN') then
    raise exception using errcode='42501', message='OWNER_OR_ADMIN_REQUIRED';
  end if;
  if p_survey_observation_id is null or p_batch_id is null or p_command_id is null then
    raise exception 'SURVEY_OBSERVATION_BATCH_AND_COMMAND_REQUIRED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ecoflow_survey_identity_reconcile:' || p_survey_observation_id::text, 0)
  );

  select o.* into v_observation
  from public.ecoflow_barcode_survey_observations o
  where o.id = p_survey_observation_id;
  if not found then
    raise exception 'BARCODE_SURVEY_OBSERVATION_NOT_FOUND';
  end if;

  v_source_fingerprint := pg_catalog.md5(
    pg_catalog.jsonb_build_object(
      'observationId', v_observation.id,
      'skuContext', v_observation.sku_context,
      'skuProductName', v_observation.sku_product_name,
      'cartonBarcode', v_observation.carton_barcode,
      'sleeveStatus', v_observation.sleeve_status,
      'sleeveBarcode', v_observation.sleeve_barcode,
      'evidenceSource', v_observation.evidence_source,
      'sourceObservationId', v_observation.source_observation_id,
      'occurredAt', v_observation.occurred_at
    )::text
  );

  select r.* into v_existing
  from public.ecoflow_barcode_survey_identity_reconciliations r
  where r.command_id = p_command_id;
  if found then
    if v_existing.survey_observation_id <> p_survey_observation_id
      or v_existing.source_fingerprint <> v_source_fingerprint then
      raise exception 'SURVEY_RECONCILIATION_IDEMPOTENCY_CONFLICT';
    end if;
    return query select
      v_existing.id,
      v_existing.survey_observation_id,
      v_existing.product_identity_observation_id,
      v_existing.commercial_sku_id,
      v_existing.carton_barcode,
      v_existing.reconciliation_status,
      'REPLAYED'::text,
      v_existing.detail,
      v_existing.reconciled_at;
    return;
  end if;

  select r.* into v_existing
  from public.ecoflow_barcode_survey_identity_reconciliations r
  where r.survey_observation_id = p_survey_observation_id;
  if found then
    if v_existing.source_fingerprint <> v_source_fingerprint then
      raise exception 'SURVEY_RECONCILIATION_SOURCE_CHANGED';
    end if;
    return query select
      v_existing.id,
      v_existing.survey_observation_id,
      v_existing.product_identity_observation_id,
      v_existing.commercial_sku_id,
      v_existing.carton_barcode,
      v_existing.reconciliation_status,
      'EXISTING'::text,
      v_existing.detail,
      v_existing.reconciled_at;
    return;
  end if;

  if v_observation.sku_context is null then
    raise exception 'SURVEY_RECONCILIATION_SKU_CONTEXT_REQUIRED';
  end if;
  if v_observation.evidence_source is distinct from 'OBSERVED_NOW'
    or v_observation.sleeve_status not in ('SCANNED','NO_SEPARATE_BARCODE') then
    raise exception 'SURVEY_RECONCILIATION_DIRECT_PHYSICAL_EVIDENCE_REQUIRED';
  end if;

  select e.status into v_evidence_status
  from public.ecoflow_get_barcode_survey_packaging_evidence_v1(
    v_observation.sku_context,
    v_observation.carton_barcode
  ) e;
  if v_evidence_status = 'CONFLICT' then
    raise exception 'SURVEY_RECONCILIATION_PHYSICAL_EVIDENCE_CONFLICT';
  end if;
  if v_evidence_status not in ('VERIFIED_SCANNED','VERIFIED_NO_SEPARATE_BARCODE') then
    raise exception 'SURVEY_RECONCILIATION_PHYSICAL_EVIDENCE_UNVERIFIED';
  end if;

  select count(*)::bigint, (array_agg(c.id order by c.id))[1]
    into v_match_count, v_commercial_sku_id
  from (
    select distinct s.id
    from public.skus s
    where lower(btrim(s.sku_code::text)) = lower(btrim(v_observation.sku_context))
      or exists (
        select 1
        from public.external_product_mappings m
        where m.internal_sku_id = s.id
          and m.provider = 'ORDERMENTUM'
          and m.is_active
          and lower(btrim(m.external_product_code::text)) = lower(btrim(v_observation.sku_context))
      )
  ) c;

  if v_match_count = 0 then
    raise exception 'SURVEY_RECONCILIATION_COMMERCIAL_SKU_NOT_FOUND';
  end if;
  if v_match_count <> 1 then
    raise exception 'SURVEY_RECONCILIATION_COMMERCIAL_SKU_AMBIGUOUS';
  end if;

  if exists (
    select 1
    from public.ecoflow_physical_barcode_bindings b
    where b.barcode = v_observation.carton_barcode
      and b.identity_status = 'ACTIVE'
  ) then
    raise exception 'SURVEY_RECONCILIATION_BARCODE_ALREADY_PUBLISHED';
  end if;

  v_note := concat_ws(
    ' | ',
    'SURVEY_OBSERVATION=' || v_observation.id::text,
    case when v_observation.source_observation_id is not null
      then 'SURVEY_SOURCE=' || v_observation.source_observation_id::text else null end,
    nullif(btrim(coalesce(p_note, '')), '')
  );

  select * into v_capture
  from public.ecoflow_capture_product_identity(
    p_batch_id,
    p_command_id,
    v_commercial_sku_id,
    p_physical_sku_code,
    p_physical_name,
    p_brand,
    p_supplier_name,
    p_family_code,
    p_family_name,
    v_observation.carton_barcode,
    p_package_level,
    p_units_in_base_unit,
    p_substitution_policy,
    coalesce(p_is_preferred, true),
    v_note
  );

  insert into public.ecoflow_barcode_survey_identity_reconciliations (
    survey_observation_id,
    source_observation_id,
    batch_id,
    product_identity_observation_id,
    command_id,
    commercial_sku_id,
    sku_context,
    carton_barcode,
    source_fingerprint,
    reconciliation_status,
    detail,
    reconciled_by,
    reconciled_role
  ) values (
    v_observation.id,
    v_observation.source_observation_id,
    p_batch_id,
    v_capture.observation_id,
    p_command_id,
    v_commercial_sku_id,
    v_observation.sku_context,
    v_observation.carton_barcode,
    v_source_fingerprint,
    v_capture.capture_status,
    v_capture.detail,
    v_actor_id,
    v_actor_role
  ) returning * into v_reconciliation;

  return query select
    v_reconciliation.id,
    v_reconciliation.survey_observation_id,
    v_reconciliation.product_identity_observation_id,
    v_reconciliation.commercial_sku_id,
    v_reconciliation.carton_barcode,
    v_reconciliation.reconciliation_status,
    'APPLIED'::text,
    v_reconciliation.detail,
    v_reconciliation.reconciled_at;
end;
$$;

revoke all on function public.ecoflow_read_barcode_survey_reconciliation_queue_v1(integer)
  from public, anon;
revoke all on function public.ecoflow_reconcile_barcode_survey_observation_v1(
  uuid,uuid,uuid,text,text,text,text,text,text,text,numeric,text,boolean,text
) from public, anon;

grant execute on function public.ecoflow_read_barcode_survey_reconciliation_queue_v1(integer)
  to authenticated;
grant execute on function public.ecoflow_reconcile_barcode_survey_observation_v1(
  uuid,uuid,uuid,text,text,text,text,text,text,text,numeric,text,boolean,text
) to authenticated;

comment on function public.ecoflow_read_barcode_survey_reconciliation_queue_v1(integer) is
  'Owner/Admin-only queue that classifies existing Barcode Survey evidence for Product Identity draft reconciliation.';
comment on function public.ecoflow_reconcile_barcode_survey_observation_v1(uuid,uuid,uuid,text,text,text,text,text,text,text,numeric,text,boolean,text) is
  'Owner/Admin-only provenance-preserving bridge into existing Product Identity DRAFT capture. Never publishes and never mutates inventory.';

notify pgrst, 'reload schema';
commit;
