## Issue

- Closes:
- Scope and acceptance criteria:

## Test Plan

- [ ] Backend unit/contract tests
- [ ] MySQL/Flyway integration gate (when affected)
- [ ] Web tests and build (when affected)
- [ ] Extension tests, typecheck and build (when affected)
- [ ] Manual acceptance steps (when affected)

## TDD Evidence

### Red

<!-- Test name, command, expected reason, and actual failure. If existing behavior was already correct, record `existing implementation verified` instead of inventing a failure. -->

### Green

<!-- Same test command and passing result. -->

### Refactor

<!-- Refactor performed while tests remained green, or `none`. -->

## Validation

<!-- List exact commands and results. Include known warnings and any unavailable environment gate. -->

## Manual Acceptance

<!-- Give reproducible steps, expected result, and attach only redacted evidence. -->

## Risks / Rollback

- Risks:
- Rollback plan:

## Security and Data Safety

- [ ] No real token, cookie, password, key, ticket code, buyer data, or raw upstream response added.
- [ ] Authorization and user-scope boundaries were checked.
- [ ] Protocol changes fail fast on unknown or malformed responses.
