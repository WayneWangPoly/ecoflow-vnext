-- Fix PL/pgSQL ambiguity in ecoflow_bulk_map_ordermentum_skus.
-- Safe patch: replaces only the RPC function. It does not change data.

begin;

create or replace function public.ecoflow_bulk_map_ordermentum_skus(
  p_limit integer default 25,
  p_created_by text default 'system-bulk'
)
returns table (
  external_sku_code text,
  internal_sku_id uuid,
  sku_code text,
  mapping_id uuid,
  action_taken text
)
language plpgsql
as $$
declare
  r record;
  mapped record;
  limit_value integer := greatest(coalesce(p_limit, 25), 0);
begin
  for r in
    select
      w.external_sku_code as candidate_external_sku_code,
      w.external_product_name as candidate_external_product_name
    from public.v_ecoflow_ordermentum_sku_mapping_workbench w
    where w.mapping_status = 'UNMAPPED'
      and w.external_sku_code is not null
      and trim(w.external_sku_code) <> ''
    order by
      w.priority_rank asc nulls last,
      w.order_count desc nulls last,
      w.line_count desc nulls last
    limit limit_value
  loop
    for mapped in
      select *
      from public.ecoflow_map_ordermentum_sku(
        r.candidate_external_sku_code,
        null,
        null,
        r.candidate_external_product_name,
        'Ordermentum imported',
        'sleeve',
        'AUTO_CREATED',
        p_created_by
      )
    loop
      external_sku_code := r.candidate_external_sku_code;
      internal_sku_id := mapped.internal_sku_id;
      sku_code := mapped.sku_code;
      mapping_id := mapped.mapping_id;
      action_taken := mapped.action_taken;
      return next;
    end loop;
  end loop;
end;
$$;

commit;
