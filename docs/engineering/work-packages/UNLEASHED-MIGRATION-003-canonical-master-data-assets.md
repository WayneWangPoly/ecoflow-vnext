# Work Package: `UNLEASHED-MIGRATION-003 Canonical master data and assets`

## Objective

Turn the governed Unleashed snapshots established by #337 into an idempotent,
reviewable master-data bridge without granting Unleashed, a browser, or the
migration process operational inventory authority. Every staged P0 product
must finish in `MATCHED`, `AMBIGUOUS`, `UNMATCHED`, or `RETIRED`, and any copied
product image must be served from EcoFlow-controlled Storage with provenance,
content hash, rights approval, and storage-budget evidence.

## Owner and reviewers

- Implementation role: Domain + Platform/Data.
- Verification role: independent migration, RLS, integrity, and storage
  verification.
- Chief Engineer: required for the forward migration, Edge Function, and
  deployment workflow.
- Dependencies: #336 and completed #337; parent #335.
- Planned merge order: #338 before #339. Opening balances and stock authority
  remain blocked until the identity bridge is accepted.

## Production baseline (read-only, 2026-08-31)

- EcoFlow project status: `ACTIVE_HEALTHY`.
- PostgreSQL database size: 344,378,515 bytes.
- Storage: three private buckets, zero objects, zero recorded object bytes.
- Commercial identity: 169 `public.skus` rows and 163 active Ordermentum
  product mappings across 163 distinct Commercial SKUs.
- Physical identity: zero families, Physical SKUs, or Commercial-to-Physical
  published links. This package must not create them.
- Unleashed staging: five raw rows across four resources, about 12 KB of JSON;
  every current external identity is still unmapped.
- The staged product exposes `Guid`, `ProductCode`, `ImageUrl`, `Images`, and
  provenance fields. Its code has zero exact active Ordermentum mapping
  matches, so it must enter `UNMATCHED` rather than be guessed.
- No asset-rights or image-licence evidence table currently exists.

## In scope

- Allowed paths:
  - `docs/engineering/work-packages/UNLEASHED-MIGRATION-003-canonical-master-data-assets.md`
  - `supabase/migrations/20260831235500_unleashed_master_data_bridge.sql`
  - `supabase/functions/trigger-unleashed-master-migration/**`
  - `.github/workflows/unleashed-master-data-bridge-check.yml`
  - `.github/workflows/deploy-supabase-migrations.yml` (one additive function
    deployment step only)
  - `scripts/unleashed-master-data-bridge-contract.test.mjs`
  - `scripts/unleashed-master-data-bridge-db-contract-test.sql`
  - `scripts/unleashed-master-data-bridge-review-fixes-db-contract-test.sql`
  - `scripts/audit-unleashed-master-data-bridge.mjs`
  - `scripts/audit-production-activation-readiness.mjs` (exact deployed-function
    count only)
  - `package.json`
- Allowed behaviour changes:
  - Create an EcoFlow-owned mapping decision, candidate, review-command, asset
    rights, and asset provenance layer over #337 snapshots.
  - Materialise deterministic candidates from server-side snapshot data.
  - Permit Owner/Admin review only through a revisioned, idempotent,
    server-authoritative command.
  - Create or reconcile one private `unleashed-product-images` bucket through
    the service-role Edge path with bounded MIME and object-size rules; the SQL
    migration does not mutate Supabase-managed Storage relations.
  - Plan and copy only allowlisted Unleashed CDN image assets after explicit
    rights and capacity gates pass.

## Out of scope

- Forbidden paths: application routes, shared domain types, auth/role mapping,
  inventory, picking, receiving, stocktake, delivery, accounts, and existing
  Ordermentum sync functions.
- No Unleashed write request of any kind.
- No inventory quantities, opening balances, reservations, movements, or
  warehouse-location mutations; these remain #339.
- No automatic creation of `ecoflow_physical_skus`, SKU families, package
  units, barcodes, or Commercial-to-Physical links.
- No blind overwrite of `public.skus`, `ecoflow_store_sites`, warehouses, or
  Ordermentum mappings.
- No bulk master-data fetch or image copy during schema deployment.
- No image copy while rights evidence is pending, rejected, expired, or
  revoked, or while the declared storage budget would be exceeded.

## Behaviour contract

### Inputs and commands

- The planner reads only structured identity/provenance fields and bounded raw
  snapshots created by the #337 service-side connector.
- `PLAN` creates or refreshes one decision row per supported Unleashed master
  identity and deterministic candidate rows. Replaying the same payload hash
  and candidate-set hash creates no duplicate logical row or candidate and
  preserves an accepted review. Source-payload or canonical candidate-set
  drift increments the mapping revision, returns authority to `AUTO`, marks
  prior candidates non-current, and retains the review command plus selected
  candidate snapshot as historical evidence.
- `AUTHORIZE_ASSETS` records explicit Owner/Admin image-use approval, evidence
  reference, scope, byte budget, and optional expiry. It does not copy data.
- `COPY_IMAGES` processes at most ten planned assets per command. It is rejected
  unless approval, host allowlist, HTTPS, MIME, per-object size, aggregate byte
  budget, and snapshot-hash checks pass. A singleton run lease serializes
  aggregate-budget spending; an expired worker is failed and its claimed asset
  is released for an explicit retry.
- `REVIEW_MAPPING` accepts a mapping status and optional selected candidate
  through a revisioned and idempotent RPC. Direct table mutation remains
  unavailable to browsers.

### Deterministic mapping rules

- Product: case-normalised Unleashed `ProductCode` maps only when it resolves
  to exactly one active Ordermentum external product mapping and therefore one
  existing Commercial SKU. Zero matches is `UNMATCHED`; more than one distinct
  canonical result is `AMBIGUOUS`.
- Warehouse: case-normalised Unleashed `WarehouseCode` maps only when it
  resolves to exactly one existing EcoFlow warehouse. Zero or multiple results
  fail closed as above.
- Customer/store and supplier: only an existing explicit external-object
  mapping or an Owner/Admin-reviewed candidate may become `MATCHED`. Names,
  addresses, and fuzzy similarity never create authority automatically.
- A source record explicitly marked obsolete maps to `RETIRED` and cannot be
  selected as an active candidate.
- A `MATCHED` decision must name its canonical object type, UUID, code, source
  payload hash, method, actor/command provenance, and revision.

### Asset rules

- Image source URLs must use HTTPS and the exact allowlisted Unleashed CDN host;
  redirects are rejected rather than followed to an unvalidated host.
- A missing locator or unsafe URL becomes a queryable `BLOCKED` exception.
  Unsafe locators are represented only by a one-way hash and
  `blocked://redacted`, never by the rejected raw URL. An uncopied locator no
  longer present in the current snapshot becomes `RETIRED`, so historical
  exceptions are not misreported as current.
- The response MIME header must agree with JPEG, PNG, or WebP magic bytes.
  Downloads have a fixed timeout and remain bounded even without a declared
  content length.
- The bucket is private. Authenticated active EcoFlow roles may request a
  short-lived signed read URL through the JWT-protected Edge Function; only the
  service role may create/reconfigure the bucket or insert, update, and delete
  migration assets. Schema deployment never writes `storage.buckets` or changes
  policies owned by the managed Storage service.
- Object paths are derived from stable source GUID plus content SHA-256, never
  from an untrusted filename. A repeated content hash reuses the logical asset.
- Source URL, source payload hash, observed time, content type, content length,
  content SHA-256, Storage bucket/path, copy run, and lifecycle status remain
  queryable as provenance.
- A copy worker conditionally claims the exact planned snapshot. Concurrent
  planning cannot refresh a claimed asset. If a prior worker uploaded an
  object but died before recording provenance, a duplicate upload response
  reconciles the existing physical bytes into the aggregate budget before the
  next asset is processed. Later PLAN runs never rewrite the source snapshot of
  an already copied immutable object; a previously failed or blocked current
  locator is reactivated only from current safe snapshot evidence.
- The default migration storage budget is conservative and must be explicitly
  confirmed with rights approval. Database and Storage quotas remain separate;
  the planner reports both rather than treating database headroom as image
  headroom.

### Accepted, conflict, and rejected results

- Accepted: `MATCHED` with exactly one canonical target, or an asset copied with
  all gates and hashes recorded.
- Conflict: multiple canonical candidates produce `AMBIGUOUS`; duplicate source
  GUID/code evidence is quarantined and remains visible in the review queue.
- Rejected: malformed identity, stale revision, reused command with different
  payload, unapproved/expired rights, unsafe URL, unsupported MIME, byte-budget
  breach, changed snapshot hash, concurrent copy lease, or direct browser table
  mutation.
- `UNMATCHED` is an explicit exception outcome, not a failed or hidden import.

### Authority, idempotency, and audit

- All mutations occur through security-definer RPCs or an authenticated Edge
  Function using the service role; caller role and active user are rechecked on
  the server.
- Commands carry command UUID, actor, expected revision, reason, and payload
  hash. The actor is part of the fingerprint: same actor/command/payload
  replays the original result; a changed actor or payload is rejected.
- Every plan, review, rights decision, copy attempt, rejection, and retirement
  writes durable audit evidence without recording credentials or image bytes in
  PostgreSQL logs.
- Offline clients may display cached read models but never show a review or copy
  operation as complete without server acknowledgement.

## Acceptance criteria

- [ ] One decision exists for every staged active P0 product, with external GUID
  and code plus one of the four governed statuses.
- [ ] Exact product and warehouse matches are deterministic and replay-safe;
  zero/multiple matches fail closed.
- [ ] Customer/store and supplier links require prior explicit mapping or
  Owner/Admin review; fuzzy/name-only matching cannot publish authority.
- [ ] No migration path inserts or updates Physical SKU, package, barcode,
  Commercial-family-link, inventory balance, movement, or opening-balance rows.
- [ ] Owner/Admin can read the review queue and use the command RPC; other roles
  cannot review, and no authenticated role can directly mutate bridge tables.
- [ ] Reusing a command UUID with a different payload is rejected; stale
  revision is rejected; a different actor cannot replay it; identical replay
  returns the original result.
- [ ] Identical PLAN replay preserves a reviewed decision. Source or canonical
  candidate drift resets the decision to `AUTO` while historical candidates
  and the selected-candidate command snapshot remain intact.
- [ ] Duplicate GUID/code candidates remain quarantined as `AMBIGUOUS` with all
  candidates visible.
- [ ] The product-image bucket is private, bounded to JPEG/PNG/WebP, and has no
  authenticated browser write/delete policy.
- [ ] Image copy is impossible until rights evidence and a byte budget are
  approved; unsafe hosts, redirects, MIME, oversize objects, and budget breaches
  fail closed.
- [ ] Only one copy run can hold the aggregate-budget lease. A stale run releases
  its claim, and an uploaded-but-unrecorded object is reconciled into the budget
  on retry rather than counted as free capacity.
- [ ] A copied image is addressed by content hash, is served from EcoFlow
  Storage, preserves source provenance, and replays without duplicate objects.
- [ ] Static audit proves the Edge Function has no Unleashed POST/PUT/PATCH/
  DELETE path and no credential in URL, response, or persisted evidence.
- [ ] Existing #337 connector, Ordermentum, warehouse, and application build
  checks remain green.

## Test plan

| Layer | Command or scenario | Expected result |
|---|---|---|
| Static | `node --experimental-strip-types --test scripts/unleashed-master-data-bridge-contract.test.mjs` | Scope, authority, four-state mapping, asset and no-physical-SKU contracts pass. |
| Audit | `node scripts/audit-unleashed-master-data-bridge.mjs` | Migration/function/workflow findings are all `PASS`. |
| Unit | Edge Function URL, redirect, MIME, size, budget, hash, and idempotency helpers | Unsafe or stale input fails closed. |
| Integration/RLS | `scripts/unleashed-master-data-bridge-db-contract-test.sql` against disposable PostgreSQL/Supabase | Deterministic candidate, source/canonical drift, durable review evidence, singleton copy lease, command replay/revision, hardened function privileges, direct-write denial, and role checks pass. |
| Regression | `npm run audit:unleashed && npm run typecheck && npm run build` | Existing connector and application remain usable. |
| Production preflight | Bounded `PLAN`, no copy | Counts/estimated bytes reported; zero operational or Storage mutation. |
| Production acceptance | Approved bounded copy followed by replay | EcoFlow asset served; hashes match; second run creates zero duplicate logical/object rows. |

## Required evidence

- Changed files: bounded to the paths above.
- Build and test output: static, unit, audit, DB/RLS, typecheck, build, and
  existing Unleashed regression.
- Migration/shadow result: disposable PostgreSQL evidence before any production
  migration; no paid Supabase preview branch is required.
- Production evidence: pre/post aggregate counts, mapping status distribution,
  rights state, planned/copied bytes, bucket object count/bytes, unchanged
  Ordermentum/warehouse/inventory baselines, audit event IDs, and Edge logs.
- Screenshots: review queue and one EcoFlow-served image only after rights allow.
- Risks: legacy case-sensitive duplicate codes, stale upstream URLs, CDN MIME
  drift, interrupted uploads requiring lease recovery, image rights uncertainty,
  and quota/egress growth.
- Known limitations: supplier and customer mappings remain explicit exceptions
  when no shared stable identifier exists.
- Deferred findings: inventory/opening balance is #339; UI parity is #340;
  shadow reconciliation is #341.

## Rollback

- Disable the new Edge Function deployment and remove its function-specific
  execution secret if used. The #337 connector remains independently operable.
- Revoke or expire asset authorization to stop new copies immediately.
- Keep provenance, decisions, commands, and audit rows for evidence; do not
  delete historical decisions during rollback.
- Remove copied Storage objects only through a separately approved bounded
  cleanup using recorded bucket/path hashes.
- Reverse schema exposure with a forward compensating migration that revokes
  RPC/view grants and marks mappings/assets retired. Never edit an applied
  migration.
- No inventory rollback is needed because this package cannot change inventory.

## Decision log

### Decisions

- Reuse #337 snapshots and external identities rather than create a second
  polling connector.
- Bridge Unleashed products to existing Commercial SKUs; never infer Physical
  SKUs.
- Treat zero and multiple candidates as first-class governed exceptions.
- Preserve accepted candidate snapshots, but invalidate reviewed authority when
  either the source payload or canonical candidate set changes.
- Use a private, service-written Storage bucket and content-addressed paths.
- Keep rights approval and byte-budget approval separate from technical copy.
- Use local disposable PostgreSQL for migration testing to avoid preview-branch
  compute cost.

### Assumptions

- The credential owner retains an external recovery copy and keeps Unleashed
  credentials only in Supabase secrets.
- Image use/copy rights have not yet been evidenced and therefore default to
  blocked.
- Current Supabase documentation reports database and Storage as separate usage
  items; live organization plan/quota must be checked before bulk copy.

### Risks

- Product codes may not be shared between Unleashed and Ordermentum, as the
  current staged sample demonstrates.
- `Images` payload shape can vary and must be parsed defensively.
- A public or authenticated Storage write policy would expand authority and is
  prohibited.
- Database growth from raw master snapshots can consume the 500 MB Free-plan
  database allowance if a large backfill is run without a bounded estimate.

### Deferred

- Product-identity creation from physical warehouse evidence.
- Inventory quantity/opening-balance migration.
- Customer-facing or warehouse-facing migration UI beyond the governed read
  queue required for acceptance.
