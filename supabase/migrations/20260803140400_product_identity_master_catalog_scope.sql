-- Commissioning scope must come from the current Ordermentum SKU master,
-- not the top-selling velocity view. This includes newly listed SKUs that have
-- never sold while excluding service, retired and discontinued catalogue rows.

begin;

create or replace view public.v_ecoflow_product_identity_commercial_catalog
with (security_invoker = true)
as
select
  upper(btrim(m.external_sku_code::text)) as commercial_sku,
  coalesce(
    max(nullif(btrim(v.product_name), '')),
    upper(btrim(m.external_sku_code::text))
  ) as product_name,
  coalesce(max(v.units_30d), 0)::numeric as units_30d,
  coalesce(max(v.order_count), 0)::numeric as order_count_30d,
  max(v.last_sold_at) as last_sold_at,
  max(m.classification) as classification,
  max(m.pick_level) as pick_level,
  max(m.status) as catalog_status
from public.v_ecoflow_app_sku_master m
left join public.v_ecoflow_owner_sku_velocity v
  on upper(btrim(v.sku)) = upper(btrim(m.external_sku_code::text))
where nullif(btrim(m.external_sku_code::text), '') is not null
  and coalesce(m.is_service_item, false) = false
  and lower(coalesce(nullif(btrim(m.status), ''), 'active')) not in (
    'inactive', 'retired', 'discontinued', 'deleted', 'archived', 'disabled'
  )
group by upper(btrim(m.external_sku_code::text));

grant select on public.v_ecoflow_product_identity_commercial_catalog to authenticated;
revoke all on public.v_ecoflow_product_identity_commercial_catalog from anon;

create or replace function public.ecoflow_read_commercial_sku_options(
  p_search text default null,
  p_limit integer default 300
)
returns table(
  commercial_sku text,
  product_name text,
  units_30d numeric,
  order_count_30d numeric
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_variable
declare
  v_role text := public.ecoflow_require_product_identity_role(false);
  v_search text := upper(nullif(btrim(coalesce(p_search, '')), ''));
begin
  return query
  select
    c.commercial_sku,
    c.product_name,
    c.units_30d,
    c.order_count_30d
  from public.v_ecoflow_product_identity_commercial_catalog c
  where v_search is null
     or c.commercial_sku like '%' || v_search || '%'
     or upper(c.product_name) like '%' || v_search || '%'
  order by c.units_30d desc, c.order_count_30d desc, c.commercial_sku
  limit greatest(1, least(coalesce(p_limit, 300), 3000));
end;
$$;

create or replace function public.ecoflow_read_product_identity_tasks(
  p_search text default null,
  p_state text default null,
  p_limit integer default 500
)
returns table(
  commercial_sku text,
  product_name text,
  mapping_status text,
  physical_sku text,
  family_code text,
  family_name text,
  substitution_policy text,
  is_preferred boolean,
  verified_barcode_count bigint,
  carton_barcodes bigint,
  sleeve_barcodes bigint,
  inner_barcodes bigint,
  each_barcodes bigint,
  latest_barcode text,
  current_batch_id uuid,
  current_item_id uuid,
  current_item_state text,
  conflict_codes text[],
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_variable
declare
  v_role text := public.ecoflow_require_product_identity_role(false);
  v_search text := upper(nullif(btrim(coalesce(p_search, '')), ''));
  v_state text := upper(nullif(btrim(coalesce(p_state, '')), ''));
  v_batch_id uuid;
begin
  select b.id into v_batch_id
  from public.ecoflow_product_identity_batches b
  where b.batch_status in ('DRAFT','REVIEW')
  order by b.created_at desc
  limit 1;

  return query
  with catalog as (
    select c.commercial_sku, c.product_name
    from public.v_ecoflow_product_identity_commercial_catalog c
  ),
  published as (
    select distinct on (l.commercial_sku)
      l.commercial_sku, p.physical_sku, f.family_code, f.family_name,
      l.substitution_policy, l.is_preferred, p.id as physical_sku_id, l.updated_at
    from public.ecoflow_commercial_physical_links l
    join public.ecoflow_physical_skus p on p.id = l.physical_sku_id
    left join public.ecoflow_sku_families f on f.id = p.family_id
    where l.link_status = 'ACTIVE'
    order by l.commercial_sku, l.is_preferred desc, l.updated_at desc
  ),
  barcode_summary as (
    select
      r.physical_sku_id,
      count(*) filter (where r.mapping_state = 'VERIFIED' and r.barcode_status = 'ACTIVE') as verified_barcode_count,
      count(*) filter (where r.mapping_state = 'VERIFIED' and r.barcode_status = 'ACTIVE' and upper(r.package_level) = 'CARTON') as carton_barcodes,
      count(*) filter (where r.mapping_state = 'VERIFIED' and r.barcode_status = 'ACTIVE' and upper(r.package_level) = 'SLEEVE') as sleeve_barcodes,
      count(*) filter (where r.mapping_state = 'VERIFIED' and r.barcode_status = 'ACTIVE' and upper(r.package_level) = 'INNER') as inner_barcodes,
      count(*) filter (where r.mapping_state = 'VERIFIED' and r.barcode_status = 'ACTIVE' and upper(r.package_level) = 'EACH') as each_barcodes,
      max(r.barcode) filter (where r.mapping_state = 'VERIFIED' and r.barcode_status = 'ACTIVE') as latest_barcode
    from public.ecoflow_sku_barcode_registry r
    group by r.physical_sku_id
  ),
  staged as (
    select distinct on (i.commercial_sku)
      i.commercial_sku, i.batch_id, i.id as item_id, i.item_state,
      i.conflict_codes, i.physical_sku, i.family_code, i.family_name,
      i.substitution_policy, i.is_preferred, i.updated_at
    from public.ecoflow_product_identity_batch_items i
    where i.batch_id = v_batch_id
    order by i.commercial_sku, i.updated_at desc
  ),
  rows as (
    select
      c.commercial_sku,
      c.product_name,
      case
        when s.item_state = 'CONFLICT' then 'CONFLICT'
        when s.item_state = 'REVIEW' then 'REVIEW'
        when s.item_state = 'VERIFIED' then 'READY_TO_PUBLISH'
        when p.commercial_sku is not null then 'PUBLISHED'
        else 'UNMAPPED'
      end as mapping_status,
      coalesce(s.physical_sku, p.physical_sku) as physical_sku,
      coalesce(s.family_code, p.family_code) as family_code,
      coalesce(s.family_name, p.family_name) as family_name,
      coalesce(s.substitution_policy, p.substitution_policy) as substitution_policy,
      coalesce(s.is_preferred, p.is_preferred, false) as is_preferred,
      coalesce(bs.verified_barcode_count, 0)::bigint as verified_barcode_count,
      coalesce(bs.carton_barcodes, 0)::bigint as carton_barcodes,
      coalesce(bs.sleeve_barcodes, 0)::bigint as sleeve_barcodes,
      coalesce(bs.inner_barcodes, 0)::bigint as inner_barcodes,
      coalesce(bs.each_barcodes, 0)::bigint as each_barcodes,
      bs.latest_barcode,
      s.batch_id as current_batch_id,
      s.item_id as current_item_id,
      s.item_state as current_item_state,
      coalesce(s.conflict_codes, '{}'::text[]) as conflict_codes,
      greatest(
        coalesce(s.updated_at, '-infinity'::timestamptz),
        coalesce(p.updated_at, '-infinity'::timestamptz)
      ) as updated_at
    from catalog c
    left join published p on p.commercial_sku = c.commercial_sku
    left join barcode_summary bs on bs.physical_sku_id = p.physical_sku_id
    left join staged s on s.commercial_sku = c.commercial_sku
  )
  select r.*
  from rows r
  where (
      v_search is null
      or r.commercial_sku like '%' || v_search || '%'
      or upper(r.product_name) like '%' || v_search || '%'
      or upper(coalesce(r.physical_sku, '')) like '%' || v_search || '%'
      or upper(coalesce(r.family_name, '')) like '%' || v_search || '%'
    )
    and (v_state is null or r.mapping_status = v_state)
  order by
    case r.mapping_status
      when 'CONFLICT' then 0
      when 'REVIEW' then 1
      when 'UNMAPPED' then 2
      when 'READY_TO_PUBLISH' then 3
      else 4
    end,
    r.commercial_sku
  limit greatest(1, least(coalesce(p_limit, 500), 3000));
end;
$$;

create or replace function public.ecoflow_read_product_identity_readiness()
returns table(
  batch_id uuid,
  batch_name text,
  batch_status text,
  batch_revision bigint,
  total_commercial_skus bigint,
  published_commercial_skus bigint,
  staged_commercial_skus bigint,
  covered_commercial_skus bigint,
  unmapped_commercial_skus bigint,
  physical_skus bigint,
  sku_families bigint,
  verified_barcodes bigint,
  carton_barcodes bigint,
  sleeve_barcodes bigint,
  inner_barcodes bigint,
  each_barcodes bigint,
  conflict_items bigint,
  review_items bigint,
  verified_items bigint,
  readiness_percent numeric,
  publication_ready boolean,
  latest_actor uuid,
  latest_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_variable
declare
  v_role text := public.ecoflow_require_product_identity_role(false);
  v_batch public.ecoflow_product_identity_batches%rowtype;
begin
  select * into v_batch
  from public.ecoflow_product_identity_batches b
  where b.batch_status in ('DRAFT','REVIEW')
  order by b.created_at desc
  limit 1;

  return query
  with catalog as (
    select c.commercial_sku
    from public.v_ecoflow_product_identity_commercial_catalog c
  ),
  published as (
    select distinct l.commercial_sku
    from public.ecoflow_commercial_physical_links l
    join catalog c on c.commercial_sku = l.commercial_sku
    where l.link_status = 'ACTIVE'
  ),
  staged as (
    select distinct i.commercial_sku
    from public.ecoflow_product_identity_batch_items i
    join catalog c on c.commercial_sku = i.commercial_sku
    where i.batch_id = v_batch.id and i.item_state = 'VERIFIED'
  ),
  covered as (
    select commercial_sku from published
    union
    select commercial_sku from staged
  ),
  counts as (
    select
      (select count(*) from catalog)::bigint as total_count,
      (select count(*) from published)::bigint as published_count,
      (select count(*) from staged)::bigint as staged_count,
      (select count(*) from covered)::bigint as covered_count,
      (select count(*) from public.ecoflow_physical_skus p where p.physical_status = 'ACTIVE')::bigint as physical_count,
      (select count(*) from public.ecoflow_sku_families f where f.family_status = 'ACTIVE')::bigint as family_count,
      (select count(*) from public.ecoflow_sku_barcode_registry r where r.mapping_state = 'VERIFIED' and r.barcode_status = 'ACTIVE')::bigint as barcode_count,
      (select count(*) from public.ecoflow_sku_barcode_registry r where r.mapping_state = 'VERIFIED' and r.barcode_status = 'ACTIVE' and upper(r.package_level) = 'CARTON')::bigint as carton_count,
      (select count(*) from public.ecoflow_sku_barcode_registry r where r.mapping_state = 'VERIFIED' and r.barcode_status = 'ACTIVE' and upper(r.package_level) = 'SLEEVE')::bigint as sleeve_count,
      (select count(*) from public.ecoflow_sku_barcode_registry r where r.mapping_state = 'VERIFIED' and r.barcode_status = 'ACTIVE' and upper(r.package_level) = 'INNER')::bigint as inner_count,
      (select count(*) from public.ecoflow_sku_barcode_registry r where r.mapping_state = 'VERIFIED' and r.barcode_status = 'ACTIVE' and upper(r.package_level) = 'EACH')::bigint as each_count,
      (select count(*) from public.ecoflow_product_identity_batch_items i where i.batch_id = v_batch.id and i.item_state = 'CONFLICT')::bigint as conflict_count,
      (select count(*) from public.ecoflow_product_identity_batch_items i where i.batch_id = v_batch.id and i.item_state in ('DRAFT','REVIEW'))::bigint as review_count,
      (select count(*) from public.ecoflow_product_identity_batch_items i where i.batch_id = v_batch.id and i.item_state = 'VERIFIED')::bigint as verified_count
  )
  select
    v_batch.id, v_batch.batch_name, v_batch.batch_status, v_batch.revision,
    c.total_count, c.published_count, c.staged_count, c.covered_count,
    greatest(c.total_count - c.covered_count, 0)::bigint,
    c.physical_count, c.family_count, c.barcode_count,
    c.carton_count, c.sleeve_count, c.inner_count, c.each_count,
    c.conflict_count, c.review_count, c.verified_count,
    case
      when c.total_count = 0 then 0::numeric
      else round((c.covered_count::numeric * 100) / c.total_count::numeric, 1)
    end,
    (
      v_batch.id is not null
      and c.total_count > 0
      and c.verified_count > 0
      and c.conflict_count = 0
      and c.review_count = 0
      and c.covered_count >= c.total_count
    ),
    v_batch.updated_by, v_batch.updated_at
  from counts c;
end;
$$;

create or replace function public.ecoflow_normalise_batch_item_catalog_scope()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_variable
declare
  v_remaining_blocking text[];
begin
  if new.conflict_codes @> array['COMMERCIAL_SKU_NOT_FOUND']::text[]
     and exists (
       select 1
       from public.v_ecoflow_product_identity_commercial_catalog c
       where c.commercial_sku = new.commercial_sku
     ) then
    new.conflict_codes := array_remove(new.conflict_codes, 'COMMERCIAL_SKU_NOT_FOUND');
  end if;

  v_remaining_blocking := array(
    select code
    from unnest(coalesce(new.conflict_codes, '{}'::text[])) as code
    where code in (
      'COMMERCIAL_SKU_NOT_FOUND',
      'BARCODE_ASSIGNED_TO_OTHER_PHYSICAL_SKU',
      'PACKAGING_CONVERSION_CONFLICT',
      'MULTIPLE_PREFERRED_PHYSICAL_SKUS'
    )
  );

  if new.item_state = 'CONFLICT' and cardinality(v_remaining_blocking) = 0 then
    new.item_state := 'REVIEW';
  end if;

  return new;
end;
$$;

revoke all on function public.ecoflow_normalise_batch_item_catalog_scope()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_ecoflow_product_identity_catalog_scope
  on public.ecoflow_product_identity_batch_items;
create trigger trg_ecoflow_product_identity_catalog_scope
before insert or update of commercial_sku, conflict_codes, item_state
on public.ecoflow_product_identity_batch_items
for each row execute function public.ecoflow_normalise_batch_item_catalog_scope();

create or replace function public.ecoflow_guard_product_identity_master_scope()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_variable
declare
  v_missing bigint;
begin
  if new.batch_status = 'PUBLISHED' and old.batch_status <> 'PUBLISHED' then
    select count(*) into v_missing
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
      where i.batch_id = new.id
        and i.commercial_sku = c.commercial_sku
        and i.item_state = 'VERIFIED'
    );

    if v_missing > 0 then
      raise exception using
        errcode = '23514',
        message = 'PRODUCT_IDENTITY_MASTER_CATALOG_INCOMPLETE',
        detail = v_missing || ' active non-service Ordermentum SKU(s) remain unmapped';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.ecoflow_guard_product_identity_master_scope()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_ecoflow_product_identity_master_scope
  on public.ecoflow_product_identity_batches;
create trigger trg_ecoflow_product_identity_master_scope
before update of batch_status on public.ecoflow_product_identity_batches
for each row execute function public.ecoflow_guard_product_identity_master_scope();

grant execute on function public.ecoflow_read_commercial_sku_options(text, integer) to authenticated;
grant execute on function public.ecoflow_read_product_identity_tasks(text, text, integer) to authenticated;
grant execute on function public.ecoflow_read_product_identity_readiness() to authenticated;

notify pgrst, 'reload schema';

commit;
