-- Accounts may manage EcoFlow workflow and release holds, but invoice/payment
-- facts remain sourced from Ordermentum. This migration restores the missing
-- workflow RPC, makes holds durable, and rebuilds statement snapshots without
-- reading retired local payment-allocation tables.

begin;

create table if not exists public.ecoflow_account_release_holds (
  store_id text primary key,
  active boolean not null default true,
  hold_reason text,
  source_action_id uuid,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

alter table public.ecoflow_account_release_holds enable row level security;
revoke all on public.ecoflow_account_release_holds from anon, authenticated;
grant select on public.ecoflow_account_release_holds to authenticated;
grant all on public.ecoflow_account_release_holds to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='ecoflow_account_release_holds'
      and policyname='ecoflow_account_release_holds_office_read'
  ) then
    create policy ecoflow_account_release_holds_office_read
      on public.ecoflow_account_release_holds for select to authenticated
      using (public.ecoflow_active_app_role() in ('OWNER','ADMIN','ACCOUNT'));
  end if;
end $$;

create or replace function public.ecoflow_record_accounts_statement_action(
  p_store_id text,
  p_action text,
  p_note text default null,
  p_value text default null
)
returns table(
  id uuid,
  store_id text,
  action text,
  action_status text,
  action_at timestamptz
)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_role text := public.ecoflow_active_app_role();
  v_store text := nullif(trim(coalesce(p_store_id,'')), '');
  v_action text := upper(nullif(trim(coalesce(p_action,'')), ''));
  v_note text := nullif(trim(coalesce(p_note,'')), '');
  v_value text := nullif(trim(coalesce(p_value,'')), '');
  v_id uuid := gen_random_uuid();
  v_status text := 'RECORDED';
begin
  if v_role not in ('OWNER','ADMIN','ACCOUNT') then
    raise exception 'OFFICE_ROLE_REQUIRED';
  end if;
  if v_store is null then raise exception 'STORE_REQUIRED'; end if;
  if v_action not in (
    'MARK_REVIEWED','SEND_STATEMENT_DRAFT','PROMISE_TO_PAY',
    'DISPUTE_RAISED','HOLD_ACCOUNT','CLEAR_HOLD'
  ) then
    raise exception 'UNSUPPORTED_ACCOUNTS_ACTION';
  end if;

  if v_action='HOLD_ACCOUNT' then
    v_status := 'ON_HOLD';
  elsif v_action='CLEAR_HOLD' then
    v_status := 'HOLD_CLEARED';
  elsif v_action='PROMISE_TO_PAY' then
    v_status := 'PROMISE_RECORDED';
  elsif v_action='DISPUTE_RAISED' then
    v_status := 'DISPUTE_OPEN';
  elsif v_action='MARK_REVIEWED' then
    v_status := 'REVIEWED';
  end if;

  insert into public.ecoflow_accounts_statement_actions(
    id,store_id,action,action_note,action_value,action_status,action_by,action_at
  ) values (
    v_id,v_store,v_action,v_note,v_value,v_status,auth.uid(),now()
  );

  if v_action='HOLD_ACCOUNT' then
    insert into public.ecoflow_account_release_holds(
      store_id,active,hold_reason,source_action_id,updated_by,updated_at
    ) values (
      v_store,true,coalesce(v_note,'Accounts release hold'),v_id,auth.uid(),now()
    )
    on conflict on constraint ecoflow_account_release_holds_pkey do update set
      active=true,
      hold_reason=excluded.hold_reason,
      source_action_id=excluded.source_action_id,
      updated_by=auth.uid(),
      updated_at=now();
  elsif v_action='CLEAR_HOLD' then
    insert into public.ecoflow_account_release_holds(
      store_id,active,hold_reason,source_action_id,updated_by,updated_at
    ) values (
      v_store,false,coalesce(v_note,'Accounts release hold cleared'),v_id,auth.uid(),now()
    )
    on conflict on constraint ecoflow_account_release_holds_pkey do update set
      active=false,
      hold_reason=excluded.hold_reason,
      source_action_id=excluded.source_action_id,
      updated_by=auth.uid(),
      updated_at=now();
  end if;

  return query
  select a.id,a.store_id,a.action,a.action_status,a.action_at
  from public.ecoflow_accounts_statement_actions a
  where a.id=v_id;
end;
$$;

revoke all on function public.ecoflow_record_accounts_statement_action(text,text,text,text) from public, anon;
grant execute on function public.ecoflow_record_accounts_statement_action(text,text,text,text) to authenticated;

-- Replace the statement snapshot with a source-finance calculation. The
-- allocated amount is derived from Ordermentum invoice total minus amount due;
-- retired EcoFlow payment receipts do not alter the statement.
create or replace function public.ecoflow_create_statement_document(
  p_store_id text,
  p_period_start date,
  p_period_end date
)
returns table(
  id uuid,
  statement_number text,
  document_status text,
  closing_balance numeric,
  recipient_email text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_role text := public.ecoflow_active_app_role();
  v_store text := nullif(trim(coalesce(p_store_id,'')), '');
  v_name text;
  v_id uuid := gen_random_uuid();
  v_number text;
  v_opening numeric := 0;
  v_invoices numeric := 0;
  v_payments numeric := 0;
  v_closing numeric := 0;
  v_recipient text;
begin
  if v_role not in ('OWNER','ADMIN','ACCOUNT') then raise exception 'OFFICE_ROLE_REQUIRED'; end if;
  if v_store is null then raise exception 'STORE_REQUIRED'; end if;
  if p_period_start is null or p_period_end is null or p_period_end<p_period_start then
    raise exception 'VALID_STATEMENT_PERIOD_REQUIRED';
  end if;

  select max(c.store_name),max(c.billing_email)
    into v_name,v_recipient
  from public.v_ecoflow_accounts_live_statement_customers c
  where c.store_id=v_store;
  if v_name is null then raise exception 'STORE_STATEMENT_NOT_FOUND'; end if;

  select coalesce(sum(l.outstanding_amount),0)
    into v_opening
  from public.v_ecoflow_accounts_live_statement_lines l
  where l.store_id=v_store and l.order_ts::date<p_period_start;

  select
    coalesce(sum(l.invoice_value),0),
    coalesce(sum(l.allocated_amount),0)
    into v_invoices,v_payments
  from public.v_ecoflow_accounts_live_statement_lines l
  where l.store_id=v_store and l.order_ts::date between p_period_start and p_period_end;

  select coalesce(sum(l.outstanding_amount),0)
    into v_closing
  from public.v_ecoflow_accounts_live_statement_lines l
  where l.store_id=v_store;

  v_number := 'STM-'||to_char(current_date,'YYYYMMDD')||'-'||upper(substr(replace(v_id::text,'-',''),1,8));

  insert into public.ecoflow_statement_documents(
    id,statement_number,store_id,store_name,period_start,period_end,
    issue_date,due_date,opening_balance,period_invoice_total,
    period_payment_total,closing_balance,recipient_email,created_by
  ) values (
    v_id,v_number,v_store,v_name,p_period_start,p_period_end,
    current_date,current_date+14,v_opening,v_invoices,
    v_payments,v_closing,v_recipient,auth.uid()
  );

  insert into public.ecoflow_statement_document_lines(
    statement_id,store_id,internal_order_id,order_number,invoice_number,
    invoice_date,due_date,original_amount,allocated_amount,
    outstanding_amount,line_status
  )
  select
    v_id,l.store_id,l.internal_order_id,l.order_number,l.invoice_number,
    l.order_ts::date,l.due_at::date,l.invoice_value,l.allocated_amount,
    l.outstanding_amount,l.statement_status
  from public.v_ecoflow_accounts_live_statement_lines l
  where l.store_id=v_store and l.outstanding_amount>0
  order by l.due_at,l.order_ts;

  insert into public.ecoflow_accounts_statement_actions(
    store_id,action,action_note,action_value,action_status,action_by
  ) values (
    v_store,'SEND_STATEMENT_DRAFT','Formal statement snapshot created',
    v_number,'STATEMENT_CREATED',auth.uid()
  );

  return query
  select d.id,d.statement_number,d.document_status,d.closing_balance,d.recipient_email,d.created_at
  from public.ecoflow_statement_documents d
  where d.id=v_id;
end;
$$;

revoke all on function public.ecoflow_create_statement_document(text,date,date) from public, anon;
grant execute on function public.ecoflow_create_statement_document(text,date,date) to authenticated;

create or replace view public.v_ecoflow_account_release_holds_v1
with (security_invoker=true)
as
select
  h.store_id,
  h.active,
  h.hold_reason,
  h.source_action_id,
  h.updated_by,
  h.updated_at
from public.ecoflow_account_release_holds h
where h.active;

grant select on public.v_ecoflow_account_release_holds_v1 to authenticated;
revoke all on public.v_ecoflow_account_release_holds_v1 from anon;

-- V5 exposes the effective release decision without rewriting the mirrored
-- Ordermentum or existing fulfilment status fields.
do $$
begin
  if to_regclass('public.v_ecoflow_order_operations_v4') is not null then
    execute $operations$
      create or replace view public.v_ecoflow_order_operations_v5 as
      select
        o.*,
        coalesce(h.active,false) as account_hold_active,
        h.hold_reason as account_hold_reason,
        case when coalesce(h.active,false) then 'CREDIT_HOLD' else o.account_release_status end as effective_account_release_status,
        (o.release_eligible and not coalesce(h.active,false) and o.source_presence_status<>'SOURCE_MISSING') as effective_release_eligible
      from public.v_ecoflow_order_operations_v4 o
      left join public.ecoflow_account_release_holds h
        on h.store_id=o.retailer_id and h.active
    $operations$;

    execute $summary$
      create or replace view public.v_ecoflow_order_operations_summary_v5 as
      select
        count(*)::numeric as total_orders,
        count(*) filter (where operational_scope='CURRENT' and source_presence_status<>'SOURCE_MISSING')::numeric as current_orders,
        count(*) filter (where operational_scope='REVIEW' and source_presence_status<>'SOURCE_MISSING')::numeric as source_review_orders,
        count(*) filter (where effective_release_eligible)::numeric as ready_to_release,
        count(*) filter (
          where operational_scope in ('CURRENT','REVIEW')
            and (
              data_quality_status<>'READY'
              or fulfilment_status='SOURCE_REVIEW'
              or source_presence_status='SOURCE_MISSING'
              or account_hold_active
            )
        )::numeric as blocked_orders,
        count(*) filter (
          where operational_scope='CURRENT'
            and fulfilment_status in ('RELEASED','PICKING','STAGED','OUT_FOR_DELIVERY')
        )::numeric as in_progress_orders,
        count(*) filter (where fulfilment_status='COMPLETED')::numeric as completed_orders,
        count(*) filter (where fulfilment_status='CANCELLED')::numeric as cancelled_orders,
        count(*) filter (where reconciliation_status='SURCHARGE_MATCHED')::numeric as surcharge_invoices,
        count(*) filter (where reconciliation_status in ('REVIEW','MISSING_INVOICE'))::numeric as finance_review_orders,
        count(*) filter (where source_presence_status='SOURCE_MISSING')::numeric as source_missing_orders,
        count(*) filter (where account_hold_active)::numeric as account_hold_orders,
        coalesce(sum(order_value) filter (
          where operational_scope in ('CURRENT','REVIEW')
            and source_presence_status<>'SOURCE_MISSING'
        ),0)::numeric as current_value,
        max(source_updated_at) as latest_source_update,
        max(observed_at) as last_observed_at
      from public.v_ecoflow_order_operations_v5
    $summary$;

    grant select on public.v_ecoflow_order_operations_v5, public.v_ecoflow_order_operations_summary_v5 to authenticated;
    revoke all on public.v_ecoflow_order_operations_v5, public.v_ecoflow_order_operations_summary_v5 from anon;
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
