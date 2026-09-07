# UNLEASHED-338 image copy window 17

Status: production verified PASS.

## Production predecessor gate

W17 was permitted only when the browser could read the exact W16 predecessor:

- command: `e83b3a7f-e660-4be6-96ba-b64b8a619ff2`
- run: `6018dfba-da70-4ae3-8912-2a3276942a14`
- status: `SUCCEEDED`
- planned/copied/reused/failed: `10 / 10 / 0 / 0`
- bytes copied: `1150470`
- authorization: `9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c`

## Production verification

W17 command `5c806850-c9bb-487a-9114-a4510b08895f` produced exact run `0a1b5176-bc92-4680-8373-a521ab13320e` with status `SUCCEEDED`, planned/copied/reused/failed `10 / 10 / 0 / 0`, and `2525381` bytes copied under the same current authorization.

Post-run integrity established 10 copied asset rows / 2,525,381 bytes, 9 distinct content hashes, zero missing Storage objects, zero object-size mismatches, zero content-hash path mismatches, and zero active claims. Cumulative private Storage is 170 objects / 45,723,797 bytes. Asset states are 170 COPIED / 270 PLANNED / 27 BLOCKED. Readiness remains `copy_allowed=true`; authorization remains APPROVED, current, revision 1, no expiry, 64 MiB aggregate and 2 MiB/object.

## Continuation

W18 may be exposed only with the exact W17 production facts above. `main` is not modified. Inventory/opening balance and cutover remain out of scope.
