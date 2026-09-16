-- ECOFLOW-340B-2-R2 — governed Customer/Site Wave-1 promotion authority.
-- Migration-ready SQL carrier. Do not apply to production from this engineering task.
-- The formal supabase/migrations file must be created with `supabase migration new`
-- before this carrier is promoted into migration history.

begin;

do $deps$
declare
  v_missing text[] := '{}';
begin
  if to_regclass('public.customers') is null then v_missing := array_append(v_missing,'public.customers'); end if;
  if to_regclass('public.customer_sites') is null then v_missing := array_append(v_missing,'public.customer_sites'); end if;
  if to_regclass('public.addresses') is null then v_missing := array_append(v_missing,'public.addresses'); end if;
  if to_regclass('public.external_customer_mappings') is null then v_missing := array_append(v_missing,'public.external_customer_mappings'); end if;
  if to_regclass('public.ecoflow_unleashed_master_mappings') is null then v_missing := array_append(v_missing,'public.ecoflow_unleashed_master_mappings'); end if;
  if to_regclass('public.unleashed_raw_snapshots') is null then v_missing := array_append(v_missing,'public.unleashed_raw_snapshots'); end if;
  if to_regclass('public.ordermentum_raw_master_resources') is null then v_missing := array_append(v_missing,'public.ordermentum_raw_master_resources'); end if;
  if to_regclass('public.v_ecoflow_ordermentum_customer_master_v1') is null then v_missing := array_append(v_missing,'public.v_ecoflow_ordermentum_customer_master_v1'); end if;
  if to_regclass('public.app_user_profiles') is null then v_missing := array_append(v_missing,'public.app_user_profiles'); end if;
  if to_regprocedure('public.ecoflow_active_app_role()') is null then v_missing := array_append(v_missing,'public.ecoflow_active_app_role()'); end if;
  if to_regprocedure('auth.uid()') is null then v_missing := array_append(v_missing,'auth.uid()'); end if;
  if to_regprocedure('extensions.digest(text,text)') is null then v_missing := array_append(v_missing,'extensions.digest(text,text)'); end if;
  if array_length(v_missing,1) is not null then
    raise exception 'CUSTOMER_SITE_WAVE1_DEPENDENCIES_MISSING:%',array_to_string(v_missing,',');
  end if;
end;
$deps$;

create table if not exists public.ecoflow_customer_wave1_promotion_commands (
  command_id uuid primary key,
  actor_user_id uuid not null,
  expected_membership_sha256 text not null check (expected_membership_sha256 ~ '^[0-9a-f]{64}$'),
  expected_source_evidence_sha256 text not null check (expected_source_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  reason text not null,
  result jsonb not null check (jsonb_typeof(result)='object'),
  created_at timestamptz not null default now()
);

create table if not exists public.ecoflow_site_wave1_promotion_commands (
  command_id uuid primary key,
  actor_user_id uuid not null,
  expected_membership_sha256 text not null check (expected_membership_sha256 ~ '^[0-9a-f]{64}$'),
  expected_source_evidence_sha256 text not null check (expected_source_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  reason text not null,
  result jsonb not null check (jsonb_typeof(result)='object'),
  created_at timestamptz not null default now()
);

alter table public.ecoflow_customer_wave1_promotion_commands enable row level security;
alter table public.ecoflow_site_wave1_promotion_commands enable row level security;
revoke all on table public.ecoflow_customer_wave1_promotion_commands from public,anon,authenticated,service_role;
revoke all on table public.ecoflow_site_wave1_promotion_commands from public,anon,authenticated,service_role;
grant select on table public.ecoflow_customer_wave1_promotion_commands to service_role;
grant select on table public.ecoflow_site_wave1_promotion_commands to service_role;

create or replace function public.ecoflow_customer_wave1_live_evidence_v1()
returns table(
  mapping_id uuid,
  mapping_revision bigint,
  external_code text,
  source_payload_sha256 text,
  source_external_key text,
  source_external_guid text,
  customer_payload jsonb,
  ordermentum_purchaser_id text,
  ordermentum_retailer_id text,
  ordermentum_purchaser_payload_hash text,
  ordermentum_customer_name text,
  match_method text,
  disposition text,
  membership_line text,
  evidence_line text
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $function$
  with uc as (
    select
      m.id as mapping_id,
      m.revision as mapping_revision,
      m.source_external_code as external_code,
      m.source_payload_sha256,
      m.source_external_key,
      m.source_external_guid,
      s.payload as customer_payload,
      lower(btrim(coalesce(s.payload->>'Email',''))) as email_norm,
      lower(regexp_replace(coalesce(s.payload->>'CustomerName',''),'[^a-zA-Z0-9]+','','g')) as name_norm,
      regexp_replace(coalesce(s.payload->>'PhoneNumber',''),'[^0-9]+','','g') as phone_norm
    from public.ecoflow_unleashed_master_mappings m
    join public.unleashed_raw_snapshots s
      on s.resource='customers' and s.external_key=m.source_external_key
    where m.entity_type='CUSTOMER'
  ), om0 as (
    select
      v.external_purchaser_id,
      v.external_retailer_id,
      v.customer_or_store_name,
      lower(btrim(coalesce(v.email,''))) as email_norm,
      lower(regexp_replace(coalesce(v.customer_or_store_name,''),'[^a-zA-Z0-9]+','','g')) as name_norm,
      regexp_replace(coalesce(v.phone,''),'[^0-9]+','','g') as phone_norm,
      r.payload_hash
    from public.v_ecoflow_ordermentum_customer_master_v1 v
    join public.ordermentum_raw_master_resources r
      on r.resource_type='purchasers'
     and r.external_id=v.external_purchaser_id
     and coalesce(r.is_deleted_or_missing,false)=false
  ), om as (
    select om0.*,count(*) over(partition by email_norm) as email_count
    from om0
    where email_norm<>''
  ), qualified as (
    select
      uc.*,
      om.external_purchaser_id,
      om.external_retailer_id,
      om.payload_hash as ordermentum_purchaser_payload_hash,
      om.customer_or_store_name as ordermentum_customer_name,
      case
        when uc.name_norm<>'' and uc.name_norm=om.name_norm then 'EMAIL_NAME'::text
        when uc.phone_norm<>'' and uc.phone_norm=om.phone_norm and uc.name_norm<>om.name_norm then 'EMAIL_PHONE'::text
        else null
      end as match_method
    from uc
    join om on om.email_norm=uc.email_norm and om.email_count=1
  ), evidence as (
    select * from qualified where match_method is not null
  ), purchaser_counts as (
    select external_purchaser_id,count(*)::integer as candidate_count
    from evidence
    group by external_purchaser_id
  ), labeled as (
    select e.*,
      case when pc.candidate_count=1 then 'AUTO'::text else 'HOLD_DUPLICATE_EXTERNAL_ID'::text end as disposition
    from evidence e
    join purchaser_counts pc using(external_purchaser_id)
  )
  select
    l.mapping_id,
    l.mapping_revision,
    l.external_code,
    l.source_payload_sha256,
    l.source_external_key,
    l.source_external_guid,
    l.customer_payload,
    l.external_purchaser_id,
    l.external_retailer_id,
    l.ordermentum_purchaser_payload_hash,
    l.ordermentum_customer_name,
    l.match_method,
    l.disposition,
    l.external_code||'|'||l.external_purchaser_id||'|'||l.match_method||'|'||l.disposition,
    l.external_code||'|'||l.mapping_id||'|'||l.mapping_revision||'|'||l.source_payload_sha256||'|'||l.source_external_key||'|'||coalesce(l.source_external_guid,'')||'|'||l.external_purchaser_id||'|'||coalesce(l.external_retailer_id,'')||'|'||l.ordermentum_purchaser_payload_hash||'|'||l.match_method
  from labeled l;
$function$;

alter function public.ecoflow_customer_wave1_live_evidence_v1() owner to postgres;
revoke all on function public.ecoflow_customer_wave1_live_evidence_v1() from public,anon,authenticated,service_role;

create or replace function public.ecoflow_site_wave1_live_evidence_v1()
returns table(
  parent_customer_code text,
  delivery_mapping_id uuid,
  mapping_revision bigint,
  source_payload_sha256 text,
  source_external_key text,
  source_external_guid text,
  address_guid text,
  address_payload jsonb,
  ordermentum_purchaser_id text,
  ordermentum_purchaser_payload_hash text,
  customer_disposition text,
  disposition text,
  exact_location boolean,
  membership_line text,
  evidence_line text
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $function$
  with c as (
    select * from public.ecoflow_customer_wave1_live_evidence_v1()
  ), om as (
    select
      v.external_purchaser_id,
      lower(regexp_replace(coalesce(v.suburb,''),'[^a-zA-Z0-9]+','','g')) as suburb_norm,
      regexp_replace(coalesce(v.postcode,''),'[^0-9]+','','g') as postcode_norm
    from public.v_ecoflow_ordermentum_customer_master_v1 v
  ), scoped as (
    select
      c.external_code as parent_customer_code,
      dm.id as delivery_mapping_id,
      dm.revision as mapping_revision,
      dm.source_payload_sha256,
      dm.source_external_key,
      dm.source_external_guid,
      a.item->>'Guid' as address_guid,
      a.item as address_payload,
      c.ordermentum_purchaser_id,
      c.ordermentum_purchaser_payload_hash,
      c.disposition as customer_disposition,
      lower(regexp_replace(coalesce(a.item->>'Suburb',''),'[^a-zA-Z0-9]+','','g')) as site_suburb_norm,
      regexp_replace(coalesce(a.item->>'PostalCode',''),'[^0-9]+','','g') as site_postcode_norm,
      om.suburb_norm as om_suburb_norm,
      om.postcode_norm as om_postcode_norm,
      coalesce(lower(a.item->>'Obsolete') in ('true','1','yes'),false) as obsolete
    from c
    join om on om.external_purchaser_id=c.ordermentum_purchaser_id
    join public.ecoflow_unleashed_master_mappings dm
      on dm.entity_type='CUSTOMER_DELIVERY_ADDRESS'
     and upper(dm.source_external_code)=upper(c.external_code)
    join public.unleashed_raw_snapshots ds
      on ds.resource='customer_delivery_addresses'
     and ds.external_key=dm.source_external_key
    cross join lateral jsonb_array_elements(coalesce(ds.payload->'Addresses','[]'::jsonb)) a(item)
  ), labeled as (
    select s.*,
      (s.site_suburb_norm=s.om_suburb_norm and s.site_postcode_norm=s.om_postcode_norm) as exact_location,
      case
        when s.customer_disposition<>'AUTO' then 'HOLD_DUPLICATE_PARENT'::text
        when s.site_suburb_norm=s.om_suburb_norm and s.site_postcode_norm=s.om_postcode_norm then 'AUTO'::text
        else 'HOLD_LOCATION_CONFLICT'::text
      end as disposition
    from scoped s
    where not s.obsolete
  )
  select
    l.parent_customer_code,
    l.delivery_mapping_id,
    l.mapping_revision,
    l.source_payload_sha256,
    l.source_external_key,
    l.source_external_guid,
    l.address_guid,
    l.address_payload,
    l.ordermentum_purchaser_id,
    l.ordermentum_purchaser_payload_hash,
    l.customer_disposition,
    l.disposition,
    l.exact_location,
    l.parent_customer_code||'|'||l.address_guid||'|'||l.ordermentum_purchaser_id||'|'||l.disposition,
    l.parent_customer_code||'|'||l.delivery_mapping_id||'|'||l.mapping_revision||'|'||l.source_payload_sha256||'|'||l.source_external_key||'|'||coalesce(l.source_external_guid,'')||'|'||l.address_guid||'|'||l.ordermentum_purchaser_id||'|'||l.ordermentum_purchaser_payload_hash
  from labeled l;
$function$;

alter function public.ecoflow_site_wave1_live_evidence_v1() owner to postgres;
revoke all on function public.ecoflow_site_wave1_live_evidence_v1() from public,anon,authenticated,service_role;

create or replace function public.ecoflow_promote_customer_wave1_v1(
  p_command_id uuid,
  p_expected_membership_sha256 text,
  p_expected_source_evidence_sha256 text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  c_membership_90 constant text := '645d02193e4e2f240406971e0f41a5be8f1b14ffc3f28621fdc9c564ab95adbe';
  c_membership_82 constant text := '604c695c505dadf9d93ba251f1ff1edd8d27f8645406c060e4165ca93146e1c3';
  c_evidence_90 constant text := '9f19583c405d9d8f31574067ce0aa6eaa13f6e0ef8ac71bd184322324778ee65';
  c_evidence_82 constant text := 'f8c4144d1cb50708ca6c7a0fbf760ceaa9f6ac92ab5f33b9715e9ec6e22cecb7';
  c_hold_8 constant text := 'e437b043fb858099de1651241ec89f70e8c53a552123832ae41e590122e25b3b';
  v_actor uuid;
  v_fingerprint text;
  v_existing public.ecoflow_customer_wave1_promotion_commands%rowtype;
  v_count integer;
  v_auto integer;
  v_hold integer;
  v_membership_90 text;
  v_membership_82 text;
  v_evidence_90 text;
  v_evidence_82 text;
  v_hold_8 text;
  v_customer_id uuid;
  v_row record;
  v_updated integer;
  v_result jsonb;
begin
  if p_command_id is null or length(btrim(coalesce(p_reason,''))) < 3 then
    raise exception 'CUSTOMER_WAVE1_COMMAND_CONTEXT_REQUIRED';
  end if;
  if p_expected_membership_sha256<>c_membership_82
     or p_expected_source_evidence_sha256<>c_evidence_82 then
    raise exception 'CUSTOMER_WAVE1_EXPECTED_EVIDENCE_MISMATCH';
  end if;

  v_actor := auth.uid();
  if v_actor is null then raise exception 'CUSTOMER_WAVE1_AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.app_user_profiles p
    where p.user_id=v_actor and p.is_active and p.team_status='ACTIVE' and p.app_role in ('OWNER','ADMIN')
  ) then
    raise exception 'CUSTOMER_WAVE1_OWNER_ADMIN_REQUIRED';
  end if;
  if coalesce(public.ecoflow_active_app_role(),'') not in ('OWNER','ADMIN') then
    raise exception 'CUSTOMER_WAVE1_ACTIVE_ROLE_REQUIRED';
  end if;

  v_fingerprint := encode(extensions.digest(
    'CUSTOMER_WAVE1_V1|'||p_expected_membership_sha256||'|'||p_expected_source_evidence_sha256||'|'||btrim(p_reason),
    'sha256'
  ),'hex');

  perform pg_advisory_xact_lock(hashtextextended(p_command_id::text,0));
  select * into v_existing
  from public.ecoflow_customer_wave1_promotion_commands c
  where c.command_id=p_command_id;
  if found then
    if v_existing.actor_user_id<>v_actor or v_existing.request_fingerprint<>v_fingerprint then
      raise exception 'CUSTOMER_WAVE1_COMMAND_REPLAY_CONFLICT';
    end if;
    return v_existing.result || jsonb_build_object('replayed',true);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ecoflow-customer-wave1-v1',0));
  perform m.id from public.ecoflow_unleashed_master_mappings m where m.entity_type='CUSTOMER' for update;
  perform s.id from public.unleashed_raw_snapshots s where s.resource='customers' for share;
  perform r.id from public.ordermentum_raw_master_resources r where r.resource_type='purchasers' and coalesce(r.is_deleted_or_missing,false)=false for share;

  -- Freeze the exact evidence relation used by every subsequent gate and write.
  -- Under READ COMMITTED, re-running the live helper in later statements could
  -- otherwise admit a concurrently inserted eligible row after the hash gate.
  create temporary table pg_temp.ecoflow_customer_wave1_evidence_snapshot
  on commit drop
  as select * from public.ecoflow_customer_wave1_live_evidence_v1();

  select
    count(*)::integer,
    count(*) filter(where disposition='AUTO')::integer,
    count(*) filter(where disposition='HOLD_DUPLICATE_EXTERNAL_ID')::integer,
    encode(extensions.digest(string_agg(membership_line,chr(10) order by external_code),'sha256'),'hex'),
    encode(extensions.digest(string_agg(membership_line,chr(10) order by external_code) filter(where disposition='AUTO'),'sha256'),'hex'),
    encode(extensions.digest(string_agg(evidence_line,chr(10) order by external_code),'sha256'),'hex'),
    encode(extensions.digest(string_agg(evidence_line,chr(10) order by external_code) filter(where disposition='AUTO'),'sha256'),'hex'),
    encode(extensions.digest(string_agg(external_code||'|'||ordermentum_purchaser_id||'|'||match_method,chr(10) order by external_code) filter(where disposition='HOLD_DUPLICATE_EXTERNAL_ID'),'sha256'),'hex')
  into v_count,v_auto,v_hold,v_membership_90,v_membership_82,v_evidence_90,v_evidence_82,v_hold_8
  from pg_temp.ecoflow_customer_wave1_evidence_snapshot;

  if v_count<>90 or v_auto<>82 or v_hold<>8
     or v_membership_90<>c_membership_90 or v_membership_82<>c_membership_82
     or v_evidence_90<>c_evidence_90 or v_evidence_82<>c_evidence_82 or v_hold_8<>c_hold_8 then
    raise exception 'CUSTOMER_WAVE1_EVIDENCE_DRIFT';
  end if;

  if exists (
    select 1
    from pg_temp.ecoflow_customer_wave1_evidence_snapshot e
    join public.ecoflow_unleashed_master_mappings m on m.id=e.mapping_id
    where e.disposition='AUTO'
      and (m.mapping_status<>'UNMATCHED' or m.canonical_object_type is not null or m.canonical_object_id is not null or m.canonical_code is not null or m.ordermentum_external_id is not null)
  ) then raise exception 'CUSTOMER_WAVE1_SOURCE_MAPPING_NOT_PRISTINE'; end if;

  if exists (
    select 1 from pg_temp.ecoflow_customer_wave1_evidence_snapshot e
    join public.customers c on c.customer_code=e.external_code
    where e.disposition='AUTO'
  ) then raise exception 'CUSTOMER_WAVE1_CUSTOMER_CODE_CONFLICT'; end if;

  if exists (
    select 1 from pg_temp.ecoflow_customer_wave1_evidence_snapshot e
    join public.external_customer_mappings x on x.provider='ORDERMENTUM' and x.external_customer_id=e.ordermentum_purchaser_id
    where e.disposition='AUTO'
  ) then raise exception 'CUSTOMER_WAVE1_EXTERNAL_ID_CONFLICT'; end if;

  if exists (
    select 1 from pg_temp.ecoflow_customer_wave1_evidence_snapshot e
    where e.disposition='AUTO'
      and (
        nullif(btrim(coalesce(e.external_code,'')),'') is null
        or nullif(btrim(coalesce(e.customer_payload->>'CustomerName','')),'') is null
        or coalesce(lower(e.customer_payload->>'Obsolete') in ('true','1','yes'),false)
      )
  ) then raise exception 'CUSTOMER_WAVE1_SOURCE_PAYLOAD_INVALID'; end if;

  for v_row in
    select * from pg_temp.ecoflow_customer_wave1_evidence_snapshot
    where disposition='AUTO'
    order by external_code
  loop
    insert into public.customers(customer_code,display_name,invoice_name,is_active)
    values(
      v_row.external_code,
      btrim(v_row.customer_payload->>'CustomerName'),
      btrim(v_row.customer_payload->>'CustomerName'),
      true
    ) returning id into v_customer_id;

    insert into public.external_customer_mappings(provider,external_customer_id,external_customer_name,customer_id,is_active)
    values('ORDERMENTUM',v_row.ordermentum_purchaser_id,nullif(btrim(v_row.ordermentum_customer_name),''),v_customer_id,true);

    update public.ecoflow_unleashed_master_mappings m
    set mapping_status='MATCHED',
        canonical_object_type='CUSTOMER',
        canonical_object_id=v_customer_id,
        canonical_code=v_row.external_code,
        ordermentum_external_id=v_row.ordermentum_purchaser_id,
        match_method='WAVE1_'||v_row.match_method,
        decision_source='AUTO',
        revision=m.revision+1,
        reviewed_by=v_actor,
        reviewed_at=now(),
        review_reason=btrim(p_reason),
        updated_at=now()
    where m.id=v_row.mapping_id
      and m.revision=v_row.mapping_revision
      and m.source_payload_sha256=v_row.source_payload_sha256
      and m.mapping_status='UNMATCHED';
    get diagnostics v_updated=row_count;
    if v_updated<>1 then raise exception 'CUSTOMER_WAVE1_CONCURRENT_SOURCE_DRIFT'; end if;
  end loop;

  v_result := jsonb_build_object(
    'accepted',true,'replayed',false,'status','PROMOTED','command_id',p_command_id,
    'customer_count',82,'held_customer_count',8,
    'membership_sha256',c_membership_82,'source_evidence_sha256',c_evidence_82
  );

  insert into public.ecoflow_customer_wave1_promotion_commands(
    command_id,actor_user_id,expected_membership_sha256,expected_source_evidence_sha256,request_fingerprint,reason,result
  ) values(p_command_id,v_actor,p_expected_membership_sha256,p_expected_source_evidence_sha256,v_fingerprint,btrim(p_reason),v_result);

  return v_result;
end;
$function$;

alter function public.ecoflow_promote_customer_wave1_v1(uuid,text,text,text) owner to postgres;
revoke all on function public.ecoflow_promote_customer_wave1_v1(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.ecoflow_promote_customer_wave1_v1(uuid,text,text,text) to authenticated;

create or replace function public.ecoflow_promote_site_wave1_v1(
  p_command_id uuid,
  p_expected_membership_sha256 text,
  p_expected_source_evidence_sha256 text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  c_membership_76 constant text := '4e964f0441778f52aded3cdfe671733f16feb191d8c8d44a8d9e2d647fe84fd2';
  c_membership_71 constant text := '5972b42f7541dfef576fe464a344d891434e78307325516708171287a418c1af';
  c_evidence_75 constant text := '67f16299aea8327632fdeac30bb531563dc5776d0e805e7facbac75bac1bd459';
  c_evidence_71 constant text := 'a30654f80426baadd6b7965497e03fcc459513c811e86e23c1b9aca331c71d1a';
  c_hold_4 constant text := 'a34c230a7c4659494e2300ba0b34bbcf9bb3960a9c63b85cf0241321b4f839cc';
  c_location_hold_code constant text := 'CUST-00000296';
  c_location_hold_guid constant text := '4b2b3942-0f08-4abe-87da-4f4b81afc835';
  v_actor uuid;
  v_fingerprint text;
  v_existing public.ecoflow_site_wave1_promotion_commands%rowtype;
  v_scoped integer;
  v_exact integer;
  v_auto integer;
  v_dup_hold integer;
  v_location_hold integer;
  v_membership_76 text;
  v_membership_71 text;
  v_evidence_75 text;
  v_evidence_71 text;
  v_hold_4 text;
  v_row record;
  v_customer_id uuid;
  v_address_id uuid;
  v_site_id uuid;
  v_site_code text;
  v_display_name text;
  v_updated integer;
  v_result jsonb;
begin
  if p_command_id is null or length(btrim(coalesce(p_reason,''))) < 3 then
    raise exception 'SITE_WAVE1_COMMAND_CONTEXT_REQUIRED';
  end if;
  if p_expected_membership_sha256<>c_membership_71
     or p_expected_source_evidence_sha256<>c_evidence_71 then
    raise exception 'SITE_WAVE1_EXPECTED_EVIDENCE_MISMATCH';
  end if;

  v_actor := auth.uid();
  if v_actor is null then raise exception 'SITE_WAVE1_AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.app_user_profiles p
    where p.user_id=v_actor and p.is_active and p.team_status='ACTIVE' and p.app_role in ('OWNER','ADMIN')
  ) then raise exception 'SITE_WAVE1_OWNER_ADMIN_REQUIRED'; end if;
  if coalesce(public.ecoflow_active_app_role(),'') not in ('OWNER','ADMIN') then
    raise exception 'SITE_WAVE1_ACTIVE_ROLE_REQUIRED';
  end if;

  v_fingerprint := encode(extensions.digest(
    'SITE_WAVE1_V1|'||p_expected_membership_sha256||'|'||p_expected_source_evidence_sha256||'|'||btrim(p_reason),
    'sha256'
  ),'hex');

  perform pg_advisory_xact_lock(hashtextextended(p_command_id::text,0));
  select * into v_existing from public.ecoflow_site_wave1_promotion_commands c where c.command_id=p_command_id;
  if found then
    if v_existing.actor_user_id<>v_actor or v_existing.request_fingerprint<>v_fingerprint then
      raise exception 'SITE_WAVE1_COMMAND_REPLAY_CONFLICT';
    end if;
    return v_existing.result || jsonb_build_object('replayed',true);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ecoflow-site-wave1-v1',0));
  perform m.id from public.ecoflow_unleashed_master_mappings m where m.entity_type in ('CUSTOMER','CUSTOMER_DELIVERY_ADDRESS') for update;
  perform s.id from public.unleashed_raw_snapshots s where s.resource in ('customers','customer_delivery_addresses') for share;
  perform r.id from public.ordermentum_raw_master_resources r where r.resource_type='purchasers' and coalesce(r.is_deleted_or_missing,false)=false for share;

  -- Freeze one statement snapshot for hashes, parent/source validation and the
  -- mutation loop. New live rows may arrive concurrently, but cannot expand
  -- this already verified command cohort.
  create temporary table pg_temp.ecoflow_site_wave1_evidence_snapshot
  on commit drop
  as select * from public.ecoflow_site_wave1_live_evidence_v1();

  select
    count(*)::integer,
    count(*) filter(where exact_location)::integer,
    count(*) filter(where disposition='AUTO')::integer,
    count(*) filter(where disposition='HOLD_DUPLICATE_PARENT')::integer,
    count(*) filter(where disposition='HOLD_LOCATION_CONFLICT')::integer,
    encode(extensions.digest(string_agg(membership_line,chr(10) order by parent_customer_code,address_guid),'sha256'),'hex'),
    encode(extensions.digest(string_agg(membership_line,chr(10) order by parent_customer_code,address_guid) filter(where disposition='AUTO'),'sha256'),'hex'),
    encode(extensions.digest(string_agg(evidence_line,chr(10) order by parent_customer_code,address_guid) filter(where exact_location),'sha256'),'hex'),
    encode(extensions.digest(string_agg(evidence_line,chr(10) order by parent_customer_code,address_guid) filter(where disposition='AUTO'),'sha256'),'hex'),
    encode(extensions.digest(string_agg(parent_customer_code||'|'||address_guid||'|'||ordermentum_purchaser_id,chr(10) order by parent_customer_code,address_guid) filter(where disposition='HOLD_DUPLICATE_PARENT'),'sha256'),'hex')
  into v_scoped,v_exact,v_auto,v_dup_hold,v_location_hold,v_membership_76,v_membership_71,v_evidence_75,v_evidence_71,v_hold_4
  from pg_temp.ecoflow_site_wave1_evidence_snapshot;

  if v_scoped<>76 or v_exact<>75 or v_auto<>71 or v_dup_hold<>4 or v_location_hold<>1
     or v_membership_76<>c_membership_76 or v_membership_71<>c_membership_71
     or v_evidence_75<>c_evidence_75 or v_evidence_71<>c_evidence_71 or v_hold_4<>c_hold_4 then
    raise exception 'SITE_WAVE1_EVIDENCE_DRIFT';
  end if;

  if not exists (
    select 1 from pg_temp.ecoflow_site_wave1_evidence_snapshot e
    where e.disposition='HOLD_LOCATION_CONFLICT'
      and e.parent_customer_code=c_location_hold_code
      and e.address_guid=c_location_hold_guid
  ) then raise exception 'SITE_WAVE1_LOCATION_HOLD_DRIFT'; end if;

  if exists (
    select 1
    from pg_temp.ecoflow_site_wave1_evidence_snapshot e
    join public.ecoflow_unleashed_master_mappings dm on dm.id=e.delivery_mapping_id
    where e.disposition='AUTO'
      and (dm.mapping_status<>'UNMATCHED' or dm.canonical_object_type is not null or dm.canonical_object_id is not null or dm.canonical_code is not null or dm.ordermentum_external_id is not null)
  ) then raise exception 'SITE_WAVE1_SOURCE_MAPPING_NOT_PRISTINE'; end if;

  if exists (
    select 1
    from pg_temp.ecoflow_site_wave1_evidence_snapshot e
    left join public.ecoflow_unleashed_master_mappings cm
      on cm.entity_type='CUSTOMER' and upper(cm.source_external_code)=upper(e.parent_customer_code)
    left join public.customers c on c.id=cm.canonical_object_id
    where e.disposition='AUTO'
      and (
        cm.id is null or cm.mapping_status<>'MATCHED' or cm.canonical_object_type<>'CUSTOMER'
        or cm.canonical_code<>e.parent_customer_code or cm.ordermentum_external_id<>e.ordermentum_purchaser_id
        or c.id is null or c.customer_code<>e.parent_customer_code or not c.is_active
      )
  ) then raise exception 'SITE_WAVE1_PARENT_CUSTOMER_NOT_ACTIVE'; end if;

  if exists (
    select 1 from pg_temp.ecoflow_site_wave1_evidence_snapshot e
    where e.disposition='AUTO' and (
      nullif(btrim(coalesce(e.address_guid,'')),'') is null
      or nullif(btrim(coalesce(e.address_payload->>'StreetAddress','')),'') is null
      or nullif(btrim(coalesce(e.address_payload->>'Suburb','')),'') is null
      or nullif(btrim(coalesce(e.address_payload->>'Region','')),'') is null
      or nullif(btrim(coalesce(e.address_payload->>'PostalCode','')),'') is null
    )
  ) then raise exception 'SITE_WAVE1_SOURCE_PAYLOAD_INVALID'; end if;

  if exists (
    select 1
    from pg_temp.ecoflow_site_wave1_evidence_snapshot e
    join public.customer_sites cs
      on cs.site_code=e.parent_customer_code||'-SITE-'||upper(substr(replace(e.address_guid,'-',''),1,8))
    where e.disposition='AUTO'
  ) then raise exception 'SITE_WAVE1_SITE_CODE_CONFLICT'; end if;

  for v_row in
    select * from pg_temp.ecoflow_site_wave1_evidence_snapshot
    where disposition='AUTO'
    order by parent_customer_code,address_guid
  loop
    select cm.canonical_object_id into v_customer_id
    from public.ecoflow_unleashed_master_mappings cm
    where cm.entity_type='CUSTOMER'
      and upper(cm.source_external_code)=upper(v_row.parent_customer_code)
      and cm.mapping_status='MATCHED'
      and cm.canonical_object_type='CUSTOMER'
      and cm.canonical_code=v_row.parent_customer_code
      and cm.ordermentum_external_id=v_row.ordermentum_purchaser_id;
    if v_customer_id is null then raise exception 'SITE_WAVE1_PARENT_CUSTOMER_NOT_ACTIVE'; end if;

    insert into public.addresses(line1,line2,suburb,state,postcode,country,latitude,longitude)
    values(
      btrim(v_row.address_payload->>'StreetAddress'),
      nullif(btrim(v_row.address_payload->>'StreetAddress2'),''),
      btrim(v_row.address_payload->>'Suburb'),
      btrim(v_row.address_payload->>'Region'),
      btrim(v_row.address_payload->>'PostalCode'),
      coalesce(nullif(btrim(v_row.address_payload->>'Country'),''),'AU'),
      null,
      null
    ) returning id into v_address_id;

    v_site_code := v_row.parent_customer_code||'-SITE-'||upper(substr(replace(v_row.address_guid,'-',''),1,8));
    select coalesce(nullif(btrim(v_row.address_payload->>'AddressName'),''),c.display_name)
      into v_display_name from public.customers c where c.id=v_customer_id;

    insert into public.customer_sites(customer_id,site_code,display_name,address_id,contact_name,phone,delivery_note,is_active)
    values(
      v_customer_id,v_site_code,v_display_name,v_address_id,null,null,
      nullif(btrim(v_row.address_payload->>'DeliveryInstruction'),''),true
    ) returning id into v_site_id;

    update public.ecoflow_unleashed_master_mappings dm
    set mapping_status='MATCHED',
        canonical_object_type='CUSTOMER_SITE',
        canonical_object_id=v_site_id,
        canonical_code=v_site_code,
        ordermentum_external_id=v_row.ordermentum_purchaser_id,
        match_method='WAVE1_SUBURB_POSTCODE_EXACT',
        decision_source='AUTO',
        revision=dm.revision+1,
        reviewed_by=v_actor,
        reviewed_at=now(),
        review_reason=btrim(p_reason),
        updated_at=now()
    where dm.id=v_row.delivery_mapping_id
      and dm.revision=v_row.mapping_revision
      and dm.source_payload_sha256=v_row.source_payload_sha256
      and dm.mapping_status='UNMATCHED';
    get diagnostics v_updated=row_count;
    if v_updated<>1 then raise exception 'SITE_WAVE1_CONCURRENT_SOURCE_DRIFT'; end if;
  end loop;

  v_result := jsonb_build_object(
    'accepted',true,'replayed',false,'status','PROMOTED','command_id',p_command_id,
    'site_count',71,'duplicate_parent_hold_count',4,'location_hold_count',1,
    'membership_sha256',c_membership_71,'source_evidence_sha256',c_evidence_71
  );

  insert into public.ecoflow_site_wave1_promotion_commands(
    command_id,actor_user_id,expected_membership_sha256,expected_source_evidence_sha256,request_fingerprint,reason,result
  ) values(p_command_id,v_actor,p_expected_membership_sha256,p_expected_source_evidence_sha256,v_fingerprint,btrim(p_reason),v_result);

  return v_result;
end;
$function$;

alter function public.ecoflow_promote_site_wave1_v1(uuid,text,text,text) owner to postgres;
revoke all on function public.ecoflow_promote_site_wave1_v1(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.ecoflow_promote_site_wave1_v1(uuid,text,text,text) to authenticated;

comment on function public.ecoflow_promote_customer_wave1_v1(uuid,text,text,text) is
  'ECOFLOW-340B-2-R2. Exactly-once Owner/Admin-only promotion of the frozen 82-Customer Wave-1 AUTO cohort. No provider traffic.';
comment on function public.ecoflow_promote_site_wave1_v1(uuid,text,text,text) is
  'ECOFLOW-340B-2-R2. Exactly-once Owner/Admin-only promotion of the frozen 71-Site Wave-1 AUTO cohort after parent Customer promotion. No provider traffic.';

commit;
