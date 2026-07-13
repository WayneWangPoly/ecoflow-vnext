# Order feed recovery · 13 July 2026

Production evidence showed that the latest recorded order delta stopped at 09:42 while Ordermentum continued receiving customer orders through the afternoon.

Recovery attempt 2 keeps the customer-order import running even when the durable job audit row cannot be created. The sync log and audit-row error are retained separately, and the seven-day scan still ignores the saved high-watermark.
