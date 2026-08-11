# File Ownership

This table defines engineering ownership. GitHub's `CODEOWNERS` file currently
routes protected reviews to the repository owner; these role assignments define
who may implement and who must review.

| Path or concern | Implementation owner | Required review |
|---|---|---|
| `src/domain/**` | Domain | Chief Engineer |
| `src/data/repositories/**` | Platform/Data | Domain for behaviour changes |
| `supabase/migrations/**` | Platform/Data | Chief Engineer + Verification |
| `supabase/functions/**` | Platform/Data | Chief Engineer + Verification |
| `src/features/**` | Frontend | Domain when operational behaviour changes |
| `src/app/App.tsx`, `src/main.tsx` | Chief Engineer-assigned agent | Chief Engineer |
| `src/domain/driverRun.ts` | Domain | Chief Engineer + Sync |
| `src/app/usePickSync.ts`, `src/data/repositories/pickSync.ts` | Sync | Chief Engineer + Verification |
| auth, role mapping, RLS | Platform/Security | Chief Engineer + Verification |
| routing shell, shared reducers, global CSS | Chief Engineer-assigned agent | Chief Engineer |
| `.github/workflows/**` | Platform/Release | Chief Engineer |
| `docs/adr/**` | Chief Engineer or delegated author | Chief Engineer |

## Collision rule

Only one active implementation work package may own a protected file at a time.
If two work packages need the same protected file, the Chief Engineer must
sequence them or define an explicit integration contract before either agent
edits it.

## Branch rule

Use:

```text
agent/<area>/<ticket>-<short-description>
```

Do not reuse a branch for unrelated work, include broad formatting changes, or
commit generated output and local configuration.

## Review enforcement

`CODEOWNERS` routes accountability, but native GitHub code-owner approval is
enforceable only when an eligible reviewer exists who is not the pull-request
author. The normal `main` policy is to require that native approval in addition
to the role reviews above.

The repository currently has one eligible maintainer. For only the
`TRANSFORM-007 Shadow Bootstrap` PR and operational-records PR `#274`, the
repository owner authorised a single-maintainer exception on 2026-08-11 and the
Chief Engineer must approve its exact scope. During both parts of that exception:

- required approval count and required code-owner approval remain disabled,
  because the author cannot supply a valid self-approval;
- independent Verification followed by Chief Engineer review is retained as
  exact-SHA evidence on the PR, but must not be represented as a native GitHub
  approval; and
- any head, workflow, migration or evidence change invalidates those reviews.

The enforcement order is deliberately split to avoid a bootstrap deadlock:

1. The bootstrap PR is protected by the existing CI, a head up to date with
   `main`, no bypass, independent exact-SHA Verification then Chief Engineer
   review, and separate explicit merge authorisation. It cannot require the new
   trusted shadow status because that workflow does not exist on `main` yet.
2. After the bootstrap is merged, and before `#274` can merge, add the exact
   trusted shadow status from its expected source to the `main` ruleset. For
   `#274` the ruleset must require the PR path, that status, a head up to date
   with `main`, and no bypass actor.

The exception grants no merge permission by itself and expires when `#274` is
merged or closed. Other protected work remains subject to the normal policy or
needs its own explicit disposition. Add native code-owner approval before the
next protected merge as soon as a distinct eligible maintainer exists.
