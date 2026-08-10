-- Explicit Owner/Admin barcode reassignment authority.
-- A barcode with retired history is never generally reusable. The only allowed
-- reassignment path is this RPC, which consumes one exact CONFLICT observation
-- and atomically retires the current owner + stages that exact replacement.

begin;

create table if not exists public.ecoflow_barcode_reassignment_authorizations (
  id uuid primary key default extensions.gen_random_uuid(),
  batch_id uuid not null references public.ecoflow_product_identity_batches(id),
  barcode text not null,
  conflict_observation_id uuid not null references public.ecoflow_product_identity_observations(id),
  retired_binding_id uuid not null references public.ecoflow_physical_barcode_bindings(id),
  replacement_observation_id uuid not null references public.ecoflow_product_identity_observations(id),
  target_payload jsonb not null,
  reason text not null,
  command_id uuid not null unique,
  authorized_by uuid not null default auth.uid(),
  authorized_at timestamptz not null default now(),
  unique(conflict_observation_id)
);

alter table public.ecoflow_barcode_reassignment_authorizations enable row level security;
drop policy if exists product_identity_read_reassignment_authorizations
  on public.ecoflow_barcode_reassignment_authorizations;
create policy product_identity_read_reassignment_authorizations
  on public.ecoflow_barcode_reassignment_authorizations
  for select to authenticated
  using (public.ecoflow_can_read_product_identity());
revoke insert,update,delete on public.ecoflow_barcode_reassignment_authorizations from anon,authenticated;
grant select on public.ecoflow_barcode_reassignment_authorizations to authenticated;
revoke all on public.ecoflow_barcode_reassignment_authorizations from anon;

create or replace function public.ecoflow_authorize_barcode_reassignment(
  p_batch_id uuid,
  p_conflict_observation_id uuid,
  p_expected_binding_revision bigint,
  p_reason text,
  p_command_id uuid
)
returns table(
  authorization_id uuid,
  command_id uuid,
  authorization_status text,
  barcode text,
  retired_binding_id uuid,
  replacement_observation_id uuid,
  physical_sku_id uuid,
  family_id uuid,
  batch_revision bigint,
  detail text
)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_role text:=public.ecoflow_active_app_role();
  v_reason text:=nullif(btrim(coalesce(p_reason,'')),'');
  v_batch public.ecoflow_product_identity_batches%rowtype;
  v_conflict public.ecoflow_product_identity_observations%rowtype;
  v_existing public.ecoflow_barcode_reassignment_authorizations%rowtype;
  v_active_binding public.ecoflow_physical_barcode_bindings%rowtype;
  v_family public.ecoflow_sku_families%rowtype;
  v_physical public.ecoflow_physical_skus%rowtype;
  v_package public.ecoflow_physical_sku_packages%rowtype;
  v_draft_binding public.ecoflow_physical_barcode_bindings%rowtype;
  v_draft_link public.ecoflow_commercial_family_links%rowtype;
  v_active_link public.ecoflow_commercial_family_links%rowtype;
  v_replacement_observation_id uuid;
  v_authorization_id uuid;
  v_family_code text;
  v_family_name text;
  v_physical_code text;
  v_physical_name text;
  v_brand text;
  v_supplier text;
  v_barcode text;
  v_level text;
  v_units numeric;
  v_policy text;
  v_is_preferred boolean;
  v_note text;
  v_payload jsonb;
  v_batch_revision bigint;
  v_detail text;
begin
  if auth.uid() is null or v_role not in ('OWNER','ADMIN') then
    raise exception using errcode='42501',message='OWNER_OR_ADMIN_REQUIRED';
  end if;
  if p_batch_id is null or p_conflict_observation_id is null or p_command_id is null then
    raise exception 'BATCH_CONFLICT_OBSERVATION_AND_COMMAND_REQUIRED';
  end if;
  if coalesce(p_expected_binding_revision,-1)<0 then
    raise exception 'EXPECTED_BINDING_REVISION_REQUIRED';
  end if;
  if v_reason is null then raise exception 'BARCODE_REASSIGNMENT_REASON_REQUIRED'; end if;

  select a.* into v_existing
  from public.ecoflow_barcode_reassignment_authorizations a
  where a.command_id=p_command_id;
  if found then
    if v_existing.batch_id<>p_batch_id
      or v_existing.conflict_observation_id<>p_conflict_observation_id
      or v_existing.reason<>v_reason then
      raise exception 'BARCODE_REASSIGNMENT_IDEMPOTENCY_KEY_REUSE';
    end if;
    select o.physical_sku_id,o.family_id into v_physical.id,v_family.id
    from public.ecoflow_product_identity_observations o
    where o.id=v_existing.replacement_observation_id;
    select b.revision into v_batch_revision
    from public.ecoflow_product_identity_batches b where b.id=v_existing.batch_id;
    return query select
      v_existing.id,v_existing.command_id,'REPLAYED'::text,v_existing.barcode,
      v_existing.retired_binding_id,v_existing.replacement_observation_id,
      v_physical.id,v_family.id,v_batch_revision,
      'Exact replacement authorization already applied.'::text;
    return;
  end if;

  select b.* into v_batch
  from public.ecoflow_product_identity_batches b
  where b.id=p_batch_id
  for update;
  if not found then raise exception 'PRODUCT_IDENTITY_BATCH_NOT_FOUND'; end if;
  if v_batch.batch_status<>'DRAFT' then raise exception 'PRODUCT_IDENTITY_BATCH_NOT_EDITABLE'; end if;

  select o.* into v_conflict
  from public.ecoflow_product_identity_observations o
  where o.id=p_conflict_observation_id
  for update;
  if not found then raise exception 'BARCODE_CONFLICT_OBSERVATION_NOT_FOUND'; end if;
  if v_conflict.batch_id<>p_batch_id or v_conflict.observation_status<>'CONFLICT' then
    raise exception 'BARCODE_REASSIGNMENT_REQUIRES_BATCH_CONFLICT';
  end if;

  v_payload:=v_conflict.payload;
  v_family_code:=upper(nullif(btrim(coalesce(v_payload->>'familyCode','')),''));
  v_family_name:=nullif(btrim(coalesce(v_payload->>'familyName','')),'');
  v_physical_code:=upper(nullif(btrim(coalesce(v_payload->>'physicalSkuCode','')),''));
  v_physical_name:=nullif(btrim(coalesce(v_payload->>'physicalName','')),'');
  v_brand:=nullif(btrim(coalesce(v_payload->>'brand','')),'');
  v_supplier:=nullif(btrim(coalesce(v_payload->>'supplier','')),'');
  v_barcode:=nullif(btrim(coalesce(v_payload->>'barcode','')),'');
  v_level:=upper(nullif(btrim(coalesce(v_payload->>'packageLevel','')),''));
  v_units:=nullif(v_payload->>'units','')::numeric;
  v_policy:=upper(nullif(btrim(coalesce(v_payload->>'policy','')),''));
  v_is_preferred:=coalesce((v_payload->>'preferred')::boolean,true);
  v_note:=nullif(btrim(coalesce(v_payload->>'note','')),'');

  if v_conflict.commercial_sku_id is null
    or v_family_code is null or v_family_name is null
    or v_physical_code is null or v_physical_name is null
    or v_barcode is null or v_barcode<>v_conflict.barcode
    or v_level not in ('CARTON','SLEEVE','INNER','EACH','PALLET')
    or coalesce(v_units,0)<=0 or v_units<>trunc(v_units)
    or v_policy not in ('ALLOWED','APPROVAL_REQUIRED','PROHIBITED') then
    raise exception 'BARCODE_CONFLICT_OBSERVATION_PAYLOAD_INVALID';
  end if;

  -- Serialize by barcode so another capture/authorization cannot race this decision.
  perform pg_advisory_xact_lock(hashtextextended('product-barcode:'||v_barcode,0));

  select b.* into v_active_binding
  from public.ecoflow_physical_barcode_bindings b
  where b.barcode=v_barcode and b.identity_status='ACTIVE'
  for update;
  if not found then raise exception 'ACTIVE_CANONICAL_BARCODE_NOT_FOUND'; end if;
  if v_active_binding.revision<>p_expected_binding_revision then
    return query select
      null::uuid,p_command_id,'CONFLICT'::text,v_barcode,
      v_active_binding.id,null::uuid,null::uuid,null::uuid,v_batch.revision,
      'Published barcode changed after the conflict was observed. Refresh authority before authorizing reassignment.'::text;
    return;
  end if;

  -- A conflict can only authorize movement away from the current owner.
  if exists(
    select 1 from public.ecoflow_physical_skus p
    where p.id=v_active_binding.physical_sku_id
      and upper(p.physical_sku_code)=v_physical_code
  ) then
    raise exception 'BARCODE_REASSIGNMENT_TARGET_IS_CURRENT_OWNER';
  end if;

  -- Resolve/create the exact family carried by the immutable conflict payload.
  select f.* into v_family
  from public.ecoflow_sku_families f
  where lower(f.family_code)=lower(v_family_code)
  for update;
  if found then
    if v_family.identity_status='RETIRED' then raise exception 'SKU_FAMILY_RETIRED'; end if;
    if v_family.identity_status='DRAFT' and v_family.created_in_batch_id<>p_batch_id then
      raise exception 'SKU_FAMILY_DRAFT_OWNED_BY_OTHER_BATCH';
    end if;
    if v_family.identity_status='DRAFT' then
      update public.ecoflow_sku_families f set
        family_name=v_family_name,updated_by=auth.uid(),updated_at=now()
      where f.id=v_family.id returning * into v_family;
    end if;
  else
    insert into public.ecoflow_sku_families(
      family_code,family_name,identity_status,created_in_batch_id,created_by,updated_by
    ) values(v_family_code,v_family_name,'DRAFT',p_batch_id,auth.uid(),auth.uid())
    returning * into v_family;
  end if;

  -- Resolve/create the exact Physical SKU from the conflict payload.
  select p.* into v_physical
  from public.ecoflow_physical_skus p
  where lower(p.physical_sku_code)=lower(v_physical_code)
  for update;
  if found then
    if v_physical.identity_status='RETIRED' then raise exception 'PHYSICAL_SKU_RETIRED'; end if;
    if v_physical.family_id<>v_family.id then raise exception 'PHYSICAL_SKU_FAMILY_CONFLICT'; end if;
    if v_physical.identity_status='DRAFT' and v_physical.created_in_batch_id<>p_batch_id then
      raise exception 'PHYSICAL_SKU_DRAFT_OWNED_BY_OTHER_BATCH';
    end if;
    if v_physical.identity_status='DRAFT' then
      update public.ecoflow_physical_skus p set
        display_name=v_physical_name,
        brand=coalesce(v_brand,p.brand),
        supplier_name=coalesce(v_supplier,p.supplier_name),
        updated_by=auth.uid(),updated_at=now()
      where p.id=v_physical.id returning * into v_physical;
    end if;
  else
    insert into public.ecoflow_physical_skus(
      physical_sku_code,display_name,brand,supplier_name,family_id,identity_status,
      created_in_batch_id,created_by,updated_by
    ) values(
      v_physical_code,v_physical_name,v_brand,v_supplier,v_family.id,'DRAFT',
      p_batch_id,auth.uid(),auth.uid()
    ) returning * into v_physical;
  end if;

  -- Resolve/create package conversion without rewriting active history.
  select pk.* into v_package
  from public.ecoflow_physical_sku_packages pk
  where pk.created_in_batch_id=p_batch_id
    and pk.physical_sku_id=v_physical.id
    and pk.package_level=v_level
    and pk.identity_status='DRAFT'
  for update;
  if found then
    update public.ecoflow_physical_sku_packages pk
    set units_in_base_unit=v_units
    where pk.id=v_package.id
    returning * into v_package;
  else
    select pk.* into v_package
    from public.ecoflow_physical_sku_packages pk
    where pk.physical_sku_id=v_physical.id
      and pk.package_level=v_level
      and pk.identity_status='ACTIVE'
    limit 1;
    if not found or v_package.units_in_base_unit<>v_units then
      insert into public.ecoflow_physical_sku_packages(
        physical_sku_id,package_level,units_in_base_unit,identity_status,created_in_batch_id,created_by
      ) values(v_physical.id,v_level,v_units,'DRAFT',p_batch_id,auth.uid())
      returning * into v_package;
    end if;
  end if;

  select b.* into v_draft_binding
  from public.ecoflow_physical_barcode_bindings b
  where b.created_in_batch_id=p_batch_id
    and b.barcode=v_barcode
    and b.identity_status='DRAFT'
  for update;
  if found and (v_draft_binding.physical_sku_id<>v_physical.id or v_draft_binding.package_id<>v_package.id) then
    raise exception 'BARCODE_CONFLICT_INSIDE_COMMISSIONING_BATCH';
  end if;

  -- Retire first, then append a brand-new DRAFT binding. The old row is never
  -- reassigned, deleted or reused.
  update public.ecoflow_physical_barcode_bindings b set
    identity_status='RETIRED',
    revision=b.revision+1,
    retired_by=auth.uid(),
    retired_at=now(),
    retirement_reason='Authorized reassignment: '||v_reason
  where b.id=v_active_binding.id;

  if v_draft_binding.id is null then
    insert into public.ecoflow_physical_barcode_bindings(
      barcode,physical_sku_id,package_id,identity_status,source,created_in_batch_id,created_by
    ) values(
      v_barcode,v_physical.id,v_package.id,'DRAFT','OWNER_AUTHORIZED_REASSIGNMENT',p_batch_id,auth.uid()
    ) returning * into v_draft_binding;
  end if;

  -- Stage the Commercial SKU family contract from the exact conflict payload.
  select l.* into v_draft_link
  from public.ecoflow_commercial_family_links l
  where l.created_in_batch_id=p_batch_id
    and l.commercial_sku_id=v_conflict.commercial_sku_id
    and l.identity_status='DRAFT'
  for update;
  if found then
    if v_draft_link.family_id<>v_family.id then
      raise exception 'COMMERCIAL_SKU_FAMILY_CONFLICT_INSIDE_BATCH';
    end if;
    if v_is_preferred then
      update public.ecoflow_commercial_family_links l set
        preferred_physical_sku_id=v_physical.id,
        substitution_policy=v_policy
      where l.id=v_draft_link.id
      returning * into v_draft_link;
    end if;
  else
    select l.* into v_active_link
    from public.ecoflow_commercial_family_links l
    where l.commercial_sku_id=v_conflict.commercial_sku_id
      and l.identity_status='ACTIVE'
    limit 1;

    if not v_is_preferred then
      if not found or v_active_link.family_id<>v_family.id then
        raise exception 'PREFERRED_PHYSICAL_SKU_REQUIRED_BEFORE_ALTERNATIVE';
      end if;
    else
      insert into public.ecoflow_commercial_family_links(
        commercial_sku_id,family_id,preferred_physical_sku_id,substitution_policy,
        identity_status,created_in_batch_id,created_by
      ) values(
        v_conflict.commercial_sku_id,v_family.id,v_physical.id,v_policy,
        'DRAFT',p_batch_id,auth.uid()
      ) returning * into v_draft_link;
    end if;
  end if;

  v_detail:='Owner/Admin authorized exact barcode replacement. Old binding is retired; replacement remains DRAFT until batch publication.';
  insert into public.ecoflow_product_identity_observations(
    batch_id,command_id,commercial_sku_id,physical_sku_id,family_id,barcode,package_level,
    units_in_base_unit,substitution_policy,is_preferred,observation_status,detail,payload,captured_by
  ) values(
    p_batch_id,p_command_id,v_conflict.commercial_sku_id,v_physical.id,v_family.id,v_barcode,v_level,
    v_units,v_policy,v_is_preferred,'DRAFTED',v_detail,
    v_payload||jsonb_build_object('authorizedConflictObservationId',p_conflict_observation_id,'authorizationReason',v_reason),
    auth.uid()
  ) returning id into v_replacement_observation_id;

  insert into public.ecoflow_barcode_reassignment_authorizations(
    batch_id,barcode,conflict_observation_id,retired_binding_id,replacement_observation_id,
    target_payload,reason,command_id,authorized_by
  ) values(
    p_batch_id,v_barcode,p_conflict_observation_id,v_active_binding.id,v_replacement_observation_id,
    v_payload,v_reason,p_command_id,auth.uid()
  ) returning id into v_authorization_id;

  update public.ecoflow_physical_barcode_bindings b
  set replaced_by_binding_id=v_draft_binding.id
  where b.id=v_active_binding.id;

  if v_is_preferred then
    update public.ecoflow_product_identity_tasks t set
      task_status='DRAFT_READY',batch_id=p_batch_id,
      detail='Authorized replacement mapping captured; submit and publish after all blocking checks pass.',
      updated_at=now(),resolved_by=null,resolved_at=null
    where t.task_key='COMMERCIAL:'||v_conflict.commercial_sku_id::text;
  end if;

  update public.ecoflow_product_identity_tasks t set
    task_status='DRAFT_READY',batch_id=p_batch_id,
    detail='Owner/Admin authorized exact replacement; old barcode owner is retained as retired history.',
    updated_at=now(),resolved_by=null,resolved_at=null
  where t.task_key='BARCODE:'||v_barcode;

  update public.ecoflow_product_identity_batches b
  set revision=b.revision+1,updated_at=now()
  where b.id=p_batch_id
  returning b.revision into v_batch_revision;

  return query select
    v_authorization_id,p_command_id,'APPLIED'::text,v_barcode,
    v_active_binding.id,v_replacement_observation_id,v_physical.id,v_family.id,
    v_batch_revision,v_detail;
end;
$$;

revoke all on function public.ecoflow_authorize_barcode_reassignment(uuid,uuid,bigint,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.ecoflow_authorize_barcode_reassignment(uuid,uuid,bigint,text,uuid)
  to authenticated;

comment on table public.ecoflow_barcode_reassignment_authorizations is
  'Append-only evidence that Owner/Admin approved one exact conflict observation as a barcode replacement. It does not make retired barcode history generally reusable.';
comment on function public.ecoflow_authorize_barcode_reassignment(uuid,uuid,bigint,text,uuid) is
  'Atomically retires the current published barcode owner and stages the exact replacement from one immutable CONFLICT observation. Old binding history is retained.';

notify pgrst,'reload schema';
commit;
