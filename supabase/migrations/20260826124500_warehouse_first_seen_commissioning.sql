-- WAREHOUSE-SELF-COMMISSION-001
-- Safe live-warehouse first-seen commissioning.
-- Canonical Product Identity remains the only barcode authority.
-- This command may create identity/configuration, but never changes stock quantity
-- and never reassigns/retire/merges/reparents established canonical identity.

begin;

create table if not exists public.ecoflow_warehouse_first_seen_commissions (
  id uuid primary key default extensions.gen_random_uuid(),
  command_id uuid not null unique,
  barcode text not null unique,
  commercial_sku_id uuid not null references public.skus(id) on delete restrict,
  family_id uuid not null references public.ecoflow_sku_families(id) on delete restrict,
  physical_sku_id uuid not null references public.ecoflow_physical_skus(id) on delete restrict,
  package_id uuid not null references public.ecoflow_physical_sku_packages(id) on delete restrict,
  barcode_binding_id uuid not null unique references public.ecoflow_physical_barcode_bindings(id) on delete restrict,
  default_location_code text,
  source_context text not null default 'WAREHOUSE_FIRST_SEEN',
  actor_user_id uuid not null default auth.uid(),
  actor_role text not null check (actor_role in ('OWNER','ADMIN','WAREHOUSE')),
  request_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ecoflow_first_seen_barcode_bounded check (char_length(barcode) between 1 and 128)
);

create index if not exists idx_ecoflow_first_seen_commercial
  on public.ecoflow_warehouse_first_seen_commissions(commercial_sku_id,created_at desc);
alter table public.ecoflow_warehouse_first_seen_commissions enable row level security;
revoke all on table public.ecoflow_warehouse_first_seen_commissions from public,anon,authenticated;
grant select on table public.ecoflow_warehouse_first_seen_commissions to authenticated;
drop policy if exists ecoflow_first_seen_commission_read on public.ecoflow_warehouse_first_seen_commissions;
create policy ecoflow_first_seen_commission_read
on public.ecoflow_warehouse_first_seen_commissions for select to authenticated
using(auth.uid() is not null and public.ecoflow_active_app_role() in ('OWNER','ADMIN','WAREHOUSE'));

create or replace function public.ecoflow_read_first_seen_reference_v1()
returns jsonb
language plpgsql stable security definer
set search_path=pg_catalog,public
as $$
declare v_role text:=public.ecoflow_active_app_role(); v_payload jsonb;
begin
  if auth.uid() is null or v_role not in ('OWNER','ADMIN','WAREHOUSE') then
    raise exception using errcode='42501',message='WAREHOUSE_IDENTITY_READ_REQUIRED';
  end if;
  select jsonb_build_object(
    'commercialSkus',coalesce((select jsonb_agg(jsonb_build_object(
      'skuCode',s.sku_code,'name',s.display_name,'category',s.category,
      'ordermentumSku',(select m.external_product_code from public.external_product_mappings m
        where m.internal_sku_id=s.id and m.provider='ORDERMENTUM' and m.is_active
        order by m.updated_at desc,m.id desc limit 1),
      'fixedShelf',c.fixed_shelf,'familyCode',f.family_code,'familyName',f.family_name,
      'preferredPhysicalSkuCode',p.physical_sku_code,'substitutionPolicy',l.substitution_policy
    ) order by s.display_name,s.sku_code)
      from public.skus s
      left join public.ecoflow_inventory_sku_controls c on upper(c.sku)=upper(s.sku_code)
      left join public.ecoflow_commercial_family_links l on l.commercial_sku_id=s.id and l.identity_status='ACTIVE'
      left join public.ecoflow_sku_families f on f.id=l.family_id and f.identity_status='ACTIVE'
      left join public.ecoflow_physical_skus p on p.id=l.preferred_physical_sku_id and p.identity_status='ACTIVE'
      where lower(coalesce(s.setup_status,'active'))='active'),'[]'::jsonb),
    'families',coalesce((select jsonb_agg(jsonb_build_object('familyCode',f.family_code,'familyName',f.family_name) order by f.family_name,f.family_code)
      from public.ecoflow_sku_families f where f.identity_status='ACTIVE'),'[]'::jsonb),
    'physicalSkus',coalesce((select jsonb_agg(jsonb_build_object(
      'physicalSkuCode',p.physical_sku_code,'name',p.display_name,'brand',p.brand,'supplierName',p.supplier_name,
      'familyCode',f.family_code,'familyName',f.family_name) order by p.display_name,p.physical_sku_code)
      from public.ecoflow_physical_skus p join public.ecoflow_sku_families f on f.id=p.family_id and f.identity_status='ACTIVE'
      where p.identity_status='ACTIVE'),'[]'::jsonb),
    'locations',coalesce((select jsonb_agg(jsonb_build_object(
      'locationCode',w.location_code,'rackTitle',w.rack_title,'displayLevel',w.display_level,'zone',w.zone)
      order by w.sort_order,w.location_code) from public.ecoflow_warehouse_locations w where w.status='ACTIVE'),'[]'::jsonb)
  ) into v_payload;
  return v_payload;
end;$$;
revoke all on function public.ecoflow_read_first_seen_reference_v1() from public,anon;
grant execute on function public.ecoflow_read_first_seen_reference_v1() to authenticated;

create or replace function public.ecoflow_commission_first_seen_barcode_v1(
  p_command_id uuid,p_barcode text,p_commercial_sku_code text,p_physical_sku_code text,p_physical_name text,
  p_brand text,p_supplier_name text,p_family_code text,p_family_name text,p_package_level text,
  p_units_in_base_unit numeric,p_substitution_policy text,p_is_preferred boolean default true,
  p_default_location_code text default null,p_source_context text default 'WAREHOUSE_FIRST_SEEN',p_note text default null
)
returns table(
  commission_id uuid,command_status text,resolution_status text,barcode text,commercial_sku_code text,
  commercial_name text,family_code text,family_name text,physical_sku_code text,physical_name text,
  package_level text,units_in_base_unit numeric,substitution_policy text,default_location_code text,commissioned_at timestamptz
)
language plpgsql security definer
set search_path=pg_catalog,public
as $$
#variable_conflict error
declare
  v_actor uuid:=auth.uid(); v_role text:=public.ecoflow_active_app_role();
  v_barcode text:=nullif(btrim(coalesce(p_barcode,'')),'');
  v_commercial_context text:=nullif(btrim(coalesce(p_commercial_sku_code,'')),'');
  v_physical_code text:=upper(nullif(btrim(coalesce(p_physical_sku_code,'')),''));
  v_physical_name text:=nullif(btrim(coalesce(p_physical_name,'')),'');
  v_family_code text:=upper(nullif(btrim(coalesce(p_family_code,'')),''));
  v_family_name text:=nullif(btrim(coalesce(p_family_name,'')),'');
  v_level text:=upper(nullif(btrim(coalesce(p_package_level,'')),''));
  v_policy text:=upper(nullif(btrim(coalesce(p_substitution_policy,'')),''));
  v_location text:=upper(nullif(btrim(coalesce(p_default_location_code,'')),''));
  v_match_count integer:=0; v_nonactive_count integer:=0;
  v_commercial_id uuid; v_commercial_code text; v_commercial_name text;
  v_family public.ecoflow_sku_families%rowtype; v_physical public.ecoflow_physical_skus%rowtype;
  v_package public.ecoflow_physical_sku_packages%rowtype; v_link public.ecoflow_commercial_family_links%rowtype;
  v_binding public.ecoflow_physical_barcode_bindings%rowtype;
  v_existing public.ecoflow_warehouse_first_seen_commissions%rowtype;
  v_commission public.ecoflow_warehouse_first_seen_commissions%rowtype;
  v_location_row public.ecoflow_warehouse_locations%rowtype; v_resolution record;
begin
  if v_actor is null or v_role not in ('OWNER','ADMIN','WAREHOUSE') then raise exception using errcode='42501',message='WAREHOUSE_FIRST_SEEN_ROLE_REQUIRED'; end if;
  if p_command_id is null then raise exception 'FIRST_SEEN_COMMAND_ID_REQUIRED'; end if;
  if v_barcode is null or char_length(v_barcode)>128 then raise exception 'VALID_BARCODE_REQUIRED'; end if;
  if v_commercial_context is null then raise exception 'COMMERCIAL_SKU_REQUIRED'; end if;
  if v_physical_code is null or v_physical_name is null then raise exception 'PHYSICAL_SKU_REQUIRED'; end if;
  if v_family_code is null or v_family_name is null then raise exception 'FAMILY_REQUIRED'; end if;
  if v_level not in ('CARTON','SLEEVE','INNER','EACH','PALLET') then raise exception 'VALID_PACKAGE_LEVEL_REQUIRED'; end if;
  if p_units_in_base_unit is null or p_units_in_base_unit<=0 or p_units_in_base_unit<>trunc(p_units_in_base_unit) then raise exception 'VALID_UNITS_IN_BASE_UNIT_REQUIRED'; end if;
  if v_policy not in ('ALLOWED','APPROVAL_REQUIRED','PROHIBITED') then raise exception 'VALID_SUBSTITUTION_POLICY_REQUIRED'; end if;

  perform pg_advisory_xact_lock(hashtextextended('ecoflow:first-seen:'||v_barcode,0));
  select c.* into v_existing from public.ecoflow_warehouse_first_seen_commissions c where c.command_id=p_command_id;
  if found then
    if coalesce(v_existing.barcode,'')<>v_barcode then raise exception 'FIRST_SEEN_IDEMPOTENCY_CONFLICT'; end if;
    select * into v_resolution from public.ecoflow_resolve_operational_barcode(v_barcode,null) limit 1;
    return query select v_existing.id,'REPLAYED'::text,v_resolution.resolution_status,v_resolution.barcode,
      v_resolution.commercial_sku_code,v_resolution.commercial_name,v_resolution.family_code,
      (select f.family_name from public.ecoflow_sku_families f where f.id=v_existing.family_id),
      v_resolution.physical_sku_code,v_resolution.physical_name,v_resolution.package_level,v_resolution.units_in_base_unit,
      v_resolution.substitution_policy,v_existing.default_location_code,v_existing.created_at; return;
  end if;

  if exists(select 1 from public.ecoflow_physical_barcode_bindings b where b.barcode=v_barcode) then raise exception 'BARCODE_ALREADY_HAS_CANONICAL_HISTORY'; end if;

  select count(*)::integer,(array_agg(x.id order by x.id))[1],(array_agg(x.sku_code order by x.id))[1],(array_agg(x.display_name order by x.id))[1]
  into v_match_count,v_commercial_id,v_commercial_code,v_commercial_name
  from (
    select distinct s.id,s.sku_code::text,s.display_name::text from public.skus s
    where lower(btrim(s.sku_code::text))=lower(v_commercial_context)
       or exists(select 1 from public.external_product_mappings m where m.internal_sku_id=s.id and m.provider='ORDERMENTUM' and m.is_active
         and lower(btrim(m.external_product_code))=lower(v_commercial_context))
  ) x;
  if v_match_count=0 then raise exception 'COMMERCIAL_SKU_NOT_FOUND'; end if;
  if v_match_count<>1 then raise exception 'COMMERCIAL_SKU_AMBIGUOUS'; end if;

  select f.* into v_family from public.ecoflow_sku_families f where upper(f.family_code)=v_family_code and f.identity_status='ACTIVE' order by f.created_at limit 1;
  if not found then
    select count(*)::integer into v_nonactive_count from public.ecoflow_sku_families f where upper(f.family_code)=v_family_code;
    if v_nonactive_count>0 then raise exception 'FAMILY_CODE_HAS_NONACTIVE_HISTORY'; end if;
    insert into public.ecoflow_sku_families(family_code,family_name,description,identity_status,revision,created_by,updated_by,created_at,updated_at)
    values(v_family_code,v_family_name,'Created by safe warehouse first-seen commissioning','ACTIVE',1,v_actor,v_actor,now(),now()) returning * into v_family;
  end if;

  select p.* into v_physical from public.ecoflow_physical_skus p where upper(p.physical_sku_code)=v_physical_code and p.identity_status='ACTIVE' order by p.created_at limit 1;
  if found then
    if v_physical.family_id<>v_family.id then raise exception 'PHYSICAL_SKU_REPARENT_NOT_ALLOWED'; end if;
  else
    select count(*)::integer into v_nonactive_count from public.ecoflow_physical_skus p where upper(p.physical_sku_code)=v_physical_code;
    if v_nonactive_count>0 then raise exception 'PHYSICAL_SKU_CODE_HAS_NONACTIVE_HISTORY'; end if;
    insert into public.ecoflow_physical_skus(physical_sku_code,display_name,brand,supplier_name,family_id,identity_status,revision,created_by,updated_by,created_at,updated_at)
    values(v_physical_code,v_physical_name,nullif(btrim(coalesce(p_brand,'')),''),nullif(btrim(coalesce(p_supplier_name,'')),''),v_family.id,'ACTIVE',1,v_actor,v_actor,now(),now()) returning * into v_physical;
  end if;

  select pk.* into v_package from public.ecoflow_physical_sku_packages pk
  where pk.physical_sku_id=v_physical.id and pk.package_level=v_level and pk.identity_status='ACTIVE' order by pk.created_at limit 1;
  if found then
    if v_package.units_in_base_unit<>p_units_in_base_unit then raise exception 'PACKAGE_CONVERSION_CHANGE_NOT_ALLOWED'; end if;
  else
    if exists(select 1 from public.ecoflow_physical_sku_packages pk where pk.physical_sku_id=v_physical.id and pk.package_level=v_level) then raise exception 'PACKAGE_LEVEL_HAS_NONACTIVE_HISTORY'; end if;
    insert into public.ecoflow_physical_sku_packages(physical_sku_id,package_level,units_in_base_unit,identity_status,revision,created_by,created_at,active_from)
    values(v_physical.id,v_level,p_units_in_base_unit,'ACTIVE',1,v_actor,now(),now()) returning * into v_package;
  end if;

  select l.* into v_link from public.ecoflow_commercial_family_links l where l.commercial_sku_id=v_commercial_id and l.identity_status='ACTIVE' order by l.created_at limit 1;
  if found then
    if v_link.family_id<>v_family.id then raise exception 'COMMERCIAL_FAMILY_REPLACEMENT_NOT_ALLOWED'; end if;
    if v_link.substitution_policy<>v_policy then raise exception 'SUBSTITUTION_POLICY_CHANGE_NOT_ALLOWED'; end if;
    if coalesce(p_is_preferred,true) and v_link.preferred_physical_sku_id<>v_physical.id then raise exception 'PREFERRED_PHYSICAL_REPLACEMENT_NOT_ALLOWED'; end if;
  else
    if exists(select 1 from public.ecoflow_commercial_family_links l where l.commercial_sku_id=v_commercial_id) then raise exception 'COMMERCIAL_LINK_HAS_NONACTIVE_HISTORY'; end if;
    if not coalesce(p_is_preferred,true) then raise exception 'FIRST_COMMERCIAL_LINK_REQUIRES_PREFERRED_PHYSICAL'; end if;
    insert into public.ecoflow_commercial_family_links(commercial_sku_id,family_id,preferred_physical_sku_id,substitution_policy,identity_status,revision,created_by,created_at,active_from)
    values(v_commercial_id,v_family.id,v_physical.id,v_policy,'ACTIVE',1,v_actor,now(),now()) returning * into v_link;
  end if;

  insert into public.ecoflow_physical_barcode_bindings(barcode,physical_sku_id,package_id,identity_status,source,revision,created_by,created_at,active_from)
  values(v_barcode,v_physical.id,v_package.id,'ACTIVE','WAREHOUSE_FIRST_SEEN',1,v_actor,now(),now()) returning * into v_binding;

  if v_location is not null then
    select w.* into v_location_row from public.ecoflow_warehouse_locations w where upper(w.location_code)=v_location and w.status='ACTIVE' limit 1;
    if not found then raise exception 'ACTIVE_DEFAULT_LOCATION_REQUIRED'; end if;
    insert into public.ecoflow_inventory_sku_controls(sku,product_name,fixed_shelf,status,updated_by,updated_at)
    values(v_commercial_code,v_commercial_name,v_location_row.location_code,'ACTIVE',v_actor,now())
    on conflict(sku) do update set product_name=coalesce(public.ecoflow_inventory_sku_controls.product_name,excluded.product_name),fixed_shelf=excluded.fixed_shelf,updated_by=v_actor,updated_at=now();
    v_location:=v_location_row.location_code;
  end if;

  insert into public.ecoflow_warehouse_first_seen_commissions(command_id,barcode,commercial_sku_id,family_id,physical_sku_id,package_id,barcode_binding_id,default_location_code,source_context,actor_user_id,actor_role,request_payload)
  values(p_command_id,v_barcode,v_commercial_id,v_family.id,v_physical.id,v_package.id,v_binding.id,v_location,
    coalesce(nullif(btrim(coalesce(p_source_context,'')),''),'WAREHOUSE_FIRST_SEEN'),v_actor,v_role,
    jsonb_build_object('commercialSkuContext',v_commercial_context,'physicalSkuCode',v_physical_code,'physicalName',v_physical_name,
      'familyCode',v_family_code,'familyName',v_family_name,'packageLevel',v_level,'unitsInBaseUnit',p_units_in_base_unit,
      'substitutionPolicy',v_policy,'isPreferred',coalesce(p_is_preferred,true),'defaultLocationCode',v_location,'note',nullif(btrim(coalesce(p_note,'')),'')))
  returning * into v_commission;

  select * into v_resolution from public.ecoflow_resolve_operational_barcode(v_barcode,v_commercial_code) limit 1;
  if v_resolution.resolution_status<>'RESOLVED' then raise exception 'FIRST_SEEN_POSTCONDITION_FAILED: %',v_resolution.resolution_status; end if;
  return query select v_commission.id,'CREATED'::text,v_resolution.resolution_status,v_resolution.barcode,
    v_resolution.commercial_sku_code,v_resolution.commercial_name,v_resolution.family_code,v_family.family_name,
    v_resolution.physical_sku_code,v_resolution.physical_name,v_resolution.package_level,v_resolution.units_in_base_unit,
    v_resolution.substitution_policy,v_location,v_commission.created_at;
end;$$;
revoke all on function public.ecoflow_commission_first_seen_barcode_v1(uuid,text,text,text,text,text,text,text,text,text,numeric,text,boolean,text,text,text) from public,anon;
grant execute on function public.ecoflow_commission_first_seen_barcode_v1(uuid,text,text,text,text,text,text,text,text,text,numeric,text,boolean,text,text,text) to authenticated;

-- Resolver improvement: when a Family contains several Commercial SKUs, Receiving
-- can still resolve a scanned physical item when exactly one active contract names
-- that Physical SKU as preferred.
create or replace function public.ecoflow_resolve_operational_barcode(p_barcode text,p_expected_sku text default null)
returns table(resolution_status text,barcode text,binding_id uuid,physical_sku_id uuid,physical_sku_code text,physical_name text,
 family_id uuid,family_code text,package_level text,units_in_base_unit numeric,commercial_sku_id uuid,commercial_sku_code text,
 commercial_name text,substitution_policy text,read_at timestamptz)
language plpgsql stable security definer
set search_path=pg_catalog,public
as $$
#variable_conflict error
declare
 v_code text:=nullif(btrim(coalesce(p_barcode,'')),''); v_expected text:=nullif(btrim(coalesce(p_expected_sku,'')),'');
 v_binding_id uuid; v_physical_id uuid; v_physical_code text; v_physical_name text; v_family_id uuid; v_family_code text;
 v_package_level text; v_units numeric; v_commercial_id uuid; v_commercial_code text; v_commercial_name text; v_policy text; v_candidates integer:=0;
begin
 if auth.uid() is null or public.ecoflow_active_app_role() not in ('OWNER','ADMIN','WAREHOUSE') then raise exception using errcode='42501',message='WAREHOUSE_IDENTITY_READ_REQUIRED'; end if;
 if v_code is null then raise exception 'BARCODE_REQUIRED'; end if;
 select b.id,p.id,p.physical_sku_code,p.display_name,f.id,f.family_code,pk.package_level,pk.units_in_base_unit
 into v_binding_id,v_physical_id,v_physical_code,v_physical_name,v_family_id,v_family_code,v_package_level,v_units
 from public.ecoflow_physical_barcode_bindings b
 join public.ecoflow_physical_skus p on p.id=b.physical_sku_id and p.identity_status='ACTIVE'
 join public.ecoflow_sku_families f on f.id=p.family_id and f.identity_status='ACTIVE'
 join public.ecoflow_physical_sku_packages pk on pk.id=b.package_id and pk.identity_status='ACTIVE'
 where b.barcode=v_code and b.identity_status='ACTIVE' limit 1;
 if v_binding_id is null then
   if exists(select 1 from public.ecoflow_physical_barcode_bindings b where b.barcode=v_code and b.identity_status='ACTIVE') then raise exception 'CANONICAL_BARCODE_INTEGRITY_ERROR'; end if;
   if exists(select 1 from public.ecoflow_physical_barcode_bindings b where b.barcode=v_code and b.identity_status='RETIRED') then
     return query select 'RETIRED'::text,v_code,null::uuid,null::uuid,null::text,null::text,null::uuid,null::text,null::text,null::numeric,null::uuid,null::text,null::text,null::text,statement_timestamp();
   else return query select 'UNKNOWN'::text,v_code,null::uuid,null::uuid,null::text,null::text,null::uuid,null::text,null::text,null::numeric,null::uuid,null::text,null::text,null::text,statement_timestamp(); end if; return;
 end if;
 if v_expected is null then
   select count(*)::integer into v_candidates from public.ecoflow_commercial_family_links l where l.family_id=v_family_id and l.identity_status='ACTIVE' and l.preferred_physical_sku_id=v_physical_id;
   if v_candidates=1 then
     select s.id,s.sku_code::text,s.display_name::text,l.substitution_policy::text into v_commercial_id,v_commercial_code,v_commercial_name,v_policy
     from public.ecoflow_commercial_family_links l join public.skus s on s.id=l.commercial_sku_id where l.family_id=v_family_id and l.identity_status='ACTIVE' and l.preferred_physical_sku_id=v_physical_id limit 1;
   elsif v_candidates>1 then
     return query select 'COMMERCIAL_AMBIGUOUS'::text,v_code,v_binding_id,v_physical_id,v_physical_code,v_physical_name,v_family_id,v_family_code,v_package_level,v_units,null::uuid,null::text,null::text,null::text,statement_timestamp(); return;
   else
     select count(*)::integer into v_candidates from public.ecoflow_commercial_family_links l where l.family_id=v_family_id and l.identity_status='ACTIVE';
     if v_candidates=1 then
       select s.id,s.sku_code::text,s.display_name::text,l.substitution_policy::text into v_commercial_id,v_commercial_code,v_commercial_name,v_policy
       from public.ecoflow_commercial_family_links l join public.skus s on s.id=l.commercial_sku_id where l.family_id=v_family_id and l.identity_status='ACTIVE' limit 1;
     elsif v_candidates=0 then return query select 'COMMERCIAL_UNMAPPED'::text,v_code,v_binding_id,v_physical_id,v_physical_code,v_physical_name,v_family_id,v_family_code,v_package_level,v_units,null::uuid,null::text,null::text,null::text,statement_timestamp(); return;
     else return query select 'COMMERCIAL_AMBIGUOUS'::text,v_code,v_binding_id,v_physical_id,v_physical_code,v_physical_name,v_family_id,v_family_code,v_package_level,v_units,null::uuid,null::text,null::text,null::text,statement_timestamp(); return; end if;
   end if;
 else
   select count(*)::integer into v_candidates from public.ecoflow_commercial_family_links l join public.skus s on s.id=l.commercial_sku_id
   where l.family_id=v_family_id and l.identity_status='ACTIVE' and (upper(s.sku_code::text)=upper(v_expected) or exists(select 1 from public.external_product_mappings m where m.internal_sku_id=s.id and m.provider='ORDERMENTUM' and m.is_active and upper(m.external_product_code)=upper(v_expected)));
   if v_candidates<>1 then return query select case when v_candidates=0 then 'COMMERCIAL_MISMATCH' else 'COMMERCIAL_AMBIGUOUS' end::text,v_code,v_binding_id,v_physical_id,v_physical_code,v_physical_name,v_family_id,v_family_code,v_package_level,v_units,null::uuid,null::text,null::text,null::text,statement_timestamp(); return; end if;
   select s.id,s.sku_code::text,s.display_name::text,l.substitution_policy::text into v_commercial_id,v_commercial_code,v_commercial_name,v_policy
   from public.ecoflow_commercial_family_links l join public.skus s on s.id=l.commercial_sku_id
   where l.family_id=v_family_id and l.identity_status='ACTIVE' and (upper(s.sku_code::text)=upper(v_expected) or exists(select 1 from public.external_product_mappings m where m.internal_sku_id=s.id and m.provider='ORDERMENTUM' and m.is_active and upper(m.external_product_code)=upper(v_expected))) limit 1;
 end if;
 return query select 'RESOLVED'::text,v_code,v_binding_id,v_physical_id,v_physical_code,v_physical_name,v_family_id,v_family_code,v_package_level,v_units,v_commercial_id,v_commercial_code,v_commercial_name,v_policy,statement_timestamp();
end;$$;
revoke all on function public.ecoflow_resolve_operational_barcode(text,text) from public,anon;
grant execute on function public.ecoflow_resolve_operational_barcode(text,text) to authenticated;

-- Stocktake now uses the canonical resolver, matching Receiving and Pick.
create or replace function public.ecoflow_record_stocktake_observation(
 p_session_id uuid,p_location_code text,p_sku text,p_product_name text,p_barcode text,p_unit_level text,
 p_units_per_package numeric,p_quantity_packages numeric,p_note text,p_command_id uuid)
returns table(observation_id uuid,review_status text,exception_codes text[],observed_at timestamptz)
language plpgsql security definer
set search_path=pg_catalog,public
as $$
#variable_conflict use_column
declare
 v_role text:=public.ecoflow_require_warehouse_control_role(false); v_session public.ecoflow_stocktake_sessions%rowtype;
 v_location public.ecoflow_warehouse_locations%rowtype; v_row public.ecoflow_stocktake_observations%rowtype;
 v_sku text:=upper(btrim(coalesce(p_sku,''))); v_barcode text:=nullif(btrim(coalesce(p_barcode,'')),'');
 v_level text:=lower(btrim(coalesce(p_unit_level,''))); v_exceptions text[]:=array[]::text[]; v_resolution record;
begin
 if p_command_id is null then raise exception 'STOCKTAKE_COMMAND_ID_REQUIRED'; end if;
 select * into v_row from public.ecoflow_stocktake_observations where command_id=p_command_id;
 if found then return query select v_row.id,v_row.review_status,v_row.exception_codes,v_row.observed_at; return; end if;
 select * into v_session from public.ecoflow_stocktake_sessions where id=p_session_id for update;
 if not found or v_session.session_status not in ('OPEN','IN_PROGRESS') then raise exception 'OPEN_STOCKTAKE_SESSION_REQUIRED'; end if;
 select * into v_location from public.ecoflow_warehouse_locations where upper(location_code)=upper(btrim(coalesce(p_location_code,''))) and status='ACTIVE' limit 1;
 if not found then raise exception 'ACTIVE_WAREHOUSE_LOCATION_REQUIRED'; end if;
 if v_sku='' then raise exception 'STOCKTAKE_SKU_REQUIRED'; end if;
 if v_level not in ('carton','sleeve','each') then raise exception 'VALID_PACKAGE_LEVEL_REQUIRED'; end if;
 if p_units_per_package is null or p_units_per_package<=0 or p_units_per_package<>trunc(p_units_per_package) then raise exception 'VALID_UNITS_PER_PACKAGE_REQUIRED'; end if;
 if p_quantity_packages is null or p_quantity_packages<0 or p_quantity_packages<>trunc(p_quantity_packages) then raise exception 'VALID_PHYSICAL_COUNT_REQUIRED'; end if;
 if v_barcode is null then v_exceptions:=array_append(v_exceptions,'MISSING_BARCODE');
 else
   select * into v_resolution from public.ecoflow_resolve_operational_barcode(v_barcode,v_sku) limit 1;
   if v_resolution.resolution_status in ('UNKNOWN','RETIRED','COMMERCIAL_UNMAPPED') then v_exceptions:=array_append(v_exceptions,'UNKNOWN_BARCODE');
   elsif v_resolution.resolution_status<>'RESOLVED' then v_exceptions:=array_append(v_exceptions,'BARCODE_SKU_MISMATCH'); end if;
   if exists(select 1 from public.ecoflow_stocktake_observations o where o.session_id=p_session_id and o.barcode=v_barcode and upper(o.sku)<>v_sku) then v_exceptions:=array_append(v_exceptions,'DUPLICATE_BARCODE_CONFLICT'); end if;
 end if;
 insert into public.ecoflow_stocktake_observations(session_id,location_id,location_code,sku,product_name,barcode,unit_level,units_per_package,quantity_packages,note,exception_codes,review_status,command_id,observed_by)
 values(p_session_id,v_location.id,v_location.location_code,v_sku,nullif(btrim(coalesce(p_product_name,'')),''),v_barcode,v_level,p_units_per_package,p_quantity_packages,nullif(btrim(coalesce(p_note,'')),''),v_exceptions,case when cardinality(v_exceptions)>0 then 'RECOUNT_REQUIRED' else 'PENDING' end,p_command_id,auth.uid()) returning * into v_row;
 insert into public.ecoflow_stocktake_location_progress(session_id,location_id,location_code,progress_status,observation_count,exception_count)
 values(p_session_id,v_location.id,v_location.location_code,case when cardinality(v_exceptions)>0 then 'REVIEW_REQUIRED' else 'IN_PROGRESS' end,1,cardinality(v_exceptions))
 on conflict(session_id,location_id) do update set progress_status=case when public.ecoflow_stocktake_location_progress.exception_count+excluded.exception_count>0 then 'REVIEW_REQUIRED' else 'IN_PROGRESS' end,
 observation_count=public.ecoflow_stocktake_location_progress.observation_count+1,exception_count=public.ecoflow_stocktake_location_progress.exception_count+excluded.exception_count,
 completed_by=null,completed_at=null,reopened_by=null,reopened_at=null,reopen_reason=null,revision=public.ecoflow_stocktake_location_progress.revision+1,updated_at=clock_timestamp();
 update public.ecoflow_stocktake_sessions set session_status='IN_PROGRESS',revision=revision+1,updated_at=clock_timestamp() where id=p_session_id;
 insert into public.ecoflow_stocktake_events(command_id,session_id,event_type,location_code,observation_id,actor_user_id,actor_role,payload)
 values(p_command_id,p_session_id,'OBSERVATION_RECORDED',v_location.location_code,v_row.id,auth.uid(),v_role,jsonb_build_object('sku',v_sku,'unitLevel',v_level,'quantityPackages',p_quantity_packages,'exceptionCodes',v_exceptions));
 return query select v_row.id,v_row.review_status,v_row.exception_codes,v_row.observed_at;
end;$$;
revoke all on function public.ecoflow_record_stocktake_observation(uuid,text,text,text,text,text,numeric,numeric,text,uuid) from public,anon;
grant execute on function public.ecoflow_record_stocktake_observation(uuid,text,text,text,text,text,numeric,numeric,text,uuid) to authenticated;

commit;
