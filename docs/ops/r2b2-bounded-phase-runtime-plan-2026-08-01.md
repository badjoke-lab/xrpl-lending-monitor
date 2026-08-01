# R2b2 bounded phase runtime plan — 2026-08-01

Status: controlling R2b2 implementation plan. R2b1, R2b2-A, R2b2-B0, and R2b2-B1 are complete on `main`. R2b2-C implementation and validation passed in PR #1092 and is pending merge. R2b2-D is next.

Controlling scan-identity amendment: [`r2-scan-sequence-amendment-2026-08-01.md`](r2-scan-sequence-amendment-2026-08-01.md).

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

- `finalizeWorkInTransaction` performs final guards, work commit, and watermark advancement inside the caller transaction;
- standalone `finalizeWork` opens a transaction and delegates;
- scan staging and commit methods are safe inside the scheduler-owned transaction;
- one injected exception rolls back phase mutation, message completion, and successor outbox together;
- no runtime path may call a transaction-opening store method from a scheduler mutation callback.

## Required storage reads

The reference store provides exact typed reads for:

- complete work identity and sealed scan evidence;
- one payload chunk by work ID and chunk index;
- all payload chunks in index order;
- completed commit chunks and expected counts;
- candidate rows for one work item;
- the committed watermark or explicit initial boundary.

Runtime code does not issue ad hoc SQL.

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

The R2b2-C commit runtime:

1. claims the exact `commit` message;
2. loads exact typed work and payload-chunk snapshots;
3. verifies work status, sealed evidence, encoding, byte count, payload digest, chunk digest, work ID, chunk index, total count, record count, source-ledger range, canonical order, and identity uniqueness;
4. requires the message chunk to be the first unresolved chunk unless already completed;
5. decodes no more than 40 records and records no more than 40 operations;
6. maps each normalized record to one deterministic work-scoped candidate row with canonical value JSON;
7. inserts candidate rows and completes commit evidence inside scheduler-owned completion;
8. reserves the next commit or finalize message atomically;
9. leaves public visibility and the watermark unchanged.

An already completed scheduler message returns its retained result and repeats no mutation. An injected storage interruption rolls back candidate rows, commit evidence, current-message completion, and successor outbox before scheduling the exact same message identity for retry.

## Finalize execution

R2b2-D must:

1. claim the exact `finalize` message;
2. read work, all payload chunks, commit evidence, and work-scoped candidate rows;
3. verify work is sealed and every expected payload/commit chunk exists;
4. decode chunks in exact contiguous index order and verify encoding, byte/record counts, total count, per-chunk digest, and one full payload digest;
5. reconstruct all seven semantic groups;
6. rebuild the normalized payload and verify semantic counts, work ID, network, epoch, base, range, parent boundary, final hash, and candidate rows;
7. build the deterministic next scan from the new committed boundary with `scanSequence = 0`;
8. call `completeWithSuccessor` with a mutation callback that invokes `finalizeWorkInTransaction`;
9. commit work visibility, watermark advancement, finalize-message completion, and next-scan outbox atomically.

A duplicate finalize moves neither work nor watermark twice. Any integrity mismatch halts with no successor. Retryable storage interruption preserves the exact finalize identity and rolls back every visibility/watermark/outbox mutation.

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

Delivered exact base/watermark boundary checks, adaptive scan planning, deterministic payload staging, caught-up sequence advancement, retry identity preservation, resource halt, rollback, and no early visibility.

### R2b2-C — Commit runtime

Status: **implementation and validation passed in PR #1092; merge pending**.

Delivered:

- exact work/chunk decode and integrity verification;
- strict first-unresolved chunk ordering;
- bounded 40-row and 40-operation candidate mutations;
- deterministic candidate-row mapping and commit evidence;
- atomic next-commit or finalize successor selection;
- completed-message duplicate convergence;
- wrong-index, digest-tamper, 41-record resource-halt, and storage-interruption rollback tests;
- no public visibility or watermark advancement before finalize.

Retained validation from CI run `30696015473` passed workflow guard, lint, type-check, production runner checks, complete unit suite, clean migration sequence, application build, and browser smoke.

### R2b2-D — Finalize runtime

Status: **next after PR #1092 merges to `main`**.

Required work:

- exact full-payload reconstruction and seven-class survival verification;
- complete semantic-count, identity, hash, candidate-row, and commit-evidence validation;
- transaction-aware finalization;
- atomic committed visibility, watermark advancement, and next-scan sequence `0` reservation;
- duplicate-finalize convergence;
- integrity-halt and retryable-storage rollback;
- staged, committing, and committed export/restore resumption.

## Exit tests

R2b2 is not complete until the complete repository suite proves:

- deterministic scan sequence identity and repeated caught-up wake-ups;
- retry and stale-lease recovery preserve phase identity;
- sparse scan -> commit -> finalize -> next scan;
- dense multi-chunk commit sequence;
- all seven semantic classes survive end to end;
- no early visibility or cursor advance;
- scan, commit, and finalize rollback after injected interruption;
- duplicate phase and dispatch convergence;
- reset, epoch, base, parent-hash, digest, and resource halt with no successor;
- staged, committing, and committed export/restore resumption;
- transaction-aware finalize without nested SQLite transactions;
- no provider SDK import;
- lint, type-check, complete unit suite, all migrations, build, and browser smoke.

R2 is complete only after R2b2-D and all parent-contract tests pass and merge to `main` with retained evidence.
