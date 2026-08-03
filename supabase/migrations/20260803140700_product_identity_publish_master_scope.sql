-- Replace the initial velocity-based publication scope with the authoritative
-- active, non-service Ordermentum master catalogue introduced in 1404.

begin;

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
  v_missing_count bigint;
  v_published_count bigint := 0;
  v_now timestamptz := clock_timestamp();
begin
  if p_command_id is null then
    raise exception 'PRODUCT_IDENTITY_COMMAND_ID_REQUIRED';
  end if;
  if nullif(btrim(coalesce(p_publication_note, '')), '') is null then
    raise exception 'PRODUCT_IDENTITY_PUBLICATION_NOTE_REQUIRED';
  end if;

  select * into v_command
  from public.ecoflow_product_identity_commands c
  where c.command_id = p_command_id;

  if found then
    select * into v_batch
    from public.ecoflow_product_identity_batches b
    where b.id = v_command.batch_id;

    return query
    select
      v_batch.id,
      v_batch.batch_status,
      v_batch.revision,
      coalesce((v_command.result_payload ->> 'publishedItems')::bigint, 0),
      v_batch.published_at;
    return;
  end if;

  select * into v_batch
  from public.ecoflow_product_identity_batches b
  where b.id = p_batch_id
  for update;

  if not found or v_batch.batch_status not in ('DRAFT', 'REVIEW') then
    raise exception 'OPEN_PRODUCT_IDENTITY_BATCH_REQUIRED';
  end if;

  if v_batch.revision <> p_expected_batch_revision then
    raise exception using
      errcode = '40001',
      message = 'PRODUCT_IDENTITY_STALE_REVISION',
      detail = 'Expected ' || p_expected_batch_revision || ', current ' || v_batch.revision;
  end if;

  select count(*) into v_invalid_count
  from public.ecoflow_product_identity_batch_items i
  where i.batch_id = v_batch.id
    and i.item_state <> 'VERIFIED';

  if v_invalid_count > 0 then
    raise exception using
      errcode = '23514',
      message = 'PRODUCT_IDENTITY_BATCH_HAS_UNRESOLVED_ITEMS',
      detail = v_invalid_count || ' item(s) are not VERIFIED';
  end if;

  -- Publication is complete only when every current active non-service SKU is
  -- already published or represented by a verified item in this batch.
  select count(*) into v_missing_count
  from public.v_ecoflow_product_identity_commercial_catalog c
  where not exists (
    select 1
    from public.ecoflow_commercial_physical_links l
    where l.commercial_sku = c.commercial_sku
      and l.link_status = 'ACTIVE'
  )
  and not exists (
    select 1
    from public.ecoflow_product_identity_batch_items i
    where i.batch_id = v_batch.id
      and i.commercial_sku = c.commercial_sku
      and i.item_state = 'VERIFIED'
  );

  if v_missing_count > 0 then
    raise exception using
      errcode = '23514',
      message = 'PRODUCT_IDENTITY_MASTER_CATALOG_INCOMPLETE',
      detail = v_missing_count || ' active non-service Ordermentum SKU(s) remain unmapped';
  end if;

  if not exists (
    select 1
    from public.v_ecoflow_product_identity_commercial_catalog c
  ) then
    raise exception using
      errcode = '23514',
      message = 'PRODUCT_IDENTITY_MASTER_CATALOG_EMPTY',
      detail = 'The active Ordermentum master catalogue returned no physical SKUs.';
  end if;

  for v_item in
    select i.*
    from public.ecoflow_product_identity_batch_items i
    where i.batch_id = v_batch.id
      and i.item_state = 'VERIFIED'
    order by i.created_at, i.id
  loop
    if not exists (
      select 1
      from public.v_ecoflow_product_identity_commercial_catalog c
      where c.commercial_sku = v_item.commercial_sku
    ) then
      raise exception using
        errcode = '23514',
        message = 'PRODUCT_IDENTITY_COMMERCIAL_SKU_OUTSIDE_ACTIVE_CATALOG',
        detail = v_item.commercial_sku || ' is not an active non-service Ordermentum SKU';
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended('product-identity-barcode:' || v_item.barcode, 0)
    );

    insert into public.ecoflow_sku_families(
      family_code,
      family_name,
      family_status,
      revision,
      created_by,
      updated_by,
      updated_at
    ) values (
      v_item.family_code,
      v_item.family_name,
      'ACTIVE',
      1,
      auth.uid(),
      auth.uid(),
      v_now
    )
    on conflict (family_code) do update set
      family_name = excluded.family_name,
      family_status = 'ACTIVE',
      revision = public.ecoflow_sku_families.revision + 1,
      updated_by = auth.uid(),
      updated_at = v_now
    returning * into v_family;

    insert into public.ecoflow_physical_skus(
      physical_sku,
      product_name,
      brand,
      family_id,
      physical_status,
      revision,
      created_by,
      updated_by,
      updated_at
    ) values (
      v_item.physical_sku,
      v_item.product_name,
      v_item.brand,
      v_family.id,
      'ACTIVE',
      1,
      auth.uid(),
      auth.uid(),
      v_now
    )
    on conflict (physical_sku) do update set
      product_name = excluded.product_name,
      brand = excluded.brand,
      family_id = excluded.family_id,
      physical_status = 'ACTIVE',
      revision = public.ecoflow_physical_skus.revision + 1,
      updated_by = auth.uid(),
      updated_at = v_now
    returning * into v_physical;

    if v_item.is_preferred then
      update public.ecoflow_commercial_physical_links l
      set
        is_preferred = false,
        revision = l.revision + 1,
        updated_by = auth.uid(),
        updated_at = v_now
      where l.commercial_sku = v_item.commercial_sku
        and l.link_status = 'ACTIVE'
        and l.is_preferred
        and l.physical_sku_id <> v_physical.id;
    end if;

    insert into public.ecoflow_commercial_physical_links(
      commercial_sku,
      physical_sku_id,
      substitution_policy,
      is_preferred,
      link_status,
      revision,
      source_batch_id,
      created_by,
      updated_by,
      updated_at
    ) values (
      v_item.commercial_sku,
      v_physical.id,
      v_item.substitution_policy,
      v_item.is_preferred,
      'ACTIVE',
      1,
      v_batch.id,
      auth.uid(),
      auth.uid(),
      v_now
    )
    on conflict (commercial_sku, physical_sku_id) do update set
      substitution_policy = excluded.substitution_policy,
      is_preferred = excluded.is_preferred,
      link_status = 'ACTIVE',
      revision = public.ecoflow_commercial_physical_links.revision + 1,
      source_batch_id = v_batch.id,
      updated_by = auth.uid(),
      updated_at = v_now;

    select * into v_registry
    from public.ecoflow_sku_barcode_registry r
    where r.barcode = v_item.barcode
    for update;

    if found
      and v_registry.mapping_state = 'VERIFIED'
      and v_registry.barcode_status = 'ACTIVE'
      and v_registry.physical_sku_id is distinct from v_physical.id
    then
      raise exception using
        errcode = '23505',
        message = 'BARCODE_ASSIGNED_TO_OTHER_PHYSICAL_SKU';
    end if;

    insert into public.ecoflow_sku_barcode_registry(
      sku,
      barcode,
      package_level,
      units_per_barcode,
      product_name,
      fixed_shelf,
      source_session_id,
      scan_count,
      first_scanned_at,
      last_scanned_at,
      verified,
      note,
      physical_sku_id,
      mapping_state,
      barcode_status,
      revision,
      verified_by,
      verified_at,
      source_batch_id,
      source_command_id
    ) values (
      v_item.physical_sku,
      v_item.barcode,
      v_item.package_level,
      v_item.units_per_barcode,
      v_item.product_name,
      null,
      null,
      1,
      v_now,
      v_now,
      true,
      v_item.note,
      v_physical.id,
      'VERIFIED',
      'ACTIVE',
      1,
      auth.uid(),
      v_now,
      v_batch.id,
      p_command_id
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

  update public.ecoflow_product_identity_batches b
  set
    batch_status = 'PUBLISHED',
    revision = b.revision + 1,
    updated_by = auth.uid(),
    updated_at = v_now,
    published_by = auth.uid(),
    published_at = v_now,
    publication_note = left(btrim(p_publication_note), 2000)
  where b.id = v_batch.id
  returning * into v_batch;

  insert into public.ecoflow_product_identity_commands(
    command_id,
    command_type,
    batch_id,
    result_payload,
    actor_user_id,
    actor_role
  ) values (
    p_command_id,
    'PUBLISH_BATCH',
    v_batch.id,
    jsonb_build_object(
      'publishedItems', v_published_count,
      'batchRevision', v_batch.revision,
      'catalogScope', 'ACTIVE_ORDERMENTUM_MASTER'
    ),
    auth.uid(),
    v_role
  );

  insert into public.ecoflow_product_identity_events(
    command_id,
    batch_id,
    event_type,
    actor_user_id,
    actor_role,
    reason,
    payload
  ) values (
    p_command_id,
    v_batch.id,
    'BATCH_PUBLISHED',
    auth.uid(),
    v_role,
    left(btrim(p_publication_note), 2000),
    jsonb_build_object(
      'publishedItems', v_published_count,
      'batchRevision', v_batch.revision,
      'catalogScope', 'ACTIVE_ORDERMENTUM_MASTER'
    )
  );

  return query
  select
    v_batch.id,
    v_batch.batch_status,
    v_batch.revision,
    v_published_count,
    v_batch.published_at;
end;
$$;

grant execute on function public.ecoflow_publish_product_identity_batch(
  uuid,
  bigint,
  text,
  uuid
) to authenticated;

notify pgrst, 'reload schema';

commit;
