# ECOFLOW-R3-P4C — authenticated 163-candidate expansion activation

## Canonical base

- protected main: `02912f957d01a77e273095c52457e85c4c4f878c`
- P4B: PASS / MERGED / PRODUCTION_DEPLOYED / LEGACY_AUTHORITY_REVOKED / V2_DORMANT
- frozen cohort SHA: `79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a`
- frozen P4C command: `430e5bfe-e8b1-44dd-a004-9dfb0bbc46b8`
- frozen candidate count: 163

## Purpose

P4C activates the P4B replacement for real caller-authenticated production use and exposes a bounded OWNER/ADMIN execution carrier. It does not create Commercial SKUs, external mappings, provider traffic, Physical/package/barcode authority, inventory/SOH/location quantity or image actions.

## Authority shape

The activation migration keeps the legacy function revoked from `public`, `anon`, `authenticated` and `service_role`. The P4B v2 replacement is granted to `authenticated` only; `service_role`, `anon` and `public` remain revoked.

The v2 implementation itself still derives actor from `auth.uid()`, requires ACTIVE OWNER/ADMIN, locks and revalidates the exact 163-row frozen cohort, uses exactly-once command replay semantics, and fails closed on drift.

## Execution carrier

The browser carrier requires:

1. a fresh authenticated P4C preflight proving 163/163 eligible, enabled=0, zero prior expansion unlock/command, zero non-CANARY promotion, legacy authority revoked, v2 authenticated authority active and service-role/anon denied;
2. an explicit browser confirmation naming the exact 163-row effect;
3. the frozen command UUID, cohort hash and reason.

Successful P4C execution only changes the 163 EXPANSION candidate rows from `enabled=false` to `enabled=true`, plus one phase-unlock row, one command ledger row and one audit event.

## STOP

After the authenticated P4C command succeeds, STOP and independently verify:

- exactly 163 EXPANSION candidates enabled;
- exactly one EXPANSION unlock and one command row;
- zero non-CANARY promotions;
- no Commercial SKU/external mapping/provider/Physical/inventory/image side effects.

Non-CANARY promotion remains a later, separately engineered and separately authorized stage.
