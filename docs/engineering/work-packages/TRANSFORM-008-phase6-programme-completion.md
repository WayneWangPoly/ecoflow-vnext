# TRANSFORM-008 — Phase 6 programme completion gate

## Status

Implementation branch. This package is the final evidence/closure gate for Product Transformation Phase 6 (`Analytics and optimisation`). It is not a new transformation phase and does not authorize `TRANSFORM-009`.

## Why this closure package exists

TRANSFORM-008A, 008B and 008C established the analytics productivity truth boundary, governed comparison read model and authoritative export. Production verification then exposed the bounded storage issue repaired by TRANSFORM-008D.

Before declaring the Product Transformation programme complete, the final Phase 6 surface must be proven through the actual product navigation/export chain, not inferred from isolated component files or code-search results.

Closure archaeology produced two separate findings:

1. A shallow component search initially suggested that `PersonalisationProductivityPanel` was not mounted. Full export-chain verification corrected that interpretation: `healthConsole/index.ts` exposes `OperationalPulseReadinessWorkspace` as `AnalyticsHealthConsole`, and that workspace already renders `PersonalisationProductivityPanel` exactly once.
2. Browser evidence then found the real reachability defect. The production-default root enters `UnifiedOperationalRoutes` at `/control-room`; `OperationalAppShell` exposes Analytics as a governed link to `/analytics`; `/analytics` crosses into the still-legacy `App`; and with `overlay_navigation_v1` disabled by default, the legacy route adapter initialised the Dashboard tab rather than Analytics. The visible Analytics navigation therefore depended on an optional build-time flag to reach the approved Phase 6 workspace.

The bounded repair is intentionally limited to initialising an authorised `/analytics` legacy deep link as the existing Analytics tab. It does not enable overlay navigation globally, migrate other legacy workspaces, change role access, or alter Analytics data/command authority.

A work package is not complete merely because its source files and isolated gates exist. The approved capability must be reachable through the actual product navigation path and proven on the exact released source.

## Scope

1. Preserve the existing governed `OperationalAppShell` Analytics link at `/analytics`.
2. Repair only the overlay-disabled initial legacy-tab bridge so an authorised canonical Analytics route opens the existing Analytics workspace instead of Dashboard.
3. Preserve the existing Analytics export chain and assert that `OperationalPulseReadinessWorkspace` renders the governed `PersonalisationProductivityPanel` exactly once.
4. Preserve the existing Analytics role boundary; do not add a route or privilege.
5. Preserve all TRANSFORM-008A/B/C authority contracts without widening browser authority.
6. Add a permanent static closure audit that fails if the Phase 6 navigation bridge, surface, or authority contract regresses.
7. Add credential-free, mutation-free browser evidence for the real `/control-room` → Analytics navigation path at desktop and mobile widths.
8. Require post-main evidence against the exact main SHA and its successful Vercel Production deployment before Product Transformation is considered closed.

## Non-goals

- No forecasting model or forecast UI.
- No TRANSFORM-009.
- No global enablement of `overlay_navigation_v1`.
- No migration of unrelated legacy routes/workspaces.
- No new metric, analytics fact, database table, migration or RPC.
- No Ordermentum or QBO source write.
- No operational business-table write.
- No storage guard change or bypass.
- No role/privilege widening.
- No redesign of Saved Views, Quick Actions, Comparison Tray or Authoritative Export.

## Closure invariants

- Production root continues to enter the role-governed unified operational shell at `/control-room`.
- `OperationalAppShell` retains the role-filtered Analytics navigation item at `/analytics`.
- `routeContract.ts` remains authoritative for whether the authenticated role may access Analytics.
- With overlay navigation disabled, initial legacy state may select Analytics only when `resolveIntelligenceRoute(...)` returns an authorised Analytics route whose legacy tab is `analytics`; every other legacy initialisation retains the existing Dashboard default.
- `src/app/App.tsx` continues to render exported `AnalyticsHealthConsole` for the Analytics tab.
- `src/features/intelligence/analytics/index.ts` continues to expose the `healthConsole` barrel.
- `healthConsole/index.ts` continues to expose `OperationalPulseReadinessWorkspace` as the product-facing `AnalyticsHealthConsole`.
- `OperationalPulseReadinessWorkspace` renders `PersonalisationProductivityPanel` exactly once.
- The base `healthConsole/AnalyticsHealthConsole.tsx` must not duplicate the productivity surface.
- Saved Views remain server-backed by `get_intelligence_saved_views` / `apply_intelligence_saved_view_command`.
- Comparison candidates remain server-authorized by `ecoflow_read_comparison_candidates_v1`.
- Export remains a server re-read through `ecoflow_read_authoritative_export_v1`.
- The browser may not reintroduce arbitrary comparison IDs, browser-authored `ALLOWED` permission, localStorage/sessionStorage/IndexedDB persistence for the productivity surface, or XLSX-local export authority.
- Closure browser evidence performs no business mutation and makes no production Supabase data requests.
- Owner desktop, Viewer desktop and Owner mobile evidence must reach the Phase 6 surface by first entering the real operational shell and selecting its real Analytics link.

## Required PR gates

The exact PR head must pass:

1. TRANSFORM-008A truth audit.
2. TRANSFORM-008B governed comparison audit.
3. TRANSFORM-008C authoritative export audit.
4. `scripts/audit-transform-008-phase6-closure.mjs` against the real operational navigation bridge and export chain.
5. TypeScript and production Vite build with no requirement to enable `VITE_OVERLAY_NAVIGATION_V1`.
6. `TRANSFORM-008 Phase 6 closure` browser evidence on the exact PR head.
7. Required repository CI and `Supabase shadow gate (required)` on the exact PR head/test-merge as configured by the protected-main programme.
8. Diff review confirming the only product behaviour change is the bounded authorised Analytics initial-route repair, with no migration, source write, guard bypass, privilege widening or unrelated feature work.

## Required post-main evidence

After protected-main merge, the exact merged main SHA must have:

1. successful Vercel Production deployment;
2. a successful `TRANSFORM-008 Phase 6 closure` run against that exact main SHA;
3. evidence artifact containing:
   - Owner Analytics Phase 6 desktop screenshot;
   - Viewer Analytics Phase 6 desktop screenshot;
   - Owner Analytics Phase 6 mobile screenshot;
   - manifest proving real navigation reachability, server-read paths and zero business mutation;
4. no regression of the production Ordermentum Complete Mirror / storage guard evidence established by TRANSFORM-008D.

Only after those conditions are green may Product Transformation issue #250 be closed as programme-complete.

## Programme boundary after closure

The existing Product Transformation blueprint ends at Phase 6. Forecasting remains outside this closure package. Any follow-on forecasting/advanced optimisation or new product programme requires an explicit new approved work package/programme rather than being inferred as `TRANSFORM-009`.
