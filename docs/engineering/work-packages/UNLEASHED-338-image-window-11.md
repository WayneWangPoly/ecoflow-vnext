# UNLEASHED-338 image copy window 11

Status: VERIFIED in production; continuation to W12 permitted.

## Production predecessor gate

W11 was permitted only when the browser could read the exact W10 predecessor:

- command: `8853f42e-9890-47ce-9530-cbd6e2397749`
- run: `1495a45f-60ae-463c-ae1a-96341f8bd747`
- status: `SUCCEEDED`
- planned/copied/reused/failed: `10 / 10 / 0 / 0`
- bytes copied: `1398224`
- authorization: `9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c`

## W11 production verification

- command: `2c7b2cf0-65f0-49e7-8cf1-4a661580404b`
- run: `1575c3d7-2348-406b-bf46-61ef8f521779`
- status: `SUCCEEDED`
- planned/copied/reused/failed: `10 / 10 / 0 / 0`
- bytes copied: `2310821`
- started: `2026-09-07T04:13:11.915251Z`
- completed: `2026-09-07T04:13:22.631711Z`
- authorization: `9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c`
- copied rows: `10`
- distinct content hashes: `10`
- missing Storage objects: `0`
- Storage size mismatches: `0`
- object-path/content-hash mismatches: `0`
- active claims: `0`
- cumulative Storage: `110` private objects / `29,807,639` bytes
- resulting statuses: `110 COPIED / 330 PLANNED / 27 BLOCKED`
- authorization remains current, APPROVED revision 1 with 64 MiB aggregate and 2 MiB/object bounds

W11 is PASS. W12 may be exposed; W13 remains blocked pending W12 production verification.
