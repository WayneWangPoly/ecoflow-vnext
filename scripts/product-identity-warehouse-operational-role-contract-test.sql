\set ON_ERROR_STOP on

-- Canonicalization must not broaden warehouse write access. DRIVER can use
-- delivery operations elsewhere, but cannot mutate warehouse identity/count/
-- receiving/pick/return-restock state through these RPCs.
set app.test_role='DRIVER';

do $verify$
declare
  v_stocktake_denied boolean:=false;
  v_receiving_denied boolean:=false;
  v_pick_denied boolean:=false;
  v_return_denied boolean:=false;
  v_quarantine_denied boolean:=false;
begin
  begin
    perform * from public.ecoflow_record_barcode_scan(
      null,'CUP-12W','NO-SUCH-BARCODE','CARTON',1,null,'A1',1,'MAP_AND_COUNT','driver must not count'
    );
  exception when sqlstate '42501' then v_stocktake_denied:=true;
  end;

  begin
    perform * from public.ecoflow_stage_receiving_scan_v2(
      null,'NO-SUCH-BARCODE',1,'A1','driver must not receive','driver:receive',now()
    );
  exception when sqlstate '42501' then v_receiving_denied:=true;
  end;

  begin
    perform * from public.ecoflow_record_pick_movement(
      'CUP-12W',1,'carton','NO-SUCH-BARCODE','driver must not pick'
    );
  exception when sqlstate '42501' then v_pick_denied:=true;
  end;

  begin
    perform * from public.ecoflow_record_return_inspection_item(
      'bbbbbbbb-0000-4000-8000-000000000099'::uuid,'RESTOCK','NO-SUCH-BARCODE',1,'A1',null,'driver must not restock','Driver'
    );
  exception when sqlstate '42501' then v_return_denied:=true;
  end;

  begin
    perform * from public.ecoflow_stage_unknown_barcode_intake(
      'bbbbbbbb-0000-4000-8000-000000000098'::uuid,'NO-SUCH-BARCODE',1,'driver must not quarantine','driver:unknown',now()
    );
  exception when sqlstate '42501' then v_quarantine_denied:=true;
  end;

  if not v_stocktake_denied then raise exception 'DRIVER gained Stocktake write access'; end if;
  if not v_receiving_denied then raise exception 'DRIVER gained Receiving write access'; end if;
  if not v_pick_denied then raise exception 'DRIVER gained Pick write access'; end if;
  if not v_return_denied then raise exception 'DRIVER gained Return restock access'; end if;
  if not v_quarantine_denied then raise exception 'DRIVER gained unknown quarantine write access'; end if;
end;
$verify$;

reset app.test_role;