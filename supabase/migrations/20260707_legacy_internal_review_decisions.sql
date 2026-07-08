-- Legacy internal review workflow.
-- This is intentionally non-destructive: owner/accounts decisions are recorded first,
-- while actual draft cancellation or rebuild can be wired to the real internal-order tables later.

create table if not exists public.ecoflow_legacy_internal_review_decisions (
  id uuid primary key default gen_random_uuid(),
  lifecycle_id text not null unique,
  order_number text,
  invoice_number text,
  internal_order_id text,
  decision text not null check (decision in ('ARCHIVE_APPROVED','CANCEL_DRAFT_REQUESTED','REBUILD_REQUESTED','KEEP_REVIEW')),
  decision_note text,
  decided_by uuid default auth.uid(),
  decided_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_legacy_review_decisions_decision on public.ecoflow_legacy_internal_review_decisions(decision);
create index if not exists idx_legacy_review_decisions_decided_at on public.ecoflow_legacy_internal_review_decisions(decided_at desc);

grant select, insert, update on public.ecoflow_legacy_internal_review_decisions to authenticated;

create or replace function public.ecoflow_record_legacy_internal_review_decision(
  p_lifecycle_id text,
  p_decision text,
  p_note text default null
)
returns table (
  id uuid,
  lifecycle_id text,
  order_number text,
  invoice_number text,
  internal_order_id text,
  decision text,
  decision_note text,
  decided_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_decision text := upper(trim(coalesce(p_decision, '')));
begin
  if nullif(trim(coalesce(p_lifecycle_id, '')), '') is null then
    raise exception 'lifecycle_id is required';
  end if;

  if v_decision not in ('ARCHIVE_APPROVED','CANCEL_DRAFT_REQUESTED','REBUILD_REQUESTED','KEEP_REVIEW') then
    raise exception 'unsupported legacy review decision: %', p_decision;
  end if;

  select * into v_order
  from public.v_ecoflow_order_lifecycle_board b
  where b.lifecycle_id = p_lifecycle_id
  limit 1;

  if not found then
    raise exception 'legacy review order not found: %', p_lifecycle_id;
  end if;

  insert into public.ecoflow_legacy_internal_review_decisions (
    lifecycle_id,
    order_number,
    invoice_number,
    internal_order_id,
    decision,
    decision_note,
    decided_by,
    decided_at,
    updated_at
  ) values (
    v_order.lifecycle_id,
    v_order.order_number,
    v_order.invoice_number,
    v_order.internal_order_id,
    v_decision,
    nullif(trim(coalesce(p_note, '')), ''),
    auth.uid(),
    now(),
    now()
  )
  on conflict (lifecycle_id) do update set
    order_number = excluded.order_number,
    invoice_number = excluded.invoice_number,
    internal_order_id = excluded.internal_order_id,
    decision = excluded.decision,
    decision_note = excluded.decision_note,
    decided_by = excluded.decided_by,
    decided_at = excluded.decided_at,
    updated_at = now();

  return query
  select
    d.id,
    d.lifecycle_id,
    d.order_number,
    d.invoice_number,
    d.internal_order_id,
    d.decision,
    d.decision_note,
    d.decided_at
  from public.ecoflow_legacy_internal_review_decisions d
  where d.lifecycle_id = v_order.lifecycle_id;
end;
$$;

grant execute on function public.ecoflow_record_legacy_internal_review_decision(text, text, text) to authenticated;

drop view if exists public.v_ecoflow_order_lifecycle_legacy_review_decisions;

create view public.v_ecoflow_order_lifecycle_legacy_review_decisions as
select
  d.*,
  b.lifecycle_status,
  b.ordermentum_order_status,
  b.ordermentum_invoice_status,
  b.internalisation_status,
  b.warehouse_gate_status,
  b.invoice_total,
  b.lifecycle_updated_at
from public.ecoflow_legacy_internal_review_decisions d
left join public.v_ecoflow_order_lifecycle_board b on b.lifecycle_id = d.lifecycle_id
order by d.decided_at desc;

grant select on public.v_ecoflow_order_lifecycle_legacy_review_decisions to authenticated;

create or replace view public.v_ecoflow_order_lifecycle_legacy_internal_review as
select b.*
from public.v_ecoflow_order_lifecycle_board b
where b.lifecycle_status = 'INTERNAL_ORDER_CREATED'
  and b.internal_order_id is not null
  and b.internal_order_id <> ''
  and lower(coalesce(b.internalisation_status, '')) in ('ready_to_internalise','ready','release_ready')
  and lower(coalesce(b.warehouse_gate_status, '')) in ('blocked_barcode','barcode_blocked')
  and not exists (
    select 1
    from public.ecoflow_legacy_internal_review_decisions d
    where d.lifecycle_id = b.lifecycle_id
      and d.decision in ('ARCHIVE_APPROVED','CANCEL_DRAFT_REQUESTED','REBUILD_REQUESTED')
  );

grant select on public.v_ecoflow_order_lifecycle_legacy_internal_review to authenticated;

notify pgrst, 'reload schema';
