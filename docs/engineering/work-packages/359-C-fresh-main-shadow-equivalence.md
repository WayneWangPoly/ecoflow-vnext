# Work Package: #359-C fresh-main bounded shadow equivalence

## Objective

On baseline `ce6358ceeadb143c4cd5eaad4d7f234112160c7d`, deliver a reviewable
carrier for the #383 bounded current/legacy comparison without provider traffic
during engineering and without changing incumbent production request, write,
schedule or authority semantics.

## Owner and reviewers

- Implementation role: Work Platform/Release
- Verification role: Independent Verification on the immutable exact head
- Chief Engineer: engineering gate and later execution disposition
- Dependencies: #383 plus #359 B0/B1 durable PASS evidence
- Merge/live execution/legacy retirement are separate governed decisions

## In scope

- `docs/engineering/evidence/ordermentum-359-c-*`
- `scripts/ordermentum-shadow-*`
- `scripts/audit-ordermentum-359-c-callers.mjs`
- `.github/workflows/ordermentum-shadow-equivalence*`
- this work package and the carried #383 execution contract

The adapter may reuse import-safe pure helpers from incumbent Ordermentum modules.
It owns no canonical writer and injects no Supabase credential.

## Out of scope

- provider traffic during engineering;
- production writes, run-log writes or watermark movement;
- schedule change, caller auth-mode switch or `/v1/auth` retirement;
- new canonical ingestion implementation;
- downstream invoice SQL materialisation acceptance;
- #338/#339 mutation, inventory/SOH/opening balance or Unleashed cutover.

## Chief Engineer correction set

The first #397 head `3d1c023ec909d3d6acfcba73a0a624484bb9f55d` passed CI but is superseded before
Independent Verification by this correction set:

- freeze window semantics as incumbent `updatedAt[gte]` + `updatedAt[lte]`,
  therefore inclusive `[from,to]`;
- fail closed when `extractExternalId` would synthesize a fallback identity;
- add invoice-detail evidence using incumbent `hashPayload`/`extractTimestamp`
  primitives and the same summary-updated fallback semantics;
- reserve request/row budget before dispatch and use remaining aggregate bytes as
  a dynamic response cap;
- stream real response bodies under the byte cap;
- include legacy-auth bytes in aggregate accounting;
- preserve attempted auth/GET/row/byte counters on HOLD;
- enforce the 10-minute window deadline including legacy auth.

Any earlier frozen candidate/tree/manifest binding is invalid after this head
movement.

## Behaviour contract

The manual workflow accepts one externally reviewed exact protected-main SHA,
canonical manifest digest, W0/W1 and explicit
`READ_ONLY_SHADOW_NO_WRITES` confirmation.

Before provider secrets it proves:

- workflow dispatch on protected `main`;
- first run attempt only;
- checkout SHA = reviewed SHA = current main;
- canonical manifest digest;
- no Supabase credential injection.

After secrets it binds supplier identity by reviewed SHA-256, performs at most
one legacy auth POST, then paired GET-only reads. Redirects and retries are zero.
Payloads remain in memory. Only hashes/counts/timestamps/categories are emitted.

## Acceptance criteria

- [ ] Inclusive W0/W1 boundary semantics and exact query plan validate offline.
- [ ] Missing real stable identity fails closed; synthetic fallback IDs cannot pass.
- [ ] Current and legacy fixtures use identical endpoints/queries and incumbent pure evidence primitives.
- [ ] Invoice detail source evidence matches incumbent hash/timestamp semantics; downstream DB projection remains explicitly deferred.
- [ ] Two-pass fixture replay is idempotent with zero semantic duplicates.
- [ ] Request/row/byte/runtime caps fail closed before widening or retry.
- [ ] HOLD evidence preserves attempted provider-request counts.
- [ ] Full candidate caller inventory is classified; expected pre-D legacy paths remain.
- [ ] Typecheck/build, repository hygiene, exact-head CI and trusted required checks pass.
- [ ] Independent Verification reviews the immutable exact head.
- [ ] Durable #397 and #359 checkpoints bind the final head/tree/manifest/checks.
- [ ] No provider request, production write, schedule/caller change, merge or D retirement occurs in this engineering sequence.

## Test plan

| Layer | Scenario | Expected |
|---|---|---|
| Manifest | endpoint/query/window/transform/cap drift | fail closed |
| Identity | missing provider ID | HOLD, no synthetic-ID PASS |
| Projection | orders/purchaser/invoice evidence | same incumbent pure primitives |
| Transport | redirect, per-response cap, aggregate cap | fail closed, no retry |
| Page | >10 rows or continuation after page 2 | HOLD |
| Failure | interrupted paired request | attempted counts preserved |
| Runner | wrong ref/attempt/Supabase credential | zero provider traffic |
| Runner | auth rejection | one auth attempt, zero GET |
| Replay | two in-memory passes | identical digest, zero semantic duplicates |
| Inventory | caller audit | every candidate classified, D HOLD |
| Application | typecheck/build/hygiene | PASS |
| Live | not authorized | not run |

## Frozen limits

Per W0/W1 window:

- 8 list resource classes;
- max 2 pages/resource/auth, page size 10;
- max one purchaser/product/invoice detail target;
- max 38 GETs plus one legacy auth POST;
- max 326 admitted rows;
- max 1 MiB per response;
- max 16 MiB aggregate decoded bytes including auth;
- max 20 seconds per request;
- max 10 minutes including auth;
- zero writes, retries and redirects.

## Required evidence

Final durable evidence must record:

- fresh protected-main baseline;
- exact PR head and tree;
- manifest blob SHA and canonical SHA-256;
- transform contract version;
- exact-head CI run IDs;
- trusted required status and its honest scope;
- Independent Verification disposition;
- caller inventory result;
- `provider traffic = 0`;
- `production writes = 0`;
- `W0/W1 = NOT DISPATCHED`;
- `legacy retirement = HOLD`;
- `scheduled caller switch = HOLD`.

## Rollback

Close #397 or revert the additive carrier through a protected PR. No production
data compensation is required because this engineering package does not invoke a
writer or provider workflow.

## Decision log

### Decisions

- Consume B0/B1 evidence without repeating either probe.
- Keep incumbent `gte/lte`; correct prose to inclusive window semantics rather
  than inventing an unproven `lt` parameter.
- Pin invoice detail to `/v1/invoices/{id}`; no fallback inside C.
- Keep supplier raw identity in Actions secrets and bind it by reviewed SHA-256.
- Treat invoice C evidence as source-metadata evidence only; downstream database
  projection/idempotency is a separate future gate.

### Risks

- Any required resource with continuation after page two remains HOLD.
- Live provider endpoint/filter capability is unproven until separately
  authorized C execution.

### Deferred

- W0/W1 provider execution.
- Production ingestion/idempotency writer acceptance.
- #359-D legacy retirement.
