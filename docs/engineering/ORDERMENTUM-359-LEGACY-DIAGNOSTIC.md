# #359 legacy-only diagnostic work package

## Objective and ownership
Locate the legacy_get failure in run 34076398472 without repeating its successful
current GET or modifying source/business data. Implementation: Work coordinator;
Verification: separate agent; Chief Engineer: coordinator final review. Based on
main c932ea1edcf2ee2d00aa7fcb81e46adf0db928b7 and ADR-0009.

## Scope and behaviour
Only the new scripts/ordermentum-purchaser-legacy-diagnostic.mjs and its test,
.github/workflows/ordermentum-purchaser-legacy-diagnostic.yml and its contract
workflow, and this document. No incumbent helper, ingestion, database, UI,
credential mutation, schedules or auth cutover changes.

Manual first-attempt main-only execution, exact reviewed SHA/current-main guard
before credentials, shared cloud-sync concurrency, no cancellation. The user's
"继续找到并解决" continues the read-only investigation. One legacy auth POST and
at most one legacy purchaser GET; zero current GET; no retries or redirects.
Use incumbent ORDERMENTUM_BASE_URL/ORDERMENTUM_API_BASE_URL when configured,
otherwise app auth/api GET defaults; allow only exact HTTPS app/api origins
(with optional trailing slash), never arbitrary URLs. Record only allowlisted
origin labels, HTTP status, fixed failure enums, timestamps, request attempts,
identity/hash metadata. Never output provider bodies, headers, tokens or errors.
20-second deadline and 2 MiB decoded-body cap per response.

Pin the purchaser hash and canonical current payload hash to successful B0 run
34076398472. A successful legacy read compares with that historical hash using
the existing canonical hashing implementation. Equality is historical sample
evidence, not simultaneous sampling or #359-C acceptance. Failure/mismatch keeps
HOLD, with no rerun. All paths retain legacy_retirement HOLD.

## Acceptance, evidence and rollback
Tests: zero traffic on invalid guards/origins/target; success with api/app legacy
origin, exact budgets, redirect/HTTP/network/timeout/JSON/body-cap classification,
identity/drift rejection, metadata redaction, workflow no current key/Supabase.
Run existing B0/B1 regressions, build/typecheck and diff hygiene. Independent
Verification and CE approval required before protected release and live dispatch.
No RLS/migration/UI changes. Revert these five additive files or stop dispatching;
no data compensation. Raw payload remains memory-only. The original failure has
no status metadata and cannot retrospectively be classified.
