# ADR-0003: Server-authoritative business day

- Status: Accepted
- Date: 2026-07-27
- Owners: Chief Engineer, Domain, Platform/Data

## Context

Delivery runs, delayed POD, returns, and warehouse work can cross midnight.
Device clocks and timezones are not reliable authorities. South Australia also
observes daylight saving.

## Decision

The operational business day is derived by the server using
`Australia/Adelaide` and the approved operating-day cutoff. Store event
timestamps in UTC and store the authoritative business-day identifier
separately.

Clients may request or display a day, but may not create an authoritative day
from the device's local date. Cross-midnight runs retain their original run and
business-day identity; late events record their actual UTC timestamp.

## Alternatives considered

- UTC calendar date: rejected because it splits normal Adelaide operations.
- Device local date: rejected because devices can disagree or be incorrect.
- Reassign every event after midnight to the next day: rejected because it
  breaks run, POD, and return reconciliation.

## Consequences

Command handlers need a shared operational-day resolver. Tests must cover the
cutoff, daylight-saving transitions, delayed POD, and manual review of prior
days.

## Migration plan

1. Document and approve the cutoff.
2. Add a server resolver and contract tests.
3. Use it for new commands while preserving existing day identifiers.
4. Report ambiguous historical boundaries instead of silently rewriting them.
