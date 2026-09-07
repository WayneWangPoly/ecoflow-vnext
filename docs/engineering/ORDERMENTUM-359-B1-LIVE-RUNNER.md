# #359 B0/B1 bounded live acceptance runner

## Objective, ownership and scope

Complete the missing execution adapter after #380 released the guarded A/B0/B1
stack in main `4f24cc3d871998daf8d5c20b66c0244178eb638b`.
Implementation: Work coordinator; independent Verification: separate agent;
Chief Engineer: final exact-head review. ADR-0009 and #359 govern this package.

Allowed paths: `scripts/ordermentum-purchaser-live-acceptance.mjs`, its test,
`.github/workflows/ordermentum-purchaser-live-acceptance.yml`, its credential-free
contract workflow, and this record. Existing auth/ingestion helpers remain
unchanged. No migrations, frontend, database, authority, polling, secret mutation,
provider writes, or legacy retirement. The auth POST is session acquisition only.

## Behaviour contract

- Explicit manual workflow_dispatch on main, first run attempt only, confirmation
  `ONE_CURRENT_GET_ONE_LEGACY_GET`. A rerun is blocked; another dispatch requires
  another governed decision. Concurrency shares `ordermentum-cloud-sync` and
  does not cancel an in-progress business sync or acceptance.
- The requested full SHA must match GITHUB_SHA, the checked-out commit, and
  current main when the queued job reaches its pre-credential check. Workflow
  inputs enter environment variables, never interpolated shell commands.
- No provider secrets are present during checkout, setup or the SHA check.
  Only the final step receives the three repository Actions secrets. No install
  lifecycle scripts run, no credential persistence and no Supabase credentials.
- The runner validates key, username/password, purchaser UUID, explicit auth
  mode, origin, confirmation, SHA, event/ref and attempt before ANY provider call.
- B0 uses existing runProbe and guarded ordermentumFetch exactly once, retaining
  the current payload only in memory. Failure or wrong identity prevents legacy
  authentication. No automatic retry, pagination, fallback or redirect following.
- Legacy uses one fixed POST to `https://app.ordermentum.com/v1/auth` and one
  fixed GET to `https://api.ordermentum.com/v1/purchasers/{same UUID}`. This is the
  incumbent targeted-store helper's endpoint and token-alias contract, without
  retries, raw error logging or token cache. Only the legacy GET gets bearer;
  only the current GET gets x-api-key. Each request has a 20-second deadline.
- Existing comparePurchaserPayloads performs B1 in memory. Equality yields PASS
  for this sample; mismatch/error yields HOLD and nonzero CLI exit. Payloads,
  secrets, exception messages and purchaser UUID are never emitted by the runner.
  Attempt counters include requests that fail. Evidence contains timestamps,
  exact candidate SHA, stage, hashes, counts and fixed retirement HOLD.
- A purchaser UUID entered into GitHub dispatch is visible to repository viewers
  as input metadata. Use an authorized target; never enter a token in any input.
  The runner has no response-byte cap beyond a single purchaser and request
  deadlines; do not repurpose it for list endpoints or larger resource classes.

## Acceptance and evidence

Tests precede implementation (initial missing-module failure recorded locally).
Required: credential-free regression for success, preflight zero-traffic failures,
current errors, both legacy redirects, drift, identity mismatch, sanitized
failure output, and workflow boundaries. Re-run existing A/B0/B1 tests, syntax,
build/typecheck and hygiene. Exact-head CI, independent Verification and CE gate
must pass before separate main release. No database/RLS/UI test is applicable.

## Execution handoff

1. Release reviewed runner via protected PR; revalidate main and exact SHA.
2. Account owner installs `ORDERMENTUM_API_KEY` securely in repository Actions
   secrets. #380 has now removed implicit key-presence activation in main.
   Only inspect secret names/presence; never retrieve the value.
3. Select exactly one approved purchaser UUID and record the bounded dispatch
   decision. Current main SHA is supplied as expected_sha. Keep normal jobs in
   legacy mode; this workflow sets api-key in its isolated final step only.
4. Dispatch once with the explicit confirmation. Inspect metadata evidence and
   workflow outcome. Do not rerun failures or dispatch a substitute automatically.
5. Only PASS for B0/B1 opens a bounded #359-C work package with agreed windows,
   caps, caller coverage, canonical equivalence and idempotency evidence.

This package has NOT executed a provider request. Missing key remains a live
blocker. Existing successful Cloud Sync/Mirror runs after #380 show incumbent
operation, not new-key equivalence. #359-C and /v1/auth retirement remain HOLD.

## Rollback

Before release, close the PR. After release, stop dispatching and revert these
five additive files through a protected PR. No database compensation is needed;
incumbent authentication and ingestion have not switched. Preserve evidence,
keep existing credentials, and do not remove /v1/auth in this package.
