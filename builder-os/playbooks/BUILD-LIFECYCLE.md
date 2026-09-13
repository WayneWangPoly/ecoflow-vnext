# Build Lifecycle

This is the default Builder OS project lifecycle.

## Phase 0 — Find the Node

Identify the economic/operational node before choosing software:
- who passes through it every day;
- what goods, money, decisions, documents or evidence flow through it;
- who has authority;
- where exceptions and delays accumulate;
- what future human/AI actions may pass through it.

Exit: a bounded target workflow and value hypothesis.

## Phase 1 — Reality Mapping

Model:
- Actors
- Objects
- States
- Events
- Rules
- Permissions
- Exceptions
- Evidence
- Unknowns

Do not turn missing information into an assumed rule.

Exit: approved domain glossary, authority map and exception catalogue.

## Phase 2 — Deterministic Core

Before agent autonomy, establish:
- stable IDs;
- authoritative state;
- command boundaries;
- revisions/CAS where needed;
- idempotency;
- permissions;
- event/audit evidence;
- data-plane boundaries;
- explicit failure states.

Exit: deterministic business skeleton.

## Phase 3 — Tooling and Agentification

Classify each activity:
- human-only;
- AI explanation;
- AI recommendation;
- AI prepares command;
- AI executes with approval;
- AI executes within policy.

Expose bounded tools with typed inputs/outputs. Never give an agent direct authority merely because it can technically call a database.

Exit: tool/action catalogue and approval policy.

## Phase 4 — Eval Before Autonomy

Build evals from:
- business invariants;
- known historical failures;
- concurrency/retry cases;
- permission abuse;
- stale/missing data;
- field-device limitations;
- production release mismatches.

Track every eval as `DEFINED → WIRED → REQUIRED → EXECUTED → PASS/FAIL`.

Exit: required verification set.

## Phase 5 — Release by Evidence Plane

Verify independently:
- code/build;
- database/migrations;
- server functions/services;
- projections/read models;
- production revision;
- authenticated production smoke.

Exit: Production Ready only when every required plane is current and healthy.

## Phase 6 — Field Acceptance

Use representative real devices/users/site conditions. Verify:
- primary task completion;
- offline/fallback behavior;
- visual hierarchy;
- latency/performance;
- camera/GPS/scanner constraints;
- error recovery.

Exit: Field Ready.

## Phase 7 — Extract, Do Not Copy

After production:
1. record observed failures and successful corrections;
2. separate domain-specific facts from portable mechanisms;
3. add or update pattern/eval registry;
4. promote a standard only when evidence warrants it;
5. do not extract a generic kernel until reuse has been proven across projects.
