# Ordermentum complete mirror v1

This release intentionally triggers one full-history Ordermentum reconciliation after the database migration reaches production.

The run retains the complete source payloads and verifies:

- orders and order lines;
- invoices and invoice detail;
- purchasers and delivery/store information;
- products, variants and price groups;
- stock locations only when the connected Ordermentum API exposes that capability; EcoFlow warehouse racks and physical stock locations remain EcoFlow-owned operational data;
- order-to-invoice totals, GST, card surcharge, payment method and due dates;
- source-status classification and projection coverage.

A failed or degraded verification remains visible in the workflow log. Unsupported optional API capabilities are reported separately and never hide failures in required commercial data.

Projection is intentionally transaction-sized. Order and invoice projection starts at 100 records, reduces the batch automatically when Supabase returns PostgreSQL `57014`, and must finish with a zero-result convergence probe before source presence and mirror health can be finalised.

Active UI order keys are refreshed by a timestamped mark-and-sweep. The production safe-update guard is never bypassed with an unconditional table-wide delete.
