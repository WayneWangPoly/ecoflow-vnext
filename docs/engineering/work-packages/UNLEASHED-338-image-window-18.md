# UNLEASHED-338 image copy window 18

Status: production verified PARTIAL; deterministic policy failure adjudicated terminal BLOCKED; safe to continue to W19.

## Production result

- command: `8a66ae1e-099b-4f1f-97ed-fc7e78b2fb7a`
- run: `6ef22524-1bd4-46d6-97b2-3ea6426842ac`
- status: `PARTIAL`
- planned/copied/reused/failed: `10 / 9 / 0 / 1`
- bytes copied: `3538396`
- authorization: `9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c`

The nine copied assets passed production integrity verification: 9 rows, 3,538,396 bytes, 9 distinct content hashes, zero missing Storage objects, zero size mismatches, zero content-hash path mismatches, and zero active claims.

The sole failed asset `9a224708-61f5-497f-a86e-6ae6f2055025` failed deterministically with `UNLEASHED_IMAGE_OBJECT_TOO_LARGE` under the unchanged 2 MiB/object authorization limit. It was adjudicated to terminal `BLOCKED` with no claim and no copied object. The server-side failure RPC now treats this exact policy error as terminal BLOCKED so it cannot recur as a retryable FAILED item.

After adjudication, production contains 179 private Storage objects / 49,262,193 bytes with 179 COPIED / 260 PLANNED / 28 BLOCKED.

## Continuation rule

W19 may proceed only when the exact W18 PARTIAL run and the exact terminal BLOCKED asset above are both visible and unchanged. The 2 MiB/object and 64 MiB aggregate limits remain unchanged. `main` is not modified; inventory/opening balance and cutover remain out of scope.
