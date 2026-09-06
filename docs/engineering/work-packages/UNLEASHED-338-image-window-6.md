# UNLEASHED-338 image copy window 6

Status: production verified; W7 exposed only after W6 PASS.

## Production predecessor gate

W6 was permitted only when the browser could read the exact W5 predecessor:

- command: `f6bc8ff8-01f6-4d68-bc64-01ed0cb6b7a5`
- run: `d941eca2-e572-4e24-8507-5da8b6738a3d`
- status: `SUCCEEDED`
- planned/copied/reused/failed: `10 / 10 / 0 / 0`
- bytes copied: `4500846`
- authorization: `9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c`

## W6 production result

- command: `97c61ec6-194e-42f0-bc77-4151020ebe4f`
- run: `a2bc3cc4-602f-4434-a653-f23bb16133a0`
- status: `SUCCEEDED`
- planned/copied/reused/failed: `10 / 10 / 0 / 0`
- bytes copied: `1735224`
- integrity: 10 copied rows, 10 distinct hashes, 0 missing objects, 0 size mismatches, 0 content-hash path mismatches
- cumulative Storage: 60 private objects / 19,728,971 bytes
- active claims: 0
- authorization remains current APPROVED revision 1

W7 is separately gated on this exact result. `main` is not modified; inventory/opening balance and cutover remain out of scope.
