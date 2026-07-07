-- Adds fulfilment choice for temporary customer stock drawdowns.
-- OWNER_ONSITE: boss/customer takes it immediately; do not release to warehouse/driver.
-- OPS_DELIVERY: warehouse/driver needs to pick and deliver; record operational status and delivery details.

alter table public.ecoflow_customer_stock_issues
  add column if not exists fulfilment_mode text not null default 'OWNER_ONSITE';

alter table public.ecoflow_customer_stock_issues
  add column if not exists ops_status text not null default 'NOT_RELEASED';

alter table public.ecoflow_customer_stock_issues
  add column if not exists delivery_required boolean not null default false;

alter table public.ecoflow_customer_stock_issues
  add column if not exists delivery_address text;

alter table public.ecoflow_customer_stock_issues
  add column if not exists driver_note text;

alter table public.ecoflow_customer_stock_issues
  add column if not exists released_at timestamptz;

alter table public.ecoflow_customer_stock_issues
  drop constraint if exists ecoflow_customer_stock_issues_fulfilment_mode_check;

alter table public.ecoflow_customer_stock_issues
  add constraint ecoflow_customer_stock_issues_fulfilment_mode_check
  check (fulfilment_mode in ('OWNER_ONSITE','OPS_DELIVERY'));

alter table public.ecoflow_customer_stock_issues
  drop constraint if exists ecoflow_customer_stock_issues_ops_status_check;

alter table public.ecoflow_customer_stock_issues
  add constraint ecoflow_customer_stock_issues_ops_status_check
  check (ops_status in ('NOT_RELEASED','RELEASED_TO_WAREHOUSE','PICKED','OUT_FOR_DELIVERY','DELIVERED','CANCELLED'));

create index if not exists idx_ecoflow_customer_stock_issues_ops on public.ecoflow_customer_stock_issues(ops_status, released_at desc, created_at desc);

-- PostgreSQL cannot CREATE OR REPLACE a view when column order/names change.
-- Drop the old TO_BILL view first, then recreate it with the new fulfilment columns.
drop view if exists public.v_ecoflow_customer_stock_issues_ops_queue;
drop view if exists public.v_ecoflow_customer_stock_issues_to_bill;

create view public.v_ecoflow_customer_stock_issues_to_bill as
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
  fulfilment_mode,
  ops_status,
  delivery_required,
  delivery_address,
  driver_note,
  released_at,
  bill_status,
  billing_note,
  created_at,
  updated_at
from public.ecoflow_customer_stock_issues
where bill_status = 'TO_BILL'
order by created_at desc;

grant select on public.v_ecoflow_customer_stock_issues_to_bill to authenticated;

create view public.v_ecoflow_customer_stock_issues_ops_queue as
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
  delivery_address,
  driver_note,
  ops_status,
  bill_status,
  released_at,
  created_at
from public.ecoflow_customer_stock_issues
where fulfilment_mode = 'OPS_DELIVERY'
  and ops_status in ('RELEASED_TO_WAREHOUSE','PICKED','OUT_FOR_DELIVERY')
order by released_at nulls last, created_at desc;

grant select on public.v_ecoflow_customer_stock_issues_ops_queue to authenticated;

-- Replace both the original 9-argument quick issue RPC and the new 12-argument signature.
drop function if exists public.ecoflow_record_customer_stock_issue(text, text, numeric, text, text, text, text, text, text);
drop function if exists public.ecoflow_record_customer_stock_issue(text, text, numeric, text, text, text, text, text, text, text, text, text);

create function public.ecoflow_record_customer_stock_issue(
  p_customer_name text,
  p_sku text,
  p_quantity numeric,
  p_unit_level text default 'carton',
  p_barcode text default null,
  p_note text default null,
  p_location_code text default null,
  p_customer_reference text default null,
  p_product_name text default null,
  p_fulfilment_mode text default 'OWNER_ONSITE',
  p_delivery_address text default null,
  p_driver_note text default null
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
  v_mode text;
  v_ops_status text;
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
  v_mode := case when upper(coalesce(trim(p_fulfilment_mode), 'OWNER_ONSITE')) = 'OPS_DELIVERY' then 'OPS_DELIVERY' else 'OWNER_ONSITE' end;
  v_ops_status := case when v_mode = 'OPS_DELIVERY' then 'RELEASED_TO_WAREHOUSE' else 'NOT_RELEASED' end;

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
        last_note = coalesce(p_note, 'Customer stock drawdown'),
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
      fulfilment_mode,
      ops_status,
      delivery_required,
      delivery_address,
      driver_note,
      released_at,
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
      v_mode,
      v_ops_status,
      v_mode = 'OPS_DELIVERY',
      nullif(trim(p_delivery_address), ''),
      nullif(trim(p_driver_note), ''),
      case when v_mode = 'OPS_DELIVERY' then now() else null end,
      'TO_BILL',
      auth.uid()
    ) returning id, public.ecoflow_customer_stock_issues.issue_no into v_issue_id, v_issue_no;

    insert into public.ecoflow_warehouse_movements (movement_type, location_id, from_location_id, sku, product_name, barcode, unit_level, quantity, note, actor_user_id)
    values ('PICK', v_row.location_id, v_row.location_id, v_row.sku, coalesce(nullif(trim(p_product_name), ''), v_row.product_name), coalesce(nullif(trim(p_barcode), ''), v_row.source_barcode), v_row.unit_level, -v_take, 'Customer stock drawdown · ' || v_mode || ' · ' || trim(p_customer_name) || coalesce(' · ' || nullif(trim(p_note), ''), ''), auth.uid());

    v_needed := v_needed - v_take;
    return query select v_issue_id, v_issue_no, v_row.location_code, v_row.sku, v_take, v_row.quantity - v_take;
  end loop;
end;
$$;

grant execute on function public.ecoflow_record_customer_stock_issue(text, text, numeric, text, text, text, text, text, text, text, text, text) to authenticated;
