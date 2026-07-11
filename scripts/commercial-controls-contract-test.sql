\set ON_ERROR_STOP on

insert into auth.users(id,email) values
 ('11111111-1111-1111-1111-111111111111','owner@test.local'),
 ('22222222-2222-2222-2222-222222222222','account@test.local')
on conflict(id) do nothing;
insert into public.app_user_profiles(user_id,app_role,is_active,team_status,email) values
 ('11111111-1111-1111-1111-111111111111','OWNER',true,'ACTIVE','owner@test.local'),
 ('22222222-2222-2222-2222-222222222222','ACCOUNT',true,'ACTIVE','account@test.local')
on conflict(user_id) do update set app_role=excluded.app_role,is_active=true,team_status='ACTIVE';

insert into public.fixture_commercial_skus values
 ('variants','CUP-12W','12oz White Cup',10.00,now()),
 ('variants','LID-90','90mm Lid',5.00,now());
insert into public.fixture_commercial_price_groups values
 ('TIER1','Tier 1','largest customers'),('TIER2','Tier 2','large customers'),('TIER3','Tier 3','standard customers'),('TIER4','Tier 4','small customers');

select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select set_config('request.jwt.claim.role','authenticated',false);
set role authenticated;

select * from public.ecoflow_set_price_matrix_price('CUP-12W','TIER1',9.50,current_date,'Initial negotiated price');
select * from public.ecoflow_set_price_matrix_price('CUP-12W','TIER1',9.25,current_date+1,'Annual price review');

do $$ begin
  if (select count(*) from public.ecoflow_price_matrix_versions where sku='CUP-12W' and price_group_id='TIER1')<>2 then raise exception 'price history missing'; end if;
  if (select count(*) from public.ecoflow_price_matrix_versions where sku='CUP-12W' and price_group_id='TIER1' and is_current)<>1 then raise exception 'current price version invalid'; end if;
  if (select unit_price from public.ecoflow_price_matrix_versions where sku='CUP-12W' and price_group_id='TIER1' and is_current)<>9.25 then raise exception 'current price incorrect'; end if;
end $$;

select * from public.ecoflow_bulk_adjust_price_matrix('TIER2',5,current_date,'Tier 2 annual increase',array['CUP-12W','LID-90']);

do $$ begin
  if (select count(*) from public.ecoflow_price_matrix_versions where price_group_id='TIER2' and is_current)<>2 then raise exception 'bulk price adjustment failed'; end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
set role authenticated;
do $$ begin
  begin perform public.ecoflow_set_price_matrix_price('CUP-12W','TIER1',8,current_date,'unauthorised'); raise exception 'account price edit unexpectedly allowed';
  exception when others then if sqlerrm not like '%OWNER_OR_ADMIN_REQUIRED%' then raise; end if; end;
end $$;

reset role;
insert into public.fixture_store_performance values('STORE-1','Cafe One','Adelaide','1 King St','0400000000','TIER2',8,1200,'CUP-12W','12oz White Cup');
insert into public.fixture_accounts_lines values
 ('STORE-1','Cafe One','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1','ORD-1','INV-1',now()-interval '40 days',now()-interval '20 days',100,40,20,'OVERDUE','OPEN','RELEASED','READY','OVERDUE'),
 ('STORE-1','Cafe One','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2','ORD-2','INV-2',now()-interval '10 days',now()+interval '4 days',200,10,0,'OPEN','OPEN','RELEASED','READY','DUE_THIS_WEEK');

select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
set role authenticated;
select * from public.ecoflow_upsert_billing_contact('STORE-1','Cafe One','accounts@cafe.test','Sam',true);
select * from public.ecoflow_create_statement_document('STORE-1',(current_date-interval '1 month')::date,current_date);

do $$ begin
  if (select count(*) from public.ecoflow_statement_documents where store_id='STORE-1')<>1 then raise exception 'statement snapshot missing'; end if;
  if (select count(*) from public.ecoflow_statement_document_lines where store_id='STORE-1')<>2 then raise exception 'statement lines missing'; end if;
  if (select closing_balance from public.ecoflow_statement_documents where store_id='STORE-1')<>300 then raise exception 'statement balance incorrect'; end if;
end $$;

select * from public.ecoflow_record_customer_payment('STORE-1','Cafe One',150,current_date,'BANK_TRANSFER','PAY-001','First payment');
select * from public.ecoflow_record_customer_payment('STORE-1','Cafe One',150,current_date,'BANK_TRANSFER','PAY-001','Retry');

do $$ begin
  if (select count(*) from public.ecoflow_customer_payment_receipts where store_id='STORE-1')<>1 then raise exception 'payment idempotency failed'; end if;
  if (select outstanding_amount from public.v_ecoflow_accounts_live_statement_lines where internal_order_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1')<>0 then raise exception 'oldest invoice not cleared'; end if;
  if (select outstanding_amount from public.v_ecoflow_accounts_live_statement_lines where internal_order_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2')<>150 then raise exception 'second invoice allocation incorrect'; end if;
  if (select open_ar_value from public.v_ecoflow_accounts_live_ar_kpis)<>150 then raise exception 'live AR did not reduce'; end if;
end $$;

reset role;
insert into public.ecoflow_day_state(business_day,scope,payload,updated_by) values
 ('2026-07-11','run:A:release:ORD-A','{"releasedAt":"2026-07-11T08:00:00Z"}','Owner'),
 ('2026-07-11','run:A:meta','{"lockedAt":"2026-07-11T08:05:00Z","stopOrder":["ORD-A"],"boxCodes":{"ORD-A":"A"}}','Owner'),
 ('2026-07-11','run:A:route','{"startedAt":"2026-07-11T08:30:00Z","endedAt":"2026-07-11T10:00:00Z"}','Driver'),
 ('2026-07-11','run:A:stop:ORD-A','{"status":"DELIVERED","arrivedAt":"2026-07-11T09:00:00Z","completedAt":"2026-07-11T09:10:00Z"}','Driver'),
 ('2026-07-11','run:B:release:ORD-B','{"releasedAt":"2026-07-11T11:00:00Z"}','Owner'),
 ('2026-07-11','run:B:meta','{"lockedAt":"2026-07-11T11:05:00Z","stopOrder":["ORD-B"],"boxCodes":{"ORD-B":"A"}}','Owner'),
 ('2026-07-11','run:B:route','{"startedAt":"2026-07-11T11:30:00Z"}','Driver'),
 ('2026-07-11','run:B:stop:ORD-B','{"status":"ARRIVED","arrivedAt":"2026-07-11T12:00:00Z"}','Driver')
on conflict(business_day,scope) do update set payload=excluded.payload,updated_by=excluded.updated_by;
insert into public.om_orders(id,order_number,retailer_id,retailer_name) values('ORD-A','1001','STORE-1','Cafe One'),('ORD-B','1002','STORE-2','Cafe Two') on conflict(id) do nothing;
insert into public.ecoflow_store_sites(store_name,retailer_id,formatted_address,suburb,latitude,longitude) values('Cafe One','STORE-1','1 King St, Adelaide SA','Adelaide',-34.92,138.60),('Cafe Two','STORE-2','2 North Rd, Prospect SA','Prospect',-34.88,138.59) on conflict(store_name) do update set retailer_id=excluded.retailer_id;

do $$ begin
  if (select count(*) from public.v_ecoflow_delivery_run_catalog where business_day='2026-07-11')<>2 then raise exception 'Run A/B catalog separation failed'; end if;
  if (select run_status from public.v_ecoflow_delivery_run_catalog where business_day='2026-07-11' and run_code='A')<>'COMPLETED' then raise exception 'Run A status incorrect'; end if;
  if (select run_status from public.v_ecoflow_delivery_run_catalog where business_day='2026-07-11' and run_code='B')<>'IN_PROGRESS' then raise exception 'Run B status incorrect'; end if;
  if (select count(*) from public.v_ecoflow_delivery_run_stop_history where business_day='2026-07-11')<>2 then raise exception 'run stop history missing'; end if;
  if (select public from storage.buckets where id='account-statements') then raise exception 'statement bucket must be private'; end if;
end $$;

select 'commercial controls contract passed' as result;
