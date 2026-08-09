# AI Builder OS v0.1

AI Builder OS is a portable production system for building AI-enabled operational software. It is deliberately **not** a copy of EcoFlow and not a generic application framework yet. v0.1 codifies verified engineering lessons, failure patterns, agent roles, evals and acceptance rules extracted from EcoFlow-vNext.

## Core proposition

The durable Builder asset is not a pile of generated code. It is the ability to repeatedly convert real-world work into a trustworthy digital system:

`Reality → Evidence → Identity → Command → Permission → Transaction → Authoritative Fact → Event/Audit → Projection → Semantic Layer → UI/Agent`

AI may reason, recommend and invoke tools. Deterministic business truth remains governed by explicit authority, commands, permissions, revisions, idempotency and evidence.

## What belongs in Builder OS

Portable:
- process and archaeology methodology;
- authority/state/command standards;
- agent production-crew role contracts;
- eval and verification patterns;
- completion/readiness model;
- generic schemas and project-adapter templates;
- anonymised failure patterns.

Project-specific and excluded:
- customer/store/SKU data;
- provider credentials or raw exports;
- transaction history and PII;
- proprietary customer rules;
- warehouse geometry;
- EcoFlow-specific operational policies.

## Maturity

Every v0.1 standard is `PROJECT_VERIFIED` and `CROSS_PROJECT_PENDING`. This means it has strong EcoFlow evidence, but it is **not yet promoted to universal kernel law**. Promotion requires independent cross-project validation.

The generic runtime/kernel is intentionally blocked until that validation occurs.

## Repository map

- `manifest.json` — version, boundaries, maturity and phase status.
- `registries/evidence.json` — evidence index.
- `registries/patterns.json` — 18 recurring failure/evolution families.
- `registries/standards.json` — 20 Builder standards.
- `registries/evals.json` — executable/reproducible eval backlog.
- `registries/agent-crew.json` — human + AI production crew contracts.
- `registries/completion.json` — Engineering/Data/Deployment/Production/Field readiness axes.
- `schemas/` — portable machine contracts.
- `playbooks/` — build lifecycle, archaeology-to-standard and cross-project validation.
- `templates/` — project adapter and bounded work package.
- `tools/validate.mjs` — self-contained registry consistency validator.

## Operating rule

Do not add a technology because it is fashionable. Add complexity only after a concrete failure, requirement or measurable constraint earns it.

A feature is not production complete because an agent says it is complete, because code compiles, or because a test file exists. Required evidence must be wired, executed and accepted on the relevant readiness axis.
