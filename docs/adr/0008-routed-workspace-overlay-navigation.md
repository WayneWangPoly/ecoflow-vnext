# ADR-0008: Routed workspace and bounded overlay navigation

- Status: Proposed
- Date: 2026-07-28
- Owners: Chief Engineer, Frontend, Domain, Verification

## Context

EcoFlow's desktop surface currently relies heavily on local tab state, direct
button activation, custom browser events and some legacy enhancer behaviour.
This makes it difficult to preserve analytical context, link directly to a
specific entity, use browser Back and Forward naturally, or open related detail
without replacing the user's current workspace.

Control Room 2.0 requires a stable interaction hierarchy:

- workspace summary;
- filters and comparison context;
- entity detail;
- related-entity inspection;
- explicit commit confirmation;
- dedicated full-screen operating tasks.

Without one navigation and overlay contract, individual features will invent
incompatible drawers, modals, URL formats and mobile behaviour.

## Decision

Move new desktop and analytical features to explicit React routes with URL-held
query and selection state. Introduce one shared overlay manager with a bounded
stack and defined mobile transformations.

### Route families

The initial target route families are:

```text
/control-room
/orders
/orders/:orderId
/inventory
/inventory/commercial/:skuId
/inventory/physical/:itemId
/customers
/customers/:customerId
/stores/:storeId
/delivery
/delivery/runs/:runCode
/returns
/exceptions
/analytics
/settings
```

Exact route additions may be delivered incrementally, but new analytical
workspaces must not depend on matching sidebar text, querying DOM buttons or
broadcasting custom events to open a section.

### URL state

The URL is the durable navigation contract for:

- active workspace;
- business date or date range;
- comparison period;
- filters;
- sort;
- page or cursor where shareable;
- selected entity;
- primary drawer;
- secondary inspector;
- saved-view identifier.

Ephemeral presentation state such as hover, temporary animation and local input
focus stays outside the URL.

Copied URLs and browser reload must restore the same authorised view. Invalid,
expired or unauthorised entity references show a typed unavailable or forbidden
state without clearing unrelated filters.

### Layer hierarchy

The presentation hierarchy is:

1. **Workspace canvas** — the primary route and working context.
2. **Context header** — sticky business day, source health, freshness, filters,
   comparison and saved view.
3. **Primary detail drawer** — one selected order, customer, store, commercial
   SKU, physical SKU, run, return or exception.
4. **Secondary inspector** — one related entity opened from the primary detail.
5. **Commit modal** — confirmation, reason capture or irreversible action.
6. **Full-screen task mode** — stocktake, receiving, putaway, bulk pick, route
   planning, return inspection or business-day close.

Only two information overlays may be open at once. Opening a third related
entity replaces the secondary inspector or navigates to its full route.

### Drawer behaviour

Primary drawers and secondary inspectors must:

- be addressable by URL state;
- preserve workspace filters and scroll context;
- close on browser Back before the workspace changes;
- support Escape where no unsaved commit input would be lost;
- trap and restore keyboard focus correctly;
- announce title and layer role to assistive technology;
- prevent background interaction while modal in behaviour;
- show loading, ready, empty, degraded, unavailable and forbidden states;
- convert to full-screen sheets on narrow viewports;
- avoid critical business writes unless the owning command contract explicitly
  permits a safe inline action.

Possible entity tabs include Overview, Timeline, Items, Inventory, Financial,
Delivery, Exceptions and Audit. Each entity exposes only relevant tabs and
role-authorised fields.

### Modal behaviour

A modal is reserved for commit decisions, including:

- destructive or irreversible actions;
- reason capture;
- bulk approval;
- release or route-lock confirmation;
- inventory adjustments;
- other actions whose domain contract requires explicit acknowledgement.

Ordinary detail viewing does not use a modal. A modal displays the affected
entity, impact, expected result and server response state. It does not show a
critical action as complete before acknowledgement.

### Full-screen task mode

Long or safety-critical operating workflows use a dedicated route and task
layout rather than nested drawers. Task mode may provide step navigation,
sticky actions, scan-first controls and explicit recovery.

On mobile, desktop drawers become full-screen sheets. Full-screen tasks retain
large touch targets, sticky action areas and one-handed or scan-first operation.
Hover is never required.

### Cross-filtering

Chart, metric, table and flow selections update one shared query-state model.
Cross-filtering changes the analytical context; it does not mutate operational
records.

A user must be able to move from metric to causal breakdown to affected entity
without losing the original filter state. Returning from the detail restores
the same analytical view.

### Native composition

The overlay manager, route shell and query-state contract live in normal React
components and typed application state. No new DOM observer, enhancer, portal
replacement, CSS hide-and-replace workflow or text-label navigation is allowed.

Existing legacy surfaces remain available during migration and may be opened by
explicit route adapters. They are removed only after equivalent native routes
pass regression and feature-flag rollback tests.

## Alternatives considered

### Keep local tab state and add drawers independently

Rejected because reload, copied URLs, Back/Forward and cross-page context would
remain unreliable, while each feature would invent a different overlay model.

### Put every detail on a separate page

Rejected because analytical investigation often requires comparing a summary
with one entity while retaining filters, chart selection and table position.
Full routes remain available for deep or task-heavy work.

### Allow unlimited nested drawers

Rejected because deep overlay stacks create lost context, inaccessible focus,
unclear Back behaviour and unusable mobile layouts.

### Use modals for all detail

Rejected because modals imply blocking or commitment and are poor containers
for exploratory detail, long timelines and related-entity navigation.

### Continue custom events and DOM text matching

Rejected because those mechanisms are enhancer-era migration bridges, are not
type-safe and can fail when labels or layout change.

## Consequences

- The desktop shell and major workspaces must migrate incrementally to routes.
- One overlay manager and URL serialisation contract become shared frontend
  infrastructure.
- Feature work must distinguish exploration, inspection, commitment and full
  tasks.
- Existing tab and enhancer code remains temporarily, increasing migration
  complexity until each native route replaces it.
- Accessibility and mobile behaviour become release criteria rather than local
  styling choices.
- Feature flags are needed so the routed Control Room can run beside the current
  dashboard.

## Migration plan

1. Define canonical route, query and overlay state types.
2. Add the routed desktop shell behind `overlay_navigation_v1` while preserving
   existing operational entries.
3. Add shared context header, primary drawer, secondary inspector, commit modal
   and mobile-sheet primitives.
4. Add URL serialisation, invalid-state handling and Back/Forward tests.
5. Add keyboard, focus, screen-reader and narrow-viewport tests.
6. Move Control Room 2.0 to the native shell.
7. Migrate existing workspaces in the approved order and remove their DOM event
   and text-matching navigation bridges only after parity evidence passes.
8. Make the native shell the default, retaining a feature-flag rollback until
   production smoke and workflow regression pass.
