# Work Package <ID>

## Objective

One bounded outcome.

## In scope

- files/components/domains that may change.

## Out of scope

- explicit adjacent areas that must not change.

## Authority

- authoritative facts and writers involved;
- server/client/AI boundaries.

## Behaviour contract

- state transitions;
- command semantics;
- failure semantics;
- permission semantics;
- offline/retry semantics.

## Acceptance

- observable required outcomes.

## Required evals/evidence

- Eval IDs;
- build/type/static checks;
- database/migration/RLS checks;
- preview/production/field checks as applicable.

## Rollback

- how to restore availability/state safely;
- whether data compensation is required.

## Risks / unknowns

Do not convert unknowns into implementation assumptions.

## Roles

Owner:
Builder:
Independent Reviewer:
Security Reviewer:
Eval/Verification:
Release/Operations:
