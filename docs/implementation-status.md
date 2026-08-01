# Implementation status

Last updated: `2026-08-01`.

## Current phase

XRPL Lending Monitor is **not formally released**.

The retired fixed-32-ledger production recovery remains halted after a content-dependent Worker subrequest failure. The successor chain is absent, the recorded terminal lag was `56,740`, Worker Cron is empty, and no stabilization qualification or 24-hour soak is active.

The public read surface remains legacy-authoritative. Mainnet remains disabled. No R4 profile has been selected or deployed.

## Controlling documents

- Recovery design and schedule: [`ops/p0-budgeted-microbatch-reconstruction-2026-08-01.md`](ops/p0-budgeted-microbatch-reconstruction-2026-08-01.md)
- R4 qualification contract: [`ops/r4-deployment-profile-qualification-plan-2026-08-01.md`](ops/r4-deployment-profile-qualification-plan-2026-08-01.md)
- R4 initial matrix: [`ops/r4-initial-profile-matrix-2026-08-01.json`](ops/r4-initial-profile-matrix-2026-08-01.json)
- R4B evaluator evidence: [`ops/r4b-profile-qualification-evaluator-evidence-2026-08-01.md`](ops/r4b-profile-qualification-evaluator-evidence-2026-08-01.md)
- R4C1 local SQLite evidence: [`ops/r4c1-local-sqlite-service-evidence-2026-08-01.md`](ops/r4c1-local-sqlite-service-evidence-2026-08-01.md)
- Completed R3 plan: [`ops/r3-adapter-reader-integration-plan-2026-08-01.md`](ops/r3-adapter-reader-integration-plan-2026-08-01.md)
- Runtime invariants: [`history-runtime-contract.md`](history-runtime-contract.md)
- Resource gates: [`resource-envelope.md`](resource-envelope.md)

## Production checkpoint

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
- R2 portable typed runtime and parent exit: PRs #1084–#1095, final merge `fb90cbbd3a44337dc0891552f3618581cfc31e1c`.
- R3 adapter, reader, mapper, publication, maintenance, and complete-state transfer: PRs #1096–#1101, final merge `78e221e17d41c2a8bc55d2b6898d4fc088cdb9d2`.
- R4A qualification contract and initial matrix: PR #1102, merge `158087602b1bcde515f0b68eae47133bb93645ea`.
- R4B machine-readable evaluator: PR #1103, merge `683c3b65fc31a2c8ffde289b1c607b94890219de`.

## R3 completion

R3 is complete on `main`. The retained R3A–R3E suites prove provider-neutral phase execution, committed-reader semantics, seven strict mappers, legacy-authoritative shadow comparison, independently verified publication, publication-gated maintenance, and exact complete-state export, restore, and continuation.

## Active R4 work

### R4A — Qualification contract and initial matrix

Status: **complete on `main`** in PR #1102, merge `158087602b1bcde515f0b68eae47133bb93645ea`.

R4A defines ten non-overridable hard gates for cost/card safety, automatic overage, scheduler durability, transactionality, committed-only reads, complete-state portability, throughput, resource fail-closed behavior, operator independence, and production isolation.

### R4B — Machine-readable evaluator

Status: **complete on `main`** in PR #1103, merge `683c3b65fc31a2c8ffde289b1c607b94890219de`.

R4B binds exact G1–G10 evidence to a canonical profile identity and revision, forbids scoring while any gate fails or remains unresolved, keeps every decision unselected, and emits a deterministic decision digest.

Final R4B CI run `30703646271` passed workflow guard, lint, shell and canonical-base checks, type-check, production runner checks, complete unit suite, clean migrations through `10007`, build, and browser smoke.

### R4C1 — Local service-managed SQLite harness

Status: **implementation and validation passed in PR #1104; merge pending**.

Delivered on the branch:

- migration `10008_local_sqlite_service_supervisor.sql`;
- durable process generation, owner, lease, heartbeat, restart count, backoff, error, and terminal-halt state;
- canonical append-only supervisor events;
- file-backed SQLite using WAL and `synchronous = FULL`;
- database close/reopen crash simulation;
- fresh process-lease theft rejection;
- exact-expiry stale process-lease reclaim;
- durable heartbeat and scheduler message persistence across reopen;
- retryable failure with explicit next-start time;
- early-restart rejection and exact-time restart;
- graceful stop without failure count;
- terminal halt with no automatic restart;
- process lease kept separate from portable scheduler message lease;
- R4B-bound machine-readable profile evidence.

The R4B decision is deliberately not a qualification:

- classification: `conditional_candidate`;
- selection: `not_selected`;
- eligible for scoring: `false`;
- passed gates: `7`;
- failed gates: `0`;
- unresolved gates: `G7`, `G8`, `G9`.

G7 remains unresolved because no retained service-managed throughput evidence proves steady p95 above 21 committed ledgers/minute and catch-up above 30. G8 remains unresolved because sustained CPU, memory, disk, database growth, network, and resource stop thresholds are not measured. G9 remains unresolved because no actual always-on host, OS service manager, unattended boot restart, deploy/rollback automation, power/network continuity, or off-host evidence retention has been proven.

Implementation and evidence head `0b9cf6b7f42aee4ac1fb93758d8c5cbfedff0f1a` passed CI run `30704517323`:

- workflow-surface guard;
- lint;
- shell syntax and canonical-base checks;
- TypeScript type-check;
- production runner bundle and configuration validation;
- complete unit-test suite;
- clean migrations through `10008`;
- application build;
- browser smoke.

The final documentation head must pass the same ordinary CI. R4C1 is complete only after PR #1104 merges to `main`.

### R4C2 — Local Postgres transaction and scheduler harness

Status: **next after PR #1104 merges**.

R4C2 will test Postgres transaction ownership, scheduler message identity, lease/retry/successor semantics, committed-only reads, and complete-state parity locally. It creates no hosted Supabase resource or credential.

### R4C3–R4E

- R4C3: local libSQL/Turso-compatible transaction and transfer harness;
- R4C4: local Cloudflare Worker/D1/Queue resource model without deployment;
- R4D: isolated read-only shadow measurement only after cost-safety gates pass;
- R4E: select one fully qualified profile or record `no_profile_qualified`.

R4 remains local and read-only. It does not deploy or recover production.

## Later phases

### R5 — Controlled recovery

Deploy only a qualified R4 profile, then prove one staged work item, rollback, restore, and a fixed two-hour catch-up qualification.

### R6 — Lag-zero and steady qualification

Reach lag zero, pass twelve consecutive five-minute freshness checkpoints, and remain inside the measured no-cost envelope.

### R7 — Formal operation evidence

Pass fixed 24-hour and seven-day evidence windows before reopening formal Devnet release qualification.

## Operating restrictions

- Do not describe the collector as operating while its successor or lease chain is absent.
- Do not restart the retired fixed-32-ledger runtime.
- Do not select or deploy a hosted provider before R4 qualification.
- Do not add a payment method, paid plan, or automatic-overage profile.
- Do not use GitHub Actions as the normal collection clock.
- Do not start recovery before R5 or stabilization/soak before R6.
- Do not enable Mainnet.
- Do not skip a failed ledger or advance a cursor after partial persistence.
- Do not mix portable and legacy reader sources inside one response.
- Do not silently fall back after integrity or identity failure.
- Do not expose the portable reader publicly before a later explicit cutover gate.
- Do not make a provider dashboard or interactive terminal part of routine operation.
- Do not call a local crash-recovery harness an always-on production host.
- Do not call a theoretical no-cost projection an operating result.
