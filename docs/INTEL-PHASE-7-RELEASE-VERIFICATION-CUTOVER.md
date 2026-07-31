# Phase 7 — Release Verification & Cutover

## Completion statement

Phase 7 completes the release strategy that follows Personalisation & Productivity. It implements four governed packages:

1. INTEL-REL-001 — Feature Flags
2. INTEL-REL-002 — Parallel Read and Shadow Verification
3. INTEL-REL-003 — Cutover Readiness
4. INTEL-REL-004 — Rollback Control

Implementation completion does not mean every feature flag is switched ON. The five Intelligence surfaces are initially placed in SHADOW so the legacy production surface remains authoritative while evidence is gathered.

## INTEL-REL-001 — Feature Flags

The server-authoritative rollout registry contains exactly five flags:

- `control_room_v2`;
- `analytics_inventory_v1`;
- `analytics_customer_v1`;
- `analytics_delivery_v1`;
- `overlay_navigation_v1`.

Each flag has one of three states:

- `OFF` — legacy route only;
- `SHADOW` — legacy route remains primary while Intelligence performs authorised parallel reads;
- `ON` — Intelligence becomes the primary presentation route.

Only active Owner or Admin users may change rollout state. Account and Viewer users may read release readiness but cannot manage it. Warehouse, Driver, inactive and unauthorised identities fail closed.

Flag commands require:

- a UUID command identity;
- expected revision;
- bounded reason;
- explicit target state;
- server acknowledgement.

An exact command replay returns `REPLAYED`. A changed payload using the same command identity is rejected as a replay conflict. A stale expected revision is rejected as a version conflict.

## INTEL-REL-002 — Parallel Read and Shadow Verification

SHADOW does not allow the new surface to silently become authoritative. The legacy operational route continues to drive production while authorised Intelligence reads are compared.

Every flag is crossed with ten required checks for a selected business date:

1. Metric definition approved;
2. Parallel-read differences explained;
3. Role access verified;
4. No demo fallback;
5. No silent zero;
6. Performance baseline met;
7. Owner workflow smoke passed;
8. Rollback verified;
9. Mobile verified;
10. Source interruption verified.

Each check remains explicitly `PASS`, `FAIL`, `BLOCKED` or `UNAVAILABLE`. Missing verification creates an unavailable evidence row; it never becomes PASS and never becomes numeric zero.

Verification evidence is bounded by business date, flag and check. It records observed value, expected value, note, source timestamp, revision and actor through a server command.

## INTEL-REL-003 — Cutover Readiness

A flag may enter `ON` only when:

- its current state is `SHADOW`;
- all ten checks for the chosen business date exist;
- every check is `PASS`;
- the caller supplies the current expected flag revision;
- the server applies and acknowledges the command.

Any missing, failed, blocked or unavailable check blocks cutover. Direct `OFF` to `ON` transition is forbidden. This prevents implementation completeness from being confused with production readiness.

The Analytics workspace shows:

- current rollout state;
- delivery mode;
- flag revision and reason;
- parallel-read assessment;
- cutover blockers;
- rollback assessment;
- all ten verification checks;
- explicit freshness and missing-evidence states.

The workspace itself is read-only. It presents governed evidence but does not execute operational business commands.

## INTEL-REL-004 — Rollback Control

Rollback changes the affected feature flag to `OFF` through the same revisioned and idempotent server command. It restores the legacy route while preserving:

- analytics facts;
- dimensions;
- metric history;
- snapshots;
- verification evidence;
- append-only release events.

Database rollback remains forward compensation only. No deployed migration is rewritten or deleted, and rollback does not delete analytics history.

## Security and operational boundary

The release control plane stores configuration and verification evidence only. It cannot mutate:

- orders;
- inventory;
- customers;
- routes;
- POD;
- returns;
- exception lifecycle.

All four release tables use RLS and grant no direct browser table privileges. Browser access is RPC-only. The release event ledger is append-only and rejects update or delete.

## Permanent verification

`INTEL-GATE-007` permanently verifies:

- four completed Phase 7 packages;
- five canonical flags;
- three rollout states;
- ten cutover checks and 50 explicit flag/check rows;
- legacy-primary behaviour in SHADOW;
- Owner/Admin command authority and read-only desktop roles;
- fail-closed Warehouse, Driver and inactive access;
- expected revision, exact replay and replay-conflict semantics;
- immutable release events;
- complete-evidence requirement for ON;
- OFF-to-ON rejection;
- rollback to OFF with analytics history preserved;
- RPC-only frontend access;
- no operational business-table mutation;
- responsive and reduced-motion presentation;
- frontend contract tests, TypeScript, Vite and PostgreSQL contract tests.

Phase 7 implementation is 100% complete when this gate passes and is merged. Actual production cutover remains intentionally evidence-driven per flag and business date.
