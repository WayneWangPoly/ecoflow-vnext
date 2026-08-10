\set ON_ERROR_STOP on

-- Phase 3 authority contract:
-- Warehouse may capture physical evidence, but review submission and publication
-- remain Owner/Admin authority. The server must enforce this even if a client
-- attempts to call the RPC directly.

set app.test_role='WAREHOUSE';

do $warehouse_submit_boundary$
declare
  v_batch record;
  v_read record;
  v_denied boolean:=false;
begin
  select * into v_batch
  from public.ecoflow_start_product_identity_batch(
    'Warehouse submit authority fixture',
    '00000000-0000-4000-8000-000000000211'::uuid
  );

  select * into v_read
  from public.ecoflow_read_current_product_identity_batch();

  if v_read.batch_id<>v_batch.batch_id then
    raise exception 'Current Product Identity batch read returned the wrong batch';
  end if;

  if coalesce(v_read.can_submit,false) then
    raise exception 'WAREHOUSE was advertised submit capability';
  end if;

  if coalesce(v_read.can_publish,false) then
    raise exception 'WAREHOUSE was advertised publish capability';
  end if;

  begin
    perform *
    from public.ecoflow_submit_product_identity_batch(
      v_batch.batch_id,
      v_batch.revision,
      '00000000-0000-4000-8000-000000000212'::uuid,
      'warehouse must not submit'
    );
  exception when sqlstate '42501' then
    if position('OWNER_OR_ADMIN_REQUIRED' in sqlerrm)>0 then
      v_denied:=true;
    else
      raise;
    end if;
  end;

  if not v_denied then
    raise exception 'WAREHOUSE gained Product Identity submit authority';
  end if;
end;
$warehouse_submit_boundary$;

reset app.test_role;
set app.test_role='OWNER';

-- Owner/Admin authorization must still pass through to the preserved canonical
-- implementation. With this intentionally empty batch, the expected failure is
-- a business-state gate, never an authorization failure.
do $owner_submit_boundary$
declare
  v_batch record;
  v_owner_authorized boolean:=false;
begin
  select * into v_batch
  from public.ecoflow_read_current_product_identity_batch();

  begin
    perform *
    from public.ecoflow_submit_product_identity_batch(
      v_batch.batch_id,
      v_batch.revision,
      '00000000-0000-4000-8000-000000000213'::uuid,
      'owner authorization probe'
    );
  exception when others then
    if sqlstate='42501' then
      raise exception 'OWNER was denied Product Identity submit authority: %',sqlerrm;
    end if;
    if position('PRODUCT_IDENTITY_BATCH_HAS_BLOCKING_TASKS' in sqlerrm)>0
       or position('PRODUCT_IDENTITY_BATCH_HAS_NO_DRAFT_CHANGES' in sqlerrm)>0 then
      v_owner_authorized:=true;
    else
      raise;
    end if;
  end;

  if not v_owner_authorized then
    -- A future fixture may contain enough complete draft evidence for the submit
    -- command to apply successfully. Reaching here without an exception also
    -- proves the Owner passed the authorization wrapper.
    v_owner_authorized:=true;
  end if;

  if not v_owner_authorized then
    raise exception 'OWNER did not pass the Product Identity submit boundary';
  end if;
end;
$owner_submit_boundary$;

reset app.test_role;
