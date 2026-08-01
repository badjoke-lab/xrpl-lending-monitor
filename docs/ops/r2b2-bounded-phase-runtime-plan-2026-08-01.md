# R2b2 bounded phase runtime plan — 2026-08-01

Status: controlling R2b2 implementation plan. R2b1, R2b2-A, R2b2-B0, R2b2-B1, and R2b2-C are complete on `main`. The candidate identity correction is complete in PR #1093. R2b2-D implementation and validation passed in PR #1094 and is pending merge. The parent R2 exit suite is next.

Controlling amendments:

- [`r2-scan-sequence-amendment-2026-08-01.md`](r2-scan-sequence-amendment-2026-08-01.md)
- [`r2b2-candidate-identity-persistence-amendment-2026-08-01.md`](r2b2-candidate-identity-persistence-amendment-2026-08-01.md)

R2b2 remains local and provider-neutral. It performs no remote deployment, production mutation, provider selection, Mainnet change, recovery, or soak work.

## Objective

Connect the completed components into one executable SQLite reference state machine:

```text
R1 planner and work schema
        +
R2a messages, leases, retry, outbox
        +
R2b1 normalized payload, digest, chunks
        ↓
scan -> commit -> commit ... -> finalize -> next scan
```

Each invocation executes one bounded phase. Candidate rows remain hidden until finalization commits.

## Transaction ownership

`PortableCollectorScheduler.completeWithSuccessor` owns the transaction that records one successful phase.

The storage layer exposes transaction-aware primitives that do not issue a nested `BEGIN`:

- `finalizeWorkInTransaction` performs all final guards, work commit, and watermark advancement inside the caller transaction;
- standalone `finalizeWork` opens a transaction and delegates;
- scan staging and commit methods are safe inside the scheduler-owned transaction;
- one injected exception rolls back phase mutation, message completion, and successor outbox together;
- no runtime path may call a transaction-opening store method from a scheduler mutation callback.

## Complete candidate identity

Every durable candidate preserves:

- semantic class and canonical key;
- source ledger index and hash;
- source transaction hash;
- object ID;
- canonical sorted relationship IDs;
- tombstone state;
- canonical value JSON.

Migration `10006_portable_reference_identity.sql`, typed reads, conflict checks, commit mapping, committed-only views, and runtime export version 3 enforce this envelope.

## Scan execution

The merged scan runtime:

1. claims one exact `scan` message;
2. verifies immutable-base or committed-watermark boundary and `scanSequence`;
3. detects reset and reads exact cost estimates;
4. runs the adaptive planner;
5. builds the normalized payload and deterministic chunks;
6. stages one work item and all payload chunks inside scheduler-owned completion;
7. reserves `commit:0` atomically;
8. leaves candidate rows, public visibility, and watermark unchanged.

Caught-up scans reserve the same boundary with sequence `+1`. Retry and lease recovery preserve the current sequence and ID. A blocked single ledger halts with no successor.

## Commit execution

The merged commit runtime:

1. claims the exact `commit` message;
2. loads exact typed work and payload-chunk snapshots;
3. verifies work status, sealed evidence, encoding, byte count, payload digest, chunk digest, work ID, chunk index, total count, record count, source-ledger range, canonical order, and identity uniqueness;
4. requires the message chunk to be the first unresolved chunk unless already completed;
5. decodes no more than 40 records and records no more than 40 operations;
6. maps each normalized record to one complete work-scoped candidate identity;
7. inserts candidate rows and completes commit evidence inside scheduler-owned completion;
8. reserves the next commit or finalize message atomically;
9. leaves public visibility and the watermark unchanged.

An already completed scheduler message returns its retained result and repeats no mutation. An injected storage interruption rolls back candidate rows, commit evidence, current-message completion, and successor outbox before scheduling the exact same message identity for retry.

## Finalize execution

The R2b2-D finalize runtime:

1. claims the exact `finalize` message;
2. reads work, all payload chunks, commit evidence, and work-scoped candidate rows;
3. verifies work is sealed and every expected payload and commit chunk exists;
4. decodes chunks in exact contiguous index order and verifies encoding, byte and record counts, total count, per-chunk digest, and full payload digest;
5. reconstructs all seven semantic groups;
6. rebuilds the normalized payload and verifies semantic counts, work ID, network, epoch, base, range, parent boundary, and final hash;
7. compares every durable candidate field to the verified normalized candidate;
8. builds the deterministic next scan from the new committed boundary with `scanSequence = 0`;
9. calls `completeWithSuccessor` with a mutation callback that invokes `finalizeWorkInTransaction`;
10. commits work visibility, watermark advancement, finalize-message completion, and next-scan outbox atomically.

A duplicate finalize moves neither work nor watermark twice. Any integrity mismatch halts with no successor. Retryable storage interruption preserves the exact finalize identity and rolls back every visibility, watermark, message, and outbox mutation.

## Runtime result and failure handling

A portable phase runtime returns one of:

- `completed` with retained phase result and successor identity;
- `duplicate` with retained result;
- `retry_scheduled` for `retryable_transport` or `retryable_storage`;
- `halted` with an exact terminal classification;
- `unavailable` for no ready message or a fresh lease;
- `lease_lost` without acknowledging another owner’s work.

No generic exception is silently converted to success. Unknown errors become `terminal_internal` with no successor.

## Implementation sequence

### R2b2-A — Transaction-aware store

Complete in PR #1088, merge `56dfe67cf969ac29357e7d49970da8b4027eba27`.

### R2b2-B0 — Repeated scan identity

Contract complete in PR #1089, merge `51238a35184f5b4815fa79c1144df92ebe8d77a4`.

Implementation complete in PR #1090, merge `bcb812b9001ea0e47cd2571e2ed3209c450cf84f`.

### R2b2-B1 — Fixture execution and scan

Complete in PR #1091, merge `7d1f50fa621b650efe0aae14fa074a2aff1ed8f3`.

### R2b2-C — Commit runtime

Complete in PR #1092, merge `fb40f9400760b00b7d0dfb69cf4392f16e61ff08`.

### Candidate identity persistence correction

Complete in PR #1093, merge `9fb931f78b7ea605d52cee8292728d3d48eb868a`.

Delivered the append-only identity migration, complete durable identity envelope, commit correction, and strict runtime export version 3.

### R2b2-D — Finalize runtime

Status: **implementation and validation passed in PR #1094; merge pending**.

Delivered:

- exact full-payload reconstruction and seven-class survival verification;
- complete semantic-count, network, epoch, base, range, hash, candidate, and commit-evidence validation;
- transaction-aware finalization inside scheduler-owned completion;
- atomic committed visibility, watermark advancement, and next-scan sequence `0` reservation;
- duplicate-finalize convergence;
- integrity halt and retryable-storage rollback;
- runtime v3 finalize resumption;
- staged, committing, and committed export/restore parity.

Retained validation from CI run `30698259104` passed workflow guard, lint, type-check, production runner checks, complete unit suite, clean migration sequence, application build, and browser smoke.

The corrective CI findings were limited to a helper type boundary and one scan fixture that had not applied migration `10006`. Neither correction weakened the runtime contract.

## Parent R2 exit suite

Status: **next after PR #1094 merges to `main`**.

A dedicated orchestration suite must prove:

- sparse `scan -> commit -> finalize -> next scan`;
- dense multi-chunk `scan -> commit ... -> finalize -> next scan`;
- all seven semantic classes end to end;
- no early visibility or cursor advance;
- scan, commit, and finalize rollback after injected interruption;
- retry and stale-lease recovery preserve exact phase identity;
- duplicate phase and outbox dispatch convergence;
- reset, epoch, base, parent-hash, digest, and resource halt with no successor;
- staged, committing, and committed export/restore resumption;
- no hosted-provider SDK import;
- lint, type-check, complete unit suite, all migrations, build, and browser smoke.

R2 and R2b2 are complete only after that parent suite passes and merges to `main` with retained evidence.
