# Work Package: `UNLEASHED-MIGRATION-002 Bounded read-only Unleashed connector`

## Objective

Install the server-side foundation for a bounded, read-only Unleashed snapshot
connector that can safely stage small API windows for product, customer,
supplier, warehouse, stock, purchasing, order, and sales-intelligence source
data without exposing credentials or changing Unleashed records.

## Owner and reviewers

- Implementation role: Codex implementation agent
- Verification role: Independent verification agent
- Chief Engineer: WayneWangPoly
- Dependencies: UNLEASHED-MIGRATION-001 archaeology, GitHub issues #336, #337,
  and #345
- Planned merge order: after archaeology comments are accepted, before bulk
  migration, inventory authority, and ERP UI parity work

## In scope

- Allowed paths:
  - `supabase/migrations/**`
  - `supabase/functions/trigger-unleashed-readonly-sync/**`
  - `scripts/*unleashed-readonly*`
  - `.github/workflows/*unleashed-readonly*`
  - `.github/workflows/deploy-supabase-migrations.yml`
  - `src/features/team/unleashedReadonlyProbe.ts`
  - `src/features/team/unleashedConnectorAcceptance.ts`
  - `src/features/settings/UnleashedReadonlyProbePanel.tsx`
  - `src/features/settings/teamAccessSettings.css`
  - `docs/engineering/work-packages/UNLEASHED-MIGRATION-002-bounded-readonly-connector.md`
- Allowed behaviour changes:
  - Add source-owned staging tables and read models for Unleashed connector
    runs, batches, identities, raw snapshots, and cursors.
  - Add an Owner/Admin-only Edge Function that performs GET-only bounded
    Unleashed API reads.
  - Add static and SQL contract checks for credential handling, read-only
    method boundaries, pagination limits, and browser write denial.
  - Add exact, one-resource target selectors for product GUID/code, stock by
    product GUID and optional warehouse code, and sales/purchase order GUID or
    order number.
  - Retry transient GET failures at most three times and skip semantic snapshot
    writes when the source payload hash is unchanged.
  - Add an Owner/Admin-only acceptance control that requires an explicit
    checkbox acknowledgement before storing or refreshing at most one source
    snapshot for each of the four targetable resources.
  - Expose only a derived warehouse code through the protected snapshot catalog
    so stock acceptance can target one product and one warehouse without
    returning the raw source payload.
  - Bound raw snapshot JSON to a declared 14-day retention horizon from
    `last_seen_at`, with a service-role-only purge capped at 5,000 rows per
    invocation. Purge execution remains an explicit production operator action.

## Out of scope

- Forbidden paths:
  - Existing Product Identity, inventory movement, release, picking, delivery,
    POD, returns, statements, and intelligence UI files.
- Behaviour that must remain unchanged:
  - No Unleashed write, export, delete, complete, obsolete, transfer, stock
    adjustment, purchase order update, or sales order update operation.
  - No browser-side Unleashed credential handling.
  - No production inventory authority change.
  - No Sales BI KPI definition change; this connector only stages source facts
    needed for later semantic-layer reconciliation.
  - No automatic production deletion of raw snapshots in this work package.

## Behaviour contract

- Command/input: authenticated POST to `trigger-unleashed-readonly-sync` with
  `mode`, `resources`, `modifiedSince`, `dryRun`, `pageSize`, `maxPages`, and
  `reason`, plus an optional allowlisted `target` for one resource.
- Accepted result: Owner/Admin users can run a bounded GET-only probe or
  snapshot. The function returns counts, hashes, run status, and batch metadata,
  never raw Unleashed records or secrets.
- Conflict result: unsupported resources, page sizes, page counts, modes, or
  malformed dates are rejected before Unleashed is contacted. Targeted reads
  reject arbitrary fields, multiple resources, non-exact matches, and target
  plus `modifiedSince` combinations.
- Rejected result: anonymous users, inactive team members, non-Owner/Admin roles,
  missing Supabase secrets, missing Unleashed secrets, non-HTTPS API base URLs,
  and query-bearing API base URLs fail closed.
- Credential transport boundary: authenticated outbound requests are restricted
  to the exact `https://api.unleashedsoftware.com:443` origin and approved API
  path shapes. Redirects are handled manually and every 3xx response fails
  closed without follow or retry.
- Disable/rollback boundary: removal of either `UNLEASHED_API_ID` or
  `UNLEASHED_API_KEY` is the connector kill switch. The missing-credential guard
  executes before any outbound Unleashed fetch and is isolated from the
  Ordermentum and warehouse connectors.
- Authoritative server checks: role lookup is performed server-side through
  `app_user_profiles`; Unleashed credentials are read only from Edge Function
  secrets.
- Revision, idempotency, actor, and device requirements: this work package does
  not mutate business records. Each run still records actor, requested email,
  reason, status, resource set, limits, and audit events. Snapshot replay
  compares stable payload hashes and writes only inserted or changed source
  records; unchanged observations remain visible in run/batch metadata.
- Raw retention policy: raw JSON in `unleashed_raw_snapshots` is diagnostic and
  mapping evidence, not a permanent system-of-record copy. Rows older than 14
  days from `last_seen_at` are purge-eligible. Purge is service-role-only,
  bounded to 5,000 rows per call, and deletes raw rows only; durable connector
  run history plus `unleashed_external_identities` identity/hash evidence remain.
  Bulk ingestion remains blocked until production evidence confirms expired raw
  rows have been purged under this policy.
- Offline policy: offline UI may not claim a connector run was queued or staged;
  the server response is authoritative.
- Production acceptance policy: page load and the existing connection probe
  cannot stage snapshots. The separate acceptance action stays disabled until
  an Owner/Admin acknowledges the four-resource write boundary.
- Audit and error behaviour: each run has durable rows, per-resource batches,
  final status, error code/message, and an `app_security_audit_events` entry.
  A denied or failed resource is recorded and does not prevent later
  allowlisted resources from producing evidence; the overall run remains
  `PARTIAL` and the failed resource cannot be marked verified.

## Acceptance criteria

- [ ] Unleashed source tables have RLS enabled.
- [ ] Browser roles cannot insert, update, delete, truncate, reference, trigger,
  or maintain any `public.unleashed_*` base table.
- [ ] Unleashed raw payloads are never returned from the Edge Function response.
- [ ] The Edge Function constructs HMAC-SHA256 signatures from the query string
  only and sends credentials only in Unleashed auth headers.
- [ ] Credential-bearing requests are pinned to the exact Unleashed API origin,
  reject injected base paths, and never follow redirects.
- [ ] Removing either Unleashed credential stops the connector before outbound
  fetch without changing Ordermentum or warehouse connector authority.
- [ ] The Edge Function can only issue `GET` requests to allowlisted resources.
- [ ] Default execution is dry-run; raw snapshot staging requires
  `dryRun: false`.
- [ ] Bounded pagination is enforced by server-side hard limits.
- [ ] Raw snapshot JSON has a declared 14-day retention horizon and a bounded,
  service-role-only purge that preserves run and identity/hash evidence.
- [ ] Sales analytics parity seed resources are explicit and can be selected for
  later #345 reconciliation.
- [ ] Target selectors cannot escape the four approved product, stock,
  sales-order, and purchase-order request shapes.
- [ ] Transient upstream GET failures retry no more than three times.
- [ ] Replaying an unchanged payload produces zero staged/changed semantic
  writes and records the observation as unchanged.
- [ ] One failed resource does not hide the result of later resources, and a
  partial run is never presented as complete acceptance.

## Test plan

| Layer | Command or scenario | Expected result |
|---|---|---|
| Static | `node --test scripts/unleashed-readonly-connector-contract.test.mjs` | Connector source and migration contract passes. |
| Static | `node --test scripts/unleashed-readonly-killswitch-retention.test.mjs` | Secret removal remains before outbound fetch; retention stays fixed/bounded/service-role-only. |
| Static | `node scripts/audit-unleashed-readonly-connector.mjs` | No credential logging, URL secret placement, or Unleashed write method exists. |
| Integration/RLS | GitHub workflow PostgreSQL 17 service applies the connector migrations twice, then runs the connector and retention DB contract SQL | RLS and PostgreSQL grants deny browser mutation, migration replay stays idempotent, and a one-row purge removes only expired raw JSON while preserving recent raw, run history, and identity/hash evidence. |
| End-to-end/UI | Owner/Admin invokes Edge Function with a one-page dry-run | Run and batch rows are created; response contains counts and hashes only. |
| End-to-end/API | Owner/Admin targets a known product, stock row, open sales order, and open purchase order | Each exact selector returns one matching record without an Unleashed write. |
| Replay | Repeat the same bounded non-dry target request | Second run reports zero staged/changed rows and one unchanged observation. |
| Kill switch | Remove either Unleashed API secret in a controlled production verification | Connector fails `MISSING_UNLEASHED_CREDENTIALS` before outbound Unleashed traffic; unrelated connectors remain available. |
| Raw retention | Inspect purge-eligible rows, then explicitly invoke the bounded service-role purge | Only raw rows older than 14 days are removed; structured identity/hash and run evidence remain. |
| End-to-end/UI | Owner/Admin opens production acceptance without acknowledging the write boundary | Staging action remains disabled; no connector request is sent. |
| Partial source coverage | One allowlisted endpoint returns 4xx while a later resource is readable | Failed resource is recorded, later resources are attempted, and UI reports partial acceptance. |

## Required evidence

- Changed files: PR diff.
- Build and test output: local Node static checks plus CI.
- Migration/shadow result: CI PostgreSQL 17 DB contract plus local shadow
  fallback when Supabase remote branching is unavailable.
- Screenshots: production Settings acceptance state and final four-resource
  result, without raw payloads or credentials.
- Risks: Unleashed API docs list some resources as editable even though GET is
  supported. The function enforces GET-only access regardless of resource class.
- Known limitations: bulk snapshot workers, image mirroring, canonical SKU
  creation, and Sales BI KPI reconciliation are separate work packages.
- Deferred findings: the user-confirmed production acceptance run must prove
  exact target reads and unchanged replay for the real account. Production
  kill-switch and purge execution evidence are also confirmation-gated. Paid BI
  source coverage remains a separate #345 gate.

## Rollback

Remove either `UNLEASHED_API_ID` or `UNLEASHED_API_KEY` to stop outbound
Unleashed traffic immediately, or disable/remove the
`trigger-unleashed-readonly-sync` deployment. These actions do not change
Ordermentum or warehouse connector authority. If the migration has already
deployed, use a forward compensating migration for schema rollback; do not run a
production raw purge or destructive schema rollback without explicit approval.

## Decision log

### Decisions

- Credentials are read only from Edge Function secrets.
- The first connector surface is bounded and dry-run by default.
- Credential-bearing traffic is pinned to the exact Unleashed API origin and
  redirects fail closed.
- Secret removal is the minimal connector kill switch; no second feature-flag
  authority layer is introduced for 002.
- Raw source payload staging is service-role writable and Owner/Admin readable;
  broader UI read models must be derived later.
- Raw snapshot JSON retention is 14 days from `last_seen_at`; purge is manual,
  service-role-only, and bounded, while structured identity/hash and run history
  are retained.
- Paid Sales/BI parity uses source facts from invoices, credit notes, sales
  orders, sales shipments, customers, products, groups, warehouses, and
  salespersons instead of scraping dashboard widgets.

### Assumptions

- The production Unleashed account has API access enabled for the selected
  company.
- `UNLEASHED_API_ID` and `UNLEASHED_API_KEY` exist as Supabase Edge Function
  secrets outside source control; `UNLEASHED_CLIENT_TYPE` remains optional.

### Risks

- Unleashed endpoint pagination and modified-since support differs by resource.
  The connector records per-resource metadata and can disable unsupported
  filters through allowlist changes.
- The API key has account-wide access, so function-level GET-only enforcement is
  mandatory.
- Raw purge is intentionally not automatic in 002. Before bulk ingestion, an
  operator must produce purge evidence showing no raw JSON older than the
  declared horizon remains.

### Deferred

- Bulk worker and retry cadence.
- Product image download and checksum-backed storage mirror.
- Canonical Physical SKU and SKU Family publishing.
- Sales Intelligence semantic-layer reconciliation against #345.
