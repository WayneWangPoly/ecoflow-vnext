-- Managed Supabase roles cannot set the superuser-only plpgsql.variable_conflict
-- GUC with ALTER FUNCTION. Recompile the already-created functions with the
-- equivalent per-function PL/pgSQL compiler directive instead.

begin;

do $migration$
declare
  v_signature text;
  v_definition text;
  v_body_marker constant text := 'AS $function$' || chr(10);
begin
  foreach v_signature in array array[
    'public.ecoflow_start_stocktake_session(text,text,text,uuid,boolean,text,uuid)',
    'public.ecoflow_record_stocktake_observation(uuid,text,text,text,text,text,numeric,numeric,text,uuid)',
    'public.ecoflow_review_stocktake_observation(uuid,boolean,text,uuid)',
    'public.ecoflow_complete_stocktake_location(uuid,text,text,uuid)',
    'public.ecoflow_reopen_stocktake_location(uuid,text,text,uuid)',
    'public.ecoflow_submit_stocktake_session(uuid,text,uuid)',
    'public.ecoflow_approve_stocktake_session(uuid,bigint,text,uuid)',
    'public.ecoflow_move_warehouse_sku(text,text,text,text,numeric,boolean,numeric,text,uuid)',
    'public.ecoflow_read_warehouse_control(uuid,integer)'
  ]
  loop
    select pg_get_functiondef(v_signature::regprocedure)
    into v_definition;

    if position('#variable_conflict use_column' in v_definition)=0 then
      if position(v_body_marker in v_definition)=0 then
        raise exception using
          errcode='55000',
          message='PLPGSQL_FUNCTION_BODY_MARKER_NOT_FOUND',
          detail=v_signature;
      end if;

      v_definition := replace(
        v_definition,
        v_body_marker,
        v_body_marker || '#variable_conflict use_column' || chr(10)
      );
      execute v_definition;
    end if;
  end loop;
end;
$migration$;

commit;
