# EcoFlow operational safety and continuity acceptance

This checklist is the release boundary for desktop UI work. It verifies behaviour from a staff member's operating perspective without changing the commercial, warehouse-ledger, route, POD or authentication source-of-truth rules.

## Roles

| Route | Owner | Admin | Account | Viewer | Warehouse | Driver |
|---|---|---|---|---|---|---|
| Today / Orders | Full | Full | Operational | Read only | Not shown | Not shown |
| Release / route planning | Full | Full | Where authorised | Hidden | Execution only | Execution only |
| Customer contact log | Read/write | Read/write | Read/write | Read only | No access | No access |
| Delivery instruction | Read/write | Read/write | Read/write | Read only | No access | Read only |
| System users and roles | Full | Restricted Owner protection | No access | No access | No access | No access |

## Resolutions

Every release must be checked at these viewport sizes:

- 1366 × 768 — standard office laptop
- 1440 × 900 — larger laptop
- 1920 × 1080 — desktop monitor
- 390 × 844 — common phone portrait
- 844 × 390 — common phone landscape

The automated contract verifies that laptop and mobile breakpoints remain present. Visual acceptance is performed on the Vercel preview before merge.

## End-to-end office route

1. Sign in as Owner or Admin.
2. Open Today and verify mutually exclusive lifecycle totals.
3. Open Release and select one order.
4. Confirm that Release to run opens an affected-object review before execution.
5. Select multiple orders and confirm that the exact count must be typed.
6. Open Delivery and verify Lock route, Unlock and Start next run use the review dialog.
7. Open a Customer work item and keep it as a Work tab.
8. Refresh the browser and confirm the Work tab and active customer return.
9. Save a Delivery instruction and confirm a success or failure entry appears in Recent actions.
10. Open Orders inside the Customer window and verify POD thumbnails or No POD are visible per order.
11. Open Accounts, generate a PDF without sending, then verify Generate & send is guarded.
12. Open System, create or change a user and verify the affected email and role appear before confirmation.
13. Log out and confirm Work tabs and Recent actions are cleared.

## Warehouse and driver invariants

The safety dialog does not interrupt repetitive scan-led warehouse or POD-led driver work. Those flows keep their stronger domain-specific gates:

- stock deduction requires a matching barcode and sufficient live warehouse stock;
- shortage is recorded before a short pick can proceed;
- route order is locked by office before picking;
- delivery confirmation requires both POD evidence fields;
- Driver can read only Delivery instruction, never Customer contact log.

## High-impact action policy

A high-impact operation must present:

1. the action name;
2. the affected object or customer;
3. the affected count;
4. a concise impact statement;
5. explicit acknowledgement;
6. typed confirmation for bulk, reset, unlock or equivalent destructive actions;
7. a Recent actions entry recording requested, confirmed, cancelled, succeeded or failed state.

Bulk internal-order creation remains unavailable. A future implementation must first provide an exact eligible-order preview and distinguish create, update and skip outcomes before any write can be enabled.
