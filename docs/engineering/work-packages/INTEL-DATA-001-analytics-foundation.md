# INTEL-DATA-001 — Analytics semantic foundation

- Status: Implementation
- Programme: EcoFlow Intelligence & Control Room 2.0
- Owners: Chief Engineer, Domain, Platform/Data, Verification
- Depends on: INTEL-GOV-001, ADR-0007, ADR-0008
- Runtime class: additive database capability; no frontend cutover

## Objective

Create the first governed analytics boundary without changing current operational
authority or claiming that business facts and metrics are already available.

This package establishes:

- the `analytics` schema;
- a versioned metric registry;
- dataset freshness and source-health state;
- actionable data-quality state;
- conformed dimension structures;
- explicit commercial-SKU and physical-SKU separation;
- role-aware, read-only public metadata views;
- database and static contracts.

## Why this work is grouped

These changes share one authority, deployment boundary and rollback strategy.
The registry, freshness state, quality state and dimensions must agree on roles,
effective dating, source identity, RLS and service ownership before any fact
package can depend on them.

The following are intentionally not grouped here:

- order or fulfilment facts;
- inventory facts or snapshots;
- delivery or return facts;
- metric result projections;
- typed frontend repositories;
- chart or Control Room UI;
- operational commands.

## In-scope paths

- `supabase/migrations/20260728221500_analytics_semantic_foundation.sql`
- `scripts/analytics-semantic-foundation-contract-test.sql`
- `scripts/audit-analytics-semantic-foundation.mjs`
- `.github/workflows/warehouse-productisation-check.yml`
- `package.json`
- this work-package document

## Out-of-scope paths and behaviour

- no `src/**` changes;
- no Ordermentum request changes;
- no writes to existing operational tables;
- no new `ecoflow_day_state` scope;
- no new edge function;
- no materialized view;
- no scheduled refresh job;
- no Power BI or Tableau integration;
- no metric displayed to users;
- no production claim that a draft metric is available.

## Behaviour contract

### Semantic boundary

`analytics` is a governed read model. Browser users cannot insert, update,
delete, truncate, reference or trigger analytics tables.

Only `service_role` receives analytics write privileges. Browser-readable
objects are explicit public `security_invoker` views backed by RLS.

### Metric registry

Each metric version declares:

- stable key and version;
- display and business definition;
- human-readable formula;
- grain;
- date basis;
- unit kind;
- dimensions;
- exclusions;
- source objects;
- freshness SLA;
- data owner;
- data-quality policy;
- lifecycle status.

Only one version of a metric may be `ACTIVE`. An active version must name at
least one source object.

This migration seeds ten agreed definitions as `DRAFT`. It deliberately does
not claim that any result is available before the corresponding fact and
projection packages ship.

### Freshness and failure

Each dataset has a status from:

- `NEVER`;
- `REFRESHING`;
- `CURRENT`;
- `STALE`;
- `DEGRADED`;
- `FAILED`.

Current, stale and degraded rows require an `as_of_at`. Rows also retain start,
success and failure timestamps, SLA, row count and error detail.

The public health projection distinguishes failed, degraded, refreshing and
not-ready conditions. Missing data is never translated into a metric value of
zero.

### Data quality

Quality findings are separate from operational exceptions. Each finding can
carry:

- severity;
- lifecycle status;
- entity;
- impact;
- recommended action;
- owner team;
- role visibility;
- first/last detection;
- occurrence count;
- snooze;
- resolution;
- structured details.

### Dimensions and history

The foundation creates:

- date;
- customer;
- store;
- supplier;
- brand;
- commercial SKU;
- physical SKU;
- commercial-to-physical relationship;
- warehouse location;
- driver;
- route;
- order source;
- exception type.

Business dimensions use effective dates and permit only one current record per
source identity.

The date dimension covers 2020-01-01 through 2040-12-31 and includes Australian
July-to-June financial year and quarter fields. It does not infer public
holidays.

### Commercial and physical SKU

Commercial demand and physical stock remain different identities.

A separate effective-dated bridge records whether a physical item is:

- primary;
- approved substitute;
- temporary substitute;
- blocked.

The bridge does not permit the application to silently remap stock. It is an
analytics structure only; operational mapping and fulfilment remain governed by
their existing commands and controls.

## Security matrix

| Object | Anon | Active authenticated | Service role |
|---|---:|---:|---:|
| Metric metadata view | No | RLS-filtered | Yes |
| Refresh metadata view | No | Role-filtered | Yes |
| Quality metadata view | No | Role-filtered | Yes |
| Health view | No | Active-role only | Yes |
| Dimension base tables | No | No | Read/write |
| Metadata base tables | No | Select through RLS | Read/write |
| Trigger helper | No | No | Execute |

Owner/Admin may inspect draft metric definitions. Other active roles see only
active definitions.

Inactive profiles receive no rows even when their Supabase session remains
valid.

## Verification

The PostgreSQL 16 contract must verify:

- all required objects exist;
- all sixteen base tables have RLS;
- only three browser-read policies exist;
- no anon or authenticated writes remain;
- dimension tables are not browser-readable;
- service-role privileges are complete;
- all public analytics views are `security_invoker`;
- the trigger function is not browser-callable;
- the date dimension contains 7,671 valid dates;
- the Adelaide financial period example is correct;
- ten metrics remain draft after migration;
- commercial and physical items remain distinct and are joined only by the
  bridge;
- browser insert/update/delete attempts fail;
- Owner, Viewer, Account, Warehouse and Driver receive the intended metric,
  freshness and quality rows;
- inactive and anon access fails closed.

Static verification additionally rejects:

- operational table updates, deletes or truncates;
- authenticated analytics write grants;
- anon analytics read grants;
- new day-state writes;
- missing workflow wiring.

## Deployment

This migration is additive and backward-compatible. It may deploy before any
frontend or fact package.

The deployment does not require a feature flag because no existing application
path queries the new objects. Future UI remains feature-flagged.

## Rollback and compensation

Do not edit or delete this migration after deployment.

If a defect is found:

1. keep current operational UI unchanged;
2. revoke affected analytics view grants if necessary;
3. add a forward compensation migration;
4. preserve metric definitions, dimension history and quality/audit evidence
   unless a separately approved retention decision allows deletion.

No operational order, inventory, route, POD or return state is modified by this
package.
