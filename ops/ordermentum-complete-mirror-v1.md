# Ordermentum complete mirror v1

This release intentionally triggers one full-history Ordermentum reconciliation after the database migration reaches production.

The run retains the complete source payloads and verifies:

- orders and order lines;
- invoices and invoice detail;
- purchasers and delivery/store information;
- products, variants and price groups;
- stock locations;
- order-to-invoice totals, GST, card surcharge, payment method and due dates;
- source-status classification and projection coverage.

A failed or degraded verification remains visible in the workflow log. It is never converted into a successful zero-data snapshot.
