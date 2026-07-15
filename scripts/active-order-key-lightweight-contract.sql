\set ON_ERROR_STOP on

select public.ecoflow_refresh_ui_active_order_keys();

DO $$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef('public.ecoflow_refresh_ui_active_order_keys()'::regprocedure)
  INTO v_definition;

  IF position('from public.om_orders o' in lower(v_definition)) = 0 THEN
    RAISE EXCEPTION 'active-key refresh does not use canonical om_orders';
  END IF;
  IF position('v_ecoflow_order_operations_v' in lower(v_definition)) > 0 THEN
    RAISE EXCEPTION 'active-key refresh still scans an operations view';
  END IF;
  IF position('delete from public.ecoflow_ui_active_order_keys' in lower(v_definition)) > 0 THEN
    RAISE EXCEPTION 'active-key refresh still deletes the cache';
  END IF;
END
$$;

select 'lightweight active-order key SQL contract passed' as result;
