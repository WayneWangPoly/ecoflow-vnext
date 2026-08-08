-- Preserve the explicit conflict state after a canonical barcode is retired.
-- The replacement capture RPC only transitions BARCODE:<code> from CONFLICT to
-- DRAFT_READY. Setting the task to OPEN here would leave a successfully
-- recaptured replacement permanently blocking batch submission.

begin;

create or replace function public.ecoflow_retire_product_identity_barcode(
  p_barcode text,p_reason text,p_expected_revision bigint
)
returns table(
  binding_id uuid,barcode text,physical_sku_id uuid,retirement_status text,revision bigint,retired_at timestamptz
)
language plpgsql security definer set search_path=pg_catalog,public
as $$
declare
  v_code text:=nullif(btrim(coalesce(p_barcode,'')),'');
  v_reason text:=nullif(btrim(coalesce(p_reason,'')),'');
  v_binding public.ecoflow_physical_barcode_bindings%rowtype;
  v_batch uuid;
begin
  if not public.ecoflow_can_publish_product_identity() then
    raise exception using errcode='42501',message='OWNER_OR_ADMIN_REQUIRED';
  end if;
  if v_code is null or v_reason is null then
    raise exception 'BARCODE_AND_RETIREMENT_REASON_REQUIRED';
  end if;

  select b.* into v_binding
  from public.ecoflow_physical_barcode_bindings b
  where b.barcode=v_code and b.identity_status='ACTIVE'
  for update;

  if not found then raise exception 'ACTIVE_CANONICAL_BARCODE_NOT_FOUND'; end if;

  if v_binding.revision<>p_expected_revision then
    return query select
      v_binding.id,v_binding.barcode,v_binding.physical_sku_id,
      'CONFLICT'::text,v_binding.revision,v_binding.retired_at;
    return;
  end if;

  update public.ecoflow_physical_barcode_bindings b set
    identity_status='RETIRED',
    revision=b.revision+1,
    retired_by=auth.uid(),
    retired_at=now(),
    retirement_reason=v_reason
  where b.id=v_binding.id
  returning * into v_binding;

  select b.id into v_batch
  from public.ecoflow_product_identity_batches b
  where b.batch_status='DRAFT'
  order by b.created_at desc
  limit 1;

  insert into public.ecoflow_product_identity_tasks(
    task_key,task_type,barcode,batch_id,task_status,blocking,source,detail
  ) values(
    'BARCODE:'||v_code,
    'BARCODE_CONFLICT',
    v_code,
    v_batch,
    'CONFLICT',
    true,
    'CANONICAL_BARCODE',
    'Published binding retired: '||v_reason||'. Capture the verified replacement before submission.'
  )
  on conflict(task_key) do update set
    batch_id=excluded.batch_id,
    task_type='BARCODE_CONFLICT',
    task_status='CONFLICT',
    blocking=true,
    source='CANONICAL_BARCODE',
    detail=excluded.detail,
    updated_at=now(),
    resolved_by=null,
    resolved_at=null;

  return query select
    v_binding.id,v_binding.barcode,v_binding.physical_sku_id,
    'RETIRED'::text,v_binding.revision,v_binding.retired_at;
end;
$$;

revoke all on function public.ecoflow_retire_product_identity_barcode(text,text,bigint)
  from public,anon;
grant execute on function public.ecoflow_retire_product_identity_barcode(text,text,bigint)
  to authenticated;

comment on function public.ecoflow_retire_product_identity_barcode(text,text,bigint) is
  'Retires an ACTIVE canonical barcode without reassigning history. A replacement remains a blocking CONFLICT until a new verified capture transitions it to DRAFT_READY.';

notify pgrst,'reload schema';
commit;
