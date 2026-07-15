# Complete mirror cache failure response

A failure of `ecoflow_refresh_ui_active_order_keys()` is a UI acceleration issue, not a commercial mirror failure. The complete mirror may continue to final verification when raw and projected Ordermentum data remain valid.

Operational response:

1. Confirm order and invoice projection converged.
2. Record the cache warning and deploy the lightweight canonical-order refresh function.
3. Run the cache refresh independently after deployment.
4. Determine commercial mirror success only from the mirror health verifier.

The cache contains identifiers only. It does not own order, invoice, customer, product, inventory or delivery facts.
