-- Read-only receiving history for desktop operational roles.
-- Warehouse writes remain exclusively in the existing controlled receiving RPCs.

begin;

create or replace function public.ecoflow_can_read_desktop_receiving_history()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_user_profiles profile
    where profile.user_id = auth.uid()
      and profile.is_active = true
      and profile.team_status = 'ACTIVE'
      and profile.app_role::text in ('OWNER','ADMIN','ACCOUNT','VIEWER')
  );
$$;

revoke all on function public.ecoflow_can_read_desktop_receiving_history() from public, anon;
grant execute on function public.ecoflow_can_read_desktop_receiving_history() to authenticated;

create or replace function public.ecoflow_read_desktop_receiving_batches(
  p_limit integer default 80
)
returns table (
  id uuid,
  batch_no text,
  batch_status text,
  line_count bigint,
  confirmed_count bigint,
  posted_count bigint,
  total_units numeric,
  supplier_name text,
  supplier_order_ref text,
  invoice_ref text,
  batch_note text,
  created_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_by_name text,
  created_by_email text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.ecoflow_can_read_desktop_receiving_history() then
    raise exception 'DESKTOP_RECEIVING_HISTORY_ROLE_REQUIRED';
  end if;

  return query
  select
    batch.id,
    batch.batch_no,
    batch.batch_status,
    count(line.id)::bigint as line_count,
    count(line.id) filter (
      where coalesce(line.confirmation_checked, false) or line.line_status = 'POSTED'
    )::bigint as confirmed_count,
    count(line.id) filter (where line.line_status = 'POSTED')::bigint as posted_count,
    coalesce(sum(line.units_received), 0)::numeric as total_units,
    batch.supplier_name,
    batch.supplier_order_ref,
    batch.invoice_ref,
    batch.batch_note,
    batch.created_at,
    batch.completed_at,
    batch.cancelled_at,
    profile.display_name as created_by_name,
    profile.email as created_by_email
  from public.ecoflow_warehouse_receiving_batches batch
  left join public.ecoflow_warehouse_receiving_lines line
    on line.batch_id = batch.id
  left join public.app_user_profiles profile
    on profile.user_id = batch.created_by
  group by
    batch.id,
    batch.batch_no,
    batch.batch_status,
    batch.supplier_name,
    batch.supplier_order_ref,
    batch.invoice_ref,
    batch.batch_note,
    batch.created_at,
    batch.completed_at,
    batch.cancelled_at,
    profile.display_name,
    profile.email
  order by batch.created_at desc
  limit least(greatest(coalesce(p_limit, 80), 1), 200);
end;
$$;

revoke all on function public.ecoflow_read_desktop_receiving_batches(integer) from public, anon;
grant execute on function public.ecoflow_read_desktop_receiving_batches(integer) to authenticated;

create or replace function public.ecoflow_read_desktop_receiving_movements(
  p_limit integer default 120
)
returns table (
  id uuid,
  sku text,
  product_name text,
  movement_type text,
  quantity numeric,
  from_location text,
  to_location text,
  reference_type text,
  reference_id text,
  action_note text,
  source text,
  moved_at timestamptz,
  moved_by_name text,
  moved_by_email text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.ecoflow_can_read_desktop_receiving_history() then
    raise exception 'DESKTOP_RECEIVING_HISTORY_ROLE_REQUIRED';
  end if;

  return query
  select
    movement.id,
    movement.sku,
    movement.product_name,
    movement.movement_type,
    movement.quantity,
    movement.from_location,
    movement.to_location,
    movement.reference_type,
    movement.reference_id,
    movement.action_note,
    movement.source,
    movement.moved_at,
    profile.display_name as moved_by_name,
    profile.email as moved_by_email
  from public.ecoflow_inventory_movements movement
  left join public.app_user_profiles profile
    on profile.user_id = movement.moved_by
  where movement.movement_type = 'RECEIVE'
    and movement.source = 'WAREHOUSE_RECEIVING_BATCH'
  order by movement.moved_at desc
  limit least(greatest(coalesce(p_limit, 120), 1), 300);
end;
$$;

revoke all on function public.ecoflow_read_desktop_receiving_movements(integer) from public, anon;
grant execute on function public.ecoflow_read_desktop_receiving_movements(integer) to authenticated;

notify pgrst, 'reload schema';

commit;
