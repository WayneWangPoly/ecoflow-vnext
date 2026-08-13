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

select revision as initial_revision,return_status as initial_status
from public.ecoflow_read_return_state_v1(:'verify_return_code')
\gset

\if :{?initial_revision}
\else
  \quit 1
\endif

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

-- Pure SQL assertion: psql variables remain outside PL/pgSQL dollar quotes.
select (
  r.disp_accepted is true
  and r.disp_replayed is false
  and r.disp_status='APPLIED'
  and r.disp_revision=:'initial_revision'::bigint+1
  and r.disp_inventory_consequence_status='EXPLICIT'
  and r.replay_accepted is true
  and r.replay_replayed is true
  and r.replay_status='REPLAYED'
  and r.replay_revision=r.disp_revision
  and r.stale_accepted is false
  and r.stale_status='CONFLICT'
  and r.stale_revision=r.disp_revision
  and r.close_accepted is true
  and r.close_replayed is false
  and r.close_status='APPLIED'
  and r.close_revision=r.disp_revision+1
  and r.close_return_status='RESTOCKED'
  and r.close_lifecycle_stage='CLOSED'
  and r.close_inventory_consequence_status='EXPLICIT'
  and (select count(*) from public.ecoflow_delivery_return_inspection_lines l
       where l.exception_id=:'verify_exception_id'::uuid)=1
  and (select count(*) from public.ecoflow_inventory_movements m
       where m.reference_type='DELIVERY_RETURN' and m.reference_id=:'verify_exception_id')=1
  and (select count(*) from public.ecoflow_return_commands c
       where c.exception_id=:'verify_exception_id'::uuid)=2
  and (select count(*) from public.ecoflow_delivery_return_scans s
       where s.exception_id=:'verify_exception_id'::uuid)=1
  and exists(
    select 1
    from public.ecoflow_inventory_movements m
    join public.ecoflow_delivery_return_inspection_lines l
      on l.movement_id=m.id
    where m.id=r.disp_inventory_movement_id
      and l.id=r.disp_inspection_line_id
      and m.movement_type='RETURN_IN'
      and m.reference_type='DELIVERY_RETURN'
      and m.reference_id=:'verify_exception_id'
      and m.to_location=:'verify_location'
      and l.resolution='RESTOCK'
      and l.units_processed=m.quantity
  )
) as smoke_contract_ok
from transform_007c_smoke_results r
limit 1
\gset

\if :smoke_contract_ok
\else
  \quit 1
\endif

rollback;

select (
  (select count(*) from public.ecoflow_delivery_exceptions e where e.id=:'verify_exception_id'::uuid)=0
  and (select count(*) from public.ecoflow_delivery_return_inspection_lines l where l.exception_id=:'verify_exception_id'::uuid)=0
  and (select count(*) from public.ecoflow_inventory_movements m where m.reference_type='DELIVERY_RETURN' and m.reference_id=:'verify_exception_id')=0
  and (select count(*) from public.ecoflow_return_commands c where c.exception_id=:'verify_exception_id'::uuid)=0
  and (select count(*) from public.ecoflow_delivery_return_scans s where s.exception_id=:'verify_exception_id'::uuid)=0
) as rollback_ok
\gset

\if :rollback_ok
\else
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
