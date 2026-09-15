# ECOFLOW-R5-002-R2 — authorized recovery activation

- Protected base: `fbfbcf6a0bf94f4c90d27aace2758787492e625a`
- Original failed run: `53c8bf37-ff65-473a-ae9f-ec899acc1770`
- Original `ECOFLOW-R5-002` key remains permanently consumed.
- Recovery key: `ECOFLOW-R5-002-R2`.

The carrier activates exactly one Owner/Admin authenticated GET-only recovery acquisition for `stock_on_hand` at warehouse `ADL1`, page size 200, maximum five pages. Before run creation it proves the canonical R5-002 failure and zero snapshot writes from that run. The existing request-key unique fence makes R2 one-shot.

No STAGE, inventory-reference batch, INITIAL stocktake, warehouse/inventory movement, quantity mutation, Product Identity mutation, Commercial Wave-2 mutation, provider write, or cutover is included. Any failed, partial, incomplete, or ambiguous R2 attempt consumes the recovery key and must STOP without retry.
