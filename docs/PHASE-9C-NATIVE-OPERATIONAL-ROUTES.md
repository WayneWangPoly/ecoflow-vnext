# Phase 9C — Native Operational Routes

## Completion boundary

This phase closes operational-stability issue `#36` for the five Phase 2 workspaces:

1. Dashboard / Control Room
2. Stores and Price Matrix
3. Inventory
4. Warehouse Map
5. Ordermentum Inbox and Exception Control

These workspaces are now selected by explicit React Router paths and rendered by route-owned React components. They no longer wait for visible headings, sidebar labels, portal mounts or CSS replacement rules.

## Route ownership

| Path | Native owner |
| --- | --- |
| `/control-room` | `DashboardPage` inside `NativeOperationalRoutes` |
| `/ordermentum` | `OrdermentumWorkspacePage` |
| `/exceptions` | canonical redirect to `/ordermentum?tab=exceptions` |
| `/inventory` and `/inventory/*` | `InventoryWorkspacePage` |
| `/customers`, `/customers/*`, `/stores`, `/stores/*` | `StoresWorkspacePage` |
| `/warehouse-map` | protected `WarehouseMapRoute` and `WarehouseMapPage` |

All other routes continue through the existing application while later migration phases proceed.

## Typed role boundary

The native desktop shell receives the authenticated application role from `v_ecoflow_current_user` and passes it through typed React state.

Role access uses `canRoleAccessIntelligenceWorkspace`. Brand text, sidebar text, button labels and CSS classes are not capability inputs. Changing the EcoFlow name, subtitle or navigation wording cannot grant, remove or disable a workspace.

`RoleIdentityEnhancer`, desktop role text detection and desktop `SurfaceModuleGate` mounting are removed from the entry point. Driver and Warehouse mobile observers remain explicitly documented migration bridges and do not infer a role from visible text.

## URL state

Stores, Inventory and Ordermentum use a common `useWorkspaceQueryState` contract. The following state is encoded in the query string:

- `tab`
- `q`
- `filter`
- `sort`
- `page`
- `size`

Copied links and browser Back/Forward therefore restore the same operational view. Changing a search, tab, filter, sort or page size resets page to one unless the caller explicitly preserves the page.

## Data-state contract

Each native workspace renders explicit states:

- loading: server read in progress with no trusted snapshot;
- unavailable: no trusted live snapshot and no demo fallback;
- degraded: last trusted data remains visible with source failure detail;
- empty: live read succeeded but the selected view has no matching records;
- ready: live or last-trusted records are shown.

Missing inventory records are never converted into zero stock, and failed Ordermentum reads never display sample orders.

## Runtime removal

The application entry point no longer imports or mounts:

- `OwnerEnhancers`
- `AccountEnhancers`
- `ViewerEnhancers`
- `RoleIdentityEnhancer`
- `WarehouseMapRouteModules`
- desktop role detection from `.sidebar-brand` or navigation labels

This removes the portal replacement and CSS-hide runtime for the migrated desktop workspaces. Legacy source files may remain temporarily for repository history, but they are not reachable from the production module graph.

## Permanent verification

The `Native operational routes` workflow verifies:

- explicit route ownership;
- no desktop visible-text role detection;
- no target page portal, DOM observer or query-selector code;
- URL query-state usage in Stores, Inventory and Ordermentum;
- explicit loading, empty, degraded and unavailable states;
- route access through typed role contracts;
- TypeScript and Vite production build;
- existing route-adapter contracts.

## Completion definition

Phase 9C is complete when the dedicated workflow passes, the PR is merged, Vercel production is ready, and issue `#36` is closed with the production commit evidence.
