---
status: accepted
---

# Replace arbitrary status editing with task-specific decisions

Manual handling is modeled as a persisted Order Task with an explicit set of allowed business decisions for its failure type, not as a free-form status override. A Manual Decision records the action, operator, time, explanation, and relevant evidence; unknown upstream submission or delivery outcomes cannot be retried or marked successful without an explicit reconciliation action. The new order detail decision panel replaces the existing generic `NEED_MANUAL`/`REFUNDED`/`CLOSED`/`DELIVERED` selector.
