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

CODEOWNERS enforcement also requires branch protection to require code-owner
review on `main`.
