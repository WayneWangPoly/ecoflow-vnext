# Phase 9B — Operational Core Authority

## Completion boundary

This phase closes the server-authority requirements in operational-stability issue `#37`.

Driver progress, route state, pick state, staging, released orders, active run and shift events remain represented as business-day scopes, but the browser is no longer allowed to write those rows directly. The database owns each scope revision and accepts changes only through an idempotent compare-and-swap command.

Device storage remains a day-scoped rendering and offline-recovery cache. It is never a source of business truth. The first successful server hydration replaces the device cache, including when the authoritative business day is empty.

## Authority model

Each `ecoflow_day_state` scope now has two independent server counters:

- `change_seq`: a global monotonic cursor for lossless incremental reads;
- `revision`: a per-scope compare-and-swap token for writes.

A client command contains:

- a deterministic UUID command ID;
- the Adelaide business date;
- the exact scope;
- the expected server revision;
- the complete replacement payload for that scope.

The server returns one of three explicit outcomes:

- `APPLIED`: the expected revision matched and the scope was committed;
- `REPLAYED`: the same command was already committed and its original result is returned;
- `CONFLICT`: a newer scope exists and its payload and revision are returned without changing it.

A batch is preflighted under deterministic advisory locks. One stale scope prevents the entire batch from partially committing.

## Database boundary

Authenticated clients retain governed read access but no longer have direct `INSERT`, `UPDATE` or `DELETE` privileges on `ecoflow_day_state`.

The supported API is:

- `ecoflow_read_day_state(date, after_change_seq, limit)`;
- `ecoflow_read_day_state_scope(date, scope)`;
- `ecoflow_apply_day_state_commands(date, commands, actor_label)`.

Role scope remains enforced server-side through `ecoflow_can_write_day_scope`:

- Owner/Admin may manage all operational scopes;
- Account may manage office route control, release and route-lock scopes;
- Warehouse/Driver may manage pick, allocation, preparation and staging scopes;
- Driver may manage stop, route and shift scopes;
- Viewer has no operational write capability.

The private `ecoflow_day_state_commands` table is an immutable command-result ledger. A command ID cannot be reused for another date, scope, revision or payload.

## Device and concurrency behaviour

On the first successful poll, the server snapshot replaces any cached device state. Clearing browser storage therefore does not change the operational day; reloading reconstructs it from the database.

The serial sync session tracks the last merged revision for every scope. A device cannot silently overwrite a newer update:

1. device A reads revision 4;
2. device B commits revision 5;
3. device A submits expected revision 4;
4. the server returns `CONFLICT` with revision 5;
5. device A renders revision 5 and requires the operator to repeat the action only if it is still necessary.

Local edits that occur while a request is in flight are not replaced by the acknowledgement for the older edit. They are sent afterwards using the newly returned revision.

## Business Day Close

`ecoflow_close_business_day` creates a single idempotent close record and explicit carry-over records for unresolved work. It never deletes history or silently writes the next business day.

Carry-over can include:

- route plan;
- unresolved order release;
- unfinished driver stop;
- unfinished pick task;
- incomplete allocation;
- unresolved staging.

Delivered and failed orders are terminal and their release or staging scopes are excluded from carry-over.

Only active Owner/Admin users can close a business day. The command requires a reason, expected revision, next Adelaide business date and idempotency key.

## Permanent verification

The dedicated `Operational authority` workflow runs:

- a static authority-boundary audit;
- serial sync and cursor tests;
- TypeScript and production build;
- PostgreSQL 16 migration execution;
- direct-write denial, role boundary, idempotency, conflict and Business Day Close SQL contracts.

## Completion definition

Phase 9B is complete when:

- browser direct writes are impossible;
- the server owns per-scope revisions;
- all operational writes are idempotent CAS commands;
- first hydration replaces device cache;
- stale devices receive the newer server state;
- Business Day Close creates explicit non-terminal carry-over;
- permanent frontend and database gates pass;
- the production migration and frontend deployment succeed.
