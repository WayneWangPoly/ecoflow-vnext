-- Minimal pre-migration representation of the existing stock pick RPC.
-- Production already has this function; CI needs the contract so the ownership
-- migration can safely rename and wrap it.

create or replace function public.ecoflow_record_pick_movement(
  p_sku text,
  p_quantity numeric,
  p_unit_level text default 'carton',
  p_barcode text default null,
  p_note text default null
)
returns table (
  location_code text,
  sku text,
  picked_quantity numeric,
  remaining_quantity numeric
)
language sql
security definer
set search_path = public
as $$
  select
    'TEMP'::text,
    upper(trim(p_sku))::text,
    p_quantity::numeric,
    100::numeric;
$$;

grant execute on function public.ecoflow_record_pick_movement(text,numeric,text,text,text) to authenticated;
