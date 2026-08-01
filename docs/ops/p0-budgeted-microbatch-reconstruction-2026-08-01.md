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
- deterministic base-plus-overlay current reads during legacy compatibility;
- hybrid immutable/live historical reads during legacy compatibility;
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
- `PublicationAdapter`;
- a bounded maintenance boundary.

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

## Reader and source-isolation contract

Portable public-read candidates are bound to one committed read fence containing network, epoch, base, ledger index, ledger hash, and committed work ID.

- one response uses one source and one read fence;
- one cursor is valid for one source, query, order, and fence;
- portable and legacy rows are never mixed inside one response;
- integrity and identity failures fail closed and never trigger silent legacy fallback;
- public authority remains legacy until a later explicit cutover gate;
- R3 may run bounded shadow comparisons but cannot change public authority.

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

Long-lived history remains in deterministic immutable segments and exact indexes. Publication reads committed work only, verifies ledger/hash, candidate identity, and semantic counts, writes a candidate publication, independently reopens and verifies it, and advances the publication watermark only after verification.

Compaction requires committed collection, verified publication, an explicit retention rule, and a bounded replay-safe mutation plan. Upload success alone never authorizes deletion.

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

### R2 — Portable scan/commit/finalize runtime

Status: **complete** in PR #1095, merge `fb90cbbd3a44337dc0891552f3618581cfc31e1c`.

Implemented units:

- typed messages and durable scheduler: PR #1084;
- normalized payload, digest, and chunks: PR #1086;
- transaction-aware reference store: PR #1088;
- repeated scan identity contract and implementation: PRs #1089/#1090;
- fixture execution and bounded scan runtime: PR #1091;
- bounded commit runtime: PR #1092;
- complete candidate identity persistence and runtime export version 3: PR #1093;
- identity-complete finalize runtime: PR #1094;
- durable parent orchestration exit: PR #1095.

Final R2 CI run `30698715057` passed workflow guard, lint, type-check, production runner checks, complete unit suite, clean migration sequence, build, and browser smoke.

### R3 — Adapter and reader integration

Status: **active under `ops/r3-adapter-reader-integration-plan-2026-08-01.md`**.

#### R3 contract

Status: **active on branch `agent/r3-adapter-reader-contract`**.

The contract defines:

- provider-neutral storage, scheduler, execution, publication, and maintenance boundaries;
- reusable adapter and reader conformance suites;
- committed read fences and source-bound cursors;
- generic committed lookup, listing, ledger-range, and relationship reads;
- strict seven-class product mappers;
- explicit legacy-only and shadow-compare operation before any portable public cutover;
- no mixed-source response and no silent integrity fallback;
- verified publication before publication-watermark advance or maintenance authorization;
- canonical cross-adapter export and restore.

#### R3A — Adapter interfaces and SQLite conformance

- introduce interfaces and SQLite wrappers without changing R2 behavior;
- move composed transaction ownership behind one reference runtime adapter;
- run the R2 suites through interfaces;
- prove no provider SDK import.

#### R3B — Committed generic reader

- implement read fences, exact and relationship lookup, semantic and ledger-range listing, stable pagination, and fence-bound cursors;
- expose no public route.

#### R3C — Product mappers and shadow compatibility

- implement seven strict product mappers;
- add source descriptors and bounded shadow comparison;
- keep legacy public authority.

#### R3D — Publication and maintenance separation

- introduce publication and maintenance interfaces;
- adapt deterministic local publication builders to candidate and independent verification phases;
- execute no remote write.

#### R3E — Cross-adapter export, restore, and parent exit

- prove canonical state transfer, reader behavior after restore, publication/maintenance state transfer, and complete R3 conformance.

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
