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
- R2b2 plan: [`ops/r2b2-bounded-phase-runtime-plan-2026-08-01.md`](ops/r2b2-bounded-phase-runtime-plan-2026-08-01.md)
- Repeated-scan identity amendment: [`ops/r2-scan-sequence-amendment-2026-08-01.md`](ops/r2-scan-sequence-amendment-2026-08-01.md)
- Candidate identity persistence amendment: [`ops/r2b2-candidate-identity-persistence-amendment-2026-08-01.md`](ops/r2b2-candidate-identity-persistence-amendment-2026-08-01.md)
- Runtime invariants: [`history-runtime-contract.md`](history-runtime-contract.md)
- Resource gates: [`resource-envelope.md`](resource-envelope.md)

The collector core remains independent of any one hosted runtime, scheduler, queue, database, or operator console.

## Production evidence

Controlling checkpoint: Issue #1079.

- network: `devnet`
- Mainnet enabled: `false`
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

- R0 contract and portability reset: PR #1081, merge `c077e7b16b8b08213bbadcc5e927bba0f9472f6c`.
- R1 reference schema and deterministic planner: PR #1082, merge `85f42e665a5e6f2f519cd372718b9c41c16b3f68`.
- R2a typed messages and durable scheduler: PR #1084, merge `f68aea25f6d3b973ceec79e09288fdf626f33bdc`.
- R2b1 normalized payload, digest, and chunks: PR #1086, merge `70f0e79632c51521ff1d6f85d445c797c515c429`.
- R2b2-A transaction-aware store: PR #1088, merge `56dfe67cf969ac29357e7d49970da8b4027eba27`.
- R2b2-B0 repeated scan identity contract: PR #1089, merge `51238a35184f5b4815fa79c1144df92ebe8d77a4`.
- R2b2-B0 scan-sequence implementation: PR #1090, merge `bcb812b9001ea0e47cd2571e2ed3209c450cf84f`.
- R2b2-B1 fixture execution and scan runtime: PR #1091, merge `7d1f50fa621b650efe0aae14fa074a2aff1ed8f3`.
- R2b2-C bounded commit runtime: PR #1092, merge `fb40f9400760b00b7d0dfb69cf4392f16e61ff08`.
- Candidate identity persistence correction: PR #1093, merge `9fb931f78b7ea605d52cee8292728d3d48eb868a`.
- R2b2-D identity-complete finalize runtime: PR #1094, merge `d1a50ba5988da7222a32f69d1593712fc4bd7f12`.

R2b2-D delivered complete payload reconstruction, seven-class identity verification, transaction-aware finalization, atomic committed visibility and watermark advancement, next-scan sequence `0`, retry rollback, duplicate convergence, and runtime-version-3 resumption.

## Parent R2 exit

Status: **implementation and validation passed in PR #1095; merge pending**.

The dedicated durable-SQLite orchestration suite proves:

- sparse `scan -> commit -> finalize -> next scan` with all seven semantic classes;
- no candidate visibility or committed watermark before finalize;
- complete transaction, object, relationship, tombstone, ledger, hash, and canonical-value identity after finalize;
- dense multi-chunk execution with exact ordered commit messages;
- staged, committing, and committed runtime-version-3 export/restore parity;
- scan, commit, and finalize interruption rollback followed by completion using the exact same phase message identity;
- fresh-lease theft rejection and stale-lease reclaim without changing message identity;
- duplicate scan and finalize convergence;
- idempotent outbox dispatch;
- reset, epoch mismatch, base mismatch, stale boundary, parent-hash mismatch, and resource halt with no work, cursor, or successor;
- provider-neutral relative imports across the portable runtime surface.

The parent suite runs together with retained phase-local tests that already prove message-size and schema rejection, payload and chunk tamper rejection, commit wrong-index and 41-record halts, finalize digest and semantic-count rejection, and scheduler conflict handling.

Retained CI evidence from run `30698568464`:

- workflow-surface guard passed;
- lint passed;
- TypeScript type-check passed;
- production runner bundle and configuration validation passed;
- complete unit-test suite passed;
- complete clean local migration sequence passed, including migration `10006`;
- application build passed;
- browser smoke passed.

R2 and R2b2 are recorded complete only after PR #1095 merges to `main`.

## Next phase

### R3 — Adapter and reader integration

Status: **next after PR #1095 merges**.

Required work:

- formal `StorageAdapter`, `SchedulerAdapter`, `ExecutionAdapter`, and `PublicationAdapter` boundaries;
- conformance tests against the SQLite reference runtime;
- committed-only current and history readers over the new work-scoped rows;
- explicit legacy read compatibility and cutover rules;
- bounded maintenance and immutable publication separation;
- exact cross-adapter export and restore;
- no hosted provider selection or production mutation.

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
