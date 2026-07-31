# Movie Ticket Commerce

This context coordinates movie-ticket quoting and fulfillment with external sales channels. Its language distinguishes an offered price, an external price adjustment, and verified buyer payment so automation never treats one as proof of another.

## Language

**Business User**:
The primary operator who manages their own Xianyu movie-ticket quoting, fulfillment, client connections, upstream account, and reply configuration.
_Avoid_: Administrator, platform user

**Administrator**:
The platform governance role that manages business-user accounts, client authorization, and governance audit records without access to a business user's quotes, orders, buyers, amounts, ticket codes, or fulfillment activity.
_Avoid_: Operator, business user

**Client Authorization**:
Approval for a business-user-created plugin or bot token to operate until a defined expiry. The administrator manages approval, expiry, and revocation but never receives the token secret.
_Avoid_: Token creation, token disclosure

**Plugin Session**:
The active plugin login established by explicitly activating an approved token and automatically restored after browser restart until logout or invalidation. It is a runtime connection, not the owner of Xianyu account history.
_Avoid_: Permanent device binding, order owner

**Rejected Authorization**:
A final administrator decision that a pending client-token request will not be authorized. The rejected request cannot be revived; the business user must create a new token request.
_Avoid_: Suspended authorization, expired authorization

**Operations Inbox**:
The business user's prioritized set of orders and channel conditions that require attention or a decision before safe fulfillment can continue.
_Avoid_: Dashboard statistics, all activity

**Business Notification**:
One deduplicated business-user alert for a recovery task, order task, or meaningful operating-state change, linked to the place where the user can understand or resolve it.
_Avoid_: Audit log, repeated error message

**Order Task**:
A persisted exception on one order that requires the business user to review evidence and choose from the task type's explicitly allowed business actions.
_Avoid_: Editable status, free-form exception

**Task Deferral**:
A time-bounded reminder delay that leaves a recovery or order task unresolved and returns it to the active inbox at the chosen time or an earlier risk deadline.
_Avoid_: Dismissal, resolution

**Task Deadline**:
The risk-based time by which an unresolved task is escalated in visibility and notification without triggering an automatic business decision.
_Avoid_: Automatic resolution, retry timer

**Manual Decision**:
The business user's recorded resolution of an order task, including the selected allowed action, operator, time, required explanation, and relevant evidence.
_Avoid_: Status override, note-only update

**Reconciliation**:
A Manual Decision that establishes the observed outcome of a previously unknown external submission or delivery attempt before any new attempt can be authorized.
_Avoid_: Assumed failure, direct retry

**Evidence Record**:
The durable structured facts, attempts, configuration versions, and decisions required to explain an order journey without retaining complete raw external protocol payloads.
_Avoid_: Raw response archive, mutable note

**Sensitive Reveal**:
An audited, short-lived business-user action that exposes a protected order value such as a ticket code outside lists, search, notifications, logs, or administrator access.
_Avoid_: Default display, bulk export

**Unassigned Historical Order**:
A migrated order whose Xianyu business account ownership cannot be proven uniquely from persisted evidence. It is excluded from account statistics and automation until the business user records an audited assignment.
_Avoid_: Best-effort account match, recent-client inference

**Order Journey**:
The business user's unified view of one ticket purchase from its linked quote through Xianyu payment verification, upstream ticketing, and Xianyu delivery.
_Avoid_: Separate quote, payment, ticketing, and delivery records

**Automation Readiness**:
The current evidence-based ability of a business user's system to safely receive Xianyu activity and complete the configured journey through automated Xianyu delivery. It is broader than whether a plugin process is connected or quoting is available.
_Avoid_: Plugin online, heartbeat status

**Readiness Journey**:
The resumable evidence-based onboarding path from an unconfigured business user to safely opening order intake, including authorization, client activation, account discovery, upstream binding, operating configuration, and a safe rehearsal.
_Avoid_: Setup checklist, dismissed tutorial

**Cohort Enablement**:
The deliberate release of the new operating model to a selected set of business users only after migration review and safe rehearsal. It does not preserve the legacy execution contract.
_Avoid_: Dual-contract compatibility, automatic global rollout

**Order Intake**:
Whether the business user currently accepts new Xianyu platform orders into automated fulfillment. Stopping intake does not interrupt an order that was already registered at the waiting-for-payment stage.
_Avoid_: Pause all automation, disable user

**Accepted Order**:
A Xianyu platform order whose waiting-for-payment state was persisted before order intake stopped. It continues through payment verification, ticketing, and delivery after intake stops.
_Avoid_: Quote sent, buyer conversation

**Closed-Intake Reply**:
The availability message sent at most once per conversation during one continuous closed-intake period when that conversation has no unfinished accepted order. It replaces image quoting but does not replace replies needed to finish an accepted order.
_Avoid_: Automatic-reply shutdown, order reply

**Closed-Intake Period**:
One continuous interval from stopping order intake until resuming it. A later stop begins a new period with a new closed-intake reply allowance per conversation.
_Avoid_: Calendar day, plugin session

**Business Hours**:
The business-user-owned weekly schedule, with at most two potentially overnight intervals per day, that automatically opens or closes order intake in the configured time zone without affecting accepted orders.
_Avoid_: User availability, plugin uptime

**Xianyu Business Account**:
A stable Xianyu selling identity owned by one business user and used as the scope for orders, intake state, business hours, automation configuration, and explicit upstream-account binding. It is independent of whichever plugin installation currently operates it.
_Avoid_: Plugin installation, current account snapshot

**Execution Authorization**:
The one approved plugin token currently permitted to operate a Xianyu business account. Replacing it invalidates the previous execution authorization without changing the account's order history or statistics, and a valid unassigned token may later operate another account.
_Avoid_: Order ownership, permanent token binding

**Account Override**:
An explicit Xianyu-business-account setting that replaces the business user's default operating configuration for that account only.
_Avoid_: Duplicate global configuration, inferred setting

**Published Configuration**:
An immutable operating version, such as pricing or reply rules, that affects only new business activity after publication and remains referenced by the quotes, orders, or messages it governed.
_Avoid_: Saved draft, mutable current setting

**Upstream Account Binding**:
The explicit LiangPiao account selected for new accepted orders of one Xianyu business account. Multiple Xianyu accounts may share it, but the system never selects or switches an upstream account implicitly.
_Avoid_: Runtime fallback, inferred provider account

**Collected Order**:
An order whose actual paid amount passed amount verification, counted by verification time and distinct from completed delivery.
_Avoid_: Completed order, payment signal

**Completed Order**:
An order whose Xianyu delivery completed successfully, counted by delivery time for completed revenue and realized profit.
_Avoid_: Collected order, ticket issued

**Realized Profit**:
Profit attributed only after successful Xianyu delivery; refunded orders and orders with an unknown delivery outcome do not contribute.
_Avoid_: Quoted profit, expected profit

**Automatic Completion**:
A collected order that reaches successful Xianyu delivery without a Manual Decision. Excluded orders remain separately visible and cannot silently improve the completion rate.
_Avoid_: Ticket issued, no current task

**Readiness Stop**:
A system-initiated stop to new order intake when a capability required for safe quote-to-delivery automation is unavailable. Capability recovery makes intake eligible to resume but does not resume it without the business user's confirmation.
_Avoid_: Plugin offline, automatic retry

**Xianyu Platform Order**:
An order created on Xianyu and linked to one conversation, item, buyer, seller account, and internal quote.
_Avoid_: Local order, payment message

**Quote**:
The project's price commitment for a requested ticket purchase before the buyer completes payment on Xianyu.
_Avoid_: Adjusted price, paid amount

**Adjusted Amount**:
The item amount Xianyu explicitly accepted in a successful seller price-adjustment operation.
_Avoid_: Quote, actual paid amount

**Actual Paid Amount**:
The deal amount reported by Xianyu's official order-detail price information after payment.
_Avoid_: Item original price, requested adjustment, inferred payment

**Payment Signal**:
A Xianyu message or summary that indicates a payment-related state but does not itself prove the actual paid amount.
_Avoid_: Payment proof, paid amount

**Amount Verification**:
The decision that the quote, adjusted amount, and actual paid amount are identical and that postage is zero.
_Avoid_: Payment signal, best-effort match

**Manual Review**:
The order state used when automatic fulfillment cannot safely establish the required order association, protocol validity, or amount equality.
_Avoid_: Fallback fulfillment, assumed success

**Delivery Attempt**:
The single persisted authorization for an automated Xianyu delivery. It is created before any buyer message or Xianyu consign side effect and permanently prevents those side effects from being replayed while its outcome is unknown or already recorded.
_Avoid_: Delivery claim lease, retry window, in-memory delivery flag
