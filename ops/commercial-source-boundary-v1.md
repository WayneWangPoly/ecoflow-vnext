# EcoFlow commercial source boundary v1

Ordermentum is the sole source of commercial truth for customers, stores, products, SKUs, price groups, selling prices, orders, order lines, invoices and payments.

EcoFlow is a one-way verified mirror plus the operational execution system for internal release, warehouse stock and locations, barcode verification, picking, packing, delivery, POD, statements, collection workflow, communication preferences, security and audit.

Release controls:

- authenticated users cannot write to Ordermentum raw or canonical mirror tables;
- local EcoFlow price overrides and payment allocations are retired and excluded from current commercial truth;
- customer source fields are read-only in EcoFlow;
- a full mirror records source presence and retains disappeared records as `SOURCE_MISSING` history;
- source-missing orders are not release eligible;
- complete mirror verification fails if a missing source order is already in active physical fulfilment.

Merging this marker triggers one full-history Ordermentum mirror after the production migration settles.
