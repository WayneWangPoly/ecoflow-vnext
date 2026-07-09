-- Receiving reconciliation workflow.
-- Real warehouse pattern: count incoming goods first, put stock straight to the shelf when practical,
-- then reconcile the counted receipt against the supplier/order/invoice before payment.

create table if not exists public.ecoflow_receiving_reconciliation_batches (
  id uuid primary key default gen_random_uuid(),
  batch_no text not null unique default ('RCV-' || to_char(now(), 'YYYYMMDD-HH24MISS')),
  supplier_name text,
  supplier_order_ref text,
  invoice_ref text,
  batch_status text not null default 'COUNTING' check (batch_status in ('COUNTING','RECEIVING','RECONCILING','READY_TO_PAY','VARIANCE_HOLD','CLOSED','CANCELLED')),
  counted_by uuid default auth.uid(),
  counted_at timestamptz not null default now(),
  reconciled_by uuid,
  reconciled_at timestamptz,
  payment_ready_at timestamptz,
  batch_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ecoflow_receiving_reconciliation_lines (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.ecoflow_receiving_reconciliation_batches(id) on delete cascade,
  sku text not null,
  product_name text,
  barcode text,
  package_level text,
  expected_packages numeric,
  counted_packages numeric not null default 0,
  units_per_package numeric not null default 1,
  received_units numeric not null default 0,
  target_location text,
  variance_packages numeric generated always as (coalesce(counted_packages,0) - coalesce(expected_packages,0)) stored,
  line_status text not null default 'COUNTED' check (line_status in ('COUNTED','RECEIVED','VARIANCE','OK','CANCELLED')),
  movement_id uuid,
  line_note text,
  counted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_receiving_recon_batches_status on public.ecoflow_receiving_reconciliation_batches(batch_status, created_at desc);
create index if not exists idx_receiving_recon_lines_batch on public.ecoflow_receiving_reconciliation_lines(batch_id);
create index if not exists idx_receiving_recon_lines_sku on public.ecoflow_receiving_reconciliation_lines(sku);

grant select, insert, update on public.ecoflow_receiving_reconciliation_batches to authenticated;
grant select, insert, update on public.ecoflow_receiving_reconciliation_lines to authenticated;

create or replace function public.ecoflow_touch_receiving_reconciliation_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_receiving_recon_batches_touch on public.ecoflow_receiving_reconciliation_batches;
create trigger trg_receiving_recon_batches_touch
before update on public.ecoflow_receiving_reconciliation_batches
for each row execute function public.ecoflow_touch_receiving_reconciliation_updated_at();

drop trigger if exists trg_receiving_recon_lines_touch on public.ecoflow_receiving_reconciliation_lines;
create trigger trg_receiving_recon_lines_touch
before update on public.ecoflow_receiving_reconciliation_lines
for each row execute function public.ecoflow_touch_receiving_reconciliation_updated_at();

create or replace function public.ecoflow_start_receiving_reconciliation(
  p_supplier_name text default null,
  p_supplier_order_ref text default null,
  p_invoice_ref text default null,
  p_note text default null
)
returns table (batch_id uuid, batch_no text, batch_status text, counted_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.ecoflow_receiving_reconciliation_batches(
    supplier_name, supplier_order_ref, invoice_ref, batch_status, counted_by, counted_at, batch_note
  ) values (
    nullif(trim(coalesce(p_supplier_name, '')), ''),
    nullif(trim(coalesce(p_supplier_order_ref, '')), ''),
    nullif(trim(coalesce(p_invoice_ref, '')), ''),
    'COUNTING',
    auth.uid(),
    now(),
    nullif(trim(coalesce(p_note, '')), '')
  ) returning id into v_id;

  return query
  select b.id, b.batch_no, b.batch_status, b.counted_at
  from public.ecoflow_receiving_reconciliation_batches b
  where b.id = v_id;
end;
$$;

grant execute on function public.ecoflow_start_receiving_reconciliation(text, text, text, text) to authenticated;

create or replace function public.ecoflow_record_receiving_reconciliation_line(
  p_batch_id uuid,
  p_barcode text,
  p_counted_packages numeric default 1,
  p_expected_packages numeric default null,
  p_target_location text default null,
  p_note text default null
)
returns table (line_id uuid, batch_id uuid, sku text, counted_packages numeric, received_units numeric, target_location text, line_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_registry public.ecoflow_sku_barcode_registry%rowtype;
  v_barcode text := nullif(trim(coalesce(p_barcode, '')), '');
  v_counted numeric := greatest(coalesce(p_counted_packages, 1), 0);
  v_units numeric;
  v_location text;
  v_line_id uuid;
begin
  if p_batch_id is null then raise exception 'batch_id is required'; end if;
  if v_barcode is null then raise exception 'barcode is required'; end if;

  if not exists (select 1 from public.ecoflow_receiving_reconciliation_batches where id = p_batch_id and batch_status <> 'CANCELLED') then
    raise exception 'receiving batch not found or cancelled';
  end if;

  select * into v_registry
  from public.ecoflow_sku_barcode_registry
  where barcode = v_barcode
  order by last_scanned_at desc
  limit 1;

  if v_registry.id is null then raise exception 'barcode is not mapped yet: %', v_barcode; end if;

  v_units := v_counted * greatest(coalesce(v_registry.units_per_barcode, 1), 1);
  v_location := coalesce(nullif(trim(coalesce(p_target_location, '')), ''), nullif(trim(coalesce(v_registry.fixed_shelf, '')), ''), 'RECEIVING');

  insert into public.ecoflow_receiving_reconciliation_lines(
    batch_id, sku, product_name, barcode, package_level, expected_packages, counted_packages,
    units_per_package, received_units, target_location, line_status, line_note, counted_at
  ) values (
    p_batch_id, v_registry.sku, v_registry.product_name, v_barcode, v_registry.package_level,
    p_expected_packages, v_counted, greatest(coalesce(v_registry.units_per_barcode, 1), 1),
    v_units, v_location,
    case when p_expected_packages is not null and p_expected_packages <> v_counted then 'VARIANCE' else 'COUNTED' end,
    nullif(trim(coalesce(p_note, '')), ''), now()
  ) returning id into v_line_id;

  update public.ecoflow_receiving_reconciliation_batches
  set batch_status = case when batch_status = 'COUNTING' then 'RECEIVING' else batch_status end
  where id = p_batch_id;

  return query
  select l.id, l.batch_id, l.sku, l.counted_packages, l.received_units, l.target_location, l.line_status
  from public.ecoflow_receiving_reconciliation_lines l
  where l.id = v_line_id;
end;
$$;

grant execute on function public.ecoflow_record_receiving_reconciliation_line(uuid, text, numeric, numeric, text, text) to authenticated;

create or replace function public.ecoflow_mark_receiving_reconciliation_status(
  p_batch_id uuid,
  p_status text,
  p_note text default null
)
returns table (batch_id uuid, batch_no text, batch_status text, variance_lines numeric, total_received_units numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := upper(trim(coalesce(p_status, '')));
begin
  if v_status not in ('COUNTING','RECEIVING','RECONCILING','READY_TO_PAY','VARIANCE_HOLD','CLOSED','CANCELLED') then
    raise exception 'invalid receiving reconciliation status';
  end if;

  update public.ecoflow_receiving_reconciliation_batches
  set batch_status = v_status,
      batch_note = coalesce(nullif(trim(coalesce(p_note, '')), ''), batch_note),
      reconciled_by = case when v_status in ('RECONCILING','READY_TO_PAY','VARIANCE_HOLD','CLOSED') then auth.uid() else reconciled_by end,
      reconciled_at = case when v_status in ('RECONCILING','READY_TO_PAY','VARIANCE_HOLD','CLOSED') then now() else reconciled_at end,
      payment_ready_at = case when v_status = 'READY_TO_PAY' then now() else payment_ready_at end
  where id = p_batch_id;

  return query
  select
    b.id,
    b.batch_no,
    b.batch_status,
    coalesce(count(l.id) filter (where l.line_status = 'VARIANCE'), 0)::numeric as variance_lines,
    coalesce(sum(l.received_units), 0)::numeric as total_received_units
  from public.ecoflow_receiving_reconciliation_batches b
  left join public.ecoflow_receiving_reconciliation_lines l on l.batch_id = b.id
  where b.id = p_batch_id
  group by b.id, b.batch_no, b.batch_status;
end;
$$;

grant execute on function public.ecoflow_mark_receiving_reconciliation_status(uuid, text, text) to authenticated;

drop view if exists public.v_ecoflow_receiving_reconciliation_batches cascade;
create view public.v_ecoflow_receiving_reconciliation_batches as
select
  b.id,
  b.batch_no,
  b.supplier_name,
  b.supplier_order_ref,
  b.invoice_ref,
  b.batch_status,
  b.counted_at,
  b.reconciled_at,
  b.payment_ready_at,
  b.batch_note,
  coalesce(count(l.id), 0)::numeric as line_count,
  coalesce(sum(l.counted_packages), 0)::numeric as counted_packages,
  coalesce(sum(l.received_units), 0)::numeric as received_units,
  coalesce(count(l.id) filter (where l.line_status = 'VARIANCE'), 0)::numeric as variance_lines,
  case
    when b.batch_status = 'READY_TO_PAY' then 'READY_TO_PAY'
    when coalesce(count(l.id) filter (where l.line_status = 'VARIANCE'), 0) > 0 then 'VARIANCE_REVIEW'
    when coalesce(count(l.id), 0) = 0 then 'COUNT_REQUIRED'
    else 'RECONCILE_READY'
  end as accounts_signal
from public.ecoflow_receiving_reconciliation_batches b
left join public.ecoflow_receiving_reconciliation_lines l on l.batch_id = b.id
where b.batch_status <> 'CANCELLED'
group by b.id;

grant select on public.v_ecoflow_receiving_reconciliation_batches to authenticated;

notify pgrst, 'reload schema';
