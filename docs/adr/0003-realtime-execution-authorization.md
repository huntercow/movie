---
status: accepted
---

# Use a fenced realtime channel for plugin execution

The extension and backend will maintain an authenticated WebSocket channel for realtime presence, structured capability reports, notifications, and safe control-plane messages. Every execution authorization has a server-issued generation; replacing the authorized token or plugin session atomically advances that generation, closes the old connection, and causes all stale HTTP and WebSocket commands to fail even if the old plugin missed its disconnect message. HTTP heartbeat remains a last-activity signal, while WebSocket presence alone never means Automation Readiness.

The control plane may stop or resume order intake, request a fresh capability report, and refresh published configuration. It must not remotely initiate price adjustment, order creation, payment verification, ticket-code delivery, or replay an external action with an unknown outcome.
