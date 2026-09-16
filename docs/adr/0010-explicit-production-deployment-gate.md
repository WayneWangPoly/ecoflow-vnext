# ADR-0010: Separate protected-main merge from production Supabase deployment

- Status: Accepted
- Date: 2026-09-16
- Owners: Chief Engineer / Platform-Data

## Context

EcoFlow historically used one GitHub Actions workflow for both migration safety
verification and production deployment. A push to protected `main` that touched
`supabase/migrations/**` automatically shadow-verified pending migrations and,
on success, immediately applied them to the production Supabase project and
redeployed Edge Functions.

That coupling prevents governance from authorizing a code/migration merge while
withholding production database authority. It also makes a merge authorization
implicitly authorize a second, materially different action.

## Decision

Protected-main merge and production Supabase deployment are separate authority
gates.

A matching push to `main` remains responsible for production-schema shadow
verification. It may read production migration metadata/schema for that gate,
but it must not apply migrations or deploy Edge Functions.

Production deployment is reachable only through an explicit
`workflow_dispatch` on the current protected `main` exact SHA. The dispatch must
supply the expected SHA and the frozen confirmation token
`DEPLOY_SUPABASE_PRODUCTION`; a no-secret preflight refreshes `origin/main` and
fails closed if the branch, SHA, current head, or confirmation differs.

The existing `Supabase migrations` protected status remains the migration safety
status. On a push it means shadow verification passed and production deployment
was intentionally deferred. On an authorized manual dispatch it additionally
means the production deployment completed.

`Release sync` must preserve the same distinction: push-triggered shadow-only
runs report that production is unchanged, while successful manual deployments
perform the frontend/database skew check.

## Alternatives considered

1. Keep automatic deployment on every migration merge. Rejected because merge
   authority would continue to imply production mutation authority.
2. Stage reviewed migrations outside `supabase/migrations/**` until deployment.
   Rejected because it weakens normal migration-history/tooling semantics and
   turns deployment into a file-move convention.
3. Depend only on GitHub Environment manual approval. Rejected as the sole
   control because repository semantics would still describe merge as a
   deployment trigger and exact-head authority would be implicit rather than
   durable in the workflow contract.

## Consequences

- Migration-bearing PRs can be merged without production database mutation.
- Pending migrations can exist on `main`; operators must not interpret repository
  presence as proof of production application.
- Production deployment becomes an explicit operational action with exact-head
  authorization and auditable inputs.
- The shadow gate still detects migration incompatibility against a copy of the
  current production schema before either merge completion status or manual
  deployment can be considered healthy.
- Release documentation and incident procedures must distinguish shadow-gate
  success from production-deployment success.

## Migration plan

1. Land the R2G control-plane change without production mutation.
2. Confirm its post-merge push executes shadow verification and skips the deploy
   job.
3. Resume migration-bearing merges under the new split authority model.
4. Dispatch production deployment only after a separately authorized exact
   protected-main SHA is named.
