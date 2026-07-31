# Phase 8 — Program Assurance & Completion

## Completion statement

Phase 8 converts the roadmap's final quality and completion standards into permanent engineering controls. It completes four assurance packages:

1. INTEL-ASSURE-001 — Final Completion Contract
2. INTEL-ASSURE-002 — Program Assurance Workspace
3. INTEL-ASSURE-003 — Performance Budget
4. INTEL-ASSURE-004 — Canonical Route Smoke

The phase covers the twelve final completion outcomes and six permanent quality pillars defined for EcoFlow Intelligence & Control Room 2.0.

Engineering completion and production cutover are separate states. Phase 8 may be engineering-complete while one or more Phase 7 feature flags remain `SHADOW` or `OFF`. No production evidence is fabricated to make implementation appear deployed.

## Twelve final completion outcomes

The permanent completion contract requires:

1. a decision-first Owner entry;
2. metric-to-cause-to-entity drill;
3. context preservation through filters, URL and Back/Forward;
4. consistent metric definitions across workspaces;
5. Commercial SKU and Physical SKU separation;
6. background analytics rather than browser Ordermentum calls;
7. no false zero or demo fallback;
8. a layered workspace, drawer, inspector, modal and task model;
9. safe insight-to-action handoff;
10. native React route and component ownership;
11. role-specific views over shared facts;
12. EcoFlow-owned operational intelligence rather than a generic BI clone.

Each outcome has an engineering state and a separate production dependency. The production dependency can be none, shadow evidence, or per-flag cutover.

## Six permanent quality pillars

The six permanent quality pillars are:

- Data Correctness;
- UI Interaction;
- Operational Safety;
- Performance;
- Accessibility;
- Release Control.

The Analytics assurance workspace displays each pillar with its requirement and governing evidence. It also reads Phase 7 rollout evidence to show whether production is unavailable, legacy-only, shadow, partially cut over or fully cut over.

## Performance budget

The production build is bounded by explicit bundle budgets:

- largest JavaScript asset: 750,000 bytes;
- total JavaScript assets: 1,600,000 bytes;
- largest CSS asset: 320,000 bytes;
- total CSS assets: 800,000 bytes;
- total production assets: 160;
- `index.html`: 6,000 bytes.

The budget is checked after the Vite production build. A future change that exceeds a budget fails CI rather than silently increasing the delivery footprint.

## Canonical route smoke

Nine canonical deep routes are served from the production preview:

- `/control-room`;
- `/orders`;
- `/inventory`;
- `/customers`;
- `/delivery`;
- `/returns`;
- `/exceptions`;
- `/analytics`;
- `/settings`.

The smoke check starts the built production preview, requests every route, requires HTTP 200 and verifies that the application root is served. This protects copied links and direct navigation from server-level route failure.

## Security and operational boundary

Phase 8 is an assurance and presentation layer. It does not:

- change feature flags;
- record release verification evidence;
- update orders;
- adjust inventory;
- modify customers;
- control routes or POD;
- dispose returns;
- change exception lifecycle.

The workspace reads the same governed release-readiness repository as Phase 7. An unavailable response remains unavailable; it is not interpreted as zero rollout, completed rollout or successful cutover.

## Permanent verification

The dedicated programme assurance workflow runs:

- the Phase 8 static assurance audit;
- programme assurance contract tests;
- TypeScript;
- the Vite production build;
- bundle budgets;
- nine canonical deep-route smoke checks.

The final Phase 8 gate also re-runs the preceding Intelligence completion gates so programme closure cannot pass while an earlier phase contract is missing.
