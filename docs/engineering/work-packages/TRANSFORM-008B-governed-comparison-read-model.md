# TRANSFORM-008B — Governed Comparison Read Model

## Goal

Restore Analytics Comparison without restoring browser-authored authority. Every selectable entity must be returned by a fail-closed server read boundary and must remain distinct by canonical entity kind.

Base route: `TRANSFORM-007 → TRANSFORM-008A → TRANSFORM-008B → TRANSFORM-008C → Forecasting`.

Exact 008B base: `6f77408c33bcd42055233672f176600be7a74613`.

## Authority

`public.ecoflow_read_comparison_candidates_v1` is the only browser candidate source. It is read-only, `STABLE`, `SECURITY DEFINER`, role-gated, explicitly revoked from `public`/`anon`, and executable by authenticated callers only after the server role check.

Allowed desktop roles: `OWNER`, `ADMIN`, `ACCOUNT`, `VIEWER`.

Canonical kinds:

- `CUSTOMER` — `public.ecoflow_store_sites`; maximum 2 selected.
- `COMMERCIAL_SKU` — `public.skus` only through an ACTIVE, unretired `ecoflow_commercial_family_links` row to an ACTIVE, unretired SKU Family; maximum 2 selected.
- `PHYSICAL_SKU` — ACTIVE, unretired `ecoflow_physical_skus` whose SKU Family is ACTIVE and unretired; maximum 6 selected.
- `DELIVERY_RUN` — LOCKED `public.ecoflow_delivery_route_snapshots`; maximum 2 selected.

Product identity remains:

`Commercial SKU → ACTIVE Family Link → ACTIVE SKU Family → Physical SKU(s)`.

No direct Commercial→Physical identity or second taxonomy is introduced.

## Fail-closed rules

- Browser code cannot type or supply arbitrary entity IDs.
- Browser code cannot default or manufacture `ALLOWED` permission.
- Candidate parser rejects absent, unknown or non-`ALLOWED` permission.
- Unknown entity kinds are rejected.
- Candidate IDs, timestamps, query length and result limit are bounded.
- Candidate repository uses the RPC only; no direct `.from()` business-table reads and no writes.
- DRAFT/NEEDS_MAPPING Commercial SKUs do not enter the candidate set because only active published family links qualify.
- Retired/inactive Physical SKUs or Families do not enter the candidate set.
- Superseded/unlocked delivery route revisions do not enter the candidate set.

## Production UI

`INTEL-PER-003` restores Comparison Tray with:

- canonical kind selector;
- server-backed search;
- Add only from returned governed candidates;
- per-kind limits and duplicate prevention;
- selected-item removal;
- explicit error/empty/loading states.

Saved Views and Quick Actions remain unchanged in authority.

## Out of scope

TRANSFORM-008B does **not** restore CSV/XLSX/current-chart export. Authoritative export remains quarantined for TRANSFORM-008C. It does not add Forecasting and does not mutate operational records.

## Permanent evidence

- `supabase/migrations/20260813190000_governed_comparison_candidates.sql`
- `src/data/repositories/comparisonCandidates.ts`
- `src/features/intelligence/analytics/productivity/productivityContract.ts`
- `src/features/intelligence/analytics/productivity/PersonalisationProductivityPanel.tsx`
- `scripts/intel-comparison-candidate-contract.test.mjs`
- `scripts/intel-personalisation-productivity-contract.test.mjs`
- `scripts/audit-transform-008b-governed-comparison.mjs`
- `scripts/audit-intel-personalisation-productivity.mjs`
- `scripts/audit-intel-phase-6-personalisation-productivity-gate.mjs`
- `.github/workflows/transform-008b-governed-comparison.yml`

## Acceptance

008B closes only when the exact PR head passes the repository gates, including migration/shadow validation and production build, the exact head is merged to `main`, and the resulting `main` SHA is reverified. No completion claim is based only on authored files.
