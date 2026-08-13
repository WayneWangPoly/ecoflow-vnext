\set ON_ERROR_STOP on

do $$
begin
  if not exists(select 1 from pg_roles where rolname='anon') then
    create role anon nologin;
  end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then
    create role authenticated nologin;
  end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

grant usage on schema public to anon,authenticated,service_role;

-- RLS cannot protect TRUNCATE. This table deliberately models the production
-- ecoflow_store_sites shape: RLS exists, but historical table grants are broad.
create table public.ecoflow_store_sites(
  retailer_id uuid primary key,
  store_name text not null
);
alter table public.ecoflow_store_sites enable row level security;
create policy ecoflow_store_sites_no_browser_write
on public.ecoflow_store_sites
for all to authenticated
using(false) with check(false);

create table public.om_orders(id bigint primary key,payload jsonb);
create table public.ordermentum_raw_orders(id bigint primary key,payload jsonb);
create table public.qbo_invoices(id bigint primary key,payload jsonb);
create table public.quickbooks_customers(id bigint primary key,payload jsonb);

-- This unrelated application-owned relation proves the hardening is scoped by
-- source authority rather than revoking browser mutation across public schema.
create table public.ecoflow_unrelated_mutable(id bigint primary key,note text);

-- Mirror the dangerous production patterns: full browser grants on some source
-- tables and SELECT+TRUNCATE/TRIGGER/MAINTAIN on another.
grant select,insert,update,delete,truncate,references,trigger,maintain
  on public.ecoflow_store_sites,
     public.ordermentum_raw_orders,
     public.qbo_invoices,
     public.quickbooks_customers
  to anon,authenticated;

grant select,truncate,references,trigger,maintain
  on public.om_orders
  to anon,authenticated;

grant select,insert,update,delete,truncate,references,trigger,maintain
  on public.ecoflow_store_sites,
     public.om_orders,
     public.ordermentum_raw_orders,
     public.qbo_invoices,
     public.quickbooks_customers
  to service_role;

grant select,insert,update,delete
  on public.ecoflow_unrelated_mutable
  to authenticated;

insert into public.ecoflow_store_sites values('11111111-1111-4111-8111-111111111111','Fixture Store');
insert into public.om_orders values(1,'{}');
insert into public.ordermentum_raw_orders values(1,'{}');
insert into public.qbo_invoices values(1,'{}');
insert into public.quickbooks_customers values(1,'{}');
insert into public.ecoflow_unrelated_mutable values(1,'must remain mutable');
