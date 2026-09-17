-- ECOFLOW-R5-004D — warehouse adjustment movement contract hotfix
--
-- Forward-only schema repair for the stocktake approval path. The approval RPC
-- already emits ADJUST_IN / ADJUST_OUT and the inventory movement ledger already
-- accepts those values. The older warehouse movement constraint accepted only the
-- generic ADJUST value, causing the bounded BPB8 INITIAL approval transaction to
-- fail closed. This migration widens that check constraint only; it performs no
-- business-data mutation and does not approve any stocktake.

do $$
begin
  if to_regclass('public.ecoflow_warehouse_movements') is null then
    raise exception 'R5_004D_WAREHOUSE_MOVEMENTS_TABLE_REQUIRED';
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.ecoflow_warehouse_movements'::regclass
      and c.conname = 'ecoflow_warehouse_movements_movement_type_check'
      and c.contype = 'c'
  ) then
    raise exception 'R5_004D_MOVEMENT_TYPE_CONSTRAINT_REQUIRED';
  end if;
end
$$;

alter table public.ecoflow_warehouse_movements
  drop constraint if exists ecoflow_warehouse_movements_movement_type_check;

alter table public.ecoflow_warehouse_movements
  add constraint ecoflow_warehouse_movements_movement_type_check
  check (
    movement_type in (
      'RECEIVE',
      'MOVE_IN',
      'MOVE_OUT',
      'ADJUST',
      'ADJUST_IN',
      'ADJUST_OUT',
      'PICK',
      'COUNT'
    )
  );

comment on constraint ecoflow_warehouse_movements_movement_type_check
  on public.ecoflow_warehouse_movements
  is 'Warehouse movement types; directional stocktake adjustments use ADJUST_IN / ADJUST_OUT.';

do $$
declare
  v_definition text;
begin
  select pg_get_constraintdef(c.oid)
  into v_definition
  from pg_constraint c
  where c.conrelid = 'public.ecoflow_warehouse_movements'::regclass
    and c.conname = 'ecoflow_warehouse_movements_movement_type_check';

  if v_definition is null
     or position('ADJUST_IN' in v_definition) = 0
     or position('ADJUST_OUT' in v_definition) = 0
     or position('RECEIVE' in v_definition) = 0
     or position('MOVE_IN' in v_definition) = 0
     or position('MOVE_OUT' in v_definition) = 0
     or position('ADJUST' in v_definition) = 0
     or position('PICK' in v_definition) = 0
     or position('COUNT' in v_definition) = 0
  then
    raise exception 'R5_004D_MOVEMENT_TYPE_CONTRACT_POSTCHECK_FAILED: %', coalesce(v_definition, '<missing>');
  end if;
end
$$;
