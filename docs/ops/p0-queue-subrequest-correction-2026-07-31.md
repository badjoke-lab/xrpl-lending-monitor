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

That recovery artifact measured two sampled 32-ledger passes at about 6.8 seconds,
with 32 logical reads per pass and no failures. The WebSocket transport uses one
connection per pass; the 32-ledger cap additionally bounds the input to the
data-dependent atomic commit. This correction does not claim that sparse-ledger
success makes content cost constant: the runtime guard and terminal exhaustion path
remain mandatory.

## Catch-up throughput and cadence

The fixed 12-slot window advanced from validated ledger 4,070,712 to 4,071,636 across
11 intervals: 924 / 11 = 84 ledgers per five minutes. A five-minute 32-ledger cadence
would lose 52 ledgers per interval and is rejected.

While the committed cursor remains behind the latest observed validated head, the
durably staged successor is scheduled one minute later. Five bounded invocations have
nominal capacity for 160 ledgers per five minutes, exceeding the observed rate by 76
ledgers (about 1.9x). Once a pass observes lag zero, its successor is the next normal
five-minute boundary. Each invocation still runs only one 32-ledger pass.

Catch-up deliveries carry `queue-catch-up`. The protected collector gate rejects that
discriminator even at a four-hour timestamp. Queue batch size and concurrency remain
one, so successor slots serialize rather than overlap; the collector continues to
derive every range from committed cursor + 1.

Successor staging persists the discriminator together with its timestamp before Queue
publication. If publication fails, the retry republishes both staged values without
recomputing cadence from a new lag assumption. Consequently a recovered normal
`queue-self-schedule` successor still permits the protected collector at a four-hour
boundary, while a recovered synthetic `queue-catch-up` successor still suppresses it.

The maximum sustained catch-up schedule is 1,440 Queue deliveries/day. That is a
design ceiling, not authorization to consume it: a separate production recovery review
must accept measured daily D1, CPU, Queue, and invocation use before delivery resumes.

## Retry protection

- Caught subrequest-limit exhaustion is terminal for the delivery.
- The slot stores the error classification when D1 remains available.
- No successor is staged or sent, and the delivery is acknowledged.
- Transient D1 connection loss remains retryable with a five-minute delay and the
  configured maximum of three retries.
- A retry reclaims the same errored slot. Cursor atomicity makes it either replay the
  uncommitted range or observe the committed cursor; it cannot intentionally skip a
  ledger.
- A retry after successor staging does not rerun the pass: it republishes the exact
  staged timestamp and cadence, then completes the owning slot.

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
