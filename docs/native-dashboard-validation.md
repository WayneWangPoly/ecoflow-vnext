# Native Dashboard migration validation

This draft removes Dashboard ownership from the DOM enhancer layer and renders it directly inside the authenticated desktop workspace.

Validation checklist:

- Owner, Admin and Accounts roles render the correct control heading.
- The page shows a loading state until all required current-lifecycle sources succeed.
- A failed first snapshot shows no demo orders, stores, stock or KPIs.
- A failed later refresh keeps the last trusted snapshot and shows the refresh error.
- Supporting-source degradation appears as a system-health notice without erasing core order totals.
- Daily Control Queue shows the first 10 actionable items and the true total count.
- `Ordermentum Inbox` and `View all orders` navigation remain available.
- `OwnerCommandCenter`, `dashboardBootstrap.css`, the portal mount and first-paint hide layer are absent.
- TypeScript, Vite, warehouse transaction, picking concurrency and commercial-control checks pass before merge.
