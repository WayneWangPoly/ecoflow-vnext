-- Product Identity submit authority hardening.
--
-- Commissioning capture remains available to OWNER / ADMIN / WAREHOUSE, but
-- review submission and publication are office authority: OWNER / ADMIN only.
-- Preserve the already-tested Phase 3 batch implementation behind narrow
-- wrappers so this correction changes authorization, not business semantics.

begin;

-- Preserve the existing implementation as a private primitive. The public
-- function below becomes the only authenticated entry point.
alter function public.ecoflow_submit_product_identity_batch(uuid,bigint,uuid,text)
  rename to ecoflow_submit_product_identity_batch_pre_owner_gate_20260811;

revoke all
on function public.ecoflow_submit_product_identity_batch_pre_owner_gate_20260811(uuid,bigint,uuid,text)
from public, anon, authenticated;

create or replace function public.ecoflow_submit_product_identity_batch(
  p_batch_id uuid,
  p_expected_revision bigint,
  p_command_id uuid,
  p_note text default null
)
returns table(
  batch_id uuid,
  batch_status text,
  revision bigint,
  command_status text,
  submitted_at timestamptz
)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
begin
  if not public.ecoflow_can_publish_product_identity() then
    raise exception using errcode='42501', message='OWNER_OR_ADMIN_REQUIRED';
  end if;

  return query
  select *
  from public.ecoflow_submit_product_identity_batch_pre_owner_gate_20260811(
    p_batch_id,
    p_expected_revision,
    p_command_id,
    p_note
  );
end;
$$;

revoke all
on function public.ecoflow_submit_product_identity_batch(uuid,bigint,uuid,text)
from public, anon;

grant execute
on function public.ecoflow_submit_product_identity_batch(uuid,bigint,uuid,text)
to authenticated;

-- Preserve the existing batch read implementation, but never advertise submit
-- capability to a role that the authoritative submit command will reject. This
-- keeps the current UI fail-closed without broadening Warehouse privileges.
alter function public.ecoflow_read_current_product_identity_batch()
  rename to ecoflow_read_current_product_identity_batch_pre_submit_role_20260811;

revoke all
on function public.ecoflow_read_current_product_identity_batch_pre_submit_role_20260811()
from public, anon, authenticated;

create or replace function public.ecoflow_read_current_product_identity_batch()
returns table(
  batch_id uuid,
  batch_name text,
  batch_status text,
  revision bigint,
  created_at timestamptz,
  submitted_at timestamptz,
  published_at timestamptz,
  open_tasks bigint,
  draft_ready_tasks bigint,
  conflict_tasks bigint,
  resolved_tasks bigint,
  can_submit boolean,
  can_publish boolean,
  read_at timestamptz
)
language sql
stable
security definer
set search_path=pg_catalog,public
as $$
  select
    r.batch_id,
    r.batch_name,
    r.batch_status,
    r.revision,
    r.created_at,
    r.submitted_at,
    r.published_at,
    r.open_tasks,
    r.draft_ready_tasks,
    r.conflict_tasks,
    r.resolved_tasks,
    r.can_submit and public.ecoflow_can_publish_product_identity(),
    r.can_publish,
    r.read_at
  from public.ecoflow_read_current_product_identity_batch_pre_submit_role_20260811() r;
$$;

revoke all
on function public.ecoflow_read_current_product_identity_batch()
from public, anon;

grant execute
on function public.ecoflow_read_current_product_identity_batch()
to authenticated;

comment on function public.ecoflow_submit_product_identity_batch(uuid,bigint,uuid,text) is
  'Owner/Admin-only review submission boundary. Warehouse may capture draft physical evidence but cannot submit or publish it.';

comment on function public.ecoflow_read_current_product_identity_batch() is
  'Current Product Identity batch read; can_submit is role-aware and false outside Owner/Admin authority.';

notify pgrst,'reload schema';
commit;
