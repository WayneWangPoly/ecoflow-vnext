-- TRANSFORM-008B: governed comparison candidate read boundary.
-- Restores comparison discovery from server-authoritative entities only.
-- No operational mutation is exposed by this migration.

begin;

create or replace function public.ecoflow_can_read_comparison_candidates()
returns boolean
language sql
stable
security definer
set search_path=pg_catalog,public
as $$
  select auth.uid() is not null
    and public.ecoflow_active_app_role() in ('OWNER','ADMIN','ACCOUNT','VIEWER');
$$;

revoke all on function public.ecoflow_can_read_comparison_candidates() from public,anon,authenticated;
grant execute on function public.ecoflow_can_read_comparison_candidates() to authenticated;

create or replace function public.ecoflow_read_comparison_candidates_v1(
  p_kind text default null,
  p_query text default null,
  p_limit integer default 50
)
returns table(
  candidate_kind text,
  entity_id text,
  label text,
  context jsonb,
  permission text,
  read_at timestamptz
)
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
#variable_conflict error
declare
  v_kind text := nullif(upper(btrim(coalesce(p_kind,''))), '');
  v_query text := lower(btrim(coalesce(p_query,'')));
  v_limit integer := least(greatest(coalesce(p_limit,50),1),100);
begin
  if not public.ecoflow_can_read_comparison_candidates() then
    raise exception using errcode='42501',message='COMPARISON_CANDIDATE_READ_REQUIRED';
  end if;

  if v_kind is not null and v_kind not in ('CUSTOMER','COMMERCIAL_SKU','PHYSICAL_SKU','DELIVERY_RUN') then
    raise exception using errcode='22023',message='COMPARISON_KIND_INVALID';
  end if;
  if length(v_query)>120 then
    raise exception using errcode='22023',message='COMPARISON_QUERY_TOO_LONG';
  end if;

  return query
  with candidates as (
    select distinct on (s.id)
      'COMMERCIAL_SKU'::text as candidate_kind,
      s.id::text as entity_id,
      concat_ws(' · ', nullif(btrim(coalesce(s.sku_code,'')),''), nullif(btrim(coalesce(s.display_name,'')),''))::text as label,
      jsonb_build_object(
        'skuCode',s.sku_code,
        'displayName',s.display_name,
        'familyId',f.id,
        'familyCode',f.family_code,
        'familyName',f.display_name,
        'identityStatus','READY'
      ) as context,
      'ALLOWED'::text as permission,
      statement_timestamp() as read_at
    from public.skus s
    join public.ecoflow_commercial_family_links l
      on l.commercial_sku_id=s.id
     and l.identity_status='ACTIVE'
     and l.retired_at is null
    join public.ecoflow_sku_families f
      on f.id=l.sku_family_id
     and f.identity_status='ACTIVE'
     and f.retired_at is null
    where (v_kind is null or v_kind='COMMERCIAL_SKU')
      and (
        v_query=''
        or lower(coalesce(s.sku_code,'')) like '%'||v_query||'%'
        or lower(coalesce(s.display_name,'')) like '%'||v_query||'%'
        or lower(coalesce(f.family_code,'')) like '%'||v_query||'%'
        or lower(coalesce(f.display_name,'')) like '%'||v_query||'%'
      )
    order by s.id,f.family_code

    union all

    select
      'PHYSICAL_SKU'::text,
      p.id::text,
      concat_ws(' · ', nullif(btrim(coalesce(p.physical_sku_code,'')),''), nullif(btrim(coalesce(p.display_name,'')),''), nullif(btrim(coalesce(p.brand,'')),''))::text,
      jsonb_build_object(
        'physicalSkuCode',p.physical_sku_code,
        'displayName',p.display_name,
        'brand',p.brand,
        'familyId',f.id,
        'familyCode',f.family_code,
        'familyName',f.display_name,
        'identityStatus','ACTIVE'
      ),
      'ALLOWED'::text,
      statement_timestamp()
    from public.ecoflow_physical_skus p
    join public.ecoflow_sku_families f
      on f.id=p.sku_family_id
     and f.identity_status='ACTIVE'
     and f.retired_at is null
    where p.identity_status='ACTIVE'
      and p.retired_at is null
      and (v_kind is null or v_kind='PHYSICAL_SKU')
      and (
        v_query=''
        or lower(coalesce(p.physical_sku_code,'')) like '%'||v_query||'%'
        or lower(coalesce(p.display_name,'')) like '%'||v_query||'%'
        or lower(coalesce(p.brand,'')) like '%'||v_query||'%'
        or lower(coalesce(f.family_code,'')) like '%'||v_query||'%'
        or lower(coalesce(f.display_name,'')) like '%'||v_query||'%'
      )

    union all

    select
      'CUSTOMER'::text,
      s.retailer_id::text,
      coalesce(nullif(btrim(s.store_name),''),s.retailer_id::text)::text,
      jsonb_build_object(
        'storeName',s.store_name,
        'suburb',s.suburb,
        'state',s.state,
        'source',s.source,
        'verified',s.verified
      ),
      'ALLOWED'::text,
      statement_timestamp()
    from public.ecoflow_store_sites s
    where (v_kind is null or v_kind='CUSTOMER')
      and (
        v_query=''
        or lower(coalesce(s.store_name,'')) like '%'||v_query||'%'
        or lower(coalesce(s.suburb,'')) like '%'||v_query||'%'
        or lower(coalesce(s.state,'')) like '%'||v_query||'%'
        or lower(s.retailer_id::text) like '%'||v_query||'%'
      )

    union all

    select
      'DELIVERY_RUN'::text,
      (r.business_day::text||':'||r.run_code)::text,
      (r.business_day::text||' · Run '||r.run_code)::text,
      jsonb_build_object(
        'businessDay',r.business_day,
        'runCode',r.run_code,
        'routeSnapshotId',r.id,
        'revision',r.revision,
        'routeStatus',r.route_status,
        'approvedAt',r.approved_at
      ),
      'ALLOWED'::text,
      statement_timestamp()
    from public.ecoflow_delivery_route_snapshots r
    where r.route_status='LOCKED'
      and (v_kind is null or v_kind='DELIVERY_RUN')
      and (
        v_query=''
        or lower(r.business_day::text) like '%'||v_query||'%'
        or lower(r.run_code) like '%'||v_query||'%'
        or lower(r.business_day::text||':'||r.run_code) like '%'||v_query||'%'
      )
  )
  select c.candidate_kind,c.entity_id,
    case when nullif(btrim(c.label),'') is null then c.entity_id else c.label end,
    c.context,c.permission,c.read_at
  from candidates c
  order by c.candidate_kind,c.label,c.entity_id
  limit v_limit;
end;
$$;

revoke all on function public.ecoflow_read_comparison_candidates_v1(text,text,integer)
  from public,anon,authenticated;
grant execute on function public.ecoflow_read_comparison_candidates_v1(text,text,integer)
  to authenticated;

comment on function public.ecoflow_read_comparison_candidates_v1(text,text,integer) is
  'Fail-closed read-only comparison candidate authority. Commercial candidates require an ACTIVE published family link; physical candidates require ACTIVE physical and family identity; customers come from the operational store master; delivery runs come from locked server route authority.';

notify pgrst,'reload schema';
commit;
