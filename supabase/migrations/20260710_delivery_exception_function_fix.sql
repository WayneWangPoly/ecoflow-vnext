-- Follow-up fix for the delivery exception RPC output timestamp variable.

create or replace function public.ecoflow_record_delivery_exception(
  p_business_day text,
  p_order_id text,
  p_order_number text default null,
  p_stop_number integer default null,
  p_box_code text default null,
  p_store_name text default null,
  p_outcome text default 'PARTIAL',
  p_expected_cartons numeric default 0,
  p_delivered_cartons numeric default 0,
  p_return_cartons numeric default 0,
  p_reason text default null,
  p_driver_note text default null,
  p_pod2_path text default null,
  p_store_email text default null,
  p_store_phone text default null,
  p_recorded_by text default null
)
returns table(exception_id uuid,return_code text,return_status text,outcome text,recorded_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_outcome text := upper(trim(coalesce(p_outcome, 'PARTIAL')));
  v_return_code text;
  v_return_required boolean;
  v_id uuid;
  v_event_key text;
  v_recorded_at timestamptz;
begin
  if v_outcome not in ('PARTIAL','MISSING_CARTON','REFUSED','DAMAGED','WRONG_GOODS','FAILED') then raise exception 'invalid delivery exception outcome'; end if;
  v_return_required := greatest(coalesce(p_return_cartons,0),0) > 0 or v_outcome in ('REFUSED','DAMAGED','WRONG_GOODS');
  if v_return_required then
    v_return_code := 'RET-' || replace(coalesce(p_business_day,to_char(now(),'YYYY-MM-DD')),'-','') || '-' || upper(coalesce(nullif(regexp_replace(coalesce(p_box_code,''),'[^A-Za-z0-9]','','g'),''),'BOX')) || '-' || upper(substring(gen_random_uuid()::text from 1 for 4));
  end if;

  insert into public.ecoflow_delivery_exceptions(business_day,order_id,order_number,stop_number,box_code,store_name,outcome,expected_cartons,delivered_cartons,return_cartons,reason,driver_note,pod2_path,store_email,store_phone,return_code,return_status,recorded_by)
  values(p_business_day,p_order_id,p_order_number,p_stop_number,p_box_code,p_store_name,v_outcome,greatest(coalesce(p_expected_cartons,0),0),greatest(coalesce(p_delivered_cartons,0),0),greatest(coalesce(p_return_cartons,0),0),nullif(trim(coalesce(p_reason,'')),''),nullif(trim(coalesce(p_driver_note,'')),''),p_pod2_path,nullif(trim(coalesce(p_store_email,'')),''),nullif(trim(coalesce(p_store_phone,'')),''),v_return_code,case when v_return_required then 'WITH_DRIVER' else 'NOT_REQUIRED' end,p_recorded_by)
  returning id,public.ecoflow_delivery_exceptions.recorded_at into v_id,v_recorded_at;

  v_event_key := p_business_day || ':' || p_order_id || ':EXCEPTION:' || v_id::text;
  perform * from public.ecoflow_queue_delivery_notifications(v_event_key,p_business_day,p_order_id,p_order_number,p_stop_number,p_box_code,p_store_name,v_outcome,p_store_email,p_store_phone,null,p_pod2_path,format('Expected %s cartons; delivered %s; returning %s. Reason: %s. Driver note: %s. Return code: %s.',coalesce(p_expected_cartons,0),coalesce(p_delivered_cartons,0),coalesce(p_return_cartons,0),coalesce(p_reason,'—'),coalesce(p_driver_note,'—'),coalesce(v_return_code,'not required')),p_recorded_by);

  return query select v_id,v_return_code,case when v_return_required then 'WITH_DRIVER' else 'NOT_REQUIRED' end,v_outcome,v_recorded_at;
end;
$$;

grant execute on function public.ecoflow_record_delivery_exception(text,text,text,integer,text,text,text,numeric,numeric,numeric,text,text,text,text,text,text) to anon, authenticated;

notify pgrst, 'reload schema';
