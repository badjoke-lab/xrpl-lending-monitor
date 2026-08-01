# History runtime contract

Status: P0 implementation contract. This document controls the reconstructed collector and does not certify release readiness.

## Product invariant

XRPL Lending Monitor preserves two truths without conflating them:

1. **current state** resolved from one verified immutable base plus the newest committed contiguous overlay changes; and
2. **historical evidence** for supported Lending transactions, normalized object changes, Loan lifecycle events, deleted final states, and asset-scoped debt, cover, and loss changes.

Only validated Devnet ledgers are in scope. Mainnet remains disabled.

No recovery implementation may remove a semantic class, skip a ledger, weaken provenance, or expose partially committed work.

## Portability invariant

The collector core must not depend on one scheduler, queue, serverless runtime, hosted database, or operator console.

The core owns:

- deterministic adaptive scan planning;
- ledger and parent-hash continuity;
- semantic derivation;
- work, chunk, and finalize state transitions;
- committed-only visibility;
- retry, lease, reconciliation, and halt behavior;
- resource accounting expressed as implementation-neutral budgets.

Runtime-specific code is isolated behind explicit adapters:

- `StorageAdapter` for transactions, work records, chunks, canonical rows, watermarks, and health state;
- `SchedulerAdapter` for one-successor serialized execution, leases, retry timing, and wake-up;
- `ExecutionAdapter` for clocks, deadlines, resource counters, and network transport;
- `PublicationAdapter` for immutable history and active-channel updates.

SQLite is the reference storage implementation for local and CI proof. Remote storage and scheduling implementations are optional deployment profiles and must pass the same contract tests before production use.

## Runtime paths

| Path | Trigger | Responsibility | Persistence | Public role |
|---|---|---|---|---|
| Budgeted collector state machine | One serialized scheduler profile | Alternate adaptive scan, resumable commit, and atomic finalize work; maintain contiguous ledger/hash identity | collector work/chunks, committed live history, current overlay versions, cursor, metrics | Fresh live tail and current-state continuation |
| Protected full collector | Approved real UTC protected slots only | Produce the existing canonical full semantic evidence path without being invoked by synthetic recovery work | processed ledgers, protocol events, changes, lifecycle, archives, balance history, canonical overlay and cursor | Canonical live history and integrity witness |
| Immutable history publication | Scheduled and threshold-triggered publication workflow | Convert committed contiguous history into deterministic immutable segments and exact indexes | immutable history assets and publication manifests | Long-lived history through the published boundary |
| Hybrid API merge | Public read request | Verify immutable source, read committed live rows after the boundary, deduplicate, order, and bound results | Read-only | Activity, object history, lifecycle, archive, cover/loss, exports, feeds |
| Maintenance and compaction | Bounded maintenance unit | Archive, compact, reconcile, and prune only after committed/publication guards pass | hot-row compaction, retention and archive watermarks | Keep the active store below its stop threshold without semantic loss |

## Retired fixed-range contract

The prior one-invocation contract—fetch a fixed number of ledgers, derive every semantic class, write all live state, update overlay, run retention, publish a successor, and then declare the range safe—is retired.

Production proved that ledger contents make persistence cost variable. A fixed count such as 32 is not a deterministic request, query, write, CPU, or byte budget.

Changing the ledger count alone is not an accepted repair.

## Serialization contract

The active scheduler profile must provide:

- one logical producer;
- one serialized consumer or equivalent single-owner lease;
- one work phase per invocation;
- exactly one successor after each successful invocation;
- bounded, versioned control messages containing only work identifiers and phase cursors;
- complete payloads in bounded storage chunks, never in scheduler messages;
- idempotent convergence for duplicate wake-ups;
- no synthetic recovery wake-up capable of invoking the protected full collector.

A deployment profile may implement this with a managed queue, a durable local runner, or another scheduler. The observable contract is identical.

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
8. stores deterministic compressed payload chunks and exact counts/digests through `StorageAdapter`;
9. advances no public cursor or watermark.

The initial test ceiling is 48 ledgers. It is only a scan ceiling and may be reduced by actual content budgets. It is not a persistence safety claim.

### Commit

Commit work:

1. claims the next uncommitted payload chunk;
2. writes no more than the configured query, statement, row, and byte budgets;
3. tags every candidate canonical/history/current row with `work_id`;
4. records chunk completion idempotently;
5. schedules another commit phase when data remains;
6. schedules finalization only after all expected chunks are complete.

The reference profile starts with at most 40 storage operations and 40 canonical row mutations per invocation. A deployment adapter may impose stricter limits. A single content-heavy ledger may span multiple commit invocations. No semantic class may be discarded to fit one invocation.

### Finalize

Finalization is one bounded atomic storage transaction that verifies:

- all expected payload and commit chunks exist and are complete;
- start and end ledger indexes are exact;
- first parent hash and final ledger hash match the contiguous committed chain;
- network, epoch, and active base identities remain unchanged;
- semantic counts and payload digests match scan evidence;
- current/history candidate rows reference the same `work_id`;
- no earlier unresolved work blocks the same cursor.

Only then may finalization:

- mark the work `committed`;
- advance the live cursor;
- advance the committed current/history watermark;
- record terminal run metrics;
- select and publish the next state-machine wake-up.

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

Cadence is an execution-profile parameter, not a collector-core dependency.

### Catch-up target

- a profile must sustain committed throughput above 30 ledgers/minute;
- successful phases may run more frequently than the public freshness interval;
- catch-up continues only while terminal lag is positive and measured resource guards retain headroom.

### Steady target

- a profile must sustain committed throughput above 21 ledgers/minute at p95 windows;
- the committed cursor must remain within five minutes of the validated head;
- the scheduler must preserve one-owner serialization and bounded retry behavior.

A configured scheduler without a valid successor or lease holder is halted, not healthy.

## Failure behavior

- never skip a failed ledger;
- never advance a cursor or public watermark for partial work;
- stop on hash discontinuity, reset signal, epoch mismatch, base mismatch, digest mismatch, resource guard, or publication conflict;
- retry only retryable phases with the same `work_id` and exact phase cursor;
- do not redo completed commit chunks;
- abandon stale work only through a deterministic lease and reconciliation process;
- leave public reads on the last committed boundary with truthful stale/halted metadata;
- retain machine-readable evidence for every mutating recovery.

## Maintenance and immutable publication

Maintenance is not part of scan or commit invocations.

A publication unit:

1. reads committed history after the immutable watermark;
2. verifies complete ledger/hash and semantic-count continuity;
3. builds deterministic compressed segments and exact indexes;
4. publishes immutable artifacts;
5. verifies them independently;
6. advances the publication watermark through a guarded privileged path;
7. authorizes bounded hot-store compaction only after verification.

Existing Git-backed immutable history remains the cold-history path. Publication automation is not the normal collection scheduler.

## Deployment-profile contract

No remote deployment profile is approved by documentation alone.

Each candidate profile must prove:

- the same SQLite reference tests and adapter conformance suite;
- exact transactional finalization and committed-only reads;
- serialized wake-up, duplicate convergence, retry, lease, and halt behavior;
- XRPL WebSocket compatibility;
- export and recovery without provider-specific data loss;
- measured CPU, request, query, write, storage, and cadence headroom;
- no mandatory paid runtime dependency and fail-closed behavior before any configured operating ceiling;
- automated deployment, rollback, checkpoint, and evidence paths without routine interactive operator steps.

The current Cloudflare deployment is a halted legacy production profile. It remains evidence and rollback context, not the controlling architecture.

## Qualification gates

No new 24-hour soak may begin until all of the following pass:

1. SQLite reference and CI heavy-ledger, retry, duplicate, interruption, reset, and rollback fixtures;
2. storage and scheduler adapter conformance tests;
3. migration and legacy-read compatibility tests;
4. one staged shadow work item from scan through finalize on the selected remote profile;
5. fixed two-hour catch-up qualification with zero resource-limit errors;
6. sustained catch-up throughput above 30 ledgers/minute;
7. terminal lag zero;
8. automatic transition to the selected steady cadence;
9. twelve consecutive five-minute freshness checkpoints with sustained throughput above 21 ledgers/minute;
10. current/history/immutable semantic parity;
11. selected-profile request, query, write, storage, CPU, memory, scheduler, and error budgets within the controlling resource envelope;
12. independent immutable audit retention armed before the fixed soak boundary.

A final 24-hour audit must prove the complete ledger chain, semantic counts and witnesses, committed-only visibility, unchanged runtime identities, no hidden partial work, and no-cost operating headroom. HTTP 200 or lag zero alone is insufficient.
