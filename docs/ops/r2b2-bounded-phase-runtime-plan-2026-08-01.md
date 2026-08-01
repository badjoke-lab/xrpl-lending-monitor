# R2b2 bounded phase runtime plan — 2026-08-01

Status: controlling R2b2 implementation plan. R2b1 is complete in PR #1086. R2b2-A is complete in PR #1088, merge `56dfe67cf969ac29357e7d49970da8b4027eba27`. R2b2-B is active after the repeated-scan identity amendment is merged.

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

R2b2-A proved these boundaries with real SQLite and is complete on `main`.

## Required storage reads

The reference store provides exact typed reads for:

- complete work identity and sealed scan evidence;
- one payload chunk by work ID and chunk index;
- all payload chunks in index order;
- completed commit chunks and expected counts;
- candidate rows for one work item;
- the committed watermark or explicit initial boundary.

Runtime code does not issue ad hoc SQL.

## Initial and repeated scan boundary

A scan message is accepted when either:

1. the committed watermark exactly equals its expected previous ledger and hash; or
2. no watermark exists and the message exactly equals the configured immutable-base boundary.

Any other state is `stale_boundary` or `base_mismatch`. The runtime never silently replans from another cursor.

Every scan message also carries `scanSequence`:

- initial immutable-base scan: `0`;
- first scan after watermark advancement: `0`;
- caught-up successor from the same boundary: current sequence `+ 1`;
- retry or stale-lease reclaim: unchanged sequence and message ID.

The sequence is not wall-clock time or an attempt count. It exists only to distinguish repeated logical wake-ups at one unchanged committed boundary.

## Fixture execution adapter

The reference `FixtureExecutionAdapter` supplies:

- configured network, epoch, base identity, and immutable-base boundary;
- deterministic clock and successor timing policy;
- validated head;
- contiguous ledger cost estimates for the R1 planner;
- normalized source candidates for an exact selected range;
- injected retryable transport/storage failures;
- injected reset, epoch, base, parent-hash, digest, resource, and interruption failures;
- request, byte, record, and elapsed counters.

The adapter imports no hosted-provider SDK and performs no live network request.

## Scan execution

1. claim one `scan` message;
2. verify its exact boundary and non-negative `scanSequence`;
3. read the fixture validated head and estimates;
4. run the R1 adaptive planner;
5. collect and validate the selected ledger range;
6. build the R2b1 normalized payload and deterministic chunks;
7. precompute the commit count and successor `commit:0`;
8. call `completeWithSuccessor` with one mutation callback that:
   - creates the deterministic work item;
   - stages every encoded payload chunk with its chunk digest;
   - seals final ledger/hash, semantic counts, full payload digest, and exact chunk counts;
9. commit message completion and successor outbox atomically;
10. leave committed visibility and the watermark unchanged.

Caught-up scan behavior:

- complete the current message with a caught-up result;
- reserve a future scan at the same ledger/hash boundary;
- set successor `scanSequence = current scanSequence + 1`;
- keep retry and lease recovery on the current unchanged sequence;
- write no work item and advance no watermark.

A single-ledger resource halt records a terminal result and no successor.

## Commit execution

1. claim the exact `commit` message;
2. read and decode its exact payload chunk;
3. verify work ID, payload digest, chunk digest, chunk index, total count, and record order;
4. reject a non-next unresolved chunk unless it is already completed;
5. map each record to one work-scoped reference row using canonical value JSON;
6. enforce at most 40 row mutations and the operation budget;
7. call `completeWithSuccessor` with one mutation callback that:
   - inserts candidate rows idempotently;
   - completes the commit chunk with retained digest and counts;
8. reserve the next commit message or finalize message atomically.

An already completed chunk repeats no candidate mutation and converges on the retained successor.

## Finalize execution

1. claim the exact `finalize` message;
2. read work, all payload chunks, commit evidence, and candidate rows;
3. decode every chunk and verify contiguous indexes, total count, per-chunk digests, and one full payload digest;
4. reconstruct the seven semantic groups;
5. rebuild the normalized payload and verify semantic counts, range, parent boundary, final hash, network, epoch, base, and work ID;
6. verify every expected commit chunk is complete;
7. build the deterministic next scan message from the new boundary with `scanSequence = 0`;
8. call `completeWithSuccessor` with one mutation callback that invokes `finalizeWorkInTransaction`;
9. commit work visibility, watermark advancement, message completion, and next-scan outbox atomically.

A duplicate finalize moves neither work nor watermark twice.

## Runtime result and failure handling

A `PortableCollectorPhaseRuntime` returns one of:

- `completed` with retained phase result and successor identity;
- `duplicate` with retained result;
- `retry_scheduled` for `retryable_transport` or `retryable_storage`;
- `halted` with an exact terminal classification;
- `unavailable` for no ready message or a fresh lease;
- `lease_lost` without acknowledging another owner’s work.

No generic exception is silently converted to success. Unknown errors become `terminal_internal` with no successor.

## Implementation sequence

### R2b2-A — Transaction-aware store

Status: **complete** in PR #1088, merge `56dfe67cf969ac29357e7d49970da8b4027eba27`.

Delivered:

- typed work/chunk/candidate read snapshots;
- `finalizeWorkInTransaction` plus standalone wrapper;
- tests proving no nested transaction and exact rollback.

Retained validation from CI runs `30694527924` and `30694653827`:

- workflow guard, lint, type-check, complete unit suite, clean migration sequence, application build, and browser smoke passed;
- caller-owned SQLite finalization completed without a nested `BEGIN`;
- an injected exception after storage finalization rolled back work status, committed visibility, and watermark advancement.

### R2b2-B0 — Repeated scan identity

Status: **active contract correction**.

- add `scanSequence` to the canonical scan message and identity;
- preserve sequence on retry and lease recovery;
- increment only for caught-up successors at the same boundary;
- reset to `0` after watermark advancement;
- pass message, scheduler, and export/restore regression tests.

### R2b2-B1 — Fixture execution and scan

Status: **next after R2b2-B0 merges to `main`**.

- fixture adapter;
- initial/watermark boundary checks;
- planner integration;
- normalized payload and chunk staging;
- caught-up successor and resource-halt behavior.

### R2b2-C — Commit runtime

- exact chunk decode and mapping;
- bounded candidate mutations;
- next-commit/finalize selection;
- duplicate and interruption convergence.

### R2b2-D — Finalize runtime

- full payload reconstruction and digest/count verification;
- transaction-aware finalization;
- committed-only visibility and next-scan reservation;
- staged, committing, and committed export/restore resumption.

## Exit tests

R2b2 is not complete until the complete repository suite proves:

- deterministic scan sequence identity and repeated caught-up wake-ups;
- retry and stale-lease recovery preserve scan identity;
- sparse scan -> commit -> finalize -> next scan;
- dense multi-chunk commit sequence;
- all seven semantic classes survive end to end;
- no early visibility or cursor advance;
- scan, commit, and finalize rollback after injected interruption;
- exact retry identity and stale-lease recovery;
- duplicate phase and dispatch convergence;
- reset, epoch, base, parent-hash, digest, and resource halt with no successor;
- staged, committing, and committed export/restore resumption;
- transaction-aware finalize without nested SQLite transactions;
- no provider SDK import;
- lint, type-check, complete unit suite, all migrations, build, and browser smoke.

R2 is complete only after all R2b2 units and parent-contract tests pass and merge to `main` with retained evidence.
