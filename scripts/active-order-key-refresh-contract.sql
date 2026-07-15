\set ON_ERROR_STOP on

-- The production schema already owns this derived cache and the current order
-- operations view. The isolated commercial fixture intentionally omits them, so
-- create only the minimal compatible shapes needed to execute this contract.
create table if not exists public.ecoflow_ui_active_order_keys (
  order_key text primary key,
  refreshed_at timestamptz not null default now()
);

do $$
begin
  if to_regclass('public.v_ecoflow_order_operations_v5') is null
     and to_regclass('public.v_ecoflow_order_operations_v4') is null
     and to_regclass('public.v_ecoflow_order_operations_v3') is null then
    execute $view$
      create view public.v_ecoflow_order_operations_v5 as
      select
        null::text as raw_order_id,
        null::text as external_order_id,
        null::text as external_order_number,
        null::text as order_number,
        null::text as invoice_number,
        'HISTORY'::text as operational_scope,
        'HISTORY'::text as fulfilment_status,
        'PRESENT'::text as source_presence_status
      where false
    $view$;
  end if;
end $$;

insert into public.ecoflow_ui_active_order_keys(order_key,refreshed_at)
values ('__STALE_ACTIVE_KEY_CONTRACT__',now()-interval '1 day')
on conflict(order_key) do update set refreshed_at=excluded.refreshed_at;

select public.ecoflow_refresh_ui_active_order_keys();

do $$
declare
  v_definition text;
begin
  if exists (
    select 1
    from public.ecoflow_ui_active_order_keys
    where order_key='__STALE_ACTIVE_KEY_CONTRACT__'
  ) then
    raise exception 'stale active-order key was not removed';
  end if;

  select pg_get_functiondef('public.ecoflow_refresh_ui_active_order_keys()'::regprocedure)
    into v_definition;

  if position('where refreshed_at is null' in lower(v_definition))=0
     or position('refreshed_at < v_refresh_at' in lower(v_definition))=0 then
    raise exception 'active-order key refresh has no safe stale-row predicate';
  end if;

  if position('execute ''delete from public.ecoflow_ui_active_order_keys''' in lower(v_definition))>0 then
    raise exception 'unsafe unconditional dynamic delete remains in active-order key refresh';
  end if;
end $$;

select 'active-order key refresh contract passed' as result;
