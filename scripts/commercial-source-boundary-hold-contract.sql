\set ON_ERROR_STOP on

select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select set_config('request.jwt.claim.role','authenticated',false);
set role authenticated;

select * from public.ecoflow_record_accounts_statement_action(
  'STORE-1','HOLD_ACCOUNT','Credit review required',null
);

do $$
begin
  if not exists (
    select 1 from public.v_ecoflow_account_release_holds_v1
    where store_id='STORE-1' and active
  ) then
    raise exception 'EcoFlow account release hold was not activated';
  end if;
end $$;

select * from public.ecoflow_record_accounts_statement_action(
  'STORE-1','CLEAR_HOLD','Credit review completed',null
);

do $$
begin
  if exists (
    select 1 from public.v_ecoflow_account_release_holds_v1
    where store_id='STORE-1' and active
  ) then
    raise exception 'EcoFlow account release hold was not cleared';
  end if;
  if not exists (
    select 1 from public.ecoflow_accounts_statement_actions
    where store_id='STORE-1' and action='HOLD_ACCOUNT' and action_status='ON_HOLD'
  ) then
    raise exception 'Hold audit event missing';
  end if;
  if not exists (
    select 1 from public.ecoflow_accounts_statement_actions
    where store_id='STORE-1' and action='CLEAR_HOLD' and action_status='HOLD_CLEARED'
  ) then
    raise exception 'Clear-hold audit event missing';
  end if;
end $$;

reset role;

select 'account release hold contract passed' as result;
