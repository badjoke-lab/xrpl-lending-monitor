# P0 Queue subrequest correction — 2026-07-31

## Scope

This change is a code-and-test correction only. Production remains stopped. It does
not authorize recovery, deployment, D1 writes, Queue delivery, cron, or qualification.

## Failure analysis

The 96-ledger fast-lane range does not have a constant invocation cost. WebSocket
ledger reads share one transport connection, but a pass also performs D1 state and
base reads, one data-dependent atomic history/current-projection commit, run metrics,
slot ownership, retention and capacity checks, optional promotion, and durable
successor publication. Richer ledger contents expand the commit statements. The
extended run proved that this total can exceed the Worker invocation subrequest limit
despite 97 other runs committing successfully.

The smallest retained fail-closed bound is 32 contiguous ledgers: this is the prior
production recovery profile documented after the 64-ledger HTTP failure. Runtime
configuration now rejects any larger fast-lane range. Later deliveries continue at
the committed cursor plus one, so reducing the range changes throughput rather than
coverage semantics.

## Retry protection

- Caught subrequest-limit exhaustion is terminal for the delivery.
- The slot stores the error classification when D1 remains available.
- No successor is staged or sent, and the delivery is acknowledged.
- Transient D1 connection loss remains retryable with a five-minute delay and the
  configured maximum of three retries.
- A retry reclaims the same errored slot. Cursor atomicity makes it either replay the
  uncommitted range or observe the committed cursor; it cannot intentionally skip a
  ledger.

## Production-no-change evidence

The implementation activity performed only local repository commands and local
validation. No command targeted a remote D1 database or the deployment API.

- production Worker deploy: **no**
- production D1 mutation: **no**
- Queue resumed: **no**
- cron enabled: **no** (`wrangler.jsonc` retains an empty cron list)
- new qualification started: **no**

Production state supplied at issue entry remains authoritative: active Worker version
`0d7eb873`, Queue paused, backlog purged, and cron empty.
