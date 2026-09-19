# Archaeology → Standard Playbook

Use this process to convert a project's history into Builder OS knowledge.

## Evidence priority

Prefer, in order:
1. production result and rollback evidence;
2. reproducible test/CI/database contract;
3. later corrective PR/hotfix;
4. issue/incident record;
5. design/ADR;
6. conversational claim.

A statement that a feature was “complete” is not success evidence if later production work disproves it.

## Record format

For each material case capture:

- ID
- Project
- Problem
- Failed Approach
- Observed Evidence
- Root Cause
- Successful Pattern
- General Rule
- Possible Eval
- Confidence
- Evidence Location

## Deduplication

Do not preserve every bug as a top-level lesson. Group repeated failures into a Pattern Family.

Promote only the invariant. Examples:
- EcoFlow's exact two-photo POD rule is domain-specific.
- Portable invariant: a terminal business state requires a defined evidence contract.
- EcoFlow's Ordermentum authority is domain-specific.
- Portable invariant: one fact has one declared authority and synchronization direction.

## Confidence

- HIGH: observed failure + later correction + reproducible/enforced evidence.
- MEDIUM: strong observed evidence but incomplete verification chain.
- LOW: plausible interpretation with weak support.
- CANDIDATE: useful hypothesis without enough incident evidence.

## Promotion rule

A new standard must:
1. solve a recurring Pattern Family or high-impact failure;
2. have at least one concrete evidence chain;
3. be expressible as a test/review/enforcement mechanism;
4. avoid embedding customer-specific names, values or policy;
5. remain `CROSS_PROJECT_PENDING` until independently validated.

## Successful Fix Is Provisional

Every corrective pattern can fail at a larger scale or different environment. After a fix, ask:
- does it introduce write amplification?
- does it create unnecessary steady-state work?
- does it rely on a provider privilege/format?
- is it correct on a second device?
- is it still correct after data growth?
- is the test locking an invariant or only today's implementation shape?
