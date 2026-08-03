# EcoFlow Production-Ready Commissioning Plan

## Objective

Complete every engineering, data-control, workflow, resilience and UI task that can be completed before physical warehouse commissioning.

After this release, the only site work is:

1. scan or enter each physical barcode;
2. select the matching Physical SKU / Commercial SKU relationship;
3. select the SKU Family and allowed substitution policy;
4. resolve any explicit conflict shown by the commissioning screen;
5. publish the verified mapping batch.

No source-code change, SQL editing, deployment work, spreadsheet manipulation or manual database repair may be required at the warehouse.

## Release boundary

This programme does **not** fabricate physical barcode evidence. Unknown physical identities remain visibly UNVERIFIED until a user scans them on site. All other infrastructure, screens, validations, tests and production gates must be complete before commissioning begins.

---

## 1. Canonical product identity model

### Required identities

- Commercial SKU: the sellable Ordermentum-facing identity.
- Physical SKU: the actual manufacturer/brand item handled in the warehouse.
- SKU Family: the operationally equivalent product family.
- Barcode identity: carton, sleeve or each-level identifier for a Physical SKU.
- Packaging conversion: units per carton, sleeve and each.
- Substitution policy: allowed, approval-required or prohibited.

### Required invariants

- A barcode belongs to exactly one active Physical SKU at a time.
- A Physical SKU belongs to exactly one active SKU Family at a time.
- A Commercial SKU may map to one or more Physical SKUs through an explicit substitution policy.
- A mapping change is append-only and auditable; historical orders retain the identity actually picked.
- Barcode collisions fail closed and enter a conflict queue.
- Unknown scans never silently create stock or approve a substitution.
- Retired barcodes remain searchable but cannot be used for new picks.
- Carton, sleeve and each levels cannot share contradictory conversion factors.

### Commissioning states

- UNVERIFIED — no physical evidence captured.
- DRAFT — captured but not submitted.
- CONFLICT — duplicate, ambiguous or invalid relationship.
- REVIEW — requires supervisor approval.
- VERIFIED — identity relationship accepted.
- RETIRED — historical only.

---

## 2. Commissioning workspace

Create one native React route: `/commissioning/product-identity`.

### Screen structure

#### Readiness header

Show:

- total Commercial SKUs;
- total Physical SKUs;
- SKU Families configured;
- verified barcodes by packaging level;
- unresolved conflicts;
- unmapped active SKUs;
- readiness percentage;
- publication status and latest actor/time.

#### Guided capture flow

1. Scan barcode or enter it manually.
2. Detect packaging level where possible; otherwise require selection.
3. Search and select Physical SKU.
4. Select or create SKU Family from controlled values.
5. Link one or more Commercial SKUs.
6. Set preferred Physical SKU and substitution policy.
7. Confirm packaging conversion.
8. Show impact preview.
9. Save draft or submit for review.

#### Conflict handling

The screen must distinguish:

- barcode already assigned elsewhere;
- Physical SKU already in another family;
- packaging conversion conflict;
- duplicate Commercial SKU relationship;
- prohibited substitution;
- inactive or retired product;
- missing required fields;
- stale revision from another device.

Each conflict must show a recommended resolution and must not be represented as a generic error toast.

#### Batch publication

Owner/Admin publishes a verified commissioning batch. Publication must:

- use expected revision and idempotent command ID;
- write immutable audit events;
- reject any unresolved blocking conflict;
- preserve prior verified versions;
- update read models atomically;
- never mutate stock quantity merely because identity was mapped.

---

## 3. Operational workflow completion

### Order ingestion and release

- Ordermentum sync health is visible.
- Commercial SKU identity is validated before release.
- Missing identity enters the exception queue.
- Release cannot silently fall back to a similarly named product.

### Picking

- The pick instruction shows Commercial SKU, chosen Physical SKU, brand, family, packaging level and conversion.
- Allowed substitutions are selectable only from the configured family policy.
- The actual Physical SKU and barcode scanned are recorded on the order line.
- A prohibited or unknown scan blocks completion.
- Concurrent devices use server revision checks.

### Receiving

- Receiving can scan a known barcode and resolve its Physical SKU immediately.
- Unknown barcode opens the commissioning capture flow without creating an authoritative mapping automatically.
- Received quantity uses the selected packaging conversion.

### Stocktake and cycle count

- Observations capture actual Physical SKU and barcode where available.
- Approval writes opening or adjustment balances only after identity conflicts are resolved.
- Family-level reporting never replaces Physical SKU balances.

### Delivery and POD

- Delivery records preserve the actual Physical SKU picked.
- POD remains order/stop evidence and does not rewrite product identity.

### Returns

- Return inspection records the actual Physical SKU and condition.
- Resale, quarantine and scrap decisions remain separate from SKU Family membership.

### Business Day Close

- Resolve the current hard-coded revision boundary.
- Read current close revision from the server.
- Repeated close commands are replay-safe.
- Two-device close attempts cannot create duplicate carry-over.

---

## 4. Unified application shell

### Required consolidation

- One authenticated application provider.
- One role/capability provider.
- One desktop shell.
- One mobile shell contract for Warehouse and Driver.
- One navigation registry.
- One route-level loading/error boundary.
- One server health/readiness indicator.

### Migration rules

- No new DOM enhancer or MutationObserver workflow.
- Native routes own all new product-identity and commissioning work.
- Existing enhancer functionality may remain temporarily only when its removal would increase production risk.
- Duplicate navigation, authentication and profile-cache implementations must be consolidated.
- Browser back/forward and copied URLs must restore filter, tab, search, sort and page state.

---

## 5. UI completion standard

### Visual language

- Industrial, calm and high-information-density without looking improvised.
- Use the existing EcoFlow token system as the source of truth.
- Reduce one-off CSS overrides and `!important` rules.
- Product identities and barcodes use tabular/monospace treatment.
- Operational status colours remain semantic and accessible.

### Interaction standards

- Primary action: one clear action per workspace state.
- Secondary actions: compact and visually subordinate.
- High-risk mutations: confirmation modal with impact summary.
- Record detail: right-side drawer rather than expanding every table row.
- Multi-step commissioning: visible stepper and completion state.
- Success/failure: persistent result panel for commands, not transient toast only.
- Empty, loading, degraded, unavailable and permission-denied states are explicit.
- Keyboard focus, reduced motion and 44px touch targets remain enforced.

### Responsive targets

- Office desktop: 1440px and 1920px.
- Office laptop: 1280px.
- Warehouse phone: 390px and 430px portrait.
- Driver phone: 390px and 430px portrait.
- Tablet fallback: 768px portrait and 1024px landscape.

---

## 6. Automated pre-site validation

### Static and build gates

- TypeScript.
- Production Vite build.
- Route ownership audit.
- No production sample-data fallback.
- No new enhancer/observer ownership.
- Bundle and asset budgets.
- Accessibility and reduced-motion contracts.

### Database gates

- Migration shadow verification against production schema.
- RLS and RPC access matrix by role.
- Barcode uniqueness and retirement rules.
- SKU Family membership rules.
- substitution policy rules.
- idempotency and expected-revision conflicts.
- immutable audit events.
- batch publication atomicity.
- Business Day Close concurrency.

### Synthetic end-to-end scenarios

1. Known barcode receiving.
2. Unknown barcode capture without publication.
3. Barcode collision.
4. Physical SKU family reassignment requiring review.
5. Commercial SKU with two allowed Physical SKUs.
6. Prohibited substitution during pick.
7. Allowed substitution during pick with actual identity recorded.
8. Two devices submit the same mapping.
9. Stocktake observation against an unverified identity.
10. Commissioning batch publication with one blocking conflict.
11. Successful publication and immediate read-model refresh.
12. Order ingestion, release, pick, stage, route, POD and close using synthetic data.
13. Offline device returns with stale revision.
14. Repeated Business Day Close command.
15. Role denial for Account, Viewer and Driver mapping publication.

### Production smoke routes

- `/control-room`
- `/ordermentum`
- `/orders`
- `/inventory`
- `/customers`
- `/exceptions`
- `/warehouse-control`
- `/warehouse-map`
- `/commissioning/product-identity`
- Warehouse mobile surface
- Driver mobile surface

---

## 7. Site commissioning checklist

The system must generate this list dynamically from server data.

For each unresolved active product:

- scan barcode;
- confirm packaging level;
- choose Physical SKU;
- choose SKU Family;
- choose Commercial SKU relationship;
- choose substitution policy;
- confirm conversion;
- save.

The operator must not need to know database identifiers or technical terminology.

### Final publication gate

The Publish button remains disabled unless:

- every active required product is VERIFIED or explicitly EXCLUDED with reason;
- zero blocking barcode conflicts remain;
- zero contradictory packaging conversions remain;
- every Commercial SKU has a valid fulfilment policy;
- every preferred Physical SKU is active;
- the user has Owner/Admin capability;
- the current server revision matches the screen revision.

---

## 8. Definition of done

Engineering is complete only when:

- all migrations are deployed successfully;
- all automated gates pass;
- the production frontend and database are on the same release;
- the commissioning workspace is production-accessible;
- every unresolved physical mapping is represented as an explicit site task;
- no unresolved engineering task is disguised as a site task;
- the remaining site procedure is limited to physical evidence capture and relationship selection;
- after publication, standard receiving, stocktake, picking, delivery, returns and close workflows require no code or database intervention.

Physical commissioning is complete when the generated readiness score reaches 100% and the verified batch is published.