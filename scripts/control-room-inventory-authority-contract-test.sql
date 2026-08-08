\set ON_ERROR_STOP on

create role anon;
create role authenticated;
create role service_role;

create table public.om_orders (
  id text primary key,
  cancelled boolean default false,
  cancelled_at timestamptz,
  order_status text,
  status text,
  delivery_date timestamptz,
  due_at timestamptz,
  updated_at timestamptz,
  created_at timestamptz
);

create table public.ecoflow_ordermentum_source_presence (
  domain text,
  external_id text,
  source_status text
);

create table public.ecoflow_inventory_movements (
  movement_type text,
  quantity numeric
);

create table public.ecoflow_sku_barcode_registry (
  barcode text
);

create table public.ecoflow_read_model_refresh_state (
  read_model text primary key,
  refreshed_at timestamptz not null,
  row_count bigint not null
);

create table public.ecoflow_stocktake_sessions (
  id uuid primary key,
  session_type text not null,
  session_status text not null,
  approved_at timestamptz
);

create or replace function public.ecoflow_active_app_role()
returns text language sql stable as $$ select 'OWNER'::text $$;

create or replace function public.ecoflow_assert_current_exception_snapshot()
returns boolean language sql stable as $$ select true $$;

insert into public.ecoflow_read_model_refresh_state(read_model,refreshed_at,row_count)
values ('CURRENT_EXCEPTIONS',now(),0);

insert into public.om_orders(id,updated_at,created_at)
values ('ORDER-1',now(),now());

insert into public.ecoflow_inventory_movements(movement_type,quantity)
values ('RECEIVE',7);

insert into public.ecoflow_sku_barcode_registry(barcode)
values ('930000000001');

\ir ../supabase/migrations/20260808095000_dashboard_inventory_quantity_authority.sql

do $$
declare
  v_row record;
begin
  select * into v_row from public.ecoflow_get_dashboard_readiness_v2();
  if v_row.inventory_quantity_commissioned is distinct from false then
    raise exception 'unapproved warehouse unexpectedly treated as quantity-commissioned';
  end if;
  if v_row.initial_stocktake_approved_at is not null then
    raise exception 'unapproved warehouse exposed an initial approval timestamp';
  end if;
  if v_row.live_on_hand_units <> 7 then
    raise exception 'ledger quantity unexpectedly changed before commissioning';
  end if;
end;
$$;

insert into public.ecoflow_stocktake_sessions(id,session_type,session_status,approved_at)
values ('00000000-0000-4000-8000-000000000001','INITIAL','APPROVED','2026-08-08T00:00:00Z');

truncate table public.ecoflow_inventory_movements;

do $$
declare
  v_row record;
begin
  select * into v_row from public.ecoflow_get_dashboard_readiness_v2();
  if v_row.inventory_quantity_commissioned is distinct from true then
    raise exception 'approved INITIAL stocktake did not establish quantity authority';
  end if;
  if v_row.live_on_hand_units <> 0 then
    raise exception 'authoritative zero inventory was not preserved as numeric zero';
  end if;
  if v_row.initial_stocktake_approved_at <> '2026-08-08T00:00:00Z'::timestamptz then
    raise exception 'approved INITIAL timestamp is not exposed correctly';
  end if;
end;
$$;

insert into public.ecoflow_stocktake_sessions(id,session_type,session_status,approved_at)
values ('00000000-0000-4000-8000-000000000002','CYCLE_COUNT','APPROVED','2026-08-08T01:00:00Z');

do $$
declare
  v_row record;
begin
  select * into v_row from public.ecoflow_get_dashboard_readiness_v2();
  if v_row.initial_stocktake_approved_at <> '2026-08-08T00:00:00Z'::timestamptz then
    raise exception 'cycle count incorrectly replaced INITIAL commissioning authority';
  end if;
end;
$$;

\echo 'Control Room inventory quantity authority contract passed.'
