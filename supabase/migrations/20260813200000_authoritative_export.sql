-- TRANSFORM-008C: authoritative export read boundary.
-- Browser state may describe a governed query, stable selectors, or an approved
-- shadow metric request. Export rows are always re-resolved on the server.

begin;

create or replace function public.ecoflow_can_read_authoritative_export()
returns boolean
language sql
stable
security definer
set search_path=pg_catalog,public
as $$
  select auth.uid() is not null
    and public.ecoflow_active_app_role() in ('OWNER','ADMIN','ACCOUNT','VIEWER');
$$;

revoke all on function public.ecoflow_can_read_authoritative_export() from public,anon,authenticated;
grant execute on function public.ecoflow_can_read_authoritative_export() to authenticated;

create or replace function public.ecoflow_read_authoritative_export_v1(
  p_export_kind text,
  p_dataset_key text default null,
  p_candidate_kind text default null,
  p_query text default null,
  p_selectors jsonb default '[]'::jsonb,
  p_metric_key text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_limit integer default 100
)
returns table(
  export_kind text,
  dataset_key text,
  filename_base text,
  generated_at timestamptz,
  columns jsonb,
  row_index integer,
  row_data jsonb
)
language plpgsql
stable
security definer
set search_path=pg_catalog,public,analytics
as $$
#variable_conflict error
declare
  v_export_kind text := upper(btrim(coalesce(p_export_kind,'')));
  v_dataset_key text := upper(btrim(coalesce(p_dataset_key,'')));
  v_candidate_kind text := upper(btrim(coalesce(p_candidate_kind,'')));
  v_query text := btrim(coalesce(p_query,''));
  v_metric_key text := lower(btrim(coalesce(p_metric_key,'')));
  v_limit integer := least(greatest(coalesce(p_limit,100),1),5000);
  v_generated_at timestamptz := statement_timestamp();
  v_selector jsonb;
  v_selector_kind text;
  v_entity_id text;
  v_ordinal integer;
  v_label text;
  v_context jsonb;
  v_found boolean;
begin
  if not public.ecoflow_can_read_authoritative_export() then
    raise exception using errcode='42501',message='AUTHORITATIVE_EXPORT_READ_REQUIRED';
  end if;

  if v_export_kind not in ('TABLE_VIEW','SELECTED_RECORDS','CHART_DATASET') then
    raise exception using errcode='22023',message='AUTHORITATIVE_EXPORT_KIND_INVALID';
  end if;
  if length(v_query)>120 then
    raise exception using errcode='22023',message='AUTHORITATIVE_EXPORT_QUERY_TOO_LONG';
  end if;

  if v_export_kind='TABLE_VIEW' then
    if v_dataset_key<>'COMPARISON_CANDIDATES' then
      raise exception using errcode='22023',message='AUTHORITATIVE_EXPORT_DATASET_INVALID';
    end if;
    if v_candidate_kind not in ('CUSTOMER','COMMERCIAL_SKU','PHYSICAL_SKU','DELIVERY_RUN') then
      raise exception using errcode='22023',message='AUTHORITATIVE_EXPORT_CANDIDATE_KIND_INVALID';
    end if;

    return query
    select
      'TABLE_VIEW'::text,
      'COMPARISON_CANDIDATES'::text,
      ('ecoflow-comparison-candidates-'||lower(v_candidate_kind))::text,
      v_generated_at,
      jsonb_build_array(
        jsonb_build_object('key','entity_id','label','Entity ID'),
        jsonb_build_object('key','kind','label','Type'),
        jsonb_build_object('key','label','label','Label'),
        jsonb_build_object('key','context','label','Context'),
        jsonb_build_object('key','read_at','label','Read at')
      ),
      row_number() over(order by c.candidate_kind,c.label,c.entity_id)::integer,
      jsonb_build_object(
        'entity_id',c.entity_id,
        'kind',c.candidate_kind,
        'label',c.label,
        'context',c.context,
        'read_at',c.read_at
      )
    from public.ecoflow_read_comparison_candidates_v1(
      v_candidate_kind,
      nullif(v_query,''),
      least(v_limit,100)
    ) c
    order by c.candidate_kind,c.label,c.entity_id;
    return;
  end if;

  if v_export_kind='SELECTED_RECORDS' then
    if v_dataset_key<>'COMPARISON_SELECTION' then
      raise exception using errcode='22023',message='AUTHORITATIVE_EXPORT_DATASET_INVALID';
    end if;
    if p_selectors is null or jsonb_typeof(p_selectors)<>'array' then
      raise exception using errcode='22023',message='AUTHORITATIVE_EXPORT_SELECTORS_INVALID';
    end if;
    if jsonb_array_length(p_selectors)<1 or jsonb_array_length(p_selectors)>8 then
      raise exception using errcode='22023',message='AUTHORITATIVE_EXPORT_SELECTOR_COUNT_INVALID';
    end if;
    if (
      select count(*)<>count(distinct upper(btrim(value->>'kind'))||':'||btrim(value->>'entity_id'))
      from jsonb_array_elements(p_selectors)
    ) then
      raise exception using errcode='22023',message='AUTHORITATIVE_EXPORT_SELECTOR_DUPLICATE';
    end if;

    for v_selector,v_ordinal in
      select value,ordinality::integer
      from jsonb_array_elements(p_selectors) with ordinality
      order by ordinality
    loop
      if jsonb_typeof(v_selector)<>'object'
        or exists(select 1 from jsonb_object_keys(v_selector) k where k not in ('kind','entity_id')) then
        raise exception using errcode='22023',message='AUTHORITATIVE_EXPORT_SELECTOR_SHAPE_INVALID';
      end if;
      v_selector_kind := upper(btrim(coalesce(v_selector->>'kind','')));
      v_entity_id := btrim(coalesce(v_selector->>'entity_id',''));
      if v_selector_kind not in ('CUSTOMER','COMMERCIAL_SKU','PHYSICAL_SKU','DELIVERY_RUN')
        or v_entity_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$' then
        raise exception using errcode='22023',message='AUTHORITATIVE_EXPORT_SELECTOR_INVALID';
      end if;

      v_found := false;
      v_label := null;
      v_context := null;

      if v_selector_kind='COMMERCIAL_SKU' then
        select
          coalesce(nullif(concat_ws(' · ',nullif(btrim(coalesce(s.sku_code,'')),''),nullif(btrim(coalesce(s.display_name,'')),'')),''),s.id::text),
          jsonb_build_object('skuCode',s.sku_code,'displayName',s.display_name,'familyId',a.family_id,'familyCode',a.family_code,'familyName',a.family_name,'identityStatus','READY')
        into v_label,v_context
        from public.skus s
        join lateral (
          select f.id as family_id,f.family_code,f.display_name as family_name
          from public.ecoflow_commercial_family_links l
          join public.ecoflow_sku_families f on f.id=l.sku_family_id and f.identity_status='ACTIVE' and f.retired_at is null
          where l.commercial_sku_id=s.id and l.identity_status='ACTIVE' and l.retired_at is null
          order by f.family_code,f.id limit 1
        ) a on true
        where s.id::text=v_entity_id;
        v_found := found;
      elsif v_selector_kind='PHYSICAL_SKU' then
        select
          coalesce(nullif(concat_ws(' · ',nullif(btrim(coalesce(p.physical_sku_code,'')),''),nullif(btrim(coalesce(p.display_name,'')),''),nullif(btrim(coalesce(p.brand,'')),'')),''),p.id::text),
          jsonb_build_object('physicalSkuCode',p.physical_sku_code,'displayName',p.display_name,'brand',p.brand,'familyId',f.id,'familyCode',f.family_code,'familyName',f.display_name,'identityStatus','ACTIVE')
        into v_label,v_context
        from public.ecoflow_physical_skus p
        join public.ecoflow_sku_families f on f.id=p.sku_family_id and f.identity_status='ACTIVE' and f.retired_at is null
        where p.id::text=v_entity_id and p.identity_status='ACTIVE' and p.retired_at is null;
        v_found := found;
      elsif v_selector_kind='CUSTOMER' then
        select
          coalesce(nullif(btrim(s.store_name),''),s.retailer_id::text),
          jsonb_build_object('storeName',s.store_name,'suburb',s.suburb,'state',s.state,'source',s.source,'verified',s.verified)
        into v_label,v_context
        from public.ecoflow_store_sites s
        where s.retailer_id::text=v_entity_id;
        v_found := found;
      elsif v_selector_kind='DELIVERY_RUN' then
        select
          (r.business_day::text||' · Run '||r.run_code)::text,
          jsonb_build_object('businessDay',r.business_day,'runCode',r.run_code,'routeSnapshotId',r.id,'revision',r.revision,'routeStatus',r.route_status,'approvedAt',r.approved_at)
        into v_label,v_context
        from public.ecoflow_delivery_route_snapshots r
        where r.route_status='LOCKED' and (r.business_day::text||':'||r.run_code)=v_entity_id
        order by r.revision desc limit 1;
        v_found := found;
      end if;

      if not v_found then
        raise exception using errcode='42501',message='AUTHORITATIVE_EXPORT_SELECTOR_STALE_OR_FORBIDDEN';
      end if;

      export_kind := 'SELECTED_RECORDS';
      dataset_key := 'COMPARISON_SELECTION';
      filename_base := 'ecoflow-comparison-selection';
      generated_at := v_generated_at;
      columns := jsonb_build_array(
        jsonb_build_object('key','entity_id','label','Entity ID'),
        jsonb_build_object('key','kind','label','Type'),
        jsonb_build_object('key','label','label','Label'),
        jsonb_build_object('key','context','label','Context'),
        jsonb_build_object('key','read_at','label','Read at')
      );
      row_index := v_ordinal;
      row_data := jsonb_build_object('entity_id',v_entity_id,'kind',v_selector_kind,'label',v_label,'context',v_context,'read_at',v_generated_at);
      return next;
    end loop;
    return;
  end if;

  if v_dataset_key<>'INITIAL_KPI_SHADOW' then
    raise exception using errcode='22023',message='AUTHORITATIVE_EXPORT_DATASET_INVALID';
  end if;
  if v_metric_key not in ('fill_rate','substitution_rate') then
    raise exception using errcode='22023',message='AUTHORITATIVE_EXPORT_METRIC_INVALID';
  end if;
  if p_date_from is null or p_date_to is null or p_date_to<p_date_from or (p_date_to-p_date_from)>366 then
    raise exception using errcode='22023',message='AUTHORITATIVE_EXPORT_DATE_RANGE_INVALID';
  end if;
  if public.ecoflow_active_app_role() not in ('OWNER','ADMIN') then
    raise exception using errcode='42501',message='AUTHORITATIVE_EXPORT_SHADOW_METRIC_OWNER_ADMIN_REQUIRED';
  end if;

  return query
  select
    'CHART_DATASET'::text,
    'INITIAL_KPI_SHADOW'::text,
    ('ecoflow-'||replace(v_metric_key,'_','-')||'-shadow')::text,
    v_generated_at,
    jsonb_build_array(
      jsonb_build_object('key','metric_date','label','Metric date'),
      jsonb_build_object('key','metric_key','label','Metric'),
      jsonb_build_object('key','source_order_key','label','Order'),
      jsonb_build_object('key','source_order_line_key','label','Order line'),
      jsonb_build_object('key','commercial_sku_code','label','Commercial SKU'),
      jsonb_build_object('key','unit_key','label','Unit'),
      jsonb_build_object('key','numerator_quantity','label','Numerator'),
      jsonb_build_object('key','denominator_quantity','label','Denominator'),
      jsonb_build_object('key','metric_value_percent','label','Metric value %'),
      jsonb_build_object('key','projection_state','label','Projection state'),
      jsonb_build_object('key','blocker_code','label','Blocker')
    ),
    row_number() over(order by r.metric_date,r.source_order_line_key)::integer,
    jsonb_build_object(
      'metric_date',r.metric_date,
      'metric_key',r.metric_key,
      'source_order_key',r.source_order_key,
      'source_order_line_key',r.source_order_line_key,
      'commercial_sku_code',r.commercial_sku_code,
      'unit_key',r.unit_key,
      'numerator_quantity',r.numerator_quantity,
      'denominator_quantity',r.denominator_quantity,
      'metric_value_percent',r.metric_value_percent,
      'projection_state',r.projection_state,
      'blocker_code',r.blocker_code
    )
  from analytics.get_initial_kpi_shadow_projection(v_metric_key,p_date_from,p_date_to) r
  order by r.metric_date,r.source_order_line_key
  limit v_limit;
end;
$$;

revoke all on function public.ecoflow_read_authoritative_export_v1(text,text,text,text,jsonb,text,date,date,integer)
  from public,anon,authenticated;
grant execute on function public.ecoflow_read_authoritative_export_v1(text,text,text,text,jsonb,text,date,date,integer)
  to authenticated;

comment on function public.ecoflow_read_authoritative_export_v1(text,text,text,text,jsonb,text,date,date,integer) is
  'TRANSFORM-008C fail-closed export authority. Re-runs governed table queries, re-resolves selected stable selectors, and reads only approved shadow metric RPC output; it never accepts browser row payloads or arbitrary SQL identifiers.';

notify pgrst,'reload schema';
commit;
