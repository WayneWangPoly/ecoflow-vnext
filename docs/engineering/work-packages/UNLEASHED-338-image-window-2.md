# #338 image COPY window 2

## Objective and authority
Continue the user's authorized bounded image migration after production W1 PASS.
Chief Engineer accepts this scope under ADR-0009. Main must remain untouched.

## Scope
Only the Settings preview panel, new typed Window 2 helper, focused test, and
this work package. No schema, Edge Function, auth, storage policy, PLAN,
Product Identity, inventory, opening balance or cutover changes.

## Contract
W1 command 324354e6-a421-4b23-af53-bf67abfc5110 produced run
7dd46ed5-f5cd-463a-9469-d503ea513fb9: SUCCEEDED, planned/copied 10,
reused/failed 0, 960132 bytes. Production Storage: 10 private objects, 960132
bytes. All 10 source hashes, storage lengths and content-addressed paths
match. No claims remain. Current rights revision 1 is APPROVED with 64 MiB
aggregate / 2 MiB object caps. Database provenance commit rechecks rights.

W2 command d921e548-2d44-4716-a478-985518f1be21 uses the existing authenticated
COPY_IMAGES endpoint, limit 10, stable reason and command across browser retries.
Read and validate the exact W1 predecessor before invocation. One attempt per
page session. Server auth, rights, lease, content and budget checks remain the
authority. No W3 is exposed before production W2 verification. An uncertain
response stops for inspection, never blind retry. The UI result is execution
evidence, not a claim that Storage/provenance verification has completed.

## Acceptance
Negative predecessor / network / malformed-result tests; typecheck and build;
independent Verification; exact-head CI and preview READY. Then authenticated
execution and production counts, actual Storage bytes, provenance, rights and
lease verification before the next window.

## Rollback
Remove the preview W2 control. Preserve copied objects, provenance and audit.
Never remove or rewrite the immutable W1 runner or replay it as a new window.
