# #338 image COPY window 4

## Objective and authority
Continue the already-authorized bounded image migration only after production W3 verification. Main remains untouched.

## Verified predecessor
W3 command `e5002bc3-fb8f-48ef-881e-0cfb46b54159` produced exact run `e65301bc-2322-4300-9e1d-1e89ea34555e`: SUCCEEDED, 10 planned / 10 copied / 0 reused / 0 failed, 3,225,060 bytes. Production cumulative state after W3 is 30 private Storage objects / 11,474,723 bytes, 0 active claims, no missing objects, no size mismatch and no content-addressed path mismatch. Authorization `9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c` remains APPROVED revision 1 with 64 MiB aggregate and 2 MiB/object caps.

## Window 4 contract
W4 command `a53eacc1-fab5-4e58-a907-63ca635f6fc9` invokes the existing authenticated `COPY_IMAGES` endpoint with `limit=10`. The client first requires the exact W3 run, counts, bytes and authorization id above. One attempt per page session; fixed command id makes replay idempotent. Edge Function remains authoritative for Owner/Admin auth, current rights, source snapshot hash, lease, HTTPS host, MIME/signature, object and aggregate budgets, Storage and provenance commit.

No W5 is exposed until production W4 counts, actual Storage bytes, provenance, claims and rights are reverified. Product Identity, inventory/opening balance and cutover remain dependency-gated.

## Rollback
Remove the preview W4 control. Preserve already-copied objects, provenance and audit history.
