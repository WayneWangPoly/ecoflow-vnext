\set ON_ERROR_STOP on

insert into public.skus(id,sku_code) values
  ('10000000-0000-4000-8000-000000000001','EXACT'),
  ('10000000-0000-4000-8000-000000000002','BCB-F-S'),
  ('10000000-0000-4000-8000-000000000003','TWS64ROLL'),
  ('10000000-0000-4000-8000-000000000004','MAP-COLLIDE'),
  ('10000000-0000-4000-8000-000000000005','BAR-COLLIDE'),
  ('10000000-0000-4000-8000-000000000006','RAW-COLLIDE'),
  ('10000000-0000-4000-8000-000000000007','BCB-F-XS'),
  ('10000000-0000-4000-8000-000000000008','BCB-F-L'),
  ('10000000-0000-4000-8000-000000000009','INACTIVE-ONLY'),
  ('10000000-0000-4000-8000-000000000010','ACTIVE-MIX');

insert into public.external_product_mappings(provider,external_product_code,internal_sku_id) values
  ('ORDERMENTUM','EXACT','10000000-0000-4000-8000-000000000001'),
  ('ORDERMENTUM','BCB-F-S','10000000-0000-4000-8000-000000000002'),
  ('ORDERMENTUM','TWS64ROLL','10000000-0000-4000-8000-000000000003'),
  ('ORDERMENTUM','MAP-COLLIDE','10000000-0000-4000-8000-000000000004'),
  ('ORDERMENTUM',' map-collide ','10000000-0000-4000-8000-000000000005'),
  ('ORDERMENTUM','BAR-COLLIDE','10000000-0000-4000-8000-000000000005'),
  ('ORDERMENTUM','RAW-COLLIDE','10000000-0000-4000-8000-000000000006'),
  ('ORDERMENTUM','BCB-F-XS','10000000-0000-4000-8000-000000000007'),
  ('ORDERMENTUM','BCB-F-L','10000000-0000-4000-8000-000000000008'),
  ('ORDERMENTUM','ACTIVE-MIX','10000000-0000-4000-8000-000000000010');

insert into public.external_product_mappings(provider,external_product_code,internal_sku_id,is_active) values
  ('ORDERMENTUM','INACTIVE-ONLY','10000000-0000-4000-8000-000000000009',false),
  ('ORDERMENTUM',' active-mix ','10000000-0000-4000-8000-000000000009',false);

insert into public.ecoflow_sku_barcode_confirmations(provider,external_sku_code,sku_id,warehouse_barcode,status) values
  ('ORDERMENTUM','EXACT','10000000-0000-4000-8000-000000000001','11111111','CONFIRMED'),
  ('ORDERMENTUM','BCB-F-S','10000000-0000-4000-8000-000000000002','22222222','CONFIRMED'),
  ('ORDERMENTUM','TWS64ROLL','10000000-0000-4000-8000-000000000003','33333333','CONFIRMED'),
  ('ORDERMENTUM','BAR-COLLIDE','10000000-0000-4000-8000-000000000005','44444444','CONFIRMED'),
  ('ORDERMENTUM',' bar-collide ','10000000-0000-4000-8000-000000000005','55555555','CONFIRMED'),
  ('ORDERMENTUM','RAW-COLLIDE','10000000-0000-4000-8000-000000000006','66666666','CONFIRMED'),
  ('ORDERMENTUM','BCB-F-XS','10000000-0000-4000-8000-000000000007','77777777','CONFIRMED'),
  ('ORDERMENTUM','BCB-F-L','10000000-0000-4000-8000-000000000008','88888888','CONFIRMED'),
  ('ORDERMENTUM','ACTIVE-MIX','10000000-0000-4000-8000-000000000010','99999999','CONFIRMED');

insert into public.test_ordermentum_inbox(raw_order_id,external_order_id,external_order_number,order_number,invoice_number,payment_status,invoice_payment_status) values
  ('20000000-0000-4000-8000-000000000001','E1','E1','O-EXACT','I-EXACT','Paid','Paid'),
  ('20000000-0000-4000-8000-000000000002','E2','E2','O-SPACE','I-SPACE','Paid','Paid'),
  ('20000000-0000-4000-8000-000000000003','E3','E3','O-CASE','I-CASE','Paid','Paid'),
  ('20000000-0000-4000-8000-000000000004','E4','E4','O-MAP-COLLIDE','I-MAP-COLLIDE','Paid','Paid'),
  ('20000000-0000-4000-8000-000000000005','E5','E5','O-BAR-COLLIDE','I-BAR-COLLIDE','Paid','Paid'),
  ('20000000-0000-4000-8000-000000000006','E6','E6','O-RAW-A','I-RAW-A','Paid','Paid'),
  ('20000000-0000-4000-8000-000000000007','E7','E7','O-RAW-B','I-RAW-B','Paid','Paid'),
  ('20000000-0000-4000-8000-000000000008','E8','E8','O-SPACE-XS','I-SPACE-XS','Paid','Paid'),
  ('20000000-0000-4000-8000-000000000009','E9','E9','O-WAVE2-L','I-WAVE2-L','Paid','Paid'),
  ('20000000-0000-4000-8000-000000000010','E10','E10','O-INACTIVE-ONLY','I-INACTIVE-ONLY','Paid','Paid'),
  ('20000000-0000-4000-8000-000000000011','E11','E11','O-ACTIVE-INACTIVE','I-ACTIVE-INACTIVE','Paid','Paid');

insert into public.test_ordermentum_lines(source_line_id,order_number,invoice_number,external_sku_code,external_product_name) values
  ('L1','O-EXACT','I-EXACT','EXACT','Exact unchanged'),
  ('L2','O-SPACE','I-SPACE',' BCB-F-S','Leading space'),
  ('L3','O-CASE','I-CASE','TWS64Roll','Case drift'),
  ('L4','O-MAP-COLLIDE','I-MAP-COLLIDE','MAP-COLLIDE','Mapping collision'),
  ('L5','O-BAR-COLLIDE','I-BAR-COLLIDE','BAR-COLLIDE','Barcode collision'),
  ('L6','O-RAW-A','I-RAW-A','RAW-COLLIDE','Raw collision A'),
  ('L7','O-RAW-B','I-RAW-B',' raw-collide ','Raw collision B'),
  ('L8','O-SPACE-XS','I-SPACE-XS',' BCB-F-XS','Leading space XS'),
  ('L9','O-WAVE2-L','I-WAVE2-L',' BCB-F-L','Wave 2 leading space'),
  ('L10','O-INACTIVE-ONLY','I-INACTIVE-ONLY','INACTIVE-ONLY','Inactive mapping only'),
  ('L11','O-ACTIVE-INACTIVE','I-ACTIVE-INACTIVE',' active-mix ','Active mapping with inactive canonical variant');

do $$
declare v record;
begin
  if public.ecoflow_canonical_ordermentum_sku_code(' Bcb-f-s ')<>'BCB-F-S'
     or public.ecoflow_canonical_ordermentum_sku_code('   ') is not null then
    raise exception 'canonical comparator is not exact upper/btrim/null semantics';
  end if;

  select * into v from public.v_ecoflow_ordermentum_release_gate_v3 where order_number='O-EXACT';
  if v.internalisation_status<>'READY_TO_INTERNALISE' or v.unmapped_line_count<>0 or v.barcode_blocked_line_count<>0 then
    raise exception 'unchanged exact code regression';
  end if;

  select * into v from public.v_ecoflow_ordermentum_release_gate_v3 where order_number='O-SPACE';
  if v.internalisation_status<>'READY_TO_INTERNALISE' or v.unmapped_line_count<>0 or v.barcode_blocked_line_count<>0 then
    raise exception 'leading-space canonical match failed';
  end if;

  select * into v from public.v_ecoflow_ordermentum_release_gate_v3 where order_number='O-CASE';
  if v.internalisation_status<>'READY_TO_INTERNALISE' or v.unmapped_line_count<>0 or v.barcode_blocked_line_count<>0 then
    raise exception 'case-drift canonical match failed';
  end if;

  if exists(
    select 1 from public.v_ecoflow_ordermentum_release_gate_v3
    where order_number in ('O-SPACE-XS','O-WAVE2-L')
      and (internalisation_status<>'READY_TO_INTERNALISE' or unmapped_line_count<>0 or barcode_blocked_line_count<>0)
  ) then raise exception 'bounded leading-space regression failed'; end if;

  select * into v from public.v_ecoflow_ordermentum_release_gate_v3 where order_number='O-INACTIVE-ONLY';
  if v.internalisation_status<>'BLOCKED_MAPPING' or v.unmapped_line_count<>1 then
    raise exception 'inactive-only mapping incorrectly resolved';
  end if;

  select * into v from public.v_ecoflow_ordermentum_release_gate_v3 where order_number='O-ACTIVE-INACTIVE';
  if v.internalisation_status<>'READY_TO_INTERNALISE' or v.unmapped_line_count<>0 or v.barcode_blocked_line_count<>0 then
    raise exception 'inactive canonical variant blocked the active mapping';
  end if;

  if exists(
    select 1 from public.v_ecoflow_ordermentum_sku_normalization_collisions
    where source_namespace='EXTERNAL_PRODUCT_MAPPING' and normalized_code='ACTIVE-MIX'
  ) then raise exception 'inactive mapping created a false normalized collision'; end if;

  select * into v from public.v_ecoflow_ordermentum_release_gate_v3 where order_number='O-MAP-COLLIDE';
  if v.internalisation_status<>'BLOCKED_MAPPING' or v.unmapped_line_count<>1 then
    raise exception 'normalized mapping collision did not fail closed';
  end if;

  select * into v from public.v_ecoflow_ordermentum_release_gate_v3 where order_number='O-BAR-COLLIDE';
  if v.internalisation_status<>'READY_TO_INTERNALISE' or v.warehouse_gate_status<>'BLOCKED_BARCODE' or v.barcode_blocked_line_count<>1 then
    raise exception 'normalized barcode collision did not fail closed';
  end if;

  if exists(
    select 1 from public.v_ecoflow_ordermentum_release_gate_v3
    where order_number in ('O-RAW-A','O-RAW-B') and internalisation_status<>'BLOCKED_MAPPING'
  ) then raise exception 'normalized raw-line collision did not fail closed'; end if;

  if (select count(*) from public.v_ecoflow_ordermentum_sku_normalization_collisions)<>3
     or not exists(select 1 from public.v_ecoflow_ordermentum_sku_normalization_collisions where source_namespace='EXTERNAL_PRODUCT_MAPPING' and normalized_code='MAP-COLLIDE')
     or not exists(select 1 from public.v_ecoflow_ordermentum_sku_normalization_collisions where source_namespace='BARCODE_CONFIRMATION' and normalized_code='BAR-COLLIDE')
     or not exists(select 1 from public.v_ecoflow_ordermentum_sku_normalization_collisions where source_namespace='RAW_ORDER_LINE' and normalized_code='RAW-COLLIDE') then
    raise exception 'collision evidence view mismatch';
  end if;

  select * into v from public.v_ecoflow_ordermentum_barcode_confirmation_workbench where external_sku_code=' BCB-F-S';
  if v.sku_id<>'10000000-0000-4000-8000-000000000002'::uuid or v.barcode_status<>'CONFIRMED' then
    raise exception 'barcode workbench did not use canonical identity';
  end if;
end $$;

select * from public.ecoflow_internalise_ordermentum_orders(20,false,true);

do $$
begin
  if exists(
    select 1 from public.ecoflow_ordermentum_internal_order_lines
    where external_sku_code in ('EXACT',' BCB-F-S','TWS64Roll',' BCB-F-XS',' BCB-F-L') and internal_sku_id is null
  ) then raise exception 'internalisation lost canonical mapping'; end if;

  if not exists(
    select 1 from public.ecoflow_ordermentum_internal_order_lines
    where external_sku_code=' BCB-F-S' and internal_sku_id='10000000-0000-4000-8000-000000000002'::uuid
  ) then raise exception 'internalisation did not preserve raw code with canonical mapping'; end if;

  if exists(
    select 1 from public.ecoflow_ordermentum_internal_order_lines
    where external_sku_code='BAR-COLLIDE' and barcode_status<>'NEEDS_BARCODE'
  ) then raise exception 'internalisation barcode collision did not fail closed'; end if;

  if exists(
    select 1 from public.ecoflow_ordermentum_internal_orders
    where order_number in ('O-MAP-COLLIDE','O-RAW-A','O-RAW-B','O-INACTIVE-ONLY')
  ) then raise exception 'mapping-collided or inactive-only order was internalised'; end if;

  if not exists(
    select 1 from public.ecoflow_ordermentum_internal_order_lines
    where external_sku_code=' active-mix '
      and internal_sku_id='10000000-0000-4000-8000-000000000010'::uuid
  ) then raise exception 'active mapping did not survive inactive canonical variant'; end if;
end $$;

select 'ORDERMENTUM_SKU_NORMALIZATION_DB_CONTRACT_PASS' as result;
