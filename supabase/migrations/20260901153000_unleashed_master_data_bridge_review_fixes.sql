-- UNLEASHED-MIGRATION-003 independent-review hardening.
--
-- This follow-up stays inside the #338 boundary: no Physical SKU creation,
-- inventory mutation, provider call, production copy, or authority cutover.
-- It closes cross-package retention and review/concurrency gaps found after the
-- initial bridge contract was CI-green.

begin;

-- Raw Unleashed JSON is governed by the already-accepted 14-day retention
-- contract. Durable asset provenance must therefore survive deletion of the
-- staging row instead of retaining raw JSON indefinitely.
alter table public.ecoflow_unleashed_product_assets
  alter column source_snapshot_id drop not null;

alter table public.ecoflow_unleashed_product_assets
  drop constraint if exists ecoflow_unleashed_product_assets_source_snapshot_id_fkey;
alter table public.ecoflow_unleashed_product_assets
  drop constraint if exists ecoflow_unleashed_product_assets_source_snapshot_retention_fkey;
alter table public.ecoflow_unleashed_product_assets
  add constraint ecoflow_unleashed_product_assets_source_snapshot_retention_fkey
  foreign key (source_snapshot_id)
  references public.unleashed_raw_snapshots(id)
  on delete set null;

-- Explicit external identifiers are authority-bearing inputs. Empty text must
-- never be able to match a missing GUID/code through SQL coalesce semantics.
alter table public.ecoflow_external_object_mappings
  drop constraint if exists ecoflow_external_object_mappings_external_id_nonblank;
alter table public.ecoflow_external_object_mappings
  add constraint ecoflow_external_object_mappings_external_id_nonblank
  check (length(btrim(external_id)) > 0) not valid;
alter table public.ecoflow_external_object_mappings
  validate constraint ecoflow_external_object_mappings_external_id_nonblank;

-- A PLAN replay may compute preservation from a pre-lock snapshot while an
-- Owner/Admin review is committing. This trigger is the final authority guard:
-- if source and candidate hashes are unchanged, an already-reviewed decision
-- cannot be demoted back to AUTO by a stale planner update.
create or replace function public.ecoflow_guard_unleashed_review_preservation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.decision_source = 'REVIEW'
     and new.decision_source = 'AUTO'
     and old.source_payload_sha256 = new.source_payload_sha256
     and old.candidate_set_sha256 = new.candidate_set_sha256 then
    new.mapping_status := old.mapping_status;
    new.canonical_object_type := old.canonical_object_type;
    new.canonical_object_id := old.canonical_object_id;
    new.canonical_code := old.canonical_code;
    new.ordermentum_external_id := old.ordermentum_external_id;
    new.match_method := old.match_method;
    new.decision_source := old.decision_source;
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
    new.review_reason := old.review_reason;
    new.revision := old.revision;
  end if;
  return new;
end;
$$;

drop trigger if exists ecoflow_unleashed_review_preservation_guard
  on public.ecoflow_unleashed_master_mappings;
create trigger ecoflow_unleashed_review_preservation_guard
before update on public.ecoflow_unleashed_master_mappings
for each row execute function public.ecoflow_guard_unleashed_review_preservation();

-- A source that is currently obsolete/inactive/retired cannot be promoted to
-- MATCHED by a manual review merely because an old/current candidate row exists.
-- A reviewed MATCHED decision also requires current raw source evidence; if the
-- staging row has already aged out, a fresh bounded source observation is
-- required before authority can be granted.
create or replace function public.ecoflow_guard_unleashed_retired_review_match()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_resource text;
  v_external_key text;
begin
  if new.decision_source <> 'REVIEW' or new.mapping_status <> 'MATCHED' then
    return new;
  end if;

  select i.resource, i.external_key, s.payload
    into v_resource, v_external_key, v_payload
  from public.unleashed_external_identities i
  left join public.unleashed_raw_snapshots s
    on s.resource = i.resource
   and s.external_key = i.external_key
  where i.id = new.identity_id;

  if v_resource is null then
    raise exception 'UNLEASHED_MAPPING_SOURCE_IDENTITY_NOT_FOUND';
  end if;
  if v_payload is null then
    raise exception 'UNLEASHED_MAPPING_SOURCE_SNAPSHOT_REQUIRED';
  end if;
  if public.ecoflow_unleashed_json_boolean(v_payload->'Obsolete')
     or lower(coalesce(v_payload->>'Status','')) in ('obsolete','inactive','retired') then
    raise exception 'RETIRED_SOURCE_CANNOT_BE_MATCHED';
  end if;

  return new;
end;
$$;

drop trigger if exists ecoflow_unleashed_retired_review_match_guard
  on public.ecoflow_unleashed_master_mappings;
create trigger ecoflow_unleashed_retired_review_match_guard
before update on public.ecoflow_unleashed_master_mappings
for each row execute function public.ecoflow_guard_unleashed_retired_review_match();

-- Serialize raw-snapshot deletion against image-copy claims by locking every
-- referencing asset row. If a copy has already reached COPYING, keep the raw
-- source for that bounded lease. If purge wins first, ON DELETE SET NULL makes
-- the later Edge claim fail its source_snapshot_id equality check.
create or replace function public.ecoflow_guard_unleashed_raw_snapshot_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_asset record;
begin
  for v_asset in
    select p.id, p.asset_status
    from public.ecoflow_unleashed_product_assets p
    where p.source_snapshot_id = old.id
    order by p.id
    for update
  loop
    if v_asset.asset_status = 'COPYING' then
      return null;
    end if;
  end loop;
  return old;
end;
$$;

drop trigger if exists ecoflow_unleashed_raw_snapshot_copy_guard
  on public.unleashed_raw_snapshots;
create trigger ecoflow_unleashed_raw_snapshot_copy_guard
before delete on public.unleashed_raw_snapshots
for each row execute function public.ecoflow_guard_unleashed_raw_snapshot_delete();

-- Recheck source provenance at the authoritative COPIED transition. This
-- catches a source payload update during an in-flight network fetch; an orphan
-- physical object may be reconciled later, but no canonical COPIED provenance
-- can be committed from missing/stale raw evidence.
create or replace function public.ecoflow_guard_unleashed_asset_copied_provenance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.asset_status = 'COPIED' and old.asset_status is distinct from 'COPIED' then
    if new.source_snapshot_id is null then
      raise exception 'UNLEASHED_ASSET_SOURCE_SNAPSHOT_REQUIRED';
    end if;
    if not exists (
      select 1
      from public.unleashed_raw_snapshots s
      where s.id = new.source_snapshot_id
        and s.payload_sha256 = new.source_payload_sha256
    ) then
      raise exception 'UNLEASHED_ASSET_SOURCE_SNAPSHOT_CHANGED';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists ecoflow_unleashed_asset_copied_provenance_guard
  on public.ecoflow_unleashed_product_assets;
create trigger ecoflow_unleashed_asset_copied_provenance_guard
before update on public.ecoflow_unleashed_product_assets
for each row execute function public.ecoflow_guard_unleashed_asset_copied_provenance();

comment on constraint ecoflow_unleashed_product_assets_source_snapshot_retention_fkey
  on public.ecoflow_unleashed_product_assets is
  'Durable asset provenance retains source hashes/identity after governed raw JSON purge; active copy is separately serialized by the raw-snapshot copy guard.';

comment on constraint ecoflow_external_object_mappings_external_id_nonblank
  on public.ecoflow_external_object_mappings is
  'Authority-bearing explicit external IDs must be nonblank so a missing provider GUID/code can never become an empty-string match.';

commit;
