# R2 portable scan/commit/finalize runtime contract — 2026-08-01

Status: controlling R2 implementation contract. This document refines the R2 unit in [`p0-budgeted-microbatch-reconstruction-2026-08-01.md`](p0-budgeted-microbatch-reconstruction-2026-08-01.md). It does not approve a remote deployment profile or production recovery.

## Purpose

R1 proved the portable work schema, adaptive planner, atomic committed-only finalization, and complete SQLite export/restore format.

R2 connects those primitives into a provider-neutral runtime that can execute exactly one bounded phase per invocation:

```text
scan -> commit -> commit ... -> finalize -> scan
```

The runtime must be fully testable with SQLite, deterministic fixtures, and a durable local scheduler. It must import no hosted-provider SDK and perform no production mutation.

## R2 boundaries

R2 includes:

- typed, versioned phase messages;
- deterministic phase and message identity;
- a durable SQLite scheduler reference;
- single-owner leases and deterministic stale-lease recovery;
- an atomic successor outbox;
- scan-only staging through the portable storage boundary;
- bounded, resumable, idempotent commit chunks;
- atomic finalization and next-scan selection;
- exact retry, duplicate, interruption, reset, and parent-hash failure behavior;
- one normalized payload envelope containing every supported semantic class.

R2 does not include:

- a hosted scheduler, queue, database, or serverless adapter;
- a remote migration or deployment;
- live production XRPL collection;
- public API cutover to work-scoped rows;
- hot-store compaction or immutable publication advancement;
- Mainnet;
- stabilization, catch-up qualification, or soak work.

Those remain later-stage work under R3–R7.

## Typed phase messages

All scheduler payloads use schema version `1`, canonical JSON, and no complete ledger or semantic payload.

### Scan message

```ts
interface ScanPhaseMessageV1 {
  schemaVersion: 1
  phase: 'scan'
  messageId: string
  network: string
  epochId: string
  baseIdentity: string
  expectedPreviousLedgerIndex: number
  expectedPreviousLedgerHash: string
}
```

A scan message is valid only while the committed watermark exactly matches its expected previous ledger index and hash. A mismatch is a terminal stale-boundary result. The runtime must not silently replan from a different cursor.

### Commit message

```ts
interface CommitPhaseMessageV1 {
  schemaVersion: 1
  phase: 'commit'
  messageId: string
  workId: string
  chunkIndex: number
}
```

The chunk index identifies the exact next commit unit. A duplicate message for an already completed chunk converges without repeating canonical mutations.

### Finalize message

```ts
interface FinalizePhaseMessageV1 {
  schemaVersion: 1
  phase: 'finalize'
  messageId: string
  workId: string
}
```

Finalization may run only after every expected payload and commit chunk is complete.

### Message identity

Message identity is deterministic and independent of delivery attempts:

```text
scan:v1:<network>:<epoch>:<base>:<previous-ledger>:<previous-hash>
commit:v1:<work-id>:<chunk-index>
finalize:v1:<work-id>
```

Scheduler delivery IDs, retry counts, lease owners, and transport metadata are not semantic identity and must not alter the message payload.

Every canonical message must remain below the reference 16,000-byte guard. An oversized or unknown-version message is rejected before any work mutation.

## Normalized payload envelope

Scan derivation produces a deterministic `NormalizedCollectorPayloadV1` containing every supported class:

```ts
interface NormalizedCollectorPayloadV1 {
  schemaVersion: 1
  workId: string
  ledgers: ValidatedLedgerEvidence[]
  protocolEvents: ProtocolEventCandidate[]
  objectChanges: ObjectChangeCandidate[]
  loanLifecycleEvents: LoanLifecycleCandidate[]
  archivedObjects: ArchivedObjectCandidate[]
  balanceHistory: BalanceHistoryCandidate[]
  currentProjectionMutations: CurrentProjectionCandidate[]
  semanticCounts: SemanticCountsV1
  digest: string
}
```

Requirements:

- ledger indexes and hashes are contiguous;
- the first parent hash matches the work boundary;
- the final ledger hash matches sealed scan evidence;
- every candidate retains canonical transaction, object, relationship, ledger, hash, epoch, and provenance identities applicable to its class;
- semantic counts are derived from the exact payload;
- canonical serialization and digest are deterministic;
- payload chunking never drops, reorders semantically ordered records, or removes a class to fit a budget;
- one content-heavy ledger may require multiple payload and commit chunks;
- empty classes are represented explicitly in counts rather than omitted from the contract.

R2 tests may use deterministic fixtures, but fixtures must exercise all seven payload groups. R3 later connects the committed rows to public hybrid readers and adapter conformance.

## Storage runtime contract

R2 builds on the R1 SQLite schema and reference store. The runtime-facing storage boundary must support at least:

- read the exact committed watermark for network, epoch, and base identity;
- create or load one deterministic work item;
- stage deterministic payload chunks idempotently;
- seal scan evidence and expected chunk counts;
- claim the next commit chunk without stealing an unexpired owner;
- write bounded candidate rows tagged by `work_id`;
- complete a commit chunk idempotently;
- atomically finalize work and advance the committed watermark;
- record terminal or retryable phase results;
- reserve exactly one successor in the scheduler outbox;
- export and restore all work, scheduler, outbox, cursor, and candidate state.

No public cursor or committed watermark may advance during scan or commit.

## Durable local scheduler reference

The reference scheduler is persisted in SQLite and is not an in-memory test queue.

It stores:

- canonical message ID and payload;
- status: `pending`, `leased`, `completed`, or `error`;
- available time;
- lease owner and lease expiry;
- delivery-attempt count;
- last error classification and message;
- deterministic result metadata;
- current message to successor relationship.

### Claim

A claim succeeds only for one available `pending` message or one `leased` message whose lease has expired. Claiming records a bounded lease owner and expiry atomically.

A fresh lease cannot be stolen. A stale lease may be reclaimed without changing message identity or phase cursor.

### Success

Completing a phase and reserving its successor must be one atomic storage transaction:

1. verify current lease ownership;
2. persist phase result and any work/chunk/finalize mutation;
3. insert exactly one deterministic successor into the outbox;
4. mark the current scheduler message completed;
5. commit all four effects together.

After commit, a local dispatcher moves the outbox entry into the scheduler inbox idempotently. A crash before dispatch leaves the durable outbox entry available. A crash after insert but before acknowledgement converges by deterministic successor message ID.

### No successor

Terminal failures, stale-boundary rejection, reset signals, identity mismatch, digest mismatch, and configured resource halts complete or error the current message without reserving a successor. The runtime is then truthfully halted.

### Retry

Retryable failures preserve the same message ID and exact phase cursor. They clear or expire the lease, increase the attempt count, and set a bounded future availability time. They do not create a new work item, repeat completed commit chunks, or advance a cursor.

## Phase behavior

### Scan phase

One scan invocation:

1. validates message schema and size;
2. claims the message lease;
3. verifies the expected committed boundary exactly;
4. reads the validated head through `ExecutionAdapter`;
5. obtains deterministic per-ledger cost estimates;
6. runs the R1 adaptive planner;
7. fetches and validates only the selected contiguous range;
8. derives all semantic classes into `NormalizedCollectorPayloadV1`;
9. stages bounded payload chunks and exact digests;
10. seals the work without advancing the committed watermark;
11. atomically completes the scan message and reserves `commit:0`.

If the committed cursor is already at the validated head, the phase records a caught-up result and reserves the next scan wake-up selected by the scheduler policy. Cadence selection remains a scheduler-profile concern.

If one ledger exceeds the configured scan budget, the phase records a blocked-heavy-ledger result and halts. R2 must not skip it or silently reduce semantic evidence.

### Commit phase

One commit invocation:

1. validates and claims the exact commit message;
2. loads the exact staged payload chunk and its deterministic digest;
3. verifies the work is staged or committing and the chunk is the next unresolved unit;
4. writes no more than the reference 40 storage operations and 40 canonical candidate row mutations;
5. records the chunk complete idempotently;
6. reserves the next commit chunk when data remains;
7. otherwise reserves finalization.

An already completed chunk returns its retained result and converges on the same successor without repeating candidate mutations.

### Finalize phase

One finalize invocation:

1. validates and claims the message;
2. verifies every payload and commit chunk;
3. verifies exact semantic counts and payload digests;
4. verifies network, epoch, base identity, previous ledger/hash, full range, and final hash;
5. atomically marks the work committed and advances the watermark;
6. records terminal metrics;
7. reserves the next scan message from the new committed boundary.

A duplicate finalization returns the retained committed result and converges on the same next scan identity.

## Execution adapter reference

R2 uses a deterministic fixture execution adapter rather than a hosted network runtime.

The adapter supplies:

- monotonic test clock and wall-clock timestamps;
- deadline and cancellation signals;
- validated-head identity;
- per-ledger cost estimates;
- ledger, transaction, and AffectedNodes fixtures;
- injected retryable and terminal failures;
- reset, epoch mismatch, base mismatch, parent-hash mismatch, and interruption points;
- resource counters for requests, bytes, records, and elapsed budget units.

The portable runtime must depend only on this interface. Live XRPL WebSocket integration is qualified later as part of a deployment profile.

## Failure classification

R2 uses explicit classifications:

- `retryable_transport`;
- `retryable_storage`;
- `lease_lost`;
- `stale_boundary`;
- `parent_hash_mismatch`;
- `reset_detected`;
- `epoch_mismatch`;
- `base_mismatch`;
- `digest_mismatch`;
- `resource_halt`;
- `invalid_message`;
- `terminal_internal`.

Only the first two are automatically delayed and retried. `lease_lost` returns without applying or acknowledging another owner's work. Every other classification halts the chain until a separately recorded reconciliation or repair.

## Required interruption and convergence tests

R2 is not complete until local and CI tests prove at least:

1. sparse multi-ledger scan -> commit -> finalize -> next scan;
2. dense/content-heavy range split into multiple payload and commit chunks;
3. one oversized ledger halts without cursor advancement;
4. interruption after payload staging but before scan completion;
5. interruption after candidate writes but before commit-chunk completion;
6. interruption after outbox reservation but before dispatch;
7. duplicate scan, commit, finalize, and outbox dispatch convergence;
8. retryable transport and storage failure with the same message identity;
9. fresh lease theft rejection and stale lease recovery;
10. reset, epoch mismatch, base mismatch, and parent-hash mismatch halt behavior;
11. digest and semantic-count mismatch rejection;
12. no hidden candidate row before finalization;
13. no repeated completed commit mutation;
14. exact export/restore during staged, committing, and committed states;
15. every supported semantic payload class survives chunking, restore, and finalization;
16. no hosted-provider SDK import in the portable runtime.

## R2 exit

R2 passes only when:

- the typed message and payload contracts are implemented;
- the SQLite scheduler, lease, outbox, and dispatcher are durable and deterministic;
- scan, commit, and finalize each execute one bounded phase;
- all required interruption and convergence tests pass in the complete repository suite;
- all existing migrations, lint, type-check, build, and browser smoke remain green;
- implementation status and the controlling schedule retain exact evidence;
- no production, remote storage, queue, cron, deployment, or Mainnet change occurs.

R2 completion does not select a provider and does not authorize R3, R4, or production recovery until its merge is recorded on `main`.
