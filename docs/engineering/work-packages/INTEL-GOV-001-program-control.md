# INTEL-GOV-001: Intelligence and Control Room 2.0 programme control

- Status: In progress
- Owners: Chief Engineer, Domain, Platform/Data, Frontend, Verification
- Runtime change: none
- Branch: `agent/intel/INTEL-GOV-001-control-room-2-roadmap`

## Objective

Lock the architectural, product, interaction, evidence and merge standards for
the EcoFlow Intelligence & Control Room 2.0 programme before database or UI
implementation begins.

## Combined scope

The following items are deliberately combined because they are documentation
only, share one rollback boundary and must be reviewed together:

1. programme charter and complete execution-wave map;
2. analytics semantic-layer ADR;
3. routed workspace and bounded-overlay ADR;
4. current-state baseline and regression-evidence contract;
5. documentation index updates.

## In-scope paths

- `docs/engineering/ECOFLOW-INTELLIGENCE-CONTROL-ROOM-2.md`;
- `docs/engineering/work-packages/INTEL-GOV-001-program-control.md`;
- `docs/engineering/work-packages/INTEL-BASE-001-current-state-baseline.md`;
- `docs/adr/0007-analytics-semantic-layer.md`;
- `docs/adr/0008-routed-workspace-overlay-navigation.md`;
- ADR and repository documentation indexes.

## Out-of-scope paths

- `src/**`;
- `supabase/**`;
- `scripts/**` except a later separately approved documentation contract check;
- package dependencies;
- production workflows;
- feature flags;
- runtime analytics schema;
- visual components.

## Behaviour contract

After this package:

- all later work packages use the same semantic, grain, freshness, failure and
  historical-correction standards;
- all later UI work uses the same route, URL state, overlay-depth, modal and
  mobile behaviour standards;
- compatible work is grouped by authority and rollback boundary rather than by
  page;
- analytics remains read-only and additive;
- Control Room 2.0 cannot become default without baseline, reconciliation,
  permission, performance and workflow-regression evidence;
- deviations require an ADR or an explicit programme-plan amendment rather than
  a local implementation shortcut.

## Execution sequence after merge

### Release A — `INTEL-DATA-001`

Combine the additive analytics foundation:

- schema;
- metric registry;
- refresh status;
- quality status;
- initial dimensions;
- read grants and real-role tests;
- migration and static contracts.

Do not add final KPI dashboards in this release.

### Release B — `INTEL-DATA-002A/B/C`

Split fact creation by grain and reconciliation risk:

- A: order, order-line, fulfilment and substitution facts;
- B: inventory movement read model and daily snapshots;
- C: delivery stop, POD and return-inspection facts.

Merge A before Inventory UI. B may follow A or run in parallel after the shared
dimensions are stable. C follows the operational delivery/return source review.

### Release C — `INTEL-METRIC-001`

Combine initial governed metric projections, freshness envelope, typed
repository contracts and reconciliation tests. Keep the visible UI unchanged.

### Release D — `INTEL-FE-001`

Combine native frontend foundations behind flags:

- route shell;
- URL query state;
- overlay manager;
- context header primitive;
- design tokens and shared states;
- analytics query/repository boundary.

Do not migrate critical operational commands in this release.

### Release E — `INTEL-UI-001`

Build Control Room 2.0 from the approved metrics and frontend foundation:

- operational pulse;
- needs attention;
- exclusive flow;
- trend and cause;
- priority work;
- first-level drill and drawers;
- mobile transformation.

Run in shadow beside the existing dashboard.

### Release F — domain intelligence

Release in order:

1. Inventory and substitution;
2. Orders and fulfilment;
3. Customer and commercial;
4. Delivery;
5. Returns;
6. Data quality.

### Release G — governed actions and personalisation

Only after read correctness and route stability:

- safe command-backed action handoff;
- saved views;
- comparison tray;
- quick navigation;
- controlled export.

## Merge dependencies

```text
INTEL-GOV-001
  -> INTEL-DATA-001
       -> INTEL-DATA-002A/B/C
            -> INTEL-METRIC-001
                 -> INTEL-FE-001
                      -> INTEL-UI-001
                           -> domain intelligence
                                -> governed actions/personalisation
```

`INTEL-FE-001` may begin against approved mock TypeScript contracts after
`INTEL-DATA-001`, but it cannot merge metric-dependent production behaviour
before `INTEL-METRIC-001` is available and tested.

## Acceptance criteria

- [ ] Programme document contains architecture, data model, metrics, UI layers,
      work waves, flags, evidence and cutover gates.
- [ ] ADR-0007 defines semantic-layer ownership and no-write boundary.
- [ ] ADR-0008 defines route and overlay behaviour.
- [ ] Baseline package defines measurable before-state and regression matrix.
- [ ] Existing ADRs and operational safety rules are not contradicted.
- [ ] No runtime, schema, package or workflow file changes.
- [ ] Later work has an unambiguous merge order and rollback boundary.

## Required evidence

- changed-file list;
- documentation link validation;
- diff review confirming no runtime paths changed;
- confirmation that all future runtime packages cite the relevant ADR and
  programme section;
- known limitations: runtime measurements have not yet been captured in this
  documentation-only package.

## Rollback

Revert the documentation commits. No database or frontend rollback is required.
