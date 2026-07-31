# Phase 5 — Action Integration

## Completion statement

Phase 5 is complete through two governed work packages:

1. `INTEL-ACT-001` Action Handoff
2. `INTEL-ACT-002` Safe Inline Actions

Analytics now provides five canonical context handoffs:

- Open order;
- Open inventory;
- Open customer;
- Open route;
- Open exception.

Every handoff transports bounded analysis context into the destination URL. It does not execute a business command. The destination operational domain remains authoritative for permissions, revision checks, idempotency and state transitions.

## Safe inline action boundary

Six critical command families are explicitly registered:

1. Exception lifecycle — **AVAILABLE**
2. Order release — **BLOCKED**
3. Inventory mutation — **BLOCKED**
4. Customer mutation — **BLOCKED**
5. Route control — **BLOCKED**
6. Return disposition — **BLOCKED**

Exception lifecycle is the only available family because the existing command path already provides:

- a server command;
- server lifecycle version and transition checks;
- a UUID command ID and replay handling;
- a server access envelope and per-row action capability;
- explicit accepted, conflict, rejected, replay and network-unknown outcomes.

No other action becomes inline merely because an Analytics button could be rendered. Non-migrated actions expose only the operational handoff.

## Gate 5 boundary

No component under Action Integration may directly update a business table. The Phase 5 gate rejects direct Supabase access, table access, RPC invocation, fetch-based command execution, or insert/update/upsert/delete logic inside the Analytics integration layer.

The existing Exception lifecycle modal remains the sole migrated inline command surface. It calls the typed lifecycle repository, uses an idempotent command ID, respects the server access envelope, and handles conflict without changing the underlying Ordermentum order.

## Completion gate

`INTEL-GATE-005` verifies:

- all five canonical action handoffs;
- bounded context serialisation and fail-closed identity validation;
- all six critical command families;
- exactly one available migrated inline family;
- the complete server command, revision, idempotency, permission and outcome contract;
- explicit blocking of the five non-migrated families;
- Analytics workspace adoption;
- responsive and reduced-motion presentation;
- no direct business-table write from Analytics;
- permanent execution through the existing frontend audit chain.
