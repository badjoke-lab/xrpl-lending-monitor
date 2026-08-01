# History runtime contract

Status: P0 implementation contract. This document controls the reconstructed collector and does not certify release readiness.

## Product invariant

XRPL Lending Monitor preserves two truths without conflating them:

1. **current state** resolved from one verified immutable base plus the newest committed contiguous overlay changes; and
2. **historical evidence** for supported Lending transactions, normalized object changes, Loan lifecycle events, deleted final states, and asset-scoped debt, cover, and loss changes.

Only validated Devnet ledgers are in scope. Mainnet remains disabled.

No recovery implementation may remove a semantic class, skip a ledger, weaken provenance, or expose partially committed work.

## Runtime paths

| Path | Trigger | Responsibility | Persistence | Public role |
|---|---|---|---|---|
| Budgeted Queue state machine | One Queue producer and one single-concurrency consumer | Alternate adaptive scan, resumable commit, and atomic finalize work; maintain contiguous ledger/hash identity | collector work/chunks, committed live history, current overlay versions, cursor, metrics | Fresh live tail and current-state continuation |
| Protected full collector | Approved real UTC protected slots only | Produce the existing canonical full semantic evidence path without being invoked by synthetic recovery work | processed ledgers, protocol events, changes, lifecycle, archives, balance history, canonical overlay and cursor | Canonical D1 history and integrity witness |
| Immutable history publication | Scheduled and threshold-triggered GitHub Actions | Convert committed contiguous history into deterministic immutable segments and exact indexes | GitHub-backed immutable history assets and publication manifests | Long-lived history through the published boundary |
| Hybrid API merge | Public read request | Verify immutable source, read committed live rows after the boundary, deduplicate, order, and bound results | Read-only | Activity, object history, lifecycle, archive, cover/loss, exports, feeds |
| Maintenance and compaction | Bounded state-machine or GitHub Actions unit | Archive, compact, reconcile, and prune only after committed/publication guards pass | hot-row compaction, retention and archive watermarks | Keep D1 below the project stop threshold without semantic loss |

## Retired fixed-range contract

The prior one-invocation contract—fetch a fixed number of ledgers, derive every semantic class, write all D1 state, update overlay, run retention, publish a successor, and then declare the range safe—is retired.

Production proved that ledger contents make persistence cost variable. A fixed count such as 32 is not a deterministic subrequest or D1-query budget.

## Queue serialization contract

- one Queue;
- one producer binding;
- one push consumer;
- `max_batch_size = 1`;
- `max_concurrency = 1`;
- exactly one successor message after each successful invocation;
- messages contain only versioned control fields and work identifiers;
- complete payloads remain in bounded D1 staging chunks, not Queue messages;
- duplicate messages converge through work identity and phase identity;
- no synthetic message may trigger the protected full collector.

## Work lifecycle

Every ledger range is owned by one immutable `work_id` scoped to network, epoch, active base identity, start ledger, and expected parent hash.

Allowed states:

```text
planned -> scanning -> staged -> committing -> finalizing -> committed
                                      \-> error
                                      \-> abandoned
```

Only `committed` work is visible to public current or historical readers.

### Scan

Scan work:

1. reads the committed cursor and latest validated head;
2. selects an adaptive contiguous candidate range;
3. opens one approved XRPL WebSocket transport;
4. fetches validated ledgers and transaction metadata;
5. validates parent-hash continuity;
6. derives every supported semantic class and current projection mutation;
7. stops before configured transaction, normalized-byte, payload-byte, CPU, wall-time, or external-request limits;
8. stores deterministic compressed payload chunks and exact counts/digests;
9. advances no public cursor or watermark.

The initial candidate ceiling is 48 ledgers. It is only a scan ceiling and may be reduced by actual content budgets. It is not a persistence safety claim.

### Commit

Commit work:

1. claims the next uncommitted payload chunk;
2. writes no more than the configured D1 query, statement, row, and byte budgets;
3. tags every candidate canonical/history/current row with `work_id`;
4. records chunk completion idempotently;
5. schedules another commit phase when data remains;
6. schedules finalization only after all expected chunks are complete.

Initial invocation guard: at most 40 D1 queries/statements and 40 canonical row mutations. A single content-heavy ledger may span multiple commit invocations. No semantic class may be discarded to fit one invocation.

### Finalize

Finalization is one bounded atomic D1 batch that verifies:

- all expected payload and commit chunks exist and are complete;
- start and end ledger indexes are exact;
- first parent hash and final ledger hash match the contiguous committed chain;
- network, epoch, and active base identities remain unchanged;
- semantic counts and payload digests match scan evidence;
- current/history candidate rows reference the same `work_id`;
- no earlier unresolved work blocks the same cursor.

Only then may finalization:

- mark the work `committed`;
- advance the fast-lane cursor;
- advance the committed current/history watermark;
- record terminal run metrics;
- select and publish the next state-machine message.

If finalization fails, the prior cursor and public watermark remain authoritative.

## Committed-only visibility

### Current projection

Current overlay rows are versioned by `work_id`. Public readers select only rows whose owning work is committed. The newest committed projection wins. A newest committed tombstone suppresses an older overlay or immutable-base object.

Partial current mutations are never visible. Maintenance may compact superseded committed versions only after rollback and immutable-publication requirements pass.

### Historical evidence

Protocol events, normalized object changes, lifecycle events, archives, balance history, and compressed live-tail bundles carry `work_id`. Hybrid readers include only committed work and continue to deduplicate by existing canonical identities.

### Legacy compatibility

During migration, readers continue to accept legacy canonical rows and `gzip-base64-v1:` live-tail bundles. New work-scoped rows must not duplicate or hide valid legacy evidence.

## Semantic history matrix

| History class | Scan derivation | Work-scoped commit | Immutable publication | Hybrid API |
|---|---:|---:|---:|---:|
| Validated ledger and hash coverage | Yes | Yes | Yes | Status/audit evidence |
| Protocol events | Yes | Yes | Yes | Activity, exports, feed |
| Object before/after changes | Yes | Yes | Yes | Object history, transaction detail |
| Loan lifecycle | Yes | Yes | Yes | Lifecycle explorer |
| Deleted-object final state | Yes | Yes | Yes | Archived objects |
| Debt/Cover/Loss history | Yes | Yes | Yes | Cover & Loss |
| Current projection mutation | Yes | Versioned by work | Not current truth | Current entity APIs |

## Cadence contract

### Catch-up

- successor delay: 30 seconds;
- maximum expected successful messages: 2,880/day;
- projected normal Queue operations: 8,640/day;
- catch-up continues only while terminal lag is positive and daily resource guards retain headroom.

### Steady

- successor delay: 60 seconds;
- maximum expected successful messages: 1,440/day;
- projected normal Queue operations: 4,320/day;
- committed cursor must remain within five minutes of the validated head.

The cadence is internal. The public requirement remains five-minute freshness. A resumed Queue without a valid successor is halted, not healthy.

## Failure behavior

- never skip a failed ledger;
- never advance a cursor or public watermark for partial work;
- stop on hash discontinuity, reset signal, epoch mismatch, base mismatch, digest mismatch, resource guard, or publication conflict;
- retry only retryable phases with the same `work_id` and exact phase cursor;
- do not redo completed commit chunks;
- abandon stale work only through a deterministic lease and reconciliation process;
- leave public reads on the last committed boundary with truthful stale/halted metadata;
- record every mutating recovery in retained GitHub Actions evidence and the controlling Issue.

## Maintenance and immutable publication

Maintenance is not part of scan or commit invocations.

A GitHub Actions publication unit:

1. reads committed history after the immutable watermark;
2. verifies complete ledger/hash and semantic-count continuity;
3. builds deterministic compressed segments and exact indexes;
4. publishes immutable artifacts;
5. verifies them independently;
6. advances the publication watermark through a guarded privileged endpoint;
7. authorizes bounded D1 compaction only after verification.

No R2 dependency is introduced. Existing GitHub-backed history remains the cold-history path.

## Deployment contract

The owner is not required to use a local terminal or Cloudflare dashboard.

Migration, deployment, Queue pause/purge/seed/resume, rollback, checkpoints, and publication must be performed by exact-SHA guarded GitHub Actions using the production-writer concurrency group. Every branch of a mutating workflow must leave machine-readable pre/post evidence and fail closed.

## Qualification gates

No new 24-hour soak may begin until all of the following pass:

1. local and CI heavy-ledger, retry, duplicate, interruption, reset, and rollback fixtures;
2. migration and legacy-read compatibility tests;
3. one staged production work item from scan through finalize;
4. fixed two-hour catch-up qualification with zero resource-limit errors;
5. sustained catch-up throughput above 30 ledgers/minute;
6. terminal lag zero;
7. automatic transition to 60-second steady mode;
8. twelve consecutive five-minute freshness checkpoints with sustained throughput above 21 ledgers/minute;
9. current/history/immutable semantic parity;
10. Queue, Worker, D1 read/write, storage, CPU, memory, and error budgets within the controlling resource envelope;
11. independent immutable audit retention armed before the fixed soak boundary.

A final 24-hour audit must prove the complete ledger chain, semantic counts and witnesses, committed-only visibility, unchanged runtime identities, no hidden partial work, and Free-plan headroom. HTTP 200 or lag zero alone is insufficient.