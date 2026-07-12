# EcoFlow Ordermentum Release Gate V2

This patch adds the operational release gate after Ordermentum data readiness:

- data complete is not enough to release to warehouse;
- orders must also pass SKU mapping and stock checks;
- only `READY_TO_RELEASE` rows should later create internal EcoFlow orders.

## Files

- `supabase/migrations/20260629_ordermentum_release_gate_v2.sql`
- `scripts/audit-ordermentum-release-gate.mjs`
- `src/data/repositories/supabaseOrdermentumViews.ts`
- `src/domain/types.ts`
- `src/app/App.tsx`
- `src/styles.css`
- `package.json`

## Apply

Run the SQL migration in Supabase SQL Editor first, then copy patch files into the project.

After deployment, the Ordermentum page will show release gate buckets:

- ready to internalise
- mapping blocked
- stock blocked
- payment review
- data blocked

## Audit

```powershell
npm run audit:release-gate
```

This prints release gate summary, top SKU mapping candidates, and blocked/review orders.
