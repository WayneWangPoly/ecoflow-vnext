-- Production verification for first-stocktake go-live.
-- The release must retain both the unknown-barcode quarantine wrapper and the
-- corrected package/base-unit posting implementation.

begin;

do $verify_stocktake_pick_readiness$
declare
  v_public_definition text;
begin
  if to_regprocedure('public.ecoflow_complete_warehouse_receiving_batch(uuid,text)') is null then
    raise exception 'STOCKTAKE_RELEASE_BLOCKED: public receiving completion gate is missing';
  end if;

  if to_regprocedure('public.ecoflow_complete_warehouse_receiving_batch_unchecked_20260711(uuid,text)') is null then
    raise exception 'STOCKTAKE_RELEASE_BLOCKED: protected receiving implementation is missing';
  end if;

  select pg_get_functiondef('public.ecoflow_complete_warehouse_receiving_batch(uuid,text)'::regprocedure)
  into v_public_definition;

  if position('UNRESOLVED_UNKNOWN_BARCODES' in coalesce(v_public_definition,'')) = 0 then
    raise exception 'STOCKTAKE_RELEASE_BLOCKED: unknown-barcode quarantine gate is not active';
  end if;

  if to_regclass('public.v_ecoflow_stocktake_uom_integrity') is null then
    raise exception 'STOCKTAKE_RELEASE_BLOCKED: package-unit integrity view is missing';
  end if;

  if has_function_privilege('anon',
    'public.ecoflow_complete_warehouse_receiving_batch_unchecked_20260711(uuid,text)',
    'EXECUTE') then
    raise exception 'STOCKTAKE_RELEASE_BLOCKED: anonymous user can bypass receiving completion gate';
  end if;

  if has_function_privilege('authenticated',
    'public.ecoflow_complete_warehouse_receiving_batch_unchecked_20260711(uuid,text)',
    'EXECUTE') then
    raise exception 'STOCKTAKE_RELEASE_BLOCKED: authenticated user can bypass receiving completion gate';
  end if;
end
$verify_stocktake_pick_readiness$;

notify pgrst, 'reload schema';

commit;
