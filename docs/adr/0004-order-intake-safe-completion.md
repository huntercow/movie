---
status: accepted
---

# Stop new intake without interrupting accepted orders

Stopping order intake prevents new image quotes and orders from entering automation, but an order already persisted at the waiting-for-payment stage continues through amount verification, ticketing, and Xianyu delivery. Conversations without an unfinished accepted order receive one closed-intake reply per continuous closed-intake period; accepted-order conversations continue using their order-stage replies. Critical readiness failures stop intake automatically, and capability recovery requires the business user to confirm resumption.
