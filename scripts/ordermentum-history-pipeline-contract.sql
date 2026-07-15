\set ON_ERROR_STOP on

DO $$
DECLARE
  v_run uuid := gen_random_uuid();
  v_claim uuid := gen_random_uuid();
  v_result jsonb;
  v_claimed integer;
BEGIN
  insert into public.ecoflow_ordermentum_history_runs(id,pipeline_key,status,stage,window_from,window_to,next_page,page_size)
  values(v_run,'ORDER_HISTORY_V2','RUNNING','CATALOG',now()-interval '1 year',now(),1,50);

  select public.ecoflow_upsert_ordermentum_catalog_page(v_run, jsonb_build_array(
    jsonb_build_object('order_key','history-fixture-1','external_order_id','history-fixture-1','external_order_number','OMO-HISTORY-1','invoice_number','INV-HISTORY-1','source_created_at',now()-interval '10 days','source_updated_at',now()-interval '1 day','summary_payload',jsonb_build_object('id','history-fixture-1'),'summary_hash','fixture-hash-1'),
    jsonb_build_object('order_key','history-fixture-2','external_order_id','history-fixture-2','external_order_number','OMO-HISTORY-2','source_created_at',now()-interval '9 days','source_updated_at',now()-interval '2 days','summary_payload',jsonb_build_object('id','history-fixture-2'),'summary_hash','fixture-hash-2')
  )) into v_result;
  if coalesce((v_result->>'catalog_rows_upserted')::integer,0) <> 2 then raise exception 'catalog page did not persist two orders: %',v_result; end if;
  perform public.ecoflow_finalise_ordermentum_catalog_scan(v_run);
  select count(*) into v_claimed from public.ecoflow_claim_ordermentum_detail_batch(v_run,v_claim,1,5);
  if v_claimed <> 1 then raise exception 'detail queue did not claim one order'; end if;
  if not exists (select 1 from public.ecoflow_ordermentum_history_runs where id=v_run and catalog_complete and stage='DETAILS') then raise exception 'run did not advance to details'; end if;
  if not exists (select 1 from public.v_ecoflow_ordermentum_history_pipeline_v1 where history_run_id=v_run and catalog_total>=2 and detail_pending>=1) then raise exception 'pipeline view does not expose checkpoint/backlog'; end if;
END
$$;

select 'resumable Ordermentum history database contract passed' as result;
