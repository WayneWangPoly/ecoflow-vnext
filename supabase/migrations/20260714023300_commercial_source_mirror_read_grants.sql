-- The retired price workbench remains an internal projection dependency for the
-- read-only source-price view. Its security-invoker chain therefore requires
-- authenticated SELECT on the curated Ordermentum SKU and price-group views.

begin;

do $$
declare
  v_relation text;
begin
  foreach v_relation in array array[
    'v_ecoflow_ordermentum_sku_master_v1',
    'v_ecoflow_ordermentum_price_groups_v1',
    'v_ecoflow_price_matrix_workbench'
  ] loop
    if to_regclass(format('public.%I', v_relation)) is not null then
      execute format('grant select on public.%I to authenticated', v_relation);
      execute format('revoke all on public.%I from anon', v_relation);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
