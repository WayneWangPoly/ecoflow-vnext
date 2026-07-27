# ADR-0004: Explicit offline command policy

- Status: Accepted
- Date: 2026-07-27
- Owners: Chief Engineer, Domain, Frontend, Platform/Data

## Context

Continuing locally during a network failure improves field usability, but it can
create a second business truth. A local success message is unsafe when another
device can change the same route, inventory, or order.

## Decision

Classify every operational action:

| Class | Examples | UI state |
|---|---|---|
| Offline queue allowed | scan observation, photo capture, GPS sample, non-critical note | Saved on device, then Queued, Accepted, or Rejected |
| Online acknowledgement required | release, route lock, departure, inventory adjustment, return acceptance, stocktake finalisation | Pending until the server accepts it |
| Read-only while offline | master data, pricing, mappings, permissions | Editing disabled with a clear reason |

Queued commands require stable idempotency keys and must not be shown as
accepted before server acknowledgement. Reconnect conflicts are explicit and
must not be resolved by silent last-write-wins.

## Alternatives considered

- Make the entire app online-only: rejected because scans and evidence capture
  need field resilience.
- Allow every action locally and merge later: rejected because critical facts
  can conflict.
- Show one generic "saved" state: rejected because it hides authority.

## Consequences

The UI needs distinct device, queue, accepted, and rejected states. The command
layer needs retry classification and conflict results. Product copy must not
imply completion too early.

## Migration plan

1. Inventory actions and assign a class.
2. Stop false-success states for critical actions.
3. Add durable idempotent queueing only to approved actions.
4. Add reconnect, duplicate, and conflict tests.
