-- Mobile operations controls for quick customer stock drawdowns.
-- Keeps quick customer deliveries out of the normal A-F label route, but visible to warehouse/driver.

create or replace view public.v_ecoflow_customer_stock_issues_ops_queue as
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
  created_at,
  updated_at
from public.ecoflow_customer_stock_issues
where fulfilment_mode = 'OPS_DELIVERY'
  and ops_status in ('RELEASED_TO_WAREHOUSE','PICKED','OUT_FOR_DELIVERY')
order by
  case ops_status
    when 'RELEASED_TO_WAREHOUSE' then 0
    when 'PICKED' then 1
    when 'OUT_FOR_DELIVERY' then 2
    else 9
  end,
  released_at nulls last,
  created_at desc;

grant select on public.v_ecoflow_customer_stock_issues_ops_queue to authenticated;

create or replace function public.ecoflow_can_manage_customer_issue_ops()
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
      and p.app_role in ('OWNER','ADMIN','WAREHOUSE','DRIVER')
  );
$$;

create or replace function public.ecoflow_update_customer_stock_issue_ops_status(
  p_issue_id uuid,
  p_ops_status text,
  p_note text default null
)
returns table(issue_id uuid, issue_no text, ops_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next text;
  v_issue public.ecoflow_customer_stock_issues%rowtype;
begin
  if not public.ecoflow_can_manage_customer_issue_ops() then
    raise exception 'OWNER_ADMIN_WAREHOUSE_OR_DRIVER_REQUIRED';
  end if;

  v_next := upper(coalesce(trim(p_ops_status), ''));
  if v_next not in ('RELEASED_TO_WAREHOUSE','PICKED','OUT_FOR_DELIVERY','DELIVERED','CANCELLED') then
    raise exception 'INVALID_OPS_STATUS: %', p_ops_status;
  end if;

  select * into v_issue
  from public.ecoflow_customer_stock_issues
  where id = p_issue_id
  limit 1;

  if not found then
    raise exception 'CUSTOMER_STOCK_ISSUE_NOT_FOUND';
  end if;

  if v_issue.fulfilment_mode <> 'OPS_DELIVERY' then
    raise exception 'ISSUE_NOT_RELEASED_TO_OPS';
  end if;

  update public.ecoflow_customer_stock_issues
  set ops_status = v_next,
      driver_note = coalesce(nullif(trim(p_note), ''), driver_note),
      updated_at = now()
  where id = p_issue_id
  returning * into v_issue;

  insert into public.ecoflow_warehouse_movements (movement_type, location_id, from_location_id, sku, product_name, barcode, unit_level, quantity, note, actor_user_id)
  values ('MOVE_OUT', v_issue.location_id, v_issue.location_id, v_issue.sku, v_issue.product_name, v_issue.barcode, v_issue.unit_level, 0, 'Quick customer stock ops status · ' || v_next || ' · ' || v_issue.issue_no || coalesce(' · ' || nullif(trim(p_note), ''), ''), auth.uid());

  return query select v_issue.id, v_issue.issue_no, v_issue.ops_status;
end;
$$;

grant execute on function public.ecoflow_update_customer_stock_issue_ops_status(uuid, text, text) to authenticated;
