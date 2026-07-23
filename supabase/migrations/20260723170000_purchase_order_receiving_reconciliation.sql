-- Purchase order, warehouse receipt and Accounts reconciliation.

begin;

create or replace function public.ecoflow_can_manage_purchasing()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_user_profiles p
    where p.user_id = auth.uid()
      and p.is_active = true
      and p.team_status = 'ACTIVE'
      and p.app_role in ('OWNER','ADMIN','ACCOUNT')
  );
$$;

grant execute on function public.ecoflow_can_manage_purchasing() to authenticated;
revoke execute on function public.ecoflow_can_manage_purchasing() from anon;

create table if not exists public.ecoflow_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text not null unique,
  supplier_name text not null,
  order_date date not null default current_date,
  expected_date date,
  currency text not null default 'AUD',
  po_status text not null default 'OPEN'
    check (po_status in ('OPEN','PART_RECEIVED','AWAITING_REVIEW','VARIANCE','MATCHED','CLOSED','CANCELLED')),
  po_note text,
  review_note text,
  created_by uuid not null default auth.uid(),
  reviewed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  closed_at timestamptz,
  cancelled_at timestamptz
);

create table if not exists public.ecoflow_purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.ecoflow_purchase_orders(id) on delete cascade,
  sku text not null,
  product_name text,
  package_level text not null default 'CARTON'
    check (package_level in ('CARTON','SLEEVE','INNER','EACH')),
  ordered_packages numeric not null check (ordered_packages > 0 and ordered_packages = trunc(ordered_packages)),
  units_per_package numeric not null default 1 check (units_per_package > 0 and units_per_package = trunc(units_per_package)),
  unit_cost numeric,
  line_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (purchase_order_id, sku)
);

alter table public.ecoflow_warehouse_receiving_batches
  add column if not exists purchase_order_id uuid references public.ecoflow_purchase_orders(id) on delete set null,
  add column if not exists delivery_docket_ref text,
  add column if not exists delivery_document_path text,
  add column if not exists delivery_document_uploaded_at timestamptz,
  add column if not exists physically_received_by uuid,
  add column if not exists physically_received_at timestamptz;

create index if not exists idx_purchase_orders_status on public.ecoflow_purchase_orders(po_status, updated_at desc);
create index if not exists idx_purchase_order_lines_po on public.ecoflow_purchase_order_lines(purchase_order_id, sku);
create index if not exists idx_receiving_batches_po on public.ecoflow_warehouse_receiving_batches(purchase_order_id, created_at desc)
  where purchase_order_id is not null;

revoke all on public.ecoflow_purchase_orders from anon, authenticated;
revoke all on public.ecoflow_purchase_order_lines from anon, authenticated;
grant select on public.ecoflow_purchase_orders to authenticated;
grant select on public.ecoflow_purchase_order_lines to authenticated;

create or replace function public.ecoflow_recalculate_purchase_order_status(p_purchase_order_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
  v_total integer := 0;
  v_touched integer := 0;
  v_exact integer := 0;
  v_over integer := 0;
  v_unplanned integer := 0;
  v_next text;
begin
  select po_status into v_current
  from public.ecoflow_purchase_orders
  where id = p_purchase_order_id
  for update;

  if not found then raise exception 'purchase order not found'; end if;
  if v_current in ('CLOSED','CANCELLED') then return v_current; end if;

  with expected as (
    select l.sku, l.ordered_packages * l.units_per_package as expected_units
    from public.ecoflow_purchase_order_lines l
    where l.purchase_order_id = p_purchase_order_id
  ), received as (
    select upper(trim(l.sku)) as sku, sum(l.units_received) as received_units
    from public.ecoflow_warehouse_receiving_batches b
    join public.ecoflow_warehouse_receiving_lines l on l.batch_id = b.id
    where b.purchase_order_id = p_purchase_order_id
      and b.batch_status = 'POSTED'
      and l.line_status = 'POSTED'
    group by upper(trim(l.sku))
  ), comparison as (
    select e.sku, e.expected_units, coalesce(r.received_units,0) as received_units
    from expected e
    left join received r on upper(trim(e.sku)) = r.sku
  )
  select count(*),
         count(*) filter (where received_units > 0),
         count(*) filter (where received_units = expected_units),
         count(*) filter (where received_units > expected_units)
  into v_total, v_touched, v_exact, v_over
  from comparison;

  select count(*) into v_unplanned
  from (
    select distinct upper(trim(l.sku)) as sku
    from public.ecoflow_warehouse_receiving_batches b
    join public.ecoflow_warehouse_receiving_lines l on l.batch_id = b.id
    where b.purchase_order_id = p_purchase_order_id
      and b.batch_status = 'POSTED'
      and l.line_status = 'POSTED'
  ) received
  where not exists (
    select 1 from public.ecoflow_purchase_order_lines pol
    where pol.purchase_order_id = p_purchase_order_id
      and upper(trim(pol.sku)) = received.sku
  );

  v_next := case
    when v_touched = 0 then 'OPEN'
    when v_over > 0 or v_unplanned > 0 then 'VARIANCE'
    when v_total > 0 and v_exact = v_total then 'AWAITING_REVIEW'
    else 'PART_RECEIVED'
  end;

  update public.ecoflow_purchase_orders
  set po_status = v_next, updated_at = now()
  where id = p_purchase_order_id;

  return v_next;
end;
$$;

revoke execute on function public.ecoflow_recalculate_purchase_order_status(uuid) from anon, authenticated;

create or replace function public.ecoflow_create_purchase_order(
  p_po_number text,
  p_supplier_name text,
  p_order_date date default current_date,
  p_expected_date date default null,
  p_currency text default 'AUD',
  p_note text default null,
  p_lines jsonb default '[]'::jsonb
)
returns table (purchase_order_id uuid, po_number text, po_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_number text := upper(nullif(trim(coalesce(p_po_number,'')),''));
  v_supplier text := nullif(trim(coalesce(p_supplier_name,'')),'');
  v_line jsonb;
begin
  if not public.ecoflow_can_manage_purchasing() then raise exception 'OWNER_ADMIN_OR_ACCOUNT_REQUIRED'; end if;
  if v_number is null then raise exception 'PO number is required'; end if;
  if v_supplier is null then raise exception 'supplier is required'; end if;
  if jsonb_typeof(coalesce(p_lines,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_lines,'[]'::jsonb)) = 0 then
    raise exception 'at least one PO line is required';
  end if;

  insert into public.ecoflow_purchase_orders(po_number,supplier_name,order_date,expected_date,currency,po_note,created_by)
  values(v_number,v_supplier,coalesce(p_order_date,current_date),p_expected_date,upper(coalesce(nullif(trim(p_currency),''),'AUD')),nullif(trim(coalesce(p_note,'')),''),auth.uid())
  returning id into v_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    insert into public.ecoflow_purchase_order_lines(
      purchase_order_id,sku,product_name,package_level,ordered_packages,units_per_package,unit_cost,line_note
    ) values (
      v_id,
      upper(nullif(trim(coalesce(v_line->>'sku','')),'')),
      nullif(trim(coalesce(v_line->>'productName','')),''),
      upper(coalesce(nullif(trim(v_line->>'packageLevel'),''),'CARTON')),
      (v_line->>'orderedPackages')::numeric,
      coalesce(nullif(v_line->>'unitsPerPackage','')::numeric,1),
      nullif(v_line->>'unitCost','')::numeric,
      nullif(trim(coalesce(v_line->>'note','')),'')
    );
  end loop;

  return query select p.id,p.po_number,p.po_status from public.ecoflow_purchase_orders p where p.id=v_id;
end;
$$;

grant execute on function public.ecoflow_create_purchase_order(text,text,date,date,text,text,jsonb) to authenticated;
revoke execute on function public.ecoflow_create_purchase_order(text,text,date,date,text,text,jsonb) from anon;

create or replace function public.ecoflow_read_purchase_orders(p_limit integer default 120)
returns table (
  id uuid, po_number text, supplier_name text, order_date date, expected_date date, currency text,
  po_status text, po_note text, review_note text, created_at timestamptz, updated_at timestamptz,
  line_count bigint, ordered_units numeric, received_units numeric, variance_units numeric, receipt_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.ecoflow_can_manage_purchasing() then raise exception 'OWNER_ADMIN_OR_ACCOUNT_REQUIRED'; end if;
  return query
  with expected as (
    select l.purchase_order_id, count(*) line_count, sum(l.ordered_packages*l.units_per_package) ordered_units
    from public.ecoflow_purchase_order_lines l group by l.purchase_order_id
  ), received as (
    select b.purchase_order_id, sum(l.units_received) received_units, count(distinct b.id) receipt_count
    from public.ecoflow_warehouse_receiving_batches b
    join public.ecoflow_warehouse_receiving_lines l on l.batch_id=b.id
    where b.purchase_order_id is not null and b.batch_status='POSTED' and l.line_status='POSTED'
    group by b.purchase_order_id
  )
  select p.id,p.po_number,p.supplier_name,p.order_date,p.expected_date,p.currency,p.po_status,p.po_note,p.review_note,
         p.created_at,p.updated_at,coalesce(e.line_count,0),coalesce(e.ordered_units,0),coalesce(r.received_units,0),
         coalesce(r.received_units,0)-coalesce(e.ordered_units,0),coalesce(r.receipt_count,0)
  from public.ecoflow_purchase_orders p
  left join expected e on e.purchase_order_id=p.id
  left join received r on r.purchase_order_id=p.id
  order by p.updated_at desc
  limit greatest(1,least(coalesce(p_limit,120),300));
end;
$$;

grant execute on function public.ecoflow_read_purchase_orders(integer) to authenticated;
revoke execute on function public.ecoflow_read_purchase_orders(integer) from anon;

create or replace function public.ecoflow_read_open_purchase_orders()
returns table (
  id uuid, po_number text, supplier_name text, expected_date date, po_status text,
  ordered_units numeric, received_units numeric, remaining_units numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.ecoflow_can_manage_purchasing() or public.ecoflow_can_manage_warehouse()) then
    raise exception 'PURCHASING_OR_WAREHOUSE_REQUIRED';
  end if;
  return query
  with expected as (
    select l.purchase_order_id, sum(l.ordered_packages*l.units_per_package) ordered_units
    from public.ecoflow_purchase_order_lines l group by l.purchase_order_id
  ), received as (
    select b.purchase_order_id, sum(l.units_received) received_units
    from public.ecoflow_warehouse_receiving_batches b
    join public.ecoflow_warehouse_receiving_lines l on l.batch_id=b.id
    where b.purchase_order_id is not null and b.batch_status='POSTED' and l.line_status='POSTED'
    group by b.purchase_order_id
  )
  select p.id,p.po_number,p.supplier_name,p.expected_date,p.po_status,
         coalesce(e.ordered_units,0),coalesce(r.received_units,0),greatest(coalesce(e.ordered_units,0)-coalesce(r.received_units,0),0)
  from public.ecoflow_purchase_orders p
  left join expected e on e.purchase_order_id=p.id
  left join received r on r.purchase_order_id=p.id
  where p.po_status in ('OPEN','PART_RECEIVED','VARIANCE')
  order by p.expected_date nulls last,p.created_at desc;
end;
$$;

grant execute on function public.ecoflow_read_open_purchase_orders() to authenticated;
revoke execute on function public.ecoflow_read_open_purchase_orders() from anon;

create or replace function public.ecoflow_read_purchase_order_lines(p_purchase_order_id uuid)
returns table (
  id uuid, sku text, product_name text, package_level text, ordered_packages numeric,
  units_per_package numeric, expected_units numeric, received_packages numeric, received_units numeric,
  variance_units numeric, unit_cost numeric, line_note text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.ecoflow_can_manage_purchasing() or public.ecoflow_can_manage_warehouse()) then
    raise exception 'PURCHASING_OR_WAREHOUSE_REQUIRED';
  end if;
  return query
  with received as (
    select upper(trim(l.sku)) sku, sum(l.qty_packages) received_packages, sum(l.units_received) received_units
    from public.ecoflow_warehouse_receiving_batches b
    join public.ecoflow_warehouse_receiving_lines l on l.batch_id=b.id
    where b.purchase_order_id=p_purchase_order_id and b.batch_status='POSTED' and l.line_status='POSTED'
    group by upper(trim(l.sku))
  )
  select pol.id,pol.sku,pol.product_name,pol.package_level,pol.ordered_packages,pol.units_per_package,
         pol.ordered_packages*pol.units_per_package,coalesce(r.received_packages,0),coalesce(r.received_units,0),
         coalesce(r.received_units,0)-(pol.ordered_packages*pol.units_per_package),pol.unit_cost,pol.line_note
  from public.ecoflow_purchase_order_lines pol
  left join received r on r.sku=upper(trim(pol.sku))
  where pol.purchase_order_id=p_purchase_order_id
  order by pol.created_at,pol.sku;
end;
$$;

grant execute on function public.ecoflow_read_purchase_order_lines(uuid) to authenticated;
revoke execute on function public.ecoflow_read_purchase_order_lines(uuid) from anon;

create or replace function public.ecoflow_read_purchase_order_receipts(p_purchase_order_id uuid)
returns table (
  batch_id uuid, batch_no text, batch_status text, delivery_docket_ref text, delivery_document_path text,
  supplier_name text, posted_units numeric, physically_received_at timestamptz, created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.ecoflow_can_manage_purchasing() then raise exception 'OWNER_ADMIN_OR_ACCOUNT_REQUIRED'; end if;
  return query
  select b.id,b.batch_no,b.batch_status,b.delivery_docket_ref,b.delivery_document_path,b.supplier_name,
         coalesce(sum(l.units_received) filter (where l.line_status='POSTED'),0),b.physically_received_at,b.created_at
  from public.ecoflow_warehouse_receiving_batches b
  left join public.ecoflow_warehouse_receiving_lines l on l.batch_id=b.id
  where b.purchase_order_id=p_purchase_order_id
  group by b.id,b.batch_no,b.batch_status,b.delivery_docket_ref,b.delivery_document_path,b.supplier_name,b.physically_received_at,b.created_at
  order by b.created_at desc;
end;
$$;

grant execute on function public.ecoflow_read_purchase_order_receipts(uuid) to authenticated;
revoke execute on function public.ecoflow_read_purchase_order_receipts(uuid) from anon;

create or replace function public.ecoflow_start_po_receiving_batch(
  p_purchase_order_id uuid,
  p_delivery_docket_ref text,
  p_note text default null
)
returns table (batch_id uuid,batch_no text,batch_status text,po_number text,supplier_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.ecoflow_purchase_orders%rowtype;
  v_id uuid;
  v_docket text := upper(nullif(trim(coalesce(p_delivery_docket_ref,'')),''));
begin
  if not public.ecoflow_can_manage_warehouse() then raise exception 'OWNER_ADMIN_OR_WAREHOUSE_REQUIRED'; end if;
  if v_docket is null then raise exception 'delivery docket reference is required'; end if;

  select * into v_po from public.ecoflow_purchase_orders where id=p_purchase_order_id for update;
  if not found then raise exception 'purchase order not found'; end if;
  if v_po.po_status not in ('OPEN','PART_RECEIVED','VARIANCE') then raise exception 'purchase order is not open for receiving'; end if;

  insert into public.ecoflow_warehouse_receiving_batches(
    supplier_name,supplier_order_ref,batch_note,created_by,created_at,updated_at,
    purchase_order_id,delivery_docket_ref,physically_received_by,physically_received_at
  ) values (
    v_po.supplier_name,v_po.po_number,nullif(trim(coalesce(p_note,'')),''),auth.uid(),now(),now(),
    v_po.id,v_docket,auth.uid(),now()
  ) returning id into v_id;

  insert into public.ecoflow_warehouse_receiving_audit(batch_id,action,detail)
  values(v_id,'PO_RECEIPT_STARTED',v_po.po_number || ' · docket ' || v_docket);

  return query
  select b.id,b.batch_no,b.batch_status,v_po.po_number,v_po.supplier_name
  from public.ecoflow_warehouse_receiving_batches b where b.id=v_id;
end;
$$;

grant execute on function public.ecoflow_start_po_receiving_batch(uuid,text,text) to authenticated;
revoke execute on function public.ecoflow_start_po_receiving_batch(uuid,text,text) from anon;

create or replace function public.ecoflow_set_receiving_document(p_batch_id uuid,p_document_path text)
returns table (batch_id uuid, delivery_document_path text, delivery_document_uploaded_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.ecoflow_can_manage_warehouse() then raise exception 'OWNER_ADMIN_OR_WAREHOUSE_REQUIRED'; end if;
  update public.ecoflow_warehouse_receiving_batches
  set delivery_document_path=nullif(trim(coalesce(p_document_path,'')),''),delivery_document_uploaded_at=now(),updated_at=now()
  where id=p_batch_id and batch_status in ('SCANNING','READY_TO_POST');
  if not found then raise exception 'open receiving batch not found'; end if;
  insert into public.ecoflow_warehouse_receiving_audit(batch_id,action,detail)
  values(p_batch_id,'DELIVERY_DOCUMENT_ATTACHED',p_document_path);
  return query select b.id,b.delivery_document_path,b.delivery_document_uploaded_at
  from public.ecoflow_warehouse_receiving_batches b where b.id=p_batch_id;
end;
$$;

grant execute on function public.ecoflow_set_receiving_document(uuid,text) to authenticated;
revoke execute on function public.ecoflow_set_receiving_document(uuid,text) from anon;

create or replace function public.ecoflow_review_purchase_order(
  p_purchase_order_id uuid,
  p_action text,
  p_note text default null
)
returns table (purchase_order_id uuid, po_status text, reviewed_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text := upper(trim(coalesce(p_action,'')));
  v_status text;
begin
  if not public.ecoflow_can_manage_purchasing() then raise exception 'OWNER_ADMIN_OR_ACCOUNT_REQUIRED'; end if;
  if v_action not in ('MATCH','ACCEPT_VARIANCE','REOPEN','CLOSE','CANCEL') then raise exception 'invalid review action'; end if;

  if v_action='REOPEN' then
    v_status := public.ecoflow_recalculate_purchase_order_status(p_purchase_order_id);
  else
    v_status := case
      when v_action in ('MATCH','ACCEPT_VARIANCE') then 'MATCHED'
      when v_action='CLOSE' then 'CLOSED'
      else 'CANCELLED'
    end;
    update public.ecoflow_purchase_orders
    set po_status=v_status,review_note=nullif(trim(coalesce(p_note,'')),''),reviewed_by=auth.uid(),reviewed_at=now(),
        closed_at=case when v_status='CLOSED' then now() else closed_at end,
        cancelled_at=case when v_status='CANCELLED' then now() else cancelled_at end,
        updated_at=now()
    where id=p_purchase_order_id;
    if not found then raise exception 'purchase order not found'; end if;
  end if;

  return query select p.id,p.po_status,p.reviewed_at from public.ecoflow_purchase_orders p where p.id=p_purchase_order_id;
end;
$$;

grant execute on function public.ecoflow_review_purchase_order(uuid,text,text) to authenticated;
revoke execute on function public.ecoflow_review_purchase_order(uuid,text,text) from anon;

create or replace function public.ecoflow_recalculate_po_after_receipt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.purchase_order_id is not null and new.batch_status='POSTED' and old.batch_status is distinct from new.batch_status then
    perform public.ecoflow_recalculate_purchase_order_status(new.purchase_order_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ecoflow_recalculate_po_after_receipt on public.ecoflow_warehouse_receiving_batches;
create trigger trg_ecoflow_recalculate_po_after_receipt
after update of batch_status on public.ecoflow_warehouse_receiving_batches
for each row execute function public.ecoflow_recalculate_po_after_receipt();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('receiving-documents','receiving-documents',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "receiving documents insert" on storage.objects;
create policy "receiving documents insert" on storage.objects
for insert to authenticated
with check (bucket_id='receiving-documents' and public.ecoflow_can_manage_warehouse());

drop policy if exists "receiving documents update" on storage.objects;
create policy "receiving documents update" on storage.objects
for update to authenticated
using (bucket_id='receiving-documents' and public.ecoflow_can_manage_warehouse())
with check (bucket_id='receiving-documents' and public.ecoflow_can_manage_warehouse());

drop policy if exists "receiving documents read" on storage.objects;
create policy "receiving documents read" on storage.objects
for select to authenticated
using (bucket_id='receiving-documents' and (public.ecoflow_can_manage_warehouse() or public.ecoflow_can_manage_purchasing()));

commit;
