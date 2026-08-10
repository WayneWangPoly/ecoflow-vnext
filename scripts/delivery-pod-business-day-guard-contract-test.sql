\set ON_ERROR_STOP on

-- Simulate malformed historical evidence inserted by privileged maintenance or an
-- older importer. Assignment-aware browser reads must not throw on the bad text.
insert into public.ecoflow_delivery_pod_proofs(
  business_day,order_id,order_number,stop_number,box_code,store_name,
  proof_type,photo_path,captured_by
) values(
  'not-a-date','legacy-bad-order','LEGACY',99,'Z','Legacy malformed row',
  'POD2_GOODS_PLACED','not-a-date/legacy-bad-order/evidence.jpg','fixture'
)
on conflict(business_day,order_id,proof_type) do nothing;

set role authenticated;
set app.test_role='DRIVER';
set app.test_user_id='11111111-1111-4111-8111-111111111111';

do $verify$
declare
  v_count integer;
  v_denied boolean:=false;
begin
  -- This SELECT used to risk evaluating business_day::date on malformed text.
  select count(*) into v_count
  from public.ecoflow_delivery_pod_proofs
  where order_id='legacy-bad-order';
  if v_count<>0 then raise exception 'malformed legacy POD row became Driver-readable'; end if;

  if public.ecoflow_delivery_resource_read_allowed_text('not-a-date','legacy-bad-order') then
    raise exception 'parse-safe read helper accepted malformed date';
  end if;
  if public.ecoflow_delivery_resource_write_allowed_text('2026-99-99','legacy-bad-order') then
    raise exception 'parse-safe write helper accepted impossible date';
  end if;

  begin
    insert into public.ecoflow_delivery_pod_proofs(
      business_day,order_id,proof_type,photo_path
    ) values('bad-date','order-d','POD1_DROP_POINT','bad-date/order-d/blocked.jpg');
  exception when sqlstate '42501' then
    v_denied:=true;
  end;
  if not v_denied then raise exception 'Driver inserted malformed-date POD row'; end if;
end;
$verify$;

reset role;
reset app.test_role;
reset app.test_user_id;
