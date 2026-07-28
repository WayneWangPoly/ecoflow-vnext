# Architecture Decision Records

ADRs preserve decisions that affect more than one work package.

## Status

Use `Proposed`, `Accepted`, `Superseded`, or `Deprecated`. Do not edit the
decision of an accepted ADR to reverse it; add a new ADR that supersedes it.

## Template

```markdown
# ADR-NNNN: Title

- Status:
- Date:
- Owners:

## Context

## Decision

## Alternatives considered

## Consequences

## Migration plan
```

## Current decisions

| ADR | Decision |
|---|---|
| [0001](0001-command-based-operational-writes.md) | Key writes move from client snapshots to revisioned, idempotent commands |
| [0002](0002-commercial-and-physical-sku-separation.md) | Commercial SKUs and physical stock items are separate entities |
| [0003](0003-business-day-timezone.md) | Server-authoritative operational day uses Australia/Adelaide |
| [0004](0004-offline-command-policy.md) | Offline actions have explicit queue, online-only, or read-only classes |
| [0005](0005-enhancer-deprecation.md) | No new DOM enhancers; migrate existing bridges into native composition |
| [0006](0006-day-state-cas-run-control.md) | Run-control decisions move to revisioned, idempotent CAS commands while change sequence remains a read cursor |
| [0007](0007-analytics-semantic-layer.md) | A read-only Postgres analytics schema governs facts, dimensions, metrics, freshness and history |
| [0008](0008-routed-workspace-overlay-navigation.md) | New workspaces use explicit routes, URL state and a bounded drawer/inspector/modal hierarchy |
