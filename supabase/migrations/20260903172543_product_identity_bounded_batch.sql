-- #328 minimal repair: bounded Product Identity commissioning batches.
--
-- The Survey -> Product Identity reconciliation bridge remains unchanged. This
-- additive envelope lets an Owner/Admin commission an explicit Commercial SKU
-- without attaching every unresolved catalog task to the same batch.

begin;

alter table public.ecoflow_product_identity_batches
  add constraint uq_ecoflow_product_identity_batch_start_pair
  unique(id,start_command_id);

create table public.ecoflow_product_identity_batch_scope_items (
  batch_id uuid not null,
  commercial_sku_id uuid not null references public.skus(id) on delete restrict,
  start_command_id uuid not null,
  command_payload_sha256 text not null
    check (command_payload_sha256 ~ '^[0-9a-f]{64}$'),
  actor_user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(batch_id,commercial_sku_id),
  foreign key(batch_id,start_command_id)
    references public.ecoflow_product_identity_batches(id,start_command_id)
    on delete restrict
);

create index idx_ecoflow_product_identity_batch_scope_commercial
  on public.ecoflow_product_identity_batch_scope_items(commercial_sku_id,created_at desc);

alter table public.ecoflow_product_identity_batch_scope_items enable row level security;
revoke all on table public.ecoflow_product_identity_batch_scope_items
  from public,anon,authenticated;
grant select on table public.ecoflow_product_identity_batch_scope_items
  to authenticated;

create policy ecoflow_product_identity_batch_scope_owner_admin_read
  on public.ecoflow_product_identity_batch_scope_items
  for select to authenticated
  using (public.ecoflow_can_publish_product_identity());

create or replace function public.ecoflow_guard_product_identity_batch_scope_immutable()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  raise exception 'PRODUCT_IDENTITY_BATCH_SCOPE_IMMUTABLE';
end;
$$;

create trigger ecoflow_product_identity_batch_scope_immutable
before update or delete on public.ecoflow_product_identity_batch_scope_items
for each row execute function public.ecoflow_guard_product_identity_batch_scope_immutable();

create or replace function public.ecoflow_guard_product_identity_observation_scope()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if exists(
    select 1
    from public.ecoflow_product_identity_batch_scope_items s
    where s.batch_id=new.batch_id
  ) and not exists(
    select 1
    from public.ecoflow_product_identity_batch_scope_items s
    where s.batch_id=new.batch_id
      and s.commercial_sku_id=new.commercial_sku_id
  ) then
    raise exception 'PRODUCT_IDENTITY_COMMERCIAL_SKU_OUT_OF_BATCH_SCOPE';
  end if;
  return new;
end;
$$;

create trigger ecoflow_product_identity_observation_scope_guard
before insert or update of batch_id,commercial_sku_id
on public.ecoflow_product_identity_observations
for each row execute function public.ecoflow_guard_product_identity_observation_scope();

create or replace function public.ecoflow_start_bounded_product_identity_batch(
  p_batch_name text,
  p_commercial_sku_ids uuid[],
  p_command_id uuid
)
returns table(
  batch_id uuid,
  batch_name text,
  batch_status text,
  revision bigint,
  command_status text,
  scoped_sku_count bigint,
  created_at timestamptz
)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=auth.uid();
  v_name text:=coalesce(
    nullif(pg_catalog.btrim(p_batch_name),''),
    'Bounded product identity commissioning'
  );
  v_requested_count integer:=coalesce(pg_catalog.array_length(p_commercial_sku_ids,1),0);
  v_distinct_count bigint;
  v_eligible_count bigint;
  v_payload_hash text;
  v_existing_hash text;
  v_scope_count bigint;
  v_batch public.ecoflow_product_identity_batches%rowtype;
begin
  if not public.ecoflow_can_publish_product_identity() then
    raise exception using errcode='42501',message='OWNER_OR_ADMIN_REQUIRED';
  end if;
  if p_command_id is null then
    raise exception 'PRODUCT_IDENTITY_COMMAND_ID_REQUIRED';
  end if;
  if pg_catalog.char_length(v_name)>200 then
    raise exception 'PRODUCT_IDENTITY_BATCH_NAME_TOO_LONG';
  end if;
  if v_requested_count not between 1 and 25
    or pg_catalog.array_position(p_commercial_sku_ids,null::uuid) is not null then
    raise exception 'PRODUCT_IDENTITY_BOUNDED_SCOPE_INVALID';
  end if;

  select count(distinct u.id)::bigint
  into v_distinct_count
  from pg_catalog.unnest(p_commercial_sku_ids) u(id);
  if v_distinct_count<>v_requested_count then
    raise exception 'PRODUCT_IDENTITY_BOUNDED_SCOPE_DUPLICATE';
  end if;

  select pg_catalog.encode(extensions.digest(pg_catalog.jsonb_build_object(
    'actorUserId',v_actor,
    'batchName',v_name,
    'commercialSkuIds',(
      select pg_catalog.jsonb_agg(u.id order by u.id::text)
      from pg_catalog.unnest(p_commercial_sku_ids) u(id)
    )
  )::text,'sha256'),'hex')
  into v_payload_hash;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ecoflow_product_identity_bounded_command:'||p_command_id::text,0)
  );

  select b.*
  into v_batch
  from public.ecoflow_product_identity_batches b
  where b.start_command_id=p_command_id;
  if found then
    select min(s.command_payload_sha256),count(s.batch_id)::bigint
    into v_existing_hash,v_scope_count
    from public.ecoflow_product_identity_batch_scope_items s
    where s.batch_id=v_batch.id;
    if v_existing_hash is distinct from v_payload_hash
      or v_scope_count<>v_requested_count then
      raise exception 'PRODUCT_IDENTITY_COMMAND_REPLAY_PAYLOAD_MISMATCH';
    end if;
    return query select
      v_batch.id,v_batch.batch_name,v_batch.batch_status,v_batch.revision,
      'REPLAYED'::text,v_scope_count,v_batch.created_at;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ecoflow_product_identity_open_batch',0)
  );
  if exists(
    select 1 from public.ecoflow_product_identity_batches b
    where b.batch_status in ('DRAFT','SUBMITTED')
  ) then
    raise exception 'PRODUCT_IDENTITY_OPEN_BATCH_SCOPE_CONFLICT';
  end if;

  select count(*)::bigint
  into v_eligible_count
  from pg_catalog.unnest(p_commercial_sku_ids) requested(id)
  join public.skus sku on sku.id=requested.id
  where exists(
    select 1
    from public.external_product_mappings m
    where m.internal_sku_id=sku.id
      and m.provider='ORDERMENTUM'
      and m.is_active
  )
  and not exists(
    select 1
    from public.external_product_mappings m
    join public.ecoflow_sku_master_overrides o
      on o.external_sku_code=m.external_product_code
    where m.internal_sku_id=sku.id
      and m.provider='ORDERMENTUM'
      and m.is_active
      and coalesce(o.is_service_item,false)=true
  )
  and not exists(
    select 1
    from public.ecoflow_commercial_family_links l
    where l.commercial_sku_id=sku.id
      and l.identity_status='ACTIVE'
  );
  if v_eligible_count<>v_requested_count then
    raise exception 'PRODUCT_IDENTITY_BOUNDED_SCOPE_NOT_ELIGIBLE';
  end if;

  insert into public.ecoflow_product_identity_batches(
    batch_name,start_command_id,created_by
  ) values(v_name,p_command_id,v_actor)
  returning * into v_batch;

  insert into public.ecoflow_product_identity_batch_scope_items(
    batch_id,commercial_sku_id,start_command_id,command_payload_sha256,actor_user_id
  )
  select v_batch.id,u.id,p_command_id,v_payload_hash,v_actor
  from pg_catalog.unnest(p_commercial_sku_ids) u(id);

  insert into public.ecoflow_product_identity_tasks(
    task_key,task_type,commercial_sku_id,batch_id,task_status,blocking,source,detail
  )
  select
    'COMMERCIAL:'||u.id::text,
    'COMMERCIAL_SKU_MAPPING',
    u.id,
    v_batch.id,
    'OPEN',
    true,
    'COMMERCIAL_CATALOG',
    'Confirm the physical SKU, SKU Family, package barcode and substitution policy before warehouse go-live.'
  from pg_catalog.unnest(p_commercial_sku_ids) u(id)
  on conflict(task_key) do update set
    commercial_sku_id=excluded.commercial_sku_id,
    batch_id=excluded.batch_id,
    task_status='OPEN',
    blocking=true,
    source=excluded.source,
    detail=excluded.detail,
    updated_at=now(),
    resolved_by=null,
    resolved_at=null;

  return query select
    v_batch.id,v_batch.batch_name,v_batch.batch_status,v_batch.revision,
    'APPLIED'::text,v_requested_count::bigint,v_batch.created_at;
end;
$$;

revoke all on function public.ecoflow_start_bounded_product_identity_batch(text,uuid[],uuid)
  from public,anon;
grant execute on function public.ecoflow_start_bounded_product_identity_batch(text,uuid[],uuid)
  to authenticated;

revoke all on function public.ecoflow_guard_product_identity_batch_scope_immutable()
  from public,anon,authenticated;
revoke all on function public.ecoflow_guard_product_identity_observation_scope()
  from public,anon,authenticated;

comment on table public.ecoflow_product_identity_batch_scope_items is
  'Immutable command evidence for an explicit Commercial SKU commissioning scope. It adds no Product Identity authority.';
comment on function public.ecoflow_start_bounded_product_identity_batch(text,uuid[],uuid) is
  'Owner/Admin-only bounded start command. Attaches only explicit unresolved Commercial SKU tasks and reuses the existing Product Identity authority.';

notify pgrst,'reload schema';
commit;
