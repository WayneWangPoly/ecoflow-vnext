-- Staged receiving completion workflow: scan barcode -> review/tick lines -> complete batch -> post stock.

create table if not exists public.ecoflow_warehouse_receiving_batches (
  id uuid primary key default gen_random_uuid(),
  batch_no text not null unique default ('WR-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' || substring(gen_random_uuid()::text from 1 for 4)),
  supplier_name text,
  supplier_order_ref text,
  invoice_ref text,
  batch_status text not null default 'SCANNING' check (batch_status in ('SCANNING','READY_TO_POST','POSTED','CANCELLED')),
  batch_note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  completed_by uuid,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.ecoflow_warehouse_receiving_lines (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.ecoflow_warehouse_receiving_batches(id) on delete cascade,
  sku text not null,
  product_name text,
  barcode text not null,
  package_level text,
  qty_packages numeric not null default 1,
  units_per_package numeric not null default 1,
  units_received numeric not null default 1,
  suggested_location text not null default 'RECEIVING',
  confirmation_checked boolean not null default false,
  line_status text not null default 'WAITING_CONFIRM' check (line_status in ('WAITING_CONFIRM','CONFIRMED','POSTED','CANCELLED')),
  movement_id uuid,
  line_note text,
  scanned_by uuid default auth.uid(),
  scanned_at timestamptz not null default now(),
  confirmed_by uuid,
  confirmed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists idx_warehouse_receiving_batches_status on public.ecoflow_warehouse_receiving_batches(batch_status, created_at desc);
create index if not exists idx_warehouse_receiving_lines_batch on public.ecoflow_warehouse_receiving_lines(batch_id, scanned_at desc);
create index if not exists idx_warehouse_receiving_lines_barcode on public.ecoflow_warehouse_receiving_lines(barcode);

grant select, insert, update on public.ecoflow_warehouse_receiving_batches to anon, authenticated;
grant select, insert, update on public.ecoflow_warehouse_receiving_lines to anon, authenticated;

create or replace function public.ecoflow_start_warehouse_receiving_batch(p_supplier_name text default null,p_supplier_order_ref text default null,p_invoice_ref text default null,p_note text default null)
returns table (batch_id uuid,batch_no text,batch_status text,created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.ecoflow_warehouse_receiving_batches(supplier_name,supplier_order_ref,invoice_ref,batch_note)
  values (nullif(trim(coalesce(p_supplier_name,'')),''),nullif(trim(coalesce(p_supplier_order_ref,'')),''),nullif(trim(coalesce(p_invoice_ref,'')),''),nullif(trim(coalesce(p_note,'')),'')) returning id into v_id;
  return query select b.id,b.batch_no,b.batch_status,b.created_at from public.ecoflow_warehouse_receiving_batches b where b.id=v_id;
end; $$;
grant execute on function public.ecoflow_start_warehouse_receiving_batch(text,text,text,text) to anon, authenticated;

create or replace function public.ecoflow_stage_receiving_scan(p_batch_id uuid,p_barcode text,p_qty_packages numeric default 1,p_target_location text default null,p_note text default null)
returns table (line_id uuid,batch_id uuid,sku text,product_name text,barcode text,package_level text,qty_packages numeric,units_received numeric,suggested_location text,confirmation_checked boolean,line_status text,scanned_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_batch_id uuid:=p_batch_id; v_barcode text:=nullif(trim(coalesce(p_barcode,'')),''); v_packages numeric:=greatest(coalesce(p_qty_packages,1),1); v_registry public.ecoflow_sku_barcode_registry%rowtype; v_units numeric; v_location text; v_id uuid;
begin
  if v_barcode is null then raise exception 'barcode is required'; end if;
  if v_batch_id is null then select batch_id into v_batch_id from public.ecoflow_start_warehouse_receiving_batch(null,null,null,'Auto receiving batch') limit 1; end if;
  select * into v_registry from public.ecoflow_sku_barcode_registry where barcode=v_barcode order by last_scanned_at desc limit 1;
  if v_registry.id is null then raise exception 'barcode is not mapped yet: %', v_barcode; end if;
  v_units:=v_packages*greatest(coalesce(v_registry.units_per_barcode,1),1);
  v_location:=coalesce(nullif(trim(coalesce(p_target_location,'')),''),nullif(trim(coalesce(v_registry.fixed_shelf,'')),''),(select nullif(trim(coalesce(c.fixed_shelf,'')),'') from public.ecoflow_inventory_sku_controls c where c.sku=v_registry.sku limit 1),(select nullif(trim(coalesce(p.default_shelf,'')),'') from public.ecoflow_sku_package_policies p where p.sku=v_registry.sku limit 1),'RECEIVING');
  insert into public.ecoflow_warehouse_receiving_lines(batch_id,sku,product_name,barcode,package_level,qty_packages,units_per_package,units_received,suggested_location,line_note)
  values (v_batch_id,v_registry.sku,v_registry.product_name,v_barcode,v_registry.package_level,v_packages,greatest(coalesce(v_registry.units_per_barcode,1),1),v_units,v_location,nullif(trim(coalesce(p_note,'')),'')) returning id into v_id;
  update public.ecoflow_warehouse_receiving_batches set batch_status='SCANNING',updated_at=now() where id=v_batch_id;
  return query select l.id,l.batch_id,l.sku,l.product_name,l.barcode,l.package_level,l.qty_packages,l.units_received,l.suggested_location,l.confirmation_checked,l.line_status,l.scanned_at from public.ecoflow_warehouse_receiving_lines l where l.id=v_id;
end; $$;
grant execute on function public.ecoflow_stage_receiving_scan(uuid,text,numeric,text,text) to anon, authenticated;

create or replace function public.ecoflow_confirm_warehouse_receiving_line(p_line_id uuid,p_confirmed boolean default true,p_note text default null)
returns table (line_id uuid,batch_id uuid,confirmation_checked boolean,line_status text,updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  update public.ecoflow_warehouse_receiving_lines set confirmation_checked=coalesce(p_confirmed,true),line_status=case when coalesce(p_confirmed,true) then 'CONFIRMED' else 'WAITING_CONFIRM' end,line_note=coalesce(nullif(trim(coalesce(p_note,'')),''),line_note),confirmed_by=case when coalesce(p_confirmed,true) then auth.uid() else null end,confirmed_at=case when coalesce(p_confirmed,true) then now() else null end,updated_at=now() where id=p_line_id and line_status in ('WAITING_CONFIRM','CONFIRMED');
  update public.ecoflow_warehouse_receiving_batches b set batch_status=case when exists(select 1 from public.ecoflow_warehouse_receiving_lines l where l.batch_id=b.id and l.line_status in ('WAITING_CONFIRM','CONFIRMED')) and not exists(select 1 from public.ecoflow_warehouse_receiving_lines l where l.batch_id=b.id and l.line_status in ('WAITING_CONFIRM','CONFIRMED') and not l.confirmation_checked) then 'READY_TO_POST' else 'SCANNING' end, updated_at=now() where b.id=(select batch_id from public.ecoflow_warehouse_receiving_lines where id=p_line_id);
  return query select l.id,l.batch_id,l.confirmation_checked,l.line_status,l.updated_at from public.ecoflow_warehouse_receiving_lines l where l.id=p_line_id;
end; $$;
grant execute on function public.ecoflow_confirm_warehouse_receiving_line(uuid,boolean,text) to anon, authenticated;

create or replace function public.ecoflow_complete_warehouse_receiving_batch(p_batch_id uuid,p_note text default null)
returns table (batch_id uuid,batch_no text,posted_lines numeric,posted_units numeric,batch_status text,completed_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_unconfirmed integer; v_line record; v_movement_id uuid;
begin
  select count(*) into v_unconfirmed from public.ecoflow_warehouse_receiving_lines where batch_id=p_batch_id and line_status in ('WAITING_CONFIRM','CONFIRMED') and not confirmation_checked;
  if v_unconfirmed>0 then raise exception 'all scanned receiving lines must be ticked before completion'; end if;
  if not exists(select 1 from public.ecoflow_warehouse_receiving_lines where batch_id=p_batch_id and confirmation_checked and movement_id is null) then raise exception 'no confirmed receiving lines to post'; end if;
  for v_line in select * from public.ecoflow_warehouse_receiving_lines where batch_id=p_batch_id and confirmation_checked and movement_id is null and line_status='CONFIRMED' order by scanned_at asc loop
    insert into public.ecoflow_inventory_movements(sku,product_name,movement_type,quantity,to_location,reference_type,reference_id,action_note,source,moved_by,moved_at)
    values (v_line.sku,v_line.product_name,'RECEIVE',v_line.units_received,v_line.suggested_location,'WAREHOUSE_RECEIVING_BATCH',v_line.id::text,coalesce(nullif(trim(coalesce(p_note,'')),''),v_line.line_note),'WAREHOUSE_RECEIVING_BATCH',auth.uid(),now()) returning id into v_movement_id;
    update public.ecoflow_warehouse_receiving_lines set movement_id=v_movement_id,line_status='POSTED',updated_at=now() where id=v_line.id;
  end loop;
  update public.ecoflow_warehouse_receiving_batches set batch_status='POSTED',completed_by=auth.uid(),completed_at=now(),batch_note=coalesce(nullif(trim(coalesce(p_note,'')),''),batch_note),updated_at=now() where id=p_batch_id;
  return query select b.id,b.batch_no,coalesce(count(l.id) filter(where l.line_status='POSTED'),0)::numeric,coalesce(sum(l.units_received) filter(where l.line_status='POSTED'),0)::numeric,b.batch_status,b.completed_at from public.ecoflow_warehouse_receiving_batches b left join public.ecoflow_warehouse_receiving_lines l on l.batch_id=b.id where b.id=p_batch_id group by b.id,b.batch_no,b.batch_status,b.completed_at;
end; $$;
grant execute on function public.ecoflow_complete_warehouse_receiving_batch(uuid,text) to anon, authenticated;

drop view if exists public.v_ecoflow_warehouse_receiving_batch_lines cascade;
drop view if exists public.v_ecoflow_warehouse_receiving_batches cascade;
create view public.v_ecoflow_warehouse_receiving_batches as select b.id,b.batch_no,b.supplier_name,b.supplier_order_ref,b.invoice_ref,b.batch_status,b.batch_note,b.created_at,b.completed_at,coalesce(count(l.id),0)::numeric as line_count,coalesce(count(l.id) filter(where l.confirmation_checked),0)::numeric as confirmed_count,coalesce(count(l.id) filter(where l.line_status='POSTED'),0)::numeric as posted_count,coalesce(sum(l.units_received),0)::numeric as total_units,case when b.batch_status='POSTED' then 'POSTED_TO_STOCK' when coalesce(count(l.id),0)=0 then 'SCAN_FIRST_ITEM' when coalesce(count(l.id) filter(where l.confirmation_checked),0)<coalesce(count(l.id),0) then 'WAITING_TICKS' else 'READY_TO_COMPLETE' end as receive_signal from public.ecoflow_warehouse_receiving_batches b left join public.ecoflow_warehouse_receiving_lines l on l.batch_id=b.id and l.line_status<>'CANCELLED' where b.batch_status<>'CANCELLED' group by b.id;
grant select on public.v_ecoflow_warehouse_receiving_batches to anon, authenticated;
create view public.v_ecoflow_warehouse_receiving_batch_lines as select l.id,l.batch_id,b.batch_no,b.batch_status,l.sku,l.product_name,l.barcode,l.package_level,l.qty_packages,l.units_per_package,l.units_received,l.suggested_location,l.confirmation_checked,l.line_status,l.movement_id,l.line_note,l.scanned_at,l.confirmed_at,l.updated_at from public.ecoflow_warehouse_receiving_lines l join public.ecoflow_warehouse_receiving_batches b on b.id=l.batch_id where l.line_status<>'CANCELLED';
grant select on public.v_ecoflow_warehouse_receiving_batch_lines to anon, authenticated;

notify pgrst, 'reload schema';
