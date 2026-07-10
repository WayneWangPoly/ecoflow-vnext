-- Delivery POD quality records.
-- POD 1 remains on the stop day-state record (store/drop-location photo).
-- POD 2 is recorded here (all cartons placed), linked to the locked route order id.

create extension if not exists pgcrypto;

create table if not exists public.ecoflow_delivery_pod_proofs (
  id uuid primary key default gen_random_uuid(),
  business_day text not null,
  order_id text not null,
  order_number text,
  stop_number integer,
  box_code text,
  store_name text,
  proof_type text not null check (proof_type in ('POD2_GOODS_PLACED')),
  photo_path text not null,
  captured_at timestamptz not null default now(),
  captured_by text,
  created_at timestamptz not null default now(),
  unique (business_day, order_id, proof_type)
);

create index if not exists idx_delivery_pod_proofs_day on public.ecoflow_delivery_pod_proofs(business_day, captured_at desc);
create index if not exists idx_delivery_pod_proofs_order on public.ecoflow_delivery_pod_proofs(order_id);

grant select, insert, update on public.ecoflow_delivery_pod_proofs to anon, authenticated;

create or replace view public.v_ecoflow_delivery_pod_quality as
select
  p.business_day,
  p.order_id,
  p.order_number,
  p.stop_number,
  p.box_code,
  p.store_name,
  p.photo_path as goods_placed_photo_path,
  p.captured_at as goods_placed_captured_at,
  p.captured_by,
  case when p.photo_path is not null then 'POD2_CAPTURED' else 'POD2_MISSING' end as pod2_status
from public.ecoflow_delivery_pod_proofs p
where p.proof_type = 'POD2_GOODS_PLACED';

grant select on public.v_ecoflow_delivery_pod_quality to anon, authenticated;

notify pgrst, 'reload schema';
