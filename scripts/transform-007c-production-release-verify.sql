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

create temp table transform_007c_smoke_results(
  disp_accepted boolean not null,
  disp_replayed boolean not null,
  disp_status text not null,
  disp_revision bigint not null,
  disp_inspection_line_id uuid not null,
  disp_inventory_movement_id uuid not null,
  disp_inventory_consequence_status text not null,
  replay_accepted boolean not null,
  replay_replayed boolean not null,
  replay_status text not null,
  replay_revision bigint not null,
  stale_accepted boolean not null,
  stale_status text not null,
  stale_revision bigint not null,
  close_accepted boolean not null,
  close_replayed boolean not null,
  close_status text not null,
  close_revision bigint not null,
  close_return_status text not null,
  close_lifecycle_stage text not null,
  close_inventory_consequence_status text not null
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
begin
  begin
    perform * from public.ecoflow_read_return_state_v1('TRANSFORM-007C-NO-SUCH-RETURN');
  exception when sqlstate '42501' then
    if sqlerrm='RETURN_COMMAND_ROLE_FORBIDDEN' then v_denied:=true; else raise; end if;
  end;
  if not v_denied then raise exception '007C_RELEASE_VERIFY_FORBIDDEN_ROLE_NOT_DENIED'; end if;
end
$$;
reset role;

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

insert into transform_007c_smoke_results values(
  :'disp_accepted'::boolean,:'disp_replayed'::boolean,:'disp_status',
  :'disp_revision'::bigint,:'disp_inspection_line_id'::uuid,
  :'disp_inventory_movement_id'::uuid,:'disp_inventory_consequence_status',
  :'replay_accepted'::boolean,:'replay_replayed'::boolean,:'replay_status',
  :'replay_revision'::bigint,
  :'stale_accepted'::boolean,:'stale_status',:'stale_revision'::bigint,
  :'close_accepted'::boolean,:'close_replayed'::boolean,:'close_status',
  :'close_revision'::bigint,:'close_return_status',:'close_lifecycle_stage',
  :'close_inventory_consequence_status'
);

-- Validate all durable effects before rollback while still using the privileged
-- release-verification connection for catalog/ledger evidence.
do $$
declare
  v_exception uuid:=:'verify_exception_id'::uuid;
  r transform_007c_smoke_results%rowtype;
  v_line_count bigint;
  v_move_count bigint;
  v_command_count bigint;
  v_scan_count bigint;
  v_movement public.ecoflow_inventory_movements%rowtype;
  v_line public.ecoflow_delivery_return_inspection_lines%rowtype;
begin
  select * into r from transform_007c_smoke_results limit 1;

  if r.disp_accepted is not true
     or r.disp_replayed is not false
     or r.disp_status<>'APPLIED'
     or r.disp_revision<>:'initial_revision'::bigint+1
     or r.disp_inventory_movement_id is null
     or r.disp_inventory_consequence_status<>'EXPLICIT' then
    raise exception '007C_RELEASE_VERIFY_DISPOSITION_RESULT_INVALID';
  end if;

  if r.replay_accepted is not true
     or r.replay_replayed is not true
     or r.replay_status<>'REPLAYED'
     or r.replay_revision<>r.disp_revision then
    raise exception '007C_RELEASE_VERIFY_REPLAY_INVALID';
  end if;

  if r.stale_accepted is not false
     or r.stale_status<>'CONFLICT'
     or r.stale_revision<>r.disp_revision then
    raise exception '007C_RELEASE_VERIFY_STALE_CONFLICT_INVALID';
  end if;

  if r.close_accepted is not true
     or r.close_replayed is not false
     or r.close_status<>'APPLIED'
     or r.close_revision<>r.disp_revision+1
     or r.close_return_status<>'RESTOCKED'
     or r.close_lifecycle_stage<>'CLOSED'
     or r.close_inventory_consequence_status<>'EXPLICIT' then
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
  where m.id=r.disp_inventory_movement_id;
  select * into v_line from public.ecoflow_delivery_return_inspection_lines l
  where l.id=r.disp_inspection_line_id;

  if v_movement.id is null
     or v_movement.movement_type<>'RETURN_IN'
     or v_movement.reference_type<>'DELIVERY_RETURN'
     or v_movement.reference_id<>v_exception::text
     or v_movement.to_location<>:'verify_location'
     or v_line.movement_id<>v_movement.id
     or v_line.resolution<>'RESTOCK'
     or v_line.units_processed<>v_movement.quantity then
    raise exception '007C_RELEASE_VERIFY_RESTOCK_MOVEMENT_BINDING_INVALID';
  end if;
end
$$;

rollback;

-- Nothing synthetic may survive the release smoke.
select (
  (select count(*) from public.ecoflow_delivery_exceptions e where e.id=:'verify_exception_id'::uuid)
  +(select count(*) from public.ecoflow_delivery_return_inspection_lines l where l.exception_id=:'verify_exception_id'::uuid)
  +(select count(*) from public.ecoflow_inventory_movements m where m.reference_type='DELIVERY_RETURN' and m.reference_id=:'verify_exception_id')
  +(select count(*) from public.ecoflow_return_commands c where c.exception_id=:'verify_exception_id'::uuid)
  +(select count(*) from public.ecoflow_delivery_return_scans s where s.exception_id=:'verify_exception_id'::uuid)
)::bigint as rollback_rows
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
