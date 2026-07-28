# INTEL-BASE-001: Current-state baseline and regression evidence

- Status: Proposed
- Programme: EcoFlow Intelligence & Control Room 2.0
- Owners: Chief Engineer, Frontend, Platform/Data, Verification
- Depends on: `INTEL-GOV-001`, ADR-0007, ADR-0008
- Runtime change: none

## Objective

Create a reproducible before-state for the Intelligence & Control Room 2.0
programme. The baseline prevents visual redesign, metric consolidation or route
migration from silently losing operating capability, worsening data trust or
claiming unmeasured performance improvements.

This package records known code-level architecture and defines the runtime,
data, UI, accessibility and workflow measurements that every later release must
compare against.

## In scope

- current desktop navigation and dashboard composition;
- current data-read topology;
- current operational boundaries and protected workflows;
- existing loading, degraded and unavailable behaviour;
- current enhancer and custom-event migration debt relevant to the programme;
- measurement commands and evidence format;
- performance, request, payload, query and UI budgets;
- desktop and mobile screenshot matrix;
- critical workflow regression matrix;
- metric reconciliation baseline;
- feature-flag and rollback evidence requirements.

## Out of scope

- changing production UI;
- adding analytics tables or views;
- selecting a chart library;
- changing operational state transitions;
- modifying RLS, RPCs or migrations;
- inventing final KPI values before their metric contracts are approved;
- treating sample or synthetic data as production evidence.

## Known code-level baseline

### Application and deployment

- React 19, React Router 7, TypeScript 6 and Vite 8 form the frontend baseline.
- Supabase is the operational database and authentication boundary.
- Vercel deploys the frontend on pushes to `main`.
- Supabase migration deployment performs production-schema shadow verification
  before applying forward migrations.
- Database-compatible-first remains mandatory for cross-layer releases.

### Surface architecture

- Desktop office, Driver mobile, Warehouse mobile and Warehouse Map are distinct
  role-aware surfaces.
- The desktop currently uses a sidebar and local desktop-tab state for major
  sections.
- Owner/Admin open some additional workspaces through new browser windows.
- The codebase still contains a deprecated enhancer layer. New features cannot
  add new observers, portal replacement or CSS hide-and-replace behaviour.

### Dashboard composition

The current Dashboard already presents an operational-control orientation:

- open orders and exclusive operating stages;
- needs-decision and execution counts;
- live stock-location counts;
- incomplete POD indicators;
- needs-attention rows;
- priority work.

However, the page also loads several repositories in parallel and calculates
some stage, priority and summary values in React. It uses DOM button lookup and
a custom `ecoflow:open-work-item` event for portions of navigation and detail
opening. These are explicit migration targets, not patterns to extend.

### Data trust behaviour

- Production starts from empty structural data rather than demo operational
  records.
- When initial live data is unavailable, the Dashboard shows an unavailable
  state instead of sample figures.
- When a later refresh fails, trusted previously loaded records may remain
  visible with an error or degraded notice.
- Supporting-source failures are expected to be distinguishable from core
  current-lifecycle failures.

### Operational authority

- `ecoflow_day_state` remains a transitional collaboration/read projection.
- Critical writes are moving to revisioned, idempotent server commands.
- Analytics and new UI must not introduce a second state-transition rule or
  claim a browser projection is final business authority.
- Commercial SKU and physical stock item remain separate domain entities.
- Inventory quantities change only through approved movement contracts.

## Required baseline evidence bundle

Store generated evidence under an ignored local directory and attach the final
summaries/screenshots to the implementation PR. Do not commit production
credentials, raw provider payloads, customer-identifying exports or local token
cache.

### 1. Build and bundle

Record:

- Node and npm versions;
- clean `npm ci` result;
- TypeScript result;
- production build result;
- generated chunk names and sizes;
- total JavaScript, CSS and asset bytes;
- whether Driver and Warehouse Map remain lazy chunks;
- duplicate dependency warnings;
- production-data-boundary and repository-hygiene audits.

Commands:

```bash
node --version
npm --version
npm ci
npm run typecheck
npm run build
npm run audit:repository-hygiene
npm run audit:production-data-boundary
```

### 2. Runtime request topology

For the current Dashboard, record at first load and refresh:

- request count;
- endpoint/view/RPC names without credentials or sensitive payloads;
- transferred bytes;
- slowest request;
- duplicate requests;
- aborted requests;
- request ordering;
- behaviour when one supporting request fails;
- behaviour when the core snapshot request fails.

The baseline must identify which metrics are:

- returned by the server;
- calculated in a typed repository;
- calculated in the React page;
- derived from current operational state rather than historical facts.

### 3. Database query baseline

For each current dashboard repository or projection, record where available:

- exact view/RPC;
- returned row count;
- query latency from a production-like connection;
- payload size;
- required indexes;
- full scan or fan-out risks;
- role visibility;
- failure semantics.

No production `EXPLAIN ANALYZE` is run if it could create material load. Use a
shadow or representative database for expensive plans.

### 4. UI screenshot matrix

Capture the current application at:

- 1440 × 900 Owner desktop;
- 1280 × 800 Owner desktop;
- 1024 × 768 compact desktop/tablet;
- 390 × 844 narrow/mobile rendering where supported;
- Account role dashboard;
- Viewer role dashboard;
- initial loading;
- ready with live records;
- empty live data;
- degraded supporting source;
- unavailable core source;
- long customer/store/order labels;
- high counts and currency values;
- keyboard focus visible.

Screenshots must show the browser viewport and identify the branch/commit used.
Do not use synthetic records as evidence of production-data correctness; a
separately labelled local fixture is acceptable for layout edge cases.

### 5. Interaction baseline

Record:

- number of interactions from Dashboard to one affected order;
- number of interactions from Dashboard to Inventory;
- Back/Forward behaviour after opening work detail;
- reload behaviour on a selected section;
- ability to copy a link to the current tab/filter/detail;
- whether scroll and filters survive detail inspection;
- current new-window behaviour for Warehouse Map, Warehouse Operations and
  Driver Operations;
- custom events or DOM text lookup required for navigation.

### 6. Accessibility baseline

Record:

- tab order;
- visible focus;
- landmark and heading structure;
- control names;
- status information not conveyed by colour alone;
- contrast exceptions;
- keyboard operation of navigation and current detail surfaces;
- reduced-motion behaviour;
- screen-reader announcement of loading, degraded and unavailable states;
- touch target issues at narrow widths.

### 7. Critical workflow regression matrix

Later UI and analytics releases must not break:

- authentication and profile recovery;
- Owner/Admin workspace access;
- Account and Viewer restricted navigation;
- Ordermentum inbox and source-health visibility;
- order internalisation and release controls;
- run selection and route lock/unlock command migration boundaries;
- warehouse bulk pick and barcode controls;
- initial stocktake and inventory movement authority;
- Warehouse Map route access;
- Driver departure, route and POD;
- return-zone and warehouse inspection permissions;
- delivery notification and statement boundaries;
- settings, sync job and team access controls.

A read-only analytical release does not need to reimplement these flows, but its
shell, routes, CSS, overlays and dependencies must not prevent them from
operating.

## Performance budgets

The final numeric baseline is measured before runtime implementation. Until then,
the following programme budgets apply:

### Control Room initial load

- no external Ordermentum browser requests;
- no unbounded fact-table read;
- no duplicate request for the same query key during one render epoch;
- server pagination for large entity lists;
- critical operational summary available before secondary analytical panels;
- a failed secondary panel must not erase trusted core state.

### Payload

- summary endpoints return aggregates and bounded priority rows, not complete raw
  order, inventory, POD or return histories;
- drawer detail is loaded on demand;
- chart series are bounded or downsampled server-side;
- large table exports are separate governed jobs, not browser initial-load data.

### Rendering

- table virtualisation or bounded pagination is required where measured row
  counts cause visible main-thread delay;
- opening and closing a drawer must not remount the entire workspace;
- cross-filtering must cancel or supersede stale queries;
- motion respects reduced-motion preference.

Numeric latency, bundle and interaction budgets are added to this file by a
follow-up commit only after the baseline evidence is captured. The values must
be measured, not guessed.

## Metric reconciliation baseline

Before a new metric can be shown as authoritative, create a reconciliation case
covering:

- approved formula and grain;
- source view/table;
- date basis and Adelaide business-day handling;
- included and excluded statuses;
- treatment of cancellation, partial fulfilment, substitution and return;
- treatment of missing cost or quantity;
- one normal case;
- one empty case;
- one data-quality failure;
- one historical correction case where relevant;
- difference against the current operational count or finance reference;
- explanation of every difference.

The current UI count is not automatically treated as correct. It is a comparison
point whose semantics must be documented.

## Feature-flag evidence

For each new presentation flag, verify:

- default state;
- authorised roles;
- old and new routes remain reachable during shadow mode;
- refresh and copied-link behaviour;
- flag disable restores the old presentation without reverting additive schema;
- no hidden write path changes when only the read UI is switched;
- analytics tables and views may remain after UI rollback.

## Acceptance criteria

- [ ] Known architecture and migration debt are documented accurately.
- [ ] Runtime measurements are reproducible and attached before Wave 1 runtime
      changes are judged against performance claims.
- [ ] Current critical workflows have an explicit regression matrix.
- [ ] Screenshot and accessibility matrices cover ready and failure states.
- [ ] Current page-calculated and server-calculated metrics are distinguished.
- [ ] No production secrets, raw provider payloads or customer exports are
      committed as baseline evidence.
- [ ] Numeric performance budgets are based on captured evidence.
- [ ] Verification signs off the baseline before Control Room 2.0 becomes the
      default.

## Required evidence

- baseline command output summaries;
- network/request summary;
- database projection summary;
- screenshot matrix;
- accessibility notes;
- metric-source map;
- critical workflow smoke result;
- known limitations;
- commit and environment identifiers.

## Rollback

This package is documentation only. Revert the documentation commit if the
baseline contract is rejected. Runtime work must not depend on unaccepted
requirements without an updated ADR or work-package approval.
