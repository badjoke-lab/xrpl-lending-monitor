# Implementation status

Last updated: `2026-08-01`.

## Current phase

XRPL Lending Monitor is **not formally released**.

The retired fixed-32-ledger recovery halted on a content-dependent Worker subrequest limit. The successor chain is absent, terminal lag was `56,740`, Worker Cron is empty, and no stabilization qualification or 24-hour soak is active.

The public read surface remains a production test surface backed by the last verified immutable base plus committed live data. Mainnet remains disabled.

## Controlling documents

- Recovery design and schedule: [`ops/p0-budgeted-microbatch-reconstruction-2026-08-01.md`](ops/p0-budgeted-microbatch-reconstruction-2026-08-01.md)
- Parent R2 contract: [`ops/r2-portable-runtime-contract-2026-08-01.md`](ops/r2-portable-runtime-contract-2026-08-01.md)
- Active R2b contract: [`ops/r2b-normalized-payload-phase-runtime-2026-08-01.md`](ops/r2b-normalized-payload-phase-runtime-2026-08-01.md)
- Runtime invariants: [`history-runtime-contract.md`](history-runtime-contract.md)
- Resource gates: [`resource-envelope.md`](resource-envelope.md)

The collector core remains independent of any one hosted runtime, scheduler, queue, database, or operator console.

## Production evidence

Controlling checkpoint: Issue #1079.

- network: `devnet`
- Mainnet enabled: `false`
- active Worker version at failure: `fb27bd55-e624-439d-add2-2ed41e903c34`
- Worker Cron: empty
- last completed slot: `2026-08-01T03:52:00Z`
- failed slot: `2026-08-01T03:53:00Z`
- failure: `Too many subrequests by single Worker invocation`
- last processed ledger: `4,051,454`
- latest observed ledger: `4,108,194`
- terminal lag: `56,740`
- successor chain: halted
- 24-hour soak: not started

The halted remote deployment is evidence and rollback context only. It is not an operating collector.

## Completed reconstruction milestones

### R0 — Contract and portability reset

Complete in PR #1081, merge `c077e7b16b8b08213bbadcc5e927bba0f9472f6c`.

- retired the fixed-ledger-count recovery contract;
- separated collector semantics from provider-specific execution;
- defined storage, scheduler, execution, and publication adapter boundaries;
- froze remote recovery until later deployment-profile qualification.

### R1 — Reference schema and deterministic planner

Complete in PR #1082, merge `85f42e665a5e6f2f519cd372718b9c41c16b3f68`.

- portable work, payload-chunk, commit-chunk, candidate-row, and committed-watermark schema;
- deterministic adaptive planner with a 48-ledger candidate ceiling;
- SQLite reference store;
- committed-only visibility and atomic finalization;
- canonical complete-state export and restore.

### R2a — Typed messages and durable scheduler

Complete in PR #1084, merge `f68aea25f6d3b973ceec79e09288fdf626f33bdc`.

- deterministic versioned scan, commit, and finalize messages;
- durable SQLite inbox, leases, stale-lease recovery, retry, and terminal halt;
- atomic timed successor outbox;
- duplicate completion and dispatch convergence;
- complete runtime export and restore, including leases and reserved successor times.

## Active R2b work

R2b is **not complete**. It is split into two implementation units under the merged R2b contract.

### R2b1 — Normalized payload, digest, and chunks

Status: **implementation and validation passed in PR #1086; merge pending**.

Delivered on the branch:

- seven-class `NormalizedCollectorPayloadV1` envelope;
- common canonical candidate identity;
- strict portable JSON values and exact candidate fields;
- contiguous ledger index, hash, and parent-chain validation;
- source ledger hash binding for every semantic candidate;
- required transaction and object identities for applicable classes;
- explicit semantic counts, including zero-count groups;
- duplicate semantic identity rejection;
- canonical `sha256:<lowercase hex>` payload and chunk digests;
- deterministic sorting, relationship normalization, and chunk boundaries;
- reference limits of 40 records and 512,000 encoded bytes per chunk;
- single-record resource halt;
- canonical chunk decoding and tamper rejection;
- complete-payload integrity verification before chunk construction.

Retained CI evidence from run `30691954060`:

- workflow-surface guard passed;
- lint passed;
- TypeScript type-check passed;
- production runner bundle and configuration validation passed;
- complete unit-test suite passed;
- complete clean local migration sequence passed;
- application build passed;
- browser smoke passed.

R2b1 tests cover all seven semantic groups, order-independent canonical digests, zero-count groups, duplicate identities, broken ledger continuity, wrong source hashes, missing applicable identities, deterministic multi-chunk output, oversized-record halt, changed payload rejection, and encoded chunk tamper rejection.

R2b1 is recorded complete only after PR #1086 merges to `main`.

### R2b2 — Bounded scan, commit, and finalize execution

Status: **next unit after R2b1 merge**.

Required work:

- stage a normalized payload through the R1 work schema inside scheduler-owned transactions;
- decode and commit one bounded chunk per commit message;
- expose transaction-aware work finalization and remove the nested-transaction hazard;
- finalize work, advance committed visibility, and reserve the next scan atomically;
- implement the deterministic fixture `ExecutionAdapter`;
- inject and verify retry, interruption, stale lease, reset, epoch, base, parent-hash, digest, and resource failures;
- prove staged, committing, and committed export/restore resumption;
- pass every remaining R2 and R2b exit test.

R2 remains incomplete until R2b2 merges with complete retained evidence.

## Later gates

### R3 — Adapter and reader integration

- storage and scheduler adapter conformance;
- committed-only current/history readers;
- legacy compatibility;
- bounded maintenance and immutable publication separation;
- cross-adapter export and restore.

### R4 — Deployment-profile qualification

- no hosted profile is selected before conformance and shadow evidence;
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

## Operating restrictions

- Do not describe the collector as operating while its successor or lease chain is absent.
- Do not restart the retired fixed-32-ledger runtime.
- Do not select a hosted provider before R4 qualification.
- Do not use GitHub Actions as the normal collection clock.
- Do not start stabilization or soak before R6.
- Do not enable Mainnet.
- Do not remove semantic history classes or public product capabilities.
- Do not skip a failed ledger or advance a cursor after partial persistence.
- Do not make a provider dashboard, local terminal, or paid runtime dependency part of routine recovery.
- Do not call a theoretical no-cost projection an operating result.
