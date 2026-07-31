---
status: accepted
---

# Keep platform governance separate from ticket operations

The business user is the product's primary operator; the administrator only manages user accounts, client-authorization approval, expiry, revocation, and governance audit. Administrators must not access quotes, Xianyu conversations, buyers, orders, amounts, profit, ticket codes, upstream business orders, or business notifications. This requires removing the existing administrator-wide order query rather than merely hiding it in the console, and using a separate administrator information architecture and search index.
