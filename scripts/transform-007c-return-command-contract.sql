\set ON_ERROR_STOP on

select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
select set_config('app.test_role','WAREHOUSE',false);

-- Every legacy/physical UPDATE must advance the same authoritative revision.
update public.ecoflow_delivery_exceptions
set return_status='RETURNED_TO_WAREHOUSE',warehouse_location='RETURNS-HOLD',
    warehouse_received_at=clock_timestamp(),updated_at=clock_timestamp()
where id='55555555-5555-4555-8555-555555555555';

do $$
declare r record;
begin
  select * into r from public.ecoflow_read_return_state_v1('RET-PHYSICAL');
  if r.revision<>1 or r.return_status<>'RETURNED_TO_WAREHOUSE' or not r.physically_received then
    raise exception '007C physical mutation did not advance authoritative revision';
  end if;
end
$$;

-- Business role is enforced independently of SQL function EXECUTE privilege.
select set_config('app.test_role','ACCOUNT',false);
do $$
declare v_denied boolean:=false;
begin
  begin
    perform * from public.ecoflow_read_return_state_v1('RET-RESTOCK');
  exception when sqlstate '42501' then
    if sqlerrm='RETURN_COMMAND_ROLE_FORBIDDEN' then v_denied:=true; else raise; end if;
  end;
  if not v_denied then raise exception '007C ACCOUNT role was not denied'; end if;
end
$$;
select set_config('app.test_role','WAREHOUSE',false);

-- Missing physical receipt must fail closed.
do $$
declare v_denied boolean:=false;
begin
  begin
    perform * from public.ecoflow_record_return_disposition_v1(
      'RET-DRIVER','DISPOSE',null,1,null,'Unreceived item',0,
      '70000000-0000-4000-8000-000000000001','fixture-device',
      'Cannot inspect before receipt',jsonb_build_object('photo','driver.jpg')
    );
  exception when others then
    if sqlerrm='RETURN_DISPOSITION_PHYSICAL_RECEIPT_REQUIRED' then v_denied:=true; else raise; end if;
  end;
  if not v_denied then raise exception '007C allowed disposition before physical receipt'; end if;
end
$$;

-- Mandatory evidence/note and RESTOCK barcode/location are hard requirements.
do $$
declare v_ok boolean;
begin
  v_ok:=false;
  begin
    perform * from public.ecoflow_record_return_disposition_v1(
      'RET-VALIDATE','RESTOCK',null,1,'A1',null,0,
      '70000000-0000-4000-8000-000000000002','fixture-device','Missing barcode',
      jsonb_build_object('photo','x.jpg')
    );
  exception when others then v_ok:=(sqlerrm='RETURN_RESTOCK_BARCODE_REQUIRED'); end;
  if not v_ok then raise exception '007C RESTOCK barcode requirement missing'; end if;

  v_ok:=false;
  begin
    perform * from public.ecoflow_record_return_disposition_v1(
      'RET-VALIDATE','RESTOCK','BC-RESTOCK',1,null,null,0,
      '70000000-0000-4000-8000-000000000003','fixture-device','Missing location',
      jsonb_build_object('photo','x.jpg')
    );
  exception when others then v_ok:=(sqlerrm='RETURN_RESTOCK_LOCATION_REQUIRED'); end;
  if not v_ok then raise exception '007C RESTOCK location requirement missing'; end if;

  v_ok:=false;
  begin
    perform * from public.ecoflow_record_return_disposition_v1(
      'RET-VALIDATE','DISPOSE',null,1,null,'Damaged item',0,
      '70000000-0000-4000-8000-000000000004','fixture-device','Has note','{}'::jsonb
    );
  exception when others then v_ok:=(sqlerrm='RETURN_COMMAND_EVIDENCE_REQUIRED'); end;
  if not v_ok then raise exception '007C structured evidence requirement missing'; end if;

  v_ok:=false;
  begin
    perform * from public.ecoflow_record_return_disposition_v1(
      'RET-VALIDATE','RESTOCK','BC-RESTOCK',1,'BLOCKED-1',null,0,
      '70000000-0000-4000-8000-000000000005','fixture-device','Inactive location',
      jsonb_build_object('photo','x.jpg')
    );
  exception when others then v_ok:=(sqlerrm='RETURN_RESTOCK_LOCATION_INVALID'); end;
  if not v_ok then raise exception '007C accepted inactive warehouse location'; end if;
end
$$;

-- RESTOCK applies once, creates exactly one governed movement, and advances CAS.
do $$
declare r record;
begin
  select * into r from public.ecoflow_record_return_disposition_v1(
    'RET-RESTOCK','RESTOCK','BC-RESTOCK',2,'A1',null,0,
    'aaaaaaaa-0000-4000-8000-000000000001','warehouse-scanner-1',
    'Two cartons inspected and fit for sale',
    jsonb_build_object('photos',jsonb_build_array('restock-1.jpg'),'condition','sellable')
  );
  if not r.accepted or r.replayed or r.status<>'APPLIED' or r.revision<>1
     or r.return_status<>'INSPECTION_HOLD' or r.inventory_movement_id is null
     or r.inspection_line_id is null or r.inventory_consequence_status<>'EXPLICIT' then
    raise exception '007C RESTOCK apply contract failed';
  end if;
end
$$;

do $$
declare v_movement uuid; v_line uuid;
begin
  select c.inventory_movement_id,c.inspection_line_id into v_movement,v_line
  from public.ecoflow_return_commands c
  where c.command_id='aaaaaaaa-0000-4000-8000-000000000001';

  if not exists(
    select 1 from public.ecoflow_inventory_movements m
    where m.id=v_movement and m.movement_type='RETURN_IN'
      and m.quantity=20 and m.to_location='A1'
      and m.reference_type='DELIVERY_RETURN'
      and m.reference_id='22222222-2222-4222-8222-222222222222'
      and m.source='RETURN_INSPECTION_007C'
  ) then raise exception '007C RESTOCK movement binding incorrect'; end if;

  if not exists(
    select 1 from public.ecoflow_delivery_return_inspection_lines l
    where l.id=v_line and l.resolution='RESTOCK' and l.sku='SKU-RESTOCK'
      and l.qty_packages=2 and l.units_per_package=10 and l.units_processed=20
      and l.target_location='A1' and l.movement_id=v_movement
      and l.inspected_by='WAREHOUSE:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ) then raise exception '007C RESTOCK inspection line incorrect'; end if;
end
$$;

-- Exact replay returns the stored result and creates no duplicate line/movement.
do $$
declare r record; v_lines bigint; v_moves bigint; v_cmds bigint;
begin
  select * into r from public.ecoflow_record_return_disposition_v1(
    'RET-RESTOCK','RESTOCK','BC-RESTOCK',2,'A1',null,0,
    'aaaaaaaa-0000-4000-8000-000000000001','warehouse-scanner-1',
    'Two cartons inspected and fit for sale',
    jsonb_build_object('photos',jsonb_build_array('restock-1.jpg'),'condition','sellable')
  );
  if not r.accepted or not r.replayed or r.status<>'REPLAYED' or r.revision<>1 then
    raise exception '007C exact disposition replay failed';
  end if;
  select count(*) into v_lines from public.ecoflow_delivery_return_inspection_lines
    where exception_id='22222222-2222-4222-8222-222222222222';
  select count(*) into v_moves from public.ecoflow_inventory_movements
    where reference_id='22222222-2222-4222-8222-222222222222';
  select count(*) into v_cmds from public.ecoflow_return_commands
    where exception_id='22222222-2222-4222-8222-222222222222';
  if v_lines<>1 or v_moves<>1 or v_cmds<>1 then raise exception '007C replay duplicated durable effects'; end if;
end
$$;

-- Same command id with changed intent is rejected.
do $$
declare v_denied boolean:=false;
begin
  begin
    perform * from public.ecoflow_record_return_disposition_v1(
      'RET-RESTOCK','RESTOCK','BC-RESTOCK',2,'A1',null,0,
      'aaaaaaaa-0000-4000-8000-000000000001','warehouse-scanner-1',
      'Changed note must not replay',jsonb_build_object('photos',jsonb_build_array('restock-1.jpg'),'condition','sellable')
    );
  exception when others then
    if sqlerrm='RETURN_COMMAND_IDEMPOTENCY_CONFLICT' then v_denied:=true; else raise; end if;
  end;
  if not v_denied then raise exception '007C reused command id with changed intent'; end if;
end
$$;

-- Different command with stale revision returns explicit conflict and no writes.
do $$
declare r record; v_lines bigint; v_moves bigint;
begin
  select * into r from public.ecoflow_record_return_disposition_v1(
    'RET-RESTOCK','SUPPLIER_CLAIM',null,1,null,'One carton',0,
    'eeeeeeee-0000-4000-8000-000000000001','warehouse-scanner-1',
    'Stale command',jsonb_build_object('claim','CLM-1')
  );
  if r.accepted or r.status<>'CONFLICT' or r.revision<>1 then raise exception '007C stale revision did not conflict'; end if;
  select count(*) into v_lines from public.ecoflow_delivery_return_inspection_lines
    where exception_id='22222222-2222-4222-8222-222222222222';
  select count(*) into v_moves from public.ecoflow_inventory_movements
    where reference_id='22222222-2222-4222-8222-222222222222';
  if v_lines<>1 or v_moves<>1 then raise exception '007C conflict wrote durable effects'; end if;
end
$$;

-- Closing the valid restock case derives terminal state, bumps revision once,
-- appends one scan, and exact replay never duplicates closure evidence.
do $$
declare r record;
begin
  select * into r from public.ecoflow_close_return_v1(
    'RET-RESTOCK',1,'bbbbbbbb-0000-4000-8000-000000000001',
    'warehouse-scanner-1','Inspection complete',
    jsonb_build_object('signedOff',true,'photo','closed-restock.jpg')
  );
  if not r.accepted or r.replayed or r.status<>'APPLIED' or r.revision<>2
     or r.return_status<>'RESTOCKED' or r.lifecycle_stage<>'CLOSED'
     or r.inventory_consequence_status<>'EXPLICIT' then
    raise exception '007C restock close failed';
  end if;
end
$$;

do $$
declare r record; v_scans bigint;
begin
  select * into r from public.ecoflow_close_return_v1(
    'RET-RESTOCK',1,'bbbbbbbb-0000-4000-8000-000000000001',
    'warehouse-scanner-1','Inspection complete',
    jsonb_build_object('signedOff',true,'photo','closed-restock.jpg')
  );
  if not r.replayed or r.status<>'REPLAYED' or r.revision<>2 then raise exception '007C close replay failed'; end if;
  select count(*) into v_scans from public.ecoflow_delivery_return_scans
    where exception_id='22222222-2222-4222-8222-222222222222' and scan_action='RESTOCKED';
  if v_scans<>1 then raise exception '007C close replay duplicated scan'; end if;
end
$$;

-- Recovery supports lost acknowledgements without resubmitting a mutation.
do $$
declare r record;
begin
  select * into r from public.ecoflow_recover_return_command_v1('aaaaaaaa-0000-4000-8000-000000000001');
  if not r.replayed or r.status<>'REPLAYED' or r.command_type<>'RECORD_DISPOSITION'
     or r.revision<>1 or r.inventory_movement_id is null then
    raise exception '007C command recovery failed';
  end if;
end
$$;

-- Non-restock consequence is explicit, records no inventory movement, then closes.
do $$
declare r record;
begin
  select * into r from public.ecoflow_record_return_disposition_v1(
    'RET-DISPOSE','DISPOSE',null,1,null,'Crushed contaminated carton',0,
    'cccccccc-0000-4000-8000-000000000001','warehouse-scanner-2',
    'Contaminated; cannot return to sale',
    jsonb_build_object('photo','dispose.jpg','method','waste-bin')
  );
  if not r.accepted or r.revision<>1 or r.inventory_movement_id is not null
     or r.inventory_consequence_status<>'EXPLICIT' then
    raise exception '007C explicit dispose consequence failed';
  end if;
  if exists(select 1 from public.ecoflow_inventory_movements m
    where m.reference_id='33333333-3333-4333-8333-333333333333') then
    raise exception '007C dispose fabricated inventory movement';
  end if;

  select * into r from public.ecoflow_close_return_v1(
    'RET-DISPOSE',1,'dddddddd-0000-4000-8000-000000000001',
    'warehouse-scanner-2','Disposal verified',
    jsonb_build_object('signedOff',true,'photo','disposed-final.jpg')
  );
  if not r.accepted or r.return_status<>'DISPOSED' or r.revision<>2 then
    raise exception '007C dispose close failed';
  end if;
end
$$;

-- Close cannot skip disposition/consequence.
do $$
declare v_denied boolean:=false;
begin
  begin
    perform * from public.ecoflow_close_return_v1(
      'RET-EMPTY',0,'f0000000-0000-4000-8000-000000000001','warehouse-scanner-3',
      'Attempted empty close',jsonb_build_object('signedOff',true)
    );
  exception when others then
    if sqlerrm='RETURN_CLOSE_DISPOSITION_REQUIRED' then v_denied:=true; else raise; end if;
  end;
  if not v_denied then raise exception '007C closed return without disposition'; end if;
end
$$;

-- Audit rows contain structured authority/evidence and are immutable.
do $$
declare c public.ecoflow_return_commands%rowtype; v_blocked boolean:=false;
begin
  select * into c from public.ecoflow_return_commands
  where command_id='aaaaaaaa-0000-4000-8000-000000000001';
  if c.actor_user_id<>'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     or c.actor_role<>'WAREHOUSE' or c.device_id<>'warehouse-scanner-1'
     or c.expected_revision<>0 or c.result_revision<>1
     or c.before_state->>'revision'<>'0' or c.after_state->>'revision'<>'1'
     or c.inventory_movement_id is null then
    raise exception '007C audit authority/before-after incomplete';
  end if;

  begin
    update public.ecoflow_return_commands set note='tampered'
    where command_id=c.command_id;
  exception when others then
    if sqlerrm='RETURN_COMMAND_AUDIT_APPEND_ONLY' then v_blocked:=true; else raise; end if;
  end;
  if not v_blocked then raise exception '007C append-only audit allowed update'; end if;
end
$$;

-- Legacy inspection/close bypass and direct table mutation are closed.
do $$
declare v_rel text; v_priv text;
begin
  if has_function_privilege('authenticated',
      'public.ecoflow_record_return_inspection_item(uuid,text,text,numeric,text,text,text,text)','EXECUTE')
     or has_function_privilege('authenticated',
      'public.ecoflow_complete_return_inspection(uuid,text,text)','EXECUTE') then
    raise exception '007C legacy inspection RPC bypass remains executable';
  end if;

  foreach v_rel in array array[
    'public.ecoflow_delivery_exceptions',
    'public.ecoflow_delivery_return_inspection_lines',
    'public.ecoflow_return_commands'
  ] loop
    foreach v_priv in array array['INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','MAINTAIN'] loop
      if has_table_privilege('authenticated',v_rel,v_priv) then
        raise exception '007C authenticated retained % on %',v_priv,v_rel;
      end if;
    end loop;
  end loop;

  if not has_function_privilege('authenticated','public.ecoflow_read_return_state_v1(text)','EXECUTE')
     or not has_function_privilege('authenticated',
       'public.ecoflow_record_return_disposition_v1(text,text,text,numeric,text,text,bigint,uuid,text,text,jsonb)','EXECUTE')
     or not has_function_privilege('authenticated','public.ecoflow_close_return_v1(text,bigint,uuid,text,text,jsonb)','EXECUTE') then
    raise exception '007C authoritative RPC execute grant missing';
  end if;
end
$$;

select 'TRANSFORM-007C return command contract: PASS' as result;
