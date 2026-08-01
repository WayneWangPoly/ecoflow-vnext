-- PL/pgSQL output columns share names with stored columns in the operational
-- paging, preference and close functions. Resolve unqualified references to
-- table columns while all inputs remain explicitly p_ prefixed.

begin;

alter function public.ecoflow_read_quick_actions()
  set plpgsql.variable_conflict='use_column';
alter function public.ecoflow_set_quick_actions(text[],bigint)
  set plpgsql.variable_conflict='use_column';
alter function public.ecoflow_read_operational_page(text,integer,integer,text,text,text)
  set plpgsql.variable_conflict='use_column';
alter function public.ecoflow_business_day_close_readiness(date)
  set plpgsql.variable_conflict='use_column';
alter function public.ecoflow_complete_business_day_close(date,date,bigint,text,uuid,jsonb,text,text)
  set plpgsql.variable_conflict='use_column';

commit;
