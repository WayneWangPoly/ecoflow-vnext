# EcoFlow operational safety and continuity acceptance

This checklist is the release boundary for desktop operational safety work. It verifies behaviour from a staff member's operating perspective without changing the Ordermentum commercial source, warehouse stock ledger, route/POD contracts, authentication authority or application role definitions.

## Roles and surfaces

| Route | Owner | Admin | Account | Viewer | Warehouse | Driver |
|---|---|---|---|---|---|---|
| Today / Orders | Full | Full | Operational | Read only | Not shown | Not shown |
| Release / route planning | Full | Full | Where authorised | Hidden | Execution only | Execution only |
| Customer contact log | Read/write | Read/write | Read/write | Read only | No access | No access |
| Delivery instruction | Read/write | Read/write | Read/write | Read only | No access | Read only |
| Accounts actions | Full | Full | Full | No write | No access | No access |
| System users and roles | Full | Restricted Owner protection | No access | No access | No access | No access |

The global safety component may observe the application, but guarded actions are restricted to verified controls inside `.desktop-app`. It must not intercept Warehouse mobile, Driver mobile or Warehouse Map navigation merely because a button has similar text.

## Resolutions

Every release must be visually checked at these viewport sizes:

- 1366 × 768 — standard office laptop
- 1440 × 900 — larger laptop
- 1920 × 1080 — desktop monitor
- 390 × 844 — common phone portrait
- 844 × 390 — common phone landscape

The automated contract verifies that laptop and mobile breakpoints remain present. Authenticated workflow and visual acceptance on the Vercel preview remain required before merge.

## End-to-end office route

1. Sign in as Owner or Admin.
2. Open Today and verify mutually exclusive lifecycle totals.
3. Open Release and select one order.
4. Confirm that Release to run opens an affected-object review before execution.
5. Select multiple orders and confirm that every selected order is enumerated and the exact count must be typed.
6. Open Delivery and verify Approve & lock route, Unlock before picking and Start next delivery run use the review dialog.
7. Open a Customer work item and keep it as a Work tab.
8. Refresh the browser and confirm the Work tab and active customer return.
9. Save a Delivery instruction and confirm a success or failure entry appears in Recent actions.
10. Open Orders inside the Customer window and verify POD thumbnails or No POD are visible per order.
11. Open Accounts and verify Generate & send previews the customer, recipient and date range.
12. Verify Promise and Dispute require review, while Hold and Clear hold additionally require typed confirmation.
13. Open System, create or change a user and verify the affected email and role appear before confirmation.
14. Confirm that changing a user to Owner requires typing OWNER and suspending an account requires typing SUSPEND.
15. Log out and confirm Work tabs and Recent actions are cleared.
16. Sign in as a different user in the same browser tab and confirm no prior user's Work tabs or Recent actions appear.

## Continuity contract

- Work tabs and Recent actions use session storage, not durable local storage.
- Work tabs expire after 12 hours.
- Existing unowned session data is cleared when this version first binds to an authenticated user.
- The same authenticated user keeps continuity across refresh and token refresh.
- Logout, missing session or a different authenticated user clears both Work tabs and Recent actions.
- Recent actions advances one record through requested, confirmed/cancelled and succeeded/failed states instead of creating duplicate lifecycle rows.

## Sorting boundary

The desktop “Highest loaded value” option sorts only the rows already loaded in the current view. It reads an explicit monetary column or currency value and must not treat dates, order numbers or arbitrary digits as value. Full server-side pagination and database sorting are deliberately outside this change.

## Warehouse and driver invariants

The safety dialog does not interrupt repetitive scan-led Warehouse or POD-led Driver work. Those flows keep their stronger domain-specific gates:

- stock deduction requires a matching barcode and sufficient live warehouse stock;
- shortage is recorded before a short pick can proceed;
- route order is locked by office before picking;
- delivery confirmation requires both POD evidence fields;
- Driver can read only Delivery instruction, never Customer contact log.

## High-impact action policy

A guarded high-impact operation must present:

1. the action name;
2. the affected object or customer;
3. the affected count;
4. a concise impact statement;
5. explicit acknowledgement;
6. typed confirmation for bulk release, unlock, hold, clear hold, Owner promotion or equivalent actions;
7. a Recent actions entry recording requested, confirmed, cancelled, succeeded or failed state.

A broad label-only interceptor for generic Delete, Remove or Reset buttons is not permitted. Each guarded action must be tied to its real business container and control text.

Bulk internal-order creation remains unavailable. A future implementation must first provide an exact eligible-order preview and distinguish create, update and skip outcomes before any write can be enabled.
