# EcoFlow Product Transformation Blueprint

Status: proposed product and engineering authority
Owner: EcoFlow product programme
Branch: `agent/product-transformation-blueprint`
Date: 2026-08-07

## 1. Purpose

EcoFlow is moving from a collection of operational features into a coherent commercial-grade Packaging Operations Control System.

The transformation objective is not to maximise feature count. It is to make each operational surface immediately useful, fast, legible, trustworthy and visibly mature enough that a warehouse, operations manager or owner can run the business from it without understanding the implementation.

The system must answer five questions at all times:

1. What is happening now?
2. What is blocked or at risk?
3. What should I do next?
4. What changed since I last looked?
5. Can I trust the number or status I am seeing?

This blueprint is the product contract for all subsequent UI, workflow, data and architecture work.

---

## 2. Product positioning

### Product category

EcoFlow is a **Packaging Operations Control System** for a wholesale packaging business operating across Ordermentum intake, warehouse execution, inventory control, delivery, proof of delivery, returns, accounts and management visibility.

It is not positioned as a generic ERP and should not imitate an ERP information architecture.

### Product promise

> Turn incoming commercial demand into controlled physical fulfilment with one operating picture from order intake to warehouse, route and proof of delivery.

### Core operating loop

```text
Ordermentum demand
      ↓
Commercial order intake
      ↓
Validation / release control
      ↓
Warehouse receiving and inventory
      ↓
Picking / staging
      ↓
Route and driver execution
      ↓
POD / delivery close
      ↓
Returns / exception resolution
      ↓
Accounts / reconciliation
      ↓
Management learning and next-day planning
```

Every product surface must sit clearly in this loop.

---

## 3. Transformation principles

### 3.1 Operational surfaces, not database viewers

A page should present work, decisions and consequences, not expose tables because those tables exist.

### 3.2 Today first

The default owner/operations experience should prioritise the current business day. Historical analytics are secondary surfaces.

### 3.3 Attention before information

The system should surface blockers, overdue work, shortages, delays and incomplete hand-offs before neutral metrics.

### 3.4 Progressive disclosure

A user should not load or see all operational detail on first paint. Summary first, then table, drawer, timeline or drill-down.

### 3.5 One object, one status language

Orders, routes, picks, stocktakes, returns and exceptions must each have a single canonical lifecycle. Visual labels cannot invent new status semantics.

### 3.6 Real data only

Production pages must not fabricate plausible operational values. Empty and unavailable are valid states and must be designed explicitly.

### 3.7 Fail closed for authority, degrade gracefully for context

If a command requires authoritative data, stale or unavailable authority blocks the command. Optional context may degrade without blocking the whole page.

### 3.8 No hidden technical intervention

Routine operations must not require SQL, Supabase console access, technical IDs, GitHub Actions or developer assistance.

### 3.9 Visible finish matters

A page is not complete because the backend works. It is complete only when its visual hierarchy, responsiveness, loading, errors, empty states, interactions and workflows are production-grade.

### 3.10 Performance is product behaviour

A one-minute loading screen is an operational failure, not a cosmetic issue.

---

## 4. External design and workflow benchmarks

EcoFlow should borrow interaction patterns selectively rather than clone one vendor.

### Control Room

Primary references:
- Onfleet Command Center: current-day route/task monitoring, quick stats, sortable route table, map and planned-vs-actual execution.
- ShipHero Hero Board / Web Dashboard: at-a-glance fulfilment progress, urgency, real-time refresh and drill-down.

### Orders

Primary references:
- Shopify Admin: strong list filtering, saved views, bulk actions and predictable object detail layout.
- ShipHero order management: operational readiness, holds, prioritisation and fulfilment state.

### Warehouse / inventory

Primary references:
- ShipHero: location-aware picking, work assignment, live picker visibility and physical workflow design.
- Cin7: barcode receiving, guided picking, barcode verification, stocktake and location-oriented inventory.

### Delivery

Primary references:
- Onfleet: route plans, current-day route progress, map/sidebar coordination, task status and ETA.
- Samsara: fleet/driver operational monitoring patterns and event-oriented visibility.

### Analytics

Primary references:
- Onfleet Analyze: filtered operational analytics, drill-down and custom views.
- Modern BI interaction patterns: chart-to-detail drill rather than isolated decorative charts.

### Settings and configuration

Primary references:
- Shopify and Linear: structured settings, clear scopes, safe destructive actions and predictable navigation.

The benchmark rule is: copy the proven interaction concept, not the vendor branding or visual identity.

---

## 5. Users and role-specific outcomes

### Owner

Needs:
- operating picture in under five seconds
- priority work
- cash / fulfilment / stock exposure
- route and warehouse status
- day-close readiness
- ability to drill without becoming an operator

### Admin / operations coordinator

Needs:
- order release
- exception resolution
- route preparation
- operational reassignment
- master-data commissioning
- cross-functional visibility

### Warehouse

Needs:
- scan-first receiving
- putaway guidance
- pick task queue
- physical SKU and barcode certainty
- stocktake / cycle count
- transfer and exception capture
- minimal typing

### Driver

Needs:
- route and stop sequence
- navigation
- proof requirements
- delivery exception capture
- return capture
- minimal ambiguity and minimum taps

### Account

Needs:
- customer/store account status
- release holds
- statements and overdue work
- reconciliation context

### Viewer

Needs:
- trusted read-only visibility without command surfaces

---

## 6. Global information architecture

The target primary desktop navigation is:

```text
CONTROL ROOM
ORDERS
WAREHOUSE
INVENTORY
DELIVERY
CUSTOMERS
RETURNS
ACCOUNTS
ANALYTICS
LOGS
SETTINGS
```

Ordermentum is not a permanent top-level operating destination once the product is mature. It should become an **integration/source workspace** under Settings / Integrations or a controlled operational intake subview inside Orders.

### Global shell contract

One application shell only:
- one auth/session authority
- one role/capability context
- one primary navigation
- one topbar contract
- one notification/toast system
- one modal/drawer system
- one command-result pattern
- one page density model
- one error/degraded-state language

No page should switch to a visibly different shell because it came from a different implementation generation.

---

## 7. Performance contract

### 7.1 Control Room targets

On a normal authenticated production session:
- shell visible: <= 500 ms after app bundle execution
- first useful Control Room content: p50 <= 1.5 s, p95 <= 3 s
- operational summary read: <= 1.5 s p95 server-side target
- no required first-paint request may return thousands of rows
- no first-paint request may use broad `select=*` against large operational views
- current-day summary must come from bounded pre-aggregated read models
- drill-down data must load on demand

### 7.2 Other workspace targets

- list first page: <= 2 s p95
- drawer/detail: <= 1.5 s p95
- command acknowledgement: immediate optimistic pending state, authoritative result <= 2.5 s target
- barcode scan UI reaction: <= 100 ms local feedback
- mobile route transitions should preserve already-loaded shell and session state

### 7.3 Loading-state rules

Do not block the entire page on optional data.

Use staged rendering:
1. shell
2. primary summary
3. priority work
4. secondary modules
5. optional contextual detail

If one secondary module is degraded, that module shows its own state without blanking the entire page.

### 7.4 Control Room read architecture

The current model of loading large order inbox, exceptions, order lines, drafts, Ordermentum orders, SKU master, inventory, barcode, live balances, stores, release summaries and mapping candidates before rendering must be retired.

Target read models:
- `control_room_today_summary`
- `control_room_flow_summary`
- `control_room_priority_work`
- `control_room_warehouse_summary`
- `control_room_delivery_summary`
- `control_room_day_close_summary`
- optional `control_room_health`

These may be exposed as one bounded RPC or a small number of independently cacheable RPCs.

Every returned collection must have an explicit bound.

---

## 8. Control Room VNext specification

Control Room is the flagship page and the first transformation implementation.

### Objective

In three seconds, an owner should understand today's operating position and the next important action.

### Desktop layout

```text
┌─────────────────────────────────────────────────────────────────────┐
│ FRIDAY 7 AUGUST     OPERATIONS CONTROL            LIVE ● 23 sec    │
│ Ordermentum ● Healthy  Warehouse ● Active  Drivers ● 3 on road     │
├─────────────────────────────────────────────────────────────────────┤
│ TODAY                                                               │
│ Orders 47 | Released 39 | To Pick 18 | Staged 11 | On Road 8      │
│ █████████████████░░░  68% through today's operational workload     │
├───────────────────────────────┬─────────────────────────────────────┤
│ OPERATIONS FLOW               │ PRIORITY WORK                       │
│ Intake 47                     │ HIGH  2 orders blocked              │
│   ↓                           │ HIGH  South-02 +38 min              │
│ Released 39                   │ MED   3 SKUs below target           │
│   ↓                           │ MED   1 incomplete POD              │
│ Picking 18                    │                                     │
│   ↓                           │ [Resolve →]                         │
│ Staged 11                     │                                     │
│   ↓                           │                                     │
│ On Road 8                     │                                     │
│   ↓                           │                                     │
│ Delivered 21                  │                                     │
├───────────────────────────────┼─────────────────────────────────────┤
│ WAREHOUSE LIVE                │ DELIVERY LIVE                       │
│ Receiving 4                   │ South 01  8/11  ON TIME             │
│ Picking 18                    │ East 02   3/9   +12m                │
│ Staging 11                    │ CBD 01    6/6   COMPLETE            │
│ Active workers / bottleneck   │ mini map / route focus              │
├─────────────────────────────────────────────────────────────────────┤
│ DAY CLOSE: 3 blockers remaining                    Review close →  │
└─────────────────────────────────────────────────────────────────────┘
```

### Modules

#### A. Live status strip

Shows:
- integration freshness
- warehouse operational state
- active drivers
- last authoritative refresh

No raw infrastructure terminology in the normal healthy state.

#### B. Today progress

Shows business-day counts across the physical fulfilment lifecycle.

The progress percentage must have an explicit formula documented in code and tests. It must not imply financial completion.

#### C. Operations flow

A visual stage pipeline that shows counts and bottlenecks.

Each stage is clickable and deep-links to the corresponding filtered workspace.

#### D. Priority Work

Not a generic exception list.

Priority rules combine severity, ageing, customer impact, operational blockage and financial exposure.

Each item exposes:
- severity
- short reason
- affected object(s)
- age or impact
- one primary action

#### E. Warehouse Live

Shows:
- open receiving
- active picks
- staged orders
- stocktake/cycle-count activity
- workers currently assigned where available
- blocked pick / unknown barcode count

Do not show worker performance scoring until enough real activity data exists.

#### F. Delivery Live

Shows:
- route progress
- late routes/stops
- unassigned route work
- active drivers
- completion ratio
- mini map when map data is available

#### G. Day Close

Shows readiness checks and blockers, not merely a button.

The close command is enabled only when the role and concurrency contract permit it.

### Mobile/tablet behaviour

Tablet keeps two-column modules where space permits.

Phone becomes a ranked vertical command feed:
1. priority work
2. today progress
3. operations flow
4. warehouse
5. delivery
6. day close

No horizontal desktop table should be the primary phone interaction.

---

## 9. Orders VNext specification

### Objective

Turn every incoming commercial order into a controlled fulfilment object with clear release readiness.

### Default list

Columns/fields prioritise:
- order number
- customer/store
- due/delivery date
- value
- release status
- fulfilment status
- blockers
- age

### Saved views

Default operational views:
- Needs release
- Blocked
- Ready for warehouse
- Picking
- Staged
- On road
- Delivered today
- Changed since release
- Account hold

### Interaction model

List remains visible while an order opens in a detail drawer on wide screens.

Order detail tabs:
- Summary
- Items
- Fulfilment
- Delivery
- Timeline
- Exceptions
- Commercial

### Commands

Commands are contextual and role-aware:
- release
- hold
- resolve mapping
- assign route
- reopen
- cancel where authorised

Bulk actions only appear for compatible selections.

---

## 10. Warehouse VNext specification

Warehouse is a role-optimised operating surface, not merely a responsive desktop page.

### Main modes

- Receiving
- Putaway
- Pick
- Stage
- Transfer
- Stocktake
- Product Identity

### Receiving

Scan-first flow:
1. scan barcode
2. resolve Physical SKU
3. identify packaging level
4. enter/confirm quantity
5. select/suggest location
6. post movement

Unknown barcode fails closed for stock-affecting posting and creates a commissioning task.

### Putaway

Provide recommended location and permit controlled override.

### Picking

Show one clear next task.

Required evidence:
- location
- Commercial SKU requested
- accepted Physical SKU choices
- quantity and packaging level
- scan verification
- substitution reason when non-preferred physical SKU is used

### Staging

Orders receive explicit staging state/location before route hand-off.

### Stocktake

Location-oriented count flow:
- start location
- scan/count
- discrepancy review
- complete location
- submit batch
- approval

Stocktake approval is the stock authority; product identity commissioning must never silently change quantity.

---

## 11. Product identity / SKU family model

This is mandatory because commercial SKU and physical product are not one-to-one in the real warehouse.

### Canonical hierarchy

```text
Commercial SKU
   ↓ fulfilled by
SKU Family / substitution policy
   ↓ contains
Physical SKU A / Physical SKU B / Physical SKU C
   ↓ each has
Packaging levels: CARTON / SLEEVE / INNER / EACH
   ↓ each may have
one or more active/historical barcodes
```

### Required concepts

#### Commercial SKU
The product identity sold through Ordermentum and used for pricing/order intent.

#### Physical SKU
The actual manufacturer/brand/item stocked and dispatched.

#### SKU Family
Business-equivalent grouping used to govern substitutions.

#### Substitution policy
- preferred
- allowed
- approval required
- prohibited

#### Packaging conversion
Defines base-unit conversion between carton/sleeve/each levels.

#### Barcode history
Barcodes are append-only identities with active/retired status; historical fulfilment remains traceable.

### Onsite commissioning boundary

The warehouse visit should only require physical evidence entry:
- scan barcode
- choose/create Physical SKU
- choose SKU Family
- select Commercial SKU relationship
- confirm packaging level and conversion
- select substitution policy
- resolve explicit collision/conflict
- publish batch

No SQL or engineering task is acceptable as part of normal commissioning.

---

## 12. Inventory VNext specification

### Objective

Answer: what do we have, where is it, what is at risk, and what movement explains the number?

### Views

- Overview
- By SKU
- By location
- Below target
- Negative / inconsistent
- Movement ledger
- Cycle count

### SKU detail

Shows:
- Commercial SKU and related Physical SKUs
- family
- current on-hand by location
- packaging levels
- barcodes
- recent movements
- demand velocity
- reorder target
- unresolved identity exceptions

No inventory page should infer location solely from a static master field if a live location ledger exists.

---

## 13. Delivery VNext specification

### Objective

Provide a current-day dispatch command surface from route plan through POD.

### Desktop layout

Two-mode design:
- Table mode for sorting / operations management
- Map mode for geospatial monitoring

Route list fields:
- route
- driver
- planned start/end
- actual start
- stops completed / total
- late stops
- ETA / projected finish
- state

### Route drawer

Shows:
- progress
- stop sequence
- exceptions
- planned vs actual timing
- POD completion
- route notes

### Driver hand-off

Route lock / assignment becomes explicit.

Driver app receives authoritative route state rather than rebuilding route logic locally.

---

## 14. Driver VNext specification

### Objective

One-handed mobile execution with minimal decision load.

### Screen hierarchy

- Today route
- Current stop
- Next stop
- Exception
- Return
- Completed

### Stop execution

Primary actions:
- Navigate
- Arrived
- Capture POD
- Delivery issue
- Complete

POD requirements are visibly stated before completion.

GPS, photo or notification failure must never disappear silently; user receives an actionable recovery state.

---

## 15. Customers and accounts

### Customer/store page

Tabs:
- Overview
- Orders
- Delivery
- Pricing
- Accounts
- Contacts
- Timeline

### Account controls

Release holds must be visible both in Accounts and on affected Orders.

The system must explain:
- why held
- since when
- amount/status involved
- who can release

---

## 16. Returns VNext specification

Returns are a first-class physical workflow.

Lifecycle:

```text
Return reported
  ↓
Collected / received
  ↓
Inspected
  ↓
Disposition: restock / quarantine / scrap / supplier return
  ↓
Inventory / account consequence
  ↓
Closed
```

A return is not complete until its inventory consequence is explicit.

---

## 17. Analytics VNext specification

Analytics is for historical learning, not today's command surface.

Initial dashboards:
- order throughput
- fulfilment cycle time
- warehouse throughput
- pick exceptions
- substitution rate by family/SKU
- stock accuracy
- delivery on-time performance
- POD completeness
- returns
- customer/store trend

All charts require drill-down to underlying operational records.

Avoid vanity charts with no action or explanatory value.

---

## 18. Visual system

### Character

Industrial, calm, high-signal, modern B2B SaaS.

Avoid:
- excessive flat cards
- oversized marketing typography
- decorative gradients unrelated to state
- gratuitous animation
- dozens of equal-weight borders
- endless dashboards made only of stat tiles

Use:
- strong hierarchy
- dense but breathable information
- restrained surfaces
- clear typography
- deliberate whitespace
- meaningful status colour only
- predictable table rhythm
- drawers for detail
- modals only for bounded commands/decisions
- sticky action areas where workflow needs persistence

### Density modes

- Office desktop: compact operational density
- Warehouse tablet/phone: touch-first medium density
- Driver phone: large-target field density

### Component authority

Create one production component family for:
- page header
- command bar
- KPI/summary strip
- status pill
- priority row
- data table
- filter/saved-view bar
- detail drawer
- confirmation dialog
- timeline
- empty state
- degraded/error state
- toast/command outcome
- skeleton
- stepper

Legacy global CSS selectors and broad `!important` overrides should be retired progressively.

---

## 19. Interaction language

### Drawers

Use for object inspection where maintaining list context is valuable.

### Modals

Use for commands requiring focused confirmation or short structured input.

### Full pages

Use for complex multi-step workflows or when the object becomes the operator's primary context.

### Tabs

Use only for meaningful object domains, not to hide arbitrary groups of controls.

### Toasts

A toast never replaces the authoritative state on the page. Successful commands must update the visible object state.

### Destructive actions

Require explicit confirmation and explain consequence.

---

## 20. Data and frontend architecture transformation

### Target architecture

```text
AppShell
 ├─ AuthProvider
 ├─ CapabilityProvider
 ├─ BusinessDayProvider
 ├─ Command/Toast Provider
 └─ Router
      ├─ Control Room
      ├─ Orders
      ├─ Warehouse
      ├─ Inventory
      ├─ Delivery
      ├─ Customers
      ├─ Returns
      ├─ Accounts
      ├─ Analytics
      ├─ Logs
      └─ Settings
```

### Rules

- no duplicate auth/session loaders across route families
- no route-specific replacement shells
- no DOM observer/enhancer as a primary UI architecture
- no page fetches entire cross-domain datasets when it only needs a summary
- server-authoritative command endpoints remain revisioned and idempotent
- server read models are bounded and purpose-built
- URL carries shareable filter/view state where appropriate

### Migration strategy

Do not rewrite the entire app at once.

For each transformed workspace:
1. define page contract
2. define read models and commands
3. implement native route in unified shell
4. pass acceptance gate
5. switch route authority
6. delete/retire replaced legacy enhancer logic

---

## 21. Agent execution model

Agents are a production workforce, not autonomous product managers.

### Control hierarchy

```text
Product blueprint / page specification
        ↓
Implementation plan
        ↓
Parallel agents
  ├─ UI / interaction
  ├─ read models / RPC
  ├─ command integration
  ├─ responsive / accessibility
  └─ tests / performance / regression
        ↓
Review agent
        ↓
Production gate
```

### Agent instruction rule

Never issue a vague instruction such as:

> Improve Control Room as much as possible.

Use:

> Implement Control Room VNext against the specified read-model, performance, interaction and visual acceptance criteria. Do not stop at feature presence; stop only when every acceptance item is demonstrated.

### Continuous work

Long-running agent work is useful only when:
- the goal is bounded
- acceptance criteria are objective
- agents work on isolated branches/worktrees
- merge authority remains gated
- agents cannot independently change business semantics outside scope

---

## 22. Definition of Finished

A transformed page is not finished until all applicable conditions pass.

### Product
- primary user outcome is obvious
- default state prioritises current work
- important next action is discoverable
- no duplicate or contradictory status concepts

### Data
- real production read path defined
- authority/freshness semantics explicit
- no silent stale-to-zero behaviour
- drill-down reconciles with summary

### Performance
- performance budget passes
- payload bounds proven
- optional slow modules do not block first useful paint

### UI
- desktop complete
- tablet complete
- phone complete where role requires it
- loading skeleton
- empty state
- degraded state
- denied state
- conflict state
- error recovery
- command pending/success/failure states

### Interaction
- keyboard/focus behaviour where appropriate
- drawer/modal close behaviour correct
- destructive actions confirmed
- repeated click protected

### Security
- role capabilities tested
- hidden UI is not relied on for security

### Reliability
- idempotency
- concurrency
- replay
- offline/degraded behaviour where applicable

### Validation
- TypeScript
- production bundle
- SQL/RPC contracts
- migration shadow
- route smoke
- targeted E2E
- screenshot/regression evidence for visual transformation

### Visual acceptance

For major workspace transformations, an informed reviewer must be able to distinguish old and new screenshots immediately. If the result looks materially unchanged, the transformation is not complete.

---

## 23. Delivery programme

### Phase 0 — Performance and shell foundation

Goal: remove structural blockers to visible transformation.

Deliverables:
- Control Room bounded read architecture
- first useful paint target <= 3 s p95
- shared AppShell/Auth/Capability state
- shared loading/degraded/error primitives
- baseline visual regression capture

Do not spend this phase polishing every legacy screen.

### Phase 1 — Control Room VNext

Goal: create the flagship commercial-quality command surface.

Deliverables:
- Today progress
- Operations Flow
- Priority Work
- Warehouse Live
- Delivery Live
- Day Close readiness
- drill-down links/drawers
- staged loading
- production performance instrumentation

Exit condition: visibly transformed and operationally superior.

### Phase 2 — Orders + Exceptions

Goal: complete order intake-to-release vertical workflow.

Deliverables:
- saved views
- order drawer/detail
- release readiness
- exceptions and resolution
- bulk actions
- timeline
- account hold integration

### Phase 3 — Product Identity + Warehouse

Goal: make onsite commissioning and physical fulfilment production-ready.

Deliverables:
- Product Identity commissioning workspace
- SKU family/substitution authority
- receiving
- putaway
- pick
- stage
- transfer
- stocktake/cycle count

Exit condition: onsite work is physical evidence entry, not engineering.

### Phase 4 — Delivery + Driver

Goal: current-day route control and field execution.

Deliverables:
- route table/map
- planned-vs-actual
- driver assignment
- stop state
- POD
- route/stop exceptions
- returns hand-off

### Phase 5 — Inventory + Customers + Accounts + Returns

Goal: finish operational and commercial loops.

### Phase 6 — Analytics and optimisation

Goal: convert captured execution evidence into management learning.

Only after trustworthy activity history exists should advanced scoring/forecasting be added.

---

## 24. Immediate Control Room performance remediation

Before the visual VNext build, replace the current homepage loading contract.

Current anti-pattern:
- five large required views fetched before trust is established
- second wave of nine optional views only starts after required wave
- up to thousands of rows fetched for homepage rendering
- large order-line payload used merely to derive summary values
- broad workspace dataset created before page-specific needs are known

Required remediation:

1. Add a dedicated bounded Control Room read model/RPC.
2. Return current-day counts and top priority work only.
3. Separate module RPCs so warehouse/delivery context can stream in after first paint.
4. Add server-side timing to every Control Room read.
5. Add client Performance API marks around shell, primary summary and fully-ready state.
6. Fail CI if static audit detects large `select=*` datasets in first-paint Control Room loader.
7. Add regression contract that first-paint loader does not call the old `loadSupabaseOrdermentumViews()` aggregate path.
8. Keep the aggregate loader only for workspaces that genuinely need it until those workspaces are transformed.

---

## 25. Measurement

Transformation success should be measured with operational and product metrics.

### Product performance
- Control Room p50/p95 first useful paint
- route/workspace transition latency
- RPC p95
- payload bytes

### Workflow performance
- order intake-to-release time
- pick start-to-stage time
- delivery on-time percentage
- unresolved exception age
- stocktake discrepancy closure time

### Quality
- unknown barcode rate
- substitution rate and override rate
- failed POD completion rate
- duplicate/replayed command count
- stale snapshot incidents

### Adoption
- daily active operator sessions
- Control Room drill-down usage
- percentage of operational commands completed without technical intervention

---

## 26. Governance

Every significant new feature must answer:
- which persona owns it?
- which operating-loop stage does it serve?
- which page owns the command?
- what read authority does it require?
- how does it affect current-day priority?
- what is its Definition of Finished?

Features that do not have a clear answer should not be added merely because they are technically possible.

---

## 27. Final target state

When this programme is complete:

- opening EcoFlow feels like opening one coherent commercial product
- Control Room is useful within seconds
- operational state is visible before technical detail
- every order can be traced from Ordermentum to actual physical product and POD
- physical substitutions are governed rather than hidden
- warehouse users work scan-first
- driver users work stop-first
- owners work exception-first
- accounts users work exposure-first
- drill-down never contradicts summary
- onsite commissioning does not require developer intervention
- UI maturity is visibly different from the current application
- agent development increases throughput without becoming the product strategy

This blueprint is the authority for the transformation programme. Page-level implementation specifications may extend it but should not contradict it without an explicit product decision.