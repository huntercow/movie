---
status: accepted
---

# Roll out by cohort without preserving legacy execution contracts

The V1 operating model will be enabled for selected business-user cohorts after migration review and safe rehearsal, but the backend will not maintain a dual legacy/new plugin execution contract. Unsupported extensions fail activation explicitly; rollback stops order intake and may restore presentation, but never reverses migrations or re-enables legacy automation writes. This trades a coordinated extension upgrade for one enforceable authorization, idempotency, and evidence model.
