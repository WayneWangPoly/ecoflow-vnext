# Work Package: #359-C fresh-main bounded shadow equivalence

## Objective

On baseline `ce6358ceeadb143c4cd5eaad4d7f234112160c7d`, provide a credential-free
reviewable carrier for the #383 bounded read-only current/legacy comparison,
without making provider requests or changing any incumbent caller.

## Owner and reviewers

- Implementation role: Work Platform/Release
- Verification role: independent Verification on the immutable PR head
- Chief Engineer: final engineering and later execution disposition
- Dependencies: #383 and #359 B0/B1 durable PASS evidence
- Planned merge order: this carrier only; any live window, writer acceptance and D retirement remain separate decisions

## In scope

- `docs/engineering/evidence/ordermentum-359-c-*`
- `scripts/ordermentum-shadow-*` and `scripts/audit-ordermentum-359-c-callers.mjs`
- `.github/workflows/ordermentum-shadow-equivalence*`
- this work package and the carried #383 execution contract

Allowed behaviour is limited to offline validation/tests and an uninvoked,
manual, exact-main, first-attempt read-only workflow. Existing pure request,
identity and projection functions are reused. The adapter owns no canonical
writer.

## Out of scope

- Existing schedules, production caller mode, credentials, ingestion writers,
  run logs, watermarks, UI, migrations, RLS and inventory.
- Provider traffic during engineering, scheduled caller switch, `/v1/auth`
  retirement, #338/#339 mutation and Unleashed cutover.

## Behaviour contract

The manual workflow accepts one externally bound exact main SHA, canonical
manifest digest, W0/W1 and explicit read-only confirmation. Before secrets, it
proves checkout=current main=reviewed SHA and validates the manifest digest.
The runner rejects Supabase credentials, binds the raw supplier secret to an
externally reviewed SHA-256 secret, performs at most one legacy auth POST and
uses paired GET-only transports with no retry or redirect. It keeps payloads in
memory and emits hashes/counts/categories only. Any drift, cap, partial second
page, missing detail overlap, empty required target, auth/provider error or
identity/replay mismatch returns HOLD.

## Acceptance criteria

- [ ] Frozen #383 windows/resources/endpoints/budgets validate offline.
- [ ] Current and legacy fixtures use identical query plans and existing pure transforms.
- [ ] Two-pass fixture replay is idempotent with zero semantic duplicates.
- [ ] Full candidate caller inventory is classified; expected pre-D legacy paths remain.
- [ ] Typecheck/build, repository hygiene, exact-head CI and trusted required checks pass.
- [ ] Independent Verification reviews the immutable exact head.
- [ ] No provider request, production data write or schedule/caller change occurs.

## Test plan

| Layer | Command or scenario | Expected result |
|---|---|---|
| Static | `node --check scripts/ordermentum-shadow-*.mjs` | PASS |
| Unit | `node --test scripts/ordermentum-shadow-*.test.mjs` | PASS offline |
| Inventory | `node scripts/audit-ordermentum-359-c-callers.mjs` | all active candidates classified; retirement HOLD |
| Application | `npm run typecheck && npm run build` | PASS |
| Live | not authorized in this carrier | not run |

## Required evidence

- Changed files: bounded list above.
- Migration/RLS/screenshots: not applicable; no schema or UI change.
- Risks: provider endpoint capability and real data equality remain unproven until separately authorized live C.
- Known limitations: the fixture sink is not production database idempotency evidence.
- Deferred: writer-path acceptance and D retirement.

## Rollback

Close the PR or revert the additive carrier through a protected PR. Incumbent
writers and schedules are unchanged, so no data compensation is required.

## Decision log

### Decisions

- Consume B0/B1 evidence without repeating either probe.
- Pin invoice detail to `/v1/invoices/{id}`; do not use v1/v2 fallback.
- Keep supplier raw identity in Actions secrets and bind it by reviewed SHA-256.

### Assumptions

- The #383 historical windows remain the reviewed windows.

### Risks

- Any resource that still has continuation after page two causes HOLD.

### Deferred

- Live provider execution, production ingestion/idempotency and legacy retirement.
