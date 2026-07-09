-- Accounts statement workbench.
-- This turns the imported Ordermentum invoices/orders into an Accounts control surface:
-- AR KPIs, customer statements, invoice lines, follow-up queue, export-friendly rows,
-- and an audited statement action workflow.

create table if not exists public.ecoflow_accounts_statement_actions (
  id uuid primary key default gen_random_uuid(),
  store_id text not null,
  action text not null check (action in (
    'MARK_REVIEWED',
    'SEND_STATEMENT_DRAFT',
    'PROMISE_TO_PAY',
    'DISPUTE_RAISED',
    'HOLD_ACCOUNT',
    'CLEAR_HOLD'
  )),
  action_note text,
  action_value text,
  action_status text not null default 'RECORDED',
  action_by uuid default auth.uid(),
  action_at timestamptz not null default now()
);

create index if not exists idx_accounts_statement_actions_store on public.ecoflow_accounts_statement_actions(store_id);
create index if not exists idx_accounts_statement_actions_action_at on public.ecoflow_accounts_statement_actions(action_at desc);

grant select, insert on public.ecoflow_accounts_statement_actions to authenticated;

create or replace function public.ecoflow_record_accounts_statement_action(
  p_store_id text,
  p_action text,
  p_note text default null,
  p_value text default null
)
returns table (
  id uuid,
  store_id text,
  action text,
  action_status text,
  action_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id text := nullif(trim(coalesce(p_store_id, '')), '');
  v_action text := upper(trim(coalesce(p_action, '')));
  v_id uuid;
begin
  if v_store_id is null or v_store_id = 'UNKNOWN' then
    raise exception 'valid store_id is required';
  end if;
  if v_action not in ('MARK_REVIEWED','SEND_STATEMENT_DRAFT','PROMISE_TO_PAY','DISPUTE_RAISED','HOLD_ACCOUNT','CLEAR_HOLD') then
    raise exception 'unsupported accounts statement action: %', p_action;
  end if;

  insert into public.ecoflow_accounts_statement_actions (
    store_id,
    action,
    action_note,
    action_value,
    action_status,
    action_by,
    action_at
  ) values (
    v_store_id,
    v_action,
    nullif(trim(coalesce(p_note, '')), ''),
    nullif(trim(coalesce(p_value, '')), ''),
    case
      when v_action = 'SEND_STATEMENT_DRAFT' then 'DRAFT_RECORDED'
      when v_action = 'PROMISE_TO_PAY' then 'PROMISE_RECORDED'
      when v_action = 'DISPUTE_RAISED' then 'DISPUTE_RECORDED'
      when v_action = 'HOLD_ACCOUNT' then 'ACCOUNT_HOLD_RECORDED'
      when v_action = 'CLEAR_HOLD' then 'ACCOUNT_HOLD_CLEARED'
      else 'REVIEW_RECORDED'
    end,
    auth.uid(),
    now()
  ) returning ecoflow_accounts_statement_actions.id into v_id;

  return query
  select a.id, a.store_id, a.action, a.action_status, a.action_at
  from public.ecoflow_accounts_statement_actions a
  where a.id = v_id;
end;
$$;

grant execute on function public.ecoflow_record_accounts_statement_action(text, text, text, text) to authenticated;

drop view if exists public.v_ecoflow_accounts_statement_latest_actions;
drop view if exists public.v_ecoflow_accounts_followup_queue;
drop view if exists public.v_ecoflow_accounts_statement_export;
drop view if exists public.v_ecoflow_accounts_statement_lines;
drop view if exists public.v_ecoflow_accounts_statement_customers;
drop view if exists public.v_ecoflow_accounts_ar_kpis;

create view public.v_ecoflow_accounts_statement_latest_actions as
select distinct on (store_id)
  store_id,
  action as latest_action,
  action_status as latest_action_status,
  action_note as latest_action_note,
  action_value as latest_action_value,
  action_at as latest_action_at
from public.ecoflow_accounts_statement_actions
order by store_id, action_at desc;

grant select on public.v_ecoflow_accounts_statement_latest_actions to authenticated;

create view public.v_ecoflow_accounts_statement_lines as
select
  s.store_id,
  s.store_name,
  s.internal_order_id,
  s.order_number,
  s.invoice_number,
  s.order_ts,
  s.due_at,
  s.invoice_value,
  s.age_days,
  s.overdue_days,
  s.statement_status,
  s.order_status,
  s.account_release_status,
  s.warehouse_gate_status,
  case
    when s.statement_status = 'OVERDUE' and s.overdue_days >= 30 then 'OVERDUE_30_PLUS'
    when s.statement_status = 'OVERDUE' then 'OVERDUE'
    when s.statement_status = 'OPEN' and s.due_at <= now() + interval '7 days' then 'DUE_THIS_WEEK'
    when s.statement_status = 'OPEN' then 'OPEN'
    else s.statement_status
  end as accounts_signal
from public.v_ecoflow_owner_store_statement s
where s.statement_status <> 'VOID_OR_CANCELLED'
order by
  case when s.statement_status = 'OVERDUE' then 0 when s.statement_status = 'OPEN' then 1 else 2 end,
  s.due_at asc nulls last,
  s.order_ts desc nulls last;

grant select on public.v_ecoflow_accounts_statement_lines to authenticated;

create view public.v_ecoflow_accounts_statement_customers as
select
  c.store_id,
  c.store_name,
  p.suburb,
  p.address,
  p.contact_phone,
  p.price_group_id,
  c.invoice_count,
  c.open_invoice_count,
  c.overdue_invoice_count,
  c.total_statement_value,
  c.open_statement_value,
  c.overdue_statement_value,
  c.statement_value_30d,
  c.latest_invoice_at,
  c.worst_overdue_days,
  c.statement_signal,
  p.orders_30d,
  p.revenue_30d as order_revenue_30d,
  p.top_sku_30d,
  p.top_product_30d,
  a.latest_action,
  a.latest_action_status,
  a.latest_action_note,
  a.latest_action_at,
  case
    when a.latest_action = 'HOLD_ACCOUNT' then 'ON_HOLD'
    when c.statement_signal = 'OVERDUE_ATTENTION' and coalesce(c.worst_overdue_days, 0) >= 30 then 'URGENT_COLLECTION'
    when c.statement_signal = 'OVERDUE_ATTENTION' then 'COLLECTION'
    when c.statement_signal = 'OPEN_BALANCE' then 'SEND_STATEMENT'
    else 'CLEAR'
  end as accounts_priority
from public.v_ecoflow_owner_store_statement_summary c
left join public.v_ecoflow_owner_store_performance p on p.store_id = c.store_id
left join public.v_ecoflow_accounts_statement_latest_actions a on a.store_id = c.store_id
order by
  case
    when a.latest_action = 'HOLD_ACCOUNT' then 0
    when c.statement_signal = 'OVERDUE_ATTENTION' and coalesce(c.worst_overdue_days, 0) >= 30 then 1
    when c.statement_signal = 'OVERDUE_ATTENTION' then 2
    when c.statement_signal = 'OPEN_BALANCE' then 3
    else 4
  end,
  c.open_statement_value desc;

grant select on public.v_ecoflow_accounts_statement_customers to authenticated;

create view public.v_ecoflow_accounts_ar_kpis as
select
  coalesce(sum(open_statement_value), 0)::numeric as open_ar_value,
  coalesce(sum(overdue_statement_value), 0)::numeric as overdue_ar_value,
  count(*) filter (where open_statement_value > 0)::numeric as open_customers,
  count(*) filter (where overdue_statement_value > 0)::numeric as overdue_customers,
  coalesce(sum(open_invoice_count), 0)::numeric as open_invoices,
  coalesce(sum(overdue_invoice_count), 0)::numeric as overdue_invoices,
  coalesce(sum(statement_value_30d), 0)::numeric as statement_value_30d,
  coalesce(max(worst_overdue_days), 0)::numeric as worst_overdue_days,
  count(*) filter (where accounts_priority = 'URGENT_COLLECTION')::numeric as urgent_customers,
  count(*) filter (where accounts_priority = 'ON_HOLD')::numeric as held_customers,
  max(latest_invoice_at) as latest_invoice_at
from public.v_ecoflow_accounts_statement_customers;

grant select on public.v_ecoflow_accounts_ar_kpis to authenticated;

create view public.v_ecoflow_accounts_statement_export as
select
  l.store_name,
  l.store_id,
  l.invoice_number,
  l.order_number,
  l.order_ts::date as invoice_date,
  l.due_at::date as due_date,
  l.invoice_value,
  l.statement_status,
  l.overdue_days,
  l.accounts_signal,
  l.order_status,
  c.accounts_priority,
  c.latest_action,
  c.latest_action_at
from public.v_ecoflow_accounts_statement_lines l
left join public.v_ecoflow_accounts_statement_customers c on c.store_id = l.store_id
order by l.store_name, l.due_at asc nulls last, l.invoice_number;

grant select on public.v_ecoflow_accounts_statement_export to authenticated;

create view public.v_ecoflow_accounts_followup_queue as
select
  c.store_id,
  c.store_name,
  c.suburb,
  c.contact_phone,
  c.open_invoice_count,
  c.overdue_invoice_count,
  c.open_statement_value,
  c.overdue_statement_value,
  c.worst_overdue_days,
  c.statement_signal,
  c.accounts_priority,
  c.latest_action,
  c.latest_action_status,
  c.latest_action_at,
  case
    when c.accounts_priority = 'ON_HOLD' then 'CHECK_ACCOUNT_HOLD'
    when c.accounts_priority = 'URGENT_COLLECTION' then 'CALL_AND_ESCALATE'
    when c.accounts_priority = 'COLLECTION' then 'SEND_REMINDER'
    when c.accounts_priority = 'SEND_STATEMENT' then 'SEND_STATEMENT'
    else 'NO_ACTION'
  end as next_action
from public.v_ecoflow_accounts_statement_customers c
where c.accounts_priority <> 'CLEAR'
order by
  case c.accounts_priority
    when 'ON_HOLD' then 0
    when 'URGENT_COLLECTION' then 1
    when 'COLLECTION' then 2
    when 'SEND_STATEMENT' then 3
    else 4
  end,
  c.overdue_statement_value desc,
  c.open_statement_value desc;

grant select on public.v_ecoflow_accounts_followup_queue to authenticated;

notify pgrst, 'reload schema';
