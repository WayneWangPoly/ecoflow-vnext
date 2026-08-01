# Phase 9D–9G — Operational Stability Completion

## Completion boundary

This release closes the remaining operational-stability issues `#38` through `#41` without weakening the Phase 9B server-authority boundary.

## Phase 9D — Guided Initial Stocktake

`/warehouse-control` now owns a governed count workflow:

1. create an `INITIAL` or `CYCLE_COUNT` session;
2. optionally assign a rack/area and enable blind count;
3. record physical observations by location, SKU, barcode and package unit;
4. surface missing, unknown, mismatched and conflicting barcode evidence;
5. review exceptions without posting inventory;
6. complete each location;
7. submit one count batch for supervisor review;
8. approve the batch as Owner/Admin before balances and movement history change.

Observation rows are evidence only. The approval RPC aggregates the accepted evidence, applies the approved location balance and writes an immutable adjustment trail. A completed location can be reopened only by Owner/Admin with a recorded reason.

## Phase 9E — Move SKU and Cycle Count

The Move SKU transaction requires:

- source and destination locations;
- SKU and package unit;
- the source balance observed by the operator;
- quantity or explicit Move All;
- a mandatory reason;
- an idempotency command ID.

The database locks the location/SKU pair, rejects a stale source balance, prevents a negative result and writes linked `MOVE_OUT` and `MOVE_IN` warehouse legs under one transfer reference. The approved inventory movement journal receives one corresponding transfer record.

Blind cycle counts suppress current balances while the session remains `OPEN` or `IN_PROGRESS`. Variances are posted only after supervisor approval.

## Phase 9F — Exception Action Queue and Business Day Close

`/exceptions` is a server-paged action queue. Every open item carries:

- deterministic exception identity;
- age;
- category;
- severity policy;
- due time;
- governed owner team;
- recommended operational action;
- lifecycle status.

Owner, Admin and Account users can acknowledge, assign and resolve through the existing lifecycle command RPC. Resolution requires a note and history remains in the immutable lifecycle ledger.

Business Day Close explicitly reviews:

- Ordermentum sync cut-off;
- unresolved exception assignment;
- non-terminal delivery stops;
- unfinished pick/staging work;
- accounts variance acknowledgement.

Only Owner/Admin can close the day. The close wrapper records the checklist and acknowledgement, then invokes the existing server-authoritative carry-over function. History is not copied or rewritten.

## Phase 9G — Server Pagination and Productivity Completion

The following workspaces now request one bounded server page and an exact total:

- Orders;
- Stores;
- Inventory;
- Exceptions;
- Logs.

Allowed page sizes are `10`, `20`, `25`, `50` and `100`. Search, filter, sort, tab, page and page size remain in the URL.

Orders, Stores and Inventory retain database-backed Saved Views. The compact desktop top bar displays the authenticated profile and up to four Quick Actions. User choices are stored against `auth.uid()` with revision control; role defaults are used only until the user saves a personal configuration. Quick Actions are navigation-only and are filtered by the typed route capability contract before display.

## Safety and security invariants

- No stock mutation occurs when an observation is recorded.
- Edit Layout remains visual metadata only.
- Warehouse transfer source quantity cannot become negative.
- Browser code cannot write the new control tables directly.
- Security-definer RPCs revoke public execution before granting `authenticated`.
- Account can manage commercial exceptions but cannot read physical inventory pages.
- Viewer remains read-only and cannot enter the Exception Action Queue.
- Missing server data never becomes a fabricated zero or demo record.
- Preferences never use shared browser storage as the source of truth.

## Permanent verification

The `Operational stability completion` workflow runs:

- static completion audit;
- TypeScript;
- Vite production build;
- PostgreSQL migration compilation;
- non-posting stocktake tests;
- approval and immutable event tests;
- blind cycle-count tests;
- paired transfer, replay, concurrency and non-negative tests;
- all five server pagination resources;
- Quick Action scope, cap and revision tests;
- Business Day Close checklist and carry-over tests;
- Account exception access and physical-inventory denial.

Phase 9D–9G is complete only after the implementation PR is green, merged, production deployment succeeds, and issues `#38`–`#41` are closed with the production commit evidence.
