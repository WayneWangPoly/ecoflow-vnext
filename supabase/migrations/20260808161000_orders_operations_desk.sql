-- TRANSFORM-004: bounded Orders Operations Desk read authority.
--
-- The operational list remains server-paged and exact. Rich order detail is
-- fetched only when an operator opens one order. Current exception metadata is
-- freshness-aware: a stale exception snapshot never blocks the order list and
-- is never silently presented as current.

begin;

do $preflight$
declare
  v_missing text[] := array[]::text[];
begin
  if to_regclass('public.v_ecoflow_ordermentum_ui_active_inbox') is null then
    v_missing := array_append(v_missing, 'public.v_ecoflow_ordermentum_ui_active_inbox');
  end if;
  if to_regclass('public.v_ecoflow_ordermentum_ui_active_drafts') is null then
    v_missing := array_append(v_missing, 'public.v_ecoflow_ordermentum_ui_active_drafts');
  end if;
  if to_regclass('public.v_ecoflow_ordermentum_ui_active_om_orders') is null then
    v_missing := array_append(v_missing, 'public.v_ecoflow_ordermentum_ui_active_om_orders');
  end if;
  if to_regclass('public.v_ecoflow_ordermentum_ui_active_order_lines') is null then
    v_missing := array_append(v_missing, 'public.v_ecoflow_ordermentum_ui_active_order_lines');
  end if;
  if to_regclass('public.ecoflow_store_sites') is null then
    v_missing := array_append(v_missing, 'public.ecoflow_store_sites');
  end if;
  if to_regclass('public.ecoflow_current_exception_snapshot') is null then
    v_missing := array_append(v_missing, 'public.ecoflow_current_exception_snapshot');
  end if;
  if to_regclass('public.ecoflow_read_model_refresh_state') is null then
    v_missing := array_append(v_missing, 'public.ecoflow_read_model_refresh_state');
  end if;
  if to_regclass('analytics.actionable_exception_lifecycle') is null then
    v_missing := array_append(v_missing, 'analytics.actionable_exception_lifecycle');
  end if;
  if to_regprocedure('public.ecoflow_active_app_role()') is null then
    v_missing := array_append(v_missing, 'public.ecoflow_active_app_role()');
  end if;

  if cardinality(v_missing) > 0 then
    raise exception 'ORDERS_OPERATIONS_DESK_PREREQUISITES_MISSING: %', array_to_string(v_missing, ', ');
  end if;
end;
$preflight$;

create or replace function public.ecoflow_read_orders_operations_v1(
  p_page integer default 1,
  p_page_size integer default 25,
  p_search text default null,
  p_view text default 'current',
  p_sort text default 'operations'
)
returns table(total_count bigint, row_data jsonb, read_at timestamptz)
language plpgsql
stable
security definer
set search_path=pg_catalog,public,analytics
set statement_timeout='8s'
as $$
declare
  v_role text := public.ecoflow_active_app_role();
  v_page integer := coalesce(p_page, 1);
  v_size integer := coalesce(p_page_size, 25);
  v_offset integer;
  v_search text := '%' || lower(btrim(coalesce(p_search, ''))) || '%';
  v_view text := lower(btrim(coalesce(p_view, 'current')));
  v_sort text := lower(btrim(coalesce(p_sort, 'operations')));
begin
  if auth.uid() is null or v_role not in ('OWNER','ADMIN','ACCOUNT','VIEWER') then
    raise exception using errcode='42501', message='DESKTOP_OPERATIONAL_ROLE_REQUIRED';
  end if;
  if v_page < 1 or v_size not in (10,20,25,50,100) then
    raise exception 'INVALID_ORDERS_DESK_PAGE_REQUEST';
  end if;
  if v_view not in ('current','today','decision','ready','warehouse','delivered') then
    raise exception 'INVALID_ORDERS_DESK_VIEW';
  end if;
  if v_sort not in ('operations','latest','oldest','due','store','value') then
    raise exception 'INVALID_ORDERS_DESK_SORT';
  end if;
  v_offset := (v_page - 1) * v_size;

  return query
  with freshness as (
    select
      current_state.refreshed_at as exception_refreshed_at,
      required_state.refreshed_at as exception_required_at,
      coalesce(current_state.refreshed_at >= required_state.refreshed_at, false) as exception_snapshot_fresh
    from (select 1) seed
    left join public.ecoflow_read_model_refresh_state current_state
      on current_state.read_model='CURRENT_EXCEPTIONS'
    left join public.ecoflow_read_model_refresh_state required_state
      on required_state.read_model='DASHBOARD_SOURCE_REQUIRED'
  ), base as (
    select
      coalesce(
        nullif(btrim(i.raw_order_id::text), ''),
        nullif(btrim(i.external_order_id::text), ''),
        nullif(btrim(i.order_number::text), ''),
        nullif(btrim(i.external_order_number::text), '')
      ) as order_key,
      i.*
    from public.v_ecoflow_ordermentum_ui_active_inbox i
  ), enriched as (
    select
      b.*,
      om.retailer_id,
      om.retailer_name,
      om.delivery_date,
      om.due_at,
      om.total_quantity,
      d.internalisation_status,
      d.account_release_status,
      d.warehouse_gate_status,
      d.unmapped_line_count,
      d.barcode_blocked_line_count,
      d.barcode_confirmed_line_count,
      d.service_line_count,
      d.internal_order_id,
      s.store_name,
      s.suburb,
      s.formatted_address,
      s.price_group_id,
      f.exception_snapshot_fresh,
      f.exception_refreshed_at,
      case when f.exception_snapshot_fresh then (
        select count(*)::integer
        from public.ecoflow_current_exception_snapshot e
        where e.raw_order_id is not distinct from nullif(btrim(b.raw_order_id::text), '')
           or e.external_order_id is not distinct from nullif(btrim(b.external_order_id::text), '')
           or e.external_order_number is not distinct from nullif(btrim(b.external_order_number::text), '')
           or e.order_number is not distinct from nullif(btrim(b.order_number::text), '')
           or e.invoice_number is not distinct from nullif(btrim(b.invoice_number::text), '')
      ) else null::integer end as active_exception_count
    from base b
    cross join freshness f
    left join lateral (
      select o.*
      from public.v_ecoflow_ordermentum_ui_active_om_orders o
      where nullif(btrim(o.id::text), '') in (
              nullif(btrim(b.external_order_id::text), ''),
              nullif(btrim(b.om_order_id::text), '')
            )
         or nullif(btrim(o.order_number::text), '') in (
              nullif(btrim(b.order_number::text), ''),
              nullif(btrim(b.external_order_number::text), '')
            )
      limit 1
    ) om on true
    left join lateral (
      select draft.*
      from public.v_ecoflow_ordermentum_ui_active_drafts draft
      where nullif(btrim(draft.raw_order_id::text), '') = nullif(btrim(b.raw_order_id::text), '')
         or nullif(btrim(draft.external_order_id::text), '') = nullif(btrim(b.external_order_id::text), '')
         or nullif(btrim(draft.order_number::text), '') in (
              nullif(btrim(b.order_number::text), ''),
              nullif(btrim(b.external_order_number::text), '')
            )
         or nullif(btrim(draft.invoice_number::text), '') in (
              nullif(btrim(b.invoice_number::text), ''),
              nullif(btrim(b.external_invoice_number::text), '')
            )
      limit 1
    ) d on true
    left join lateral (
      select site.*
      from public.ecoflow_store_sites site
      where nullif(btrim(site.retailer_id::text), '') = nullif(btrim(om.retailer_id::text), '')
      limit 1
    ) s on true
  ), classified as (
    select e.*,
      case
        when lower(coalesce(e.order_status::text, '')) in ('completed','complete','closed','delivered','fulfilled')
          then 'COMPLETED'
        when upper(coalesce(e.account_release_status::text, '')) like '%HOLD%'
          or upper(coalesce(e.account_release_status::text, '')) in ('REVIEW_PAYMENT','CREDIT_HOLD')
          then 'REVIEW_PAYMENT'
        when coalesce(e.invoice_detail_missing, false) or coalesce(e.line_items_missing, false)
          or upper(coalesce(e.internalisation_status::text, '')) in ('BLOCKED_DATA','NOT_ELIGIBLE_DATA')
          or upper(coalesce(e.warehouse_gate_status::text, '')) in ('BLOCKED_DATA','NOT_ELIGIBLE_DATA')
          then 'BLOCKED_DATA'
        when coalesce(e.unmapped_line_count::integer, 0) > 0
          or upper(coalesce(e.internalisation_status::text, '')) in ('BLOCKED_MAPPING','NOT_ELIGIBLE_MAPPING')
          or upper(coalesce(e.warehouse_gate_status::text, '')) in ('BLOCKED_MAPPING','NOT_ELIGIBLE_MAPPING')
          then 'BLOCKED_MAPPING'
        when coalesce(e.barcode_blocked_line_count::integer, 0) > 0
          or upper(coalesce(e.internalisation_status::text, '')) in ('BLOCKED_BARCODE','BARCODE_BLOCKED')
          or upper(coalesce(e.warehouse_gate_status::text, '')) in ('BLOCKED_BARCODE','BARCODE_BLOCKED')
          then 'BLOCKED_BARCODE'
        when upper(coalesce(e.internalisation_status::text, ''))='BLOCKED_STOCK'
          or upper(coalesce(e.warehouse_gate_status::text, ''))='BLOCKED_STOCK'
          then 'BLOCKED_STOCK'
        when e.internal_order_id is null then 'INTERNALISE_REQUIRED'
        else 'READY_TO_RELEASE'
      end as release_state,
      case
        when lower(coalesce(e.order_status::text, '')) in ('completed','complete','closed','delivered','fulfilled') then 'DELIVERED'
        when upper(coalesce(e.warehouse_gate_status::text, '')) in ('OUT_FOR_DELIVERY','DRIVER_ASSIGNED','ON_ROUTE','EN_ROUTE') then 'ROUTE'
        when upper(coalesce(e.warehouse_gate_status::text, '')) in ('STAGED','PACKED','READY_FOR_DELIVERY') then 'STAGED'
        when upper(coalesce(e.warehouse_gate_status::text, '')) in ('PICKING','PICK_STARTED') then 'PICKING'
        else 'NOT_STARTED'
      end as execution_state,
      coalesce(
        e.delivery_date::date,
        e.invoice_due_at::date,
        e.invoice_date::date,
        e.updated_business_day::date
      ) as operating_day,
      coalesce(nullif(btrim(e.store_name::text), ''), nullif(btrim(e.retailer_name::text), ''), 'Ordermentum retailer') as operating_store,
      coalesce(e.invoice_total::numeric, e.order_items_total::numeric, 0::numeric) as order_value
    from enriched e
  ), q as (
    select c.*
    from classified c
    where (nullif(btrim(coalesce(p_search, '')), '') is null or lower(concat_ws(' ',
      c.order_key,c.order_number,c.external_order_number,c.invoice_number,c.external_invoice_number,
      c.operating_store,c.suburb,c.order_status,c.payment_status,c.release_state,c.execution_state
    )) like v_search)
      and (
        v_view='current'
        or (v_view='today' and c.operating_day=(statement_timestamp() at time zone 'Australia/Adelaide')::date)
        or (v_view='decision' and c.release_state in ('REVIEW_PAYMENT','BLOCKED_DATA','BLOCKED_MAPPING','BLOCKED_BARCODE','BLOCKED_STOCK','INTERNALISE_REQUIRED'))
        or (v_view='ready' and c.release_state='READY_TO_RELEASE')
        or (v_view='warehouse' and c.execution_state in ('PICKING','STAGED','ROUTE'))
        or (v_view='delivered' and c.execution_state='DELIVERED')
      )
  ), counted as (
    select count(*)::bigint as total from q
  ), page_rows as (
    select q.*
    from q
    order by
      case when v_sort='operations' then
        case q.release_state
          when 'REVIEW_PAYMENT' then 1
          when 'BLOCKED_DATA' then 2
          when 'BLOCKED_MAPPING' then 3
          when 'BLOCKED_BARCODE' then 4
          when 'BLOCKED_STOCK' then 5
          when 'INTERNALISE_REQUIRED' then 6
          when 'READY_TO_RELEASE' then 7
          when 'COMPLETED' then 9
          else 8
        end
      end asc nulls last,
      case when v_sort='due' or v_sort='operations' then coalesce(q.due_at::timestamptz, q.invoice_due_at::timestamptz) end asc nulls last,
      case when v_sort='store' then q.operating_store end asc nulls last,
      case when v_sort='value' then q.order_value end desc nulls last,
      case when v_sort='oldest' then q.order_updated_at end asc nulls last,
      case when v_sort='latest' then q.order_updated_at end desc nulls last,
      q.order_updated_at desc nulls last,
      q.order_key
    limit v_size offset v_offset
  ), emitted as (
    select
      c.total,
      jsonb_build_object(
        'order_key', p.order_key,
        'raw_order_id', p.raw_order_id,
        'external_order_id', p.external_order_id,
        'order_number', coalesce(p.order_number, p.external_order_number),
        'invoice_number', coalesce(p.invoice_number, p.external_invoice_number),
        'store_name', p.operating_store,
        'suburb', p.suburb,
        'delivery_date', p.delivery_date,
        'due_at', coalesce(p.due_at, p.invoice_due_at),
        'source_status', p.order_status,
        'payment_status', coalesce(p.payment_status, p.invoice_payment_status),
        'order_value', p.order_value,
        'line_count', p.line_count,
        'total_units', coalesce(p.total_units, p.total_quantity),
        'release_state', p.release_state,
        'execution_state', p.execution_state,
        'internal_order_id', p.internal_order_id,
        'unmapped_line_count', p.unmapped_line_count,
        'barcode_blocked_line_count', p.barcode_blocked_line_count,
        'active_exception_count', p.active_exception_count,
        'exception_snapshot_fresh', p.exception_snapshot_fresh,
        'exception_refreshed_at', p.exception_refreshed_at,
        'updated_at', p.order_updated_at,
        'operating_day', p.operating_day
      ) as payload,
      statement_timestamp() as captured_at
    from counted c cross join page_rows p
    union all
    select c.total, null::jsonb, statement_timestamp()
    from counted c where not exists(select 1 from page_rows)
  )
  select emitted.total, emitted.payload, emitted.captured_at from emitted;
end;
$$;

create or replace function public.ecoflow_read_order_operations_detail_v1(p_order_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,public,analytics
set statement_timeout='8s'
as $$
declare
  v_role text := public.ecoflow_active_app_role();
  v_key text := nullif(btrim(coalesce(p_order_key, '')), '');
  v_result jsonb;
begin
  if auth.uid() is null or v_role not in ('OWNER','ADMIN','ACCOUNT','VIEWER') then
    raise exception using errcode='42501', message='DESKTOP_OPERATIONAL_ROLE_REQUIRED';
  end if;
  if v_key is null then raise exception 'ORDER_OPERATIONS_DETAIL_KEY_REQUIRED'; end if;

  with freshness as (
    select
      current_state.refreshed_at as exception_refreshed_at,
      required_state.refreshed_at as exception_required_at,
      coalesce(current_state.refreshed_at >= required_state.refreshed_at, false) as exception_snapshot_fresh
    from (select 1) seed
    left join public.ecoflow_read_model_refresh_state current_state
      on current_state.read_model='CURRENT_EXCEPTIONS'
    left join public.ecoflow_read_model_refresh_state required_state
      on required_state.read_model='DASHBOARD_SOURCE_REQUIRED'
  ), base as (
    select i.*,
      coalesce(
        nullif(btrim(i.raw_order_id::text), ''),
        nullif(btrim(i.external_order_id::text), ''),
        nullif(btrim(i.order_number::text), ''),
        nullif(btrim(i.external_order_number::text), '')
      ) as order_key
    from public.v_ecoflow_ordermentum_ui_active_inbox i
    where v_key in (
      nullif(btrim(i.raw_order_id::text), ''),
      nullif(btrim(i.external_order_id::text), ''),
      nullif(btrim(i.om_order_id::text), ''),
      nullif(btrim(i.order_number::text), ''),
      nullif(btrim(i.external_order_number::text), ''),
      nullif(btrim(i.invoice_number::text), ''),
      nullif(btrim(i.external_invoice_number::text), '')
    )
    order by i.order_updated_at desc nulls last
    limit 1
  ), enriched as (
    select
      b.*,
      om.retailer_id,
      om.retailer_name,
      om.delivery_date,
      om.due_at,
      om.total_quantity,
      d.internalisation_status,
      d.account_release_status,
      d.warehouse_gate_status,
      d.unmapped_line_count,
      d.barcode_blocked_line_count,
      d.barcode_confirmed_line_count,
      d.service_line_count,
      d.internal_order_id,
      s.store_name,
      s.suburb,
      s.formatted_address,
      s.price_group_id,
      f.exception_snapshot_fresh,
      f.exception_refreshed_at
    from base b
    cross join freshness f
    left join lateral (
      select o.* from public.v_ecoflow_ordermentum_ui_active_om_orders o
      where nullif(btrim(o.id::text), '') in (nullif(btrim(b.external_order_id::text), ''), nullif(btrim(b.om_order_id::text), ''))
         or nullif(btrim(o.order_number::text), '') in (nullif(btrim(b.order_number::text), ''), nullif(btrim(b.external_order_number::text), ''))
      limit 1
    ) om on true
    left join lateral (
      select draft.* from public.v_ecoflow_ordermentum_ui_active_drafts draft
      where nullif(btrim(draft.raw_order_id::text), '') = nullif(btrim(b.raw_order_id::text), '')
         or nullif(btrim(draft.external_order_id::text), '') = nullif(btrim(b.external_order_id::text), '')
         or nullif(btrim(draft.order_number::text), '') in (nullif(btrim(b.order_number::text), ''), nullif(btrim(b.external_order_number::text), ''))
         or nullif(btrim(draft.invoice_number::text), '') in (nullif(btrim(b.invoice_number::text), ''), nullif(btrim(b.external_invoice_number::text), ''))
      limit 1
    ) d on true
    left join lateral (
      select site.* from public.ecoflow_store_sites site
      where nullif(btrim(site.retailer_id::text), '') = nullif(btrim(om.retailer_id::text), '')
      limit 1
    ) s on true
  ), classified as (
    select e.*,
      case
        when lower(coalesce(e.order_status::text, '')) in ('completed','complete','closed','delivered','fulfilled') then 'COMPLETED'
        when upper(coalesce(e.account_release_status::text, '')) like '%HOLD%' or upper(coalesce(e.account_release_status::text, '')) in ('REVIEW_PAYMENT','CREDIT_HOLD') then 'REVIEW_PAYMENT'
        when coalesce(e.invoice_detail_missing, false) or coalesce(e.line_items_missing, false) or upper(coalesce(e.internalisation_status::text, '')) in ('BLOCKED_DATA','NOT_ELIGIBLE_DATA') or upper(coalesce(e.warehouse_gate_status::text, '')) in ('BLOCKED_DATA','NOT_ELIGIBLE_DATA') then 'BLOCKED_DATA'
        when coalesce(e.unmapped_line_count::integer, 0) > 0 or upper(coalesce(e.internalisation_status::text, '')) in ('BLOCKED_MAPPING','NOT_ELIGIBLE_MAPPING') or upper(coalesce(e.warehouse_gate_status::text, '')) in ('BLOCKED_MAPPING','NOT_ELIGIBLE_MAPPING') then 'BLOCKED_MAPPING'
        when coalesce(e.barcode_blocked_line_count::integer, 0) > 0 or upper(coalesce(e.internalisation_status::text, '')) in ('BLOCKED_BARCODE','BARCODE_BLOCKED') or upper(coalesce(e.warehouse_gate_status::text, '')) in ('BLOCKED_BARCODE','BARCODE_BLOCKED') then 'BLOCKED_BARCODE'
        when upper(coalesce(e.internalisation_status::text, ''))='BLOCKED_STOCK' or upper(coalesce(e.warehouse_gate_status::text, ''))='BLOCKED_STOCK' then 'BLOCKED_STOCK'
        when e.internal_order_id is null then 'INTERNALISE_REQUIRED'
        else 'READY_TO_RELEASE'
      end as release_state,
      case
        when lower(coalesce(e.order_status::text, '')) in ('completed','complete','closed','delivered','fulfilled') then 'DELIVERED'
        when upper(coalesce(e.warehouse_gate_status::text, '')) in ('OUT_FOR_DELIVERY','DRIVER_ASSIGNED','ON_ROUTE','EN_ROUTE') then 'ROUTE'
        when upper(coalesce(e.warehouse_gate_status::text, '')) in ('STAGED','PACKED','READY_FOR_DELIVERY') then 'STAGED'
        when upper(coalesce(e.warehouse_gate_status::text, '')) in ('PICKING','PICK_STARTED') then 'PICKING'
        else 'NOT_STARTED'
      end as execution_state,
      coalesce(nullif(btrim(e.store_name::text), ''), nullif(btrim(e.retailer_name::text), ''), 'Ordermentum retailer') as operating_store,
      coalesce(e.invoice_total::numeric, e.order_items_total::numeric, 0::numeric) as order_value
    from enriched e
  )
  select jsonb_build_object(
    'order', jsonb_build_object(
      'order_key', c.order_key,
      'raw_order_id', c.raw_order_id,
      'external_order_id', c.external_order_id,
      'order_number', coalesce(c.order_number, c.external_order_number),
      'invoice_number', coalesce(c.invoice_number, c.external_invoice_number),
      'store_name', c.operating_store,
      'suburb', c.suburb,
      'address', c.formatted_address,
      'price_group_id', c.price_group_id,
      'delivery_date', c.delivery_date,
      'due_at', coalesce(c.due_at, c.invoice_due_at),
      'source_status', c.order_status,
      'payment_status', coalesce(c.payment_status, c.invoice_payment_status),
      'invoice_status', c.invoice_status,
      'order_value', c.order_value,
      'line_count', c.line_count,
      'total_units', coalesce(c.total_units, c.total_quantity),
      'release_state', c.release_state,
      'execution_state', c.execution_state,
      'internalisation_status', c.internalisation_status,
      'account_release_status', c.account_release_status,
      'warehouse_gate_status', c.warehouse_gate_status,
      'internal_order_id', c.internal_order_id,
      'unmapped_line_count', c.unmapped_line_count,
      'barcode_blocked_line_count', c.barcode_blocked_line_count,
      'barcode_confirmed_line_count', c.barcode_confirmed_line_count,
      'invoice_detail_missing', c.invoice_detail_missing,
      'line_items_missing', c.line_items_missing,
      'updated_at', c.order_updated_at,
      'last_synced_at', c.last_synced_at
    ),
    'lines', coalesce((
      select jsonb_agg(to_jsonb(line) order by line.source_line_id nulls last)
      from (
        select l.*
        from public.v_ecoflow_ordermentum_ui_active_order_lines l
        where nullif(btrim(l.source_order_id::text), '') in (nullif(btrim(c.external_order_id::text), ''), nullif(btrim(c.raw_order_id::text), ''))
           or nullif(btrim(l.order_number::text), '') in (nullif(btrim(c.order_number::text), ''), nullif(btrim(c.external_order_number::text), ''))
           or nullif(btrim(l.invoice_number::text), '') in (nullif(btrim(c.invoice_number::text), ''), nullif(btrim(c.external_invoice_number::text), ''))
        limit 250
      ) line
    ), '[]'::jsonb),
    'exceptions', case when c.exception_snapshot_fresh then coalesce((
      select jsonb_agg(jsonb_build_object(
        'exception_id', e.exception_id,
        'exception_type', e.exception_type,
        'message', e.message,
        'status', e.status,
        'detected_at', e.detected_at,
        'lifecycle_status', coalesce(l.lifecycle_status, 'OPEN'),
        'owner_team', coalesce(l.owner_team, 'Operations queue'),
        'snoozed_until', l.snoozed_until,
        'resolution_note', l.resolution_note,
        'version', l.version
      ) order by e.detected_at asc nulls last, e.exception_id)
      from public.ecoflow_current_exception_snapshot e
      left join analytics.actionable_exception_lifecycle l on l.exception_id=e.exception_id
      where e.raw_order_id is not distinct from nullif(btrim(c.raw_order_id::text), '')
         or e.external_order_id is not distinct from nullif(btrim(c.external_order_id::text), '')
         or e.external_order_number is not distinct from nullif(btrim(c.external_order_number::text), '')
         or e.order_number is not distinct from nullif(btrim(c.order_number::text), '')
         or e.invoice_number is not distinct from nullif(btrim(c.invoice_number::text), '')
    ), '[]'::jsonb) else null::jsonb end,
    'exception_snapshot_fresh', c.exception_snapshot_fresh,
    'exception_refreshed_at', c.exception_refreshed_at,
    'read_at', statement_timestamp()
  ) into v_result
  from classified c;

  if v_result is null then
    raise exception using errcode='P0002', message='ORDER_OPERATIONS_DETAIL_NOT_FOUND';
  end if;
  return v_result;
end;
$$;

revoke all on function public.ecoflow_read_orders_operations_v1(integer,integer,text,text,text) from public,anon;
revoke all on function public.ecoflow_read_order_operations_detail_v1(text) from public,anon;
grant execute on function public.ecoflow_read_orders_operations_v1(integer,integer,text,text,text) to authenticated,service_role;
grant execute on function public.ecoflow_read_order_operations_detail_v1(text) to authenticated,service_role;

commit;
