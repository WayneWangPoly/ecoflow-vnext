# Agent Operating Model

EcoFlow is an operational warehouse and delivery system. Multi-agent delivery
is controlled software engineering, not several agents freely editing the same
application.

## Roles

| Role | Owns | Must not decide alone |
|---|---|---|
| Chief Engineer | architecture, contracts, task boundaries, merge order, release approval | broad feature implementation while acting as final verifier |
| Domain | state machines, invariants, command behaviour, commercial/physical SKU rules | UI design, RLS implementation, production deployment |
| Platform/Data | schema, migrations, RLS, RPC, idempotency, revisions, audit and retention | business semantics not already defined by a domain contract |
| Frontend | React features, interaction states, accessibility, responsive UI, frontend tests | schema, RLS, core state transitions, server authority |
| Verification | regression, concurrency, permissions, migrations, security, performance and UI smoke | declaring its own implementation correct |

The implementation agent and Verification agent must be different for critical
operational changes.

## Work allocation

Split work by domain responsibility, not by Owner, Warehouse, or Driver page.
Page-based allocation tends to duplicate the same business rule in three
places.

Each work package must state:

- objective;
- in-scope paths;
- out-of-scope paths;
- behaviour contract;
- acceptance criteria;
- required evidence;
- dependencies and merge order;
- rollback or compensating action.

One branch and one PR should address one logical theme. Agents may record an
adjacent problem, but may not expand scope to fix it.

## Interface-first sequence

For a cross-layer change, merge in this order:

1. domain contract;
2. database schema;
3. RLS, RPC, or server command;
4. typed repository client;
5. frontend;
6. integration tests;
7. end-to-end tests;
8. documentation;
9. release.

When layers cannot deploy together, use backward-compatible fields, capability
detection, or an explicit feature flag.

## Evidence standard

Every implementation handoff must include:

- files changed and why;
- behaviour before and after;
- commands run and full pass/fail status;
- migration and RLS evidence when relevant;
- screenshots for UI changes;
- concurrency, retry, and conflict evidence for operational writes;
- known limitations and deferred findings;
- rollback steps.

Build success alone is not verification. A UI that looks correct does not prove
that concurrent devices, retries, permissions, or offline recovery are safe.

## Definition of done

- [ ] The declared scope is complete and no out-of-scope files changed.
- [ ] TypeScript and production build pass.
- [ ] Relevant unit and integration tests pass.
- [ ] Migration and RLS checks pass when applicable.
- [ ] Loading, empty, degraded, unavailable, and conflict states are covered.
- [ ] Critical behaviour is enforced server-side.
- [ ] Actor, device, audit, error, and rollback needs are addressed.
- [ ] Documentation and ADRs match the implementation.
- [ ] Independent Verification approved the evidence.
- [ ] Chief Engineer approved the merge order and release.

## EcoFlow-specific freeze rules

Until an accepted ADR explicitly changes them:

- do not add new `ecoflow_day_state` scope types;
- do not add new DOM enhancers;
- do not equate an Ordermentum product with a physical stock item;
- do not mutate inventory without a movement;
- do not show critical offline actions as completed;
- do not introduce a second implementation of a state-transition rule.
