-- PostgreSQL functions receive PUBLIC execute by default. Remove that inherited
-- path as well as explicit authenticated/anon grants for retired local
-- price and payment substitutes.

begin;

do $$
declare
  v_signature text;
begin
  for v_signature in
    select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'ecoflow_set_price_matrix_price',
        'ecoflow_bulk_adjust_price_matrix',
        'ecoflow_record_customer_payment'
      )
  loop
    execute format('revoke execute on function %s from public, authenticated, anon', v_signature);
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
