-- Canonical Product Identity authority for EcoFlow commissioning and warehouse execution.
--
-- Commercial identity remains public.skus / external_product_mappings.
-- Physical identity is deliberately separate and is never inferred from legacy barcode data.
-- Publishing identity changes never changes inventory quantity.

begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Commissioning batches
-- ---------------------------------------------------------------------------

create table if not exists public.ecoflow_product_identity_batches (
  id uuid primary key default extensions.gen_random_uuid(),
  batch_name text not null,
  batch_status text not null default 'DRAFT'
    check (batch_status in ('DRAFT','SUBMITTED','PUBLISHED','CANCELLED')),
  revision bigint not null default 0 check (revision >= 0),
  start_command_id uuid not null unique,
  submit_command_id uuid unique,
  publish_command_id uuid unique,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  submitted_by uuid,
  submitted_at timestamptz,
  published_by uuid,
  published_at timestamptz,
  cancelled_by uuid,
  cancelled_at timestamptz,
  note text,
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_ecoflow_product_identity_one_open_batch
  on public.ecoflow_product_identity_batches ((true))
  where batch_status in ('DRAFT','SUBMITTED');

-- ---------------------------------------------------------------------------
-- Canonical physical product model
-- ---------------------------------------------------------------------------

create table if not exists public.ecoflow_sku_families (
  id uuid primary key default extensions.gen_random_uuid(),
  family_code text not null,
  family_name text not null,
  description text,
  identity_status text not null default 'DRAFT'
    check (identity_status in ('DRAFT','ACTIVE','RETIRED')),
  revision bigint not null default 0 check (revision >= 0),
  created_in_batch_id uuid references public.ecoflow_product_identity_batches(id),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  retired_by uuid,
  retired_at timestamptz,
  retirement_reason text
);

create unique index if not exists uq_ecoflow_sku_families_code_ci
  on public.ecoflow_sku_families (lower(family_code));
create index if not exists idx_ecoflow_sku_families_status
  on public.ecoflow_sku_families(identity_status,family_name);

create table if not exists public.ecoflow_physical_skus (
  id uuid primary key default extensions.gen_random_uuid(),
  physical_sku_code text not null,
  display_name text not null,
  brand text,
  supplier_name text,
  manufacturer_code text,
  family_id uuid not null references public.ecoflow_sku_families(id),
  identity_status text not null default 'DRAFT'
    check (identity_status in ('DRAFT','ACTIVE','RETIRED')),
  revision bigint not null default 0 check (revision >= 0),
  created_in_batch_id uuid references public.ecoflow_product_identity_batches(id),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  retired_by uuid,
  retired_at timestamptz,
  retirement_reason text
);

create unique index if not exists uq_ecoflow_physical_skus_code_ci
  on public.ecoflow_physical_skus(lower(physical_sku_code));
create index if not exists idx_ecoflow_physical_skus_family
  on public.ecoflow_physical_skus(family_id,identity_status,display_name);

create table if not exists public.ecoflow_physical_sku_packages (
  id uuid primary key default extensions.gen_random_uuid(),
  physical_sku_id uuid not null references public.ecoflow_physical_skus(id),
  package_level text not null
    check (package_level in ('CARTON','SLEEVE','INNER','EACH','PALLET')),
  units_in_base_unit numeric(18,4) not null
    check (units_in_base_unit > 0 and units_in_base_unit = trunc(units_in_base_unit)),
  identity_status text not null default 'DRAFT'
    check (identity_status in ('DRAFT','ACTIVE','RETIRED')),
  revision bigint not null default 0 check (revision >= 0),
  created_in_batch_id uuid references public.ecoflow_product_identity_batches(id),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  active_from timestamptz,
  retired_by uuid,
  retired_at timestamptz,
  retirement_reason text
);

create unique index if not exists uq_ecoflow_physical_package_active
  on public.ecoflow_physical_sku_packages(physical_sku_id,package_level)
  where identity_status='ACTIVE';
create unique index if not exists uq_ecoflow_physical_package_draft_batch
  on public.ecoflow_physical_sku_packages(created_in_batch_id,physical_sku_id,package_level)
  where identity_status='DRAFT';

create table if not exists public.ecoflow_physical_barcode_bindings (
  id uuid primary key default extensions.gen_random_uuid(),
  barcode text not null,
  physical_sku_id uuid not null references public.ecoflow_physical_skus(id),
  package_id uuid not null references public.ecoflow_physical_sku_packages(id),
  identity_status text not null default 'DRAFT'
    check (identity_status in ('DRAFT','ACTIVE','RETIRED')),
  source text not null default 'WAREHOUSE_COMMISSIONING',
  revision bigint not null default 0 check (revision >= 0),
  created_in_batch_id uuid references public.ecoflow_product_identity_batches(id),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  active_from timestamptz,
  retired_by uuid,
  retired_at timestamptz,
  retirement_reason text,
  replaced_by_binding_id uuid references public.ecoflow_physical_barcode_bindings(id)
);

-- A barcode may have historical rows, but at most one current published owner.
create unique index if not exists uq_ecoflow_physical_barcode_active
  on public.ecoflow_physical_barcode_bindings(barcode)
  where identity_status='ACTIVE';
create index if not exists idx_ecoflow_physical_barcode_history
  on public.ecoflow_physical_barcode_bindings(barcode,created_at desc);
create index if not exists idx_ecoflow_physical_barcode_physical
  on public.ecoflow_physical_barcode_bindings(physical_sku_id,identity_status);

-- One active family contract per Commercial SKU. The family defines the allowed
-- substitution pool; preferred_physical_sku_id is the default warehouse choice.
create table if not exists public.ecoflow_commercial_family_links (
  id uuid primary key default extensions.gen_random_uuid(),
  commercial_sku_id uuid not null references public.skus(id),
  family_id uuid not null references public.ecoflow_sku_families(id),
  preferred_physical_sku_id uuid not null references public.ecoflow_physical_skus(id),
  substitution_policy text not null
    check (substitution_policy in ('ALLOWED','APPROVAL_REQUIRED','PROHIBITED')),
  identity_status text not null default 'DRAFT'
    check (identity_status in ('DRAFT','ACTIVE','RETIRED')),
  revision bigint not null default 0 check (revision >= 0),
  created_in_batch_id uuid references public.ecoflow_product_identity_batches(id),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  active_from timestamptz,
  retired_by uuid,
  retired_at timestamptz,
  retirement_reason text
);

create unique index if not exists uq_ecoflow_commercial_family_active
  on public.ecoflow_commercial_family_links(commercial_sku_id)
  where identity_status='ACTIVE';
create unique index if not exists uq_ecoflow_commercial_family_draft_batch
  on public.ecoflow_commercial_family_links(created_in_batch_id,commercial_sku_id)
  where identity_status='DRAFT';

-- ---------------------------------------------------------------------------
-- Commissioning work / evidence. Observations are append-only and commands are
-- idempotent. A conflict remains visible even after a later successful capture.
-- ---------------------------------------------------------------------------

create table if not exists public.ecoflow_product_identity_tasks (
  id uuid primary key default extensions.gen_random_uuid(),
  task_key text not null unique,
  task_type text not null
    check (task_type in ('COMMERCIAL_SKU_MAPPING','UNKNOWN_BARCODE','BARCODE_CONFLICT','PHYSICAL_BARCODE')),
  commercial_sku_id uuid references public.skus(id),
  barcode text,
  batch_id uuid references public.ecoflow_product_identity_batches(id),
  task_status text not null default 'OPEN'
    check (task_status in ('OPEN','DRAFT_READY','CONFLICT','RESOLVED','CANCELLED')),
  blocking boolean not null default true,
  source text not null default 'COMMISSIONING',
  detail text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_by uuid,
  resolved_at timestamptz
);

create index if not exists idx_ecoflow_product_identity_tasks_queue
  on public.ecoflow_product_identity_tasks(task_status,blocking,updated_at desc);
create index if not exists idx_ecoflow_product_identity_tasks_batch
  on public.ecoflow_product_identity_tasks(batch_id,task_status);

create table if not exists public.ecoflow_product_identity_observations (
  id uuid primary key default extensions.gen_random_uuid(),
  batch_id uuid not null references public.ecoflow_product_identity_batches(id),
  command_id uuid not null unique,
  commercial_sku_id uuid not null references public.skus(id),
  physical_sku_id uuid references public.ecoflow_physical_skus(id),
  family_id uuid references public.ecoflow_sku_families(id),
  barcode text not null,
  package_level text not null,
  units_in_base_unit numeric(18,4) not null,
  substitution_policy text not null,
  is_preferred boolean not null default true,
  observation_status text not null
    check (observation_status in ('DRAFTED','CONFLICT')),
  detail text not null,
  payload jsonb not null,
  captured_by uuid not null default auth.uid(),
  captured_at timestamptz not null default now()
);

create index if not exists idx_ecoflow_product_identity_observations_batch
  on public.ecoflow_product_identity_observations(batch_id,captured_at desc);
create index if not exists idx_ecoflow_product_identity_observations_barcode
  on public.ecoflow_product_identity_observations(barcode,captured_at desc);

-- ---------------------------------------------------------------------------
-- Access envelope. Direct writes are forbidden; all changes pass through RPCs.
-- ---------------------------------------------------------------------------

create or replace function public.ecoflow_can_read_product_identity()
returns boolean
language sql stable security definer set search_path=pg_catalog,public
as $$
  select auth.uid() is not null
    and public.ecoflow_active_app_role() in ('OWNER','ADMIN','ACCOUNT','VIEWER','WAREHOUSE');
$$;

create or replace function public.ecoflow_can_capture_product_identity()
returns boolean
language sql stable security definer set search_path=pg_catalog,public
as $$
  select auth.uid() is not null
    and public.ecoflow_active_app_role() in ('OWNER','ADMIN','WAREHOUSE');
$$;

create or replace function public.ecoflow_can_publish_product_identity()
returns boolean
language sql stable security definer set search_path=pg_catalog,public
as $$
  select auth.uid() is not null
    and public.ecoflow_active_app_role() in ('OWNER','ADMIN');
$$;

alter table public.ecoflow_product_identity_batches enable row level security;
alter table public.ecoflow_sku_families enable row level security;
alter table public.ecoflow_physical_skus enable row level security;
alter table public.ecoflow_physical_sku_packages enable row level security;
alter table public.ecoflow_physical_barcode_bindings enable row level security;
alter table public.ecoflow_commercial_family_links enable row level security;
alter table public.ecoflow_product_identity_tasks enable row level security;
alter table public.ecoflow_product_identity_observations enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'ecoflow_product_identity_batches','ecoflow_sku_families','ecoflow_physical_skus',
    'ecoflow_physical_sku_packages','ecoflow_physical_barcode_bindings','ecoflow_commercial_family_links',
    'ecoflow_product_identity_tasks','ecoflow_product_identity_observations'
  ] loop
    execute format('drop policy if exists %I on public.%I','product_identity_read_'||t,t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.ecoflow_can_read_product_identity())',
      'product_identity_read_'||t,t
    );
    execute format('revoke insert,update,delete on public.%I from anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('revoke all on public.%I from anon',t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Current tasks are seeded as evidence gaps only. Existing legacy barcodes are
-- intentionally not promoted to physical truth.
-- ---------------------------------------------------------------------------

insert into public.ecoflow_product_identity_tasks(
  task_key,task_type,commercial_sku_id,task_status,blocking,source,detail
)
select
  'COMMERCIAL:'||s.id::text,
  'COMMERCIAL_SKU_MAPPING',
  s.id,
  case when exists(
    select 1 from public.ecoflow_commercial_family_links l
    where l.commercial_sku_id=s.id and l.identity_status='ACTIVE'
  ) then 'RESOLVED' else 'OPEN' end,
  true,
  'COMMERCIAL_CATALOG',
  'Confirm the physical SKU, SKU Family, package barcode and substitution policy before warehouse go-live.'
from public.skus s
where exists(
  select 1 from public.external_product_mappings m
  where m.internal_sku_id=s.id and m.provider='ORDERMENTUM' and m.is_active
)
and not exists(
  select 1
  from public.external_product_mappings m
  join public.ecoflow_sku_master_overrides o on o.external_sku_code=m.external_product_code
  where m.internal_sku_id=s.id and m.provider='ORDERMENTUM' and m.is_active
    and coalesce(o.is_service_item,false)=true
)
on conflict(task_key) do update set
  commercial_sku_id=excluded.commercial_sku_id,
  task_status=case
    when public.ecoflow_product_identity_tasks.task_status='RESOLVED' then 'RESOLVED'
    else excluded.task_status
  end,
  detail=excluded.detail,
  updated_at=now();

-- ---------------------------------------------------------------------------
-- Batch lifecycle
-- ---------------------------------------------------------------------------

create or replace function public.ecoflow_start_product_identity_batch(
  p_batch_name text,
  p_command_id uuid
)
returns table(
  batch_id uuid,batch_name text,batch_status text,revision bigint,command_status text,created_at timestamptz
)
language plpgsql security definer set search_path=pg_catalog,public
as $$
declare
  v_name text:=coalesce(nullif(btrim(p_batch_name),''),'Warehouse product identity commissioning');
  v_batch public.ecoflow_product_identity_batches%rowtype;
begin
  if not public.ecoflow_can_capture_product_identity() then
    raise exception using errcode='42501',message='OWNER_ADMIN_OR_WAREHOUSE_REQUIRED';
  end if;
  if p_command_id is null then raise exception 'PRODUCT_IDENTITY_COMMAND_ID_REQUIRED'; end if;

  select b.* into v_batch from public.ecoflow_product_identity_batches b
  where b.start_command_id=p_command_id;
  if found then
    return query select v_batch.id,v_batch.batch_name,v_batch.batch_status,v_batch.revision,'REPLAYED'::text,v_batch.created_at;
    return;
  end if;

  select b.* into v_batch from public.ecoflow_product_identity_batches b
  where b.batch_status in ('DRAFT','SUBMITTED')
  order by b.created_at desc limit 1 for update;
  if found then
    return query select v_batch.id,v_batch.batch_name,v_batch.batch_status,v_batch.revision,'EXISTING'::text,v_batch.created_at;
    return;
  end if;

  insert into public.ecoflow_product_identity_batches(batch_name,start_command_id,created_by)
  values(v_name,p_command_id,auth.uid()) returning * into v_batch;

  -- Attach every unresolved catalog task to this batch; new batches therefore
  -- automatically pick up Commercial SKUs added since the previous publication.
  insert into public.ecoflow_product_identity_tasks(
    task_key,task_type,commercial_sku_id,batch_id,task_status,blocking,source,detail
  )
  select
    'COMMERCIAL:'||s.id::text,'COMMERCIAL_SKU_MAPPING',s.id,v_batch.id,
    case when exists(
      select 1 from public.ecoflow_commercial_family_links l
      where l.commercial_sku_id=s.id and l.identity_status='ACTIVE'
    ) then 'RESOLVED' else 'OPEN' end,
    true,'COMMERCIAL_CATALOG',
    'Confirm the physical SKU, SKU Family, package barcode and substitution policy before warehouse go-live.'
  from public.skus s
  where exists(
    select 1 from public.external_product_mappings m
    where m.internal_sku_id=s.id and m.provider='ORDERMENTUM' and m.is_active
  )
  and not exists(
    select 1 from public.external_product_mappings m
    join public.ecoflow_sku_master_overrides o on o.external_sku_code=m.external_product_code
    where m.internal_sku_id=s.id and m.provider='ORDERMENTUM' and m.is_active
      and coalesce(o.is_service_item,false)=true
  )
  on conflict(task_key) do update set
    batch_id=case
      when public.ecoflow_product_identity_tasks.task_status='RESOLVED' then public.ecoflow_product_identity_tasks.batch_id
      else excluded.batch_id
    end,
    task_status=case
      when public.ecoflow_product_identity_tasks.task_status='RESOLVED' then 'RESOLVED'
      else excluded.task_status
    end,
    detail=excluded.detail,
    updated_at=now();

  return query select v_batch.id,v_batch.batch_name,v_batch.batch_status,v_batch.revision,'APPLIED'::text,v_batch.created_at;
end;
$$;

create or replace function public.ecoflow_read_current_product_identity_batch()
returns table(
  batch_id uuid,batch_name text,batch_status text,revision bigint,created_at timestamptz,
  submitted_at timestamptz,published_at timestamptz,
  open_tasks bigint,draft_ready_tasks bigint,conflict_tasks bigint,resolved_tasks bigint,
  can_submit boolean,can_publish boolean,read_at timestamptz
)
language sql stable security definer set search_path=pg_catalog,public
as $$
  with chosen as (
    select b.*
    from public.ecoflow_product_identity_batches b
    where b.batch_status in ('DRAFT','SUBMITTED')
    order by b.created_at desc limit 1
  ), counts as (
    select
      c.id,
      count(*) filter(where t.task_status='OPEN' and t.blocking)::bigint as open_tasks,
      count(*) filter(where t.task_status='DRAFT_READY')::bigint as draft_ready_tasks,
      count(*) filter(where t.task_status='CONFLICT' and t.blocking)::bigint as conflict_tasks,
      count(*) filter(where t.task_status='RESOLVED')::bigint as resolved_tasks
    from chosen c
    left join public.ecoflow_product_identity_tasks t on t.batch_id=c.id
    group by c.id
  )
  select
    c.id,c.batch_name,c.batch_status,c.revision,c.created_at,c.submitted_at,c.published_at,
    coalesce(x.open_tasks,0),coalesce(x.draft_ready_tasks,0),coalesce(x.conflict_tasks,0),coalesce(x.resolved_tasks,0),
    c.batch_status='DRAFT' and coalesce(x.open_tasks,0)=0 and coalesce(x.conflict_tasks,0)=0 and coalesce(x.draft_ready_tasks,0)>0,
    c.batch_status='SUBMITTED' and coalesce(x.open_tasks,0)=0 and coalesce(x.conflict_tasks,0)=0,
    statement_timestamp()
  from chosen c left join counts x on x.id=c.id
  where public.ecoflow_can_read_product_identity();
$$;

-- ---------------------------------------------------------------------------
-- Capture one physical observation. This is mapping-only: no inventory ledger,
-- stocktake, receiving or pick quantity table is touched.
-- ---------------------------------------------------------------------------

create or replace function public.ecoflow_capture_product_identity(
  p_batch_id uuid,
  p_command_id uuid,
  p_commercial_sku_id uuid,
  p_physical_sku_code text,
  p_physical_name text,
  p_brand text,
  p_supplier_name text,
  p_family_code text,
  p_family_name text,
  p_barcode text,
  p_package_level text,
  p_units_in_base_unit numeric,
  p_substitution_policy text,
  p_is_preferred boolean default true,
  p_note text default null
)
returns table(
  observation_id uuid,command_id uuid,capture_status text,detail text,
  commercial_sku_id uuid,physical_sku_id uuid,family_id uuid,barcode text,package_level text
)
language plpgsql security definer set search_path=pg_catalog,public
as $$
declare
  v_batch public.ecoflow_product_identity_batches%rowtype;
  v_existing_observation public.ecoflow_product_identity_observations%rowtype;
  v_family public.ecoflow_sku_families%rowtype;
  v_physical public.ecoflow_physical_skus%rowtype;
  v_package public.ecoflow_physical_sku_packages%rowtype;
  v_active_binding public.ecoflow_physical_barcode_bindings%rowtype;
  v_draft_binding public.ecoflow_physical_barcode_bindings%rowtype;
  v_active_link public.ecoflow_commercial_family_links%rowtype;
  v_draft_link public.ecoflow_commercial_family_links%rowtype;
  v_family_code text:=upper(nullif(btrim(coalesce(p_family_code,'')),''));
  v_family_name text:=nullif(btrim(coalesce(p_family_name,'')),'');
  v_physical_code text:=upper(nullif(btrim(coalesce(p_physical_sku_code,'')),''));
  v_physical_name text:=nullif(btrim(coalesce(p_physical_name,'')),'');
  v_barcode text:=nullif(btrim(coalesce(p_barcode,'')),'');
  v_level text:=upper(nullif(btrim(coalesce(p_package_level,'')),''));
  v_policy text:=upper(nullif(btrim(coalesce(p_substitution_policy,'')),''));
  v_payload jsonb;
  v_observation_id uuid;
  v_detail text;
  v_link_needed boolean:=coalesce(p_is_preferred,true);
begin
  if not public.ecoflow_can_capture_product_identity() then
    raise exception using errcode='42501',message='OWNER_ADMIN_OR_WAREHOUSE_REQUIRED';
  end if;
  if p_batch_id is null or p_command_id is null or p_commercial_sku_id is null then
    raise exception 'BATCH_COMMAND_AND_COMMERCIAL_SKU_REQUIRED';
  end if;
  if v_family_code is null or v_family_name is null then raise exception 'SKU_FAMILY_CODE_AND_NAME_REQUIRED'; end if;
  if v_physical_code is null or v_physical_name is null then raise exception 'PHYSICAL_SKU_CODE_AND_NAME_REQUIRED'; end if;
  if v_barcode is null then raise exception 'PHYSICAL_BARCODE_REQUIRED'; end if;
  if v_level not in ('CARTON','SLEEVE','INNER','EACH','PALLET') then raise exception 'VALID_PACKAGE_LEVEL_REQUIRED'; end if;
  if coalesce(p_units_in_base_unit,0)<=0 or p_units_in_base_unit<>trunc(p_units_in_base_unit) then
    raise exception 'PACKAGE_UNITS_MUST_BE_POSITIVE_WHOLE_NUMBER';
  end if;
  if v_policy not in ('ALLOWED','APPROVAL_REQUIRED','PROHIBITED') then raise exception 'VALID_SUBSTITUTION_POLICY_REQUIRED'; end if;
  if not exists(select 1 from public.skus s where s.id=p_commercial_sku_id) then raise exception 'COMMERCIAL_SKU_NOT_FOUND'; end if;

  v_payload:=jsonb_build_object(
    'batchId',p_batch_id,'commercialSkuId',p_commercial_sku_id,
    'physicalSkuCode',v_physical_code,'physicalName',v_physical_name,
    'brand',nullif(btrim(coalesce(p_brand,'')),''),'supplier',nullif(btrim(coalesce(p_supplier_name,'')),''),
    'familyCode',v_family_code,'familyName',v_family_name,
    'barcode',v_barcode,'packageLevel',v_level,'units',p_units_in_base_unit,
    'policy',v_policy,'preferred',coalesce(p_is_preferred,true),'note',nullif(btrim(coalesce(p_note,'')),'')
  );

  select o.* into v_existing_observation
  from public.ecoflow_product_identity_observations o where o.command_id=p_command_id;
  if found then
    if v_existing_observation.payload<>v_payload then raise exception 'PRODUCT_IDENTITY_IDEMPOTENCY_KEY_REUSE'; end if;
    return query select
      v_existing_observation.id,v_existing_observation.command_id,v_existing_observation.observation_status,
      v_existing_observation.detail,v_existing_observation.commercial_sku_id,v_existing_observation.physical_sku_id,
      v_existing_observation.family_id,v_existing_observation.barcode,v_existing_observation.package_level;
    return;
  end if;

  select b.* into v_batch
  from public.ecoflow_product_identity_batches b where b.id=p_batch_id for update;
  if not found then raise exception 'PRODUCT_IDENTITY_BATCH_NOT_FOUND'; end if;
  if v_batch.batch_status<>'DRAFT' then raise exception 'PRODUCT_IDENTITY_BATCH_NOT_EDITABLE'; end if;

  -- Active barcode collisions are fail-closed. Legacy registry rows are only
  -- evidence; they never become canonical owners automatically.
  select b.* into v_active_binding
  from public.ecoflow_physical_barcode_bindings b
  where b.barcode=v_barcode and b.identity_status='ACTIVE'
  for update;

  if found then
    select p.* into v_physical from public.ecoflow_physical_skus p where p.id=v_active_binding.physical_sku_id;
    select pk.* into v_package from public.ecoflow_physical_sku_packages pk where pk.id=v_active_binding.package_id;
    if upper(v_physical.physical_sku_code)<>v_physical_code
      or v_package.package_level<>v_level
      or v_package.units_in_base_unit<>p_units_in_base_unit then
      v_detail:='Barcode is already published to '||v_physical.physical_sku_code||' / '||v_package.package_level||'. Owner/Admin must explicitly retire the current mapping before reassignment.';
      insert into public.ecoflow_product_identity_observations(
        batch_id,command_id,commercial_sku_id,physical_sku_id,family_id,barcode,package_level,units_in_base_unit,
        substitution_policy,is_preferred,observation_status,detail,payload,captured_by
      ) values(
        p_batch_id,p_command_id,p_commercial_sku_id,v_active_binding.physical_sku_id,v_physical.family_id,
        v_barcode,v_level,p_units_in_base_unit,v_policy,coalesce(p_is_preferred,true),'CONFLICT',v_detail,v_payload,auth.uid()
      ) returning id into v_observation_id;

      insert into public.ecoflow_product_identity_tasks(
        task_key,task_type,commercial_sku_id,barcode,batch_id,task_status,blocking,source,detail
      ) values(
        'BARCODE:'||v_barcode,'BARCODE_CONFLICT',p_commercial_sku_id,v_barcode,p_batch_id,'CONFLICT',true,'CANONICAL_BARCODE',v_detail
      ) on conflict(task_key) do update set
        batch_id=excluded.batch_id,commercial_sku_id=excluded.commercial_sku_id,task_status='CONFLICT',
        blocking=true,detail=excluded.detail,updated_at=now(),resolved_by=null,resolved_at=null;

      return query select v_observation_id,p_command_id,'CONFLICT'::text,v_detail,p_commercial_sku_id,
        v_active_binding.physical_sku_id,v_physical.family_id,v_barcode,v_level;
      return;
    end if;
  end if;

  -- A retired barcode previously owned by a different physical SKU is also a
  -- conflict: history is append-only and code reuse requires explicit review.
  if not found and exists(
    select 1 from public.ecoflow_physical_barcode_bindings b
    join public.ecoflow_physical_skus p on p.id=b.physical_sku_id
    where b.barcode=v_barcode and b.identity_status='RETIRED'
      and upper(p.physical_sku_code)<>v_physical_code
  ) then
    v_detail:='Barcode exists in retired history for a different Physical SKU. Reuse is blocked until Owner/Admin review.';
    insert into public.ecoflow_product_identity_observations(
      batch_id,command_id,commercial_sku_id,barcode,package_level,units_in_base_unit,substitution_policy,
      is_preferred,observation_status,detail,payload,captured_by
    ) values(
      p_batch_id,p_command_id,p_commercial_sku_id,v_barcode,v_level,p_units_in_base_unit,v_policy,
      coalesce(p_is_preferred,true),'CONFLICT',v_detail,v_payload,auth.uid()
    ) returning id into v_observation_id;
    insert into public.ecoflow_product_identity_tasks(
      task_key,task_type,commercial_sku_id,barcode,batch_id,task_status,blocking,source,detail
    ) values(
      'BARCODE:'||v_barcode,'BARCODE_CONFLICT',p_commercial_sku_id,v_barcode,p_batch_id,'CONFLICT',true,'BARCODE_HISTORY',v_detail
    ) on conflict(task_key) do update set
      batch_id=excluded.batch_id,commercial_sku_id=excluded.commercial_sku_id,task_status='CONFLICT',
      blocking=true,detail=excluded.detail,updated_at=now(),resolved_by=null,resolved_at=null;
    return query select v_observation_id,p_command_id,'CONFLICT'::text,v_detail,p_commercial_sku_id,
      null::uuid,null::uuid,v_barcode,v_level;
    return;
  end if;

  -- Resolve or create the family. ACTIVE families are immutable from capture;
  -- DRAFT rows may only be edited by the batch that created them.
  select f.* into v_family from public.ecoflow_sku_families f where lower(f.family_code)=lower(v_family_code) for update;
  if found then
    if v_family.identity_status='RETIRED' then raise exception 'SKU_FAMILY_RETIRED'; end if;
    if v_family.identity_status='DRAFT' and v_family.created_in_batch_id<>p_batch_id then raise exception 'SKU_FAMILY_DRAFT_OWNED_BY_OTHER_BATCH'; end if;
    if v_family.identity_status='DRAFT' then
      update public.ecoflow_sku_families f set family_name=v_family_name,updated_by=auth.uid(),updated_at=now()
      where f.id=v_family.id returning * into v_family;
    end if;
  else
    insert into public.ecoflow_sku_families(
      family_code,family_name,identity_status,created_in_batch_id,created_by,updated_by
    ) values(v_family_code,v_family_name,'DRAFT',p_batch_id,auth.uid(),auth.uid()) returning * into v_family;
  end if;

  -- Resolve or create the physical SKU.
  select p.* into v_physical from public.ecoflow_physical_skus p where lower(p.physical_sku_code)=lower(v_physical_code) for update;
  if found then
    if v_physical.identity_status='RETIRED' then raise exception 'PHYSICAL_SKU_RETIRED'; end if;
    if v_physical.family_id<>v_family.id then raise exception 'PHYSICAL_SKU_FAMILY_CONFLICT'; end if;
    if v_physical.identity_status='DRAFT' and v_physical.created_in_batch_id<>p_batch_id then raise exception 'PHYSICAL_SKU_DRAFT_OWNED_BY_OTHER_BATCH'; end if;
    if v_physical.identity_status='DRAFT' then
      update public.ecoflow_physical_skus p set
        display_name=v_physical_name,
        brand=coalesce(nullif(btrim(coalesce(p_brand,'')),''),p.brand),
        supplier_name=coalesce(nullif(btrim(coalesce(p_supplier_name,'')),''),p.supplier_name),
        updated_by=auth.uid(),updated_at=now()
      where p.id=v_physical.id returning * into v_physical;
    end if;
  else
    insert into public.ecoflow_physical_skus(
      physical_sku_code,display_name,brand,supplier_name,family_id,identity_status,
      created_in_batch_id,created_by,updated_by
    ) values(
      v_physical_code,v_physical_name,nullif(btrim(coalesce(p_brand,'')),''),nullif(btrim(coalesce(p_supplier_name,'')),''),
      v_family.id,'DRAFT',p_batch_id,auth.uid(),auth.uid()
    ) returning * into v_physical;
  end if;

  -- Package conversion is versioned. A changed conversion creates a DRAFT
  -- replacement; publication retires the old ACTIVE package atomically.
  select pk.* into v_package from public.ecoflow_physical_sku_packages pk
  where pk.created_in_batch_id=p_batch_id and pk.physical_sku_id=v_physical.id
    and pk.package_level=v_level and pk.identity_status='DRAFT' for update;
  if found then
    update public.ecoflow_physical_sku_packages pk
    set units_in_base_unit=p_units_in_base_unit
    where pk.id=v_package.id returning * into v_package;
  else
    select pk.* into v_package from public.ecoflow_physical_sku_packages pk
    where pk.physical_sku_id=v_physical.id and pk.package_level=v_level and pk.identity_status='ACTIVE'
    limit 1;
    if not found or v_package.units_in_base_unit<>p_units_in_base_unit then
      insert into public.ecoflow_physical_sku_packages(
        physical_sku_id,package_level,units_in_base_unit,identity_status,created_in_batch_id,created_by
      ) values(v_physical.id,v_level,p_units_in_base_unit,'DRAFT',p_batch_id,auth.uid()) returning * into v_package;
    end if;
  end if;

  -- Another DRAFT in this batch cannot claim the same barcode for a different item.
  select b.* into v_draft_binding from public.ecoflow_physical_barcode_bindings b
  where b.created_in_batch_id=p_batch_id and b.barcode=v_barcode and b.identity_status='DRAFT' for update;
  if found and (v_draft_binding.physical_sku_id<>v_physical.id or v_draft_binding.package_id<>v_package.id) then
    raise exception 'BARCODE_CONFLICT_INSIDE_COMMISSIONING_BATCH';
  end if;

  if not found and v_active_binding.id is null then
    insert into public.ecoflow_physical_barcode_bindings(
      barcode,physical_sku_id,package_id,identity_status,source,created_in_batch_id,created_by
    ) values(v_barcode,v_physical.id,v_package.id,'DRAFT','WAREHOUSE_COMMISSIONING',p_batch_id,auth.uid())
    returning * into v_draft_binding;
  end if;

  -- Create/update the Commercial SKU family contract when this capture is the
  -- preferred item. Alternative physical items inherit the family's policy and
  -- therefore do not silently replace the preferred physical SKU.
  select l.* into v_draft_link from public.ecoflow_commercial_family_links l
  where l.created_in_batch_id=p_batch_id and l.commercial_sku_id=p_commercial_sku_id and l.identity_status='DRAFT'
  for update;
  if found then
    if v_draft_link.family_id<>v_family.id then raise exception 'COMMERCIAL_SKU_FAMILY_CONFLICT_INSIDE_BATCH'; end if;
    if v_link_needed then
      update public.ecoflow_commercial_family_links l set
        preferred_physical_sku_id=v_physical.id,substitution_policy=v_policy
      where l.id=v_draft_link.id returning * into v_draft_link;
    end if;
  else
    select l.* into v_active_link from public.ecoflow_commercial_family_links l
    where l.commercial_sku_id=p_commercial_sku_id and l.identity_status='ACTIVE' limit 1;
    if not v_link_needed then
      if not found or v_active_link.family_id<>v_family.id then raise exception 'PREFERRED_PHYSICAL_SKU_REQUIRED_BEFORE_ALTERNATIVE'; end if;
    else
      insert into public.ecoflow_commercial_family_links(
        commercial_sku_id,family_id,preferred_physical_sku_id,substitution_policy,
        identity_status,created_in_batch_id,created_by
      ) values(
        p_commercial_sku_id,v_family.id,v_physical.id,v_policy,'DRAFT',p_batch_id,auth.uid()
      ) returning * into v_draft_link;
    end if;
  end if;

  v_detail:=case
    when v_link_needed then 'Draft physical identity captured. Inventory quantity was not changed.'
    else 'Draft family alternative captured. Preferred Commercial SKU mapping was not replaced.'
  end;

  insert into public.ecoflow_product_identity_observations(
    batch_id,command_id,commercial_sku_id,physical_sku_id,family_id,barcode,package_level,
    units_in_base_unit,substitution_policy,is_preferred,observation_status,detail,payload,captured_by
  ) values(
    p_batch_id,p_command_id,p_commercial_sku_id,v_physical.id,v_family.id,v_barcode,v_level,
    p_units_in_base_unit,v_policy,coalesce(p_is_preferred,true),'DRAFTED',v_detail,v_payload,auth.uid()
  ) returning id into v_observation_id;

  if v_link_needed then
    update public.ecoflow_product_identity_tasks t
    set task_status='DRAFT_READY',batch_id=p_batch_id,detail='Draft mapping captured; submit and publish after all blocking checks pass.',
        updated_at=now(),resolved_by=null,resolved_at=null
    where t.task_key='COMMERCIAL:'||p_commercial_sku_id::text;
  end if;

  update public.ecoflow_product_identity_tasks t
  set task_status='DRAFT_READY',batch_id=p_batch_id,detail='Replacement mapping captured; publish to resolve barcode conflict.',
      updated_at=now(),resolved_by=null,resolved_at=null
  where t.task_key='BARCODE:'||v_barcode and t.task_status='CONFLICT';

  update public.ecoflow_product_identity_batches b
  set revision=b.revision+1,updated_at=now()
  where b.id=p_batch_id;

  return query select v_observation_id,p_command_id,'DRAFTED'::text,v_detail,p_commercial_sku_id,
    v_physical.id,v_family.id,v_barcode,v_level;
end;
$$;

create or replace function public.ecoflow_submit_product_identity_batch(
  p_batch_id uuid,p_expected_revision bigint,p_command_id uuid,p_note text default null
)
returns table(batch_id uuid,batch_status text,revision bigint,command_status text,submitted_at timestamptz)
language plpgsql security definer set search_path=pg_catalog,public
as $$
declare v_batch public.ecoflow_product_identity_batches%rowtype; v_blocking bigint;
begin
  if not public.ecoflow_can_capture_product_identity() then raise exception using errcode='42501',message='OWNER_ADMIN_OR_WAREHOUSE_REQUIRED'; end if;
  if p_command_id is null then raise exception 'PRODUCT_IDENTITY_COMMAND_ID_REQUIRED'; end if;
  select b.* into v_batch from public.ecoflow_product_identity_batches b where b.id=p_batch_id for update;
  if not found then raise exception 'PRODUCT_IDENTITY_BATCH_NOT_FOUND'; end if;
  if v_batch.submit_command_id=p_command_id then
    return query select v_batch.id,v_batch.batch_status,v_batch.revision,'REPLAYED'::text,v_batch.submitted_at; return;
  end if;
  if v_batch.batch_status<>'DRAFT' then raise exception 'PRODUCT_IDENTITY_BATCH_NOT_DRAFT'; end if;
  if v_batch.revision<>p_expected_revision then
    return query select v_batch.id,v_batch.batch_status,v_batch.revision,'CONFLICT'::text,v_batch.submitted_at; return;
  end if;
  select count(*) into v_blocking from public.ecoflow_product_identity_tasks t
  where t.batch_id=p_batch_id and t.blocking and t.task_status in ('OPEN','CONFLICT');
  if v_blocking>0 then raise exception 'PRODUCT_IDENTITY_BATCH_HAS_BLOCKING_TASKS'; end if;
  if not exists(select 1 from public.ecoflow_commercial_family_links l where l.created_in_batch_id=p_batch_id and l.identity_status='DRAFT')
     and not exists(select 1 from public.ecoflow_physical_barcode_bindings b where b.created_in_batch_id=p_batch_id and b.identity_status='DRAFT') then
    raise exception 'PRODUCT_IDENTITY_BATCH_HAS_NO_DRAFT_CHANGES';
  end if;

  -- Every preferred item must have a published or same-batch draft barcode.
  if exists(
    select 1 from public.ecoflow_commercial_family_links l
    where l.created_in_batch_id=p_batch_id and l.identity_status='DRAFT'
      and not exists(
        select 1 from public.ecoflow_physical_barcode_bindings b
        where b.physical_sku_id=l.preferred_physical_sku_id
          and (b.identity_status='ACTIVE' or (b.identity_status='DRAFT' and b.created_in_batch_id=p_batch_id))
      )
  ) then raise exception 'PREFERRED_PHYSICAL_SKU_NEEDS_BARCODE'; end if;

  update public.ecoflow_product_identity_batches b set
    batch_status='SUBMITTED',revision=b.revision+1,submit_command_id=p_command_id,
    submitted_by=auth.uid(),submitted_at=now(),note=coalesce(nullif(btrim(coalesce(p_note,'')),''),b.note),updated_at=now()
  where b.id=p_batch_id returning * into v_batch;

  return query select v_batch.id,v_batch.batch_status,v_batch.revision,'APPLIED'::text,v_batch.submitted_at;
end;
$$;

create or replace function public.ecoflow_reopen_product_identity_batch(
  p_batch_id uuid,p_expected_revision bigint,p_reason text
)
returns table(batch_id uuid,batch_status text,revision bigint)
language plpgsql security definer set search_path=pg_catalog,public
as $$
declare v_batch public.ecoflow_product_identity_batches%rowtype; v_reason text:=nullif(btrim(coalesce(p_reason,'')),'');
begin
  if not public.ecoflow_can_publish_product_identity() then raise exception using errcode='42501',message='OWNER_OR_ADMIN_REQUIRED'; end if;
  if v_reason is null then raise exception 'REOPEN_REASON_REQUIRED'; end if;
  select b.* into v_batch from public.ecoflow_product_identity_batches b where b.id=p_batch_id for update;
  if not found then raise exception 'PRODUCT_IDENTITY_BATCH_NOT_FOUND'; end if;
  if v_batch.batch_status<>'SUBMITTED' then raise exception 'ONLY_SUBMITTED_BATCH_CAN_REOPEN'; end if;
  if v_batch.revision<>p_expected_revision then raise exception 'PRODUCT_IDENTITY_REVISION_CONFLICT'; end if;
  update public.ecoflow_product_identity_batches b set
    batch_status='DRAFT',revision=b.revision+1,submit_command_id=null,submitted_by=null,submitted_at=null,
    note=concat_ws(E'\n',b.note,'REOPEN: '||v_reason),updated_at=now()
  where b.id=p_batch_id returning * into v_batch;
  return query select v_batch.id,v_batch.batch_status,v_batch.revision;
end;
$$;

create or replace function public.ecoflow_publish_product_identity_batch(
  p_batch_id uuid,p_expected_revision bigint,p_command_id uuid,p_note text default null
)
returns table(
  batch_id uuid,batch_status text,revision bigint,command_status text,
  published_families bigint,published_physical_skus bigint,published_barcodes bigint,published_links bigint,published_at timestamptz
)
language plpgsql security definer set search_path=pg_catalog,public
as $$
declare
  v_batch public.ecoflow_product_identity_batches%rowtype;
  v_blocking bigint; v_families bigint:=0; v_physical bigint:=0; v_barcodes bigint:=0; v_links bigint:=0;
begin
  if not public.ecoflow_can_publish_product_identity() then raise exception using errcode='42501',message='OWNER_OR_ADMIN_REQUIRED'; end if;
  if p_command_id is null then raise exception 'PRODUCT_IDENTITY_COMMAND_ID_REQUIRED'; end if;
  select b.* into v_batch from public.ecoflow_product_identity_batches b where b.id=p_batch_id for update;
  if not found then raise exception 'PRODUCT_IDENTITY_BATCH_NOT_FOUND'; end if;
  if v_batch.publish_command_id=p_command_id and v_batch.batch_status='PUBLISHED' then
    return query select v_batch.id,v_batch.batch_status,v_batch.revision,'REPLAYED'::text,
      0::bigint,0::bigint,0::bigint,0::bigint,v_batch.published_at; return;
  end if;
  if v_batch.batch_status<>'SUBMITTED' then raise exception 'PRODUCT_IDENTITY_BATCH_NOT_SUBMITTED'; end if;
  if v_batch.revision<>p_expected_revision then
    return query select v_batch.id,v_batch.batch_status,v_batch.revision,'CONFLICT'::text,
      0::bigint,0::bigint,0::bigint,0::bigint,v_batch.published_at; return;
  end if;
  select count(*) into v_blocking from public.ecoflow_product_identity_tasks t
  where t.batch_id=p_batch_id and t.blocking and t.task_status in ('OPEN','CONFLICT');
  if v_blocking>0 then raise exception 'PRODUCT_IDENTITY_BATCH_HAS_BLOCKING_TASKS'; end if;

  -- Final collision check under the same transaction before any state change.
  if exists(
    select 1
    from public.ecoflow_physical_barcode_bindings d
    join public.ecoflow_physical_barcode_bindings a
      on a.barcode=d.barcode and a.identity_status='ACTIVE' and a.id<>d.id
    where d.created_in_batch_id=p_batch_id and d.identity_status='DRAFT'
  ) then raise exception 'PRODUCT_IDENTITY_BARCODE_COLLISION_AT_PUBLISH'; end if;

  update public.ecoflow_sku_families f set
    identity_status='ACTIVE',revision=f.revision+1,updated_by=auth.uid(),updated_at=now()
  where f.created_in_batch_id=p_batch_id and f.identity_status='DRAFT';
  get diagnostics v_families=row_count;

  update public.ecoflow_physical_skus p set
    identity_status='ACTIVE',revision=p.revision+1,updated_by=auth.uid(),updated_at=now()
  where p.created_in_batch_id=p_batch_id and p.identity_status='DRAFT';
  get diagnostics v_physical=row_count;

  -- Package conversion replacements preserve old rows as retired history.
  update public.ecoflow_physical_sku_packages old set
    identity_status='RETIRED',retired_by=auth.uid(),retired_at=now(),retirement_reason='Replaced by published commissioning batch '||p_batch_id::text
  where old.identity_status='ACTIVE' and exists(
    select 1 from public.ecoflow_physical_sku_packages d
    where d.created_in_batch_id=p_batch_id and d.identity_status='DRAFT'
      and d.physical_sku_id=old.physical_sku_id and d.package_level=old.package_level
  );
  update public.ecoflow_physical_sku_packages d set
    identity_status='ACTIVE',revision=d.revision+1,active_from=now()
  where d.created_in_batch_id=p_batch_id and d.identity_status='DRAFT';

  update public.ecoflow_physical_barcode_bindings d set
    identity_status='ACTIVE',revision=d.revision+1,active_from=now()
  where d.created_in_batch_id=p_batch_id and d.identity_status='DRAFT';
  get diagnostics v_barcodes=row_count;

  -- One current Commercial SKU family contract. Old contracts are retained.
  update public.ecoflow_commercial_family_links old set
    identity_status='RETIRED',retired_by=auth.uid(),retired_at=now(),retirement_reason='Replaced by published commissioning batch '||p_batch_id::text
  where old.identity_status='ACTIVE' and exists(
    select 1 from public.ecoflow_commercial_family_links d
    where d.created_in_batch_id=p_batch_id and d.identity_status='DRAFT'
      and d.commercial_sku_id=old.commercial_sku_id
  );
  update public.ecoflow_commercial_family_links d set
    identity_status='ACTIVE',revision=d.revision+1,active_from=now()
  where d.created_in_batch_id=p_batch_id and d.identity_status='DRAFT';
  get diagnostics v_links=row_count;

  -- Resolve catalog and barcode tasks only after canonical rows are ACTIVE.
  update public.ecoflow_product_identity_tasks t set
    task_status='RESOLVED',resolved_by=auth.uid(),resolved_at=now(),updated_at=now(),
    detail='Published canonical product identity is active.'
  where t.batch_id=p_batch_id and t.task_status='DRAFT_READY';

  update public.ecoflow_product_identity_batches b set
    batch_status='PUBLISHED',revision=b.revision+1,publish_command_id=p_command_id,
    published_by=auth.uid(),published_at=now(),note=coalesce(nullif(btrim(coalesce(p_note,'')),''),b.note),updated_at=now()
  where b.id=p_batch_id returning * into v_batch;

  return query select v_batch.id,v_batch.batch_status,v_batch.revision,'APPLIED'::text,
    v_families,v_physical,v_barcodes,v_links,v_batch.published_at;
end;
$$;

-- Explicit barcode retirement. This never reassigns the row or mutates history.
create or replace function public.ecoflow_retire_product_identity_barcode(
  p_barcode text,p_reason text,p_expected_revision bigint
)
returns table(
  binding_id uuid,barcode text,physical_sku_id uuid,retirement_status text,revision bigint,retired_at timestamptz
)
language plpgsql security definer set search_path=pg_catalog,public
as $$
declare v_code text:=nullif(btrim(coalesce(p_barcode,'')),''); v_reason text:=nullif(btrim(coalesce(p_reason,'')),''); v_binding public.ecoflow_physical_barcode_bindings%rowtype; v_batch uuid;
begin
  if not public.ecoflow_can_publish_product_identity() then raise exception using errcode='42501',message='OWNER_OR_ADMIN_REQUIRED'; end if;
  if v_code is null or v_reason is null then raise exception 'BARCODE_AND_RETIREMENT_REASON_REQUIRED'; end if;
  select b.* into v_binding from public.ecoflow_physical_barcode_bindings b
  where b.barcode=v_code and b.identity_status='ACTIVE' for update;
  if not found then raise exception 'ACTIVE_CANONICAL_BARCODE_NOT_FOUND'; end if;
  if v_binding.revision<>p_expected_revision then
    return query select v_binding.id,v_binding.barcode,v_binding.physical_sku_id,'CONFLICT'::text,v_binding.revision,v_binding.retired_at; return;
  end if;
  update public.ecoflow_physical_barcode_bindings b set
    identity_status='RETIRED',revision=b.revision+1,retired_by=auth.uid(),retired_at=now(),retirement_reason=v_reason
  where b.id=v_binding.id returning * into v_binding;
  select b.id into v_batch from public.ecoflow_product_identity_batches b
  where b.batch_status='DRAFT' order by b.created_at desc limit 1;
  insert into public.ecoflow_product_identity_tasks(
    task_key,task_type,barcode,batch_id,task_status,blocking,source,detail
  ) values(
    'BARCODE:'||v_code,'PHYSICAL_BARCODE',v_code,v_batch,'OPEN',true,'CANONICAL_BARCODE',
    'Canonical barcode was retired: '||v_reason||'. Capture the replacement before publication.'
  ) on conflict(task_key) do update set
    batch_id=excluded.batch_id,task_type='PHYSICAL_BARCODE',task_status='OPEN',blocking=true,
    detail=excluded.detail,updated_at=now(),resolved_by=null,resolved_at=null;
  return query select v_binding.id,v_binding.barcode,v_binding.physical_sku_id,'RETIRED'::text,v_binding.revision,v_binding.retired_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- Read models
-- ---------------------------------------------------------------------------

create or replace function public.ecoflow_read_product_identity_commissioning_v1(
  p_batch_id uuid,
  p_search text default null,
  p_filter text default 'ALL',
  p_page integer default 1,
  p_page_size integer default 25
)
returns table(
  commercial_sku_id uuid,commercial_sku_code text,commercial_name text,ordermentum_sku text,
  task_status text,identity_status text,family_code text,family_name text,
  preferred_physical_code text,preferred_physical_name text,brand text,substitution_policy text,
  published_barcode_count bigint,draft_barcode_count bigint,legacy_barcode_count bigint,legacy_barcode_example text,
  task_detail text,total_count bigint
)
language plpgsql stable security definer set search_path=pg_catalog,public
as $$
declare
  v_search text:='%'||lower(btrim(coalesce(p_search,'')))||'%';
  v_filter text:=upper(btrim(coalesce(p_filter,'ALL')));
  v_page integer:=greatest(coalesce(p_page,1),1);
  v_size integer:=least(greatest(coalesce(p_page_size,25),1),100);
begin
  if not public.ecoflow_can_read_product_identity() then raise exception using errcode='42501',message='PRODUCT_IDENTITY_READ_REQUIRED'; end if;
  if v_filter not in ('ALL','OPEN','DRAFT_READY','CONFLICT','READY') then raise exception 'INVALID_PRODUCT_IDENTITY_FILTER'; end if;

  return query
  with base as (
    select
      s.id as commercial_sku_id,
      s.sku_code::text as commercial_sku_code,
      s.display_name::text as commercial_name,
      om.external_product_code::text as ordermentum_sku,
      coalesce(t.task_status,'RESOLVED')::text as task_status,
      coalesce(dl.family_id,al.family_id) as family_id,
      coalesce(dl.preferred_physical_sku_id,al.preferred_physical_sku_id) as preferred_physical_sku_id,
      coalesce(dl.substitution_policy,al.substitution_policy)::text as substitution_policy,
      case
        when t.task_status='CONFLICT' then 'CONFLICT'
        when dl.id is not null then 'DRAFT'
        when al.id is not null then 'READY'
        else 'NEEDS_MAPPING'
      end::text as identity_status,
      coalesce(t.detail,'Published canonical identity is active.')::text as task_detail
    from public.skus s
    left join lateral (
      select m.external_product_code
      from public.external_product_mappings m
      where m.internal_sku_id=s.id and m.provider='ORDERMENTUM' and m.is_active
      order by m.updated_at desc nulls last limit 1
    ) om on true
    left join public.ecoflow_product_identity_tasks t on t.task_key='COMMERCIAL:'||s.id::text
    left join public.ecoflow_commercial_family_links dl
      on dl.commercial_sku_id=s.id and dl.identity_status='DRAFT' and dl.created_in_batch_id=p_batch_id
    left join public.ecoflow_commercial_family_links al
      on al.commercial_sku_id=s.id and al.identity_status='ACTIVE'
    where om.external_product_code is not null
      and not exists(
        select 1 from public.ecoflow_sku_master_overrides o
        where o.external_sku_code=om.external_product_code and coalesce(o.is_service_item,false)=true
      )
  ), enriched as (
    select
      b.*,
      f.family_code::text,f.family_name::text,
      p.physical_sku_code::text as preferred_physical_code,
      p.display_name::text as preferred_physical_name,p.brand::text,
      (select count(*) from public.ecoflow_physical_barcode_bindings pb where pb.physical_sku_id=p.id and pb.identity_status='ACTIVE')::bigint as published_barcode_count,
      (select count(*) from public.ecoflow_physical_barcode_bindings pb where pb.physical_sku_id=p.id and pb.identity_status='DRAFT' and pb.created_in_batch_id=p_batch_id)::bigint as draft_barcode_count,
      legacy.legacy_barcode_count,legacy.legacy_barcode_example
    from base b
    left join public.ecoflow_sku_families f on f.id=b.family_id
    left join public.ecoflow_physical_skus p on p.id=b.preferred_physical_sku_id
    left join lateral (
      select count(*)::bigint as legacy_barcode_count,max(r.barcode)::text as legacy_barcode_example
      from public.ecoflow_sku_barcode_registry r
      where upper(r.sku) in (upper(b.commercial_sku_code),upper(coalesce(b.ordermentum_sku,'')))
        and r.is_active
    ) legacy on true
  ), filtered as (
    select e.*
    from enriched e
    where (
      lower(e.commercial_sku_code) like v_search or lower(coalesce(e.commercial_name,'')) like v_search
      or lower(coalesce(e.ordermentum_sku,'')) like v_search or lower(coalesce(e.family_name,'')) like v_search
      or lower(coalesce(e.preferred_physical_name,'')) like v_search or lower(coalesce(e.legacy_barcode_example,'')) like v_search
    ) and (
      v_filter='ALL'
      or (v_filter='READY' and e.identity_status='READY')
      or (v_filter='CONFLICT' and e.task_status='CONFLICT')
      or (v_filter='OPEN' and e.task_status='OPEN')
      or (v_filter='DRAFT_READY' and e.task_status='DRAFT_READY')
    )
  )
  select
    f.commercial_sku_id,f.commercial_sku_code,f.commercial_name,f.ordermentum_sku,
    f.task_status,f.identity_status,f.family_code,f.family_name,
    f.preferred_physical_code,f.preferred_physical_name,f.brand,f.substitution_policy,
    coalesce(f.published_barcode_count,0),coalesce(f.draft_barcode_count,0),coalesce(f.legacy_barcode_count,0),f.legacy_barcode_example,
    f.task_detail,count(*) over()::bigint
  from filtered f
  order by
    case f.task_status when 'CONFLICT' then 0 when 'OPEN' then 1 when 'DRAFT_READY' then 2 else 3 end,
    f.commercial_sku_code
  offset (v_page-1)*v_size limit v_size;
end;
$$;

create or replace function public.ecoflow_read_product_identity_reference_v1(p_batch_id uuid)
returns table(families jsonb,physical_skus jsonb,read_at timestamptz)
language sql stable security definer set search_path=pg_catalog,public
as $$
  select
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',f.id,'code',f.family_code,'name',f.family_name,'status',f.identity_status
      ) order by f.family_name)
      from public.ecoflow_sku_families f
      where f.identity_status='ACTIVE' or (f.identity_status='DRAFT' and f.created_in_batch_id=p_batch_id)
    ),'[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',p.id,'code',p.physical_sku_code,'name',p.display_name,'brand',p.brand,
        'familyId',p.family_id,'status',p.identity_status
      ) order by p.display_name)
      from public.ecoflow_physical_skus p
      where p.identity_status='ACTIVE' or (p.identity_status='DRAFT' and p.created_in_batch_id=p_batch_id)
    ),'[]'::jsonb),
    statement_timestamp()
  where public.ecoflow_can_read_product_identity();
$$;

-- Canonical resolver used by warehouse loops. UNKNOWN / RETIRED never returns a
-- stock-posting identity. Commercial SKU association is resolved separately by
-- order context; the barcode itself identifies the actual physical product.
create or replace function public.ecoflow_resolve_published_physical_barcode(p_barcode text)
returns table(
  resolution_status text,binding_id uuid,barcode text,physical_sku_id uuid,physical_sku_code text,
  physical_name text,brand text,family_id uuid,family_code text,package_level text,units_in_base_unit numeric,
  binding_revision bigint,read_at timestamptz
)
language plpgsql stable security definer set search_path=pg_catalog,public
as $$
declare v_code text:=nullif(btrim(coalesce(p_barcode,'')),'');
begin
  if auth.uid() is null or public.ecoflow_active_app_role() not in ('OWNER','ADMIN','WAREHOUSE') then
    raise exception using errcode='42501',message='WAREHOUSE_IDENTITY_READ_REQUIRED';
  end if;
  if v_code is null then raise exception 'BARCODE_REQUIRED'; end if;
  if exists(select 1 from public.ecoflow_physical_barcode_bindings b where b.barcode=v_code and b.identity_status='ACTIVE') then
    return query
    select 'RESOLVED'::text,b.id,b.barcode,p.id,p.physical_sku_code,p.display_name,p.brand,
      f.id,f.family_code,pk.package_level,pk.units_in_base_unit,b.revision,statement_timestamp()
    from public.ecoflow_physical_barcode_bindings b
    join public.ecoflow_physical_skus p on p.id=b.physical_sku_id and p.identity_status='ACTIVE'
    join public.ecoflow_sku_families f on f.id=p.family_id and f.identity_status='ACTIVE'
    join public.ecoflow_physical_sku_packages pk on pk.id=b.package_id and pk.identity_status='ACTIVE'
    where b.barcode=v_code and b.identity_status='ACTIVE';
  elsif exists(select 1 from public.ecoflow_physical_barcode_bindings b where b.barcode=v_code and b.identity_status='RETIRED') then
    return query select 'RETIRED'::text,null::uuid,v_code,null::uuid,null::text,null::text,null::text,
      null::uuid,null::text,null::text,null::numeric,null::bigint,statement_timestamp();
  else
    return query select 'UNKNOWN'::text,null::uuid,v_code,null::uuid,null::text,null::text,null::text,
      null::uuid,null::text,null::text,null::numeric,null::bigint,statement_timestamp();
  end if;
end;
$$;

-- Read-only audit view: proves mapping publication itself never touches inventory.
create or replace view public.v_ecoflow_product_identity_publication_audit
with (security_invoker=true)
as
select
  b.id as batch_id,b.batch_name,b.batch_status,b.revision,b.created_at,b.submitted_at,b.published_at,
  count(o.id)::bigint as observation_count,
  count(o.id) filter(where o.observation_status='CONFLICT')::bigint as conflict_observation_count
from public.ecoflow_product_identity_batches b
left join public.ecoflow_product_identity_observations o on o.batch_id=b.id
group by b.id,b.batch_name,b.batch_status,b.revision,b.created_at,b.submitted_at,b.published_at;

grant select on public.v_ecoflow_product_identity_publication_audit to authenticated;
revoke all on public.v_ecoflow_product_identity_publication_audit from anon;

revoke all on function public.ecoflow_can_read_product_identity() from public,anon;
revoke all on function public.ecoflow_can_capture_product_identity() from public,anon;
revoke all on function public.ecoflow_can_publish_product_identity() from public,anon;
grant execute on function public.ecoflow_can_read_product_identity() to authenticated;
grant execute on function public.ecoflow_can_capture_product_identity() to authenticated;
grant execute on function public.ecoflow_can_publish_product_identity() to authenticated;

revoke all on function public.ecoflow_start_product_identity_batch(text,uuid) from public,anon;
revoke all on function public.ecoflow_read_current_product_identity_batch() from public,anon;
revoke all on function public.ecoflow_capture_product_identity(uuid,uuid,uuid,text,text,text,text,text,text,text,text,numeric,text,boolean,text) from public,anon;
revoke all on function public.ecoflow_submit_product_identity_batch(uuid,bigint,uuid,text) from public,anon;
revoke all on function public.ecoflow_reopen_product_identity_batch(uuid,bigint,text) from public,anon;
revoke all on function public.ecoflow_publish_product_identity_batch(uuid,bigint,uuid,text) from public,anon;
revoke all on function public.ecoflow_retire_product_identity_barcode(text,text,bigint) from public,anon;
revoke all on function public.ecoflow_read_product_identity_commissioning_v1(uuid,text,text,integer,integer) from public,anon;
revoke all on function public.ecoflow_read_product_identity_reference_v1(uuid) from public,anon;
revoke all on function public.ecoflow_resolve_published_physical_barcode(text) from public,anon;

grant execute on function public.ecoflow_start_product_identity_batch(text,uuid) to authenticated;
grant execute on function public.ecoflow_read_current_product_identity_batch() to authenticated;
grant execute on function public.ecoflow_capture_product_identity(uuid,uuid,uuid,text,text,text,text,text,text,text,text,numeric,text,boolean,text) to authenticated;
grant execute on function public.ecoflow_submit_product_identity_batch(uuid,bigint,uuid,text) to authenticated;
grant execute on function public.ecoflow_reopen_product_identity_batch(uuid,bigint,text) to authenticated;
grant execute on function public.ecoflow_publish_product_identity_batch(uuid,bigint,uuid,text) to authenticated;
grant execute on function public.ecoflow_retire_product_identity_barcode(text,text,bigint) to authenticated;
grant execute on function public.ecoflow_read_product_identity_commissioning_v1(uuid,text,text,integer,integer) to authenticated;
grant execute on function public.ecoflow_read_product_identity_reference_v1(uuid) to authenticated;
grant execute on function public.ecoflow_resolve_published_physical_barcode(text) to authenticated;

comment on table public.ecoflow_physical_skus is
  'Actual stocked manufacturer/brand item. Separate from Commercial SKU / Ordermentum sales identity.';
comment on table public.ecoflow_sku_families is
  'Business-equivalent physical items that may substitute under a Commercial SKU family contract.';
comment on table public.ecoflow_physical_barcode_bindings is
  'Append-only physical package barcode history. At most one ACTIVE owner for a barcode.';
comment on table public.ecoflow_commercial_family_links is
  'Commercial SKU to physical-family contract with preferred item and substitution policy.';
comment on function public.ecoflow_publish_product_identity_batch(uuid,bigint,uuid,text) is
  'Atomic mapping publication only. It does not mutate receiving, stocktake, inventory movement, pick or delivery quantities.';

notify pgrst,'reload schema';
commit;
