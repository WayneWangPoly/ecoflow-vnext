-- Commercial SKU lifecycle status is sourced from Ordermentum. EcoFlow may
-- still maintain physical shelf, local scan barcode, reorder target, stock
-- estimate, notes and review workflow.

begin;

-- Production already has the operational inventory action engine. Fresh schema
-- contract tests may not, so discover and preserve it only when present.
do $$
begin
  if to_regprocedure('public.ecoflow_apply_inventory_sku_action_internal_v1(text,text,text,text)') is null
     and to_regprocedure('public.ecoflow_apply_inventory_sku_action(text,text,text,text)') is not null then
    alter function public.ecoflow_apply_inventory_sku_action(text,text,text,text)
      rename to ecoflow_apply_inventory_sku_action_internal_v1;
  end if;
end $$;

create or replace function public.ecoflow_apply_inventory_sku_action(
  p_sku text,
  p_action text,
  p_value text default null,
  p_note text default null
)
returns table(
  action_id uuid,
  sku text,
  action text,
  execution_status text,
  executed_at timestamptz,
  error_message text
)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_action text := upper(nullif(trim(coalesce(p_action,'')), ''));
begin
  if public.ecoflow_active_app_role() not in ('OWNER','ADMIN','WAREHOUSE') then
    raise exception 'OWNER_ADMIN_OR_WAREHOUSE_REQUIRED';
  end if;

  if v_action='SET_STATUS' then
    raise exception 'ORDERMENTUM_SOURCE_OWNED: activate, discontinue or change commercial SKU status in Ordermentum and refresh the catalogue mirror'
      using errcode='42501';
  end if;

  if v_action not in (
    'SET_FIXED_SHELF','SET_BARCODE','SET_REORDER_TARGET',
    'SET_ON_HAND_ESTIMATE','SET_NOTE','MARK_REVIEWED'
  ) then
    raise exception 'UNSUPPORTED_INVENTORY_ACTION';
  end if;

  if to_regprocedure('public.ecoflow_apply_inventory_sku_action_internal_v1(text,text,text,text)') is null then
    raise exception 'INVENTORY_ACTION_ENGINE_UNAVAILABLE';
  end if;

  -- Dynamic SQL keeps this migration installable in clean contract schemas
  -- where the legacy engine is intentionally absent. Production calls still
  -- delegate to the preserved operational engine with typed parameters.
  return query execute
    'select * from public.ecoflow_apply_inventory_sku_action_internal_v1($1,$2,$3,$4)'
    using p_sku,p_action,p_value,p_note;
end;
$$;

do $$
begin
  if to_regprocedure('public.ecoflow_apply_inventory_sku_action_internal_v1(text,text,text,text)') is not null then
    execute 'revoke all on function public.ecoflow_apply_inventory_sku_action_internal_v1(text,text,text,text) from public, anon, authenticated';
  end if;
end $$;

revoke all on function public.ecoflow_apply_inventory_sku_action(text,text,text,text) from public, anon;
grant execute on function public.ecoflow_apply_inventory_sku_action(text,text,text,text) to authenticated;

notify pgrst, 'reload schema';
commit;
