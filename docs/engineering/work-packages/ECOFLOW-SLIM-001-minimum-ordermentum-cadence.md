# ECOFLOW-SLIM-001 — Minimum Ordermentum Cadence

## Objective

Reduce automatic Ordermentum workload to the minimum operationally useful cadence without weakening incremental continuity or release verification.

Production evidence on 2026-08-26 showed the EcoFlow database at 505,293,971 bytes (about 482 MiB) against the Supabase Free Plan 500 MB database quota. The standing operating objective is to stop unnecessary mirror work before deeper JSON-retention changes are introduced.

## Owner and reviewers

- Implementation role: Platform/Data
- Verification role: independent repository CI / Verification reviewer
- Chief Engineer: required because deployment workflows are protected
- Dependencies: existing Ordermentum high-watermark incremental sync and `verify_only` Complete Mirror mode
- Planned merge order: this cadence PR before targeted-resource sync and raw-JSON retention work

## In scope

- `.github/workflows/ordermentum-cloud-sync.yml`
- `.github/workflows/ordermentum-complete-mirror.yml`
- `.github/workflows/ordermentum-minimum-cadence-check.yml`
- `scripts/ordermentum-minimum-cadence-contract.test.mjs`
- this work package

Allowed behaviour changes:

- scheduled order/invoice delta runs fall from 48/day to 4/day;
- automatic release verification uses `verify_only`, not data reconciliation;
- scheduled recent reconciliation runs weekly, not daily;
- full-history reconciliation remains manual only;
- Ordermentum workflow artifacts retain for 1 day, the minimum accepted evidence window;
- the obsolete push-triggered catchup path is removed; catchup remains available manually.

## Out of scope

- no Supabase row deletion;
- no raw JSON retention change;
- no physical `VACUUM FULL`;
- no Ordermentum source write;
- no store/SKU targeted-sync implementation in this PR;
- no change to the high-watermark algorithm, overlap semantics, projection authority, RLS, or business state.

## Behaviour contract

### Scheduled operational delta

GitHub Actions cron is UTC. Run order/invoice high-watermark delta at `04:07`, `12:07`, `16:07`, and `22:07` UTC daily. In current Australian central/eastern offsets this places runs around early morning, morning, afternoon, and late evening; daylight-saving changes may shift local wall-clock time by one hour.

The sync continues to use the stored `high_watermark_updated_at` with overlap, so cadence reduction must not replace the cursor with a fixed lookback-only scan.

### Complete Mirror

- `workflow_run` after successful Supabase production deployment: `verify_only`.
- weekly scheduled run: `recent`.
- manual `recent`: allowed.
- manual `full_history`: maps to resumable history mode and is never scheduled automatically.

### Evidence retention

GitHub sync/reconciliation artifacts retain for 1 day. Durable database operational state remains authoritative; artifacts are short-lived debugging evidence only.

## Acceptance criteria

- [ ] Cloud sync contains exactly one four-times-daily cron expression and no twice-hourly cron.
- [ ] Scheduled cloud sync still resolves to `orders_invoices`.
- [ ] Cloud sync artifact retention is exactly 1 day.
- [ ] Complete Mirror schedule is weekly, not daily.
- [ ] Deployment-triggered Complete Mirror resolves to `verify_only`.
- [ ] Weekly Complete Mirror resolves to `recent`.
- [ ] Full history is reachable only through manual dispatch.
- [ ] Complete Mirror artifact retention is exactly 1 day.
- [ ] No automatic push-triggered catchup remains.
- [ ] Static contract test passes.

## Test plan

| Layer | Command or scenario | Expected result |
|---|---|---|
| Static | `node --test scripts/ordermentum-minimum-cadence-contract.test.mjs` | workflow cadence and retention contract passes |
| Workflow | PR CI | cadence contract job green |
| Production after merge | inspect next scheduled runs | no more than four scheduled operational deltas/day; weekly recent only |
| Release | successful Supabase deployment | Complete Mirror verification runs in `verify_only` mode |

## Required evidence

- changed-file diff;
- cadence contract CI output;
- no migration or production-data mutation in this work package;
- post-merge workflow run evidence before declaring release complete.

## Rollback

Revert the workflow commit. No database compensation is required because this work package changes scheduling and artifact retention only.

## Decision log

### Decisions

- Prefer minimum automatic work over freshness beyond operational need.
- Preserve release verification but decouple it from data fetching.
- Use 1-day artifacts because longer GitHub artifact retention has no operational requirement here.

### Risks

- Local Australian wall-clock times shift by one hour with DST because GitHub cron is UTC.
- A failed scheduled delta may leave a longer freshness gap; the next successful run still resumes from high watermark with overlap.

### Deferred

- targeted purchaser/product sync;
- current-state-only master mirror;
- removal/slimming of duplicated invoice and line-item raw JSON;
- controlled compaction after logical slimming.
