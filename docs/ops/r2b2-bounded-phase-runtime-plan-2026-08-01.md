# R2b2 bounded phase runtime plan — 2026-08-01

Status: controlling R2b2 implementation plan. R2b1, R2b2-A, and R2b2-B0 are complete on `main`. R2b2-B1 implementation and validation passed in PR #1091 and is pending merge. R2b2-C is next.

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

Any other state is `stale_boundary` or `parent_hash_mismatch`. The runtime never silently replans from another cursor.

Every scan message carries required non-negative `scanSequence`:

- initial immutable-base scan: `0`;
- first scan after watermark advancement: `0`;
- caught-up successor from the same boundary: current sequence `+ 1`;
- retry or stale-lease reclaim: unchanged sequence and message ID.

The sequence is not wall-clock time or an attempt count. It distinguishes repeated logical wake-ups at one unchanged committed boundary.

## Fixture execution adapter

The reference `FixtureExecutionAdapter` supplies:

- configured network, epoch, base identity, and immutable-base boundary;
- deterministic successor and retry timing;
- validated head;
- contiguous ledger cost estimates for the R1 planner;
- normalized source candidates for an exact selected range;
- injected retryable transport/storage and terminal failures;
- request, range, selected-ledger, record, and staging counters.

The adapter imports no hosted-provider SDK and performs no live network request.

## Scan execution

1. claim one `scan` message;
2. verify its exact boundary and non-negative `scanSequence`;
3. read the fixture validated head;
4. halt with `reset_detected` when the head precedes the boundary;
5. read exact contiguous cost estimates and run the R1 adaptive planner;
6. collect and validate the selected ledger range;
7. build the R2b1 normalized payload and deterministic chunks;
8. precompute the commit count and successor `commit:0`;
9. call `completeWithSuccessor` with one mutation callback that:
   - creates the deterministic work item;
   - stages every encoded payload chunk with its chunk digest;
   - seals final ledger/hash, semantic counts, full payload digest, and exact chunk counts;
10. commit message completion and successor outbox atomically;
11. leave candidate rows, committed visibility, and the watermark unchanged.

Caught-up scan behavior:

- complete the current message with a caught-up result;
- reserve a future scan at the same ledger/hash boundary;
- set successor `scanSequence = current scanSequence + 1`;
- keep retry and lease recovery on the current unchanged sequence;
- write no work item and advance no watermark.

A single-ledger resource halt records a terminal result and no successor.

R2b2-B1 proves this scan behavior with real SQLite and remains pending merge in PR #1091.

## Commit execution

1. claim the exact `commit` message;
2. load the exact work and payload chunk;
3. verify work status, chunk index, encoding, payload digest, chunk digest, total chunk count, and canonical record order;
4. reject a non-next unresolved chunk unless it is already completed;
5. decode at most 40 records and map each to one work-scoped reference row using canonical value JSON;
6. enforce the storage-operation, row-mutation, and byte budgets;
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

Status: **complete** in PR #1088, merge `56dfe67cf969ac29357e7d49970da8b4027eba27`.

Delivered:

- typed work/chunk/candidate read snapshots;
- `finalizeWorkInTransaction` plus standalone wrapper;
- tests proving no nested transaction and exact rollback.

Retained validation from CI runs `30694527924` and `30694653827` passed the complete normal CI suite.

### R2b2-B0 contract — Repeated scan identity

Status: **complete** in PR #1089, merge `51238a35184f5b4815fa79c1144df92ebe8d77a4`.

### R2b2-B0 implementation — Scan sequence messages

Status: **complete** in PR #1090, merge `bcb812b9001ea0e47cd2571e2ed3209c450cf84f`.

Delivered:

- required `scanSequence` field and canonical identity component;
- initial/post-finalize sequence `0` semantics;
- distinct caught-up wake-up IDs from one boundary;
- retry and stale-lease identity preservation;
- strict invalid-sequence and changed-identity rejection;
- exact runtime export/restore retention;
- unchanged commit and finalize identities.

### R2b2-B1 — Fixture execution and scan

Status: **implementation and validation passed in PR #1091; merge pending**.

Delivered:

- deterministic fixture execution adapter and counters;
- exact immutable-base and committed-watermark boundary checks;
- reset detection and R1 planner integration;
- normalized payload and chunk construction;
- atomic work/chunk staging and commit-successor outbox reservation;
- caught-up successor using sequence `+1`;
- exact retry identity for transport and storage failures;
- single-ledger resource halt;
- no early candidate visibility or watermark advancement;
- scan mutation rollback after an injected storage interruption.

Retained validation from CI run `30695623746`:

- workflow guard, lint, type-check, complete unit suite, clean migration sequence, application build, and browser smoke passed;
- the first CI attempt exposed two terminal-classification narrowing errors, corrected without weakening any failure rule.

### R2b2-C — Commit runtime

Status: **next after PR #1091 merges to `main`**.

- exact chunk decode and identity verification;
- bounded candidate mutations;
- next-commit/finalize selection;
- duplicate, retry, wrong-index, digest, resource, and interruption convergence.

### R2b2-D — Finalize runtime

- full payload reconstruction and digest/count verification;
- transaction-aware finalization;
- committed-only visibility and next-scan reservation with sequence `0`;
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
