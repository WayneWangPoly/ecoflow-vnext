# Phase 9A — Production Activation Readiness

## Status boundary

EcoFlow Intelligence & Control Room 2.0 is engineering-complete through `INTEL-GATE-008`. Production activation is a separate operational programme. This phase improves deployment reliability and defines the evidence required before any Phase 7 feature flag can move from `SHADOW` to `ON`.

Phase 9A does not declare production cutover complete. It does not fabricate release evidence, change feature flags, or mutate orders, inventory, customers, routes, POD, returns or exception lifecycle state.

## INTEL-PROD-001 — Deployment reliability

The production Supabase workflow now treats known control-plane failures as transient only when the output contains bounded evidence such as:

- HTTP `429`, `502`, `503` or `504`;
- Cloudflare `origin_bad_gateway`;
- Supabase `unexpected list functions status`;
- rate limiting, temporary unavailability, network reset or timeout evidence.

The governed retry runner:

- invokes commands without a shell;
- retries at most five times;
- uses exponential delay capped at 120 seconds;
- honours an upstream `retry_after` value when present;
- writes every attempt to the production deployment artifact;
- fails immediately for deterministic SQL, permission, project configuration and contract errors.

The retry contract is applied to production project linking and all five deployed Edge Functions:

1. `trigger-ordermentum-sync`;
2. `notify-route-start`;
3. `delivery-notification-dispatch`;
4. `statement-dispatch`;
5. `storage-retention`.

Migration semantic failures remain hard failures. The retry mechanism is not permitted to conceal a broken migration.

## INTEL-PROD-002 — Production activation evidence

The five governed release flags remain:

- `control_room_v2`;
- `analytics_inventory_v1`;
- `analytics_customer_v1`;
- `analytics_delivery_v1`;
- `overlay_navigation_v1`.

Each flag requires all ten Phase 7 checks for the applicable Adelaide business date. Evidence must be collected over multiple full business days and must include normal volume and edge conditions. At minimum, the activation review must cover:

- Owner, Admin, Account and Viewer access;
- warehouse and Driver operational boundaries where relevant;
- desktop and mobile behaviour;
- empty, degraded, unavailable and source-interruption states;
- large lists, filtering, sorting, pagination and Back/Forward context;
- metric reconciliation against the legacy production path;
- rollback verification.

Missing evidence remains `UNAVAILABLE`. It must not become `PASS`, zero, or an inferred successful rollout.

## INTEL-PROD-003 — Controlled cutover

A production cutover must follow these rules:

1. the latest `main` commit has a successful Supabase production deployment;
2. the latest frontend commit has a successful Vercel production deployment;
3. the selected flag is currently `SHADOW`;
4. all ten checks for the selected business date are recorded as `PASS`;
5. the Owner/Admin submits the current expected revision;
6. the server explicitly returns `APPLIED` or `REPLAYED` for the same command;
7. only one bounded flag change is reviewed at a time;
8. rollback to `OFF` remains available and preserves analytics history.

Direct `OFF` to `ON` transition remains forbidden. A network-unknown response is not success.

The current Vercel `build-rate-limit` status is an external deployment-capacity blocker. Code gates may pass while production frontend activation remains incomplete. The frontend must not be described as current until a successful Vercel deployment exists for the relevant commit.

## INTEL-PROD-004 — Operational backlog reconciliation

The original Intelligence roadmap is complete, but the wider operational stability backlog remains separate. GitHub issues `#36` through `#41` must be reconciled against current `main` before they are closed or extended:

- `#36` native route ownership;
- `#37` server-authoritative driver, pick, route and business-day state;
- `#38` guided Initial Stocktake;
- `#39` controlled Move SKU and cycle count;
- `#40` assigned exception actions and Business Day Close;
- `#41` server pagination and remaining productivity controls.

Existing CI evidence may prove part or all of an acceptance criterion, but an issue is not closed merely because a similarly named audit passes. Each criterion must be mapped to concrete production code, database authority and role tests.

Historical automated Supabase failure issues are closed only after a newer production deployment proves the same stage succeeds. A passing shadow database test alone is not production deployment evidence.

## Completion definition

Phase 9A engineering readiness is complete when:

- the transient retry runner and its contract tests pass;
- the production workflow uses it for linking and every Edge Function deployment;
- deterministic failures still fail closed;
- a permanent CI audit protects the deployment contract;
- the activation and backlog boundaries are documented.

Actual production activation remains incomplete until real multi-day evidence is recorded and the governed Phase 7 cutovers are executed.