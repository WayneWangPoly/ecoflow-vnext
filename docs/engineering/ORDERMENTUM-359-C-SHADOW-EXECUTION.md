# #359-C bounded shadow-equivalence execution package

## Decision and prerequisites

B0 PASS; B1 historical same-purchaser equality PASS. GO to implement/review this
bounded C package. C live execution remains HOLD until the immutable fresh-main
carrier has exact-head CI, trusted required checks, Independent Verification and
a new external execution binding. Legacy retirement remains HOLD.

This package does not activate a schedule, change canonical ingestion authority,
or authorize production writes.

Original reviewed package baseline: main
`c48adc40b35159e0da60464ef12a852d6ac2130e`, reviewed tree
`d25419a60b4a0728eea7f0c7489eea1a96fe2bcd`. Fresh-main implementation carrier
baseline: `ce6358ceeadb143c4cd5eaad4d7f234112160c7d`. Rebase and repeat exact-head
gates if main changes. Ownership: Work implementation, independent Verification,
Chief Engineer final engineering and later execution disposition.

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

Target SHA-256:
`95ddce452fa5d6afece19d6d78858bf545d901a53b9a75fd250033bf08cae0fb`.

Both canonical payload hashes:
`51c938bf25a518f006ee3270e5d66994c90a6def1c0e2875b61b7a4016c1d308`.

Independent Verification fetched both job logs and confirmed equality. B1 reused
the historical B0 hash; no current GET was repeated. This is not a simultaneous
sample and does not prove other resources/callers.

The original hardcoded legacy runner omitted HTTP status/error classification.
#382 aligned the diagnostic with the incumbent configured origins and added
bounded body reading. That path succeeds. The retrospective unique cause of the
old failure remains unproven and must not be manufactured by repeating B0/B1.

## Fresh-main engineering corrections before Independent Verification

The first #397 candidate exposed three contract-level gaps during Chief Engineer
review. They are corrected in the fresh exact-head successor before Independent
Verification:

1. **Window boundary semantics.** The repository incumbent order planner uses
   `updatedAt[gte]` and `updatedAt[lte]`. The earlier prose wrote the historical
   windows as half-open `[from,to)`, while the frozen manifest and runner already
   used `lte`. The canonical C contract is therefore now explicitly
   `inclusive_gte_lte`, with windows written `[from,to]`. This is a documentation
   and manifest-contract correction to match the existing request planner; it
   does not authorize a provider call.
2. **Invoice projection evidence.** C now records an invoice-detail evidence
   projection using the same import-safe primitives consumed by the incumbent
   invoice detail writer: `hashPayload` plus the exact created/updated timestamp
   field precedence. The list-summary updated timestamp is used as the same
   fallback when the detail payload lacks one. This evidence projection is not a
   second canonical writer. Downstream SQL invoice materialisation and real
   database idempotency remain separate writer-path acceptance gates.
3. **Hard budgets and failure evidence.** GET and row capacity are reserved
   before dispatch; the remaining aggregate decoded-byte budget dynamically
   limits each paired response; real streamed response bodies are cancelled
   before decoding beyond the accepted byte cap; a provider page larger than the
   frozen page size fails closed before rows are admitted; legacy-auth decoded
   bytes are counted; and HOLD evidence preserves attempted auth/GET counts,
   rows, bytes, retries, redirects and writes.
4. **Strict identity.** C still reuses the incumbent `extractExternalId` helper,
   but invokes it with a unique sentinel and treats its fallback synthetic ID as
   missing. A response without a real provider identity therefore cannot pass C
   merely because the production master-data helper can synthesize a fallback
   storage key.

Any head/tree/manifest change invalidates the earlier
`3d1c023ec909d3d6acfcba73a0a624484bb9f55d` execution binding.

## Scope and implementation contract

The C carrier may contain the manifest validator, read-only shadow adapter,
offline tests, manual workflow and evidence documentation. It may import existing
pure request/identity/projection helpers, but it must not import CLI entrypoints
whose module initialisation authenticates, launches child processes or writes.

Do not run cloud-sync, complete-mirror or an arbitrary `--dry-run` command with
production writer credentials. Audit run-log writes as well as business writes.
No Supabase credential is injected into the live read-only shadow step.

Current transport uses explicit API-key mode at
`https://api.ordermentum.com`. Legacy transport uses the reviewed incumbent
configuration under the exact app/api HTTPS origin allowlist. No fallback across
auth modes, redirects, token cache, secret output, payload upload or deployment-
wide auth switch is permitted.

Each pair uses identical supplier, filters, endpoint version, page size and
window. Raw supplier identity remains server-side and is bound by a separately
reviewed SHA-256 secret.

## Caller coverage matrix

| Entry path | Existing implementation to preserve | Required C evidence |
|---|---|---|
| Scheduled/manual orders and catchup | `ordermentum-cloud-sync.mjs` -> legacy wrapper; `ordermentum-full-sync-core.mjs` | Same request plan, high-watermark/overlap and canonical order identity/date/status evidence |
| Manual store/SKU/standard refresh | master-data sync/common | Purchaser, price group, product and variant identity/hash parity |
| Targeted purchaser | targeted-store sync/core | One scoped detail target; same purchaser projection; B1 target excluded |
| Complete mirror recent/history/verify | complete-mirror, incremental and invoice-detail paths | Bounded request planner/replay including invoices, stock locations and leads |
| Release/migration refresh and recovery | release/migration/recovery workflows | Callsite mapping to reviewed transport/config |
| Owner manual trigger | Supabase trigger -> cloud-sync workflow | Existing role and audit boundary retained; offline coverage only |
| Local/maintenance callers | scripts/workflows/functions containing Ordermentum auth/origins | Every active candidate classified; unsupported legacy caller blocks D |

Live C validates shared transport and transformation evidence. Offline callsite
mapping alone is not scheduled/manual writer acceptance.

## Frozen manifest and external binding

Before any live execution, the manifest must bind:

- fresh-main source baseline;
- execution state `ENGINEERING_FROZEN_LIVE_HOLD`;
- supplier raw-value environment name plus externally reviewed SHA-256 binding;
- exact approved origins;
- exact W0/W1 bounds and `inclusive_gte_lte` semantics;
- exact resource, endpoint, detail-endpoint and query parameter plan;
- B1 target exclusion hash;
- prior high-watermark reference as read-only evidence only;
- 15-minute overlap contract;
- request/page/row/byte/runtime limits;
- exact transform/evidence contract version.

After a new immutable candidate exists, record candidate SHA, tree SHA, manifest
blob SHA and canonical manifest SHA-256 externally. Do not place the containing
commit SHA inside its own manifest. Before provider secrets are injected, the
workflow proves reviewed SHA = checkout SHA = current protected main and proves
the manifest digest.

## Frozen historical windows

Two manual windows are proposed, not scheduled:

- W0 orders/invoices changed in
  `[2026-09-07T04:00:00Z, 2026-09-07T10:00:00Z]`;
- W1 orders/invoices changed in
  `[2026-09-08T04:00:00Z, 2026-09-08T10:00:00Z]`.

Both ends are explicit ISO timestamps. The upper end is inclusive because the
incumbent planner uses `updatedAt[lte]`; C is not introducing an unproven
`updatedAt[lt]` parameter.

These are historical comparisons, not backfill instructions. Master lists
without date filters are paired at execution time. If either API cannot support
the exact reviewed filter/endpoint plan, that resource is HOLD. If these windows
are replaced, a new manifest and external binding are required.

## Budgets

| Limit | Per window | Whole two-window package |
|---|---:|---:|
| Logical resource lists | 8 | same 8 classes |
| Pages per resource per auth | max 2, page size 10 | max 64 list GETs |
| Detail targets | max one each: purchaser, product, invoice | max 12 detail GETs |
| Legacy auth POST | max 1 | max 2 |
| GET requests | max 38 | max 76 |
| Provider requests incl. auth | max 39 | max 78 |
| Rows admitted | max 326 | max 652 |
| Response body | max 1 MiB each | — |
| Aggregate decoded bytes incl. auth | max 16 MiB | max 32 MiB |
| Request timeout | max 20 seconds | — |
| Window runtime incl. auth | max 10 minutes | max 20 minutes |
| Writes / retries / redirects | 0 / 0 / 0 | 0 / 0 / 0 |

Before every paired GET, the runner reserves two GET slots and the maximum
possible row admission for that pair. It calculates a dynamic per-response byte
cap from the remaining aggregate budget. A streamed body crossing that accepted
cap is cancelled and never admitted as a parsed payload.

Missing second page is acceptable only if the provider indicates end-of-list.
Continuation after page two is HOLD; do not widen the cap.

## Endpoint plan

List endpoints:

- `/v2/orders`
- `/v2/products`
- `/v1/variants`
- `/v1/purchasers`
- `/v1/price-groups`
- `/v2/invoices`
- `/v1/stock-locations`
- `/v1/leads`

Pinned detail endpoints:

- `/v1/purchasers/{id}`
- `/v1/products/{id}`
- `/v1/invoices/{id}`

No v1/v2 detail fallback is permitted inside C. Price groups must not invent a
supplier filter. No replacement resource or extra detail probe is allowed.

## Equivalence, replay and acceptance

1. For each list pair, require real stable provider identities, no duplicates,
   equal ordered identities, equal canonical raw payload hashes and equal
   evidence-projection hashes.
2. Orders reuse `extractOrderIdentity`, `extractOrderDates` and
   `extractOrderStatus`. Purchaser detail reuses
   `projectPurchaserToStoreRow`. Invoice detail evidence uses the incumbent
   `hashPayload` and `extractTimestamp` primitives with the same timestamp
   precedence/fallback as the writer. Other master resources use strict external
   identity plus canonical raw hash evidence.
3. The invoice evidence projection deliberately stops before downstream SQL
   invoice materialisation. Because C is read-only, real database projection,
   conflict behaviour and production idempotency remain a separate bounded
   writer-path acceptance package before D.
4. Replay each list payload twice into an isolated ephemeral sink. Require the
   same projection digest and zero semantic duplicates.
5. Record only sanitized per-resource/window hashes, counts, timestamps,
   transform version and structured failure category. Do not log provider
   payloads, raw supplier IDs or credentials.
6. Empty required coverage, missing detail overlap, oversized page, partial
   pagination, cap exhaustion, auth/provider error, timeout, wrong identity,
   changed main or unexplained variance is HOLD.
7. On HOLD, stop the package. Do not retry, advance a watermark, invoke fallback
   ingestion or repeat B0/B1. Preserve attempted request/byte/row counters.

Equality plus replay PASS for all required resources/callers permits only a
future C read-only acceptance decision after Independent Verification and Chief
Engineer GO. It does not permit D.

## Gates, next action and rollback

Required engineering gates:

1. offline manifest, transport, strict-identity, invoice-evidence, replay,
   pagination/interruption and hard-budget tests;
2. caller inventory;
3. TypeScript/build and repository hygiene;
4. exact-head PR CI and required trusted status;
5. Independent Verification on that immutable head;
6. durable #397 and #359 checkpoints;
7. STOP before live provider traffic.

The manual workflow remains uninvoked. A future live run requires a separately
authorized W0 or W1 after the carrier is on the exact protected main and a new
main-SHA/manifest binding is recorded.

Rollback before/during C is to stop dispatching and discard in-memory candidates.
The incumbent writer remains authoritative, so this engineering carrier requires
no business-data compensation.

Retire `/v1/auth` only in separate #359-D after read-only C acceptance, separately
authorized writer-path acceptance/idempotency evidence, all live callers being
current-key-only, Independent Verification and Chief Engineer issue GO.
