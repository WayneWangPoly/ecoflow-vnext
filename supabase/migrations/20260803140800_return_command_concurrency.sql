-- Serialise identical return command IDs before the command-ledger lookup.
-- A concurrent replay waits for the first transaction, then returns its result.

begin;

alter function public.ecoflow_receive_delivery_return(text, text, text, uuid)
  rename to ecoflow_receive_delivery_return_locked_impl;

create function public.ecoflow_receive_delivery_return(
  p_return_code text,
  p_warehouse_location text,
  p_note text,
  p_command_id uuid
)
returns table(
  exception_id uuid,
  return_code text,
  return_status text,
  warehouse_location text,
  received_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_variable
begin
  if p_command_id is null then
    raise exception 'RETURN_COMMAND_ID_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('return-receipt-command:' || p_command_id::text, 0)
  );

  return query
  select r.exception_id, r.return_code, r.return_status,
         r.warehouse_location, r.received_at
  from public.ecoflow_receive_delivery_return_locked_impl(
    p_return_code,
    p_warehouse_location,
    p_note,
    p_command_id
  ) r;
end;
$$;

alter function public.ecoflow_inspect_delivery_return_item(
  text,
  text,
  numeric,
  text,
  text,
  text,
  text,
  uuid
) rename to ecoflow_inspect_delivery_return_item_locked_impl;

create function public.ecoflow_inspect_delivery_return_item(
  p_return_code text,
  p_product_barcode text,
  p_package_quantity numeric,
  p_goods_condition text,
  p_disposition text,
  p_warehouse_location text,
  p_note text,
  p_command_id uuid
)
returns table(
  inspection_id uuid,
  exception_id uuid,
  return_status text,
  physical_sku text,
  family_code text,
  package_quantity numeric,
  disposition text,
  stock_movement_recorded boolean,
  inspected_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_variable
begin
  if p_command_id is null then
    raise exception 'RETURN_COMMAND_ID_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('return-inspection-command:' || p_command_id::text, 0)
  );

  return query
  select r.inspection_id, r.exception_id, r.return_status,
         r.physical_sku, r.family_code, r.package_quantity,
         r.disposition, r.stock_movement_recorded, r.inspected_at
  from public.ecoflow_inspect_delivery_return_item_locked_impl(
    p_return_code,
    p_product_barcode,
    p_package_quantity,
    p_goods_condition,
    p_disposition,
    p_warehouse_location,
    p_note,
    p_command_id
  ) r;
end;
$$;

revoke all on function public.ecoflow_receive_delivery_return_locked_impl(text, text, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.ecoflow_inspect_delivery_return_item_locked_impl(text, text, numeric, text, text, text, text, uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.ecoflow_receive_delivery_return(text, text, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.ecoflow_inspect_delivery_return_item(text, text, numeric, text, text, text, text, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.ecoflow_receive_delivery_return(text, text, text, uuid)
  to authenticated;
grant execute on function public.ecoflow_inspect_delivery_return_item(text, text, numeric, text, text, text, text, uuid)
  to authenticated;

notify pgrst, 'reload schema';

commit;
