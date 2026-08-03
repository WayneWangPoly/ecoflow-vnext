-- Canonical authority for Commercial SKU, Physical SKU, SKU Family and barcode identity.
-- Additive migration: identity publication never mutates warehouse stock quantities.

begin;

create table if not exists public.ecoflow_sku_families (
  id uuid primary key default gen_random_uuid(),
  family_code text not null unique,
  family_name text not null,
  description text,
  family_status text not null default 'ACTIVE'
    check (family_status in ('ACTIVE','RETIRED')),
  revision bigint not null default 1 check (revision >= 1),
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null,
  updated_at timestamptz not null default clock_timestamp(),
  check (family_code = upper(btrim(family_code))),
  check (btrim(family_name) <> '')
);

create table if not exists public.ecoflow_physical_skus (
  id uuid primary key default gen_random_uuid(),
  physical_sku text not null unique,
  product_name text not null,
  brand text,
  family_id uuid references public.ecoflow_sku_families(id) on delete restrict,
  physical_status text not null default 'ACTIVE'
    check (physical_status in ('ACTIVE','HOLD','RETIRED')),
  revision bigint not null default 1 check (revision >= 1),
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null,
  updated_at timestamptz not null default clock_timestamp(),
  check (physical_sku = upper(btrim(physical_sku))),
  check (btrim(product_name) <> '')
);

create table if not exists public.ecoflow_product_identity_batches (
  id uuid primary key default gen_random_uuid(),
  batch_name text not null,
  batch_status text not null default 'DRAFT'
    check (batch_status in ('DRAFT','REVIEW','PUBLISHED','CANCELLED')),
  revision bigint not null default 1 check (revision >= 1),
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null,
  updated_at timestamptz not null default clock_timestamp(),
  submitted_by uuid,
  submitted_at timestamptz,
  published_by uuid,
  published_at timestamptz,
  publication_note text,
  check (btrim(batch_name) <> '' and length(batch_name) <= 160)
);

create table if not exists public.ecoflow_product_identity_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.ecoflow_product_identity_batches(id) on delete restrict,
  barcode text not null,
  physical_sku text not null,
  product_name text not null,
  brand text,
  family_code text not null,
  family_name text not null,
  commercial_sku text not null,
  package_level text not null
    check (package_level in ('CARTON','SLEEVE','INNER','EACH')),
  units_per_barcode numeric not null
    check (units_per_barcode > 0 and units_per_barcode = trunc(units_per_barcode)),
  substitution_policy text not null
    check (substitution_policy in ('ALLOWED','APPROVAL_REQUIRED','PROHIBITED')),
  is_preferred boolean not null default false,
  item_state text not null default 'DRAFT'
    check (item_state in ('DRAFT','CONFLICT','REVIEW','VERIFIED','EXCLUDED')),
  conflict_codes text[] not null default '{}'::text[],
  note text,
  revision bigint not null default 1 check (revision >= 1),
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null,
  updated_at timestamptz not null default clock_timestamp(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  unique(batch_id, barcode),
  check (btrim(barcode) <> ''),
  check (physical_sku = upper(btrim(physical_sku))),
  check (family_code = upper(btrim(family_code))),
  check (commercial_sku = upper(btrim(commercial_sku))),
  check (btrim(product_name) <> ''),
  check (btrim(family_name) <> ''),
  check (not is_preferred or substitution_policy <> 'PROHIBITED')
);

create table if not exists public.ecoflow_commercial_physical_links (
  id uuid primary key default gen_random_uuid(),
  commercial_sku text not null,
  physical_sku_id uuid not null references public.ecoflow_physical_skus(id) on delete restrict,
  substitution_policy text not null
    check (substitution_policy in ('ALLOWED','APPROVAL_REQUIRED','PROHIBITED')),
  is_preferred boolean not null default false,
  link_status text not null default 'ACTIVE'
    check (link_status in ('ACTIVE','RETIRED')),
  revision bigint not null default 1 check (revision >= 1),
  source_batch_id uuid references public.ecoflow_product_identity_batches(id) on delete restrict,
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null,
  updated_at timestamptz not null default clock_timestamp(),
  unique(commercial_sku, physical_sku_id),
  check (commercial_sku = upper(btrim(commercial_sku))),
  check (not is_preferred or substitution_policy <> 'PROHIBITED')
);

create unique index if not exists uq_ecoflow_commercial_preferred_physical
  on public.ecoflow_commercial_physical_links(commercial_sku)
  where link_status = 'ACTIVE' and is_preferred;

create table if not exists public.ecoflow_product_identity_commands (
  command_id uuid primary key,
  command_type text not null,
  batch_id uuid references public.ecoflow_product_identity_batches(id) on delete restrict,
  item_id uuid references public.ecoflow_product_identity_batch_items(id) on delete restrict,
  result_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(result_payload) = 'object'),
  actor_user_id uuid not null,
  actor_role text not null,
  created_at timestamptz not null default clock_timestamp()
);

create table if not exists public.ecoflow_product_identity_events (
  event_id uuid primary key default gen_random_uuid(),
  command_id uuid not null unique,
  batch_id uuid references public.ecoflow_product_identity_batches(id) on delete restrict,
  item_id uuid references public.ecoflow_product_identity_batch_items(id) on delete restrict,
  event_type text not null,
  actor_user_id uuid not null,
  actor_role text not null,
  reason text,
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default clock_timestamp()
);

alter table public.ecoflow_sku_barcode_registry
  add column if not exists physical_sku_id uuid references public.ecoflow_physical_skus(id) on delete restrict,
  add column if not exists mapping_state text not null default 'UNVERIFIED'
    check (mapping_state in ('UNVERIFIED','DRAFT','CONFLICT','REVIEW','VERIFIED','RETIRED')),
  add column if not exists barcode_status text not null default 'ACTIVE'
    check (barcode_status in ('ACTIVE','HOLD','RETIRED')),
  add column if not exists revision bigint not null default 1 check (revision >= 1),
  add column if not exists verified_by uuid,
  add column if not exists verified_at timestamptz,
  add column if not exists retired_by uuid,
  add column if not exists retired_at timestamptz,
  add column if not exists source_batch_id uuid references public.ecoflow_product_identity_batches(id) on delete restrict,
  add column if not exists source_command_id uuid;

create index if not exists idx_ecoflow_barcode_registry_physical
  on public.ecoflow_sku_barcode_registry(physical_sku_id, barcode_status, mapping_state);
create index if not exists idx_ecoflow_product_identity_items_batch_state
  on public.ecoflow_product_identity_batch_items(batch_id, item_state, updated_at desc);
create index if not exists idx_ecoflow_product_identity_items_commercial
  on public.ecoflow_product_identity_batch_items(commercial_sku, updated_at desc);
create index if not exists idx_ecoflow_product_identity_links_commercial
  on public.ecoflow_commercial_physical_links(commercial_sku, link_status, is_preferred desc);
create index if not exists idx_ecoflow_product_identity_events_batch
  on public.ecoflow_product_identity_events(batch_id, created_at desc);

insert into public.ecoflow_physical_skus(
  physical_sku, product_name, brand, family_id, physical_status,
  revision, created_by, created_at, updated_by, updated_at
)
select
  upper(btrim(r.sku)),
  coalesce(max(nullif(btrim(r.product_name), '')), upper(btrim(r.sku))),
  null,
  null,
  'ACTIVE',
  1,
  '00000000-0000-0000-0000-000000000000'::uuid,
  min(r.first_scanned_at),
  '00000000-0000-0000-0000-000000000000'::uuid,
  max(r.last_scanned_at)
from public.ecoflow_sku_barcode_registry r
where nullif(btrim(r.sku), '') is not null
group by upper(btrim(r.sku))
on conflict (physical_sku) do nothing;

update public.ecoflow_sku_barcode_registry r
set physical_sku_id = p.id,
    mapping_state = case
      when coalesce(r.verified, false) and p.family_id is not null then 'VERIFIED'
      when coalesce(r.verified, false) then 'REVIEW'
      else 'UNVERIFIED'
    end,
    barcode_status = coalesce(r.barcode_status, 'ACTIVE')
from public.ecoflow_physical_skus p
where r.physical_sku_id is null
  and p.physical_sku = upper(btrim(r.sku));

alter table public.ecoflow_sku_families enable row level security;
alter table public.ecoflow_physical_skus enable row level security;
alter table public.ecoflow_product_identity_batches enable row level security;
alter table public.ecoflow_product_identity_batch_items enable row level security;
alter table public.ecoflow_commercial_physical_links enable row level security;
alter table public.ecoflow_product_identity_commands enable row level security;
alter table public.ecoflow_product_identity_events enable row level security;
alter table public.ecoflow_sku_barcode_registry enable row level security;

revoke all on public.ecoflow_sku_families from public, anon, authenticated;
revoke all on public.ecoflow_physical_skus from public, anon, authenticated;
revoke all on public.ecoflow_product_identity_batches from public, anon, authenticated;
revoke all on public.ecoflow_product_identity_batch_items from public, anon, authenticated;
revoke all on public.ecoflow_commercial_physical_links from public, anon, authenticated;
revoke all on public.ecoflow_product_identity_commands from public, anon, authenticated;
revoke all on public.ecoflow_product_identity_events from public, anon, authenticated;
revoke insert, update, delete on public.ecoflow_sku_barcode_registry from authenticated;

create or replace function public.ecoflow_prevent_product_identity_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
#variable_conflict use_variable
begin
  raise exception using errcode = '55000', message = 'PRODUCT_IDENTITY_EVENT_IMMUTABLE';
end;
$$;

drop trigger if exists trg_ecoflow_product_identity_event_immutable
  on public.ecoflow_product_identity_events;
create trigger trg_ecoflow_product_identity_event_immutable
before update or delete on public.ecoflow_product_identity_events
for each row execute function public.ecoflow_prevent_product_identity_event_mutation();

create or replace function public.ecoflow_require_product_identity_role(p_publish boolean default false)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_variable
declare
  v_role text := public.ecoflow_active_app_role();
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATED_USER_REQUIRED';
  end if;
  if p_publish and v_role not in ('OWNER','ADMIN') then
    raise exception using errcode = '42501', message = 'PRODUCT_IDENTITY_SUPERVISOR_REQUIRED';
  end if;
  if not p_publish and v_role not in ('OWNER','ADMIN','WAREHOUSE') then
    raise exception using errcode = '42501', message = 'PRODUCT_IDENTITY_CAPTURE_ROLE_REQUIRED';
  end if;
  return v_role;
end;
$$;

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
    upper(btrim(v.sku)) as commercial_sku,
    max(coalesce(nullif(btrim(v.product_name), ''), upper(btrim(v.sku)))) as product_name,
    max(coalesce(v.units_30d, 0))::numeric as units_30d,
    0::numeric as order_count_30d
  from public.v_ecoflow_owner_sku_velocity v
  where nullif(btrim(v.sku), '') is not null
    and (
      v_search is null
      or upper(v.sku) like '%' || v_search || '%'
      or upper(coalesce(v.product_name, '')) like '%' || v_search || '%'
    )
  group by upper(btrim(v.sku))
  order by max(coalesce(v.units_30d, 0)) desc, upper(btrim(v.sku))
  limit greatest(1, least(coalesce(p_limit, 300), 1000));
end;
$$;

create or replace function public.ecoflow_read_sku_family_options()
returns table(
  family_id uuid,
  family_code text,
  family_name text,
  description text,
  family_status text,
  revision bigint,
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
begin
  return query
  select f.id, f.family_code, f.family_name, f.description,
         f.family_status, f.revision, f.updated_at
  from public.ecoflow_sku_families f
  order by f.family_status, f.family_name, f.family_code;
end;
$$;

create or replace function public.ecoflow_read_physical_sku_options(
  p_search text default null,
  p_limit integer default 300
)
returns table(
  physical_sku_id uuid,
  physical_sku text,
  product_name text,
  brand text,
  family_code text,
  family_name text,
  physical_status text,
  revision bigint,
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
begin
  return query
  select p.id, p.physical_sku, p.product_name, p.brand,
         f.family_code, f.family_name, p.physical_status,
         p.revision, p.updated_at
  from public.ecoflow_physical_skus p
  left join public.ecoflow_sku_families f on f.id = p.family_id
  where v_search is null
     or p.physical_sku like '%' || v_search || '%'
     or upper(p.product_name) like '%' || v_search || '%'
     or upper(coalesce(p.brand, '')) like '%' || v_search || '%'
  order by p.physical_status, p.physical_sku
  limit greatest(1, least(coalesce(p_limit, 300), 1000));
end;
$$;

create or replace function public.ecoflow_read_product_identity_batch_items(p_batch_id uuid)
returns table(
  item_id uuid,
  batch_id uuid,
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
  item_state text,
  conflict_codes text[],
  note text,
  item_revision bigint,
  updated_at timestamptz,
  reviewed_at timestamptz,
  review_note text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_variable
declare
  v_role text := public.ecoflow_require_product_identity_role(false);
begin
  return query
  select i.id, i.batch_id, i.barcode, i.physical_sku, i.product_name,
         i.brand, i.family_code, i.family_name, i.commercial_sku,
         i.package_level, i.units_per_barcode, i.substitution_policy,
         i.is_preferred, i.item_state, i.conflict_codes, i.note,
         i.revision, i.updated_at, i.reviewed_at, i.review_note
  from public.ecoflow_product_identity_batch_items i
  where i.batch_id = p_batch_id
  order by
    case i.item_state
      when 'CONFLICT' then 0
      when 'REVIEW' then 1
      when 'DRAFT' then 2
      when 'VERIFIED' then 3
      else 4
    end,
    i.updated_at desc;
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
    select
      upper(btrim(v.sku)) as commercial_sku,
      max(coalesce(nullif(btrim(v.product_name), ''), upper(btrim(v.sku)))) as product_name
    from public.v_ecoflow_owner_sku_velocity v
    where nullif(btrim(v.sku), '') is not null
    group by upper(btrim(v.sku))
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
      greatest(coalesce(s.updated_at, '-infinity'::timestamptz), coalesce(p.updated_at, '-infinity'::timestamptz)) as updated_at
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
  limit greatest(1, least(coalesce(p_limit, 500), 2000));
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
    select distinct upper(btrim(v.sku)) as commercial_sku
    from public.v_ecoflow_owner_sku_velocity v
    where nullif(btrim(v.sku), '') is not null
  ),
  published as (
    select distinct l.commercial_sku
    from public.ecoflow_commercial_physical_links l
    where l.link_status = 'ACTIVE'
  ),
  staged as (
    select distinct i.commercial_sku
    from public.ecoflow_product_identity_batch_items i
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
    case when c.total_count = 0 then 0::numeric else round((c.covered_count::numeric * 100) / c.total_count::numeric, 1) end,
    (v_batch.id is not null and c.verified_count > 0 and c.conflict_count = 0 and c.review_count = 0 and c.covered_count >= c.total_count),
    v_batch.updated_by, v_batch.updated_at
  from counts c;
end;
$$;

create or replace view public.v_ecoflow_product_identity_barcode_lookup as
select
  r.barcode,
  p.physical_sku as sku,
  p.physical_sku,
  p.product_name,
  lower(r.package_level) as unit_level,
  r.units_per_barcode,
  c.fixed_shelf as fixed_location,
  r.package_level as pick_level,
  f.family_name as classification,
  f.family_code,
  l.commercial_sku,
  l.substitution_policy,
  l.is_preferred,
  r.barcode_status,
  p.physical_status as sku_status
from public.ecoflow_sku_barcode_registry r
join public.ecoflow_physical_skus p on p.id = r.physical_sku_id
join public.ecoflow_sku_families f on f.id = p.family_id
left join lateral (
  select link.commercial_sku, link.substitution_policy, link.is_preferred
  from public.ecoflow_commercial_physical_links link
  where link.physical_sku_id = p.id and link.link_status = 'ACTIVE'
  order by link.is_preferred desc, link.updated_at desc
  limit 1
) l on true
left join public.ecoflow_inventory_sku_controls c on c.sku = p.physical_sku
where r.mapping_state = 'VERIFIED'
  and r.barcode_status = 'ACTIVE'
  and p.physical_status = 'ACTIVE'
  and f.family_status = 'ACTIVE';

grant select on public.v_ecoflow_product_identity_barcode_lookup to authenticated;
grant execute on function public.ecoflow_read_commercial_sku_options(text, integer) to authenticated;
grant execute on function public.ecoflow_read_sku_family_options() to authenticated;
grant execute on function public.ecoflow_read_physical_sku_options(text, integer) to authenticated;
grant execute on function public.ecoflow_read_product_identity_batch_items(uuid) to authenticated;
grant execute on function public.ecoflow_read_product_identity_tasks(text, text, integer) to authenticated;
grant execute on function public.ecoflow_read_product_identity_readiness() to authenticated;

notify pgrst, 'reload schema';

commit;
