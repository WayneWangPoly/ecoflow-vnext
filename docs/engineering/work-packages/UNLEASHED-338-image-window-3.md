# #338 image COPY window 3

## Objective and authority
Continue the already-authorized bounded product-image migration only after production
verification of Window 2. Chief Engineer accepts this scope under ADR-0009.
Main remains untouched.

## Production predecessor
Window 2 command `d921e548-2d44-4716-a478-985518f1be21` produced run
`6309ef23-fc1c-4c3e-9b25-db32707dbd34`: `SUCCEEDED`, 10 planned / 10 copied /
0 reused / 0 failed, 7,289,531 bytes. The current private
`unleashed-product-images` bucket contains 20 objects / 8,249,663 bytes.
All Window 2 asset rows have matching Storage objects and lengths, content hashes
are present in their immutable object paths, and no product-asset claims remain.
Authorization `9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c` remains current,
`APPROVED`, revision 1, with a 64 MiB aggregate budget and 2 MiB per-object cap.

Window 2 contains 10 asset rows but 9 distinct content hashes because two different
product identities resolve to the same 907,192-byte PNG. The deployed object path
is intentionally identity-scoped (`products/{identity}/{sha}.{ext}`), so reuse is
safe within a product identity while cross-product lifecycle/provenance remains
independent. This is not treated as a blocker for Window 3.

## Scope
Only the Settings preview panel, a typed Window 3 helper, focused regression test
and this work package. No schema, Edge Function, auth, Storage policy, PLAN,
Product Identity, inventory, opening-balance or cutover change.

## Window 3 contract
Command `e5002bc3-fb8f-48ef-881e-0cfb46b54159` uses the existing authenticated
`COPY_IMAGES` endpoint with `limit=10`. The helper reads and validates the exact
Window 2 predecessor before invocation. One attempt per page session; browser
retries reuse the same command ID. Server-side rights, source snapshot, lease,
content-type/signature, object-size and aggregate-budget gates remain authoritative.
An uncertain response stops for inspection rather than blind retry.

No Window 4 is exposed before production verification of Window 3 copied/reused/
failed counts, actual Storage objects/bytes, provenance, zero residual claims and
current rights state.

## Rollback
Remove the preview Window 3 control. Preserve copied objects, provenance and audit.
Never rewrite or replay Window 1 or Window 2 as a new logical window.
