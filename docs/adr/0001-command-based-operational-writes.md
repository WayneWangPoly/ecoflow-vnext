# ADR-0001: Command-based operational writes

- Status: Accepted
- Date: 2026-07-27
- Owners: Chief Engineer, Domain, Platform/Data

## Context

`ecoflow_day_state` currently accepts per-scope client snapshots with
last-write-wins upserts. That model cannot reliably protect inventory, pick
completion, release, route lock, POD, returns, or financial reconciliation
against stale pages, retries, and concurrent devices.

## Decision

Move key operational writes gradually to named server-side commands. A command
must validate the current state in one transaction and accept:

- an expected revision;
- an idempotency key;
- the authenticated actor;
- a device identifier;
- a correlation identifier where a workflow spans commands.

Accepted commands return the new revision. Revision mismatches return an
explicit conflict; validation and permission failures return typed rejection
codes. The server, not the browser, is authoritative.

`ecoflow_day_state` may remain temporarily as a collaboration read model while
commands are migrated. No new domain capability should default to a new scope.

## Alternatives considered

- Keep last-write-wins and improve merge heuristics: rejected because conflicts
  remain implicit and unrecoverable.
- Rewrite the whole application or introduce microservices: rejected as a
  high-risk migration with no immediate operational benefit.
- Full event sourcing: deferred; an append-only audit trail is sufficient for
  the current scale.

## Consequences

Commands and repositories need typed accepted, conflict, and rejected results.
Frontend conflict UI and server integration tests become mandatory. Migration
will temporarily support both legacy projections and command-backed facts.

## Migration plan

1. Prevent same-client request reordering and add consistency diagnostics.
2. Define command contracts for one workflow at a time.
3. Add compatible schema, revision, idempotency, and audit support.
4. Move the server write, then the typed client, then UI handling.
5. Verify concurrency and RLS before retiring the matching day-state write.
