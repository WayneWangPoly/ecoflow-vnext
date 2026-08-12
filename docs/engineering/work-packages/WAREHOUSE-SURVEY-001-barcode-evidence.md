# Work Package: `WAREHOUSE-SURVEY-001 Barcode evidence survey`

## Objective

Provide a warehouse-mobile workflow that records unresolved carton/sleeve barcode evidence in one short interaction without changing inventory, locations, Commercial SKU mapping, or published Product Identity.

## Owner and reviewers

- Implementation role: Platform/Data + Frontend
- Verification role: independent Verification
- Chief Engineer: required for migration, workflow and Warehouse Control integration
- Dependencies: authenticated EcoFlow role and `ecoflow_active_app_role()`
- Planned merge order: schema/RPC → typed repository → frontend integration → executable database contract → Verification → Chief Engineer → release

## In scope

- Allowed paths:
  - `supabase/migrations/*warehouse_survey_001*`
  - `src/data/repositories/barcodeSurvey.ts`
  - `src/features/operationalStability/BarcodeSurveyWorkspace.tsx`
  - `src/features/operationalStability/WarehouseControlWorkspaceV3.tsx`
  - `src/features/operationalStability/OperationalStabilityWorkspace.tsx`
  - `scripts/warehouse-survey-001-*`
  - `.github/workflows/warehouse-survey-001-check.yml`
  - this work package
- Allowed behaviour changes: Owner/Admin/Warehouse can append physical barcode survey evidence through a server-authoritative command; Warehouse Control opens the survey as the fast default and retains existing Stocktake/Move access.

## Out of scope

- Commercial SKU decisions or mappings.
- Product Identity publication or barcode reassignment.
- Inventory balances, movements, stocktake posting, locations, receiving, picking, returns, accounts, driver flow, routing or global auth/role mapping.
- Photo/storage infrastructure.
- Editing any deployed migration.
- Giving pull-request code access to production database credentials.

## Behaviour contract

- Command input: UUID idempotency key, carton barcode, explicit sleeve status, optional distinct sleeve barcode, optional note, stable device ID.
- Sleeve status is exactly `SCANNED`, `NO_SEPARATE_BARCODE`, or `NOT_CHECKED`.
- `SCANNED` requires a non-empty sleeve barcode different from the carton barcode; non-scanned statuses must not carry a sleeve barcode.
- Accepted result is `APPLIED`; same actor + command UUID + normalized payload returns `REPLAYED` without a second observation.
- Same command UUID with another actor or payload fails closed with `BARCODE_SURVEY_IDEMPOTENCY_CONFLICT`.
- Server derives actor from `auth.uid()` and role from `ecoflow_active_app_role()`; only OWNER/ADMIN/WAREHOUSE are accepted.
- Direct table DML is revoked from browser roles. The observation table is staging evidence only.
- Offline/network-unknown UI does not claim success. The draft retains the same command UUID for a safe retry; successful acknowledgement clears and refocuses the carton field.
- Every accepted observation records actor, role, device, request fingerprint and server timestamp.

## Acceptance criteria

- [ ] Owner/Admin/Warehouse can save a valid carton observation and receive `APPLIED`.
- [ ] Retry of the exact command returns `REPLAYED` with the same observation ID and one stored row.
- [ ] Concurrent same-command requests serialize to one `APPLIED`, one `REPLAYED`, one stored row.
- [ ] Reusing the UUID for changed evidence or another actor fails closed.
- [ ] ACCOUNT/VIEWER/DRIVER and unauthenticated callers are rejected server-side.
- [ ] Direct authenticated INSERT/UPDATE/DELETE on the evidence table is unavailable.
- [ ] `NOT_CHECKED` is preserved as first-class evidence and does not invent a sleeve barcode.
- [ ] The workflow contains no stock quantity, warehouse location, Commercial SKU, family, substitution or package-conversion input.
- [ ] Existing Initial/Cycle Count and Move SKU workflows remain reachable and unchanged.
- [ ] Exact-head static contract, PostgreSQL 17 migration/RPC contract, typecheck and production build pass.
- [ ] A trusted production-schema migration check is still required before production release; an unrelated/not-applicable TRANSFORM-007 green status is not accepted as that evidence.

## Test plan

| Layer | Command or scenario | Expected result |
|---|---|---|
| Static | `node --test scripts/warehouse-survey-001-contract.test.mjs` | authority boundaries, role checks, idempotency and UI field exclusions pass |
| Database | fixture → candidate migration → `warehouse-survey-001-db-contract-test.sql` | migration executes; role/DML/replay/conflict/recovery contracts pass |
| Concurrency | two simultaneous calls with the same command UUID | `APPLIED` + `REPLAYED`; exactly one observation |
| TypeScript | `npm run typecheck` | pass |
| Build | `npm run build` | pass |
| Trusted release | production-schema-safe migration validation from trusted main | pass before merge/deploy |
| End-to-end/UI | warehouse mobile scan → sleeve choice → Save & Next | acknowledgement then clear/refocus; failure leaves evidence unsaved and retryable |

## Required evidence

- Changed files: PR diff restricted to declared paths.
- Build and test output: exact-head CI links/statuses.
- Migration evidence: credential-free PostgreSQL 17 execution plus trusted production-schema validation before release.
- Screenshots: authenticated Warehouse Control barcode survey after deployment.
- Risks: field evidence can duplicate the same physical barcode across separate observations by design; reconciliation happens later and does not silently publish/remap identity.
- Known limitations: no evidence photo in MVP; no canonical Product Identity conflict label in this staging surface.
- Deferred findings: admin reconciliation from survey evidence into canonical Physical/Product Identity requires a separate work package.

## Rollback

Revert frontend/repository integration to remove the entry point. If the migration has deployed, do not edit it; add a forward compensating migration that revokes the RPC and retires the staging table only after evidence-retention review. No inventory or canonical Product Identity rollback is required because this package never mutates either authority.

## Decision log

### Decisions

- Survey evidence is a separate append-only staging authority, not weakened Product Identity commissioning.
- Commercial SKU assignment is intentionally absent from field capture.
- `NOT_CHECKED` is explicit rather than inferred.
- Photo capture is deferred until storage/upload authority is separately verified.
- Pull-request validation is credential-free; production schema credentials stay behind trusted-main workflows.

### Assumptions

- Existing authenticated role projection remains authoritative.
- Barcode strings may be alphanumeric and may contain leading zeroes, so they are stored and entered as text.

### Risks

- A scanner may submit keyboard-enter events faster than the operator chooses sleeve status; Save remains disabled until the explicit choice is made.

### Deferred

- Canonical identity reconciliation, evidence photo upload and bulk review dashboard.
