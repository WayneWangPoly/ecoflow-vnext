\set ON_ERROR_STOP on

select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select set_config('request.jwt.claim.role','authenticated',false);
set role authenticated;

do $$
begin
  begin
    perform public.ecoflow_apply_inventory_sku_action(
      'CUP-12W','SET_STATUS','DISCONTINUED','Local commercial status change'
    );
    raise exception 'local commercial SKU status unexpectedly allowed';
  exception when others then
    if sqlerrm not like '%ORDERMENTUM_SOURCE_OWNED%' then raise; end if;
  end;
end $$;

reset role;

select 'inventory commercial source contract passed' as result;
