# ADR-0007: Analytics semantic layer

- Status: Proposed
- Date: 2026-07-28
- Owners: Chief Engineer, Domain, Platform/Data, Verification

## Context

EcoFlow currently combines live operational data from several typed repositories
inside React pages. This is useful for current-state control, but it allows the
same business concept to be recalculated differently across Dashboard,
Inventory, Customer, Delivery and future analytical views. It also makes trend
analysis depend on page-specific joins and leaves no governed place for metric
grain, history, freshness or data-quality semantics.

The system must analyse ordered commercial products separately from the
physical products actually held and dispatched. It must also retain historical
meaning when costs, mappings, customers or supplier relationships change.

External BI products are not being embedded. EcoFlow needs the semantic
capabilities that make professional BI trustworthy without adopting a separate
report-authoring platform or weakening the operational command boundary.

## Decision

Create an `analytics` schema in the existing Postgres/Supabase database as the
initial business-analysis and semantic boundary.

The schema owns:

- governed dimensions and facts;
- metric definitions and versions;
- historical snapshots required for trend analysis;
- source freshness and analytical data-quality status;
- security-invoker analytical views;
- read-only RPCs where a parameterised database query is preferable to a broad
  view;
- bounded aggregate or materialised projections justified by measured query
  cost.

The schema does not own operational writes. It cannot release orders, adjust
stock, change routes, confirm delivery, alter pricing, approve returns or bypass
RLS, command, revision, idempotency or audit controls.

### Source and operational boundaries

Ordermentum remains an ingestion source. Frontend analytical pages do not call
Ordermentum directly. Scheduled or explicit server-side ingestion writes raw
and operational records, from which the analytics layer is derived.

Current operational detail may continue to use approved live operational views.
Reusable metrics, trends, comparisons and cross-domain analysis use the
analytics layer.

### Metric contract

Every reusable metric declares:

- key and display name;
- business definition;
- formula or projection source;
- exact grain;
- allowed dimensions;
- exclusions;
- date basis;
- freshness expectation;
- data owner;
- metric version and lifecycle state.

A frontend page may format or present a metric, but it must not create an
alternative business definition under the same name.

### Fact grain

Initial fact grains are:

- one commercial demand line in one order;
- one physical SKU fulfilment line against an order line;
- one auditable inventory movement;
- one business-day, physical-SKU and location inventory snapshot;
- one stop in one delivery run;
- one inspected return item or condition line.

Facts at different grains must be aggregated to compatible grains before they
are joined. Analytical views and tests must detect common fan-out and duplicate
counting failures.

### Commercial and physical SKU separation

The analytical model retains ordered commercial SKU and fulfilled physical SKU
as separate keys. It also retains quantities, selling price, actual cost,
substitution state, reason, actor, location and timestamp where available.

A commercial SKU may be covered by multiple approved physical SKUs. Available
stock, substitution frequency, margin impact and supplier dependence are
calculated without collapsing the entities.

### Historical meaning

Dimensions and measures that can change historical interpretation use effective
dating, event-time facts, stored fulfilment cost or another separately approved
history mechanism. Updating today's product cost or mapping must not silently
rewrite the apparent margin or fulfilment explanation of past orders.

### Freshness and failure

Analytical responses expose, directly or through a shared envelope:

- `as_of`;
- freshness or staleness state;
- source health;
- metric version;
- quality state;
- partial or degraded source information.

A source or query failure must not become a numeric zero. The presentation layer
must distinguish empty business data from unavailable analytical data.

### Access control

Browser clients access only approved security-invoker views and read-only RPCs
under the authenticated role. Service-role credentials are never exposed to the
browser. Sensitive fields not required by a metric or detail view remain absent
from the projection.

Real-role tests cover Owner, Admin, Account, Viewer, Warehouse, Driver, inactive
and anonymous callers. The analytics schema grants no operational-table write
capability.

### Refresh and aggregation

Near-live operational summaries may query views over current records. Historical
or expensive analysis may use scheduled snapshots, incremental aggregate tables
or materialised views. Each projection declares its refresh expectation.

A separate analytics service or warehouse is not introduced now. It requires a
future ADR supported by measured scale, latency, concurrency, retention or
workload-isolation evidence.

## Alternatives considered

### Calculate metrics in each React page

Rejected because definitions drift, joins are duplicated, historical grain is
unclear and different pages can show conflicting answers.

### Call Ordermentum on every analytical interaction

Rejected because authentication belongs server-side, availability and rate
limits would control the UI, provider history may be incomplete, and EcoFlow
cannot combine external orders safely with warehouse, delivery, POD and return
facts in the browser.

### Embed Power BI or Tableau now

Rejected because the primary requirement is an operational application with
safe workflow handoff, mobile and warehouse behaviour, typed domain contracts
and server-authoritative writes. External BI can be reconsidered later as an
optional consumer of the same semantic layer.

### Create an analytics microservice immediately

Rejected because the current scale and requirements do not justify a second
runtime, deployment, access model and consistency boundary. Postgres provides a
simpler additive starting point.

### Use one denormalised reporting table

Rejected because orders, fulfilment, inventory movements, snapshots, delivery
stops and return inspections have different grains. A single flat table creates
fan-out, duplicated quantities and ambiguous history.

## Consequences

- Database work must precede metric-dependent UI work.
- Metric changes become governed, versioned changes rather than local component
  edits.
- Historical snapshots and aggregate refresh need monitoring and retention
  decisions.
- Analytical queries receive their own performance budgets and indexes.
- The frontend gains simpler typed read contracts but must display freshness,
  degraded and unavailable states honestly.
- Initial delivery is additive and can run in shadow beside the existing
  dashboard.
- Analytics cannot claim operational authority or mutate source facts.

## Migration plan

1. Add the schema, metric registry, refresh status and data-quality contracts.
2. Add initial dimensions and real-role read-access tests.
3. Add facts in grain-specific work packages: fulfilment, inventory, delivery
   and returns.
4. Add initial KPI projections and reconcile them against approved operational
   totals.
5. Add typed repositories returning value, grain, freshness, metric version and
   quality.
6. Run the new projections in shadow while the current Dashboard remains the
   default.
7. Enable Control Room 2.0 only after metric reconciliation, performance,
   permissions and failure-state evidence pass.
8. Use forward migrations for corrections; never edit a deployed migration or
   delete analytical history without an approved retention plan.
