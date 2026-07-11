-- EcoFlow office commercial controls:
-- 1) versioned SKU x price-group matrix,
-- 2) immutable customer statements and payment allocation,
-- 3) delivery run history and replay projections.

-- ---------------------------------------------------------------------------
-- Price matrix
-- ---------------------------------------------------------------------------
create table if not exists public.ecoflow_price_matrix_versions (
  id uuid primary key default gen_random_uuid(),
  sku text not null,
  product_name text,
  price_group_id text not null,
  price_group_name text,
  currency text not null default 'AUD' check (currency = 'AUD'),
  unit_price numeric(14,4) not null check (unit_price >= 0),
  effective_from date not null default current_date,
  effective_to date,
  version_no integer not null check (version_no > 0),
  is_current boolean not null default true,
  change_reason text not null,
  source text not null default 'ECOFLOW_TARGET_MATRIX',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  constraint ecoflow_price_matrix_effective_range check (effective_to is null or effective_to >= effective_from),
  unique (sku, price_group_id, version_no)
);

create unique index if not exists uq_ecoflow_price_matrix_current
  on public.ecoflow_price_matrix_versions(sku, price_group_id)
  where is_current;
create index if not exists idx_ecoflow_price_matrix_history
  on public.ecoflow_price_matrix_versions(sku, price_group_id, created_at desc);

alter table public.ecoflow_price_matrix_versions enable row level security;
revoke all on public.ecoflow_price_matrix_versions from anon, authenticated;

create policy ecoflow_price_matrix_read
on public.ecoflow_price_matrix_versions for select to authenticated
using (public.ecoflow_active_app_role() in ('OWNER','ADMIN','ACCOUNT','VIEWER'));

grant select on public.ecoflow_price_matrix_versions to authenticated;

create or replace view public.v_ecoflow_price_matrix_workbench
with (security_invoker=true)
as
with sku_ranked as (
  select
    nullif(trim(s.external_sku_code),'') as sku,
    nullif(trim(s.external_product_name),'') as product_name,
    s.base_price::numeric as base_price,
    s.last_synced_at,
    row_number() over (
      partition by nullif(trim(s.external_sku_code),'')
      order by case when s.source_type = 'variant' then 0 else 1 end,
               s.last_synced_at desc nulls last
    ) as rn
  from public.v_ecoflow_ordermentum_sku_master_v1 s
  where nullif(trim(s.external_sku_code),'') is not null
), skus as (
  select sku, max(product_name) as product_name, max(base_price) as base_price, max(last_synced_at) as sku_last_synced_at
  from sku_ranked where rn=1 group by sku
), groups as (
  select distinct
    coalesce(
      nullif(trim(to_jsonb(pg)->>'price_group_id'),''),
      nullif(trim(to_jsonb(pg)->>'external_price_group_id'),'')
    ) as price_group_id,
    coalesce(
      nullif(trim(to_jsonb(pg)->>'price_group_name'),''),
      nullif(trim(to_jsonb(pg)->>'name'),''),
      coalesce(
        nullif(trim(to_jsonb(pg)->>'price_group_id'),''),
        nullif(trim(to_jsonb(pg)->>'external_price_group_id'),'')
      )
    ) as price_group_name
  from public.v_ecoflow_ordermentum_price_groups_v1 pg
  where coalesce(
    nullif(trim(to_jsonb(pg)->>'price_group_id'),''),
    nullif(trim(to_jsonb(pg)->>'external_price_group_id'),'')
  ) is not null
), current_matrix as (
  select * from public.ecoflow_price_matrix_versions where is_current
)
select
  s.sku,
  s.product_name,
  g.price_group_id,
  g.price_group_name,
  coalesce(m.unit_price,s.base_price,0)::numeric(14,4) as effective_price,
  s.base_price::numeric(14,4) as source_base_price,
  (m.id is not null) as has_override,
  m.id as matrix_version_id,
  m.version_no,
  m.effective_from,
  m.change_reason,
  m.created_by,
  m.created_at,
  s.sku_last_synced_at
from skus s cross join groups g
left join current_matrix m on m.sku=s.sku and m.price_group_id=g.price_group_id;

grant select on public.v_ecoflow_price_matrix_workbench to authenticated;

create or replace view public.v_ecoflow_price_matrix_history
with (security_invoker=true)
as
select id,sku,product_name,price_group_id,price_group_name,currency,unit_price,effective_from,effective_to,
       version_no,is_current,change_reason,source,created_by,created_at,superseded_at
from public.ecoflow_price_matrix_versions
order by created_at desc;

grant select on public.v_ecoflow_price_matrix_history to authenticated;

create or replace function public.ecoflow_set_price_matrix_price(
  p_sku text,
  p_price_group_id text,
  p_unit_price numeric,
  p_effective_from date default current_date,
  p_reason text default null
)
returns table(id uuid, sku text, price_group_id text, unit_price numeric, version_no integer, effective_from date, created_at timestamptz)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_role text := public.ecoflow_active_app_role();
  v_sku text := nullif(trim(coalesce(p_sku,'')),'');
  v_group text := nullif(trim(coalesce(p_price_group_id,'')),'');
  v_reason text := nullif(trim(coalesce(p_reason,'')),'');
  v_product text;
  v_group_name text;
  v_version integer;
  v_id uuid;
begin
  if v_role not in ('OWNER','ADMIN') then raise exception 'OWNER_OR_ADMIN_REQUIRED'; end if;
  if v_sku is null or v_group is null then raise exception 'SKU_AND_PRICE_GROUP_REQUIRED'; end if;
  if p_unit_price is null or p_unit_price < 0 then raise exception 'VALID_NON_NEGATIVE_PRICE_REQUIRED'; end if;
  if v_reason is null then raise exception 'PRICE_CHANGE_REASON_REQUIRED'; end if;

  select max(w.product_name), max(w.price_group_name)
    into v_product,v_group_name
  from public.v_ecoflow_price_matrix_workbench w
  where w.sku=v_sku and w.price_group_id=v_group;
  if v_group_name is null then raise exception 'UNKNOWN_SKU_OR_PRICE_GROUP'; end if;

  select coalesce(max(v.version_no),0)+1 into v_version
  from public.ecoflow_price_matrix_versions v
  where v.sku=v_sku and v.price_group_id=v_group;

  update public.ecoflow_price_matrix_versions v
     set is_current=false,
         effective_to=greatest(v.effective_from,coalesce(p_effective_from,current_date)-1),
         superseded_at=now()
   where v.sku=v_sku and v.price_group_id=v_group and v.is_current;

  insert into public.ecoflow_price_matrix_versions(
    sku,product_name,price_group_id,price_group_name,unit_price,effective_from,version_no,is_current,change_reason,created_by
  ) values (
    v_sku,v_product,v_group,v_group_name,round(p_unit_price,4),coalesce(p_effective_from,current_date),v_version,true,v_reason,auth.uid()
  ) returning ecoflow_price_matrix_versions.id into v_id;

  return query
  select v.id,v.sku,v.price_group_id,v.unit_price,v.version_no,v.effective_from,v.created_at
  from public.ecoflow_price_matrix_versions v where v.id=v_id;
end;
$$;

grant execute on function public.ecoflow_set_price_matrix_price(text,text,numeric,date,text) to authenticated;
revoke execute on function public.ecoflow_set_price_matrix_price(text,text,numeric,date,text) from anon;

create or replace function public.ecoflow_bulk_adjust_price_matrix(
  p_price_group_id text,
  p_percent numeric,
  p_effective_from date default current_date,
  p_reason text default null,
  p_skus text[] default null
)
returns table(adjusted_count integer, price_group_id text, percent numeric, effective_from date)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_role text := public.ecoflow_active_app_role();
  v_group text := nullif(trim(coalesce(p_price_group_id,'')),'');
  v_reason text := nullif(trim(coalesce(p_reason,'')),'');
  v_count integer := 0;
  r record;
begin
  if v_role not in ('OWNER','ADMIN') then raise exception 'OWNER_OR_ADMIN_REQUIRED'; end if;
  if v_group is null then raise exception 'PRICE_GROUP_REQUIRED'; end if;
  if p_percent is null or p_percent <= -100 or p_percent > 1000 then raise exception 'PERCENT_OUT_OF_RANGE'; end if;
  if v_reason is null then raise exception 'PRICE_CHANGE_REASON_REQUIRED'; end if;

  for r in
    select w.sku,w.effective_price
    from public.v_ecoflow_price_matrix_workbench w
    where w.price_group_id=v_group
      and (p_skus is null or w.sku=any(p_skus))
  loop
    perform public.ecoflow_set_price_matrix_price(
      r.sku,v_group,round(r.effective_price*(1+p_percent/100.0),4),coalesce(p_effective_from,current_date),v_reason
    );
    v_count := v_count+1;
  end loop;

  return query select v_count,v_group,p_percent,coalesce(p_effective_from,current_date);
end;
$$;

grant execute on function public.ecoflow_bulk_adjust_price_matrix(text,numeric,date,text,text[]) to authenticated;
revoke execute on function public.ecoflow_bulk_adjust_price_matrix(text,numeric,date,text,text[]) from anon;

-- ---------------------------------------------------------------------------
-- Statements, PDF lifecycle, contacts and payment allocation
-- ---------------------------------------------------------------------------
create table if not exists public.ecoflow_accounts_billing_contacts (
  store_id text primary key,
  store_name text,
  billing_email text,
  contact_name text,
  enabled boolean not null default true,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ecoflow_customer_payment_receipts (
  id uuid primary key default gen_random_uuid(),
  store_id text not null,
  store_name text,
  paid_at date not null default current_date,
  amount numeric(14,2) not null check(amount>0),
  allocated_amount numeric(14,2) not null default 0 check(allocated_amount>=0),
  unapplied_amount numeric(14,2) not null default 0 check(unapplied_amount>=0),
  payment_method text not null default 'BANK_TRANSFER',
  payment_reference text not null,
  payment_note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique(store_id,payment_reference)
);

create table if not exists public.ecoflow_customer_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.ecoflow_customer_payment_receipts(id) on delete cascade,
  store_id text not null,
  internal_order_id text not null,
  invoice_number text,
  allocated_amount numeric(14,2) not null check(allocated_amount>0),
  allocated_at timestamptz not null default now(),
  unique(receipt_id,internal_order_id)
);

create table if not exists public.ecoflow_statement_documents (
  id uuid primary key default gen_random_uuid(),
  statement_number text not null unique,
  store_id text not null,
  store_name text not null,
  period_start date not null,
  period_end date not null,
  issue_date date not null default current_date,
  due_date date,
  opening_balance numeric(14,2) not null default 0,
  period_invoice_total numeric(14,2) not null default 0,
  period_payment_total numeric(14,2) not null default 0,
  closing_balance numeric(14,2) not null default 0,
  currency text not null default 'AUD' check(currency='AUD'),
  document_status text not null default 'DRAFT' check(document_status in ('DRAFT','GENERATED','SENT','CONFIGURATION_REQUIRED','FAILED')),
  storage_path text,
  recipient_email text,
  provider_message_id text,
  generated_at timestamptz,
  sent_at timestamptz,
  error_message text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint ecoflow_statement_period_valid check(period_end>=period_start)
);

create table if not exists public.ecoflow_statement_document_lines (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null references public.ecoflow_statement_documents(id) on delete cascade,
  store_id text not null,
  internal_order_id text not null,
  order_number text,
  invoice_number text,
  invoice_date date,
  due_date date,
  original_amount numeric(14,2) not null,
  allocated_amount numeric(14,2) not null default 0,
  outstanding_amount numeric(14,2) not null,
  line_status text not null,
  unique(statement_id,internal_order_id)
);

create index if not exists idx_ecoflow_payment_allocations_order on public.ecoflow_customer_payment_allocations(internal_order_id);
create index if not exists idx_ecoflow_statements_store on public.ecoflow_statement_documents(store_id,created_at desc);

alter table public.ecoflow_accounts_billing_contacts enable row level security;
alter table public.ecoflow_customer_payment_receipts enable row level security;
alter table public.ecoflow_customer_payment_allocations enable row level security;
alter table public.ecoflow_statement_documents enable row level security;
alter table public.ecoflow_statement_document_lines enable row level security;

revoke all on public.ecoflow_accounts_billing_contacts,public.ecoflow_customer_payment_receipts,
  public.ecoflow_customer_payment_allocations,public.ecoflow_statement_documents,public.ecoflow_statement_document_lines
  from anon,authenticated;

do $$
begin
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='ecoflow_accounts_billing_contacts' and policyname='ecoflow_billing_contacts_office') then
    create policy ecoflow_billing_contacts_office on public.ecoflow_accounts_billing_contacts for select to authenticated
      using(public.ecoflow_active_app_role() in ('OWNER','ADMIN','ACCOUNT'));
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='ecoflow_customer_payment_receipts' and policyname='ecoflow_payment_receipts_office') then
    create policy ecoflow_payment_receipts_office on public.ecoflow_customer_payment_receipts for select to authenticated
      using(public.ecoflow_active_app_role() in ('OWNER','ADMIN','ACCOUNT'));
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='ecoflow_customer_payment_allocations' and policyname='ecoflow_payment_allocations_office') then
    create policy ecoflow_payment_allocations_office on public.ecoflow_customer_payment_allocations for select to authenticated
      using(public.ecoflow_active_app_role() in ('OWNER','ADMIN','ACCOUNT'));
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='ecoflow_statement_documents' and policyname='ecoflow_statement_documents_office') then
    create policy ecoflow_statement_documents_office on public.ecoflow_statement_documents for select to authenticated
      using(public.ecoflow_active_app_role() in ('OWNER','ADMIN','ACCOUNT'));
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='ecoflow_statement_document_lines' and policyname='ecoflow_statement_lines_office') then
    create policy ecoflow_statement_lines_office on public.ecoflow_statement_document_lines for select to authenticated
      using(public.ecoflow_active_app_role() in ('OWNER','ADMIN','ACCOUNT'));
  end if;
end $$;

grant select on public.ecoflow_accounts_billing_contacts,public.ecoflow_customer_payment_receipts,
  public.ecoflow_customer_payment_allocations,public.ecoflow_statement_documents,public.ecoflow_statement_document_lines
  to authenticated;

create or replace view public.v_ecoflow_accounts_live_statement_lines
as
with allocated as (
  select a.internal_order_id::text as internal_order_id,sum(a.allocated_amount)::numeric as allocated_amount
  from public.ecoflow_customer_payment_allocations a group by a.internal_order_id::text
), base as (
  select l.*,coalesce(a.allocated_amount,0)::numeric as allocated_amount,
    case when l.statement_status='CLOSED' then 0::numeric
         else greatest(coalesce(l.invoice_value,0)-coalesce(a.allocated_amount,0),0)::numeric end as outstanding_amount
  from public.v_ecoflow_accounts_statement_lines l
  left join allocated a on a.internal_order_id=l.internal_order_id::text
)
select b.store_id,b.store_name,b.internal_order_id::text as internal_order_id,b.order_number,b.invoice_number,b.order_ts,b.due_at,
  b.invoice_value,b.allocated_amount,b.outstanding_amount,b.age_days,b.overdue_days,
  case when b.outstanding_amount<=0 then 'PAID'
       when b.due_at<now() then 'OVERDUE' else 'OPEN' end as statement_status,
  b.order_status,b.account_release_status,b.warehouse_gate_status,
  case when b.outstanding_amount<=0 then 'PAID'
       when b.due_at<now() and b.overdue_days>=30 then 'OVERDUE_30_PLUS'
       when b.due_at<now() then 'OVERDUE'
       when b.due_at<=now()+interval '7 days' then 'DUE_THIS_WEEK'
       else 'OPEN' end as accounts_signal
from base b
where public.ecoflow_active_app_role() in ('OWNER','ADMIN','ACCOUNT');

grant select on public.v_ecoflow_accounts_live_statement_lines to authenticated;

create or replace view public.v_ecoflow_accounts_live_statement_customers
as
with sums as (
  select l.store_id,max(l.store_name) store_name,
    count(*)::numeric invoice_count,
    count(*) filter(where l.outstanding_amount>0)::numeric open_invoice_count,
    count(*) filter(where l.statement_status='OVERDUE' and l.outstanding_amount>0)::numeric overdue_invoice_count,
    coalesce(sum(l.invoice_value),0)::numeric total_statement_value,
    coalesce(sum(l.outstanding_amount),0)::numeric open_statement_value,
    coalesce(sum(l.outstanding_amount) filter(where l.statement_status='OVERDUE'),0)::numeric overdue_statement_value,
    coalesce(sum(l.invoice_value) filter(where l.order_ts>=now()-interval '30 days'),0)::numeric statement_value_30d,
    max(l.order_ts) latest_invoice_at,
    coalesce(max(l.overdue_days) filter(where l.statement_status='OVERDUE' and l.outstanding_amount>0),0)::numeric worst_overdue_days
  from public.v_ecoflow_accounts_live_statement_lines l group by l.store_id
)
select s.store_id,s.store_name,p.suburb,p.address,p.contact_phone,p.price_group_id,
  s.invoice_count,s.open_invoice_count,s.overdue_invoice_count,s.total_statement_value,s.open_statement_value,
  s.overdue_statement_value,s.statement_value_30d,s.latest_invoice_at,s.worst_overdue_days,
  case when s.overdue_statement_value>0 then 'OVERDUE_ATTENTION' when s.open_statement_value>0 then 'OPEN_BALANCE' else 'CLEAR' end statement_signal,
  p.orders_30d,p.revenue_30d order_revenue_30d,p.top_sku_30d,p.top_product_30d,
  la.latest_action,la.latest_action_status,la.latest_action_note,la.latest_action_at,
  case when la.latest_action='HOLD_ACCOUNT' then 'ON_HOLD'
       when s.overdue_statement_value>0 and s.worst_overdue_days>=30 then 'URGENT_COLLECTION'
       when s.overdue_statement_value>0 then 'COLLECTION'
       when s.open_statement_value>0 then 'SEND_STATEMENT' else 'CLEAR' end accounts_priority,
  bc.billing_email,bc.contact_name billing_contact_name,coalesce(bc.enabled,false) billing_enabled
from sums s
left join public.v_ecoflow_owner_store_performance p on p.store_id=s.store_id
left join public.v_ecoflow_accounts_statement_latest_actions la on la.store_id=s.store_id
left join public.ecoflow_accounts_billing_contacts bc on bc.store_id=s.store_id
where public.ecoflow_active_app_role() in ('OWNER','ADMIN','ACCOUNT');

grant select on public.v_ecoflow_accounts_live_statement_customers to authenticated;

create or replace view public.v_ecoflow_accounts_live_ar_kpis
with (security_invoker=true)
as
select coalesce(sum(open_statement_value),0)::numeric open_ar_value,
  coalesce(sum(overdue_statement_value),0)::numeric overdue_ar_value,
  count(*) filter(where open_statement_value>0)::numeric open_customers,
  count(*) filter(where overdue_statement_value>0)::numeric overdue_customers,
  coalesce(sum(open_invoice_count),0)::numeric open_invoices,
  coalesce(sum(overdue_invoice_count),0)::numeric overdue_invoices,
  coalesce(sum(statement_value_30d),0)::numeric statement_value_30d,
  coalesce(max(worst_overdue_days),0)::numeric worst_overdue_days,
  count(*) filter(where accounts_priority='URGENT_COLLECTION')::numeric urgent_customers,
  count(*) filter(where accounts_priority='ON_HOLD')::numeric held_customers,
  max(latest_invoice_at) latest_invoice_at
from public.v_ecoflow_accounts_live_statement_customers;

grant select on public.v_ecoflow_accounts_live_ar_kpis to authenticated;

create or replace view public.v_ecoflow_accounts_live_followup_queue
with (security_invoker=true)
as
select c.*,
  case when c.accounts_priority='ON_HOLD' then 'CHECK_ACCOUNT_HOLD'
       when c.accounts_priority='URGENT_COLLECTION' then 'CALL_AND_ESCALATE'
       when c.accounts_priority='COLLECTION' then 'SEND_REMINDER'
       when c.accounts_priority='SEND_STATEMENT' then 'SEND_STATEMENT' else 'NO_ACTION' end next_action
from public.v_ecoflow_accounts_live_statement_customers c
where c.accounts_priority<>'CLEAR'
order by case c.accounts_priority when 'ON_HOLD' then 0 when 'URGENT_COLLECTION' then 1 when 'COLLECTION' then 2 when 'SEND_STATEMENT' then 3 else 4 end,
  c.overdue_statement_value desc,c.open_statement_value desc;

grant select on public.v_ecoflow_accounts_live_followup_queue to authenticated;

create or replace view public.v_ecoflow_statement_document_history
with (security_invoker=true)
as
select d.*,coalesce((select count(*) from public.ecoflow_statement_document_lines l where l.statement_id=d.id),0)::integer line_count
from public.ecoflow_statement_documents d order by d.created_at desc;

grant select on public.v_ecoflow_statement_document_history to authenticated;

create or replace view public.v_ecoflow_customer_payment_history
with (security_invoker=true)
as
select r.*,coalesce((select count(*) from public.ecoflow_customer_payment_allocations a where a.receipt_id=r.id),0)::integer allocation_count
from public.ecoflow_customer_payment_receipts r order by r.paid_at desc,r.created_at desc;

grant select on public.v_ecoflow_customer_payment_history to authenticated;

create or replace function public.ecoflow_upsert_billing_contact(
  p_store_id text,p_store_name text,p_billing_email text,p_contact_name text default null,p_enabled boolean default true
)
returns table(store_id text,billing_email text,enabled boolean,updated_at timestamptz)
language plpgsql security definer set search_path=public
as $$
declare v_role text:=public.ecoflow_active_app_role(); v_store text:=nullif(trim(coalesce(p_store_id,'')),''); v_email text:=lower(nullif(trim(coalesce(p_billing_email,'')),''));
begin
  if v_role not in ('OWNER','ADMIN','ACCOUNT') then raise exception 'OFFICE_ROLE_REQUIRED'; end if;
  if v_store is null then raise exception 'STORE_REQUIRED'; end if;
  if v_email is not null and v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'VALID_EMAIL_REQUIRED'; end if;
  insert into public.ecoflow_accounts_billing_contacts(store_id,store_name,billing_email,contact_name,enabled,updated_by,updated_at)
  values(v_store,nullif(trim(coalesce(p_store_name,'')),''),v_email,nullif(trim(coalesce(p_contact_name,'')),''),coalesce(p_enabled,true),auth.uid(),now())
  on conflict on constraint ecoflow_accounts_billing_contacts_pkey do update set
    store_name=excluded.store_name,billing_email=excluded.billing_email,contact_name=excluded.contact_name,
    enabled=excluded.enabled,updated_by=auth.uid(),updated_at=now();
  return query select b.store_id,b.billing_email,b.enabled,b.updated_at from public.ecoflow_accounts_billing_contacts b where b.store_id=v_store;
end;
$$;

grant execute on function public.ecoflow_upsert_billing_contact(text,text,text,text,boolean) to authenticated;
revoke execute on function public.ecoflow_upsert_billing_contact(text,text,text,text,boolean) from anon;

create or replace function public.ecoflow_create_statement_document(
  p_store_id text,p_period_start date,p_period_end date
)
returns table(id uuid,statement_number text,document_status text,closing_balance numeric,recipient_email text,created_at timestamptz)
language plpgsql security definer set search_path=public
as $$
declare
  v_role text:=public.ecoflow_active_app_role(); v_store text:=nullif(trim(coalesce(p_store_id,'')),'');
  v_name text; v_id uuid:=gen_random_uuid(); v_number text; v_opening numeric:=0; v_invoices numeric:=0; v_payments numeric:=0; v_closing numeric:=0; v_recipient text;
begin
  if v_role not in ('OWNER','ADMIN','ACCOUNT') then raise exception 'OFFICE_ROLE_REQUIRED'; end if;
  if v_store is null then raise exception 'STORE_REQUIRED'; end if;
  if p_period_start is null or p_period_end is null or p_period_end<p_period_start then raise exception 'VALID_STATEMENT_PERIOD_REQUIRED'; end if;
  select max(c.store_name),max(c.billing_email) into v_name,v_recipient from public.v_ecoflow_accounts_live_statement_customers c where c.store_id=v_store;
  if v_name is null then raise exception 'STORE_STATEMENT_NOT_FOUND'; end if;
  select coalesce(sum(l.outstanding_amount),0) into v_opening from public.v_ecoflow_accounts_live_statement_lines l where l.store_id=v_store and l.order_ts::date<p_period_start;
  select coalesce(sum(l.invoice_value),0) into v_invoices from public.v_ecoflow_accounts_live_statement_lines l where l.store_id=v_store and l.order_ts::date between p_period_start and p_period_end;
  select coalesce(sum(r.amount),0) into v_payments from public.ecoflow_customer_payment_receipts r where r.store_id=v_store and r.paid_at between p_period_start and p_period_end;
  select coalesce(sum(l.outstanding_amount),0) into v_closing from public.v_ecoflow_accounts_live_statement_lines l where l.store_id=v_store;
  v_number := 'STM-'||to_char(current_date,'YYYYMMDD')||'-'||upper(substr(replace(v_id::text,'-',''),1,8));
  insert into public.ecoflow_statement_documents(id,statement_number,store_id,store_name,period_start,period_end,issue_date,due_date,
    opening_balance,period_invoice_total,period_payment_total,closing_balance,recipient_email,created_by)
  values(v_id,v_number,v_store,v_name,p_period_start,p_period_end,current_date,current_date+14,v_opening,v_invoices,v_payments,v_closing,v_recipient,auth.uid());
  insert into public.ecoflow_statement_document_lines(statement_id,store_id,internal_order_id,order_number,invoice_number,invoice_date,due_date,
    original_amount,allocated_amount,outstanding_amount,line_status)
  select v_id,l.store_id,l.internal_order_id,l.order_number,l.invoice_number,l.order_ts::date,l.due_at::date,l.invoice_value,l.allocated_amount,l.outstanding_amount,l.statement_status
  from public.v_ecoflow_accounts_live_statement_lines l where l.store_id=v_store and l.outstanding_amount>0 order by l.due_at,l.order_ts;
  insert into public.ecoflow_accounts_statement_actions(store_id,action,action_note,action_value,action_status,action_by)
  values(v_store,'SEND_STATEMENT_DRAFT','Formal statement snapshot created',v_number,'STATEMENT_CREATED',auth.uid());
  return query select d.id,d.statement_number,d.document_status,d.closing_balance,d.recipient_email,d.created_at from public.ecoflow_statement_documents d where d.id=v_id;
end;
$$;

grant execute on function public.ecoflow_create_statement_document(text,date,date) to authenticated;
revoke execute on function public.ecoflow_create_statement_document(text,date,date) from anon;

create or replace function public.ecoflow_record_customer_payment(
  p_store_id text,p_store_name text,p_amount numeric,p_paid_at date,p_method text,p_reference text,p_note text default null
)
returns table(id uuid,allocated_amount numeric,unapplied_amount numeric,already_recorded boolean,created_at timestamptz)
language plpgsql security definer set search_path=public
as $$
declare
  v_role text:=public.ecoflow_active_app_role(); v_store text:=nullif(trim(coalesce(p_store_id,'')), '');
  v_ref text:=nullif(trim(coalesce(p_reference,'')), ''); v_id uuid; v_remaining numeric; v_apply numeric; r record; v_existing public.ecoflow_customer_payment_receipts%rowtype;
begin
  if v_role not in ('OWNER','ADMIN','ACCOUNT') then raise exception 'OFFICE_ROLE_REQUIRED'; end if;
  if v_store is null or p_amount is null or p_amount<=0 or v_ref is null then raise exception 'STORE_AMOUNT_REFERENCE_REQUIRED'; end if;
  select * into v_existing from public.ecoflow_customer_payment_receipts x where x.store_id=v_store and x.payment_reference=v_ref;
  if found then
    if v_existing.amount<>round(p_amount,2) then raise exception 'PAYMENT_REFERENCE_ALREADY_USED_WITH_DIFFERENT_AMOUNT'; end if;
    return query select v_existing.id,v_existing.allocated_amount,v_existing.unapplied_amount,true,v_existing.created_at; return;
  end if;
  v_id:=gen_random_uuid(); v_remaining:=round(p_amount,2);
  insert into public.ecoflow_customer_payment_receipts(id,store_id,store_name,paid_at,amount,payment_method,payment_reference,payment_note,created_by)
  values(v_id,v_store,nullif(trim(coalesce(p_store_name,'')),''),coalesce(p_paid_at,current_date),round(p_amount,2),upper(coalesce(nullif(trim(p_method),''),'BANK_TRANSFER')),v_ref,nullif(trim(coalesce(p_note,'')),''),auth.uid());
  for r in select l.internal_order_id,l.invoice_number,l.outstanding_amount from public.v_ecoflow_accounts_live_statement_lines l
           where l.store_id=v_store and l.outstanding_amount>0 order by l.due_at asc nulls last,l.order_ts asc loop
    exit when v_remaining<=0;
    v_apply:=least(v_remaining,r.outstanding_amount);
    insert into public.ecoflow_customer_payment_allocations(receipt_id,store_id,internal_order_id,invoice_number,allocated_amount)
    values(v_id,v_store,r.internal_order_id,r.invoice_number,v_apply);
    v_remaining:=v_remaining-v_apply;
  end loop;
  update public.ecoflow_customer_payment_receipts x set allocated_amount=round(p_amount,2)-v_remaining,unapplied_amount=v_remaining where x.id=v_id;
  insert into public.ecoflow_accounts_statement_actions(store_id,action,action_note,action_value,action_status,action_by)
  values(v_store,'MARK_REVIEWED',coalesce(nullif(trim(p_note),''),'Payment recorded'),v_ref,'PAYMENT_ALLOCATED',auth.uid());
  return query select x.id,x.allocated_amount,x.unapplied_amount,false,x.created_at from public.ecoflow_customer_payment_receipts x where x.id=v_id;
end;
$$;

grant execute on function public.ecoflow_record_customer_payment(text,text,numeric,date,text,text,text) to authenticated;
revoke execute on function public.ecoflow_record_customer_payment(text,text,numeric,date,text,text,text) from anon;

-- Private statement PDF bucket. Edge Function writes; office roles receive signed read links.
insert into storage.buckets(id,name,public) values('account-statements','account-statements',false)
on conflict(id) do update set public=false;

drop policy if exists ecoflow_account_statements_office_read on storage.objects;
create policy ecoflow_account_statements_office_read on storage.objects for select to authenticated
using(bucket_id='account-statements' and public.ecoflow_active_app_role() in ('OWNER','ADMIN','ACCOUNT'));

-- ---------------------------------------------------------------------------
-- Historical delivery runs
-- ---------------------------------------------------------------------------
create or replace view public.v_ecoflow_delivery_run_catalog
with (security_invoker=true)
as
with run_rows as (
  select d.business_day,(regexp_match(d.scope,'^run:([A-Z]+):'))[1] run_code,d.scope,d.payload,d.updated_by,d.updated_at
  from public.ecoflow_day_state d where d.scope~'^run:[A-Z]+:'
), grouped as (
  select business_day,run_code,
    max(updated_at) last_updated_at,
    max(updated_by) filter(where scope='run:'||run_code||':meta') route_locked_by,
    max(nullif(payload->>'lockedAt','')) filter(where scope='run:'||run_code||':meta') route_locked_at,
    max(nullif(payload->>'startedAt','')) filter(where scope='run:'||run_code||':route') route_started_at,
    max(nullif(payload->>'endedAt','')) filter(where scope='run:'||run_code||':route') route_ended_at,
    count(*) filter(where scope like 'run:'||run_code||':release:%' and nullif(payload->>'releasedAt','') is not null)::integer released_stops,
    count(*) filter(where scope like 'run:'||run_code||':stop:%' and payload->>'status'='DELIVERED')::integer delivered_stops,
    count(*) filter(where scope like 'run:'||run_code||':stop:%' and payload->>'status'='FAILED')::integer failed_stops,
    count(*) filter(where scope like 'run:'||run_code||':stage:%' and nullif(payload->>'stagedAt','') is not null)::integer staged_stops
  from run_rows group by business_day,run_code
), locations as (
  select l.business_day,l.route_id,count(*)::integer location_samples,count(distinct l.driver_user_id)::integer driver_count,
    min(l.captured_at) first_location_at,max(l.captured_at) last_location_at
  from public.ecoflow_driver_location_samples l group by l.business_day,l.route_id
)
select g.business_day,g.run_code,'RUN-'||replace(g.business_day,'-','')||'-'||g.run_code route_id,
  g.route_locked_at::timestamptz,g.route_started_at::timestamptz,g.route_ended_at::timestamptz,g.route_locked_by,
  g.released_stops,g.staged_stops,g.delivered_stops,g.failed_stops,
  case when g.route_ended_at is not null then 'COMPLETED'
       when g.route_started_at is not null then 'IN_PROGRESS'
       when g.route_locked_at is not null then 'LOCKED'
       when g.released_stops>0 then 'PLANNING' else 'EMPTY' end run_status,
  coalesce(l.location_samples,0) location_samples,coalesce(l.driver_count,0) driver_count,l.first_location_at,l.last_location_at,g.last_updated_at
from grouped g left join locations l on l.business_day::text=g.business_day::text and l.route_id='RUN-'||replace(g.business_day::text,'-','')||'-'||g.run_code;

grant select on public.v_ecoflow_delivery_run_catalog to authenticated;

create or replace view public.v_ecoflow_delivery_run_stop_history
with (security_invoker=true)
as
with stop_rows as (
  select d.business_day,(regexp_match(d.scope,'^run:([A-Z]+):stop:(.+)$'))[1] run_code,
    (regexp_match(d.scope,'^run:([A-Z]+):stop:(.+)$'))[2] order_id,d.payload,d.updated_by,d.updated_at
  from public.ecoflow_day_state d where d.scope~'^run:[A-Z]+:stop:'
), release_rows as (
  select d.business_day,(regexp_match(d.scope,'^run:([A-Z]+):release:(.+)$'))[1] run_code,
    (regexp_match(d.scope,'^run:([A-Z]+):release:(.+)$'))[2] order_id,d.payload,d.updated_at
  from public.ecoflow_day_state d where d.scope~'^run:[A-Z]+:release:' and nullif(d.payload->>'releasedAt','') is not null
), meta as (
  select d.business_day,(regexp_match(d.scope,'^run:([A-Z]+):meta$'))[1] run_code,d.payload
  from public.ecoflow_day_state d where d.scope~'^run:[A-Z]+:meta$'
), all_orders as (
  select r.business_day,r.run_code,r.order_id,coalesce(s.payload,'{}'::jsonb) progress,r.updated_at release_updated_at,
    coalesce(s.updated_at,r.updated_at) updated_at,m.payload meta
  from release_rows r left join stop_rows s using(business_day,run_code,order_id)
  left join meta m using(business_day,run_code)
), sequenced as (
  select a.*,
    coalesce((select ord::integer from jsonb_array_elements_text(coalesce(a.meta->'stopOrder','[]'::jsonb)) with ordinality x(value,ord) where x.value=a.order_id limit 1),9999) stop_number,
    coalesce(a.meta->'boxCodes'->>a.order_id,'') box_code
  from all_orders a
)
select s.business_day,s.run_code,'RUN-'||replace(s.business_day,'-','')||'-'||s.run_code route_id,s.order_id,s.stop_number,s.box_code,
  coalesce(nullif(o.retailer_name,''),nullif(site.store_name,''),s.order_id) store_name,
  coalesce(nullif(site.formatted_address,''),concat_ws(', ',nullif(site.street1,''),nullif(site.suburb,''),nullif(site.state,''),nullif(site.postcode,''))) address,
  site.suburb,site.latitude,site.longitude,o.order_number,
  coalesce(s.progress->>'status','PENDING') stop_status,
  nullif(s.progress->>'arrivedAt','')::timestamptz arrived_at,
  nullif(s.progress->>'completedAt','')::timestamptz completed_at,
  s.progress->'exception'->>'reason' exception_reason,
  s.progress->'pod'->>'pod1Path' pod1_path,s.progress->'pod'->>'pod2Path' pod2_path,s.updated_at
from sequenced s
left join public.om_orders o on o.id::text=s.order_id or o.order_number::text=s.order_id
left join public.ecoflow_store_sites site on site.retailer_id::text=o.retailer_id::text
order by s.business_day desc,s.run_code,s.stop_number,s.order_id;

grant select on public.v_ecoflow_delivery_run_stop_history to authenticated;

create or replace view public.v_ecoflow_delivery_run_timeline
with (security_invoker=true)
as
select c.business_day,c.run_code,c.route_id,'ROUTE_LOCKED' event_type,c.route_locked_at event_at,null::text order_id,c.route_locked_by actor
from public.v_ecoflow_delivery_run_catalog c where c.route_locked_at is not null
union all
select c.business_day,c.run_code,c.route_id,'ROUTE_STARTED',c.route_started_at,null::text,null::text
from public.v_ecoflow_delivery_run_catalog c where c.route_started_at is not null
union all
select s.business_day,s.run_code,s.route_id,'STOP_'||s.stop_status,coalesce(s.completed_at,s.arrived_at),s.order_id,null::text
from public.v_ecoflow_delivery_run_stop_history s where coalesce(s.completed_at,s.arrived_at) is not null
union all
select c.business_day,c.run_code,c.route_id,'ROUTE_ENDED',c.route_ended_at,null::text,null::text
from public.v_ecoflow_delivery_run_catalog c where c.route_ended_at is not null;

grant select on public.v_ecoflow_delivery_run_timeline to authenticated;

notify pgrst,'reload schema';
