\set ON_ERROR_STOP on
\set QUIET 1

-- TRANSFORM-007B production release verification.
--
-- This script runs only from trusted main with the production migration DB
-- credential. Business-command checks are deliberately enclosed in one
-- transaction and rolled back, so no customer hold state, revision, or command
-- audit row persists. Uncommitted hold state is not visible to other sessions.

begin;
set local statement_timeout = '8000ms';

create temp table transform_007b_release_actors(
  app_role text not null,
  user_id uuid not null
) on commit drop;

do $$
declare
  v_user_id uuid;
  v_role text;
begin
  for v_user_id in select id from auth.users order by created_at nulls last, id loop
    perform set_config('request.jwt.claim.sub', v_user_id::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    begin
      v_role := public.ecoflow_active_app_role();
    exception when others then
      v_role := null;
    end;
    if v_role in ('OWNER','ADMIN','ACCOUNT','VIEWER') then
      insert into transform_007b_release_actors(app_role,user_id)
      values(v_role,v_user_id);
    end if;
  end loop;

  if not exists(
    select 1 from transform_007b_release_actors
    where app_role in ('OWNER','ADMIN','ACCOUNT')
  ) then
    raise exception '007B_RELEASE_VERIFY_AUTHORISED_ACTOR_MISSING';
  end if;

  if not exists(
    select 1 from transform_007b_release_actors where app_role='VIEWER'
  ) then
    raise exception '007B_RELEASE_VERIFY_VIEWER_ACTOR_MISSING';
  end if;
end
$$;

select user_id as authorised_id
from transform_007b_release_actors
where app_role in ('OWNER','ADMIN','ACCOUNT')
order by case app_role when 'OWNER' then 1 when 'ADMIN' then 2 else 3 end, user_id
limit 1
\gset

select user_id as viewer_id
from transform_007b_release_actors
where app_role='VIEWER'
order by user_id
limit 1
\gset

-- Choose only a currently inactive store from the same authority used by the
-- Accounts customer directory and repaired 007B command functions.
select s.retailer_id::text as verify_store
from public.ecoflow_store_sites s
left join public.ecoflow_account_release_holds h
  on h.store_id=s.retailer_id::text
where coalesce(h.active,false)=false
order by s.retailer_id
limit 1
\gset

\if :{?verify_store}
\else
  \quit 1
\endif

select set_config('ecoflow.release_verify_store',:'verify_store',false) as store_context \gset
select set_config('request.jwt.claim.role','authenticated',false) as jwt_role_context \gset
select set_config('request.jwt.claim.sub',:'authorised_id',false) as jwt_sub_context \gset
set local role authenticated;

-- This is the exact Accounts list RPC that previously raised SQLSTATE 57014.
select clock_timestamp() as accounts_started_at \gset
select count(*)::bigint as accounts_rpc_rows
from public.ecoflow_read_operational_records_v1(
  'accounts','overview',1,25,null,null,null
)
\gset
select round(
  extract(epoch from (clock_timestamp()-:'accounts_started_at'::timestamptz))*1000
)::bigint as accounts_rpc_ms
\gset

\if :{?accounts_rpc_rows}
\else
  \quit 1
\endif

-- Viewer must still fail closed on Accounts.
select set_config('request.jwt.claim.sub',:'viewer_id',false) as viewer_sub_context \gset

do $$
declare
  v_denied boolean := false;
begin
  begin
    perform * from public.ecoflow_read_operational_records_v1(
      'accounts','overview',1,25,null,null,null
    );
  exception when sqlstate '42501' then
    if sqlerrm='ACCOUNTS_WORKSPACE_NOT_AUTHORISED' then
      v_denied := true;
    else
      raise;
    end if;
  end;
  if not v_denied then
    raise exception '007B_RELEASE_VERIFY_VIEWER_NOT_DENIED';
  end if;
end
$$;

-- Authorised hold -> authoritative readback -> clear -> readback. All writes are
-- inside this transaction and are rolled back below.
select set_config('request.jwt.claim.sub',:'authorised_id',false) as authorised_sub_context \gset
select active as initial_active, revision as initial_revision
from public.ecoflow_read_account_hold_state_v1(:'verify_store')
\gset

do $$
declare
  v_store text := current_setting('ecoflow.release_verify_store',true);
  v_initial_revision bigint;
  v_hold_revision bigint;
  v_hold_key uuid := md5(clock_timestamp()::text || random()::text || 'hold')::uuid;
  v_clear_key uuid := md5(clock_timestamp()::text || random()::text || 'clear')::uuid;
  r record;
begin
  if v_store is null or v_store='' then
    raise exception '007B_RELEASE_VERIFY_STORE_CONTEXT_MISSING';
  end if;

  select * into r from public.ecoflow_read_account_hold_state_v1(v_store);
  if r.active is not false then
    raise exception '007B_RELEASE_VERIFY_STORE_BECAME_ACTIVE';
  end if;
  v_initial_revision := r.revision;

  select * into r
  from public.ecoflow_set_account_release_hold_v1(
    v_store,true,v_initial_revision,v_hold_key,
    'release-verify-rollback','TRANSFORM-007B rollback-only release verification hold'
  );
  if r.accepted is not true or r.replayed is not false or r.status<>'APPLIED'
     or r.active is not true or r.revision<>v_initial_revision+1 then
    raise exception '007B_RELEASE_VERIFY_HOLD_APPLY_FAILED';
  end if;
  v_hold_revision := r.revision;

  select * into r from public.ecoflow_read_account_hold_state_v1(v_store);
  if r.active is not true or r.revision<>v_hold_revision then
    raise exception '007B_RELEASE_VERIFY_HOLD_READBACK_FAILED';
  end if;

  select * into r
  from public.ecoflow_set_account_release_hold_v1(
    v_store,false,v_hold_revision,v_clear_key,
    'release-verify-rollback','TRANSFORM-007B rollback-only release verification clear'
  );
  if r.accepted is not true or r.replayed is not false or r.status<>'APPLIED'
     or r.active is not false or r.revision<>v_hold_revision+1 then
    raise exception '007B_RELEASE_VERIFY_CLEAR_APPLY_FAILED';
  end if;

  select * into r from public.ecoflow_read_account_hold_state_v1(v_store);
  if r.active is not false or r.revision<>v_hold_revision+1 then
    raise exception '007B_RELEASE_VERIFY_CLEAR_READBACK_FAILED';
  end if;
end
$$;

reset role;

-- Authenticated clients must retain zero direct DML capability on the Accounts
-- authority and on source-owned Ordermentum / OM / QBO / QuickBooks relations.
do $$
declare
  v_source_write_relations bigint;
begin
  if has_table_privilege('authenticated','public.ecoflow_account_release_holds','INSERT')
     or has_table_privilege('authenticated','public.ecoflow_account_release_holds','UPDATE')
     or has_table_privilege('authenticated','public.ecoflow_account_release_holds','DELETE')
     or has_any_column_privilege('authenticated','public.ecoflow_account_release_holds','INSERT')
     or has_any_column_privilege('authenticated','public.ecoflow_account_release_holds','UPDATE') then
    raise exception '007B_RELEASE_VERIFY_DIRECT_AUTHORITY_DML_OPEN';
  end if;

  select count(*) into v_source_write_relations
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and c.relkind in ('r','p','v','m','f')
    and (
      c.relname='ecoflow_store_sites'
      or c.relname like 'ordermentum\_%' escape '\'
      or c.relname like 'om\_%' escape '\'
      or c.relname like 'qbo\_%' escape '\'
      or c.relname like 'quickbooks\_%' escape '\'
    )
    and (
      has_table_privilege('authenticated',c.oid,'INSERT')
      or has_table_privilege('authenticated',c.oid,'UPDATE')
      or has_table_privilege('authenticated',c.oid,'DELETE')
      or has_table_privilege('authenticated',c.oid,'TRUNCATE')
      or has_table_privilege('authenticated',c.oid,'TRIGGER')
      or has_any_column_privilege('authenticated',c.oid,'INSERT')
      or has_any_column_privilege('authenticated',c.oid,'UPDATE')
    );

  if v_source_write_relations<>0 then
    raise exception '007B_RELEASE_VERIFY_SOURCE_DML_OPEN:%',v_source_write_relations;
  end if;
end
$$;

rollback;

-- Prove the rollback restored the pre-smoke authoritative state.
begin;
set local statement_timeout='8000ms';
select set_config('request.jwt.claim.role','authenticated',false) as rollback_jwt_role_context \gset
select set_config('request.jwt.claim.sub',:'authorised_id',false) as rollback_jwt_sub_context \gset
set local role authenticated;
select active as after_active,revision as after_revision
from public.ecoflow_read_account_hold_state_v1(:'verify_store')
\gset
reset role;
rollback;

select (
  :'after_active'::boolean=:'initial_active'::boolean
  and :'after_revision'::bigint=:'initial_revision'::bigint
) as rollback_proof
\gset

\if :rollback_proof
\else
  \quit 1
\endif

\set QUIET 0
\echo TRANSFORM_007B_PRODUCTION_RELEASE_VERIFY=PASS
\echo ACCOUNTS_RPC_ROWS=:accounts_rpc_rows
\echo ACCOUNTS_RPC_MS=:accounts_rpc_ms
\echo VIEWER_ACCOUNTS_FAIL_CLOSED=PASS
\echo HOLD_READBACK_CLEAR_ROLLBACK=PASS
\echo SOURCE_OWNED_AUTHENTICATED_DML=DENIED
\echo ROLLBACK_PROOF=PASS
