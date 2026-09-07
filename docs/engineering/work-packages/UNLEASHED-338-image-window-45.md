# UNLEASHED-338 image copy window 45

Status: production-verified final COPY_IMAGES window.

## Production result

- command: `73c66f3e-be03-4003-9503-82a08bde000c`
- run: `d60862ff-41ff-4b1e-a771-374b17d46f76`
- status: `SUCCEEDED`
- planned/copied/reused/failed: `5 / 5 / 0 / 0`
- bytes copied: `221061`
- requested limit: `10`
- requested by: `be8f153a-cf92-4d9d-bf5c-1ff7f707ad0b`
- authorization: `15612d15-f97e-462e-a24f-49889b4668c2`

## Production integrity

- copied rows associated with run: `5`
- asset content bytes represented by those rows: `221061`
- distinct content hashes: `4`
- missing Storage objects: `0`
- Storage size mismatches: `0`
- object-path/hash mismatches: `0`
- active claims: `0`

## Final COPY_IMAGES state

- private Storage objects: `434`
- private Storage bytes: `101422059`
- asset statuses: `435 COPIED / 0 PLANNED / 32 BLOCKED`
- current authorization: revision `2`, `APPROVED`, `134217728` aggregate bytes, `2097152` bytes/object, no expiry, rights scope unchanged

All remaining PLANNED image assets were consumed by W45. The 32 BLOCKED rows remain terminal and are not continuation candidates. No W46 or further COPY_IMAGES continuation is exposed.

`main` remains untouched. Inventory/opening balance and cutover remain out of scope under their existing gates.
