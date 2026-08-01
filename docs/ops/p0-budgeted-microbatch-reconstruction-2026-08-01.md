# P0 budgeted microbatch collector reconstruction — 2026-08-01

Status: controlling recovery design and implementation schedule. This document supersedes the fixed-ledger-count Queue recovery described by PRs #1069–#1078 and Issues #1072/#1079.

## Decision

The existing Queue collector is not approved for further production recovery.

Production proved that:

- a five-minute fixed 32-ledger pass cannot match the observed Devnet arrival rate; and
- a one-minute fixed 32-ledger pass can still exceed an invocation limit because persistence cost depends on ledger contents.

A fixed ledger count is not a resource budget. The replacement collector budgets actual operations, makes heavy-ledger work resumable, and remains portable across execution and storage profiles.

No hosted runtime, database, queue, scheduler, or operator console is selected by this document.

## Documentation boundary

The repository records only technical and operational decisions:

- the collector core is provider-neutral;
- the current remote deployment is halted;
- future deployment profiles require qualification;
- the project must remain operable without a mandatory paid runtime dependency.

Non-technical operator circumstances are outside the repository specification.

## Non-negotiable product invariants

The reconstruction retains:

- every validated ledger after the active immutable base, with no intentional gap;
- protocol events for every supported Lending transaction type;
- normalized object before/after changes;
- Loan lifecycle events;
- deleted-object final states and archive history;
- debt, cover, and loss history;
- current Vault, LoanBroker, and Loan projection changes;
- exact transaction, object, relationship, epoch, ledger, hash, and provenance identities;
- deterministic base-plus-overlay current reads;
- hybrid immutable/live historical reads;
- truthful stale, halted, partial, reset, and unavailable states;
- Devnet-only and Mainnet-disabled operation;
- read-only public behavior with no wallet, signing, or transaction submission.

The public freshness requirement remains five minutes. Internal work may run more frequently.

## Architecture boundary

The portable core owns:

- adaptive contiguous scan planning;
- XRPL ledger and parent-hash validation;
- semantic normalization;
- deterministic chunk construction;
- work lifecycle and phase transitions;
- atomic finalization;
- committed-only current/history visibility;
- retry, lease, duplicate, reconciliation, and halt semantics;
- provider-neutral resource accounting.

Runtime-specific code is isolated behind:

- `StorageAdapter`;
- `SchedulerAdapter`;
- `ExecutionAdapter`;
- `PublicationAdapter`.

SQLite is the reference storage implementation. A durable local scheduler is the reference scheduler implementation. Remote implementations are deployment profiles and must pass the same conformance suite.

## Retired runtime

The following contract is retired:

```text
one hosted invocation
  -> fetch a fixed number of ledgers
  -> derive every semantic class
  -> write current/history/metrics/retention/successor
  -> advance the cursor
```

Changing `32` to another fixed ledger count is not an accepted repair.

## Approved state machine

```text
scan
  -> commit
  -> commit (only when another chunk is required)
  -> finalize
  -> scan
```

Maintenance and immutable publication are separate bounded operations.

### Scan

- verify the exact committed or initial boundary;
- read the validated head;
- plan a content-budgeted contiguous range;
- derive all supported semantic classes;
- stage deterministic bounded payload chunks;
- advance no public cursor or watermark;
- reserve the first commit phase atomically with scan completion.

### Commit

- decode one exact staged chunk;
- verify work, payload, chunk, range, digest, and complete candidate identity;
- write no more than the configured operation and row-mutation budgets;
- complete the chunk idempotently;
- reserve the next commit or finalize phase atomically.

### Finalize

- reconstruct and verify every payload and commit chunk;
- verify counts, digests, candidate identity, range, hashes, network, epoch, and base identity;
- atomically commit work, advance the watermark, expose rows, complete the current message, and reserve the next scan.

No candidate row is public before finalization.

## Reference guards

- scan candidate ceiling: 48 ledgers;
- commit row-mutation ceiling: 40 records;
- reference storage-operation ceiling: 40 operations;
- payload chunk ceiling: 512,000 encoded bytes;
- scheduler message ceiling: 16,000 encoded bytes;
- no cursor or public watermark advancement during partial work.

These are reference guards, not production-provider limits.

## Scheduler contract

The scheduler provides:

- one serialized owner;
- deterministic versioned messages;
- bounded leases and stale-lease recovery;
- exact retry identity;
- one durable timed successor outbox entry per successful phase;
- idempotent duplicate completion and dispatch;
- terminal halt with no successor for identity, hash, digest, reset, or resource failures.

GitHub Actions is not the normal collection scheduler. It remains available for CI, immutable publication, evidence, and bounded repair workflows.

## Resource and throughput gates

Observed Devnet advance was approximately 84 ledgers per five minutes, or 16.8 ledgers/minute.

A production profile is not approved unless retained evidence proves:

- steady committed throughput above 21 ledgers/minute at p95 windows;
- catch-up committed throughput above 30 ledgers/minute;
- no content-heavy ledger permanently blocks the cursor;
- scheduler, runtime, storage, and network operations remain inside project guards;
- hot storage remains below its stop threshold;
- request, query, write, CPU, memory, row-size, message-size, and hidden-partial-work errors remain zero;
- exact export and restore preserve work, cursor, hash, current, history, scheduler, and provenance identities;
- the selected profile has no mandatory paid runtime dependency and fails closed before an operating ceiling.

Provider limits are deployment-profile inputs, not collector-core invariants.

## Storage and immutable publication

The hot store contains bounded work, chunks, committed live history, current overlay versions, tombstones, indexes, watermarks, health, and reconciliation state.

Long-lived history remains in deterministic Git-backed immutable segments and exact indexes. Publication reads committed work only, verifies ledger/hash and semantic counts, publishes immutable assets, advances the publication watermark through a guarded path, and authorizes compaction only after independent verification.

Publication automation does not own the normal collection clock.

## Deployment-profile qualification

Before remote recovery, a profile must prove:

1. storage and scheduler adapter conformance;
2. XRPL WebSocket compatibility;
3. transactional finalization;
4. committed-only reads;
5. exact export and restore into the reference format;
6. duplicate, retry, lease, interruption, and restart recovery;
7. measured catch-up and steady throughput;
8. measured no-cost operating headroom;
9. fail-closed behavior at every project stop threshold;
10. automated deploy, rollback, checkpoint, and evidence paths without routine interactive operator steps.

No provider is selected until these checks pass.

## Implementation schedule

Dates are planning targets, not claims of completion.

### R0 — Contract and portability reset

Status: **complete** in PR #1081, merge `c077e7b16b8b08213bbadcc5e927bba0f9472f6c`.

### R1 — Reference schema and deterministic planner

Status: **complete** in PR #1082, merge `85f42e665a5e6f2f519cd372718b9c41c16b3f68`.

Delivered portable work/chunk/candidate/watermark schema, deterministic adaptive planning, SQLite reference storage, committed-only visibility, atomic finalization, and exact export/restore.

### R2 — Portable scan/commit/finalize runtime

Status: **implementation and validation passed in PR #1095; merge pending**.

Controlling contract: PR #1083, merge `bd1ac985de908bd2f01089304c202ab47d368c9b`.

Implemented units:

- typed messages and durable scheduler: PR #1084, merge `f68aea25f6d3b973ceec79e09288fdf626f33bdc`;
- normalized payload, digest, and chunks: PR #1086, merge `70f0e79632c51521ff1d6f85d445c797c515c429`;
- transaction-aware reference store: PR #1088, merge `56dfe67cf969ac29357e7d49970da8b4027eba27`;
- repeated scan identity contract and implementation: PRs #1089/#1090, merges `51238a35184f5b4815fa79c1144df92ebe8d77a4` and `bcb812b9001ea0e47cd2571e2ed3209c450cf84f`;
- fixture execution and bounded scan runtime: PR #1091, merge `7d1f50fa621b650efe0aae14fa074a2aff1ed8f3`;
- bounded commit runtime: PR #1092, merge `fb40f9400760b00b7d0dfb69cf4392f16e61ff08`;
- complete candidate identity persistence and runtime export version 3: PR #1093, merge `9fb931f78b7ea605d52cee8292728d3d48eb868a`;
- identity-complete finalize runtime: PR #1094, merge `d1a50ba5988da7222a32f69d1593712fc4bd7f12`.

Parent exit evidence in PR #1095 proves sparse and dense durable chains, all seven classes, no early visibility, exact identity, staged/committing/committed resumption, interruption rollback and retry, lease and duplicate convergence, terminal scan gates, idempotent outbox dispatch, provider-neutral imports, and complete ordinary CI.

Retained validation from CI run `30698568464` passed workflow guard, lint, type-check, production runner checks, complete unit suite, clean migration sequence, build, and browser smoke.

R2 is complete only after PR #1095 merges to `main`.

### R3 — Adapter and reader integration

Status: **next after PR #1095 merges**.

Required work:

- formal adapter interfaces and conformance fixtures;
- committed-only current and history readers over work-scoped rows;
- legacy read compatibility and explicit cutover rules;
- bounded maintenance and immutable publication separation;
- cross-adapter export and restore;
- no hosted provider selection or production mutation.

### R4 — Deployment-profile qualification

- qualify candidates through read-only and shadow evidence;
- reject mandatory paid runtime dependencies, automatic paid overage, inadequate export, or routine interactive operation.

### R5 — Controlled recovery

- deploy only a qualified profile;
- prove one staged work item, rollback, restore, and a fixed two-hour catch-up qualification.

### R6 — Lag-zero and steady qualification

- reach lag zero;
- pass twelve consecutive five-minute freshness checkpoints;
- remain inside the measured no-cost envelope.

### R7 — Formal operation evidence

- arm independent immutable audit retention;
- pass a fixed 24-hour evidence window;
- pass seven days of continuous operation;
- only then reopen formal Devnet release qualification.

## Current production state

- the retired chain halted on `Too many subrequests`;
- recorded lag was 56,740 ledgers;
- no successor exists;
- Worker Cron is empty;
- no stabilization or 24-hour soak is active.

The current remote deployment is a halted legacy profile. Production remains fail-closed until a candidate profile passes R4 and an explicit R5 recovery is approved.
