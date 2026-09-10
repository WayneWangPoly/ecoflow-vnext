# #359-C bounded shadow-equivalence execution package

## Decision and prerequisites

B0 PASS; B1 historical same-purchaser equality PASS. GO to implement/review this
bounded C package. C live execution HOLD until the adapter, frozen manifest and
exact-head gates below exist. Legacy retirement HOLD. This document does not
activate a schedule, change ingestion authority, or authorize production writes.

Original reviewed package baseline: main
`c48adc40b35159e0da60464ef12a852d6ac2130e`, reviewed tree
`d25419a60b4a0728eea7f0c7489eea1a96fe2bcd`. Fresh-main implementation carrier
baseline: `ce6358ceeadb143c4cd5eaad4d7f234112160c7d`. Rebase and repeat exact-head
gates if main changes. Ownership: Work implementation, independent Verification,
CE final GO. ADR-0009 and ORDERMENTUM-359-CURRENT-API-CARRIER.md govern the
sequence.

## B1 evidence and failure disposition

| Evidence | Current B0 | Legacy-only B1 |
|---|---|---|
| Run | 34076398472 | 34108955340 |
| Job | 101603263008 | 101700447369 |
| SHA | c932ea1edcf2ee2d00aa7fcb81e46adf0db928b7 | c48adc40b35159e0da60464ef12a852d6ac2130e |
| Time UTC | completed 2026-09-07T02:28:33.318Z | 2026-09-07T09:58:37.132Z to 09:58:38.578Z |
| Result | current accepted; combined run stopped at legacy_get | PASS, auth HTTP 201, legacy HTTP 200 |
| Request attempts | current 1, auth 1, legacy 1 | current 0, auth 1, legacy 1 |
| Business writes | 0 | 0 |
| Identity / top-level keys | match / 70 | match / 70 |

Target SHA-256: `95ddce452fa5d6afece19d6d78858bf545d901a53b9a75fd250033bf08cae0fb`.
Both canonical payload hashes:
`51c938bf25a518f006ee3270e5d66994c90a6def1c0e2875b61b7a4016c1d308`.

Independent Verification fetched both job logs and confirmed equality. B1 reused
the historical B0 hash; no current GET was repeated. This is not a simultaneous
sample and does not prove other resources/callers. The same payload remained
hash-equal approximately 7.5 hours later.

The original hardcoded legacy runner omitted HTTP status/error classification.
#382 aligned the diagnostic with the incumbent configured origins (exact HTTPS
app/api allowlist), added status/error categories and bounded body reading.
That path succeeds. GitHub masks the configured origin values, so the evidence
does not establish that the original failure was caused by a particular host,
permission, transient error or parsing problem. Do not unmask secrets or repeat
the original failed experiment to manufacture a root-cause claim. Operational
B1 blocker resolved; retrospective unique cause remains unproven.

## Scope and implementation contract

One separate implementation PR may add a C manifest validator, read-only shadow
adapter, offline tests, manual workflow and evidence documentation. It may extract
pure request-planning/transform functions from the existing modules below only
with declared paths, regression tests and independent review; no new parallel
canonical transformation implementation. Existing schedules, writers, retention,
UI, migrations, credentials and operational state are outside scope.

The adapter must import safely: existing CLI entrypoints have top-level auth,
child processes and writes. Do not import or run those entrypoints as a shortcut.
Do not run cloud-sync, complete-mirror or an arbitrary --dry-run command with
production writer credentials. Audit run-log writes as well as business writes.
No Supabase credential is injected into the live read-only shadow step.

Current transport uses explicit api-key mode at https://api.ordermentum.com;
legacy transport uses the reviewed incumbent configuration under the same exact
app/api origin allowlist as B1. No fallback across auth modes, redirects, token
cache, secret output, install lifecycle at secret-bearing steps or payload upload.
A deployment-wide auth switch is forbidden. Each pair uses identical supplier,
filters, endpoint version, page size and window. Allowlisted origin class may be
recorded as an enum before dispatch in future code; never reconstruct masked
values from existing logs.

## Caller coverage matrix

| Entry path | Existing implementation to preserve | Required C evidence |
|---|---|---|
| Scheduled / manual orders and catchup | ordermentum-cloud-sync.mjs -> ordermentum-sync-now-legacy.mjs; ordermentum-full-sync-core.mjs | Same request plan, high-watermark/overlap, canonical order and invoice identities |
| Manual store/SKU/standard refresh | cloud-sync -> ordermentum-master-data-sync.mjs and master-data-common.mjs | Purchaser, price group, product and variant identity/hash parity |
| Targeted purchaser | ordermentum-targeted-store-sync.mjs and targeted-store-sync-core.mjs | One scoped target selected from C list; same canonical transform; B1 target excluded from new detail probes |
| Complete mirror recent/history/verify | ordermentum-complete-mirror.mjs, incremental-sync.mjs, invoice-detail-sync.mjs | Bounded request planner/replay incl. stock_locations and leads when requested; no live history expansion |
| Release / migration refresh and recovery | refresh-customer-stores-on-release.yml, refresh-master-catalog-after-migrations.yml, recover-supabase-migration-ordering.yml | Callsite mapping to reviewed transport/transform; offline dispatch/config parity |
| Owner manual trigger | supabase/functions/trigger-ordermentum-sync/index.ts -> cloud-sync workflow | Existing role checks, mode/ref dispatch and audit boundary retained; offline contract coverage |
| Local/maintenance callers | inventory all scripts, workflows and Edge functions using /v1/auth, username/password or Ordermentum URLs at candidate SHA | Every active caller classified; unsupported active caller blocks retirement |

Live C validates shared transports and transformations. Offline callsite mapping
alone is not live scheduled/manual acceptance. Any writer-path acceptance needed
for final D must be separately authorized after C read-only acceptance.

## Frozen manifest and budgets

Before execution, commit a validated manifest containing source baseline SHA,
supplier hash, exact allowlisted endpoint/query plans, target hashes,
window bounds, prior high-watermark reference (read-only), overlap and caps. Reject
missing fields, dynamic now() and arbitrary URLs. After committing, freeze an
external reviewed execution record binding the candidate SHA to the manifest blob
SHA/content digest. Do not put the containing commit SHA inside its own manifest.
Before secrets, verify candidate/main/checkout SHA and manifest digest against
that record; any change is HOLD. Raw target IDs stay
in an approved server-side input; visible GitHub input disclosure requires the
specific consent used for B1. Do not ask for secret values in chat.

Two manual windows are proposed, not scheduled: W0 orders/invoices changed in
[2026-09-07T04:00:00Z, 2026-09-07T10:00:00Z); W1 in
[2026-09-08T04:00:00Z, 2026-09-08T10:00:00Z). Execute only after each upper bound.
They are bounded historical comparisons, not an instruction to backfill. Before
live execution verify both APIs support identical filters; unsupported filters
block that resource. Master lists without date filters are paired during the
window's execution. Bind actual request timestamps; no claim of frozen provider
snapshot. If these windows are no longer suitable, review a replacement manifest
rather than silently changing bounds.

| Limit | Per window | Whole package |
|---|---|---|
| Logical resource lists | orders, products, variants, purchasers, price_groups, invoices, stock_locations, leads | Same eight classes |
| Pages per resource per auth | 2 maximum, page size 10 | 64 list GETs maximum |
| Detail targets | At most one each: purchaser, product, invoice; selected deterministically from overlapping list IDs | 12 detail GETs maximum |
| Legacy auth POST | 1, no renewal | 2 maximum |
| Provider requests | 38 GET + 1 auth maximum | 78 maximum |
| Rows | 320 list rows + 6 detail objects maximum across both auth modes | 652 maximum |
| Response bytes | 1 MiB per response, 16 MiB aggregate decoded bytes | 32 MiB aggregate |
| Runtime | 20 seconds/request; 10 minutes/window | 20 minutes |
| Writes / retries / redirects | 0 / 0 / 0 | 0 / 0 / 0 |

Plan list endpoints from existing definitions: /v2/orders, /v2/products,
/v1/variants, /v1/purchasers, /v1/price-groups, /v2/invoices,
/v1/stock-locations, /v1/leads. Detail endpoints must be pinned to the incumbent
version in the manifest: /v1/purchasers/{id}, /v1/products/{id}, and one reviewed
invoice version. The invoice helper has v1/v2 fallback candidates: do not follow
both automatically; unresolved version selection is HOLD before live calls.
Supplier filters apply as in existing definitions, not invented for price groups.
Optional stock-location unavailability is reported explicitly; it is not PASS
for a required active caller. No replacement resources or extra detail probes.

Missing second page is acceptable only if the provider indicates end-of-list.
If a cursor/continuation remains after page two, mark partial coverage and HOLD
for that resource, do not increase caps. Do not treat this sample as complete
catalogue coverage. C's no-live-retry policy does not alter incumbent retry rules;
exercise retry/backoff/pagination errors with offline transport fixtures.

## Equivalence, replay and acceptance

1. For each pair validate supplier/target identity and compare canonical JSON
   hashes; arrays remain ordered unless an existing versioned contract treats
   them as sets. Compare resource sets by stable IDs with counts and duplicate
   detection. Never omit fields or normalize values solely to get equality.
2. Pass both payloads through the same existing pure canonical transforms. Compare
   output identities, records and hashes, including operational order/invoice
   projections. Record per-resource result, window, request counts/bytes, SHA,
   transform version and structured failure category; no raw PII or provider body.
3. Replay each in-memory payload twice into an isolated ephemeral fixture sink.
   Require same canonical result and zero semantic duplicates. Simulate existing
   high-watermark/overlap, boundary timestamps, pagination, retry and interruption
   semantics offline. Never update production watermarks or run records.
4. Equality plus replay PASS for all required resources/callers permits C read-only
   acceptance after independent Verification and CE. Empty data, untested caller,
   partial coverage, missing endpoint capability or unexplained drift stays HOLD.
5. If real database idempotency or post-ingestion field acceptance is still needed,
   record a separate bounded test/staging or production-write package. A fixture
   sink PASS is not production database idempotency evidence.

Abort on 3xx, 401/403, 429, provider error, timeout, parser/size/cap failure,
unexpected origin, wrong identity, changed main or unexplained variance. Stop
remaining pairs/windows. Do not retry a failed run, advance a watermark, launch
fallback ingestion or repeat B1 current GET. Preserve only sanitized evidence.

## Gates, next action and rollback

The fresh-main carrier adds the manifest validator, adapter, manual runner,
offline fixtures and exact-head caller inventory in the same bounded PR that
carries this reviewed contract. Its workflow remains uninvoked and live HOLD.
After the immutable implementation head exists, record its candidate SHA and
canonical manifest digest externally before considering a separately authorized
window.
Required gates: offline safety and transform/replay tests; TypeScript/build when
code changes; diff hygiene; exact-head CI and required shadow scope result;
independent Verification; CE execution GO. The manual first-attempt main-only
workflow must check reviewed SHA, checkout SHA and current main before secrets,
use ordermentum-cloud-sync concurrency with cancel-in-progress false and preserve
existing production schedules without extra polling.

Rollback before/during C: stop dispatching and discard in-memory candidates;
revert the additive adapter through a protected PR if needed. Incumbent writers
remain authoritative, so no business-data compensation is needed. Keep existing
credentials. Preserve metadata evidence in #359 and versioned engineering records.

Retire /v1/auth only in separate D after C required caller coverage, canonical
and actual ingestion/idempotency gates are accepted, all active runtime callers
are current-key-only, independent exact-head Verification and CE issue GO, and
the rollback window is closed. B1 PASS opens C preparation; it does not remove
legacy credentials or authorize Unleashed cutover.
