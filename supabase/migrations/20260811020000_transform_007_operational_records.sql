-- TRANSFORM-007A: bounded, server-authoritative Inventory, Customer, Accounts
-- and Returns reads. This migration deliberately exposes no mutation command.

begin;

create or replace function public.ecoflow_read_operational_records_v1(
  p_workspace text,
  p_view text default 'overview',
  p_page integer default 1,
  p_page_size integer default 25,
  p_search text default null,
  p_filter text default null,
  p_sort text default null
)
returns table(
  total_count bigint,
  row_data jsonb,
  summary_data jsonb,
  read_at timestamptz
)
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
#variable_conflict error
declare
  v_role text:=public.ecoflow_active_app_role();
  v_workspace text:=lower(btrim(coalesce(p_workspace,'')));
  v_view text:=lower(btrim(coalesce(p_view,'overview')));
  v_page integer:=coalesce(p_page,1);
  v_size integer:=coalesce(p_page_size,25);
  v_offset integer;
  v_search text:='%'||lower(btrim(coalesce(p_search,'')))||'%';
  v_filter text:=lower(btrim(coalesce(p_filter,'')));
  v_summary jsonb:='{}'::jsonb;
  v_read_at timestamptz:=statement_timestamp();
begin
  if auth.uid() is null or coalesce(v_role,'') not in ('OWNER','ADMIN','ACCOUNT','VIEWER') then
    raise exception using errcode='42501',message='OPERATIONAL_RECORDS_ROLE_REQUIRED';
  end if;
  if v_workspace not in ('inventory','customers','accounts','returns') then
    raise exception 'UNKNOWN_OPERATIONAL_RECORDS_WORKSPACE';
  end if;
  if v_workspace='inventory' and v_role='ACCOUNT' then
    raise exception using errcode='42501',message='INVENTORY_WORKSPACE_NOT_AUTHORISED';
  end if;
  if v_workspace='accounts' and v_role not in ('OWNER','ADMIN','ACCOUNT') then
    raise exception using errcode='42501',message='ACCOUNTS_WORKSPACE_NOT_AUTHORISED';
  end if;
  if v_workspace='returns' and v_role not in ('OWNER','ADMIN') then
    raise exception using errcode='42501',message='RETURNS_WORKSPACE_NOT_AUTHORISED';
  end if;
  if v_page<1 or v_size not in (10,20,25,50,100) then
    raise exception 'INVALID_OPERATIONAL_RECORDS_PAGE';
  end if;
  v_offset:=(v_page-1)*v_size;

  if v_workspace='inventory' then
    if v_view not in ('overview','sku','location','below-target','inconsistent','movements','cycle-count') then
      raise exception 'UNKNOWN_INVENTORY_VIEW';
    end if;

    select coalesce((select to_jsonb(k) from public.v_ecoflow_inventory_kpis k limit 1),'{}'::jsonb)
      into v_summary;

    if v_view in ('overview','sku','below-target','inconsistent') then
      return query
      with live_location as (
        select
          upper(i.sku) as sku_key,
          sum(i.quantity)::numeric as live_location_on_hand,
          count(*) filter(where i.status='ACTIVE')::bigint as live_location_count,
          max(i.last_movement_at) as latest_live_location_movement_at
        from public.ecoflow_warehouse_location_items i
        join public.ecoflow_warehouse_locations l on l.id=i.location_id
        where l.status='ACTIVE' and i.status='ACTIVE'
        group by upper(i.sku)
      ), source_rows as (
        select
          c.sku,c.product_name,c.category,c.reorder_target,c.units_7d,c.units_30d,
          c.revenue_30d,c.order_count_30d,c.last_sold_at,c.inventory_signal,
          c.action_hint,c.inventory_rank,c.primary_barcode,c.control_status,
          c.latest_movement_at,
          ll.live_location_on_hand,ll.live_location_count,
          ll.latest_live_location_movement_at,
          case when ll.sku_key is not null then 'WAREHOUSE_LOCATION_LEDGER'
               else c.stock_source end as stock_authority,
          case when ll.sku_key is not null then ll.live_location_on_hand
               else c.effective_on_hand end as authoritative_on_hand
        from public.v_ecoflow_inventory_sku_control c
        left join live_location ll on ll.sku_key=upper(c.sku)
      ), filtered_rows as (
        select s.* from source_rows s
        where (nullif(btrim(coalesce(p_search,'')),'') is null or
          lower(concat_ws(' ',s.sku,s.product_name,s.category,s.inventory_signal,s.primary_barcode)) like v_search)
          and (v_filter='' or lower(coalesce(s.inventory_signal,''))=v_filter)
          and (v_view<>'below-target' or s.inventory_signal='BELOW_TARGET')
          and (v_view<>'inconsistent' or s.inventory_signal in (
            'NEGATIVE_STOCK','NO_STOCK_LEDGER','BARCODE_CLEANUP','NEEDS_SHELF'
          ))
      ), counted_rows as (
        select count(*)::bigint as total_value from filtered_rows
      ), page_rows as (
        select f.* from filtered_rows f
        order by
          case when lower(coalesce(p_sort,''))='quantity-desc' then f.authoritative_on_hand end desc nulls last,
          case when lower(coalesce(p_sort,''))='velocity-desc' then f.units_30d end desc nulls last,
          case when lower(coalesce(p_sort,''))='sku' then f.sku end asc nulls last,
          f.inventory_rank asc nulls last,f.sku
        limit v_size offset v_offset
      ), emitted_rows as (
        select c.total_value,to_jsonb(p) as payload,v_summary as summary_value,v_read_at as read_value
        from counted_rows c cross join page_rows p
        union all
        select c.total_value,null::jsonb,v_summary,v_read_at
        from counted_rows c where not exists(select 1 from page_rows)
      )
      select e.total_value,e.payload,e.summary_value,e.read_value from emitted_rows e;
      return;
    end if;

    if v_view='location' then
      return query
      with filtered_rows as (
        select
          i.id,l.location_code,l.rack_id,l.zone,l.location_type,
          i.sku,i.product_name,i.unit_level,i.quantity as on_hand_location,
          i.source_barcode,i.last_movement_at,i.status as item_status
        from public.ecoflow_warehouse_location_items i
        join public.ecoflow_warehouse_locations l on l.id=i.location_id
        where l.status='ACTIVE' and i.status='ACTIVE'
          and (nullif(btrim(coalesce(p_search,'')),'') is null or
            lower(concat_ws(' ',i.sku,i.product_name,l.location_code,l.rack_id,l.zone,i.source_barcode)) like v_search)
          and (v_filter='' or lower(l.location_code)=v_filter or lower(l.zone)=v_filter)
      ), counted_rows as (
        select count(*)::bigint as total_value from filtered_rows
      ), page_rows as (
        select f.* from filtered_rows f
        order by
          case when lower(coalesce(p_sort,''))='quantity-desc' then f.on_hand_location end desc nulls last,
          f.location_code,f.sku,f.unit_level
        limit v_size offset v_offset
      ), emitted_rows as (
        select c.total_value,to_jsonb(p) as payload,v_summary as summary_value,v_read_at as read_value
        from counted_rows c cross join page_rows p
        union all
        select c.total_value,null::jsonb,v_summary,v_read_at
        from counted_rows c where not exists(select 1 from page_rows)
      )
      select e.total_value,e.payload,e.summary_value,e.read_value from emitted_rows e;
      return;
    end if;

    if v_view='movements' then
      return query
      with movement_rows as (
        select
          m.id,'WAREHOUSE_LOCATION_LEDGER'::text as source_authority,m.movement_type,
          m.sku,m.product_name,m.unit_level,m.quantity,m.barcode,
          coalesce(fl.location_code,cl.location_code) as from_location,
          coalesce(tl.location_code,cl.location_code) as to_location,
          m.transfer_reference as reference_id,m.note,
          m.actor_user_id as actor_user_id,m.created_at as moved_at
        from public.ecoflow_warehouse_movements m
        left join public.ecoflow_warehouse_locations cl on cl.id=m.location_id
        left join public.ecoflow_warehouse_locations fl on fl.id=m.from_location_id
        left join public.ecoflow_warehouse_locations tl on tl.id=m.to_location_id
        union all
        select
          m.id,'LEGACY_INVENTORY_LEDGER'::text,m.movement_type,
          m.sku,m.product_name,null::text,m.quantity,null::text,
          m.from_location,m.to_location,
          concat_ws(':',m.reference_type,m.reference_id),m.action_note,
          m.moved_by,m.moved_at
        from public.ecoflow_inventory_movements m
      ), filtered_rows as (
        select m.* from movement_rows m
        where (nullif(btrim(coalesce(p_search,'')),'') is null or
          lower(concat_ws(' ',m.sku,m.product_name,m.movement_type,m.from_location,m.to_location,m.reference_id)) like v_search)
          and (v_filter='' or lower(m.movement_type)=v_filter or lower(m.source_authority)=v_filter)
      ), counted_rows as (
        select count(*)::bigint as total_value from filtered_rows
      ), page_rows as (
        select f.* from filtered_rows f
        order by f.moved_at desc nulls last,f.id
        limit v_size offset v_offset
      ), emitted_rows as (
        select c.total_value,to_jsonb(p) as payload,v_summary as summary_value,v_read_at as read_value
        from counted_rows c cross join page_rows p
        union all
        select c.total_value,null::jsonb,v_summary,v_read_at
        from counted_rows c where not exists(select 1 from page_rows)
      )
      select e.total_value,e.payload,e.summary_value,e.read_value from emitted_rows e;
      return;
    end if;

    return query
    with filtered_rows as (
      select
        s.id,s.session_type,s.session_status,s.title,s.rack_id,s.blind_count,
        s.revision,s.created_at,s.submitted_at,s.approved_at,s.updated_at,
        (select count(*) from public.ecoflow_stocktake_location_progress p where p.session_id=s.id)::bigint as location_count,
        (select count(*) from public.ecoflow_stocktake_observations o where o.session_id=s.id)::bigint as observation_count,
        (select count(*) from public.ecoflow_stocktake_observations o
          where o.session_id=s.id and cardinality(o.exception_codes)>0 and o.review_status<>'ACCEPTED')::bigint as unresolved_exception_count
      from public.ecoflow_stocktake_sessions s
      where (nullif(btrim(coalesce(p_search,'')),'') is null or
        lower(concat_ws(' ',s.title,s.rack_id,s.session_type,s.session_status)) like v_search)
        and (v_filter='' or lower(s.session_status)=v_filter)
    ), counted_rows as (
      select count(*)::bigint as total_value from filtered_rows
    ), page_rows as (
      select f.* from filtered_rows f
      order by f.updated_at desc nulls last,f.id
      limit v_size offset v_offset
    ), emitted_rows as (
      select c.total_value,to_jsonb(p) as payload,v_summary as summary_value,v_read_at as read_value
      from counted_rows c cross join page_rows p
      union all
      select c.total_value,null::jsonb,v_summary,v_read_at
      from counted_rows c where not exists(select 1 from page_rows)
    )
    select e.total_value,e.payload,e.summary_value,e.read_value from emitted_rows e;
    return;
  end if;

  if v_workspace='customers' then
    if v_view<>'overview' then raise exception 'UNKNOWN_CUSTOMERS_VIEW'; end if;

    select jsonb_build_object(
      'customerCount',count(*),
      'attentionCount',count(*) filter(where d.store_signal not in ('READY','QUIET')),
      'heldCount',count(*) filter(where coalesce(h.active,false)),
      'revenue30d',coalesce(sum(d.revenue_30d),0),
      'latestOrderAt',max(d.last_order_at)
    ) into v_summary
    from public.v_ecoflow_customer_store_directory d
    left join public.ecoflow_account_release_holds h on h.store_id=d.store_id and h.active;

    return query
    with filtered_rows as (
      select
        d.store_id,d.purchaser_id,d.store_name,d.suburb,d.state,d.address,
        d.contact_phone,d.price_group_id,d.verified,d.store_signal,
        d.orders_30d,d.revenue_30d,d.units_30d,d.top_sku_30d,d.top_product_30d,
        d.last_order_at,d.site_updated_at,
        coalesce(h.active,false) as account_hold_active,h.hold_reason,h.updated_at as hold_updated_at
      from public.v_ecoflow_customer_store_directory d
      left join public.ecoflow_account_release_holds h on h.store_id=d.store_id and h.active
      where (nullif(btrim(coalesce(p_search,'')),'') is null or
        lower(concat_ws(' ',d.store_id,d.store_name,d.suburb,d.state,d.address,d.contact_phone,d.price_group_id)) like v_search)
        and (
          v_filter=''
          or (v_filter='held' and coalesce(h.active,false))
          or (v_filter='attention' and d.store_signal not in ('READY','QUIET'))
          or lower(coalesce(d.store_signal,''))=v_filter
        )
    ), counted_rows as (
      select count(*)::bigint as total_value from filtered_rows
    ), page_rows as (
      select f.* from filtered_rows f
      order by
        case when lower(coalesce(p_sort,''))='revenue-desc' then f.revenue_30d end desc nulls last,
        case when lower(coalesce(p_sort,''))='latest' then f.last_order_at end desc nulls last,
        f.account_hold_active desc,f.store_name,f.store_id
      limit v_size offset v_offset
    ), emitted_rows as (
      select c.total_value,to_jsonb(p) as payload,v_summary as summary_value,v_read_at as read_value
      from counted_rows c cross join page_rows p
      union all
      select c.total_value,null::jsonb,v_summary,v_read_at
      from counted_rows c where not exists(select 1 from page_rows)
    )
    select e.total_value,e.payload,e.summary_value,e.read_value from emitted_rows e;
    return;
  end if;

  if v_workspace='accounts' then
    if v_view not in ('overview','held','overdue','open') then raise exception 'UNKNOWN_ACCOUNTS_VIEW'; end if;

    select coalesce((select to_jsonb(k) from public.v_ecoflow_accounts_live_ar_kpis k limit 1),'{}'::jsonb)
      || jsonb_build_object(
        'activeReleaseHolds',(select count(*) from public.ecoflow_account_release_holds h where h.active),
        'releaseAuthority','OWNER_ADMIN_ACCOUNT'
      ) into v_summary;

    return query
    with filtered_rows as (
      select
        d.store_id,d.store_name,d.suburb,d.address,d.contact_phone,d.price_group_id,
        coalesce(a.invoice_count,0) as invoice_count,
        coalesce(a.open_invoice_count,0) as open_invoice_count,
        coalesce(a.overdue_invoice_count,0) as overdue_invoice_count,
        coalesce(a.open_statement_value,0) as open_statement_value,
        coalesce(a.overdue_statement_value,0) as overdue_statement_value,
        coalesce(a.worst_overdue_days,0) as worst_overdue_days,
        coalesce(a.statement_signal,'CLEAR') as statement_signal,
        coalesce(a.accounts_priority,'CLEAR') as accounts_priority,
        a.billing_email,a.billing_contact_name,a.billing_enabled,
        coalesce(h.active,false) as hold_active,h.hold_reason,h.source_action_id,
        h.updated_by as hold_updated_by,h.updated_at as hold_updated_at,
        'OWNER_ADMIN_ACCOUNT'::text as release_authority
      from public.v_ecoflow_customer_store_directory d
      left join public.v_ecoflow_accounts_live_statement_customers a on a.store_id=d.store_id
      left join public.ecoflow_account_release_holds h on h.store_id=d.store_id
      where (nullif(btrim(coalesce(p_search,'')),'') is null or
        lower(concat_ws(' ',d.store_id,d.store_name,d.suburb,d.address,d.price_group_id,a.billing_email,h.hold_reason)) like v_search)
        and (
          (v_view='overview' and (v_filter='' or lower(coalesce(a.accounts_priority,'clear'))=v_filter))
          or (v_view='held' and coalesce(h.active,false))
          or (v_view='overdue' and coalesce(a.overdue_statement_value,0)>0)
          or (v_view='open' and coalesce(a.open_statement_value,0)>0)
        )
    ), counted_rows as (
      select count(*)::bigint as total_value from filtered_rows
    ), page_rows as (
      select f.* from filtered_rows f
      order by
        f.hold_active desc,
        case when lower(coalesce(p_sort,''))='open-desc' then f.open_statement_value end desc nulls last,
        f.overdue_statement_value desc,f.worst_overdue_days desc,f.store_name
      limit v_size offset v_offset
    ), emitted_rows as (
      select c.total_value,to_jsonb(p) as payload,v_summary as summary_value,v_read_at as read_value
      from counted_rows c cross join page_rows p
      union all
      select c.total_value,null::jsonb,v_summary,v_read_at
      from counted_rows c where not exists(select 1 from page_rows)
    )
    select e.total_value,e.payload,e.summary_value,e.read_value from emitted_rows e;
    return;
  end if;

  if v_view not in ('overview','reported','received','inspection','consequence','closed') then
    raise exception 'UNKNOWN_RETURNS_VIEW';
  end if;

  select jsonb_build_object(
    'returnCount',count(*),
    'withDriver',count(*) filter(where e.return_status='WITH_DRIVER'),
    'received',count(*) filter(where e.return_status in ('DROPPED_IN_RETURN_ZONE','RETURNED_TO_WAREHOUSE')),
    'inspection',count(*) filter(where e.return_status='INSPECTION_HOLD'),
    'closed',count(*) filter(where e.return_status not in (
      'WITH_DRIVER','DROPPED_IN_RETURN_ZONE','RETURNED_TO_WAREHOUSE','INSPECTION_HOLD'
    )),
    'missingInventoryConsequence',count(*) filter(where coalesce(ix.consequence_status,'MISSING')='MISSING')
  ) into v_summary
  from public.ecoflow_delivery_exceptions e
  left join lateral (
    select case
      when count(*)=0 then 'MISSING'
      when count(*) filter(where l.resolution='RESTOCK' and l.movement_id is null)>0 then 'MISSING'
      else 'EXPLICIT'
    end as consequence_status
    from public.ecoflow_delivery_return_inspection_lines l where l.exception_id=e.id
  ) ix on true
  where e.return_code is not null;

  return query
  with return_rows as (
    select
      e.id,e.return_code,e.business_day,e.order_id,e.order_number,e.stop_number,
      e.store_name,e.outcome,e.return_cartons,e.reason,e.driver_note,e.return_status,
      e.warehouse_location,e.recorded_at,e.warehouse_received_at,e.driver_returned_at,
      e.inspection_completed_at,e.updated_at,
      coalesce(ix.inspection_line_count,0) as inspection_line_count,
      coalesce(ix.resolutions,array[]::text[]) as dispositions,
      coalesce(ix.consequence_status,'MISSING') as inventory_consequence_status,
      'NOT_RECORDED'::text as account_consequence_status,
      case
        when e.return_status='WITH_DRIVER' then 'REPORTED'
        when e.return_status in ('DROPPED_IN_RETURN_ZONE','RETURNED_TO_WAREHOUSE') then 'RECEIVED'
        when e.return_status='INSPECTION_HOLD' then 'INSPECTED'
        else 'CLOSED'
      end as lifecycle_stage
    from public.ecoflow_delivery_exceptions e
    left join lateral (
      select
        count(*)::bigint as inspection_line_count,
        array_agg(distinct l.resolution order by l.resolution) as resolutions,
        case
          when count(*)=0 then 'MISSING'
          when count(*) filter(where l.resolution='RESTOCK' and l.movement_id is null)>0 then 'MISSING'
          else 'EXPLICIT'
        end as consequence_status
      from public.ecoflow_delivery_return_inspection_lines l where l.exception_id=e.id
    ) ix on true
    where e.return_code is not null
  ), filtered_rows as (
    select r.* from return_rows r
    where (nullif(btrim(coalesce(p_search,'')),'') is null or
      lower(concat_ws(' ',r.return_code,r.order_number,r.store_name,r.outcome,r.reason,r.return_status,r.warehouse_location)) like v_search)
      and (v_filter='' or lower(r.return_status)=v_filter or lower(r.inventory_consequence_status)=v_filter)
      and (v_view<>'reported' or r.lifecycle_stage='REPORTED')
      and (v_view<>'received' or r.lifecycle_stage='RECEIVED')
      and (v_view<>'inspection' or r.lifecycle_stage='INSPECTED')
      and (v_view<>'consequence' or r.inventory_consequence_status='MISSING' or r.account_consequence_status='NOT_RECORDED')
      and (v_view<>'closed' or r.lifecycle_stage='CLOSED')
  ), counted_rows as (
    select count(*)::bigint as total_value from filtered_rows
  ), page_rows as (
    select f.* from filtered_rows f
    order by
      case f.lifecycle_stage when 'REPORTED' then 0 when 'RECEIVED' then 1 when 'INSPECTED' then 2 else 3 end,
      f.recorded_at desc nulls last,f.id
    limit v_size offset v_offset
  ), emitted_rows as (
    select c.total_value,to_jsonb(p) as payload,v_summary as summary_value,v_read_at as read_value
    from counted_rows c cross join page_rows p
    union all
    select c.total_value,null::jsonb,v_summary,v_read_at
    from counted_rows c where not exists(select 1 from page_rows)
  )
  select e.total_value,e.payload,e.summary_value,e.read_value from emitted_rows e;
end;
$$;

create or replace function public.ecoflow_read_operational_record_detail_v1(
  p_workspace text,
  p_record_id text,
  p_limit integer default 50
)
returns table(record_kind text,record_data jsonb,read_at timestamptz)
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
#variable_conflict error
declare
  v_role text:=public.ecoflow_active_app_role();
  v_workspace text:=lower(btrim(coalesce(p_workspace,'')));
  v_record_id text:=nullif(btrim(coalesce(p_record_id,'')),'');
  v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
  v_store_name text;
  v_store_key text;
  v_commercial_sku_id uuid;
  v_read_at timestamptz:=statement_timestamp();
begin
  if auth.uid() is null or coalesce(v_role,'') not in ('OWNER','ADMIN','ACCOUNT','VIEWER') then
    raise exception using errcode='42501',message='OPERATIONAL_RECORDS_ROLE_REQUIRED';
  end if;
  if v_workspace not in ('inventory','customers','accounts','returns') then
    raise exception 'UNKNOWN_OPERATIONAL_RECORDS_WORKSPACE';
  end if;
  if v_record_id is null or length(v_record_id)>180 then
    raise exception 'VALID_OPERATIONAL_RECORD_ID_REQUIRED';
  end if;
  if v_workspace='inventory' and v_role='ACCOUNT' then
    raise exception using errcode='42501',message='INVENTORY_WORKSPACE_NOT_AUTHORISED';
  end if;
  if v_workspace='accounts' and v_role not in ('OWNER','ADMIN','ACCOUNT') then
    raise exception using errcode='42501',message='ACCOUNTS_WORKSPACE_NOT_AUTHORISED';
  end if;
  if v_workspace='returns' and v_role not in ('OWNER','ADMIN') then
    raise exception using errcode='42501',message='RETURNS_WORKSPACE_NOT_AUTHORISED';
  end if;

  if v_workspace='inventory' then
    select coalesce(m.internal_sku_id,s.id) into v_commercial_sku_id
    from public.skus s
    left join public.external_product_mappings m
      on m.internal_sku_id=s.id and m.provider='ORDERMENTUM' and m.is_active
    where upper(s.sku_code)=upper(v_record_id)
       or upper(coalesce(m.external_product_code,''))=upper(v_record_id)
    order by case when upper(coalesce(m.external_product_code,''))=upper(v_record_id) then 0 else 1 end
    limit 1;

    return query
    select 'SUMMARY'::text,to_jsonb(summary_row),v_read_at
    from (
      select
        c.*,
        coalesce(loc.live_location_on_hand,c.effective_on_hand) as authoritative_on_hand,
        case when loc.location_count>0 then 'WAREHOUSE_LOCATION_LEDGER' else c.stock_source end as stock_authority,
        loc.location_count,loc.latest_location_movement_at,
        f.family_code,f.family_name,link.substitution_policy,
        preferred.physical_sku_code as preferred_physical_sku,
        preferred.display_name as preferred_physical_name
      from public.v_ecoflow_inventory_sku_control c
      left join lateral (
        select sum(i.quantity)::numeric as live_location_on_hand,count(*)::bigint as location_count,
          max(i.last_movement_at) as latest_location_movement_at
        from public.ecoflow_warehouse_location_items i
        join public.ecoflow_warehouse_locations l on l.id=i.location_id
        where upper(i.sku)=upper(v_record_id) and i.status='ACTIVE' and l.status='ACTIVE'
      ) loc on true
      left join public.ecoflow_commercial_family_links link
        on link.commercial_sku_id=v_commercial_sku_id and link.identity_status='ACTIVE'
      left join public.ecoflow_sku_families f on f.id=link.family_id and f.identity_status='ACTIVE'
      left join public.ecoflow_physical_skus preferred
        on preferred.id=link.preferred_physical_sku_id and preferred.identity_status='ACTIVE'
      where upper(c.sku)=upper(v_record_id)
      limit 1
    ) summary_row;

    return query
    select 'LOCATION'::text,to_jsonb(location_row),v_read_at
    from (
      select l.location_code,l.rack_id,l.zone,l.location_type,
        i.unit_level,i.quantity as on_hand_location,i.source_barcode,i.last_movement_at
      from public.ecoflow_warehouse_location_items i
      join public.ecoflow_warehouse_locations l on l.id=i.location_id
      where upper(i.sku)=upper(v_record_id) and i.status='ACTIVE' and l.status='ACTIVE'
      order by l.sort_order,l.location_code,i.unit_level
      limit v_limit
    ) location_row;

    return query
    select 'PHYSICAL_SKU'::text,to_jsonb(physical_row),v_read_at
    from (
      select p.id,p.physical_sku_code,p.display_name,p.brand,p.supplier_name,
        p.manufacturer_code,p.revision,
        (p.id=link.preferred_physical_sku_id) as preferred,
        link.substitution_policy
      from public.ecoflow_commercial_family_links link
      join public.ecoflow_physical_skus p on p.family_id=link.family_id and p.identity_status='ACTIVE'
      where link.commercial_sku_id=v_commercial_sku_id and link.identity_status='ACTIVE'
      order by (p.id=link.preferred_physical_sku_id) desc,p.display_name
      limit v_limit
    ) physical_row;

    return query
    select 'PACKAGE'::text,to_jsonb(package_row),v_read_at
    from (
      select p.physical_sku_code,pk.id,pk.package_level,pk.units_in_base_unit,pk.revision
      from public.ecoflow_commercial_family_links link
      join public.ecoflow_physical_skus p on p.family_id=link.family_id and p.identity_status='ACTIVE'
      join public.ecoflow_physical_sku_packages pk on pk.physical_sku_id=p.id and pk.identity_status='ACTIVE'
      where link.commercial_sku_id=v_commercial_sku_id and link.identity_status='ACTIVE'
      order by p.display_name,pk.units_in_base_unit desc
      limit v_limit
    ) package_row;

    return query
    select 'BARCODE'::text,to_jsonb(barcode_row),v_read_at
    from (
      select p.physical_sku_code,b.id,b.barcode,pk.package_level,pk.units_in_base_unit,
        b.source,b.revision,b.active_from
      from public.ecoflow_commercial_family_links link
      join public.ecoflow_physical_skus p on p.family_id=link.family_id and p.identity_status='ACTIVE'
      join public.ecoflow_physical_barcode_bindings b on b.physical_sku_id=p.id and b.identity_status='ACTIVE'
      join public.ecoflow_physical_sku_packages pk on pk.id=b.package_id
      where link.commercial_sku_id=v_commercial_sku_id and link.identity_status='ACTIVE'
      order by p.display_name,b.barcode
      limit v_limit
    ) barcode_row;

    return query
    select 'MOVEMENT'::text,to_jsonb(movement_row),v_read_at
    from (
      select m.id,'WAREHOUSE_LOCATION_LEDGER'::text as source_authority,m.movement_type,
        m.quantity,m.unit_level,
        coalesce(fl.location_code,cl.location_code) as from_location,
        coalesce(tl.location_code,cl.location_code) as to_location,
        m.transfer_reference as reference_id,m.note,m.created_at as moved_at
      from public.ecoflow_warehouse_movements m
      left join public.ecoflow_warehouse_locations cl on cl.id=m.location_id
      left join public.ecoflow_warehouse_locations fl on fl.id=m.from_location_id
      left join public.ecoflow_warehouse_locations tl on tl.id=m.to_location_id
      where upper(m.sku)=upper(v_record_id)
      order by m.created_at desc
      limit v_limit
    ) movement_row;

    return query
    select 'IDENTITY_EXCEPTION'::text,to_jsonb(task_row),v_read_at
    from (
      select t.id,t.task_type,t.task_status,t.blocking,t.barcode,t.detail,t.updated_at
      from public.ecoflow_product_identity_tasks t
      where t.commercial_sku_id=v_commercial_sku_id
        and t.task_status in ('OPEN','DRAFT_READY','CONFLICT')
      order by t.blocking desc,t.updated_at desc
      limit v_limit
    ) task_row;
    return;
  end if;

  if v_workspace in ('customers','accounts') then
    select d.store_name into v_store_name
    from public.v_ecoflow_customer_store_directory d where d.store_id=v_record_id limit 1;
    if v_store_name is null then return; end if;
    v_store_key:=lower(regexp_replace(btrim(v_store_name),'[^a-zA-Z0-9]+','-','g'));

    return query
    select 'SUMMARY'::text,to_jsonb(summary_row),v_read_at
    from (
      select
        d.*,
        a.invoice_count,a.open_invoice_count,a.overdue_invoice_count,
        a.open_statement_value,a.overdue_statement_value,a.worst_overdue_days,
        a.statement_signal,a.accounts_priority,a.billing_email,a.billing_contact_name,a.billing_enabled,
        coalesce(h.active,false) as hold_active,h.hold_reason,h.source_action_id,
        h.updated_by as hold_updated_by,h.updated_at as hold_updated_at,
        'OWNER_ADMIN_ACCOUNT'::text as release_authority
      from public.v_ecoflow_customer_store_directory d
      left join public.v_ecoflow_accounts_live_statement_customers a on a.store_id=d.store_id
      left join public.ecoflow_account_release_holds h on h.store_id=d.store_id
      where d.store_id=v_record_id
      limit 1
    ) summary_row;

    if v_workspace='customers' then
      return query
      select 'ORDER'::text,to_jsonb(order_row),v_read_at
      from (
        select h.* from public.v_ecoflow_customer_store_order_history h
        where h.store_id=v_record_id order by h.order_at desc nulls last
        limit v_limit
      ) order_row;

      return query
      select 'DELIVERY'::text,to_jsonb(delivery_row),v_read_at
      from (
        select e.id,e.business_day,e.order_id,e.order_number,e.stop_number,e.outcome,
          e.return_code,e.return_status,e.reason,e.driver_note,e.recorded_at
        from public.ecoflow_delivery_exceptions e
        where exists(
          select 1 from public.v_ecoflow_customer_store_order_history h
          where h.store_id=v_record_id and h.order_number=e.order_number
        )
        order by e.recorded_at desc
        limit v_limit
      ) delivery_row;

      return query
      select 'PRICING'::text,jsonb_build_object(
        'price_group_id',d.price_group_id,
        'source','ORDERMENTUM_CUSTOMER_MASTER',
        'site_updated_at',d.site_updated_at
      ),v_read_at
      from public.v_ecoflow_customer_store_directory d where d.store_id=v_record_id;

      return query
      select 'ACCOUNT'::text,to_jsonb(account_row),v_read_at
      from (
        select a.*,coalesce(h.active,false) as hold_active,h.hold_reason,h.updated_at as hold_updated_at,
          'OWNER_ADMIN_ACCOUNT'::text as release_authority
        from public.v_ecoflow_accounts_live_statement_customers a
        left join public.ecoflow_account_release_holds h on h.store_id=a.store_id
        where a.store_id=v_record_id limit 1
      ) account_row;

      return query
      select 'CONTACT'::text,jsonb_build_object(
        'store_id',d.store_id,'store_name',d.store_name,'phone',d.contact_phone,
        'address',d.address,'billing_email',a.billing_email,
        'billing_contact_name',a.billing_contact_name,'billing_enabled',a.billing_enabled
      ),v_read_at
      from public.v_ecoflow_customer_store_directory d
      left join public.v_ecoflow_accounts_live_statement_customers a on a.store_id=d.store_id
      where d.store_id=v_record_id;

      return query
      with timeline_rows as (
        select e.occurred_at as event_at,'CUSTOMER_EVENT'::text as event_type,
          jsonb_build_object(
            'event_type',e.event_type,'note',e.note_text,'channel',e.contact_channel,
            'actor',e.created_by_email,'match_basis','NORMALISED_STORE_NAME'
          ) as detail
        from public.ecoflow_customer_operational_events e where e.store_key=v_store_key
        union all
        select h.order_at,'ORDER',jsonb_build_object(
          'order_number',h.order_number,'invoice_number',h.invoice_number,
          'status',h.status,'value',h.order_value
        )
        from public.v_ecoflow_customer_store_order_history h where h.store_id=v_record_id
        union all
        select a.action_at,'ACCOUNT_ACTION',jsonb_build_object(
          'action',a.action,'status',a.action_status,'note',a.action_note,'value',a.action_value
        )
        from public.ecoflow_accounts_statement_actions a where a.store_id=v_record_id
      )
      select 'TIMELINE'::text,
        jsonb_build_object('event_at',t.event_at,'event_type',t.event_type,'detail',t.detail),v_read_at
      from timeline_rows t order by t.event_at desc nulls last limit v_limit;
      return;
    end if;

    return query
    select 'INVOICE'::text,to_jsonb(invoice_row),v_read_at
    from (
      select l.* from public.v_ecoflow_accounts_live_statement_lines l
      where l.store_id=v_record_id order by l.order_ts desc nulls last
      limit v_limit
    ) invoice_row;

    return query
    select 'ACTION'::text,to_jsonb(action_row),v_read_at
    from (
      select a.id,a.action,a.action_note,a.action_value,a.action_status,a.action_by,a.action_at
      from public.ecoflow_accounts_statement_actions a
      where a.store_id=v_record_id order by a.action_at desc
      limit v_limit
    ) action_row;

    return query
    select 'DOCUMENT'::text,to_jsonb(document_row),v_read_at
    from (
      select d.* from public.v_ecoflow_statement_document_history d
      where d.store_id=v_record_id order by d.created_at desc
      limit v_limit
    ) document_row;

    return query
    select 'AFFECTED_ORDER'::text,
      to_jsonb(order_row)||jsonb_build_object(
        'hold_active',coalesce(h.active,false),
        'hold_reason',h.hold_reason,
        'hold_updated_at',h.updated_at
      ),v_read_at
    from (
      select o.* from public.v_ecoflow_customer_store_order_history o
      where o.store_id=v_record_id order by o.order_at desc nulls last limit v_limit
    ) order_row
    left join public.ecoflow_account_release_holds h on h.store_id=v_record_id and h.active;
    return;
  end if;

  return query
  select 'SUMMARY'::text,to_jsonb(summary_row),v_read_at
  from (
    select
      e.*,
      coalesce(ix.inspection_line_count,0) as inspection_line_count,
      coalesce(ix.resolutions,array[]::text[]) as dispositions,
      coalesce(ix.inventory_consequence_status,'MISSING') as inventory_consequence_status,
      'NOT_RECORDED'::text as account_consequence_status,
      case
        when e.return_status='WITH_DRIVER' then 'REPORTED'
        when e.return_status in ('DROPPED_IN_RETURN_ZONE','RETURNED_TO_WAREHOUSE') then 'RECEIVED'
        when e.return_status='INSPECTION_HOLD' then 'INSPECTED'
        else 'CLOSED'
      end as lifecycle_stage
    from public.ecoflow_delivery_exceptions e
    left join lateral (
      select count(*)::bigint as inspection_line_count,
        array_agg(distinct l.resolution order by l.resolution) as resolutions,
        case
          when count(*)=0 then 'MISSING'
          when count(*) filter(where l.resolution='RESTOCK' and l.movement_id is null)>0 then 'MISSING'
          else 'EXPLICIT'
        end as inventory_consequence_status
      from public.ecoflow_delivery_return_inspection_lines l where l.exception_id=e.id
    ) ix on true
    where e.id::text=v_record_id or e.return_code=v_record_id
    limit 1
  ) summary_row;

  return query
  select 'INSPECTION'::text,to_jsonb(inspection_row),v_read_at
  from (
    select l.* from public.ecoflow_delivery_return_inspection_lines l
    join public.ecoflow_delivery_exceptions e on e.id=l.exception_id
    where e.id::text=v_record_id or e.return_code=v_record_id
    order by l.inspected_at desc limit v_limit
  ) inspection_row;

  return query
  select 'SCAN'::text,to_jsonb(scan_row),v_read_at
  from (
    select s.* from public.ecoflow_delivery_return_scans s
    join public.ecoflow_delivery_exceptions e on e.id=s.exception_id
    where e.id::text=v_record_id or e.return_code=v_record_id
    order by s.scanned_at desc limit v_limit
  ) scan_row;

  return query
  select 'INVENTORY_CONSEQUENCE'::text,jsonb_build_object(
    'inspection_line_id',l.id,'resolution',l.resolution,'sku',l.sku,
    'units_processed',l.units_processed,'target_location',l.target_location,
    'movement_id',l.movement_id,
    'consequence_status',case
      when l.resolution='RESTOCK' and l.movement_id is null then 'MISSING'
      else 'EXPLICIT'
    end
  ),v_read_at
  from public.ecoflow_delivery_return_inspection_lines l
  join public.ecoflow_delivery_exceptions e on e.id=l.exception_id
  where e.id::text=v_record_id or e.return_code=v_record_id
  order by l.inspected_at desc limit v_limit;
end;
$$;

revoke all on function public.ecoflow_read_operational_records_v1(text,text,integer,integer,text,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.ecoflow_read_operational_record_detail_v1(text,text,integer)
  from public,anon,authenticated,service_role;

grant execute on function public.ecoflow_read_operational_records_v1(text,text,integer,integer,text,text,text)
  to authenticated;
grant execute on function public.ecoflow_read_operational_record_detail_v1(text,text,integer)
  to authenticated;

comment on function public.ecoflow_read_operational_records_v1(text,text,integer,integer,text,text,text) is
  'TRANSFORM-007A bounded list authority for Inventory, Customers, Accounts and Returns. Read-only.';
comment on function public.ecoflow_read_operational_record_detail_v1(text,text,integer) is
  'TRANSFORM-007A bounded detail/timeline authority. Missing return consequences stay explicit.';

notify pgrst,'reload schema';
commit;
