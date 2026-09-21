\set ON_ERROR_STOP on

begin;

do $structure$
begin
  if to_regclass('analytics.fact_sales_transaction_document') is null
     or to_regclass('analytics.fact_sales_transaction_line') is null
     or to_regclass('analytics.v_sales_transaction_source_quality_internal') is null then
    raise exception 'sales transaction fact objects are incomplete';
  end if;

  if to_regprocedure('analytics.refresh_sales_transaction_facts(timestamptz)') is null then
    raise exception 'sales transaction refresh function is missing';
  end if;

  if not (select relrowsecurity from pg_class
          where oid='analytics.fact_sales_transaction_document'::regclass)
     or not (select relrowsecurity from pg_class
          where oid='analytics.fact_sales_transaction_line'::regclass) then
    raise exception 'sales transaction facts are missing RLS';
  end if;

  if has_table_privilege('anon','analytics.fact_sales_transaction_document','SELECT')
     or has_table_privilege('authenticated','analytics.fact_sales_transaction_document','SELECT')
     or has_table_privilege('anon','analytics.fact_sales_transaction_line','SELECT')
     or has_table_privilege('authenticated','analytics.fact_sales_transaction_line','SELECT')
     or has_table_privilege('authenticated','analytics.v_sales_transaction_source_quality_internal','SELECT') then
    raise exception 'browser role can read internal sales transaction evidence';
  end if;

  if not has_table_privilege('service_role','analytics.fact_sales_transaction_document','SELECT')
     or not has_table_privilege('service_role','analytics.fact_sales_transaction_line','SELECT')
     or not has_table_privilege('service_role','analytics.v_sales_transaction_source_quality_internal','SELECT')
     or has_table_privilege('service_role','analytics.fact_sales_transaction_document','INSERT')
     or has_table_privilege('service_role','analytics.fact_sales_transaction_document','UPDATE')
     or has_table_privilege('service_role','analytics.fact_sales_transaction_document','DELETE')
     or has_table_privilege('service_role','analytics.fact_sales_transaction_line','INSERT')
     or has_table_privilege('service_role','analytics.fact_sales_transaction_line','UPDATE')
     or has_table_privilege('service_role','analytics.fact_sales_transaction_line','DELETE')
     or has_sequence_privilege(
       'service_role',
       pg_get_serial_sequence(
         'analytics.fact_sales_transaction_document','sales_transaction_document_id'
       ),
       'USAGE'
     )
     or has_sequence_privilege(
       'service_role',
       pg_get_serial_sequence(
         'analytics.fact_sales_transaction_line','sales_transaction_line_id'
       ),
       'USAGE'
     ) then
    raise exception 'service role fact permissions bypass the controlled refresh';
  end if;

  if has_function_privilege(
       'authenticated','analytics.refresh_sales_transaction_facts(timestamptz)','EXECUTE'
     ) or not has_function_privilege(
       'service_role','analytics.refresh_sales_transaction_facts(timestamptz)','EXECUTE'
     ) then
    raise exception 'sales transaction refresh execution boundary is incorrect';
  end if;

  if exists(select 1 from analytics.fact_sales_transaction_document)
     or exists(select 1 from analytics.fact_sales_transaction_line) then
    raise exception 'migration materialised production sales transaction facts';
  end if;

  if (select count(*) from analytics.refresh_status
      where dataset_key in (
        'analytics.sales_transaction_documents','analytics.sales_transaction_lines'
      ) and status='NEVER')<>2 then
    raise exception 'sales transaction datasets did not start in NEVER state';
  end if;

  if (select count(*) from analytics.metric_definition)<>10
     or exists(select 1 from analytics.metric_definition where status<>'DRAFT') then
    raise exception 'sales transaction migration changed the 10/10 DRAFT metric registry';
  end if;
end;
$structure$;

insert into public.unleashed_raw_snapshots(
  resource,external_key,external_guid,external_number,source_last_modified_at,
  payload,payload_sha256
)
values
  (
    'sales_orders_history','SO-1','so-guid-1','SO-1','2026-01-01 01:00:00+00',
    '{
      "Guid":"so-guid-1","OrderNumber":"SO-1","Status":"Completed",
      "SalesPerson":{"Guid":"sp-1","FullName":"Alex Seller"},
      "Warehouse":{"Guid":"wh-1","WarehouseCode":"MAIN","WarehouseName":"Main"},
      "SalesOrderGroup":"Online","SourceId":"portal",
      "DeliveryAddress":{"Country":"Australia","Region":"SA"}
    }'::jsonb,
    repeat('1',64)
  ),
  (
    'sales_orders_history','SO-2','so-guid-2','SO-2','2026-01-01 01:00:00+00',
    '{
      "Guid":"so-guid-2","OrderNumber":"SO-2","Status":"Completed",
      "SalesPerson":{"Guid":"sp-2","FullName":"Bea Seller"},
      "Warehouse":{"Guid":"wh-1","WarehouseCode":"MAIN","WarehouseName":"Main"},
      "SalesOrderGroup":"Online","SourceId":"portal",
      "DeliveryAddress":{"Country":"Australia","Region":"SA"}
    }'::jsonb,
    repeat('2',64)
  ),
  (
    'sales_orders_history','SO-3','so-guid-3','SO-3','2026-01-01 01:00:00+00',
    '{
      "Guid":"so-guid-3","OrderNumber":"SO-3","Status":"Completed",
      "SalesPerson":null,
      "Warehouse":{"Guid":"wh-1","WarehouseCode":"MAIN","WarehouseName":"Main"},
      "SalesOrderGroup":"Online","SourceId":"portal",
      "DeliveryAddress":{"Country":"Australia","Region":"SA"}
    }'::jsonb,
    repeat('3',64)
  ),
  (
    'sales_invoices','INV-1','inv-guid-1','INV-1','2026-01-02 01:00:00+00',
    '{
      "Guid":"inv-guid-1","InvoiceNumber":"INV-1","OrderNumber":"SO-1",
      "Status":"Completed","InvoiceDate":"/Date(1767312000000)/",
      "Customer":{"Guid":"cust-1","CustomerCode":"C-1","CustomerName":"Customer One"},
      "Currency":{"CurrencyCode":"AUD"},"ExchangeRate":1,
      "SubTotal":100,"TaxTotal":10,"Total":110,
      "BCSubTotal":100,"BCTaxTotal":10,"BCTotal":110,
      "InvoiceLines":[{
        "Guid":"inv-line-1","LineNumber":1,
        "Product":{"Guid":"product-1","ProductCode":"P-1","ProductDescription":"Ordinary"},
        "InvoiceQuantity":2,"UnitPrice":50,"BCUnitPrice":50,
        "DiscountRate":0,"LineTotal":100,"LineTax":10
      }]
    }'::jsonb,
    repeat('4',64)
  ),
  (
    'sales_invoices','INV-CHARGE','inv-guid-charge','INV-CHARGE','2026-01-02 01:00:00+00',
    '{
      "Guid":"inv-guid-charge","InvoiceNumber":"INV-CHARGE","OrderNumber":"SO-2",
      "Status":"Completed","InvoiceDate":"/Date(1767312000000)/",
      "Customer":{"Guid":"cust-2","CustomerCode":"C-2","CustomerName":"Customer Two"},
      "Currency":{"CurrencyCode":"AUD"},"ExchangeRate":1,
      "SubTotal":-5,"TaxTotal":0,"Total":-5,
      "BCSubTotal":-5,"BCTaxTotal":0,"BCTotal":-5,
      "InvoiceLines":[{
        "Guid":"inv-line-charge","LineNumber":1,"LineType":"Charge",
        "InvoiceQuantity":0,"UnitPrice":-5,"BCUnitPrice":-5,
        "DiscountRate":0,"LineTotal":-5,"LineTax":0
      }]
    }'::jsonb,
    repeat('5',64)
  ),
  (
    'sales_invoices','INV-DISCOUNT','inv-guid-discount','INV-DISCOUNT','2026-01-02 01:00:00+00',
    '{
      "Guid":"inv-guid-discount","InvoiceNumber":"INV-DISCOUNT","OrderNumber":"SO-3",
      "Status":"Completed","InvoiceDate":"/Date(1767312000000)/",
      "Customer":{"Guid":"cust-3","CustomerCode":"C-3","CustomerName":"Customer Three"},
      "Currency":{"CurrencyCode":"AUD"},"ExchangeRate":1,
      "SubTotal":100,"TaxTotal":9.1,"Total":109.1,
      "BCSubTotal":100,"BCTaxTotal":9.1,"BCTotal":109.1,
      "InvoiceLines":[{
        "Guid":"inv-line-discount","LineNumber":1,
        "Product":{"Guid":"product-3","ProductCode":"P-3","ProductDescription":"Discounted"},
        "InvoiceQuantity":1,"UnitPrice":100,"BCUnitPrice":100,
        "DiscountRate":0.09,"LineTotal":91,"LineTax":9.1
      }]
    }'::jsonb,
    repeat('6',64)
  ),
  (
    'credit_notes','CR-1','credit-guid-1','CR-1','2026-01-03 01:00:00+00',
    '{
      "Guid":"credit-guid-1","CreditNoteNumber":"CR-1","InvoiceNumber":"INV-1",
      "SalesOrder":{"Guid":"so-guid-1","OrderNumber":"SO-1"},
      "Status":"Completed","CreditType":"Credit","CreditReason":"Return",
      "CreditDate":"/Date(1767398400000)/",
      "Customer":{"Guid":"cust-1","CustomerCode":"C-1","CustomerName":"Customer One"},
      "Currency":{"CurrencyCode":"AUD"},"ExchangeRate":1,
      "SubTotal":20,"TaxTotal":2,"Total":22,
      "BCSubTotal":20,"BCTaxTotal":2,"BCTotal":22,
      "CreditNoteLines":[{
        "Guid":"credit-line-1","LineNumber":1,
        "Product":{"Guid":"product-1","ProductCode":"P-1","ProductDescription":"Ordinary"},
        "CreditQuantity":1,"CreditPrice":20,"LineTotal":20,"LineTax":2,
        "AverageLandedPriceAtTimeOfSale":12
      }]
    }'::jsonb,
    repeat('7',64)
  );

create temporary table sales_transaction_first_refresh as
select * from analytics.refresh_sales_transaction_facts('2026-01-10 00:00:00+00');

do $first_refresh$
begin
  if (select count(*) from sales_transaction_first_refresh)<>2
     or exists(select 1 from sales_transaction_first_refresh where refresh_state='FAILED') then
    raise exception 'first sales transaction refresh failed';
  end if;

  if (select count(*) from analytics.fact_sales_transaction_document where is_current)<>4
     or (select count(*) from analytics.fact_sales_transaction_line where is_current)<>4 then
    raise exception 'unexpected document or line grain after first refresh';
  end if;

  if (select count(*) from analytics.fact_sales_transaction_document
      where is_current and source_resource='SalesInvoices')<>3
     or (select count(*) from analytics.fact_sales_transaction_document
      where is_current and source_resource='CreditNotes')<>1
     or exists(
       select 1 from analytics.fact_sales_transaction_document
       where is_current and source_resource not in ('SalesInvoices','CreditNotes')
     ) then
    raise exception 'raw resource namespace leaked into frozen fact-layer source_resource semantics';
  end if;

  if not exists(
    select 1 from analytics.fact_sales_transaction_line
    where is_current and document_number='INV-CHARGE'
      and line_classification='INVOICE_CHARGE' and invoice_quantity=0
      and unit_price=-5 and raw_line_amount=-5 and effect_sign=1
  ) then
    raise exception 'negative zero-quantity invoice charge was not preserved';
  end if;

  if not exists(
    select 1 from analytics.fact_sales_transaction_document
    where is_current and document_number='INV-DISCOUNT'
      and source_subtotal=100 and line_subtotal_sum=91
      and header_line_subtotal_delta=9
      and 'HEADER_LINE_AMOUNT_BASIS_VARIANCE'=any(quality_codes)
      and quality_status='DEGRADED'
  ) then
    raise exception 'header/line amount-basis variance was not preserved';
  end if;

  if not exists(
    select 1 from analytics.fact_sales_transaction_line
    where is_current and document_number='INV-DISCOUNT' and discount_rate=0.09
  ) then
    raise exception 'decimal discount-rate source evidence was not preserved';
  end if;

  if exists(
    select 1 from analytics.fact_sales_transaction_line
    where is_current and document_number='INV-DISCOUNT'
      and source_line_key like '%balanc%'
  ) then
    raise exception 'refresh invented a balancing line';
  end if;

  if not exists(
    select 1 from analytics.fact_sales_transaction_line
    where is_current and document_number='CR-1' and line_classification='CREDIT_LINE'
      and raw_line_amount=20 and effect_sign=-1 and effect_amount=-20
      and average_landed_price_at_time_of_sale=12
  ) then
    raise exception 'positive raw credit amount or reversal direction was changed';
  end if;

  if exists(
    select 1 from analytics.fact_sales_transaction_document
    where is_current and order_linkage_status<>'EXACT_ONE'
  ) or not exists(
    select 1 from analytics.fact_sales_transaction_document
    where is_current and document_number='CR-1' and invoice_linkage_status='EXACT_ONE'
  ) then
    raise exception 'exact invoice/order linkage contract failed';
  end if;

  if exists(
    select 1 from analytics.fact_sales_transaction_document
    where is_current and document_number='INV-DISCOUNT' and quality_status='INVALID'
  ) then
    raise exception 'missing optional SalesPerson incorrectly invalidated a document';
  end if;

  if (select count(*) from analytics.v_sales_transaction_source_quality_internal)<>4 then
    raise exception 'internal quality view does not preserve document grain';
  end if;
end;
$first_refresh$;

select * from analytics.refresh_sales_transaction_facts('2026-01-10 01:00:00+00');

do $replay$
begin
  if (select count(*) from analytics.fact_sales_transaction_document)<>4
     or (select count(*) from analytics.fact_sales_transaction_line)<>4
     or (select count(*) from analytics.fact_sales_transaction_document where is_current)<>4
     or (select count(*) from analytics.fact_sales_transaction_line where is_current)<>4 then
    raise exception 'same-hash replay created duplicate versions';
  end if;
end;
$replay$;

update public.unleashed_raw_snapshots
set payload=jsonb_set(
      jsonb_set(payload,'{SubTotal}','101'::jsonb),
      '{InvoiceLines,0,LineTotal}','92'::jsonb
    ),
    payload_sha256=repeat('8',64),
    source_last_modified_at='2026-01-11 00:00:00+00'
where resource='sales_invoices' and external_key='INV-DISCOUNT';

select * from analytics.refresh_sales_transaction_facts('2026-01-11 01:00:00+00');

do $version_change$
begin
  if (select count(*) from analytics.fact_sales_transaction_document)<>5
     or (select count(*) from analytics.fact_sales_transaction_line)<>5
     or (select count(*) from analytics.fact_sales_transaction_document where is_current)<>4
     or (select count(*) from analytics.fact_sales_transaction_line where is_current)<>4 then
    raise exception 'changed payload did not create exactly one new document and line version';
  end if;

  if (select count(*) from analytics.fact_sales_transaction_document
      where document_number='INV-DISCOUNT' and is_current)<>1
     or not exists(
       select 1 from analytics.fact_sales_transaction_document
       where document_number='INV-DISCOUNT' and not is_current and effective_to is not null
     ) then
    raise exception 'document SCD current-version invariant failed';
  end if;
end;
$version_change$;

update public.unleashed_raw_snapshots
set payload=jsonb_set(payload,'{SubTotal}','"not-a-number"'::jsonb),
    payload_sha256=repeat('9',64)
where resource='sales_invoices' and external_key='INV-DISCOUNT';

create temporary table sales_transaction_failed_refresh as
select * from analytics.refresh_sales_transaction_facts('2026-01-12 01:00:00+00');

do $fail_closed$
begin
  if (select count(*) from sales_transaction_failed_refresh where refresh_state='FAILED')<>2 then
    raise exception 'malformed required numeric source did not fail the refresh';
  end if;

  if (select count(*) from analytics.fact_sales_transaction_document)<>5
     or (select count(*) from analytics.fact_sales_transaction_line)<>5
     or not exists(
       select 1 from analytics.fact_sales_transaction_document
       where document_number='INV-DISCOUNT' and is_current and source_subtotal=101
     ) then
    raise exception 'failed refresh partially mutated fact history';
  end if;

  if (select count(*) from analytics.refresh_status
      where dataset_key in (
        'analytics.sales_transaction_documents','analytics.sales_transaction_lines'
      ) and status='FAILED')<>2 then
    raise exception 'failed refresh did not publish bounded failure state';
  end if;
end;
$fail_closed$;

rollback;
