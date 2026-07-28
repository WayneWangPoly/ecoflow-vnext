# ADR-0006: Use revisioned commands for cross-device operational writes

- Status: Accepted
- Date: 2026-07-28
- Owners: Chief Engineer, Sync / Database, Warehouse Operations

## Context

EcoFlow currently synchronises parts of the operational day through
`ecoflow_day_state`. The table remains a transitional collaborative read model
for release, Pick, staging, route and delivery state. SYNC-001 serialises work
inside one browser session. SYNC-002 adds a server-owned `change_seq` so clients
can read changes without missing timestamp ties or paginated rows.

Neither control solves business conflicts between devices. A monotonic read
sequence says which database change became visible first; it does not prove that
a command was based on the latest business state, prevent a repeated command,
or decide whether two valid-looking actions may both occur.

Last-write-wins is not acceptable for inventory movements, route locking, run
control, release, Pick completion, POD completion, return processing or other
operational decisions with physical consequences.

## Decision

Introduce a command-based write model with aggregate revisions, compare-and-swap
validation and durable idempotency. New cross-device business writes must not be
implemented as generic day-state upserts.

The intended flow is:

```text
UI intent
  -> typed application command
  -> authenticated application service / RPC
  -> database transaction
  -> domain aggregate + event / ledger write
  -> read-model projection
  -> UI refresh through change_seq or a domain query
```

`change_seq` remains a transport cursor only. It must not be named, documented or
used as a business revision, CAS token, idempotency key, command sequence or
cross-device conflict-resolution mechanism.

## Command envelope

Every operational command that can be retried or issued by more than one device
must carry:

- `command_id` or `idempotency_key`: globally unique and stable across retries;
- `aggregate_id`: the business object being changed;
- `expected_revision`: the revision observed when the user made the decision;
- `device_id`: stable installation or managed-device identifier;
- command payload containing only the requested business action;
- authenticated user identity derived by the server, never trusted from a
  browser-supplied actor name;
- business-day and run identifiers where those are part of the aggregate
  boundary.

The server records the accepted result against the idempotency key. Repeating an
identical command returns the original result. Reusing the same key with a
different payload is rejected.

## Transaction protocol

A command handler executes one database transaction and must:

1. authenticate the caller and enforce the applicable application role;
2. check the idempotency record before performing work;
3. lock the aggregate row or equivalent control row;
4. compare `expected_revision` with the current revision;
5. reject a mismatch as a structured conflict without overwriting newer work;
6. validate the state transition and operational invariants;
7. append the domain event, inventory movement or audit record;
8. update the aggregate and increment its revision exactly once;
9. store the durable command result under the idempotency key;
10. return the accepted revision and relevant event or ledger identifiers.

A conflict response must identify the aggregate, expected revision, current
revision and a safe refresh action. It must not silently merge physical or
financial facts.

## Aggregate boundaries

Initial implementation work packages should use explicit aggregates instead of
one universal day-state revision:

- inventory balance / stock movement;
- Pick task and allocation;
- order release;
- route and run control;
- delivery stop and POD;
- return receipt and inspection.

Run control requires a dedicated aggregate for the business day and active run.
Starting, locking, unlocking, completing or switching a run must use the run
control revision. A revision on one store, POD or Pick task must not serialize
unrelated work across the entire warehouse day.

## Read models

`ecoflow_day_state` may continue as a transitional projection while command
work is implemented. It is not the authority for business transitions once a
domain aggregate has moved to the command model.

Read-model updates may be synchronous in the command transaction or projected
from an append-only event. Consumers may use `change_seq` to retrieve the
projection efficiently. Projection order and business concurrency remain
separate concepts.

## Offline behaviour

Offline capability is command-specific:

- safe capture actions may be queued locally with their original idempotency key,
  expected revision and device ID;
- route lock, active-run changes, inventory adjustment and other exclusive
  decisions require an online server acceptance before the UI reports success;
- queued commands display `saved locally` or `pending`, never `completed`;
- reconnect conflicts require operator review or an explicit replacement
  command; the client must not automatically overwrite the server state.

POD photos may be captured offline, but delivery completion becomes authoritative
only after the command and required assets are accepted.

## Required implementation controls

Each implementation PR must include:

- a forward-only migration;
- database contracts for success, duplicate retry, changed-payload reuse,
  stale revision, unauthorized role and concurrent execution;
- stable error codes and a typed client response;
- an audit record containing command ID, aggregate ID, prior and accepted
  revisions, actor and device;
- explicit rollback or compensating-command guidance;
- confirmation that generic `ecoflow_day_state` writes are no longer the
  authority for that migrated transition.

Critical command functions must revoke default `PUBLIC` execution and grant only
the intended authenticated or service role.

## Rollout sequence

1. Add shared command-result and aggregate-revision primitives.
2. Implement run control CAS before moving route lock and active-run changes.
3. Move inventory adjustments and warehouse movements to revisioned commands.
4. Move Pick task claim, scan and completion transitions.
5. Move delivery stop and POD completion.
6. Move return receipt and inspection commands.
7. Remove authoritative generic day-state writes for migrated transitions.
8. Retain `change_seq` for read transport and projection catch-up.

Each stage must be deployable independently and preserve a rolling deployment
window for older clients without allowing those clients to bypass the new
command boundary.

## Alternatives considered

- Use `change_seq` as the revision: rejected because it sequences table changes,
  not one aggregate's business state, and cannot express the revision the user
  observed.
- Continue last-write-wins with more polling: rejected because faster reads do
  not prevent conflicting writes.
- Add one revision to the entire business day: rejected because unrelated work
  would conflict and operational throughput would collapse.
- Use client timestamps or device counters: rejected because clients do not own
  the authoritative ordering or identity boundary.
- Adopt full event sourcing for every domain immediately: rejected because the
  migration scope and operational risk are too large. Append-only events are
  required where valuable, but aggregates may use transactional current-state
  tables during the staged migration.

## Consequences

Write paths become more explicit and require additional tables, typed commands,
conflict UI and database tests. Some temporary dual-read projection code will
exist during migration.

The benefit is that retries become safe, stale decisions become visible, audit
records match physical operations, and cross-device conflicts stop being hidden
by last-write-wins state replacement.
