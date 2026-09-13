# ECOFLOW-R3-P3A-R3 — provider sentinel repair

## Trigger

The first authenticated production P3 verification after P3A-R2 deployment returned `HOLD / P3_VERIFICATION_ONLY` even though all frozen Commercial Wave-2 evidence was exact:

- Commercial SKU `140010` exact;
- active Ordermentum mapping exact;
- source provenance exact;
- command / promotion `1 / 1`, initial `replayed=false`;
- promotion audit exact;
- P4 enabled `0`;
- non-canary promotions `0`;
- P3A emitted provider traffic `0`.

The sole blocker was `providerSentinel.status = UNATTRIBUTED_PROVIDER_ACTIVITY`.

## Root cause

P3A-R2 correctly changed the provider invariant from “absolute zero provider-table delta” to attribution-aware, but its implementation froze one dynamic operational run UUID and one GitHub run as the only acceptable non-zero provider observation.

Production evidence after P2B disproved that model:

1. The previously classified scheduled Cloud Sync GitHub run `34767646363` corresponds to a healthy incumbent `legacy-bearer` production sync whose actual current `ordermentum_sync_runs_v2` row is dynamic.
2. After PR #402 deployed, the already-existing weekly `EcoFlow Ordermentum Complete Mirror` schedule ran normally as GitHub run `34778148992` on `main@0986a20be5da367b0960a01c7e9c481139680f96`.
3. Its production sync was healthy incumbent legacy traffic: `BACKFILL`, `SUCCEEDED`, `legacy-bearer`, legacy origin `https://app.ordermentum.com`, zero errors/rate limits/detail failures.
4. Because R2 accepted only one fixed operational UUID, a legitimate later scheduled reconciliation became “unattributed” even though it was not P3A traffic, not #359-C current-API shadow, not caller switch, not legacy retirement, and not cutover.

No provider evidence is deleted or reset. The original HOLD is preserved as the correct fail-closed response to an attribution contract that could not prove the new run.

## R3 repair

R3 adds `public.ecoflow_read_commercial_wave2_p3_verification_v2()` as a no-argument `STABLE SECURITY DEFINER` authenticated OWNER/ADMIN read wrapper.

It consumes the already-reviewed R2 frozen evidence report and changes only provider attribution. All non-provider R2 failures remain authoritative.

A post-P2B `ordermentum_sync_runs_v2` row is attributable only if every condition below is true:

- `run_type = BACKFILL`;
- `status = SUCCEEDED`;
- `auth_mode = legacy-bearer`;
- exact legacy origin `https://app.ordermentum.com`;
- `rate_limited = 0`;
- `error_count = 0`;
- `detail_fetch_failed = 0`;
- `detail_fetch_succeeded = detail_fetch_attempted`;
- `finished_at` is present.

Every post-P2B raw API event must belong to a run satisfying that same class. Any changed `ORDERMENTUM` sync-state row must remain enabled in `LEGACY_INCREMENTAL`, with zero consecutive failures and no last error.

This deliberately uses a **class invariant**, not a run UUID allow-list.

## Fail-closed boundaries

R3 still returns HOLD if any of the following appears:

- `api-key` or any non-legacy auth mode;
- any origin other than `https://app.ordermentum.com`;
- failed/incomplete/rate-limited/errored legacy run;
- raw API event not attributable to a healthy allowed legacy run;
- degraded or unexpected sync-state row;
- `ordermentumMasterSyncRuns` / current-API shadow evidence;
- caller switch;
- legacy retirement;
- cutover;
- any frozen P2B evidence mismatch;
- any Physical/package/barcode/inventory/location/image/#339 sentinel mismatch;
- any P4 enablement or non-canary promotion.

The repair creates no provider request and no business-data DML. It does not replay P2B or authorize P4.

## Production observation that motivated R3

At the authenticated verification timestamp `2026-09-13T22:10:02.130754Z`, the UI reported:

`HOLD / P3_VERIFICATION_ONLY`

with all identity/lineage/negative-space evidence correct and only:

`UNATTRIBUTED_PROVIDER_ACTIVITY · P3A emitted 0`.

Read-only production inspection found two healthy post-P2B legacy sync rows, including the later weekly recent reconciliation associated by timing and workflow semantics with `EcoFlow Ordermentum Complete Mirror` run `34778148992`. That workflow is an incumbent scheduled operational path and explicitly sets `ORDERMENTUM_AUTH_MODE=legacy-bearer`.

## Verification gates

Before merge, require:

1. R3 static contract PASS;
2. PostgreSQL 17 contract proving multiple dynamic healthy legacy run UUIDs PASS;
3. current API / unknown origin / failed legacy / degraded sync-state negative tests HOLD;
4. incumbent P3A-R2 static and DB regressions PASS;
5. P2B regression PASS;
6. TypeScript and production build PASS;
7. migration repeat-apply PASS;
8. trusted production-schema shadow SUCCESS;
9. exact-head Independent Verification APPROVE.

## STOP boundary

Engineering/PR/CI/verification only. Do not merge or deploy this repair without a separate merge authorization. Do not replay P2B. Do not execute P4, #339 business mutation, #359 current-API shadow/caller switch, legacy retirement, or cutover.
