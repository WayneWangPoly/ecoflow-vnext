# ADR-0005: Deprecate DOM enhancers

- Status: Accepted
- Date: 2026-07-27
- Owners: Chief Engineer, Frontend

## Context

The enhancer layer locates rendered DOM anchors and injects React portals.
Existing enhancers delivered features quickly, but their contracts depend on
DOM structure, rendering timing, CSS overrides, and text. This weakens typing,
testing, accessibility, focus handling, and ownership.

## Decision

Do not add new DOM enhancers, body observers, or hide-and-replace workflows.
New features use explicit routes, components, feature slots, and typed
application state.

Existing enhancers may receive bounded maintenance fixes. Migrate them one
workspace at a time without changing business behaviour, then remove the
observer, portal replacement, and related CSS override.

## Alternatives considered

- Standardise more enhancer helpers and continue expansion: rejected because it
  reduces observer cost but not the implicit interface.
- Rewrite every workspace at once: rejected because regression risk is too
  high.
- Leave the architecture unchanged: rejected because each new workflow
  increases coupling and migration cost.

## Consequences

Some duplication remains during migration. Each native workspace needs loading,
empty, degraded, unavailable, and permission states before its enhancer can be
removed.

## Migration plan

Follow the order in `docs/operational-stability-roadmap.md`: Dashboard, Stores
and Price Matrix, Inventory, Warehouse Map, then Ordermentum Inbox and Exception
Control.
