\set ON_ERROR_STOP on

begin;
set local statement_timeout='2000ms';

do $$
declare
  v_count bigint;
  v_status text;
  v_gate text;
  v_definition text;
begin
  select count(*) into v_count from public.v_ecoflow_accounts_live_statement_lines;
  if v_count <> 60002 then
    raise exception 'Accounts scale fixture row count mismatch: expected 60002, got %',v_count;
  end if;

  select account_release_status,warehouse_gate_status into v_status,v_gate
  from public.v_ecoflow_accounts_live_statement_lines where store_id='legacy-store-order';
  if v_status is distinct from 'HOLD_PAYMENT_REVIEW' or v_gate is distinct from 'READY' then
    raise exception 'Legacy order-number fallback did not preserve operational status: %, %',v_status,v_gate;
  end if;

  select account_release_status,warehouse_gate_status into v_status,v_gate
  from public.v_ecoflow_accounts_live_statement_lines where store_id='legacy-store-invoice';
  if v_status is distinct from 'READY' or v_gate is distinct from 'STAGED' then
    raise exception 'Legacy invoice-number fallback did not preserve operational status: %, %',v_status,v_gate;
  end if;

  select pg_get_viewdef('public.v_ecoflow_accounts_live_statement_lines'::regclass,true) into v_definition;
  if position('o.external_order_id = f.source_order_id' in v_definition)=0 then
    raise exception 'Accounts line view no longer exposes the primary source-order equality join';
  end if;
  if position('legacy_number_fallback' in v_definition)=0 then
    raise exception 'Accounts line view lost the bounded legacy fallback branch';
  end if;
end
$$;

rollback;
