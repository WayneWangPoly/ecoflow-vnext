\set ON_ERROR_STOP on

-- Exact privilege contract for the source-authority hardening migration.
do $$
declare
  v_role text;
  v_rel text;
  v_priv text;
begin
  foreach v_role in array array['anon','authenticated'] loop
    foreach v_rel in array array[
      'public.ecoflow_store_sites',
      'public.om_orders',
      'public.ordermentum_raw_orders',
      'public.qbo_invoices',
      'public.quickbooks_customers'
    ] loop
      if not has_table_privilege(v_role,v_rel,'SELECT') then
        raise exception '% lost source read access on %',v_role,v_rel;
      end if;

      foreach v_priv in array array[
        'INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'
      ] loop
        if has_table_privilege(v_role,v_rel,v_priv) then
          raise exception '% retained % on source-owned %',v_role,v_priv,v_rel;
        end if;
      end loop;

      if has_any_column_privilege(v_role,v_rel,'INSERT')
         or has_any_column_privilege(v_role,v_rel,'UPDATE')
         or has_any_column_privilege(v_role,v_rel,'REFERENCES') then
        raise exception '% retained column mutation/reference privilege on %',v_role,v_rel;
      end if;
    end loop;
  end loop;

  -- Service/background ingestion authority is intentionally preserved.
  foreach v_rel in array array[
    'public.ecoflow_store_sites',
    'public.om_orders',
    'public.ordermentum_raw_orders',
    'public.qbo_invoices',
    'public.quickbooks_customers'
  ] loop
    if not has_table_privilege('service_role',v_rel,'INSERT')
       or not has_table_privilege('service_role',v_rel,'UPDATE')
       or not has_table_privilege('service_role',v_rel,'DELETE') then
      raise exception 'service_role ingestion authority was damaged on %',v_rel;
    end if;
  end loop;

  -- Prove this is not a schema-wide browser write shutdown.
  if not has_table_privilege('authenticated','public.ecoflow_unrelated_mutable','INSERT')
     or not has_table_privilege('authenticated','public.ecoflow_unrelated_mutable','UPDATE')
     or not has_table_privilege('authenticated','public.ecoflow_unrelated_mutable','DELETE') then
    raise exception 'source hardening overreached into unrelated application-owned table';
  end if;
end
$$;

-- RLS is deliberately present on ecoflow_store_sites in the fixture. The key
-- safety property is that TRUNCATE is rejected by PostgreSQL privilege checks,
-- because row policies do not govern TRUNCATE.
create or replace function public.transform_007b_authenticated_truncate_denied()
returns boolean
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
begin
  execute 'truncate table public.ecoflow_store_sites';
  return false;
exception when insufficient_privilege then
  return true;
end;
$$;
grant execute on function public.transform_007b_authenticated_truncate_denied() to authenticated;

begin;
set local role authenticated;
do $$
begin
  if not public.transform_007b_authenticated_truncate_denied() then
    raise exception 'authenticated TRUNCATE unexpectedly succeeded despite source hardening';
  end if;
end
$$;
reset role;
rollback;

drop function public.transform_007b_authenticated_truncate_denied();

select 'TRANSFORM-007B source authority hardening contract: PASS' as result;
