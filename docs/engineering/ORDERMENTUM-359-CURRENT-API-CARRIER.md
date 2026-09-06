# #359 current API carrier and live acceptance disposition

## Objective and ownership

Refresh the existing #359-A / B0 / B1 implementation against main without
changing ingestion, authority or polling. Implementation: Work integration;
independent Verification: separate reviewing agent; final disposition: Chief
Engineer. ADR-0009 and #359 remain the governing contract.

## Source, scope and rollback

- Main at integration: `741f896ce894aa4748d000779b2048006112ed25`.
- #373: `6ed6f79fe29998986adda0b1db741fa9fe055ef5` (A, 14 files).
- #374: `1c21790e3a9104911de62541abca87ff7aff862a` (B0, 3 files).
- #375: `db905d0711ac1eb2bc17f7af153eca6d9ad4e61f` (B1, 3 files).
- The bottom stack is 73 commits behind / 14 ahead of this main. None of the
  20 stack paths changed on main since its original base `6e96a1d2769732f6505e604d961bfd6c6033232f`.
- Carry the complete reviewed stack in one merge onto latest main, preserving
  original PRs and commits. No force-push or three separate rewritten stacks.
- Allowed changes: the existing 20 stack files and this execution record.
  No runtime changes beyond the original stack. No migrations, frontend edits,
  production deployment, provider writes, broad scans or cadence changes.
- Rollback before release: close the carrier; production is unchanged.
  Any future release requires a separately governed revert of the carrier,
  preserving canonical data. Do not remove old credentials in this package.

## Behaviour and acceptance

Installing a secret must not select current auth automatically once the guard
is deployed. Incumbent jobs retain legacy behaviour. Current auth requires
explicit mode, exact official origin, header-only credentials, manual redirects
and fail-closed errors. B0 performs one purchaser GET, with no retries or business
writes. B1 compares same-ID payloads in memory using canonical JSON SHA-256 and
returns hashes and structural metadata only. Any identity/payload mismatch is
HOLD; raw customer fields are not diagnostic output.

Required evidence: typecheck/build; all three origin-guard test files; B0 and B1
regressions; repository hygiene; exact candidate CI; independent Verification;
Chief Engineer disposition. Historical reviews do not approve the new head.
Database/RLS and UI tests are not applicable to this transport-only diff.

## Secret-presence observation (2026-09-06)

Authenticated GitHub Settings > Secrets and variables > Actions lists no
`ORDERMENTUM_API_KEY` in either Repository secrets or Environment secrets.
Only names/scopes were inspected. No secret value was opened, retrieved,
copied, changed or logged. This proves absence from those listed scopes, not
token validity or absence from unrelated stores.

The approved common consumer scope is the repository Actions secret named
`ORDERMENTUM_API_KEY`: cloud-sync and complete-mirror do not share an environment
with all other consumers. Supabase trigger functions dispatch Actions; a key
stored only in Supabase does not supply these Node jobs.

Do not install the key into the currently consumed name before the guarded
transport is released: pre-carrier main contains key-presence activation.
An approved release of A must precede common-secret installation. This carrier
does not merge or deploy main, install the key or change any secret scope.

## B0/B1 live execution sequence — blocked, not executed

1. Reconfirm latest main, immutable candidate SHA and exact-head CI; obtain
   independent Verification and CE release disposition through protected PR
   gates. Release the guard before activating a consumed common secret.
2. Owner securely installs the new provider token as repository Actions secret
   `ORDERMENTUM_API_KEY`; inspect names only. Never paste it into chat, inputs,
   files, logs or browser code. Presence is not evidence of a valid token.
3. Bind a reviewed server-side execution runner to the accepted exact SHA and
   one explicitly selected purchaser UUID. The old B0/B1 contract workflows are
   credential-free tests, not live dispatch runners. Do not repurpose sync or
   recovery workflows: they can write business data. Review any new live runner
   separately before giving it secret access.
4. In the bounded runner only, set `ORDERMENTUM_AUTH_MODE=api-key`, fix the base
   to `https://api.ordermentum.com`, and use B0 `runProbe` with its guarded
   transport for exactly one `/v1/purchasers/{id}` GET. No pagination, redirect,
   fallback or retry. Abort on any missing input, auth error or bad identity.
5. Retain the current payload only in that server process while emitting B0
   metadata. Compare the same purchaser through the incumbent read path. Bound
   legacy authentication separately (at most one auth POST if necessary) and
   legacy purchaser GET to one; disable incidental token-cache file writes,
   refresh/retry and all ingestion. No additional current GET for B1.
6. Feed both in-memory payloads into `comparePurchaserPayloads`; require
   `identity_match` and `payload_equal`. Persist only exact SHA, timestamps,
   request counts, target hash, payload hashes and status. Discard payloads.
7. On failure retain legacy authority, stop and issue HOLD. On success prepare
   #359-C for review; B1 success alone never authorizes legacy retirement.

No purchaser has been selected and no provider request has been made by this
carrier integration. Missing key and missing reviewed live runner are separate
blockers; resolving only one is insufficient.

## #359-C preparation criteria (not an approved execution package)

After B1 equality, bind a bounded shadow package to explicit targets/window,
page/row/byte/request caps and an exact SHA. Exercise the existing full-sync
current transport and canonical transformations, preserving high-watermark,
overlap, pagination, retries and serialization. Account for scheduled, manual,
targeted, recovery and complete-mirror entry paths. Require equal canonical
identities/hashes/records and unchanged replay with zero semantic duplicates.
No second writer or increased polling. Abort on unexplained variance or caps.
The evidence must distinguish read-only shadow from any separately authorized
canonical-write/idempotency acceptance. Do not call this stage PASS without
those observations.

## `/v1/auth` retirement decision

**HOLD.** Required progression: A safely released -> secret securely installed
-> bounded B0 accepted -> same-target B1 equality -> bounded C coverage and
idempotency accepted -> independent exact-head Verification -> CE GO for a
separate D retirement PR. D removes legacy runtime dependencies and required
username/password secrets, proves all active callers use current auth, and
closes the rollback window before credential retirement. Timing is evidence
based, before Unleashed cutover or the ADR-0009 provider deadline, whichever
comes first. Engineering PASS is not live acceptance or permission to merge.
