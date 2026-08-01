-- PL/pgSQL output columns such as revision share names with stored columns.
-- Resolve those statements to the table column while parameters retain p_ prefixes.

begin;

alter function public.ecoflow_start_stocktake_session(text,text,text,uuid,boolean,text,uuid)
  set plpgsql.variable_conflict='use_column';
alter function public.ecoflow_record_stocktake_observation(uuid,text,text,text,text,text,numeric,numeric,text,uuid)
  set plpgsql.variable_conflict='use_column';
alter function public.ecoflow_review_stocktake_observation(uuid,boolean,text,uuid)
  set plpgsql.variable_conflict='use_column';
alter function public.ecoflow_complete_stocktake_location(uuid,text,text,uuid)
  set plpgsql.variable_conflict='use_column';
alter function public.ecoflow_reopen_stocktake_location(uuid,text,text,uuid)
  set plpgsql.variable_conflict='use_column';
alter function public.ecoflow_submit_stocktake_session(uuid,text,uuid)
  set plpgsql.variable_conflict='use_column';
alter function public.ecoflow_approve_stocktake_session(uuid,bigint,text,uuid)
  set plpgsql.variable_conflict='use_column';
alter function public.ecoflow_move_warehouse_sku(text,text,text,text,numeric,boolean,numeric,text,uuid)
  set plpgsql.variable_conflict='use_column';
alter function public.ecoflow_read_warehouse_control(uuid,integer)
  set plpgsql.variable_conflict='use_column';

commit;
