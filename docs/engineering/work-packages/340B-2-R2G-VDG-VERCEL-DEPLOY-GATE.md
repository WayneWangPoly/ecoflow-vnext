# ECOFLOW-340B-2-R2G-VDG — Vercel production deployment authority split

## Purpose

Close the release-control gap discovered during `ECOFLOW-340B-2-R2G-DIAG-M`:
a protected `main` merge that was explicitly forbidden from production
deployment still caused Vercel Git Integration to create a production
deployment automatically.

Observed merge:

- protected main before merge: `d7c5b3ddada475428736f51808f7a5c908e98e5f`
- R2G-DIAG merge main: `532e756d3ab0afc9ea4d06b73da449ffce5f0037`
- automatic Vercel deployment: `dpl_ADmBrkCL5smPPHXUfdVHvm7K3d7i`
- source: Git integration / `main`
- target: `production`

The Supabase release path did not deploy production on that merge; the residual
side effect was the Vercel Git integration.

## Frozen architecture

### Merge path

- feature and PR branches may continue to create Vercel Preview deployments;
- protected `main` has `git.deploymentEnabled.main = false` in `vercel.json`;
- moving `main` therefore does not itself carry Vercel production authority;
- Supabase main-push behaviour remains shadow-only under R2G.

### Vercel production path

Production frontend deployment is a separate manual GitHub Actions authority:

`Deploy Vercel production`

Required inputs:

- `expected_main_sha` = exact protected-main SHA;
- `confirmation` = `DEPLOY_VERCEL_PRODUCTION`.

Before any Vercel credential is consumed the workflow must prove:

1. event = `workflow_dispatch`;
2. ref = `refs/heads/main`;
3. input SHA = workflow SHA;
4. freshly fetched `origin/main` = workflow SHA;
5. automatic Git deployment for `main` is still disabled.

The production job then:

1. requires the production-scoped `VERCEL_TOKEN` secret;
2. uses pinned Vercel CLI `59.17.0`;
3. pulls production project settings for the frozen Vercel project;
4. builds the exact authorized checkout;
5. deploys only the prebuilt artifact with `--prod`;
6. attaches `githubCommitSha`, `githubCommitRef=main`, and authority metadata;
7. waits for deployment readiness;
8. verifies the deployment is discoverable by exact commit SHA;
9. publishes GitHub `Vercel` success only after those checks pass.

Any failure publishes failure rather than a false success.

## Frozen Vercel project identity

- team: `team_oklEX8t5l9UolK9KmDwSAXYl`
- project: `prj_wlAGaHrUNXaSV3Vlx33FXxD02Ioj`
- project name: `ecoflow-vnext`

These IDs are routing identifiers, not credentials.

## Required secret

`VERCEL_TOKEN` must exist in the GitHub `production` environment before the
manual carrier can deploy. This work package does not create, read, expose, or
rotate that credential.

A missing token is an intentional fail-closed blocker.

## Scope and stop point

Engineering, PR creation, exact-head CI, verification, and durable checkpoints
are authorized for VDG engineering.

Not authorized in this package:

- merge of the VDG PR;
- manual `Deploy Vercel production` execution;
- any Vercel production deployment;
- Supabase `workflow_dispatch` production deployment;
- #420 merge;
- Customer/Site promotion;
- provider traffic;
- #338 Product Identity mutation;
- #339 inventory mutation;
- any other production business-data mutation.

STOP at the separate VDG merge gate.
