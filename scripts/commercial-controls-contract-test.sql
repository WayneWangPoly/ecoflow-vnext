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
insert into public.fixture_store_performance values
 ('STORE-1','Cafe One','Adelaide','1 King St','0400000000','TIER2',8,1200,'CUP-12W','12oz White Cup');
insert into public.fixture_accounts_lines values
 ('STORE-1','Cafe One','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1','ORD-1','INV-1',now()-interval '40 days',now()-interval '20 days',100,40,20,'OVERDUE','OPEN','RELEASED','READY','OVERDUE'),
 ('STORE-1','Cafe One','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2','ORD-2','INV-2',now()-interval '10 days',now()+interval '4 days',200,10,0,'OPEN','OPEN','RELEASED','READY','DUE_THIS_WEEK');
insert into public.om_orders(id,order_number,retailer_id,retailer_name) values
 ('ORD-A','1001','STORE-1','Cafe One'),('ORD-B','1002','STORE-2','Cafe Two')
on conflict(id) do nothing;
insert into public.ecoflow_store_sites(store_name,retailer_id,formatted_address,suburb,latitude,longitude) values
 ('Cafe One','STORE-1','1 King St, Adelaide SA','Adelaide',-34.92,138.60),
 ('Cafe Two','STORE-2','2 North Rd, Prospect SA','Prospect',-34.88,138.59)
on conflict(store_name) do update set retailer_id=excluded.retailer_id;

-- Authenticated Owner/Admin cannot create an EcoFlow selling-price truth.
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select set_config('request.jwt.claim.role','authenticated',false);
set role authenticated;

do $$ begin
  begin
    perform public.ecoflow_set_price_matrix_price('CUP-12W','TIER1',9.50,current_date,'Local override');
    raise exception 'local price RPC unexpectedly allowed';
  exception when others then
    if sqlerrm not like '%permission denied%' and sqlerrm not like '%ORDERMENTUM_SOURCE_OWNED%' then raise; end if;
  end;

  begin
    insert into public.ecoflow_price_matrix_versions(
      sku,price_group_id,unit_price,effective_from,version_no,is_current,change_reason
    ) values ('CUP-12W','TIER1',9.50,current_date,1,true,'Local override');
    raise exception 'local price table write unexpectedly allowed';
  exception when others then
    if sqlerrm not like '%permission denied%' and sqlerrm not like '%ORDERMENTUM_SOURCE_OWNED%' then raise; end if;
  end;

  begin
    update public.om_orders set retailer_name='Changed locally' where id='ORD-A';
    raise exception 'Ordermentum order mirror update unexpectedly allowed';
  exception when others then
    if sqlerrm not like '%permission denied%' and sqlerrm not like '%ORDERMENTUM_SOURCE_OWNED%' then raise; end if;
  end;

  begin
    update public.ecoflow_store_sites set formatted_address='Changed locally' where retailer_id='STORE-1';
    raise exception 'Ordermentum store source field update unexpectedly allowed';
  exception when others then
    if sqlerrm not like '%ORDERMENTUM_SOURCE_OWNED%' and sqlerrm not like '%permission denied%' then raise; end if;
  end;
end $$;

-- The read-only price surface must ignore retired EcoFlow overrides.
do $$ begin
  if (select effective_price from public.v_ecoflow_ordermentum_price_matrix_readonly_v1 where sku='CUP-12W' and price_group_id='TIER1')<>10 then
    raise exception 'read-only Ordermentum price mirror is not using source price';
  end if;
  if exists(select 1 from public.v_ecoflow_ordermentum_price_matrix_readonly_v1 where has_override) then
    raise exception 'read-only price mirror exposed a local override';
  end if;
end $$;

reset role;

-- Accounts may create statement documents and workflow notes, but cannot record
-- substitute payments or alter the mirrored invoice truth.
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select set_config('request.jwt.claim.role','authenticated',false);
set role authenticated;

select * from public.ecoflow_upsert_billing_contact('STORE-1','Cafe One','accounts@cafe.test','Sam',true);
select * from public.ecoflow_create_statement_document('STORE-1',(current_date-interval '1 month')::date,current_date);
select * from public.ecoflow_record_accounts_statement_action('STORE-1','PROMISE_TO_PAY','Customer will pay Friday',null);

do $$ begin
  if (select count(*) from public.ecoflow_statement_documents where store_id='STORE-1')<>1 then raise exception 'statement snapshot missing'; end if;
  if (select count(*) from public.ecoflow_statement_document_lines where store_id='STORE-1')<>2 then raise exception 'statement lines missing'; end if;
  if (select closing_balance from public.ecoflow_statement_documents where store_id='STORE-1')<>300 then raise exception 'statement balance incorrect'; end if;
  if not exists(select 1 from public.ecoflow_accounts_statement_actions where store_id='STORE-1' and action='PROMISE_TO_PAY') then raise exception 'EcoFlow collection workflow write missing'; end if;

  begin
    perform public.ecoflow_record_customer_payment('STORE-1','Cafe One',150,current_date,'BANK_TRANSFER','PAY-001','Substitute payment');
    raise exception 'local payment RPC unexpectedly allowed';
  exception when others then
    if sqlerrm not like '%permission denied%' and sqlerrm not like '%ORDERMENTUM_SOURCE_OWNED%' then raise; end if;
  end;

  if (select open_ar_value from public.v_ecoflow_accounts_live_ar_kpis)<>300 then
    raise exception 'AR changed without an Ordermentum payment';
  end if;
end $$;

reset role;

-- Data ownership is explicit and source disappearance is retained, not deleted.
do $$ begin
  if (select authoritative_system from public.v_ecoflow_data_ownership_contract_v1 where domain='INVOICES_PAYMENTS')<>'ORDERMENTUM' then
    raise exception 'finance ownership contract incorrect';
  end if;
  if (select authoritative_system from public.v_ecoflow_data_ownership_contract_v1 where domain='WAREHOUSE_STOCK')<>'ECOFLOW' then
    raise exception 'warehouse ownership contract incorrect';
  end if;
end $$;

insert into public.ecoflow_ordermentum_source_presence(
  domain,external_id,source_status,source_reference,last_seen_at,missing_since,last_full_mirror_at
) values ('ORDER','ORD-MISSING','SOURCE_MISSING','OMO-MISSING',now()-interval '2 days',now(),now());

-- EcoFlow operational run history remains writable and auditable.
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

do $$ begin
  if (select count(*) from public.v_ecoflow_delivery_run_catalog where business_day='2026-07-11')<>2 then raise exception 'Run A/B catalog separation failed'; end if;
  if (select run_status from public.v_ecoflow_delivery_run_catalog where business_day='2026-07-11' and run_code='A')<>'COMPLETED' then raise exception 'Run A status incorrect'; end if;
  if (select run_status from public.v_ecoflow_delivery_run_catalog where business_day='2026-07-11' and run_code='B')<>'IN_PROGRESS' then raise exception 'Run B status incorrect'; end if;
  if (select count(*) from public.v_ecoflow_delivery_run_stop_history where business_day='2026-07-11')<>2 then raise exception 'run stop history missing'; end if;
  if (select public from storage.buckets where id='account-statements') then raise exception 'statement bucket must be private'; end if;
end $$;

select 'commercial source boundary contract passed' as result;
