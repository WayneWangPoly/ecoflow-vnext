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
