\set ON_ERROR_STOP on

-- Anonymous browser role must not inherit either the retired legacy mutation
-- path or any direct mutation capability over command-owned Returns state.
do $$
declare
  v_rel text;
  v_priv text;
begin
  if has_function_privilege('anon',
      'public.ecoflow_record_return_inspection_item(uuid,text,text,numeric,text,text,text,text)','EXECUTE')
     or has_function_privilege('anon',
      'public.ecoflow_complete_return_inspection(uuid,text,text)','EXECUTE') then
    raise exception '007C anonymous legacy return RPC bypass remains executable';
  end if;

  foreach v_rel in array array[
    'public.ecoflow_delivery_exceptions',
    'public.ecoflow_delivery_return_inspection_lines',
    'public.ecoflow_return_commands'
  ] loop
    foreach v_priv in array array['INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','MAINTAIN'] loop
      if has_table_privilege('anon',v_rel,v_priv) then
        raise exception '007C anon retained % on %',v_priv,v_rel;
      end if;
    end loop;
  end loop;
end
$$;

-- 007C must not disable the trusted ingestion/physical workflow authority that
-- already owns these operational relations. The migration only closes browser
-- bypasses; service_role still needs its existing underlying write grants.
do $$
begin
  if not has_table_privilege('service_role','public.ecoflow_delivery_exceptions','UPDATE')
     or not has_table_privilege('service_role','public.ecoflow_delivery_return_inspection_lines','INSERT')
     or not has_table_privilege('service_role','public.ecoflow_delivery_return_scans','INSERT')
     or not has_table_privilege('service_role','public.ecoflow_inventory_movements','INSERT') then
    raise exception '007C damaged trusted service/physical workflow authority';
  end if;

  if not has_function_privilege('authenticated','public.ecoflow_read_return_state_v1(text)','EXECUTE')
     or not has_function_privilege('authenticated',
       'public.ecoflow_record_return_disposition_v1(text,text,text,numeric,text,text,bigint,uuid,text,text,jsonb)','EXECUTE')
     or not has_function_privilege('authenticated',
       'public.ecoflow_close_return_v1(text,bigint,uuid,text,text,jsonb)','EXECUTE')
     or not has_function_privilege('authenticated',
       'public.ecoflow_recover_return_command_v1(uuid)','EXECUTE') then
    raise exception '007C authoritative command/read surface is not executable by authenticated callers';
  end if;
end
$$;

select 'TRANSFORM-007C return command security contract: PASS' as result;
