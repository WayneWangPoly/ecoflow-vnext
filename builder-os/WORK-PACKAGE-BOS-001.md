# BOS-001 — Builder OS v0.1 Codification

## Objective

Convert completed EcoFlow archaeology into a portable, machine-readable Builder OS v0.1 without extracting EcoFlow-specific business rules into the generic layer.

## In scope

- evidence index;
- pattern-family registry;
- standards registry;
- eval registry;
- production-crew role contracts;
- completion/readiness model;
- command/work-package/eval/evidence schemas;
- build, archaeology and cross-project validation playbooks;
- project adapter/work-package templates;
- internal registry consistency validator.

## Out of scope

- no EcoFlow runtime/business behavior changes;
- no Supabase migration;
- no production deployment workflow changes;
- no customer data, credentials or raw provider content;
- no generic runtime/kernel extraction;
- no claim of cross-project verification.

## Authority

EcoFlow Git/PR/issue/CI/production evidence is evidence for v0.1. A standard is not universal merely because it worked in EcoFlow.

## Acceptance

1. 18 pattern families and 20 standards are codified.
2. Every standard has evidence and at least one eval reference.
3. Every referenced evidence/eval/standard/family ID resolves.
4. Eval status distinguishes READY from CANDIDATE.
5. Agent roles separate Builder from Reviewer/Eval authority.
6. Completion model separates Engineering, Data, Deployment, Production and Field readiness.
7. Generic kernel extraction remains blocked pending cross-project validation.
8. `node builder-os/tools/validate.mjs` passes.

## Rollback

Delete/revert the isolated `builder-os/` directory. No EcoFlow runtime or data state is affected.
