\set ON_ERROR_STOP on
\set QUIET 1

-- TRANSFORM-007C main-only production release verification.
-- All synthetic return state, inspection lines, inventory movement, command
-- audit and close scan live in this transaction and are rolled back together.

begin;
set local statement_timeout='8000ms';

create temp table transform_007c_release_actors(
  app_role text not null,
  user_id uuid not null
) on commit drop;

do $$
declare
  v_user_id uuid;
  v_role text;
begin
  for v_user_id in select id from auth.users order by created_at nulls last,id loop
    perform set_config('request.jwt.claim.sub',v_user_id::text,true);
    perform set_config('request.jwt.claim.role','authenticated',true);
    begin
      v_role:=public.ecoflow_active_app_role();
    exception when others then
      v_role:=null;
    end;
    if v_role in('OWNER','ADMIN','WAREHOUSE','VIEWER','ACCOUNT') then
      insert into transform_007c_release_actors(app_role,user_id)
      values(v_role,v_user_id);
    end if;
  end loop;

  if not exists(
    select 1 from transform_007c_release_actors
    where app_role in('OWNER','ADMIN','WAREHOUSE')
  ) then
    raise exception '007C_RELEASE_VERIFY_AUTHORISED_ACTOR_MISSING';
  end if;
  if not exists(
    select 1 from transform_007c_release_actors
    where app_role in('VIEWER','ACCOUNT')
  ) then
    raise exception '007C_RELEASE_VERIFY_FORBIDDEN_ACTOR_MISSING';
  end if;
end
$$;

select user_id as authorised_id
from transform_007c_release_actors
where app_role in('OWNER','ADMIN','WAREHOUSE')
order by case app_role when 'OWNER' then 1 when 'ADMIN' then 2 else 3 end,user_id
limit 1
\gset

select user_id as forbidden_id
from transform_007c_release_actors
where app_role in('VIEWER','ACCOUNT')
order by case app_role when 'VIEWER' then 1 else 2 end,user_id
limit 1
\gset

select r.barcode as verify_barcode
from public.ecoflow_sku_barcode_registry r
where r.is_active
  and nullif(btrim(coalesce(r.barcode,'')),'') is not null
  and nullif(btrim(coalesce(r.sku,'')),'') is not null
  and coalesce(r.units_per_barcode,0)>0
order by r.last_scanned_at desc nulls last,r.id
limit 1
\gset

select l.location_code as verify_location
from public.ecoflow_warehouse_locations l
where l.status='ACTIVE'
  and nullif(btrim(coalesce(l.location_code,'')),'') is not null
order by l.sort_order nulls last,l.location_code
limit 1
\gset

\if :{?verify_barcode}
\else
  \quit 1
\endif
\if :{?verify_location}
\else
  \quit 1
\endif

select gen_random_uuid()::text as verify_exception_id \gset
select ('RET-007C-'||replace(:'verify_exception_id','-','')) as verify_return_code \gset

insert into public.ecoflow_delivery_exceptions(
  id,business_day,order_id,order_number,store_name,outcome,
  expected_cartons,delivered_cartons,return_cartons,
  reason,driver_note,return_code,return_status,warehouse_location,
  recorded_by,recorded_at,warehouse_received_by,warehouse_received_at,updated_at
) values(
  :'verify_exception_id'::uuid,to_char(current_date,'YYYY-MM-DD'),
  'TRANSFORM-007C-RELEASE-VERIFY',
  'TRANSFORM-007C-RELEASE-VERIFY',
  'TRANSFORM-007C synthetic rollback case','DAMAGED',
  1,0,1,
  'Rollback-only production release verification',
  'Synthetic case; transaction must roll back',
  :'verify_return_code','RETURNED_TO_WAREHOUSE',:'verify_location',
  'TRANSFORM-007C-RELEASE-VERIFY',clock_timestamp(),
  'TRANSFORM-007C-RELEASE-VERIFY',clock_timestamp(),clock_timestamp()
);

-- Direct browser mutation and retired legacy inspection/close entry points must
-- already be denied before any command smoke is attempted.
do $$
declare
  v_role text;
  v_rel text;
  v_priv text;
begin
  foreach v_role in array array['anon','authenticated'] loop
    foreach v_rel in array array[
      'public.ecoflow_delivery_exceptions',
      'public.ecoflow_delivery_return_inspection_lines',
      'public.ecoflow_return_commands'
    ] loop
      foreach v_priv in array array['INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','MAINTAIN'] loop
        if has_table_privilege(v_role,v_rel,v_priv) then
          raise exception '007C_RELEASE_VERIFY_DIRECT_DML_OPEN:%:%:%',v_role,v_rel,v_priv;
        end if;
      end loop;
    end loop;
  end loop;

  if has_function_privilege('authenticated',
      'public.ecoflow_record_return_inspection_item(uuid,text,text,numeric,text,text,text,text)','EXECUTE')
     or has_function_privilege('authenticated',
      'public.ecoflow_complete_return_inspection(uuid,text,text)','EXECUTE') then
    raise exception '007C_RELEASE_VERIFY_LEGACY_MUTATION_RPC_OPEN';
  end if;
end
$$;

select set_config('request.jwt.claim.role','authenticated',false) as jwt_role_context \gset
select set_config('request.jwt.claim.sub',:'forbidden_id',false) as forbidden_sub_context \gset
set local role authenticated;

do $$
declare
  v_denied boolean:=false;
  v_return_code text:=current_setting('ecoflow.007c.verify_return_code',true);
begin
  -- v_return_code is set immediately below after RESET ROLE; this branch is not
  -- used. Keep the explicit guard here only to prevent accidental unauthorised
  -- reads if the setup order changes.
  begin
    perform * from public.ecoflow_read_return_state_v1('TRANSFORM-007C-NO-SUCH-RETURN');
  exception when sqlstate '42501' then
    if sqlerrm='RETURN_COMMAND_ROLE_FORBIDDEN' then v_denied:=true; else raise; end if;
  end;
  if not v_denied then raise exception '007C_RELEASE_VERIFY_FORBIDDEN_ROLE_NOT_DENIED'; end if;
end
$$;
reset role;

select set_config('ecoflow.007c.verify_exception_id',:'verify_exception_id',false) as exception_context \gset
select set_config('ecoflow.007c.verify_return_code',:'verify_return_code',false) as return_context \gset
select set_config('ecoflow.007c.verify_barcode',:'verify_barcode',false) as barcode_context \gset
select set_config('ecoflow.007c.verify_location',:'verify_location',false) as location_context \gset
select set_config('request.jwt.claim.sub',:'authorised_id',false) as authorised_sub_context \gset
set local role authenticated;

-- Initial state must expose the authoritative revision added by 007C.
select revision as initial_revision,return_status as initial_status
from public.ecoflow_read_return_state_v1(:'verify_return_code')
\gset

\if :{?initial_revision}
\else
  \quit 1
\endif

-- Apply one RESTOCK disposition. This must create the governed RETURN_IN
-- movement and bind it to the durable inspection line and command audit row.
select *
from public.ecoflow_record_return_disposition_v1(
  :'verify_return_code','RESTOCK',:'verify_barcode',1,:'verify_location',null,
  :'initial_revision'::bigint,
  '7007c000-0000-4000-8000-000000000001'::uuid,
  'production-release-rollback',
  'TRANSFORM-007C rollback-only restock verification',
  jsonb_build_object('releaseVerify',true,'evidence','synthetic-rollback')
)
\gset disp_

\if :disp_accepted
\else
  \quit 1
\endif

-- Exact retry must replay and must not create another line or movement.
select *
from public.ecoflow_record_return_disposition_v1(
  :'verify_return_code','RESTOCK',:'verify_barcode',1,:'verify_location',null,
  :'initial_revision'::bigint,
  '7007c000-0000-4000-8000-000000000001'::uuid,
  'production-release-rollback',
  'TRANSFORM-007C rollback-only restock verification',
  jsonb_build_object('releaseVerify',true,'evidence','synthetic-rollback')
)
\gset replay_

-- A different command using stale revision must return CONFLICT without writes.
select *
from public.ecoflow_record_return_disposition_v1(
  :'verify_return_code','DISPOSE',null,1,null,'Synthetic stale item',
  :'initial_revision'::bigint,
  '7007c000-0000-4000-8000-000000000002'::uuid,
  'production-release-rollback',
  'TRANSFORM-007C stale revision verification',
  jsonb_build_object('releaseVerify',true,'evidence','stale-conflict')
)
\gset stale_

-- Close the return from the new revision.
select *
from public.ecoflow_close_return_v1(
  :'verify_return_code',:'disp_revision'::bigint,
  '7007c000-0000-4000-8000-000000000003'::uuid,
  'production-release-rollback',
  'TRANSFORM-007C rollback-only close verification',
  jsonb_build_object('releaseVerify',true,'evidence','close-synthetic')
)
\gset close_

reset role;

-- Validate all durable effects before rollback while still using the privileged
-- release-verification connection for catalog/ledger evidence.
do $$
declare
  v_exception uuid:=current_setting('ecoflow.007c.verify_exception_id')::uuid;
  v_line_count bigint;
  v_move_count bigint;
  v_command_count bigint;
  v_scan_count bigint;
  v_movement public.ecoflow_inventory_movements%rowtype;
  v_line public.ecoflow_delivery_return_inspection_lines%rowtype;
begin
  if :'disp_accepted'::boolean is not true
     or :'disp_replayed'::boolean is not false
     or :'disp_status'<>'APPLIED'
     or :'disp_revision'::bigint<>:'initial_revision'::bigint+1
     or nullif(:'disp_inventory_movement_id','') is null
     or :'disp_inventory_consequence_status'<>'EXPLICIT' then
    raise exception '007C_RELEASE_VERIFY_DISPOSITION_RESULT_INVALID';
  end if;

  if :'replay_accepted'::boolean is not true
     or :'replay_replayed'::boolean is not true
     or :'replay_status'<>'REPLAYED'
     or :'replay_revision'::bigint<>:'disp_revision'::bigint then
    raise exception '007C_RELEASE_VERIFY_REPLAY_INVALID';
  end if;

  if :'stale_accepted'::boolean is not false
     or :'stale_status'<>'CONFLICT'
     or :'stale_revision'::bigint<>:'disp_revision'::bigint then
    raise exception '007C_RELEASE_VERIFY_STALE_CONFLICT_INVALID';
  end if;

  if :'close_accepted'::boolean is not true
     or :'close_replayed'::boolean is not false
     or :'close_status'<>'APPLIED'
     or :'close_revision'::bigint<>:'disp_revision'::bigint+1
     or :'close_return_status'<>'RESTOCKED'
     or :'close_lifecycle_stage'<>'CLOSED'
     or :'close_inventory_consequence_status'<>'EXPLICIT' then
    raise exception '007C_RELEASE_VERIFY_CLOSE_RESULT_INVALID';
  end if;

  select count(*) into v_line_count
  from public.ecoflow_delivery_return_inspection_lines l
  where l.exception_id=v_exception;
  select count(*) into v_move_count
  from public.ecoflow_inventory_movements m
  where m.reference_type='DELIVERY_RETURN' and m.reference_id=v_exception::text;
  select count(*) into v_command_count
  from public.ecoflow_return_commands c where c.exception_id=v_exception;
  select count(*) into v_scan_count
  from public.ecoflow_delivery_return_scans s where s.exception_id=v_exception;

  if v_line_count<>1 or v_move_count<>1 or v_command_count<>2 or v_scan_count<>1 then
    raise exception '007C_RELEASE_VERIFY_DURABLE_EFFECT_COUNTS_INVALID:%/%/%/%',
      v_line_count,v_move_count,v_command_count,v_scan_count;
  end if;

  select * into v_movement from public.ecoflow_inventory_movements m
  where m.id=:'disp_inventory_movement_id'::uuid;
  select * into v_line from public.ecoflow_delivery_return_inspection_lines l
  where l.id=:'disp_inspection_line_id'::uuid;

  if v_movement.id is null
     or v_movement.movement_type<>'RETURN_IN'
     or v_movement.reference_type<>'DELIVERY_RETURN'
     or v_movement.reference_id<>v_exception::text
     or v_movement.to_location<>current_setting('ecoflow.007c.verify_location')
     or v_line.movement_id<>v_movement.id
     or v_line.resolution<>'RESTOCK'
     or v_line.units_processed<>v_movement.quantity then
    raise exception '007C_RELEASE_VERIFY_RESTOCK_MOVEMENT_BINDING_INVALID';
  end if;
end
$$;

rollback;

-- Nothing synthetic may survive the release smoke.
select count(*)::bigint as rollback_rows
from public.ecoflow_delivery_exceptions
where id=:'verify_exception_id'::uuid
\gset

\if :rollback_rows
  \quit 1
\endif

\set QUIET 0
\echo TRANSFORM_007C_PRODUCTION_RELEASE_VERIFY=PASS
\echo SYNTHETIC_RETURN_ROLLBACK=PASS
\echo RETURN_REVISION_CAS=PASS
\echo RETURN_IDEMPOTENT_REPLAY=PASS
\echo RETURN_STALE_CONFLICT=PASS
\echo RETURN_RESTOCK_MOVEMENT_LINK=PASS
\echo RETURN_CLOSE_ROLLBACK=PASS
\echo RETURN_BROWSER_BYPASS=DENIED
