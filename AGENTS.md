# EcoFlow Agent Rules

These instructions apply to the entire repository. Read `README.md`,
`docs/ARCHITECTURE.md`, `docs/engineering/AGENT-OPERATING-MODEL.md`, and the
relevant ADRs before changing code.

## Non-negotiable rules

1. Do not change business behaviour without an approved, bounded work package.
2. Do not modify files outside the declared scope. Record adjacent findings as
   deferred work instead of fixing them opportunistically.
3. Do not claim completion without reproducible evidence.
4. Do not push to or merge into `main`; use
   `agent/<area>/<ticket>-<short-description>`.
5. Frontend validation guides the user. Server-side validation is the business
   authority for permissions, inventory, picking, route, POD, return, and
   financial transitions.

## EcoFlow architecture boundaries

- `ecoflow_day_state` is a transitional collaboration/read model. Do not add a
  new scope type without an accepted ADR and Chief Engineer approval.
- Do not create a new DOM enhancer, body observer, portal replacement, or CSS
  hide-and-replace workflow. New features belong in the normal React route and
  feature tree.
- A commercial Ordermentum SKU is not a physical warehouse SKU. Connect them
  through an explicit mapping, allocation, or substitution rule.
- Every inventory quantity change must produce an inventory movement through an
  approved server-side command. Never directly overwrite a balance from the
  browser.
- Critical operations require server acknowledgement. Offline UI must not show
  release, route lock, departure, stock adjustment, return acceptance, or
  stocktake finalisation as complete.
- Key operational commands must carry actor, device, idempotency, and revision
  information as defined by the applicable domain contract.

## Protected files and areas

Changes to the following require explicit Chief Engineer review:

- `src/app/App.tsx`
- `src/main.tsx`
- `src/app/usePickSync.ts`
- `src/data/repositories/pickSync.ts`
- `src/domain/driverRun.ts`
- shared domain types, auth, role mapping, routing, global CSS, and reducers
- `supabase/migrations/**`, `supabase/functions/**`, and deployment workflows

Never edit a migration that may already have been deployed. Add a forward
migration with a rollback or compensating plan.

## Required workflow

1. Start from a work package based on
   `docs/engineering/WORK-PACKAGE-TEMPLATE.md`.
2. Restate objective, in-scope files, out-of-scope areas, behaviour contract,
   acceptance criteria, and rollback before implementation.
3. Add or update tests before changing critical behaviour.
4. Make the smallest scoped change.
5. Review `git diff` for scope drift and unrelated formatting.
6. Run the relevant build, audit, unit, integration, RLS, migration, and UI
   checks.
7. Complete the PR template with evidence, risks, limitations, and rollback.
8. Obtain independent Verification and Chief Engineer approval.

If a required test cannot run, report the exact blocker. A skipped check is not
a passing check.

## Production safety

Never:

- commit credentials, provider tokens, raw customer exports, POD assets, or
  local Supabase link state;
- expose service-role keys to the browser or bypass RLS;
- operate directly on production data as part of feature development;
- use `any`, broad assertions, mocks, or swallowed errors to hide a broken
  operational contract;
- delete historical orders, ledger entries, POD records, or audit events
  without a separately approved retention plan;
- resolve a merge conflict by guessing another agent's intent.
