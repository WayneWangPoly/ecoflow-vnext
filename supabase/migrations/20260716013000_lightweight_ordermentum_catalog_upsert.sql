-- Keep history catalog persistence bounded to the current source page.
--
-- The original v2 catalog function attempted to reuse previous detail by joining
-- every page against the entire ordermentum_raw_orders table through to_jsonb().
-- That expression could not use source identity indexes and timed out before page
-- one was checkpointed. Existing catalog detail remains preserved by the normal
-- ON CONFLICT freshness rule; new detail is reconciled by the durable detail queue.

begin;

create or replace function public.ecoflow_upsert_ordermentum_catalog_page(
  p_run_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_rows integer := 0;
  v_complete integer := 0;
  v_now timestamptz := clock_timestamp();
begin
  if p_rows is null or jsonb_typeof(p_rows)<>'array' then
    raise exception 'p_rows must be a JSON array' using errcode='22023';
  end if;

  insert into public.ecoflow_ordermentum_order_catalog (
    order_key,
    external_order_id,
    external_order_number,
    invoice_number,
    source_created_at,
    source_updated_at,
    summary_payload,
    summary_hash,
    source_status,
    first_seen_at,
    last_seen_at,
    last_full_seen_run_id,
    detail_status,
    detail_source_updated_at,
    detail_synced_at,
    next_retry_at,
    last_detail_error
  )
  select
    x.order_key,
    nullif(x.external_order_id,''),
    nullif(x.external_order_number,''),
    nullif(x.invoice_number,''),
    x.source_created_at,
    x.source_updated_at,
    coalesce(x.summary_payload,'{}'::jsonb),
    nullif(x.summary_hash,''),
    'PRESENT',
    v_now,
    v_now,
    p_run_id,
    case
      when public.ecoflow_ordermentum_raw_row_has_detail(coalesce(x.summary_payload,'{}'::jsonb)) then 'COMPLETE'
      else 'PENDING'
    end,
    case
      when public.ecoflow_ordermentum_raw_row_has_detail(coalesce(x.summary_payload,'{}'::jsonb)) then x.source_updated_at
      else null
    end,
    case
      when public.ecoflow_ordermentum_raw_row_has_detail(coalesce(x.summary_payload,'{}'::jsonb)) then v_now
      else null
    end,
    null,
    null
  from jsonb_to_recordset(p_rows) as x(
    order_key text,
    external_order_id text,
    external_order_number text,
    invoice_number text,
    source_created_at timestamptz,
    source_updated_at timestamptz,
    summary_payload jsonb,
    summary_hash text
  )
  where nullif(x.order_key,'') is not null
  on conflict(order_key) do update set
    external_order_id=coalesce(excluded.external_order_id,public.ecoflow_ordermentum_order_catalog.external_order_id),
    external_order_number=coalesce(excluded.external_order_number,public.ecoflow_ordermentum_order_catalog.external_order_number),
    invoice_number=coalesce(excluded.invoice_number,public.ecoflow_ordermentum_order_catalog.invoice_number),
    source_created_at=coalesce(excluded.source_created_at,public.ecoflow_ordermentum_order_catalog.source_created_at),
    source_updated_at=coalesce(excluded.source_updated_at,public.ecoflow_ordermentum_order_catalog.source_updated_at),
    summary_payload=excluded.summary_payload,
    summary_hash=excluded.summary_hash,
    source_status='PRESENT',
    last_seen_at=v_now,
    last_full_seen_run_id=p_run_id,
    detail_status=case
      when public.ecoflow_ordermentum_order_catalog.detail_status='COMPLETE'
       and coalesce(public.ecoflow_ordermentum_order_catalog.detail_source_updated_at,'-infinity'::timestamptz)
           >= coalesce(excluded.source_updated_at,'-infinity'::timestamptz)
        then 'COMPLETE'
      when public.ecoflow_ordermentum_raw_row_has_detail(excluded.summary_payload)
        then 'COMPLETE'
      else 'PENDING'
    end,
    detail_source_updated_at=case
      when public.ecoflow_ordermentum_order_catalog.detail_status='COMPLETE'
       and coalesce(public.ecoflow_ordermentum_order_catalog.detail_source_updated_at,'-infinity'::timestamptz)
           >= coalesce(excluded.source_updated_at,'-infinity'::timestamptz)
        then public.ecoflow_ordermentum_order_catalog.detail_source_updated_at
      when public.ecoflow_ordermentum_raw_row_has_detail(excluded.summary_payload)
        then excluded.source_updated_at
      else null
    end,
    detail_synced_at=case
      when public.ecoflow_ordermentum_order_catalog.detail_status='COMPLETE'
       and coalesce(public.ecoflow_ordermentum_order_catalog.detail_source_updated_at,'-infinity'::timestamptz)
           >= coalesce(excluded.source_updated_at,'-infinity'::timestamptz)
        then public.ecoflow_ordermentum_order_catalog.detail_synced_at
      when public.ecoflow_ordermentum_raw_row_has_detail(excluded.summary_payload)
        then v_now
      else null
    end,
    next_retry_at=case
      when public.ecoflow_ordermentum_order_catalog.detail_status='COMPLETE'
       and coalesce(public.ecoflow_ordermentum_order_catalog.detail_source_updated_at,'-infinity'::timestamptz)
           >= coalesce(excluded.source_updated_at,'-infinity'::timestamptz)
        then public.ecoflow_ordermentum_order_catalog.next_retry_at
      else null
    end,
    detail_attempts=case
      when public.ecoflow_ordermentum_order_catalog.detail_status='COMPLETE'
       and coalesce(public.ecoflow_ordermentum_order_catalog.detail_source_updated_at,'-infinity'::timestamptz)
           >= coalesce(excluded.source_updated_at,'-infinity'::timestamptz)
        then public.ecoflow_ordermentum_order_catalog.detail_attempts
      when public.ecoflow_ordermentum_order_catalog.last_full_seen_run_id is distinct from p_run_id
        then 0
      else public.ecoflow_ordermentum_order_catalog.detail_attempts
    end,
    detail_claim_token=null,
    detail_claimed_at=null,
    last_detail_error=null;

  get diagnostics v_rows=row_count;

  select count(*)::integer
  into v_complete
  from public.ecoflow_ordermentum_order_catalog c
  where c.last_full_seen_run_id=p_run_id
    and c.detail_status='COMPLETE'
    and c.order_key in (
      select x.order_key
      from jsonb_to_recordset(p_rows) as x(order_key text)
      where nullif(x.order_key,'') is not null
    );

  return jsonb_build_object(
    'catalog_rows_upserted',v_rows,
    'existing_details_reused',v_complete,
    'raw_history_scan_performed',false
  );
end;
$$;

comment on function public.ecoflow_upsert_ordermentum_catalog_page(uuid,jsonb) is
  'Persists one bounded Ordermentum catalog page without scanning the full raw-order archive.';

grant execute on function public.ecoflow_upsert_ordermentum_catalog_page(uuid,jsonb) to service_role;
revoke execute on function public.ecoflow_upsert_ordermentum_catalog_page(uuid,jsonb) from public,anon,authenticated;

commit;
