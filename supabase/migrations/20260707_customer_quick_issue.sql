-- Customer quick issue workflow.
-- Used when warehouse temporarily gives stock to a customer outside the normal Ordermentum/order flow.
-- It deducts warehouse stock immediately and leaves a TO_BILL record for Accounts.

create extension if not exists pgcrypto;

create table if not exists public.ecoflow_customer_stock_issues (
  id uuid primary key default gen_random_uuid(),
  issue_no text not null unique default ('QI-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  customer_name text not null,
  customer_reference text,
  sku text not null,
  product_name text,
  barcode text,
  unit_level text not null default 'carton' check (unit_level in ('carton','sleeve','each','unknown')),
  quantity numeric(14,2) not null check (quantity > 0),
  location_id uuid references public.ecoflow_warehouse_locations(id) on delete set null,
  location_code text,
  note text,
  bill_status text not null default 'TO_BILL' check (bill_status in ('TO_BILL','BILLED','NO_CHARGE','CANCELLED')),
  billing_note text,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ecoflow_customer_stock_issues_to_bill on public.ecoflow_customer_stock_issues(bill_status, created_at desc);
create index if not exists idx_ecoflow_customer_stock_issues_customer on public.ecoflow_customer_stock_issues(lower(customer_name), created_at desc);
create index if not exists idx_ecoflow_customer_stock_issues_sku on public.ecoflow_customer_stock_issues(upper(sku), created_at desc);

drop trigger if exists trg_ecoflow_customer_stock_issues_updated_at on public.ecoflow_customer_stock_issues;
create trigger trg_ecoflow_customer_stock_issues_updated_at
before update on public.ecoflow_customer_stock_issues
for each row execute function public.ecoflow_warehouse_touch_updated_at();

create or replace function public.ecoflow_can_manage_billing()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_user_profiles p
    where p.user_id = auth.uid()
      and p.is_active = true
      and p.team_status = 'ACTIVE'
      and p.app_role in ('OWNER','ADMIN','ACCOUNT')
  );
$$;

alter table public.ecoflow_customer_stock_issues enable row level security;

drop policy if exists ecoflow_customer_stock_issues_read on public.ecoflow_customer_stock_issues;
create policy ecoflow_customer_stock_issues_read on public.ecoflow_customer_stock_issues
for select using (public.ecoflow_can_read_warehouse() or public.ecoflow_can_manage_billing());

drop policy if exists ecoflow_customer_stock_issues_insert on public.ecoflow_customer_stock_issues;
create policy ecoflow_customer_stock_issues_insert on public.ecoflow_customer_stock_issues
for insert with check (public.ecoflow_can_manage_warehouse());

drop policy if exists ecoflow_customer_stock_issues_billing_update on public.ecoflow_customer_stock_issues;
create policy ecoflow_customer_stock_issues_billing_update on public.ecoflow_customer_stock_issues
for update using (public.ecoflow_can_manage_billing()) with check (public.ecoflow_can_manage_billing());

create or replace view public.v_ecoflow_customer_stock_issues_to_bill as
select
  id,
  issue_no,
  customer_name,
  customer_reference,
  sku,
  product_name,
  barcode,
  unit_level,
  quantity,
  location_code,
  note,
  bill_status,
  billing_note,
  created_at,
  updated_at
from public.ecoflow_customer_stock_issues
where bill_status = 'TO_BILL'
order by created_at desc;

grant select on public.v_ecoflow_customer_stock_issues_to_bill to authenticated;

create or replace function public.ecoflow_record_customer_stock_issue(
  p_customer_name text,
  p_sku text,
  p_quantity numeric,
  p_unit_level text default 'carton',
  p_barcode text default null,
  p_note text default null,
  p_location_code text default null,
  p_customer_reference text default null,
  p_product_name text default null
)
returns table(issue_id uuid, issue_no text, location_code text, sku text, issued_quantity numeric, remaining_quantity numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_needed numeric;
  v_take numeric;
  v_total_available numeric;
  v_row record;
  v_unit_level text;
  v_issue_id uuid;
  v_issue_no text;
begin
  if not public.ecoflow_can_manage_warehouse() then
    raise exception 'OWNER_ADMIN_OR_WAREHOUSE_REQUIRED';
  end if;

  if coalesce(trim(p_customer_name), '') = '' then
    raise exception 'CUSTOMER_NAME_REQUIRED';
  end if;

  if coalesce(trim(p_sku), '') = '' then
    raise exception 'SKU_REQUIRED';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'POSITIVE_QUANTITY_REQUIRED';
  end if;

  v_needed := p_quantity;
  v_unit_level := coalesce(nullif(trim(p_unit_level), ''), 'carton');

  select coalesce(sum(i.quantity), 0) into v_total_available
  from public.ecoflow_warehouse_location_items i
  join public.ecoflow_warehouse_locations l on l.id = i.location_id
  where upper(i.sku) = upper(trim(p_sku))
    and i.status = 'ACTIVE'
    and i.quantity > 0
    and (p_location_code is null or trim(p_location_code) = '' or upper(l.location_code) = upper(trim(p_location_code)))
    and (
      i.unit_level = v_unit_level
      or not exists (
        select 1
        from public.ecoflow_warehouse_location_items exact_i
        where upper(exact_i.sku) = upper(trim(p_sku))
          and exact_i.status = 'ACTIVE'
          and exact_i.quantity > 0
          and exact_i.unit_level = v_unit_level
      )
    );

  if v_total_available < p_quantity then
    raise exception 'STOCK_SHORTAGE: % % requested, % available', p_quantity, trim(p_sku), v_total_available;
  end if;

  for v_row in
    select i.id as item_id, i.location_id, i.sku, i.product_name, i.source_barcode, i.unit_level, i.quantity, l.location_code, l.sort_order
    from public.ecoflow_warehouse_location_items i
    join public.ecoflow_warehouse_locations l on l.id = i.location_id
    where upper(i.sku) = upper(trim(p_sku))
      and i.status = 'ACTIVE'
      and i.quantity > 0
      and (p_location_code is null or trim(p_location_code) = '' or upper(l.location_code) = upper(trim(p_location_code)))
      and (
        i.unit_level = v_unit_level
        or not exists (
          select 1
          from public.ecoflow_warehouse_location_items exact_i
          where upper(exact_i.sku) = upper(trim(p_sku))
            and exact_i.status = 'ACTIVE'
            and exact_i.quantity > 0
            and exact_i.unit_level = v_unit_level
        )
      )
    order by case when p_location_code is not null and upper(l.location_code) = upper(trim(p_location_code)) then 0 else 1 end,
             case when l.location_code = 'TEMP' then 1 else 0 end,
             l.sort_order,
             i.updated_at
  loop
    exit when v_needed <= 0;
    v_take := least(v_needed, v_row.quantity);

    update public.ecoflow_warehouse_location_items
    set quantity = quantity - v_take,
        status = case when quantity - v_take <= 0 then 'ZEROED' else 'ACTIVE' end,
        last_movement_at = now(),
        last_note = coalesce(p_note, 'Customer quick issue'),
        updated_at = now()
    where id = v_row.item_id;

    insert into public.ecoflow_customer_stock_issues (
      customer_name,
      customer_reference,
      sku,
      product_name,
      barcode,
      unit_level,
      quantity,
      location_id,
      location_code,
      note,
      bill_status,
      actor_user_id
    ) values (
      trim(p_customer_name),
      nullif(trim(p_customer_reference), ''),
      v_row.sku,
      coalesce(nullif(trim(p_product_name), ''), v_row.product_name),
      coalesce(nullif(trim(p_barcode), ''), v_row.source_barcode),
      v_row.unit_level,
      v_take,
      v_row.location_id,
      v_row.location_code,
      p_note,
      'TO_BILL',
      auth.uid()
    ) returning id, public.ecoflow_customer_stock_issues.issue_no into v_issue_id, v_issue_no;

    insert into public.ecoflow_warehouse_movements (movement_type, location_id, from_location_id, sku, product_name, barcode, unit_level, quantity, note, actor_user_id)
    values ('PICK', v_row.location_id, v_row.location_id, v_row.sku, coalesce(nullif(trim(p_product_name), ''), v_row.product_name), coalesce(nullif(trim(p_barcode), ''), v_row.source_barcode), v_row.unit_level, -v_take, 'Customer quick issue · ' || trim(p_customer_name) || coalesce(' · ' || nullif(trim(p_note), ''), ''), auth.uid());

    v_needed := v_needed - v_take;
    return query select v_issue_id, v_issue_no, v_row.location_code, v_row.sku, v_take, v_row.quantity - v_take;
  end loop;
end;
$$;

grant execute on function public.ecoflow_record_customer_stock_issue(text, text, numeric, text, text, text, text, text, text) to authenticated;
