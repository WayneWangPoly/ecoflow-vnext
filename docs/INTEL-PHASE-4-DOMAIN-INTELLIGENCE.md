# Phase 4 — Domain Intelligence

## Completion statement

Phase 4 publishes 6 domains and 60 / 60 governed surface capabilities:

1. Inventory & Substitution Intelligence
2. Orders & Fulfilment Intelligence
3. Customer & Commercial Intelligence
4. Delivery Intelligence
5. Returns Intelligence
6. Data Quality Intelligence

Every domain provides overview, filters, trend, breakdown, table, detail drawer, timeline, freshness, empty/degraded states and canonical handoff.

## Evidence boundary

Surface implementation and business-data readiness are separate dimensions. A completed surface can correctly show Ready, Shadow, Blocked or Unavailable evidence. Missing evidence, invalid values, unavailable metrics and stale sources never become zero.

Commercial SKU demand identity and Physical SKU stock identity remain separate. Inventory global/base quantities are not combined with location/package quantities. Order and line, Customer and Store, delivery run and stop, Return and inspection-event, and quality finding and dataset-refresh grains remain explicit.

## Operational boundary

Domain Intelligence is read-only. Each domain publishes canonical handoff routes into the existing operational workspaces and drawers. It does not release Orders, mutate stock, approve routes, record POD, dispose returns or resolve data-quality findings.

## Completion gate

`INTEL-GATE-004` verifies:

- the six-domain registry order;
- all ten canonical capabilities;
- 60 / 60 implementation coverage;
- required domain-specific evidence;
- responsive and reduced-motion presentation;
- Analytics workspace adoption;
- canonical handoff paths;
- explicit no-fake-zero behaviour.
