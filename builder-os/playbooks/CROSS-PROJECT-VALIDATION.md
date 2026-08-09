# Cross-Project Validation

v0.1 deliberately stops before generic kernel extraction.

## Goal

Determine which EcoFlow-derived standards are genuinely portable by reproducing them in a second independent domain/project.

## Candidate project requirements

Prefer a project that differs materially from EcoFlow in at least three dimensions:
- industry/domain;
- external system/provider;
- physical versus service workflow;
- permission model;
- data scale;
- device environment;
- transaction risk.

## Validation protocol

For each `PROJECT_VERIFIED` standard:
1. map the analogous real-world fact/command/failure in Project B;
2. attempt the existing eval or adapt only its domain fixture;
3. record whether the invariant still holds;
4. record any false assumption embedded in the EcoFlow wording;
5. revise the standard to the smallest cross-project invariant;
6. preserve both evidence chains.

A standard may become `CROSS_PROJECT_VERIFIED` only after independent evidence or an authoritative external standard plus a reproduced local eval.

## Kernel extraction gate

A reusable runtime component may move into the future Builder Kernel only when:
- at least two projects require the same behavior;
- configuration can express project differences without project-specific branching in the core;
- the behavior has required evals;
- authority and security semantics are stable;
- adopting the component demonstrably reduces project effort without hiding important domain decisions.

Until then, prefer templates/contracts over reusable code.
