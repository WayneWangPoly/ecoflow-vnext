# EcoFlow Intelligence & Control Room 2.0

- Programme ID: `INTEL-2`
- Status: Proposed execution baseline
- Product owner: Owner
- Engineering owners: Chief Engineer, Domain, Platform/Data, Frontend, Verification
- Target: native, analytics-aware operational control room without embedding Power BI or Tableau

## 1. Programme objective

EcoFlow remains an operational warehouse and delivery system. This programme
adds a trusted business-analysis layer and replaces flat dashboard composition
with a routed, multi-layer workspace that moves from summary to cause, entity,
evidence and safe operational action.

The finished product must answer five questions without forcing the user to
manually reconcile multiple screens:

1. What requires attention now?
2. What business impact does it have?
3. Why did it happen?
4. Which orders, customers, commercial SKUs, physical SKUs, locations, runs or
   returns are affected?
5. What is the safe next action and which operational workflow owns it?

This is not a chart-wall project. Charts, tables, drawers and metrics are useful
only when they shorten a real decision or operating workflow.

## 2. Non-negotiable product rules

1. No browser page calls Ordermentum directly for analysis. Ordermentum is an
   ingestion source; EcoFlow analyses server-held data.
2. Reused business metrics are defined once in the analytics contract. React
   pages do not independently calculate competing versions of revenue, fill
   rate, margin, stock cover or on-time delivery.
3. Commercial SKU demand and physical SKU fulfilment remain separate entities.
4. Analytics is read-only. It does not bypass RLS, command, revision,
   idempotency, audit or workflow gates.
5. Missing, stale or failed data is never converted silently to zero.
6. Every analytical response identifies its grain, `as_of` time, freshness,
   source health, metric version and quality state.
7. New UI belongs to native React routes and typed repositories. No new DOM
   observer, portal replacement, CSS hide-and-replace or text-matching
   navigation is permitted.
8. Workspace filters, sort, comparison, selected entity, drawer and saved-view
   state are URL-addressable.
9. Detail viewing uses a bounded overlay stack. Commit actions use explicit
   modals or full-screen task workflows.
10. Critical actions are not shown as complete before server acknowledgement.
11. Feature flags and backward-compatible database changes are required for
   incremental release.
12. Existing Owner, Account, Warehouse and Driver workflows must continue to
   operate while the new read and presentation layers are introduced.

## 3. What is adopted from professional BI products

EcoFlow adopts:

- semantic metrics and stable grains;
- dimensions and facts;
- drill paths;
- cross-filtering;
- details on demand;
- saved views;
- comparison periods;
- data freshness and source-health indicators;
- role-specific presentation over shared facts;
- insight-to-action handoff.

EcoFlow rejects:

- embedded external BI as the primary application;
- drag-and-drop report authoring;
- arbitrary SQL or user-defined metric formulas;
- decorative dashboards and excessive chart variety;
- direct writes from analytical visuals;
- iframe-driven operating workflows;
- joins and metric definitions implemented independently in each page;
- every interaction causing a fresh external-provider request.

## 4. Target architecture

```text
External sources and operational events
  Ordermentum / receiving / stock movements / picking / route / POD / returns
                              |
                              v
Source and raw integration
  payload versions / sync batches / import errors / source health
                              |
                              v
Operational core
  orders / commercial SKUs / physical SKUs / stock ledger / pick / run / POD
  server authority / RLS / commands / revisions / idempotency / audit
                              |
                              v
Analytics semantic layer (`analytics` schema)
  dimensions / facts / metric registry / snapshots / quality / freshness
  security-invoker views / read-only RPCs / bounded aggregates
                              |
                              v
EcoFlow presentation
  Control Room / Orders / Inventory / Customers / Delivery / Returns / Quality
  charts / tables / drawers / inspectors / task handoff
```

No separate analytics microservice is introduced in this programme baseline.
Postgres/Supabase is the initial semantic and aggregation boundary. A separate
service requires a later ADR supported by measured database or workload limits.

## 5. Data model baseline

### 5.1 Dimensions

The target model includes, at minimum:

- `dim_date`;
- `dim_customer`;
- `dim_store`;
- `dim_commercial_sku`;
- `dim_physical_sku`;
- `dim_supplier`;
- `dim_brand`;
- `dim_warehouse_location`;
- `dim_driver`;
- `dim_route`;
- `dim_order_source`;
- `dim_exception_type`.

Dimensions that affect historical financial or operational interpretation must
carry effective dating or another approved history mechanism. A later cost or
mapping edit must not silently rewrite the meaning of past fulfilment.

### 5.2 Facts and required grains

- `fact_order_line`: one commercial demand line in one order.
- `fact_fulfilment_line`: one physical SKU used to fulfil part or all of one
  order line.
- `fact_inventory_movement`: one auditable stock movement event.
- `fact_daily_inventory_snapshot`: one business day, physical SKU and location.
- `fact_delivery_stop`: one stop in one delivery run.
- `fact_return_inspection`: one inspected return item or condition line.

A fact view or table must declare its exact grain. A query that mixes facts of
different grains must aggregate each side to a compatible grain before joining.

### 5.3 Commercial and physical SKU analysis

The model must retain, separately:

- ordered commercial SKU;
- fulfilled physical SKU;
- ordered quantity;
- fulfilled quantity;
- selling price;
- actual unit cost at fulfilment;
- substitution flag;
- substitution reason;
- approved-equivalence context where available;
- actor, location and timestamp.

This enables substitution rate, brand mix, stock coverage, margin impact,
supplier reliance and customer impact without pretending the ordered and
physically dispatched products are the same record.

## 6. Metric registry

The programme introduces a governed metric registry. Every reusable metric must
state:

- key and display name;
- business definition;
- formula or projection source;
- grain;
- allowed dimensions;
- exclusions;
- date basis;
- freshness expectation;
- data owner;
- metric version;
- active, deprecated or replacement status.

Initial metric families:

### Owner

Revenue, gross margin, open orders, due today, at risk, fill rate, on-time
delivery, stockout risk, dead-stock value, customer concentration, supplier
concentration and data freshness.

### Warehouse

Lines picked, lines per hour, first-pass scan accuracy, short-pick rate,
substitution rate, putaway age, unallocated orders, inventory-adjustment value,
return-processing time and location utilisation.

### Product and purchasing

Demand velocity, days of cover, reorder risk, supplier lead-time reliability,
commercial-SKU coverage, physical-SKU substitution frequency, margin by
fulfilment brand, slow-moving stock and stockout frequency.

### Customer

Revenue, gross margin, order frequency, average order value, fill rate,
substitution rate, delivery-failure rate, days since last order, product mix and
payment exposure.

### Delivery

Stops completed, on-time delivery, average stop duration, route completion time,
failed delivery, POD completion, return frequency and distance per stop.

## 7. Presentation architecture

### 7.1 Routed workspaces

Target route families:

```text
/control-room
/orders
/orders/:orderId
/inventory
/inventory/commercial/:skuId
/inventory/physical/:itemId
/customers
/customers/:customerId
/stores/:storeId
/delivery
/delivery/runs/:runCode
/returns
/exceptions
/analytics
/settings
```

A route can open a bounded drawer or inspector through URL state. Browser back
closes the latest layer before leaving the workspace.

### 7.2 Layer model

- Layer 0: workspace canvas.
- Layer 1: sticky context header with business day, freshness, source state,
  filters, comparison and saved view.
- Layer 2: primary detail drawer.
- Layer 3: secondary related-entity inspector.
- Layer 4: commit modal for confirmation, reason or irreversible action.
- Layer 5: full-screen task mode for stocktake, receiving, bulk pick, route
  planning, return inspection and business-day close.

Only two information overlays may be open at once. A third relationship either
replaces the secondary inspector or navigates to a full route. Ordinary details
must not use a commit modal.

### 7.3 Drawer baseline

Entity drawers may expose appropriate subsets of:

- Overview;
- Timeline;
- Items;
- Inventory;
- Financial;
- Delivery;
- Exceptions;
- Audit.

Drawers must be URL-addressable, keyboard operable, focus-contained, closable by
Back and Escape, and converted to a full-screen sheet on narrow viewports.

### 7.4 Control Room 2.0 composition

The first screen is organised in this order:

1. business-day and source context;
2. operational pulse, limited to the most decision-relevant metrics;
3. needs-attention queue;
4. mutually exclusive operational flow;
5. trend and causal breakdown;
6. priority work;
7. drill into entity detail and safe workflow handoff.

The dashboard must not rank recency above business impact. Priority includes
severity, age, affected value or quantity, SLA, ownership and blocking effect.

## 8. UI and interaction standards

### 8.1 Visual system

Use a restrained industrial system with consistent spacing, radius, elevation,
surface, border, typography, status colour, density, motion and focus tokens.
Status is never expressed by colour alone.

Avoid excessive hero height, floating-card repetition, large decorative
gradients, over-rounding, three-dimensional charts and animation that delays
work.

### 8.2 Data table

The shared table system must support, as needed:

- sticky headers;
- pinned columns;
- resizing;
- compact and comfortable density;
- server pagination;
- sorting and multi-filtering;
- URL state;
- saved columns;
- row selection and governed bulk actions;
- expandable detail;
- keyboard navigation;
- loading, empty, degraded and unavailable states.

### 8.3 Charts

Prefer line, bar, stacked bar, heatmap, sparkline, scatter, distribution,
timeline, map and commercial-to-physical substitution matrix views.

Every chart declares metric, date range, comparison, freshness, accessible text
summary, empty/degraded state and drill action. Pie, donut, gauge and funnel
views require a written reason and must not hide comparison or denominator.

### 8.4 State model

Every panel and repository contract handles:

- loading;
- ready;
- empty;
- degraded with retained trusted data;
- unavailable;
- stale;
- unauthorised where relevant.

Operational actions additionally handle pending, accepted, rejected, conflict,
idempotent replay, network-unknown and protocol-upgrade states where the domain
command contract defines them.

## 9. Combined execution waves

Work is combined only when the files, authority and rollback boundary are the
same. Runtime database, frontend foundation and domain workflows are not mixed
into one uncontrolled PR.

### Wave 0 — standards and baseline

One documentation-only PR:

- `INTEL-GOV-001`: programme charter, dependency and release gates;
- ADR for analytics semantic boundary;
- ADR for routed workspace and overlay navigation;
- `INTEL-BASE-001`: baseline measurement and regression evidence contract;
- ADR index and repository documentation links.

### Wave 1 — additive analytics foundation

One database-first foundation PR may combine:

- analytics schema;
- metric registry;
- refresh and quality contracts;
- initial dimensions;
- grants, RLS/security-invoker rules;
- typed database contracts and migration tests.

It must not yet claim complete business KPIs or change the visible dashboard.

### Wave 2 — analytics facts and projections

Split by transactional risk and grain, not by page:

1. order and fulfilment facts, including substitution;
2. inventory movements and daily snapshots;
3. delivery-stop and return-inspection facts;
4. initial KPI projections and reconciliation tests.

Facts may be combined in one release only when production-schema shadow tests,
data-volume tests and independent verification all pass.

### Wave 3 — native frontend foundation

One feature-flagged frontend foundation PR may combine:

- routed desktop shell;
- URL query-state contract;
- overlay manager;
- design tokens and shared primitives;
- analytics typed repository;
- loading, empty, degraded and unavailable primitives.

It must preserve existing operational screens and must not introduce a second
implementation of operational state transitions.

### Wave 4 — Control Room 2.0

One focused feature PR may combine:

- context header;
- operational pulse;
- needs-attention queue;
- exclusive flow;
- trend and causal panels;
- priority work;
- cross-filter and first-level drill;
- entity drawer handoff.

It remains behind `control_room_v2` until shadow comparison passes.

### Wave 5 — domain intelligence

Release in this order unless measured business priority changes it:

1. Inventory and substitution;
2. Orders and fulfilment;
3. Customer and commercial;
4. Delivery;
5. Returns;
6. Data quality and source health.

Each domain includes overview, filters, trend, breakdown, table, drawer,
timeline, freshness, quality states and operational handoff.

### Wave 6 — governed action integration

Analysis is initially read-only. Inline actions appear only after the owning
server command, revision, idempotency, permission and audit contract is proven.

### Wave 7 — personalisation and exports

Saved views, comparison tray, role defaults, quick navigation and controlled
exports arrive after metric and route stability.

## 10. Merge order

Cross-layer work follows:

1. domain contract;
2. additive database migration;
3. access/read contract;
4. typed repository;
5. shared frontend foundation;
6. feature UI;
7. integration and migration tests;
8. UI smoke and accessibility evidence;
9. documentation;
10. feature-flag activation.

Database-compatible first, frontend second. Deployed migrations are never
edited; rollback uses feature flags and forward compensation.

## 11. Feature flags

Initial flags:

- `control_room_v2`;
- `analytics_inventory_v1`;
- `analytics_customer_v1`;
- `analytics_delivery_v1`;
- `overlay_navigation_v1`.

Flags control presentation and activation, not database truth. Database
additions remain backwards compatible with the current frontend.

## 12. Evidence and quality gates

Every implementation PR must include:

- declared scope and excluded paths;
- before/after behaviour;
- changed files and purpose;
- TypeScript and production build evidence;
- migration shadow and SQL contract evidence when relevant;
- real-role permission evidence;
- metric reconciliation evidence;
- performance and payload evidence;
- loading, empty, degraded, unavailable and stale evidence;
- screenshots at desktop and mobile widths for UI changes;
- keyboard and focus evidence for overlays;
- rollback or forward-compensation steps;
- known limitations and deferred findings;
- independent Verification approval for critical changes.

## 13. Cutover gates

Control Room 2.0 becomes the default only when:

- metric definitions are approved;
- analytics and current operational totals reconcile or all differences are
  explicitly explained;
- no metric silently converts source failure to zero;
- no sample or demo operational facts appear in production;
- role and field-level data access passes;
- performance remains within the baseline budgets;
- Back, Forward, copied URLs and overlay recovery pass;
- desktop and mobile smoke tests pass;
- existing critical warehouse and delivery workflows pass regression;
- the old dashboard can be restored by feature flag without database rollback.

## 14. Definition of programme completion

The programme is complete only when:

1. the Owner sees today's decisions and risks before decorative reporting;
2. each core metric drills into an explained cause and concrete entities;
3. detail inspection preserves the original filters and context;
4. metrics are consistent across Control Room, Inventory, Customer and Delivery;
5. commercial demand and physical fulfilment are separately visible and
   analysable;
6. trends do not depend on direct, per-page Ordermentum calls;
7. failed data produces honest stale, degraded or unavailable states;
8. the desktop becomes a routed workspace with bounded drawers, inspectors,
   commit modals and full-screen task modes;
9. analysis can hand off to real work without bypassing operational commands;
10. no new enhancer debt is created;
11. roles see different priorities over one shared business truth;
12. EcoFlow has its own operational intelligence system rather than an imitation
    of an external BI product.
