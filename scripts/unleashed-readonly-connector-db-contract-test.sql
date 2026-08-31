\set ON_ERROR_STOP on

-- Exact privilege and shape contract for UNLEASHED-MIGRATION-002.
do $$
declare
  v_role text;
  v_rel regclass;
  v_priv text;
begin
  foreach v_rel in array array[
    'public.unleashed_sync_runs'::regclass,
    'public.unleashed_sync_batches'::regclass,
    'public.unleashed_raw_snapshots'::regclass,
    'public.unleashed_external_identities'::regclass,
    'public.unleashed_resource_cursors'::regclass
  ] loop
    if not exists (
      select 1
      from pg_catalog.pg_class c
      where c.oid = v_rel and c.relrowsecurity
    ) then
      raise exception 'RLS is not enabled on %', v_rel::text;
    end if;

    foreach v_role in array array['anon','authenticated'] loop
      foreach v_priv in array array[
        'INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'
      ] loop
        if has_table_privilege(v_role, v_rel, v_priv) then
          raise exception '% retained % on Unleashed source-owned %', v_role, v_priv, v_rel::text;
        end if;
      end loop;

      if has_any_column_privilege(v_role, v_rel, 'INSERT')
         or has_any_column_privilege(v_role, v_rel, 'UPDATE')
         or has_any_column_privilege(v_role, v_rel, 'REFERENCES') then
        raise exception '% retained column mutation/reference privilege on %', v_role, v_rel::text;
      end if;
    end loop;

    if not has_table_privilege('service_role', v_rel, 'INSERT')
       or not has_table_privilege('service_role', v_rel, 'UPDATE')
       or not has_table_privilege('service_role', v_rel, 'DELETE') then
      raise exception 'service_role staging authority missing on %', v_rel::text;
    end if;
  end loop;

  if has_table_privilege('anon', 'public.unleashed_sync_runs', 'SELECT')
     or has_table_privilege('anon', 'public.unleashed_raw_snapshots', 'SELECT') then
    raise exception 'anon unexpectedly has Unleashed source read access';
  end if;

  if not has_table_privilege('authenticated', 'public.unleashed_sync_runs', 'SELECT')
     or not has_table_privilege('authenticated', 'public.unleashed_external_identities', 'SELECT') then
    raise exception 'authenticated office read access is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'v_ecoflow_unleashed_snapshot_catalog'
      and column_name = 'warehouse_code'
  ) then
    raise exception 'derived stock warehouse selector is missing';
  end if;

  if has_table_privilege('anon', 'public.v_ecoflow_unleashed_snapshot_catalog', 'SELECT')
     or not has_table_privilege('authenticated', 'public.v_ecoflow_unleashed_snapshot_catalog', 'SELECT') then
    raise exception 'snapshot catalog view privileges are incorrect';
  end if;
end
$$;

select 'UNLEASHED-MIGRATION-002 read-only connector DB contract: PASS' as result;
