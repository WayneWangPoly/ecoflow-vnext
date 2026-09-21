-- ECOFLOW-345-METRIC-ENG-R1
-- Sales transaction metric semantic candidates and InvoiceStatus repair.
--
-- This migration is engineering-only. It does not refresh/materialise facts and
-- does not activate any metric. It makes current fact refreshes production-shaped,
-- adds internal metric inputs/reconciliation, and registers DRAFT candidates.

begin;

do $preflight$
begin
  if to_regclass('analytics.fact_sales_transaction_document') is null
     or to_regclass('analytics.fact_sales_transaction_line') is null
     or to_regclass('analytics.metric_definition') is null
     or to_regprocedure('analytics.refresh_sales_transaction_facts(timestamptz)') is null then
    raise exception 'SALES_TRANSACTION_METRIC_PREREQUISITES_MISSING';
  end if;

  if not exists(
    select 1 from analytics.metric_definition
    where metric_key='revenue' and metric_version=1 and status='DRAFT'
  ) then
    raise exception 'REVENUE_V1_DRAFT_BASELINE_MISSING';
  end if;

  if exists(
    select 1 from analytics.metric_definition
    where (metric_key='revenue' and metric_version=2)
       or metric_key in ('sales_orders','average_revenue_per_order')
  ) then
    raise exception 'SALES_TRANSACTION_METRIC_CANDIDATE_ALREADY_EXISTS';
  end if;
end;
$preflight$;

create or replace function analytics.refresh_sales_transaction_facts(
  p_as_of timestamptz default clock_timestamp()
)
returns table(
  dataset_key text,
  refreshed_row_count bigint,
  refresh_state text
)
language plpgsql
security definer
set search_path = pg_catalog,analytics,public
as $$
declare
  v_as_of timestamptz := coalesce(p_as_of,clock_timestamp());
  v_document_count bigint := 0;
  v_line_count bigint := 0;
  v_document_issues bigint := 0;
  v_line_issues bigint := 0;
  v_error text;
  v_error_code text;
begin
  perform pg_advisory_xact_lock(hashtext('analytics.refresh_sales_transaction_facts'));

  insert into analytics.refresh_status(
    dataset_key,source_system,source_object,status,last_started_at,freshness_sla,
    visible_to_roles,updated_at
  ) values
    (
      'analytics.sales_transaction_documents','UNLEASHED',
      'analytics.fact_sales_transaction_document','REFRESHING',v_as_of,
      interval '24 hours',array['OWNER','ADMIN','ACCOUNT']::text[],v_as_of
    ),
    (
      'analytics.sales_transaction_lines','UNLEASHED',
      'analytics.fact_sales_transaction_line','REFRESHING',v_as_of,
      interval '24 hours',array['OWNER','ADMIN','ACCOUNT']::text[],v_as_of
    )
  on conflict on constraint refresh_status_pkey do update
  set status='REFRESHING',last_started_at=excluded.last_started_at,
      error_code=null,error_message=null,updated_at=excluded.updated_at;

  begin
    drop table if exists pg_temp.sales_transaction_document_source;
    drop table if exists pg_temp.sales_transaction_line_source;
    drop table if exists pg_temp.sales_transaction_document_raw;
    drop table if exists pg_temp.sales_transaction_invoice_lookup;
    drop table if exists pg_temp.sales_transaction_order_lookup;

    create temporary table pg_temp.sales_transaction_order_lookup
    on commit drop as
    select
      s.payload->>'OrderNumber' as order_number,
      count(*)::integer as match_count,
      max(s.payload_sha256) as matched_hash,
      max(s.payload->>'Guid') as sales_order_guid,
      max(s.payload->>'Status') as sales_order_status,
      max(s.payload#>>'{SalesPerson,Guid}') as salesperson_guid,
      max(coalesce(
        nullif(s.payload#>>'{SalesPerson,FullName}',''),
        nullif(s.payload#>>'{SalesPerson,Name}','')
      )) as salesperson_name,
      max(s.payload#>>'{Warehouse,Guid}') as warehouse_guid,
      max(s.payload#>>'{Warehouse,WarehouseCode}') as warehouse_code,
      max(s.payload#>>'{Warehouse,WarehouseName}') as warehouse_name,
      max(s.payload->>'SalesOrderGroup') as sales_order_group,
      max(s.payload->>'SourceId') as sales_order_source_id,
      max(coalesce(
        nullif(s.payload->>'DeliveryCountry',''),
        nullif(s.payload#>>'{DeliveryAddress,Country}','')
      )) as delivery_country,
      max(coalesce(
        nullif(s.payload->>'DeliveryRegion',''),
        nullif(s.payload#>>'{DeliveryAddress,Region}','')
      )) as delivery_region
    from public.unleashed_raw_snapshots s
    where s.resource='sales_orders_history'
      and nullif(btrim(s.payload->>'OrderNumber'),'') is not null
    group by s.payload->>'OrderNumber';

    create temporary table pg_temp.sales_transaction_invoice_lookup
    on commit drop as
    select
      s.payload->>'InvoiceNumber' as invoice_number,
      count(*)::integer as match_count,
      max(s.payload_sha256) as matched_hash,
      max(s.payload->>'Guid') as invoice_guid,
      max(s.payload->>'OrderNumber') as order_number
    from public.unleashed_raw_snapshots s
    where s.resource='sales_invoices'
      and nullif(btrim(s.payload->>'InvoiceNumber'),'') is not null
    group by s.payload->>'InvoiceNumber';

    create temporary table pg_temp.sales_transaction_document_raw
    on commit drop as
    with source_documents as (
      select
        s.id as source_snapshot_id,
        'SalesInvoices'::text as source_resource,
        'INVOICE'::text as transaction_kind,
        s.external_key as source_document_key,
        coalesce(nullif(s.payload->>'Guid',''),s.external_guid) as source_document_guid,
        coalesce(nullif(s.payload->>'InvoiceNumber',''),s.external_number) as document_number,
        null::text as origin_invoice_number,
        null::text as origin_invoice_guid,
        nullif(s.payload->>'OrderNumber','') as source_order_number,
        s.payload as payload,
        s.payload_sha256 as source_snapshot_hash,
        s.source_last_modified_at,
        analytics.parse_unleashed_datetime(nullif(s.payload->>'InvoiceDate',''))::date as transaction_date,
        analytics.parse_unleashed_datetime(nullif(s.payload->>'InvoiceDate',''))::date as invoice_date,
        null::date as credit_date,
        coalesce(nullif(s.payload->>'InvoiceStatus',''),nullif(s.payload->>'Status','')) as document_status,
        null::text as credit_type,
        null::text as credit_reason,
        1::smallint as effect_sign,
        coalesce(s.payload->'InvoiceLines','[]'::jsonb) as source_lines
      from public.unleashed_raw_snapshots s
      where s.resource='sales_invoices'
      union all
      select
        s.id,'CreditNotes'::text,'CREDIT_NOTE',s.external_key,
        coalesce(nullif(s.payload->>'Guid',''),s.external_guid),
        coalesce(nullif(s.payload->>'CreditNoteNumber',''),nullif(s.payload->>'CreditNumber',''),s.external_number),
        nullif(s.payload->>'InvoiceNumber',''),
        coalesce(nullif(s.payload->>'InvoiceGuid',''),il.invoice_guid),
        coalesce(nullif(s.payload#>>'{SalesOrder,OrderNumber}',''),nullif(s.payload->>'OrderNumber',''),il.order_number),
        s.payload,s.payload_sha256,s.source_last_modified_at,
        analytics.parse_unleashed_datetime(nullif(s.payload->>'CreditDate',''))::date,
        null::date,
        analytics.parse_unleashed_datetime(nullif(s.payload->>'CreditDate',''))::date,
        nullif(s.payload->>'Status',''),nullif(s.payload->>'CreditType',''),
        coalesce(nullif(s.payload->>'CreditReason',''),nullif(s.payload#>>'{CreditReason,Description}','')),
        (-1)::smallint,
        coalesce(s.payload->'CreditNoteLines',s.payload->'CreditLines','[]'::jsonb)
      from public.unleashed_raw_snapshots s
      left join pg_temp.sales_transaction_invoice_lookup il
        on il.invoice_number=s.payload->>'InvoiceNumber'
      where s.resource='credit_notes'
    )
    select
      d.*,
      coalesce(nullif(d.payload#>>'{Customer,Guid}',''),nullif(d.payload->>'CustomerGuid','')) as customer_guid,
      coalesce(nullif(d.payload#>>'{Customer,CustomerCode}',''),nullif(d.payload->>'CustomerCode','')) as customer_code,
      coalesce(nullif(d.payload#>>'{Customer,CustomerName}',''),nullif(d.payload->>'CustomerName','')) as customer_name,
      coalesce(nullif(d.payload#>>'{Currency,CurrencyCode}',''),nullif(d.payload->>'CurrencyCode','')) as currency_code,
      nullif(d.payload->>'ExchangeRate','')::numeric as exchange_rate,
      nullif(d.payload->>'SubTotal','')::numeric as source_subtotal,
      nullif(d.payload->>'TaxTotal','')::numeric as source_tax_total,
      nullif(d.payload->>'Total','')::numeric as source_total,
      nullif(d.payload->>'BCSubTotal','')::numeric as source_bc_subtotal,
      nullif(d.payload->>'BCTaxTotal','')::numeric as source_bc_tax_total,
      nullif(d.payload->>'BCTotal','')::numeric as source_bc_total,
      case
        when ol.match_count=1 and (
          nullif(d.payload#>>'{SalesOrder,Guid}','') is null
          or d.payload#>>'{SalesOrder,Guid}'=ol.sales_order_guid
        ) then 'EXACT_ONE'
        when ol.match_count=1 then 'CONFLICT'
        when ol.match_count>1 then 'AMBIGUOUS'
        else 'UNMATCHED'
      end as order_linkage_status,
      case when d.transaction_kind='CREDIT_NOTE' then
        case
          when il.match_count=1 then 'EXACT_ONE'
          when il.match_count>1 then 'AMBIGUOUS'
          else 'UNMATCHED'
        end
      end as invoice_linkage_status,
      coalesce(nullif(d.payload#>>'{SalesOrder,Guid}',''),ol.sales_order_guid) as source_sales_order_guid,
      ol.sales_order_status,ol.salesperson_guid,ol.salesperson_name,
      ol.warehouse_guid,ol.warehouse_code,ol.warehouse_name,
      ol.sales_order_group,ol.sales_order_source_id,
      ol.delivery_country,ol.delivery_region,
      ol.matched_hash as order_snapshot_hash,
      il.matched_hash as invoice_snapshot_hash
    from source_documents d
    left join pg_temp.sales_transaction_order_lookup ol
      on ol.order_number=d.source_order_number
    left join pg_temp.sales_transaction_invoice_lookup il
      on d.transaction_kind='CREDIT_NOTE'
     and il.invoice_number=d.origin_invoice_number;

    create temporary table pg_temp.sales_transaction_line_source
    on commit drop as
    select
      'UNLEASHED'::text as source_system,
      d.source_resource,d.transaction_kind,d.source_document_key,
      d.source_document_guid,d.document_number,
      coalesce(
        d.source_document_key || '|guid:' || nullif(l.value->>'Guid',''),
        d.source_document_key || '|number:' || nullif(l.value->>'LineNumber',''),
        d.source_document_key || '|ordinal:' || l.ordinality::text
      ) as source_line_key,
      nullif(l.value->>'Guid','') as source_line_guid,
      nullif(l.value->>'LineNumber','') as source_line_number,
      l.ordinality::integer as source_line_ordinal,
      d.source_order_number,d.source_sales_order_guid,d.transaction_date,
      d.document_status,
      case
        when d.transaction_kind='CREDIT_NOTE' then 'CREDIT_LINE'
        when l.value->>'LineType'='Charge' then 'INVOICE_CHARGE'
        else 'INVOICE_LINE'
      end as line_classification,
      nullif(l.value->>'LineType','') as source_line_type,
      d.credit_type,d.credit_reason,
      coalesce(nullif(l.value#>>'{Product,Guid}',''),nullif(l.value->>'ProductGuid','')) as product_guid,
      coalesce(nullif(l.value#>>'{Product,ProductCode}',''),nullif(l.value->>'ProductCode','')) as product_code,
      coalesce(nullif(l.value#>>'{Product,ProductDescription}',''),nullif(l.value->>'ProductDescription','')) as product_description,
      nullif(l.value->>'InvoiceQuantity','')::numeric as invoice_quantity,
      nullif(l.value->>'CreditQuantity','')::numeric as credit_quantity,
      nullif(l.value->>'OrderQuantity','')::numeric as order_quantity,
      nullif(l.value->>'UnitPrice','')::numeric as unit_price,
      nullif(l.value->>'BCUnitPrice','')::numeric as bc_unit_price,
      nullif(l.value->>'CreditPrice','')::numeric as credit_price,
      coalesce(
        nullif(l.value->>'AverageLandedPriceAtTimeOfSale',''),
        nullif(l.value->>'AverageLandedPrice','')
      )::numeric as average_landed_price_at_time_of_sale,
      nullif(l.value->>'DiscountRate','')::numeric as discount_rate,
      nullif(l.value->>'LineTotal','')::numeric as raw_line_amount,
      nullif(l.value->>'LineTax','')::numeric as raw_line_tax,
      d.effect_sign,d.source_snapshot_id,d.source_snapshot_hash,
      encode(extensions.digest(jsonb_build_array(
        d.source_snapshot_hash,d.order_snapshot_hash,d.invoice_snapshot_hash,l.value,l.ordinality
      )::text,'sha256'),'hex') as source_version_hash,
      analytics.parse_unleashed_datetime(
        coalesce(nullif(l.value->>'LastModifiedOn',''),nullif(l.value->>'LastModified',''))
      ) as source_line_last_modified_at,
      d.source_last_modified_at as document_source_last_modified_at,
      d.source_last_modified_at,
      case
        when nullif(l.value->>'LineTotal','') is null
          or nullif(l.value->>'LineTax','') is null
          or (d.transaction_kind='INVOICE' and nullif(l.value->>'InvoiceQuantity','') is null)
          or (d.transaction_kind='INVOICE' and nullif(l.value->>'UnitPrice','') is null)
          or (d.transaction_kind='CREDIT_NOTE' and nullif(l.value->>'CreditQuantity','') is null)
          or (d.transaction_kind='CREDIT_NOTE' and nullif(l.value->>'CreditPrice','') is null)
          then 'INVALID'
        when (nullif(l.value->>'Guid','') is null and nullif(l.value->>'LineNumber','') is null)
          or (coalesce(nullif(l.value#>>'{Product,Guid}',''),nullif(l.value->>'ProductGuid','')) is not null
          and coalesce(nullif(l.value#>>'{Product,ProductCode}',''),nullif(l.value->>'ProductCode','')) is null)
          then 'DEGRADED'
        else 'TRUSTED'
      end as quality_status,
      array_remove(array[
        case when nullif(l.value->>'Guid','') is null and nullif(l.value->>'LineNumber','') is null
          then 'SYNTHETIC_SOURCE_LINE_IDENTITY' end,
        case when nullif(l.value->>'LineTotal','') is null then 'MISSING_LINE_AMOUNT' end,
        case when nullif(l.value->>'LineTax','') is null then 'MISSING_LINE_TAX' end,
        case when d.transaction_kind='INVOICE' and nullif(l.value->>'InvoiceQuantity','') is null
          then 'MISSING_INVOICE_QUANTITY' end,
        case when d.transaction_kind='INVOICE' and nullif(l.value->>'UnitPrice','') is null
          then 'MISSING_INVOICE_UNIT_PRICE' end,
        case when d.transaction_kind='CREDIT_NOTE' and nullif(l.value->>'CreditQuantity','') is null
          then 'MISSING_CREDIT_QUANTITY' end,
        case when d.transaction_kind='CREDIT_NOTE' and nullif(l.value->>'CreditPrice','') is null
          then 'MISSING_CREDIT_PRICE' end,
        case when coalesce(nullif(l.value#>>'{Product,Guid}',''),nullif(l.value->>'ProductGuid','')) is not null
          and coalesce(nullif(l.value#>>'{Product,ProductCode}',''),nullif(l.value->>'ProductCode','')) is null
          then 'MISSING_PRODUCT_CODE' end
      ]::text[],null) as quality_codes,
      l.value as source_line_payload
    from pg_temp.sales_transaction_document_raw d
    cross join lateral jsonb_array_elements(d.source_lines)
      with ordinality as l(value,ordinality);

    create temporary table pg_temp.sales_transaction_document_source
    on commit drop as
    with line_rollup as (
      select source_resource,source_document_key,
        count(*)::integer as source_line_count,
        count(*) filter(where line_classification='INVOICE_CHARGE')::integer as source_charge_line_count,
        sum(raw_line_amount) as line_subtotal_sum,
        sum(raw_line_tax) as line_tax_sum,
        count(*) filter(where quality_status='INVALID') as invalid_line_count,
        count(*) filter(where quality_status='DEGRADED') as degraded_line_count
      from pg_temp.sales_transaction_line_source
      group by source_resource,source_document_key
    )
    select
      'UNLEASHED'::text as source_system,
      d.source_resource,d.transaction_kind,d.source_document_key,
      d.source_document_guid,d.document_number,d.origin_invoice_number,
      d.origin_invoice_guid,d.source_order_number,d.source_sales_order_guid,
      d.source_snapshot_id,d.source_snapshot_hash,
      encode(extensions.digest(jsonb_build_array(
        d.source_snapshot_hash,d.order_snapshot_hash,d.invoice_snapshot_hash
      )::text,'sha256'),'hex') as source_version_hash,
      d.source_last_modified_at,d.transaction_date,d.invoice_date,d.credit_date,
      d.document_status,d.credit_type,d.credit_reason,
      d.customer_guid,d.customer_code,d.customer_name,
      d.order_linkage_status,d.invoice_linkage_status,d.sales_order_status,
      d.salesperson_guid,d.salesperson_name,d.warehouse_guid,d.warehouse_code,
      d.warehouse_name,d.sales_order_group,d.sales_order_source_id,
      d.delivery_country,d.delivery_region,d.currency_code,d.exchange_rate,
      d.source_subtotal,d.source_tax_total,d.source_total,
      d.source_bc_subtotal,d.source_bc_tax_total,d.source_bc_total,
      coalesce(r.source_line_count,0) as source_line_count,
      coalesce(r.source_charge_line_count,0) as source_charge_line_count,
      r.line_subtotal_sum,r.line_tax_sum,
      d.source_subtotal-r.line_subtotal_sum as header_line_subtotal_delta,
      d.source_tax_total-r.line_tax_sum as header_line_tax_delta,
      d.effect_sign,
      case
        when d.source_document_guid is null and d.document_number is null then 'INVALID'
        when d.transaction_date is null or d.source_subtotal is null
          or d.source_tax_total is null or d.source_total is null
          or coalesce(r.invalid_line_count,0)>0 then 'INVALID'
        when d.order_linkage_status<>'EXACT_ONE'
          or (d.transaction_kind='CREDIT_NOTE' and d.invoice_linkage_status<>'EXACT_ONE')
          or d.salesperson_guid is null or d.warehouse_guid is null
          or nullif(btrim(d.sales_order_group),'') is null
          or nullif(btrim(d.sales_order_source_id),'') is null
          or nullif(btrim(d.delivery_country),'') is null
          or nullif(btrim(d.delivery_region),'') is null
          or coalesce(r.degraded_line_count,0)>0
          or abs(coalesce(d.source_subtotal-r.line_subtotal_sum,0))>0.005
          then 'DEGRADED'
        else 'TRUSTED'
      end as quality_status,
      array_remove(array[
        case when d.source_document_guid is null and d.document_number is null then 'MISSING_SOURCE_DOCUMENT_IDENTITY' end,
        case when d.transaction_date is null then 'MISSING_TRANSACTION_DATE' end,
        case when d.source_subtotal is null or d.source_tax_total is null or d.source_total is null then 'MISSING_REQUIRED_HEADER_AMOUNT' end,
        case when d.order_linkage_status='UNMATCHED' then 'ORDER_LINKAGE_UNMATCHED' end,
        case when d.order_linkage_status='AMBIGUOUS' then 'ORDER_LINKAGE_AMBIGUOUS' end,
        case when d.order_linkage_status='CONFLICT' then 'ORDER_LINKAGE_CONFLICT' end,
        case when d.transaction_kind='CREDIT_NOTE' and d.invoice_linkage_status='UNMATCHED' then 'INVOICE_LINKAGE_UNMATCHED' end,
        case when d.transaction_kind='CREDIT_NOTE' and d.invoice_linkage_status='AMBIGUOUS' then 'INVOICE_LINKAGE_AMBIGUOUS' end,
        case when d.salesperson_guid is null then 'MISSING_SALESPERSON' end,
        case when d.warehouse_guid is null then 'MISSING_WAREHOUSE' end,
        case when nullif(btrim(d.sales_order_group),'') is null then 'MISSING_SALES_ORDER_GROUP' end,
        case when nullif(btrim(d.sales_order_source_id),'') is null then 'MISSING_SALES_ORDER_SOURCE_ID' end,
        case when nullif(btrim(d.delivery_country),'') is null then 'MISSING_DELIVERY_COUNTRY' end,
        case when nullif(btrim(d.delivery_region),'') is null then 'MISSING_DELIVERY_REGION' end,
        case when coalesce(r.invalid_line_count,0)>0 then 'INVALID_SOURCE_LINE' end,
        case when abs(coalesce(d.source_subtotal-r.line_subtotal_sum,0))>0.005 then 'HEADER_LINE_AMOUNT_BASIS_VARIANCE' end
      ]::text[],null) as quality_codes
    from pg_temp.sales_transaction_document_raw d
    left join line_rollup r using(source_resource,source_document_key);

    update analytics.fact_sales_transaction_document f
    set effective_to=v_as_of,is_current=false,last_observed_at=v_as_of,as_of_at=v_as_of
    from pg_temp.sales_transaction_document_source s
    where f.source_system=s.source_system
      and f.source_resource=s.source_resource
      and f.source_document_key=s.source_document_key
      and f.is_current and f.source_version_hash<>s.source_version_hash;

    update analytics.fact_sales_transaction_document f
    set last_observed_at=v_as_of,as_of_at=v_as_of,
        source_last_modified_at=s.source_last_modified_at,
        quality_status=s.quality_status,quality_codes=s.quality_codes,
        quality_reasons=to_jsonb(s.quality_codes)
    from pg_temp.sales_transaction_document_source s
    where f.source_system=s.source_system
      and f.source_resource=s.source_resource
      and f.source_document_key=s.source_document_key
      and f.is_current and f.source_version_hash=s.source_version_hash;

    update analytics.fact_sales_transaction_document f
    set effective_to=v_as_of,is_current=false,last_observed_at=v_as_of,as_of_at=v_as_of
    where f.source_system='UNLEASHED' and f.is_current
      and f.source_resource in ('SalesInvoices','CreditNotes')
      and not exists (
        select 1 from pg_temp.sales_transaction_document_source s
        where s.source_system=f.source_system and s.source_resource=f.source_resource
          and s.source_document_key=f.source_document_key
      );

    insert into analytics.fact_sales_transaction_document(
      source_system,source_resource,transaction_kind,source_document_key,
      source_document_guid,document_number,origin_invoice_number,origin_invoice_guid,
      source_order_number,source_sales_order_guid,source_snapshot_id,
      source_snapshot_hash,source_version_hash,source_last_modified_at,
      transaction_date,invoice_date,credit_date,document_status,credit_type,
      credit_reason,customer_guid,customer_code,customer_name,order_linkage_status,
      invoice_linkage_status,sales_order_status,salesperson_guid,salesperson_name,
      warehouse_guid,warehouse_code,warehouse_name,sales_order_group,
      sales_order_source_id,delivery_country,delivery_region,currency_code,
      exchange_rate,source_subtotal,source_tax_total,source_total,
      source_bc_subtotal,source_bc_tax_total,source_bc_total,source_line_count,
      source_charge_line_count,line_subtotal_sum,line_tax_sum,
      header_line_subtotal_delta,header_line_tax_delta,effect_sign,quality_status,
      quality_codes,quality_reasons,effective_from,effective_to,is_current,
      first_observed_at,last_observed_at,as_of_at
    )
    select
      s.source_system,s.source_resource,s.transaction_kind,s.source_document_key,
      s.source_document_guid,s.document_number,s.origin_invoice_number,s.origin_invoice_guid,
      s.source_order_number,s.source_sales_order_guid,s.source_snapshot_id,
      s.source_snapshot_hash,s.source_version_hash,s.source_last_modified_at,
      s.transaction_date,s.invoice_date,s.credit_date,s.document_status,s.credit_type,
      s.credit_reason,s.customer_guid,s.customer_code,s.customer_name,s.order_linkage_status,
      s.invoice_linkage_status,s.sales_order_status,s.salesperson_guid,s.salesperson_name,
      s.warehouse_guid,s.warehouse_code,s.warehouse_name,s.sales_order_group,
      s.sales_order_source_id,s.delivery_country,s.delivery_region,s.currency_code,
      s.exchange_rate,s.source_subtotal,s.source_tax_total,s.source_total,
      s.source_bc_subtotal,s.source_bc_tax_total,s.source_bc_total,s.source_line_count,
      s.source_charge_line_count,s.line_subtotal_sum,s.line_tax_sum,
      s.header_line_subtotal_delta,s.header_line_tax_delta,s.effect_sign,s.quality_status,
      s.quality_codes,to_jsonb(s.quality_codes),v_as_of,null,true,v_as_of,v_as_of,v_as_of
    from pg_temp.sales_transaction_document_source s
    where not exists (
      select 1 from analytics.fact_sales_transaction_document f
      where f.source_system=s.source_system and f.source_resource=s.source_resource
        and f.source_document_key=s.source_document_key and f.is_current
        and f.source_version_hash=s.source_version_hash
    );

    update analytics.fact_sales_transaction_line f
    set effective_to=v_as_of,is_current=false,last_observed_at=v_as_of,as_of_at=v_as_of
    from pg_temp.sales_transaction_line_source s
    where f.source_system=s.source_system and f.source_resource=s.source_resource
      and f.source_line_key=s.source_line_key and f.is_current
      and f.source_version_hash<>s.source_version_hash;

    update analytics.fact_sales_transaction_line f
    set last_observed_at=v_as_of,as_of_at=v_as_of,
        source_last_modified_at=s.source_last_modified_at,
        quality_status=s.quality_status,quality_codes=s.quality_codes,
        quality_reasons=to_jsonb(s.quality_codes),
        source_line_last_modified_at=s.source_line_last_modified_at,
        document_source_last_modified_at=s.document_source_last_modified_at
    from pg_temp.sales_transaction_line_source s
    where f.source_system=s.source_system and f.source_resource=s.source_resource
      and f.source_line_key=s.source_line_key and f.is_current
      and f.source_version_hash=s.source_version_hash;

    update analytics.fact_sales_transaction_line f
    set effective_to=v_as_of,is_current=false,last_observed_at=v_as_of,as_of_at=v_as_of
    where f.source_system='UNLEASHED' and f.is_current
      and f.source_resource in ('SalesInvoices','CreditNotes')
      and not exists (
        select 1 from pg_temp.sales_transaction_line_source s
        where s.source_system=f.source_system and s.source_resource=f.source_resource
          and s.source_line_key=f.source_line_key
      );

    insert into analytics.fact_sales_transaction_line(
      sales_transaction_document_id,source_system,source_resource,transaction_kind,
      source_document_key,source_document_guid,document_number,source_line_key,
      source_line_guid,source_line_number,source_line_ordinal,source_order_number,
      source_sales_order_guid,transaction_date,document_status,line_classification,
      source_line_type,credit_type,credit_reason,product_guid,product_code,
      product_description,invoice_quantity,credit_quantity,order_quantity,unit_price,
      bc_unit_price,credit_price,average_landed_price_at_time_of_sale,discount_rate,raw_line_amount,
      raw_line_tax,effect_sign,source_snapshot_id,source_snapshot_hash,
      source_version_hash,source_line_last_modified_at,
      document_source_last_modified_at,source_last_modified_at,quality_status,quality_codes,
      quality_reasons,effective_from,effective_to,is_current,first_observed_at,
      last_observed_at,as_of_at
    )
    select
      d.sales_transaction_document_id,s.source_system,s.source_resource,
      s.transaction_kind,s.source_document_key,s.source_document_guid,
      s.document_number,s.source_line_key,s.source_line_guid,s.source_line_number,
      s.source_line_ordinal,s.source_order_number,s.source_sales_order_guid,
      s.transaction_date,s.document_status,s.line_classification,s.source_line_type,
      s.credit_type,s.credit_reason,s.product_guid,s.product_code,s.product_description,
      s.invoice_quantity,s.credit_quantity,s.order_quantity,s.unit_price,s.bc_unit_price,
      s.credit_price,s.average_landed_price_at_time_of_sale,s.discount_rate,s.raw_line_amount,
      s.raw_line_tax,s.effect_sign,s.source_snapshot_id,s.source_snapshot_hash,
      s.source_version_hash,s.source_line_last_modified_at,
      s.document_source_last_modified_at,s.source_last_modified_at,s.quality_status,s.quality_codes,
      to_jsonb(s.quality_codes),v_as_of,null,true,v_as_of,v_as_of,v_as_of
    from pg_temp.sales_transaction_line_source s
    join analytics.fact_sales_transaction_document d
      on d.source_system=s.source_system and d.source_resource=s.source_resource
     and d.source_document_key=s.source_document_key and d.is_current
    where not exists (
      select 1 from analytics.fact_sales_transaction_line f
      where f.source_system=s.source_system and f.source_resource=s.source_resource
        and f.source_line_key=s.source_line_key and f.is_current
        and f.source_version_hash=s.source_version_hash
    );

    select count(*),count(*) filter(where quality_status<>'TRUSTED')
      into v_document_count,v_document_issues
    from analytics.fact_sales_transaction_document where is_current;

    select count(*),count(*) filter(where quality_status<>'TRUSTED')
      into v_line_count,v_line_issues
    from analytics.fact_sales_transaction_line where is_current;

    if v_document_issues>0 then
      insert into analytics.data_quality_status(
        issue_key,dataset_key,severity,status,issue_type,entity_type,title,detail,
        business_impact,recommended_action,owner_team,visible_to_roles,
        first_detected_at,last_detected_at,occurrence_count,details,updated_at
      ) values (
        'sales_transaction_documents.current_quality',
        'analytics.sales_transaction_documents','WARN','OPEN','SOURCE_QUALITY',
        'DATASET','Sales transaction document source-quality findings',
        v_document_issues || ' current document rows are DEGRADED or INVALID.',
        'Facts preserve source evidence but require quality-aware consumption.',
        'Review exact linkage and source quality codes; do not infer metric authority.',
        'DATA',array['OWNER','ADMIN','ACCOUNT']::text[],v_as_of,v_as_of,
        v_document_issues,jsonb_build_object('current_issue_rows',v_document_issues),v_as_of
      ) on conflict(issue_key) do update
      set status='OPEN',resolved_at=null,resolution_code=null,last_detected_at=v_as_of,
          occurrence_count=analytics.data_quality_status.occurrence_count+v_document_issues,
          detail=excluded.detail,details=excluded.details,updated_at=v_as_of;
    else
      update analytics.data_quality_status
      set status='RESOLVED',resolved_at=v_as_of,resolution_code='NO_CURRENT_FINDINGS',
          last_detected_at=v_as_of,details=jsonb_build_object('current_issue_rows',0),updated_at=v_as_of
      where issue_key='sales_transaction_documents.current_quality' and status<>'RESOLVED';
    end if;

    if v_line_issues>0 then
      insert into analytics.data_quality_status(
        issue_key,dataset_key,severity,status,issue_type,entity_type,title,detail,
        business_impact,recommended_action,owner_team,visible_to_roles,
        first_detected_at,last_detected_at,occurrence_count,details,updated_at
      ) values (
        'sales_transaction_lines.current_quality',
        'analytics.sales_transaction_lines','WARN','OPEN','SOURCE_QUALITY',
        'DATASET','Sales transaction line source-quality findings',
        v_line_issues || ' current line rows are DEGRADED or INVALID.',
        'Facts preserve source evidence but require quality-aware consumption.',
        'Review line quality codes; retain negative charges and raw credit amounts.',
        'DATA',array['OWNER','ADMIN','ACCOUNT']::text[],v_as_of,v_as_of,
        v_line_issues,jsonb_build_object('current_issue_rows',v_line_issues),v_as_of
      ) on conflict(issue_key) do update
      set status='OPEN',resolved_at=null,resolution_code=null,last_detected_at=v_as_of,
          occurrence_count=analytics.data_quality_status.occurrence_count+v_line_issues,
          detail=excluded.detail,details=excluded.details,updated_at=v_as_of;
    else
      update analytics.data_quality_status
      set status='RESOLVED',resolved_at=v_as_of,resolution_code='NO_CURRENT_FINDINGS',
          last_detected_at=v_as_of,details=jsonb_build_object('current_issue_rows',0),updated_at=v_as_of
      where issue_key='sales_transaction_lines.current_quality' and status<>'RESOLVED';
    end if;

    update analytics.refresh_status rs
    set status=case when v_document_issues>0 then 'DEGRADED' else 'CURRENT' end,
        as_of_at=v_as_of,last_succeeded_at=v_as_of,row_count=v_document_count,
        error_code=null,error_message=null,
        details=jsonb_build_object('quality_issue_rows',v_document_issues),updated_at=v_as_of
    where rs.dataset_key='analytics.sales_transaction_documents';

    update analytics.refresh_status rs
    set status=case when v_line_issues>0 then 'DEGRADED' else 'CURRENT' end,
        as_of_at=v_as_of,last_succeeded_at=v_as_of,row_count=v_line_count,
        error_code=null,error_message=null,
        details=jsonb_build_object('quality_issue_rows',v_line_issues),updated_at=v_as_of
    where rs.dataset_key='analytics.sales_transaction_lines';

    return query values
      ('analytics.sales_transaction_documents'::text,v_document_count,
        case when v_document_issues>0 then 'DEGRADED' else 'CURRENT' end::text),
      ('analytics.sales_transaction_lines'::text,v_line_count,
        case when v_line_issues>0 then 'DEGRADED' else 'CURRENT' end::text);
  exception when others then
    get stacked diagnostics v_error=message_text,v_error_code=returned_sqlstate;
    update analytics.refresh_status rs
    set status='FAILED',last_failed_at=clock_timestamp(),error_code=v_error_code,
        error_message=left(v_error,2000),updated_at=clock_timestamp()
    where rs.dataset_key in (
      'analytics.sales_transaction_documents','analytics.sales_transaction_lines'
    );
    return query values
      ('analytics.sales_transaction_documents'::text,0::bigint,'FAILED'::text),
      ('analytics.sales_transaction_lines'::text,0::bigint,'FAILED'::text);
  end;
end;
$$;



revoke all on function analytics.refresh_sales_transaction_facts(timestamptz)
  from public,anon,authenticated;
grant execute on function analytics.refresh_sales_transaction_facts(timestamptz)
  to service_role;

comment on function analytics.refresh_sales_transaction_facts(timestamptz) is
  'Service-only snapshot refresh. Reads canonical raw resources and maps InvoiceStatus for sales invoices, Status for credit notes. Preserves raw accounting evidence; no provider calls.';

create or replace view analytics.v_sales_transaction_metric_input_internal
with (security_barrier=true,security_invoker=true)
as
select
  d.sales_transaction_document_id,
  d.transaction_date as metric_date,
  d.transaction_kind,
  d.source_document_key,
  d.document_number,
  d.source_order_number,
  d.customer_guid,
  d.customer_code,
  d.customer_name,
  d.sales_order_group,
  d.sales_order_source_id,
  d.delivery_country,
  d.delivery_region,
  d.currency_code,
  d.exchange_rate,
  d.document_status,
  d.quality_status,
  d.quality_codes,
  d.source_bc_subtotal,
  d.source_subtotal,
  d.line_subtotal_sum,
  d.header_line_subtotal_delta,
  d.effect_sign,
  case
    when d.document_status='Completed'
      and d.transaction_date is not null
      and d.source_bc_subtotal is not null
      and d.quality_status<>'INVALID'
    then d.effect_sign*d.source_bc_subtotal
    else null
  end as revenue_base_amount,
  case
    when d.transaction_kind='INVOICE'
      and d.document_status='Completed'
      and d.transaction_date is not null
      and nullif(btrim(d.source_order_number),'') is not null
      and d.quality_status<>'INVALID'
    then d.source_order_number
    else null
  end as completed_invoice_order_key,
  (
    d.document_status='Completed'
    and d.transaction_date is not null
    and d.source_bc_subtotal is not null
    and d.quality_status<>'INVALID'
  ) as revenue_eligible,
  (
    d.transaction_kind='INVOICE'
    and d.document_status='Completed'
    and d.transaction_date is not null
    and nullif(btrim(d.source_order_number),'') is not null
    and d.quality_status<>'INVALID'
  ) as sales_order_eligible,
  case
    when d.header_line_subtotal_delta is null then null
    else d.effect_sign*d.header_line_subtotal_delta
  end as source_header_line_delta_effect
from analytics.fact_sales_transaction_document d
where d.is_current;

revoke all on analytics.v_sales_transaction_metric_input_internal
  from public,anon,authenticated,service_role;
grant select on analytics.v_sales_transaction_metric_input_internal
  to service_role;

create or replace function analytics.reconcile_sales_transaction_metrics(
  p_from_date date,
  p_to_date date
)
returns table(
  from_date date,
  to_date date,
  revenue_base numeric,
  sales_orders bigint,
  average_revenue_per_order numeric,
  eligible_invoice_documents bigint,
  eligible_credit_documents bigint,
  parked_invoice_documents bigint,
  invalid_documents bigint,
  header_line_variance_documents bigint,
  source_header_line_delta_effect numeric
)
language plpgsql
security invoker
set search_path = pg_catalog,analytics
as $$
begin
  if p_from_date is null or p_to_date is null or p_from_date>p_to_date then
    raise exception 'INVALID_SALES_TRANSACTION_METRIC_DATE_RANGE';
  end if;

  return query
  select
    p_from_date,
    p_to_date,
    coalesce(sum(v.revenue_base_amount) filter(where v.revenue_eligible),0::numeric),
    count(distinct v.completed_invoice_order_key) filter(where v.sales_order_eligible),
    coalesce(sum(v.revenue_base_amount) filter(where v.revenue_eligible),0::numeric)
      / nullif(
          count(distinct v.completed_invoice_order_key) filter(where v.sales_order_eligible),
          0
        ),
    count(*) filter(
      where v.transaction_kind='INVOICE' and v.revenue_eligible
    ),
    count(*) filter(
      where v.transaction_kind='CREDIT_NOTE' and v.revenue_eligible
    ),
    count(*) filter(
      where v.transaction_kind='INVOICE'
        and coalesce(v.document_status,'')<>'Completed'
    ),
    count(*) filter(where v.quality_status='INVALID'),
    count(*) filter(
      where abs(coalesce(v.header_line_subtotal_delta,0))>0.005
    ),
    coalesce(sum(v.source_header_line_delta_effect),0::numeric)
  from analytics.v_sales_transaction_metric_input_internal v
  where v.metric_date between p_from_date and p_to_date;
end;
$$;

revoke all on function analytics.reconcile_sales_transaction_metrics(date,date)
  from public,anon,authenticated,service_role;
grant execute on function analytics.reconcile_sales_transaction_metrics(date,date)
  to service_role;

comment on view analytics.v_sales_transaction_metric_input_internal is
  'Internal DRAFT metric input. Completed invoices and credit notes contribute base-currency ex-tax revenue; only completed invoices contribute Sales Orders denominator. Parked invoices remain visible but ineligible.';
comment on function analytics.reconcile_sales_transaction_metrics(date,date) is
  'Service-only reconciliation for DRAFT Revenue, Sales Orders and Average Revenue per Order semantics over an explicit date range. Distinct Sales Orders are non-additive across periods.';

insert into analytics.metric_definition(
  metric_key,metric_version,display_name,business_definition,
  formula_description,grain_key,date_basis,unit_kind,dimension_keys,
  exclusions,source_objects,freshness_sla,data_owner,quality_policy,
  display_format,status
)
values
(
  'revenue',2,'Revenue',
  'Completed sales-invoice subtotal in base currency excluding tax, less completed credit-note subtotal, attributed to each invoice or credit transaction date.',
  'Sum effect_sign × source base-currency SubTotal for eligible completed invoice/credit documents. InvoiceStatus=Completed is required for invoices; Status=Completed is required for credits. Header SubTotal is authoritative accounting evidence; header/line variance remains a quality signal and is not balanced.',
  'transaction_document','transaction_date','CURRENCY',
  array['date','customer','order_source']::text[],
  array[
    'parked_invoices',
    'non_completed_credit_notes',
    'invalid_transaction_documents',
    'missing_base_currency_subtotal'
  ]::text[],
  array['analytics.v_sales_transaction_metric_input_internal']::text[],
  interval '24 hours','Commercial','FAIL_CLOSED',
  '{"currency_basis":"BASE","tax_basis":"EXCLUSIVE","credit_treatment":"REVERSAL"}'::jsonb,
  'DRAFT'
),
(
  'sales_orders',1,'Sales Orders',
  'Distinct sales orders with at least one eligible completed sales invoice in the selected transaction-date period.',
  'Count distinct source_order_number from eligible completed invoice documents. Credit notes never create a Sales Order denominator. Multiple invoices for one order count once within the selected period; this metric is non-additive across periods.',
  'sales_order_period','invoice_date','COUNT',
  array['date','customer','order_source']::text[],
  array[
    'parked_invoices',
    'credit_notes',
    'invalid_transaction_documents',
    'missing_order_number'
  ]::text[],
  array['analytics.v_sales_transaction_metric_input_internal']::text[],
  interval '24 hours','Commercial','FAIL_CLOSED',
  '{"aggregation":"DISTINCT_WITHIN_SELECTED_PERIOD","additivity":"NON_ADDITIVE"}'::jsonb,
  'DRAFT'
),
(
  'average_revenue_per_order',1,'Average Revenue per Order',
  'Net completed transaction revenue divided by distinct completed-invoiced Sales Orders in the same selected period.',
  'Revenue v2 numerator divided by Sales Orders v1 denominator for the same explicit period. Credit notes reduce the numerator on credit date but do not create denominator orders. Returns NULL when the period contains zero eligible completed-invoiced Sales Orders.',
  'sales_order_period','transaction_date','CURRENCY',
  array['date','customer','order_source']::text[],
  array[
    'parked_invoices',
    'invalid_transaction_documents',
    'zero_completed_invoiced_orders'
  ]::text[],
  array['analytics.v_sales_transaction_metric_input_internal']::text[],
  interval '24 hours','Commercial','FAIL_CLOSED',
  '{"currency_basis":"BASE","tax_basis":"EXCLUSIVE","denominator":"DISTINCT_COMPLETED_INVOICED_ORDER","zero_denominator":"NULL","additivity":"NON_ADDITIVE"}'::jsonb,
  'DRAFT'
);

commit;
