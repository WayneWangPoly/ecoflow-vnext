\set ON_ERROR_STOP on

-- Loaded after the #288 KPI snapshot repair. Reproduce the deployed Accounts
-- statement-customer shape and make one of its full-history join sources take
-- >3 seconds. The new forward repair must move this work behind the background
-- dashboard refresh checkpoint while keeping the interactive RPC <2 seconds.

-- The generic 007 fixture models this relation as a table; production is a view.
drop table public.v_ecoflow_accounts_live_statement_customers;

create table if not exists public.ecoflow_accounts_billing_contacts(
  store_id text primary key,
  billing_email text,
  contact_name text,
  enabled boolean not null default false
);

create or replace view public.v_ecoflow_accounts_statement_latest_actions as
select distinct on (store_id)
  store_id,
  action as latest_action,
  action_status as latest_action_status,
  action_note as latest_action_note,
  action_value as latest_action_value,
  action_at as latest_action_at
from public.ecoflow_accounts_statement_actions
order by store_id,action_at desc;

grant select on public.v_ecoflow_accounts_statement_latest_actions to authenticated;

create or replace function public.transform_007b_slow_customer_join_gate()
returns boolean
language plpgsql
volatile
as $$
begin
  perform pg_sleep(3);
  return true;
end;
$$;

-- Only the columns consumed by the production statement-customer view are
-- needed here. The materialized gate guarantees the live customer calculation
-- has an intrinsic >2s dependency without sleeping once per store.
create view public.v_ecoflow_owner_store_performance as
with gate as materialized (
  select public.transform_007b_slow_customer_join_gate() as ok
)
select
  d.store_id,
  d.suburb,
  d.address,
  d.contact_phone,
  d.price_group_id,
  d.orders_30d,
  d.revenue_30d,
  d.top_sku_30d,
  d.top_product_30d
from public.v_ecoflow_customer_store_directory d
cross join gate
where gate.ok;

grant select on public.v_ecoflow_owner_store_performance to authenticated;

insert into public.v_ecoflow_customer_store_directory(
  store_id,purchaser_id,store_name,suburb,state,address,contact_phone,price_group_id,
  verified,store_signal,orders_30d,revenue_30d,units_30d,top_sku_30d,top_product_30d,
  last_order_at,site_updated_at
) values(
  'store-1','PURCHASER-STORE-1','Scale Store 1','Adelaide','SA','1 Scale Street',
  '0800000001','PG-SCALE',true,'READY',24,12500,180,'SKU-SCALE','Scale Product',
  now()-interval '2 hours',now()
)
on conflict(store_id) do update set
  store_name=excluded.store_name,
  suburb=excluded.suburb,
  state=excluded.state,
  address=excluded.address,
  contact_phone=excluded.contact_phone,
  price_group_id=excluded.price_group_id,
  orders_30d=excluded.orders_30d,
  revenue_30d=excluded.revenue_30d,
  top_sku_30d=excluded.top_sku_30d,
  top_product_30d=excluded.top_product_30d,
  site_updated_at=excluded.site_updated_at;

insert into public.ecoflow_accounts_billing_contacts(store_id,billing_email,contact_name,enabled)
values('store-1','scale-account@example.invalid','Scale Account',true)
on conflict(store_id) do update set
  billing_email=excluded.billing_email,
  contact_name=excluded.contact_name,
  enabled=excluded.enabled;

-- Exact current production statement-customer contract before the repair.
create view public.v_ecoflow_accounts_live_statement_customers as
with sums as (
  select
    l.store_id,
    max(l.store_name) as store_name,
    count(*)::numeric as invoice_count,
    count(*) filter(where l.outstanding_amount>0)::numeric as open_invoice_count,
    count(*) filter(where l.statement_status='OVERDUE' and l.outstanding_amount>0)::numeric as overdue_invoice_count,
    coalesce(sum(l.invoice_value),0)::numeric as total_statement_value,
    coalesce(sum(l.outstanding_amount),0)::numeric as open_statement_value,
    coalesce(sum(l.outstanding_amount) filter(where l.statement_status='OVERDUE'),0)::numeric as overdue_statement_value,
    coalesce(sum(l.invoice_value) filter(where l.order_ts>=now()-interval '30 days'),0)::numeric as statement_value_30d,
    max(l.order_ts) as latest_invoice_at,
    coalesce(max(l.overdue_days) filter(where l.statement_status='OVERDUE' and l.outstanding_amount>0),0)::numeric as worst_overdue_days
  from public.v_ecoflow_accounts_live_statement_lines l
  group by l.store_id
)
select
  s.store_id,
  s.store_name,
  p.suburb,
  p.address,
  p.contact_phone,
  p.price_group_id,
  s.invoice_count,
  s.open_invoice_count,
  s.overdue_invoice_count,
  s.total_statement_value,
  s.open_statement_value,
  s.overdue_statement_value,
  s.statement_value_30d,
  s.latest_invoice_at,
  s.worst_overdue_days,
  case
    when s.overdue_statement_value>0 then 'OVERDUE_ATTENTION'::text
    when s.open_statement_value>0 then 'OPEN_BALANCE'::text
    else 'CLEAR'::text
  end as statement_signal,
  p.orders_30d,
  p.revenue_30d as order_revenue_30d,
  p.top_sku_30d,
  p.top_product_30d,
  la.latest_action,
  la.latest_action_status,
  la.latest_action_note,
  la.latest_action_at,
  case
    when la.latest_action='HOLD_ACCOUNT' then 'ON_HOLD'::text
    when s.overdue_statement_value>0 and s.worst_overdue_days>=30 then 'URGENT_COLLECTION'::text
    when s.overdue_statement_value>0 then 'COLLECTION'::text
    when s.open_statement_value>0 then 'SEND_STATEMENT'::text
    else 'CLEAR'::text
  end as accounts_priority,
  bc.billing_email,
  bc.contact_name as billing_contact_name,
  coalesce(bc.enabled,false) as billing_enabled
from sums s
left join public.v_ecoflow_owner_store_performance p on p.store_id=s.store_id
left join public.v_ecoflow_accounts_statement_latest_actions la on la.store_id=s.store_id
left join public.ecoflow_accounts_billing_contacts bc on bc.store_id=s.store_id
where public.ecoflow_active_app_role()=any(array['OWNER'::text,'ADMIN'::text,'ACCOUNT'::text]);

grant select on public.v_ecoflow_accounts_live_statement_customers to authenticated;

analyze public.v_ecoflow_customer_store_directory;
