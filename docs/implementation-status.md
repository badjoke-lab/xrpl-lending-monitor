# Implementation status

Last updated: `2026-08-01`.

## Current phase

XRPL Lending Monitor is **not formally released**.

The retired fixed-32-ledger recovery halted on a content-dependent Worker subrequest limit. The successor chain is absent, terminal lag was `56,740`, Worker Cron is empty, and no stabilization qualification or 24-hour soak is active.

The public read surface remains a production test surface backed by the last verified immutable base plus committed live data. Mainnet remains disabled.

## Controlling documents

- Recovery design and schedule: [`ops/p0-budgeted-microbatch-reconstruction-2026-08-01.md`](ops/p0-budgeted-microbatch-reconstruction-2026-08-01.md)
- Parent R2 contract: [`ops/r2-portable-runtime-contract-2026-08-01.md`](ops/r2-portable-runtime-contract-2026-08-01.md)
- R2b contract: [`ops/r2b-normalized-payload-phase-runtime-2026-08-01.md`](ops/r2b-normalized-payload-phase-runtime-2026-08-01.md)
- Active R2b2 plan: [`ops/r2b2-bounded-phase-runtime-plan-2026-08-01.md`](ops/r2b2-bounded-phase-runtime-plan-2026-08-01.md)
- Repeated-scan identity amendment: [`ops/r2-scan-sequence-amendment-2026-08-01.md`](ops/r2-scan-sequence-amendment-2026-08-01.md)
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

### R1 — Reference schema and deterministic planner

Complete in PR #1082, merge `85f42e665a5e6f2f519cd372718b9c41c16b3f68`.

### R2a — Typed messages and durable scheduler

Complete in PR #1084, merge `f68aea25f6d3b973ceec79e09288fdf626f33bdc`.

### R2b1 — Normalized payload, digest, and chunks

Complete in PR #1086, merge `70f0e79632c51521ff1d6f85d445c797c515c429`.

Delivered:

- seven-class `NormalizedCollectorPayloadV1` envelope;
- strict candidate and source identity validation;
- contiguous ledger index/hash/parent-chain validation;
- explicit semantic counts, including zero-count groups;
- canonical SHA-256 payload and chunk digests;
- deterministic sorting, duplicate rejection, and bounded chunks;
- single-record resource halt;
- complete-payload and encoded-chunk tamper rejection.

### R2b2-A — Transaction-aware store

Complete in PR #1088, merge `56dfe67cf969ac29357e7d49970da8b4027eba27`.

Delivered:

- typed work, payload-chunk, commit-chunk, candidate-row, and watermark snapshots;
- exact work-scoped reads for runtime use without ad hoc SQL;
- `finalizeWorkInTransaction` inside caller-owned transactions;
- standalone `finalizeWork` compatibility wrapper;
- real SQLite proof of no nested transaction;
- injected interruption rollback of work status, committed visibility, and watermark advancement.

### R2b2-B0 — Repeated scan identity

Contract complete in PR #1089, merge `51238a35184f5b4815fa79c1144df92ebe8d77a4`.

Implementation complete in PR #1090, merge `bcb812b9001ea0e47cd2571e2ed3209c450cf84f`.

Delivered:

- required non-negative `scanSequence` in `ScanPhaseMessageV1` and canonical scan ID;
- sequence `0` for initial and post-finalize scans;
- sequence `+1` for a caught-up successor at one unchanged boundary;
- exact retry and stale-lease identity preservation;
- strict invalid-sequence and changed-identity rejection;
- exact runtime export/restore retention;
- unchanged commit and finalize identities.

Retained CI evidence includes workflow guard, lint, type-check, complete unit suite, clean migration sequence, application build, and browser smoke.

## Active R2b2 work

R2b2 is **active and incomplete**.

### R2b2-B1 — Fixture execution and scan

Status: **implementation and validation passed in PR #1091; merge pending**.

Delivered on the branch:

- deterministic provider-neutral `FixtureExecutionAdapter` with immutable-base identity, validated head, planner estimates, normalized ranges, successor timing, counters, and bounded fault injection;
- `PortableCollectorScanRuntime` with scheduler claim, exact boundary verification, reset detection, adaptive planning, payload/chunk construction, work staging, retry, halt, and successor selection;
- exact initial immutable-base boundary support;
- exact existing committed-watermark boundary support;
- caught-up successor at the same boundary with `scanSequence + 1` and no work creation;
- retryable transport and storage handling that preserves one scan identity;
- single-ledger budget halt with no successor;
- atomic work/chunk staging, current-message completion, and commit-successor outbox reservation;
- no candidate-row writes, committed visibility, or watermark advance during scan;
- rollback of work and payload chunks when an injected storage interruption occurs inside the scheduler-owned transaction.

Retained CI evidence from run `30695623746`:

- workflow-surface guard passed;
- lint passed;
- TypeScript type-check passed;
- production runner bundle and configuration validation passed;
- complete unit-test suite passed;
- complete clean local migration sequence passed;
- application build passed;
- browser smoke passed.

The first CI attempt exposed two TypeScript narrowing errors for terminal scheduler classifications. The runtime was corrected to map impossible retry/lease classifications from a persisted terminal row to `terminal_internal`. No runtime or failure contract was weakened.

R2b2-B1 is recorded complete only after PR #1091 merges to `main`.

### R2b2-C — Commit runtime

Status: **next after PR #1091 merges**.

- claim and validate the exact commit message;
- read and verify one exact payload chunk;
- map no more than 40 records to work-scoped candidate rows;
- complete one commit chunk idempotently;
- reserve the next commit or finalize successor atomically;
- prove duplicate, retry, interruption, wrong-index, digest, and resource behavior.

### R2b2-D — Finalize runtime

- reconstruct and verify the full normalized payload;
- verify semantic counts, hashes, identities, and complete commit evidence;
- call transaction-aware finalization;
- expose rows and advance the watermark atomically;
- reserve the next scan with sequence `0`;
- prove staged, committing, and committed export/restore resumption.

R2 remains incomplete until every R2b2 unit and the parent R2 exit suite pass and merge to `main`.

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
