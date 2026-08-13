\set ON_ERROR_STOP on

drop table if exists public.v_ecoflow_accounts_live_statement_lines;
drop table if exists public.v_ecoflow_order_financial_truth_v1;
drop table if exists public.v_ecoflow_order_operations_v3;

create table public.v_ecoflow_order_financial_truth_v1(
  retailer_id text, store_name text, source_order_id text, order_number text,
  invoice_number text, invoice_date timestamptz, financial_observed_at timestamptz,
  invoice_due_at timestamptz, invoice_total numeric, invoice_payment_status text,
  amount_due numeric, source_order_status text
);

create table public.v_ecoflow_order_operations_v3(
  external_order_id text, order_number text, invoice_number text,
  account_release_status text, warehouse_gate_status text
);

create index transform_007_scale_ops_source_id on public.v_ecoflow_order_operations_v3(external_order_id);
create index transform_007_scale_ops_order_number on public.v_ecoflow_order_operations_v3(order_number);
create index transform_007_scale_ops_invoice_number on public.v_ecoflow_order_operations_v3(invoice_number);

insert into public.v_ecoflow_order_operations_v3
select 'order-'||g,'ORD-'||lpad(g::text,6,'0'),'INV-'||lpad(g::text,6,'0'),
       case when g%97=0 then 'HOLD_PAYMENT_REVIEW' else 'READY' end,'READY'
from generate_series(1,60000) g;

insert into public.v_ecoflow_order_financial_truth_v1
select 'store-'||(g%2500),'Scale Store '||(g%2500),'order-'||g,
       'ORD-'||lpad(g::text,6,'0'),'INV-'||lpad(g::text,6,'0'),
       now()-((g%90)||' days')::interval,now(),
       now()+(((g%45)-20)||' days')::interval,100+(g%900),
       case when g%11=0 then 'paid' else 'unpaid' end,
       case when g%11=0 then 0 else 100+(g%900) end,'confirmed'
from generate_series(1,60000) g;

insert into public.v_ecoflow_order_operations_v3 values
  ('legacy-source-order','LEGACY-ORDER','LEGACY-INV','HOLD_PAYMENT_REVIEW','READY'),
  ('legacy-invoice-source','OTHER-ORDER','LEGACY-INVOICE-ONLY','READY','STAGED');

insert into public.v_ecoflow_order_financial_truth_v1 values
  ('legacy-store-order','Legacy Order Store',null,'LEGACY-ORDER','LEGACY-INV',now()-interval '40 days',now(),now()-interval '10 days',250,'unpaid',250,'confirmed'),
  ('legacy-store-invoice','Legacy Invoice Store',null,null,'LEGACY-INVOICE-ONLY',now()-interval '10 days',now(),now()+interval '4 days',175,'unpaid',175,'confirmed');

analyze public.v_ecoflow_order_financial_truth_v1;
analyze public.v_ecoflow_order_operations_v3;
