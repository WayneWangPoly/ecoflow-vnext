# ECOFLOW-345-METRIC-DRILL-R1 — transaction metric readiness + drill authority

## Goal

Extend governed readiness/drill metadata to the three active sales-transaction metrics without changing fact data, metric values, provider traffic, or the ten-metric Operational Pulse deck.

Target metric identities:
- Revenue v2
- Sales Orders v1
- Average Revenue per Order v1

## Canonical lifecycle selection

Revenue v1 remains in the registry and readiness ledger for history, but current readiness/drill RPCs must return one row per metric key.

Canonical version ranking:
1. ACTIVE
2. DRAFT
3. DEPRECATED
4. highest metric_version inside the same lifecycle state

This makes Revenue v2 canonical both in fresh engineering fixtures (v1/v2 both DRAFT, v2 wins by version) and in production (v2 ACTIVE, v1 DEPRECATED).

## Readiness contract

The three transaction metrics use:
- projection status: READY
- projection object: `analytics.v_sales_transaction_metric_input_internal`
- required dataset: `analytics.sales_transaction_documents`
- governed dimensions: `date`, `customer`, `order_source`
- blocker codes: none

The internal projection remains browser-denied; readiness/drill RPCs expose only governance metadata.

## Drill authority

`analytics.get_metric_drill_access()` remains metadata-only.

AVAILABLE requires all three:
- metric status ACTIVE
- projection status READY
- at least one governed supported dimension

The RPC never reads KPI values, transaction facts, breakdown values, or affected entities.

The drill envelope expands from the ten Operational Pulse identities to twelve governed drill identities by adding:
- Sales Orders
- Average Revenue per Order

Operational Pulse itself remains ten metrics. Readiness-to-Operational-Pulse adaptation filters out non-Pulse metric identities.

## Production boundary

This engineering package does not:
- mutate metric lifecycle state
- deploy production schema
- refresh facts
- change metric values
- call providers
- open direct browser access to the internal transaction projection

Merge, production deployment, and any later actual drill-data carrier remain separate authorities.
