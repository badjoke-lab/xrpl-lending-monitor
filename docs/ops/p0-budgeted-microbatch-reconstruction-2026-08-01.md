# P0 budgeted microbatch collector reconstruction — 2026-08-01

Status: controlling recovery design and implementation schedule. This document supersedes the fixed-ledger-count Queue recovery described by PRs #1069–#1078 and Issues #1072/#1079.

## Decision

The existing Queue collector is not approved for further production recovery.

Production evidence proved both of the following:

- five-minute delivery with a fixed 32-ledger pass cannot match the observed Devnet arrival rate;
- one-minute delivery with the same fixed 32-ledger pass can still exceed the Worker invocation subrequest limit because persistence cost depends on ledger contents.

A fixed ledger count is therefore not a resource budget. The replacement collector must budget actual operations, make heavy-ledger work resumable, and remain portable across execution and storage profiles.

No hosted runtime, database, queue, scheduler, or operator console is selected by this document.

## Documentation boundary

This repository records only the technical and operational decision:

- the collector core must be provider-neutral;
- the current remote deployment is halted;
- future deployment profiles require qualification;
- the project must remain operable without a mandatory paid runtime dependency.

Non-technical operator circumstances are outside the repository specification.

## Non-negotiable product invariants

The reconstruction does not reduce public functionality or semantic evidence.

It must retain:

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

The five-minute product freshness requirement remains. Internal work may run more frequently.

## Architecture boundary

The collector is split into a portable core and deployment adapters.

### Portable core

The core owns:

- adaptive contiguous scan planning;
- XRPL ledger and parent-hash validation;
- semantic normalization;
- deterministic chunk construction;
- work lifecycle and phase transitions;
- atomic finalization rules;
- committed-only current/history visibility;
- retry, lease, duplicate, reconciliation, and halt semantics;
- provider-neutral resource accounting.

The core imports no hosted-provider SDK.

### Required adapters

- `StorageAdapter`: atomic transactions, work/chunk persistence, canonical candidate writes, committed reads, watermarks, health state, export, and restore;
- `SchedulerAdapter`: serialized ownership, wake-up, successor publication, retry delay, lease expiry, and duplicate convergence;
- `ExecutionAdapter`: clock, deadline, resource counters, XRPL transport, and cancellation;
- `PublicationAdapter`: immutable segment/index publication and active-channel advancement.

SQLite is the reference storage implementation. A durable local scheduler is the reference scheduler implementation. They are used to prove semantics in local and CI tests, not as an automatic production choice.

Remote implementations are deployment profiles. They may use different infrastructure only when they pass the same conformance suite.

## Retired runtime

The following design is retired:

```text
one hosted invocation
  -> fetch a fixed number of ledgers
  -> derive every semantic class
  -> write current/history/metrics/retention/successor
  -> advance the cursor
```

Changing `32` to another fixed ledger count is not an accepted repair. A sparse range can pass while a content-heavy range exceeds the same invocation budget.

## Approved state machine

```text
scan
  -> commit
  -> commit (only when another chunk is required)
  -> finalize
  -> scan
```

Periodic maintenance and immutable publication are separate bounded operations. They never run inside the ledger scan invocation.

### Scan phase

The scan phase:

1. reads the committed contiguous cursor and active base/epoch identity;
2. reads the latest validated head;
3. opens one XRPL WebSocket connection through `ExecutionAdapter`;
4. fetches a candidate contiguous range after the cursor;
5. normalizes every supported semantic class without writing canonical rows;
6. stops before configured transaction, decoded-byte, normalized-byte, CPU, wall-time, or external-request budgets;
7. writes one work record plus bounded compressed payload chunks through `StorageAdapter`;
8. schedules the first commit phase through `SchedulerAdapter`.

The candidate range is adaptive. Initial test ceiling: 48 ledgers. The accepted ceiling is determined by measured scan-only CPU, bytes, transaction count, and worst-case evidence, not by desired throughput.

### Commit phase

The commit phase:

1. loads one staged work item and its next uncommitted chunk;
2. applies no more than the configured storage-operation, row-write, and byte budgets;
3. writes canonical candidate records tagged with `work_id`;
4. records chunk completion idempotently;
5. schedules another commit phase when chunks remain;
6. otherwise schedules finalization.

Initial reference guards:

- no more than 40 storage operations per invocation;
- no more than 40 canonical row mutations per invocation;
- no staged payload chunk larger than 512,000 encoded bytes;
- no scheduler message larger than 16,000 bytes;
- no cursor or public watermark advancement during partial commit.

A deployment adapter may use stricter guards. A single content-heavy ledger may span multiple commit invocations. No semantic class is removed to make it fit.

### Finalize phase

Finalization is one small atomic storage transaction that:

- verifies every expected chunk is complete;
- verifies start ledger, end ledger, parent hashes, final hash, network, epoch, and base identity;
- verifies semantic counts and payload digests;
- marks the work item committed;
- advances the contiguous live cursor and public committed watermark;
- records bounded run metrics;
- selects the next state-machine phase.

Canonical/history/current rows written by commit phases are invisible to public readers until their owning `work_id` is committed. Failed or abandoned work never becomes public truth.

## Current and history visibility

Current projection rows are versioned by `work_id`. Public reads select the newest committed version. A committed tombstone suppresses an older base or overlay object.

Historical records and compressed live-tail bundles also carry `work_id`. Hybrid APIs read only committed work. Existing canonical identity keys remain authoritative for deduplication.

During migration, readers continue to accept legacy canonical rows and `gzip-base64-v1:` live-tail bundles.

## Scheduler contract

The scheduler profile must provide:

- one logical producer;
- one serialized consumer or equivalent single-owner lease;
- one bounded phase per invocation;
- exactly one successor after success;
- bounded versioned control messages;
- payloads stored outside the message;
- idempotent duplicate convergence;
- bounded retry and deterministic lease recovery;
- no synthetic wake-up capable of invoking protected full collection.

GitHub Actions is not the normal collection scheduler. It remains available for CI, immutable publication, retained evidence, and bounded repair workflows.

## Resource and throughput gates

Observed Devnet advance was approximately 84 ledgers per five minutes, or 16.8 ledgers/minute.

The reconstructed collector is not approved unless production-shaped evidence proves:

- steady-mode sustained committed throughput greater than 21 ledgers/minute at p95 windows;
- catch-up-mode sustained committed throughput greater than 30 ledgers/minute;
- no content-heavy ledger can permanently block the cursor;
- scheduler, runtime, storage, and network operations remain inside selected-profile project guards;
- physical hot storage remains below the selected-profile stop threshold;
- request, query, write, CPU, memory, row-size, and message-size errors remain zero in qualification windows;
- export and restore preserve exact work, cursor, hash, current, history, and provenance identities;
- the selected profile has no mandatory paid runtime dependency and fails closed before any configured operating ceiling.

Provider limits are profile inputs, not collector-core invariants.

## Storage and immutable publication

The active hot store contains:

- committed cursor and epoch/base identity;
- collector work and chunk state;
- bounded live-tail history;
- current overlay versions and tombstones;
- bounded indexes, health, and reconciliation state.

Long-lived semantic history continues through the existing Git-backed immutable segment and exact-index publication path.

A publication workflow:

1. reads only committed work after the immutable watermark;
2. produces deterministic compressed segment and index artifacts;
3. verifies ledger/hash and semantic counts;
4. publishes immutable assets;
5. advances the publication watermark through a guarded privileged path;
6. compacts hot history only after the published artifact is independently verified.

Publication automation does not own the normal collection clock.

## Deployment-profile qualification

Before any remote recovery, a candidate profile must prove:

1. storage and scheduler adapter conformance;
2. XRPL WebSocket compatibility;
3. transactional finalize behavior;
4. committed-only API reads;
5. exact export and restore into the SQLite reference format;
6. duplicate, retry, lease, interruption, and restart recovery;
7. measured catch-up and steady throughput;
8. measured no-cost operating headroom;
9. fail-closed behavior at every project stop threshold;
10. automated deploy, rollback, checkpoint, and evidence paths without routine interactive operator steps.

No provider is selected until these checks pass. A profile that fails is rejected without changing the collector core.

## Implementation schedule

Dates are planning targets, not claims of completion.

### R0 — Contract and portability reset — 2026-08-01

Status: **complete** in PR #1081 (`c077e7b16b8b08213bbadcc5e927bba0f9472f6c`).

Delivered:

- closed the obsolete 32-ledger checkpoint PR;
- updated runtime, resource, implementation-status, and recovery-schedule documents;
- retired provider-specific assumptions from the collector contract;
- defined adapter boundaries and reference implementations;
- froze new soak, promotion, and remote recovery work;
- recorded the halted production evidence and exact invariants.

Exit passed: source-of-truth documents agree, contain technical rationale only, and no hosted provider is the required architecture.

### R1 — Reference schema and deterministic planner — 2026-08-01 to 2026-08-02

Status: **complete** in PR #1082 (`85f42e665a5e6f2f519cd372718b9c41c16b3f68`).

Delivered:

- implementation-neutral work, payload-chunk, commit-chunk, reference-row, and committed-visibility schema;
- SQLite-first migration `10004_portable_collector_work.sql`;
- deterministic adaptive scan planning and provider-neutral resource accounting;
- content-heavy and oversized-single-ledger planning fixtures;
- real SQLite atomic-finalize and committed-only visibility tests;
- deterministic complete-state export and restoration into a second empty SQLite database;
- canonical byte-for-byte re-export parity after restore.

Retained validation:

- the workflow guard, lint, type-check, complete unit suite, complete local migration sequence, application build, and browser smoke passed;
- the clean local migration sequence included the new R1 migration after every existing migration;
- incomplete commit chunks did not expose rows or advance a watermark;
- discontinuous parent boundaries were rejected;
- repeated finalization converged idempotently;
- restore into a non-empty target was rejected.

The first CI attempt exposed one invalid discontinuity fixture outside its declared validated head. The fixture was corrected to test an actual missing ledger inside the declared range. No runtime guard or acceptance condition changed.

Exit passed: no partial work is publicly visible, no cursor advances before finalization, deterministic planning and replay pass, and complete state can be exported and restored.

### R2 — Portable scan/commit/finalize runtime — 2026-08-02 to 2026-08-03

Status: **active contract phase**. The controlling unit is [`r2-portable-runtime-contract-2026-08-01.md`](r2-portable-runtime-contract-2026-08-01.md). Runtime implementation begins only after that contract is merged to `main`.

Implementation unit:

- exact versioned scan, commit, and finalize message unions with deterministic IDs;
- one normalized payload envelope preserving all seven semantic groups;
- scan-only staging and exact work sealing;
- bounded resumable commit chunks;
- atomic finalization and next-scan selection;
- durable SQLite scheduler inbox, lease, stale-lease recovery, successor outbox, and idempotent dispatcher;
- explicit retryable and terminal failure classifications;
- deterministic fixture `ExecutionAdapter` with reset, identity, hash, digest, resource, and interruption injection;
- no hosted-provider SDK or remote mutation.

Exit requires every sparse, dense, oversized, interrupted, retried, duplicate, lease, outbox, reset, identity, parent-hash, digest, export/restore, and semantic-class survival test listed by the R2 contract, plus the complete repository CI suite.

### R3 — Adapter conformance, overlay, maintenance, and archive separation — 2026-08-03

- implement storage and scheduler adapter conformance suites;
- make current/history visibility conditional on committed work;
- add bounded compaction and retention jobs;
- preserve hybrid API behavior and legacy rows during migration;
- integrate immutable publication watermarking;
- prove cross-adapter export and restore.

Exit: SQLite reference, adapter parity, API parity, deterministic archive/replay, and restore tests pass with no semantic-count loss.

### R4 — Candidate deployment-profile qualification — after R3

- implement guarded deployment and rollback tooling for candidate profiles;
- run read-only and shadow probes before any production mutation;
- test cadence, XRPL transport, transactional storage, export, recovery, and fail-closed limits;
- reject profiles with a mandatory paid runtime dependency, automatic paid overage, inadequate export, or routine interactive operation;
- select no production profile until retained evidence passes.

Exit: at least one candidate profile passes the conformance and shadow gates. Production remains halted.

### R5 — Controlled shadow and production recovery — after R4

- deploy only the selected qualified profile;
- verify one staged work item end to end;
- run a fixed two-hour catch-up qualification;
- prove rollback and full restoration before continuing;
- continue only if throughput and all semantic, runtime, scheduler, storage, and no-cost operating gates pass.

Exit: exact contiguous cursor advance, zero semantic loss, zero resource-limit errors, and fail-closed rollback are proven.

### R6 — Lag-zero and steady qualification

- continue catch-up automatically to lag zero;
- verify transition to the selected steady cadence;
- pass twelve consecutive five-minute freshness checkpoints;
- prove immutable/live/current agreement and no hidden partial work;
- prove continued operation inside the measured no-cost envelope.

Exit: lag zero and five-minute freshness are stable without manual intervention.

### R7 — Formal operation evidence

- arm independent immutable audit retention;
- pass a fixed 24-hour evidence window;
- then pass seven days of continuous operation;
- only then reopen formal Devnet release qualification.

## Current production state

As of the controlling Issue #1079 checkpoint:

- the last accepted 32-ledger chain halted on `Too many subrequests`;
- fast-lane lag was 56,740 ledgers;
- the successor chain stopped;
- Worker Cron was empty;
- no 24-hour soak or stabilization qualification is active.

The current Cloudflare deployment is a halted legacy profile. Production must remain fail-closed until a candidate profile passes R4 and an explicit R5 recovery is approved.
