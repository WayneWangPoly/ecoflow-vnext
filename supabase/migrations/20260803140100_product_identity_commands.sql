-- Revisioned, idempotent product-identity commissioning commands.

begin;

create or replace function public.ecoflow_start_product_identity_batch(
  p_batch_name text,
  p_command_id uuid
)
returns table(
  batch_id uuid,
  batch_status text,
  revision bigint,
  batch_name text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_variable
declare
  v_role text := public.ecoflow_require_product_identity_role(false);
  v_batch public.ecoflow_product_identity_batches%rowtype;
  v_command public.ecoflow_product_identity_commands%rowtype;
  v_name text := coalesce(nullif(btrim(p_batch_name), ''), 'Warehouse product identity commissioning');
begin
  if p_command_id is null then raise exception 'PRODUCT_IDENTITY_COMMAND_ID_REQUIRED'; end if;

  select * into v_command
  from public.ecoflow_product_identity_commands
  where command_id = p_command_id;
  if found then
    select * into v_batch from public.ecoflow_product_identity_batches where id = v_command.batch_id;
    return query select v_batch.id, v_batch.batch_status, v_batch.revision, v_batch.batch_name, v_batch.created_at;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('product-identity-open-batch', 0));

  select * into v_batch
  from public.ecoflow_product_identity_batches
  where batch_status in ('DRAFT','REVIEW')
  order by created_at desc
  limit 1
  for update;

  if not found then
    insert into public.ecoflow_product_identity_batches(
      batch_name, batch_status, revision, created_by, updated_by
    ) values (
      left(v_name, 160), 'DRAFT', 1, auth.uid(), auth.uid()
    ) returning * into v_batch;
  end if;

  insert into public.ecoflow_product_identity_commands(
    command_id, command_type, batch_id, result_payload, actor_user_id, actor_role
  ) values (
    p_command_id, 'START_BATCH', v_batch.id,
    jsonb_build_object('batchId', v_batch.id, 'revision', v_batch.revision),
    auth.uid(), v_role
  );

  insert into public.ecoflow_product_identity_events(
    command_id, batch_id, event_type, actor_user_id, actor_role, payload
  ) values (
    p_command_id, v_batch.id, 'BATCH_OPENED', auth.uid(), v_role,
    jsonb_build_object('batchStatus', v_batch.batch_status, 'batchName', v_batch.batch_name)
  );

  return query select v_batch.id, v_batch.batch_status, v_batch.revision, v_batch.batch_name, v_batch.created_at;
end;
$$;

create or replace function public.ecoflow_save_product_identity_draft(
  p_batch_id uuid,
  p_barcode text,
  p_physical_sku text,
  p_product_name text,
  p_brand text,
  p_family_code text,
  p_family_name text,
  p_commercial_sku text,
  p_package_level text,
  p_units_per_barcode numeric,
  p_substitution_policy text,
  p_is_preferred boolean,
  p_note text,
  p_expected_batch_revision bigint,
  p_auto_verify boolean,
  p_command_id uuid
)
returns table(
  batch_id uuid,
  batch_revision bigint,
  item_id uuid,
  item_state text,
  item_revision bigint,
  conflict_codes text[],
  saved_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_variable
declare
  v_role text := public.ecoflow_require_product_identity_role(false);
  v_batch public.ecoflow_product_identity_batches%rowtype;
  v_item public.ecoflow_product_identity_batch_items%rowtype;
  v_command public.ecoflow_product_identity_commands%rowtype;
  v_registry public.ecoflow_sku_barcode_registry%rowtype;
  v_existing_physical public.ecoflow_physical_skus%rowtype;
  v_existing_family_code text;
  v_barcode text := nullif(btrim(coalesce(p_barcode, '')), '');
  v_physical_sku text := upper(nullif(btrim(coalesce(p_physical_sku, '')), ''));
  v_product_name text := nullif(btrim(coalesce(p_product_name, '')), '');
  v_brand text := nullif(btrim(coalesce(p_brand, '')), '');
  v_family_code text := upper(nullif(btrim(coalesce(p_family_code, '')), ''));
  v_family_name text := nullif(btrim(coalesce(p_family_name, '')), '');
  v_commercial_sku text := upper(nullif(btrim(coalesce(p_commercial_sku, '')), ''));
  v_level text := upper(btrim(coalesce(p_package_level, '')));
  v_policy text := upper(btrim(coalesce(p_substitution_policy, '')));
  v_conflicts text[] := array[]::text[];
  v_blocking boolean := false;
  v_state text;
  v_now timestamptz := clock_timestamp();
begin
  if p_command_id is null then raise exception 'PRODUCT_IDENTITY_COMMAND_ID_REQUIRED'; end if;

  select * into v_command
  from public.ecoflow_product_identity_commands
  where command_id = p_command_id;
  if found then
    select * into v_batch from public.ecoflow_product_identity_batches where id = v_command.batch_id;
    select * into v_item from public.ecoflow_product_identity_batch_items where id = v_command.item_id;
    return query
    select v_batch.id, v_batch.revision, v_item.id, v_item.item_state,
           v_item.revision, v_item.conflict_codes, v_item.updated_at;
    return;
  end if;

  if v_barcode is null then raise exception 'BARCODE_REQUIRED'; end if;
  if v_physical_sku is null then raise exception 'PHYSICAL_SKU_REQUIRED'; end if;
  if v_product_name is null then raise exception 'PHYSICAL_PRODUCT_NAME_REQUIRED'; end if;
  if v_family_code is null then raise exception 'SKU_FAMILY_REQUIRED'; end if;
  if v_family_name is null then raise exception 'SKU_FAMILY_NAME_REQUIRED'; end if;
  if v_commercial_sku is null then raise exception 'COMMERCIAL_SKU_REQUIRED'; end if;
  if v_level not in ('CARTON','SLEEVE','INNER','EACH') then raise exception 'PACKAGE_LEVEL_REQUIRED'; end if;
  if p_units_per_barcode is null or p_units_per_barcode <= 0 or p_units_per_barcode <> trunc(p_units_per_barcode) then
    raise exception 'WHOLE_UNITS_PER_BARCODE_REQUIRED';
  end if;
  if v_policy not in ('ALLOWED','APPROVAL_REQUIRED','PROHIBITED') then raise exception 'SUBSTITUTION_POLICY_REQUIRED'; end if;
  if coalesce(p_is_preferred, false) and v_policy = 'PROHIBITED' then
    raise exception 'PREFERRED_PHYSICAL_SKU_CANNOT_BE_PROHIBITED';
  end if;

  select * into v_batch
  from public.ecoflow_product_identity_batches
  where id = p_batch_id
  for update;
  if not found or v_batch.batch_status not in ('DRAFT','REVIEW') then raise exception 'OPEN_PRODUCT_IDENTITY_BATCH_REQUIRED'; end if;
  if v_batch.revision <> p_expected_batch_revision then
    raise exception using errcode = '40001', message = 'PRODUCT_IDENTITY_STALE_REVISION',
      detail = 'Expected ' || p_expected_batch_revision || ', current ' || v_batch.revision;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('product-identity-barcode:' || v_barcode, 0));

  if not exists (
    select 1 from public.v_ecoflow_owner_sku_velocity c
    where upper(btrim(c.sku)) = v_commercial_sku
  ) then
    v_conflicts := array_append(v_conflicts, 'COMMERCIAL_SKU_NOT_FOUND');
    v_blocking := true;
  end if;

  select * into v_registry
  from public.ecoflow_sku_barcode_registry
  where barcode = v_barcode
  for update;
  if found and v_registry.barcode_status = 'ACTIVE' and v_registry.mapping_state = 'VERIFIED' then
    select * into v_existing_physical
    from public.ecoflow_physical_skus
    where id = v_registry.physical_sku_id;
    if found and v_existing_physical.physical_sku <> v_physical_sku then
      v_conflicts := array_append(v_conflicts, 'BARCODE_ASSIGNED_TO_OTHER_PHYSICAL_SKU');
      v_blocking := true;
    end if;
    if upper(coalesce(v_registry.package_level, 'UNKNOWN')) <> v_level
       or coalesce(v_registry.units_per_barcode, 1) <> p_units_per_barcode then
      v_conflicts := array_append(v_conflicts, 'PACKAGING_CONVERSION_CONFLICT');
      v_blocking := true;
    end if;
  end if;

  select * into v_existing_physical
  from public.ecoflow_physical_skus
  where physical_sku = v_physical_sku;
  if found and v_existing_physical.family_id is not null then
    select family_code into v_existing_family_code
    from public.ecoflow_sku_families
    where id = v_existing_physical.family_id;
    if v_existing_family_code is not null and v_existing_family_code <> v_family_code then
      v_conflicts := array_append(v_conflicts, 'FAMILY_CHANGE_REQUIRES_REVIEW');
    end if;
  end if;

  if coalesce(p_is_preferred, false) and exists (
    select 1
    from public.ecoflow_product_identity_batch_items i
    where i.batch_id = v_batch.id
      and i.commercial_sku = v_commercial_sku
      and i.barcode <> v_barcode
      and i.is_preferred
      and i.item_state <> 'EXCLUDED'
  ) then
    v_conflicts := array_append(v_conflicts, 'MULTIPLE_PREFERRED_PHYSICAL_SKUS');
    v_blocking := true;
  end if;

  if v_policy = 'APPROVAL_REQUIRED' then
    v_conflicts := array_append(v_conflicts, 'APPROVAL_REQUIRED_POLICY');
  end if;

  v_state := case
    when v_blocking then 'CONFLICT'
    when coalesce(p_auto_verify, false) and v_role in ('OWNER','ADMIN') then 'VERIFIED'
    else 'REVIEW'
  end;

  insert into public.ecoflow_product_identity_batch_items(
    batch_id, barcode, physical_sku, product_name, brand,
    family_code, family_name, commercial_sku, package_level,
    units_per_barcode, substitution_policy, is_preferred,
    item_state, conflict_codes, note, revision,
    created_by, updated_by, updated_at,
    reviewed_by, reviewed_at, review_note
  ) values (
    v_batch.id, v_barcode, v_physical_sku, v_product_name, v_brand,
    v_family_code, v_family_name, v_commercial_sku, v_level,
    p_units_per_barcode, v_policy, coalesce(p_is_preferred, false),
    v_state, v_conflicts, nullif(btrim(coalesce(p_note, '')), ''), 1,
    auth.uid(), auth.uid(), v_now,
    case when v_state = 'VERIFIED' then auth.uid() else null end,
    case when v_state = 'VERIFIED' then v_now else null end,
    case when v_state = 'VERIFIED' then 'Verified during supervised capture.' else null end
  )
  on conflict (batch_id, barcode) do update set
    physical_sku = excluded.physical_sku,
    product_name = excluded.product_name,
    brand = excluded.brand,
    family_code = excluded.family_code,
    family_name = excluded.family_name,
    commercial_sku = excluded.commercial_sku,
    package_level = excluded.package_level,
    units_per_barcode = excluded.units_per_barcode,
    substitution_policy = excluded.substitution_policy,
    is_preferred = excluded.is_preferred,
    item_state = excluded.item_state,
    conflict_codes = excluded.conflict_codes,
    note = excluded.note,
    revision = public.ecoflow_product_identity_batch_items.revision + 1,
    updated_by = auth.uid(),
    updated_at = v_now,
    reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at,
    review_note = excluded.review_note
  returning * into v_item;

  update public.ecoflow_product_identity_batches
  set batch_status = case when v_state = 'REVIEW' then 'REVIEW' else 'DRAFT' end,
      revision = revision + 1,
      updated_by = auth.uid(),
      updated_at = v_now
  where id = v_batch.id
  returning * into v_batch;

  insert into public.ecoflow_product_identity_commands(
    command_id, command_type, batch_id, item_id, result_payload, actor_user_id, actor_role
  ) values (
    p_command_id, 'SAVE_DRAFT', v_batch.id, v_item.id,
    jsonb_build_object('itemState', v_item.item_state, 'batchRevision', v_batch.revision, 'conflictCodes', to_jsonb(v_item.conflict_codes)),
    auth.uid(), v_role
  );

  insert into public.ecoflow_product_identity_events(
    command_id, batch_id, item_id, event_type, actor_user_id, actor_role, reason, payload
  ) values (
    p_command_id, v_batch.id, v_item.id, 'ITEM_SAVED', auth.uid(), v_role,
    nullif(btrim(coalesce(p_note, '')), ''),
    jsonb_build_object(
      'barcode', v_barcode,
      'physicalSku', v_physical_sku,
      'familyCode', v_family_code,
      'commercialSku', v_commercial_sku,
      'packageLevel', v_level,
      'unitsPerBarcode', p_units_per_barcode,
      'substitutionPolicy', v_policy,
      'preferred', coalesce(p_is_preferred, false),
      'state', v_state,
      'conflictCodes', to_jsonb(v_conflicts)
    )
  );

  return query
  select v_batch.id, v_batch.revision, v_item.id, v_item.item_state,
         v_item.revision, v_item.conflict_codes, v_item.updated_at;
end;
$$;

create or replace function public.ecoflow_review_product_identity_item(
  p_item_id uuid,
  p_expected_item_revision bigint,
  p_decision text,
  p_note text,
  p_command_id uuid
)
returns table(
  item_id uuid,
  item_state text,
  item_revision bigint,
  batch_id uuid,
  batch_revision bigint,
  reviewed_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_variable
declare
  v_role text := public.ecoflow_require_product_identity_role(true);
  v_item public.ecoflow_product_identity_batch_items%rowtype;
  v_batch public.ecoflow_product_identity_batches%rowtype;
  v_command public.ecoflow_product_identity_commands%rowtype;
  v_decision text := upper(btrim(coalesce(p_decision, '')));
  v_blocking_codes text[] := array[
    'COMMERCIAL_SKU_NOT_FOUND',
    'BARCODE_ASSIGNED_TO_OTHER_PHYSICAL_SKU',
    'PACKAGING_CONVERSION_CONFLICT',
    'MULTIPLE_PREFERRED_PHYSICAL_SKUS'
  ];
  v_now timestamptz := clock_timestamp();
begin
  if p_command_id is null then raise exception 'PRODUCT_IDENTITY_COMMAND_ID_REQUIRED'; end if;
  if v_decision not in ('APPROVE','REJECT') then raise exception 'PRODUCT_IDENTITY_REVIEW_DECISION_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'PRODUCT_IDENTITY_REVIEW_NOTE_REQUIRED'; end if;

  select * into v_command from public.ecoflow_product_identity_commands where command_id = p_command_id;
  if found then
    select * into v_item from public.ecoflow_product_identity_batch_items where id = v_command.item_id;
    select * into v_batch from public.ecoflow_product_identity_batches where id = v_item.batch_id;
    return query select v_item.id, v_item.item_state, v_item.revision, v_batch.id, v_batch.revision, v_item.reviewed_at;
    return;
  end if;

  select * into v_item
  from public.ecoflow_product_identity_batch_items
  where id = p_item_id
  for update;
  if not found then raise exception 'PRODUCT_IDENTITY_ITEM_NOT_FOUND'; end if;
  if v_item.revision <> p_expected_item_revision then
    raise exception using errcode = '40001', message = 'PRODUCT_IDENTITY_ITEM_STALE_REVISION';
  end if;

  select * into v_batch
  from public.ecoflow_product_identity_batches
  where id = v_item.batch_id
  for update;
  if v_batch.batch_status not in ('DRAFT','REVIEW') then raise exception 'OPEN_PRODUCT_IDENTITY_BATCH_REQUIRED'; end if;

  if v_decision = 'APPROVE' and v_item.conflict_codes && v_blocking_codes then
    raise exception 'BLOCKING_PRODUCT_IDENTITY_CONFLICT_MUST_BE_EDITED';
  end if;

  update public.ecoflow_product_identity_batch_items
  set item_state = case when v_decision = 'APPROVE' then 'VERIFIED' else 'DRAFT' end,
      revision = revision + 1,
      updated_by = auth.uid(),
      updated_at = v_now,
      reviewed_by = auth.uid(),
      reviewed_at = v_now,
      review_note = left(btrim(p_note), 2000)
  where id = v_item.id
  returning * into v_item;

  update public.ecoflow_product_identity_batches
  set batch_status = 'REVIEW', revision = revision + 1,
      updated_by = auth.uid(), updated_at = v_now
  where id = v_batch.id
  returning * into v_batch;

  insert into public.ecoflow_product_identity_commands(
    command_id, command_type, batch_id, item_id, result_payload, actor_user_id, actor_role
  ) values (
    p_command_id, 'REVIEW_ITEM', v_batch.id, v_item.id,
    jsonb_build_object('decision', v_decision, 'itemState', v_item.item_state), auth.uid(), v_role
  );

  insert into public.ecoflow_product_identity_events(
    command_id, batch_id, item_id, event_type, actor_user_id, actor_role, reason, payload
  ) values (
    p_command_id, v_batch.id, v_item.id,
    case when v_decision = 'APPROVE' then 'ITEM_VERIFIED' else 'ITEM_REJECTED' end,
    auth.uid(), v_role, left(btrim(p_note), 2000),
    jsonb_build_object('decision', v_decision, 'itemRevision', v_item.revision)
  );

  return query select v_item.id, v_item.item_state, v_item.revision, v_batch.id, v_batch.revision, v_item.reviewed_at;
end;
$$;

create or replace function public.ecoflow_publish_product_identity_batch(
  p_batch_id uuid,
  p_expected_batch_revision bigint,
  p_publication_note text,
  p_command_id uuid
)
returns table(
  batch_id uuid,
  batch_status text,
  batch_revision bigint,
  published_items bigint,
  published_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_variable
declare
  v_role text := public.ecoflow_require_product_identity_role(true);
  v_batch public.ecoflow_product_identity_batches%rowtype;
  v_command public.ecoflow_product_identity_commands%rowtype;
  v_item public.ecoflow_product_identity_batch_items%rowtype;
  v_family public.ecoflow_sku_families%rowtype;
  v_physical public.ecoflow_physical_skus%rowtype;
  v_registry public.ecoflow_sku_barcode_registry%rowtype;
  v_invalid_count bigint;
  v_total_catalog bigint;
  v_covered_after bigint;
  v_published_count bigint := 0;
  v_now timestamptz := clock_timestamp();
begin
  if p_command_id is null then raise exception 'PRODUCT_IDENTITY_COMMAND_ID_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_publication_note, '')), '') is null then raise exception 'PRODUCT_IDENTITY_PUBLICATION_NOTE_REQUIRED'; end if;

  select * into v_command from public.ecoflow_product_identity_commands where command_id = p_command_id;
  if found then
    select * into v_batch from public.ecoflow_product_identity_batches where id = v_command.batch_id;
    return query
    select v_batch.id, v_batch.batch_status, v_batch.revision,
           coalesce((v_command.result_payload ->> 'publishedItems')::bigint, 0), v_batch.published_at;
    return;
  end if;

  select * into v_batch
  from public.ecoflow_product_identity_batches
  where id = p_batch_id
  for update;
  if not found or v_batch.batch_status not in ('DRAFT','REVIEW') then raise exception 'OPEN_PRODUCT_IDENTITY_BATCH_REQUIRED'; end if;
  if v_batch.revision <> p_expected_batch_revision then
    raise exception using errcode = '40001', message = 'PRODUCT_IDENTITY_STALE_REVISION';
  end if;

  select count(*) into v_invalid_count
  from public.ecoflow_product_identity_batch_items i
  where i.batch_id = v_batch.id and i.item_state <> 'VERIFIED';
  if v_invalid_count > 0 then
    raise exception using errcode = '23514', message = 'PRODUCT_IDENTITY_BATCH_HAS_UNRESOLVED_ITEMS',
      detail = v_invalid_count || ' item(s) are not VERIFIED';
  end if;

  select count(*) into v_total_catalog
  from (
    select distinct upper(btrim(v.sku)) as commercial_sku
    from public.v_ecoflow_owner_sku_velocity v
    where nullif(btrim(v.sku), '') is not null
  ) catalog;

  select count(*) into v_covered_after
  from (
    select distinct l.commercial_sku
    from public.ecoflow_commercial_physical_links l
    where l.link_status = 'ACTIVE'
    union
    select distinct i.commercial_sku
    from public.ecoflow_product_identity_batch_items i
    where i.batch_id = v_batch.id and i.item_state = 'VERIFIED'
  ) covered;
  if v_covered_after < v_total_catalog then
    raise exception using errcode = '23514', message = 'PRODUCT_IDENTITY_SCOPE_INCOMPLETE',
      detail = (v_total_catalog - v_covered_after) || ' commercial SKU(s) remain unmapped';
  end if;

  for v_item in
    select * from public.ecoflow_product_identity_batch_items i
    where i.batch_id = v_batch.id and i.item_state = 'VERIFIED'
    order by i.created_at, i.id
  loop
    perform pg_advisory_xact_lock(hashtextextended('product-identity-barcode:' || v_item.barcode, 0));

    insert into public.ecoflow_sku_families(
      family_code, family_name, family_status, revision, created_by, updated_by, updated_at
    ) values (
      v_item.family_code, v_item.family_name, 'ACTIVE', 1, auth.uid(), auth.uid(), v_now
    )
    on conflict (family_code) do update set
      family_name = excluded.family_name,
      family_status = 'ACTIVE',
      revision = public.ecoflow_sku_families.revision + 1,
      updated_by = auth.uid(), updated_at = v_now
    returning * into v_family;

    insert into public.ecoflow_physical_skus(
      physical_sku, product_name, brand, family_id, physical_status,
      revision, created_by, updated_by, updated_at
    ) values (
      v_item.physical_sku, v_item.product_name, v_item.brand, v_family.id,
      'ACTIVE', 1, auth.uid(), auth.uid(), v_now
    )
    on conflict (physical_sku) do update set
      product_name = excluded.product_name,
      brand = excluded.brand,
      family_id = excluded.family_id,
      physical_status = 'ACTIVE',
      revision = public.ecoflow_physical_skus.revision + 1,
      updated_by = auth.uid(), updated_at = v_now
    returning * into v_physical;

    if v_item.is_preferred then
      update public.ecoflow_commercial_physical_links
      set is_preferred = false, revision = revision + 1,
          updated_by = auth.uid(), updated_at = v_now
      where commercial_sku = v_item.commercial_sku
        and link_status = 'ACTIVE' and is_preferred;
    end if;

    insert into public.ecoflow_commercial_physical_links(
      commercial_sku, physical_sku_id, substitution_policy, is_preferred,
      link_status, revision, source_batch_id, created_by, updated_by, updated_at
    ) values (
      v_item.commercial_sku, v_physical.id, v_item.substitution_policy,
      v_item.is_preferred, 'ACTIVE', 1, v_batch.id,
      auth.uid(), auth.uid(), v_now
    )
    on conflict (commercial_sku, physical_sku_id) do update set
      substitution_policy = excluded.substitution_policy,
      is_preferred = excluded.is_preferred,
      link_status = 'ACTIVE',
      revision = public.ecoflow_commercial_physical_links.revision + 1,
      source_batch_id = v_batch.id,
      updated_by = auth.uid(), updated_at = v_now;

    select * into v_registry
    from public.ecoflow_sku_barcode_registry r
    where r.barcode = v_item.barcode
    for update;
    if found and v_registry.mapping_state = 'VERIFIED'
       and v_registry.barcode_status = 'ACTIVE'
       and v_registry.physical_sku_id is distinct from v_physical.id then
      raise exception using errcode = '23505', message = 'BARCODE_ASSIGNED_TO_OTHER_PHYSICAL_SKU';
    end if;

    insert into public.ecoflow_sku_barcode_registry(
      sku, barcode, package_level, units_per_barcode, product_name,
      fixed_shelf, source_session_id, scan_count, first_scanned_at,
      last_scanned_at, verified, note, physical_sku_id, mapping_state,
      barcode_status, revision, verified_by, verified_at,
      source_batch_id, source_command_id
    ) values (
      v_item.physical_sku, v_item.barcode, v_item.package_level,
      v_item.units_per_barcode, v_item.product_name,
      null, null, 1, v_now, v_now, true, v_item.note,
      v_physical.id, 'VERIFIED', 'ACTIVE', 1, auth.uid(), v_now,
      v_batch.id, p_command_id
    )
    on conflict (barcode) do update set
      sku = excluded.sku,
      package_level = excluded.package_level,
      units_per_barcode = excluded.units_per_barcode,
      product_name = excluded.product_name,
      last_scanned_at = v_now,
      verified = true,
      note = excluded.note,
      physical_sku_id = excluded.physical_sku_id,
      mapping_state = 'VERIFIED',
      barcode_status = 'ACTIVE',
      revision = public.ecoflow_sku_barcode_registry.revision + 1,
      verified_by = auth.uid(),
      verified_at = v_now,
      retired_by = null,
      retired_at = null,
      source_batch_id = v_batch.id,
      source_command_id = p_command_id;

    v_published_count := v_published_count + 1;
  end loop;

  update public.ecoflow_product_identity_batches
  set batch_status = 'PUBLISHED', revision = revision + 1,
      updated_by = auth.uid(), updated_at = v_now,
      published_by = auth.uid(), published_at = v_now,
      publication_note = left(btrim(p_publication_note), 2000)
  where id = v_batch.id
  returning * into v_batch;

  insert into public.ecoflow_product_identity_commands(
    command_id, command_type, batch_id, result_payload, actor_user_id, actor_role
  ) values (
    p_command_id, 'PUBLISH_BATCH', v_batch.id,
    jsonb_build_object('publishedItems', v_published_count, 'batchRevision', v_batch.revision), auth.uid(), v_role
  );

  insert into public.ecoflow_product_identity_events(
    command_id, batch_id, event_type, actor_user_id, actor_role, reason, payload
  ) values (
    p_command_id, v_batch.id, 'BATCH_PUBLISHED', auth.uid(), v_role,
    left(btrim(p_publication_note), 2000),
    jsonb_build_object('publishedItems', v_published_count, 'batchRevision', v_batch.revision)
  );

  return query select v_batch.id, v_batch.batch_status, v_batch.revision, v_published_count, v_batch.published_at;
end;
$$;

create or replace function public.ecoflow_validate_product_identity_scan(
  p_barcode text,
  p_commercial_sku text default null,
  p_operation text default 'LOOKUP'
)
returns table(
  barcode text,
  physical_sku text,
  product_name text,
  brand text,
  family_code text,
  family_name text,
  commercial_sku text,
  package_level text,
  units_per_barcode numeric,
  substitution_policy text,
  is_preferred boolean,
  requires_approval boolean,
  validation_status text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_variable
declare
  v_role text := public.ecoflow_require_product_identity_role(false);
  v_barcode text := nullif(btrim(coalesce(p_barcode, '')), '');
  v_commercial text := upper(nullif(btrim(coalesce(p_commercial_sku, '')), ''));
  v_operation text := upper(btrim(coalesce(p_operation, 'LOOKUP')));
  v_registry public.ecoflow_sku_barcode_registry%rowtype;
  v_physical public.ecoflow_physical_skus%rowtype;
  v_family public.ecoflow_sku_families%rowtype;
  v_link public.ecoflow_commercial_physical_links%rowtype;
begin
  if v_barcode is null then raise exception 'BARCODE_REQUIRED'; end if;
  if v_operation not in ('LOOKUP','RECEIVING','PICKING','STOCKTAKE','RETURN') then raise exception 'PRODUCT_IDENTITY_OPERATION_INVALID'; end if;

  select * into v_registry
  from public.ecoflow_sku_barcode_registry r
  where r.barcode = v_barcode and r.mapping_state = 'VERIFIED' and r.barcode_status = 'ACTIVE';
  if not found then raise exception using errcode = 'P0002', message = 'UNKNOWN_OR_UNPUBLISHED_BARCODE'; end if;

  select * into v_physical
  from public.ecoflow_physical_skus p
  where p.id = v_registry.physical_sku_id and p.physical_status = 'ACTIVE';
  if not found then raise exception 'PHYSICAL_SKU_NOT_ACTIVE'; end if;

  select * into v_family
  from public.ecoflow_sku_families f
  where f.id = v_physical.family_id and f.family_status = 'ACTIVE';
  if not found then raise exception 'SKU_FAMILY_NOT_ACTIVE'; end if;

  if v_commercial is not null then
    select * into v_link
    from public.ecoflow_commercial_physical_links l
    where l.commercial_sku = v_commercial
      and l.physical_sku_id = v_physical.id
      and l.link_status = 'ACTIVE';
    if not found then raise exception using errcode = '23514', message = 'BARCODE_NOT_ALLOWED_FOR_COMMERCIAL_SKU'; end if;
    if v_link.substitution_policy = 'PROHIBITED' then
      raise exception using errcode = '23514', message = 'PROHIBITED_PRODUCT_SUBSTITUTION';
    end if;
  else
    select * into v_link
    from public.ecoflow_commercial_physical_links l
    where l.physical_sku_id = v_physical.id and l.link_status = 'ACTIVE'
    order by l.is_preferred desc, l.updated_at desc
    limit 1;
  end if;

  return query
  select v_registry.barcode, v_physical.physical_sku, v_physical.product_name,
         v_physical.brand, v_family.family_code, v_family.family_name,
         coalesce(v_link.commercial_sku, v_commercial), upper(v_registry.package_level),
         v_registry.units_per_barcode, coalesce(v_link.substitution_policy, 'ALLOWED'),
         coalesce(v_link.is_preferred, false),
         coalesce(v_link.substitution_policy = 'APPROVAL_REQUIRED', false),
         case when v_link.substitution_policy = 'APPROVAL_REQUIRED' then 'APPROVAL_REQUIRED' else 'VALID' end;
end;
$$;

grant execute on function public.ecoflow_start_product_identity_batch(text, uuid) to authenticated;
grant execute on function public.ecoflow_save_product_identity_draft(
  uuid, text, text, text, text, text, text, text, text, numeric, text, boolean, text, bigint, boolean, uuid
) to authenticated;
grant execute on function public.ecoflow_review_product_identity_item(uuid, bigint, text, text, uuid) to authenticated;
grant execute on function public.ecoflow_publish_product_identity_batch(uuid, bigint, text, uuid) to authenticated;
grant execute on function public.ecoflow_validate_product_identity_scan(text, text, text) to authenticated;

notify pgrst, 'reload schema';

commit;
