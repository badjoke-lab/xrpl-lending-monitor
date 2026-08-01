# Implementation status

Last updated: `2026-08-01`.

## Current phase

XRPL Lending Monitor is **not formally released**.

The retired fixed-32-ledger recovery halted on a content-dependent Worker subrequest limit. The successor chain is absent, terminal lag was `56,740`, Worker Cron is empty, and no stabilization qualification or 24-hour soak is active.

The public read surface remains a production test surface backed by the last verified immutable base plus committed legacy live data. Mainnet remains disabled. The new portable runtime has not been connected to a hosted deployment or public reader.

## Controlling documents

- Recovery design and schedule: [`ops/p0-budgeted-microbatch-reconstruction-2026-08-01.md`](ops/p0-budgeted-microbatch-reconstruction-2026-08-01.md)
- R3 adapter and reader plan: [`ops/r3-adapter-reader-integration-plan-2026-08-01.md`](ops/r3-adapter-reader-integration-plan-2026-08-01.md)
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
- Repeated scan identity contract and implementation: PRs #1089/#1090, merges `51238a35184f5b4815fa79c1144df92ebe8d77a4` and `bcb812b9001ea0e47cd2571e2ed3209c450cf84f`.
- Fixture execution and scan runtime: PR #1091, merge `7d1f50fa621b650efe0aae14fa074a2aff1ed8f3`.
- Bounded commit runtime: PR #1092, merge `fb40f9400760b00b7d0dfb69cf4392f16e61ff08`.
- Candidate identity persistence correction: PR #1093, merge `9fb931f78b7ea605d52cee8292728d3d48eb868a`.
- Identity-complete finalize runtime: PR #1094, merge `d1a50ba5988da7222a32f69d1593712fc4bd7f12`.
- Parent R2 portable runtime exit: PR #1095, merge `fb90cbbd3a44337dc0891552f3618581cfc31e1c`.

## R2 completion

R2 and R2b2 are **complete on `main`**.

The retained parent orchestration suite proves:

- sparse and dense durable `scan -> commit ... -> finalize -> next scan` chains;
- all seven semantic classes and complete identity end to end;
- no early visibility or cursor advance;
- staged, committing, and committed runtime-version-3 export/restore;
- scan, commit, and finalize interruption rollback with exact-identity retry;
- lease, duplicate, and outbox convergence;
- reset, epoch, base, stale-boundary, parent-hash, digest, and resource failure handling;
- provider-neutral runtime imports.

Final R2 CI run `30698715057` passed workflow guard, lint, type-check, production runner checks, complete unit suite, clean migrations, build, and browser smoke before merge `fb90cbbd3a44337dc0891552f3618581cfc31e1c`.

## Active R3 work

### R3 contract — Adapter and reader integration

Status: **active on branch `agent/r3-adapter-reader-contract`**.

Repository inspection confirms that the current public reader is a mixed legacy surface:

- current objects use release assets plus D1 overlay, with legacy D1 readers still available;
- history APIs read legacy D1 tables;
- exact history and transaction routes may use Git-backed immutable assets and indexes;
- local scripts create replacement current-state and immutable history publications;
- the halted Worker entry still contains legacy collector, Queue, maintenance, and operator paths.

The controlling R3 plan therefore requires:

- formal provider-neutral storage, scheduler, execution, publication, and maintenance boundaries;
- committed read fences and source-bound cursors;
- a generic committed reader over portable rows;
- seven strict product read-model mappers;
- explicit `legacy_only`, `shadow_compare`, later portable-primary, and portable-only cutover states;
- no mixing of portable and legacy rows in one response;
- no silent legacy fallback after integrity or identity failure;
- publication verification before publication-watermark advancement;
- verified publication before maintenance authorization;
- canonical cross-adapter export and restore.

### R3A — Adapter interfaces and SQLite conformance

Status: **next after the R3 contract merges**.

R3A will introduce interfaces and wrappers without changing runtime behavior or public reader authority.

### R3B–R3E

- R3B: committed generic reader and fence-bound cursors;
- R3C: seven product mappers and bounded shadow comparison;
- R3D: publication and maintenance separation;
- R3E: cross-adapter export/restore and parent R3 exit.

R3 remains local and provider-neutral. It does not select Cloudflare or any other hosted profile and does not mutate production.

## Later gates

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
- Do not mix portable and legacy reader sources inside one response.
- Do not silently fall back after integrity or identity failure.
- Do not make a provider dashboard, local terminal, or paid runtime dependency part of routine recovery.
- Do not call a theoretical no-cost projection an operating result.
