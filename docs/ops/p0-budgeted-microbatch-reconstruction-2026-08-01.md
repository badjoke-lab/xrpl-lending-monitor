# P0 budgeted microbatch collector reconstruction — 2026-08-01

Status: controlling recovery design. This document supersedes the fixed-ledger-count Queue recovery described by PRs #1069–#1078 and Issues #1072/#1079.

## Decision

The existing Queue collector is not approved for further production recovery.

Production evidence proved both of the following:

- five-minute delivery with a fixed 32-ledger pass cannot match the observed Devnet arrival rate;
- one-minute delivery with the same fixed 32-ledger pass can still exceed the Worker invocation subrequest limit because persistence cost depends on ledger contents.

A fixed ledger count is therefore not a resource budget. The replacement collector must budget actual operations and make heavy-ledger work resumable.

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

## Current platform envelope

Official Cloudflare limits verified on 2026-08-01:

- Workers Free: 100,000 requests/day, 50 external subrequests/invocation, 1,000 internal-service subrequests/invocation;
- D1 Free: 50 queries/Worker invocation, 5,000,000 rows read/day, 100,000 rows written/day, 500 MB/database;
- Queues Free: 10,000 operations/day, 24-hour message retention; a normal sub-64 KB delivery usually costs one write, one read, and one delete operation.

Official references:

- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/queues/platform/limits/
- https://developers.cloudflare.com/queues/platform/pricing/

Repository safety thresholds must remain below provider hard limits. Provider limits are not operating targets.

## Rejected runtime

The following design is retired:

```text
one Queue delivery
  -> fetch a fixed number of ledgers
  -> derive every semantic class
  -> write current/history/metrics/retention/successor in one invocation
```

Changing `32` to another fixed ledger count is not an accepted repair. A sparse range can pass while a content-heavy range exceeds the same invocation budget.

## Approved state machine

One Queue, one producer binding, one push consumer, batch size one, and concurrency one remain the serialization boundary.

Messages contain only bounded control data and work identifiers. They never contain complete ledger payloads or history bundles.

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
3. opens one XRPL WebSocket connection;
4. fetches a candidate contiguous range after the cursor;
5. normalizes every supported semantic class without writing canonical rows;
6. stops before configured transaction, decoded-byte, normalized-byte, CPU, or wall-time budgets;
7. writes one work record plus bounded compressed payload chunks to staging tables;
8. schedules the first commit phase.

The candidate range is adaptive. Initial test ceiling: 48 ledgers. The accepted ceiling is determined by measured scan-only CPU, bytes, transaction count, and worst-case evidence, not by desired throughput.

### Commit phase

The commit phase:

1. loads one staged work item and its next uncommitted chunk;
2. applies no more than the configured D1 query, statement, row-write, and byte budgets;
3. writes canonical candidate records tagged with `work_id`;
4. records chunk completion idempotently;
5. schedules another commit phase when chunks remain;
6. otherwise schedules finalization.

Initial hard guards:

- no more than 40 D1 queries/statements per invocation;
- no more than 40 canonical row mutations per invocation until production-shaped evidence supports another value;
- no staged payload chunk larger than 512,000 encoded bytes;
- no Queue message larger than 16,000 bytes;
- no cursor or public watermark advancement during partial commit.

A single content-heavy ledger may span multiple commit invocations. No semantic class is removed to make it fit.

### Finalize phase

Finalization is one small atomic D1 batch that:

- verifies every expected chunk is complete;
- verifies start ledger, end ledger, parent hashes, final hash, network, epoch, and base identity;
- marks the work item committed;
- advances the contiguous fast-lane cursor and public committed watermark;
- records bounded run metrics;
- selects the next state-machine message.

Canonical/history/current rows written by commit phases are invisible to public readers until their owning `work_id` is committed. Failed or abandoned work never becomes public truth.

### Current overlay visibility

Current projection rows become versioned by `work_id` rather than destructively replacing the only visible row during partial work.

Public reads select the newest row whose owning work item is committed. A committed tombstone suppresses an older base or overlay object. Maintenance may compact superseded committed versions only after an archive and rollback boundary exists.

### History visibility

Historical records and compressed live-tail bundles also carry `work_id`. Hybrid APIs read only committed work. Existing canonical identity keys remain authoritative for deduplication.

## Queue cadence and free-operation budget

The state machine emits exactly one successor message per successful invocation.

### Catch-up mode

- successor delay: 30 seconds;
- ceiling: 2,880 successfully consumed messages/day;
- normal Queue-operation projection: 8,640/day;
- reserved headroom: at least 1,360 operations/day for retries and exceptional cleanup;
- automatic transition out of catch-up after terminal lag reaches zero and remains zero through the stabilization gate.

### Steady mode

- successor delay: 60 seconds;
- ceiling: 1,440 successfully consumed messages/day;
- normal Queue-operation projection: 4,320/day;
- public freshness gate: committed cursor must remain within five minutes of the validated head.

The state machine must slow or halt before crossing a measured daily Queue-operation, D1-read, D1-write, storage, Worker-request, CPU, or error budget. It must expose the reason truthfully.

## Throughput gate

Observed Devnet advance was approximately 84 ledgers per five minutes, or 16.8 ledgers/minute.

The reconstructed collector is not approved unless production-shaped evidence proves:

- steady-mode sustained committed throughput greater than 21 ledgers/minute at p95 windows;
- catch-up-mode sustained committed throughput greater than 30 ledgers/minute;
- no content-heavy ledger can permanently block the cursor;
- Queue operations remain below 9,000/day in catch-up and below 5,000/day in steady mode;
- D1 rows written remain below 80,000/day;
- D1 rows read remain below 4,000,000/day;
- D1 physical size remains below the project stop threshold;
- subrequest, CPU, memory, row-size, and query-limit errors remain zero in qualification windows.

These are acceptance gates, not advance guarantees.

## Storage and immutable publication

D1 remains the hot operational database. It stores:

- committed cursor and epoch/base identity;
- collector work and chunk state;
- bounded live-tail history;
- current overlay versions and tombstones;
- bounded indexes, health, and reconciliation state.

Long-lived semantic history continues through the existing GitHub-backed immutable segment and exact-index publication path. A scheduled GitHub Actions workflow must:

1. read only committed work after the immutable watermark;
2. produce deterministic compressed segment and index artifacts;
3. verify ledger/hash and semantic counts;
4. publish immutable assets;
5. advance the publication watermark through a guarded privileged endpoint;
6. compact D1 hot history only after the published artifact is independently verified.

No R2 requirement is introduced. No operator dashboard action is required.

## Automated deployment and operation

The owner is not required to use the Cloudflare dashboard or local terminal.

Every remote mutation must be implemented through guarded GitHub Actions using existing repository secrets:

- migration application;
- Worker upload and deployment;
- Queue pause, purge, seed, resume, and final-state verification;
- rollback to the previous Worker version;
- read-only checkpoints and retained artifacts;
- immutable publication and hot-data compaction.

Every mutating workflow must use the repository production-writer concurrency group, exact source SHA guards, Devnet/Mainnet guards, pre/post snapshots, fail-closed cleanup, and Issue evidence.

## Implementation schedule

Dates are planning targets, not claims of completion.

### R0 — Contract reset — 2026-08-01

- close the obsolete 32-ledger checkpoint PR;
- rewrite architecture, collector, runtime, resource, implementation-status, and roadmap documents;
- freeze new soak and promotion work;
- record the halted production evidence and exact invariants.

Exit: source-of-truth documents agree and old recovery is no longer an active gate.

### R1 — Work schema and deterministic planner — 2026-08-01 to 2026-08-02

- add work, payload-chunk, commit-chunk, and committed-visibility schema;
- add indexes and migration rollback evidence;
- implement deterministic adaptive scan planning and budget accounting;
- add heavy-ledger fixtures and replay tests.

Exit: local D1 tests prove no partial work is publicly visible and no cursor advances before finalization.

### R2 — Scan/commit/finalize runtime — 2026-08-02 to 2026-08-03

- implement typed Queue messages and state transitions;
- implement scan-only staging;
- implement resumable commit chunks;
- implement atomic finalization and successor selection;
- preserve every semantic class and canonical identity.

Exit: local and CI tests process sparse, dense, oversized, interrupted, retried, duplicate, reset, and parent-hash-failure fixtures.

### R3 — Overlay, maintenance, and archive separation — 2026-08-03

- make current/history visibility conditional on committed work;
- add bounded compaction and retention jobs;
- integrate GitHub-backed immutable publication watermarking;
- preserve hybrid API behavior and legacy rows during migration.

Exit: API parity and deterministic archive/replay tests pass with no semantic-count loss.

### R4 — Guarded automated deployment path — 2026-08-03 to 2026-08-04

- add one-shot migration/deployment/recovery workflow;
- add rollback and Queue cleanup;
- add exact production evidence artifacts and Issue reporting;
- require no dashboard or local terminal steps.

Exit: workflow validation and ordinary CI pass; production remains halted until merge-triggered recovery.

### R5 — Production shadow and controlled recovery — after R4

- pause and purge the obsolete chain;
- apply migration;
- deploy the reconstructed Worker;
- run staged single-work verification;
- run a fixed two-hour catch-up qualification;
- continue only if throughput and all resource gates pass.

Exit: exact contiguous cursor advance, zero semantic loss, zero resource-limit errors, fail-closed rollback proven.

### R6 — Lag-zero and steady qualification

- continue catch-up automatically to lag zero;
- verify transition from 30-second catch-up to 60-second steady state;
- pass twelve consecutive five-minute freshness checkpoints;
- prove immutable/live/current agreement and no hidden partial work.

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

Production must remain fail-closed until the reconstructed runtime reaches R5.