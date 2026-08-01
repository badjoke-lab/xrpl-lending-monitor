# Implementation status

Last updated: `2026-08-01`.

## Current phase

XRPL Lending Monitor is **not formally released**.

The retired fixed-32-ledger production recovery remains halted after a content-dependent Worker subrequest failure. The successor chain is absent, the recorded terminal lag was `56,740`, Worker Cron is empty, and no stabilization qualification or 24-hour soak is active.

The public read surface remains legacy-authoritative. Mainnet remains disabled. The portable runtime has not been connected to a hosted deployment or public route.

## Controlling documents

- Recovery design and schedule: [`ops/p0-budgeted-microbatch-reconstruction-2026-08-01.md`](ops/p0-budgeted-microbatch-reconstruction-2026-08-01.md)
- R4 qualification contract: [`ops/r4-deployment-profile-qualification-plan-2026-08-01.md`](ops/r4-deployment-profile-qualification-plan-2026-08-01.md)
- R4 initial matrix: [`ops/r4-initial-profile-matrix-2026-08-01.json`](ops/r4-initial-profile-matrix-2026-08-01.json)
- Completed R3 plan: [`ops/r3-adapter-reader-integration-plan-2026-08-01.md`](ops/r3-adapter-reader-integration-plan-2026-08-01.md)
- R3E and parent exit evidence: [`ops/r3e-complete-state-transfer-evidence-2026-08-01.md`](ops/r3e-complete-state-transfer-evidence-2026-08-01.md)
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

## R3 completion

R3 is **complete on `main`**.

The retained R3A–R3E evidence proves:

- R2 phase behavior through provider-neutral interfaces;
- SQLite storage and scheduler conformance;
- immutable committed read fences;
- exact, range, semantic, and relationship reads;
- source/query/order/fence-bound cursors;
- strict mappers for all seven semantic classes;
- legacy-authoritative `legacy_only` and `shadow_compare` modes;
- deterministic bounded comparison evidence;
- independently verified immutable publication;
- verified-publication-gated bounded maintenance;
- complete collection, scheduler, publication, and maintenance export;
- one-transaction empty-target restore;
- exact canonical parity and continuation after restore;
- no hosted provider selection or production mutation.

Final R3 documentation CI run `30702737272` passed workflow guard, lint, shell and canonical-base checks, TypeScript type-check, production runner checks, complete unit suite, clean migrations through `10007`, build, and browser smoke before merge `78e221e17d41c2a8bc55d2b6898d4fc088cdb9d2`.

## Active R4 work

### R4A — Qualification contract and initial matrix

Status: **active on branch `agent/r4-deployment-profile-qualification-contract`**.

R4A defines ten non-overridable hard gates:

1. no mandatory payment method or card verification;
2. no automatic paid overage;
3. durable one-minute-or-finer internal scheduler;
4. transactional phase completion and successor reservation;
5. committed-only reads;
6. exact complete-state export and restore;
7. steady throughput above 21 ledgers/minute and catch-up above 30;
8. resource fail-closed behavior;
9. unattended operator-independent operation;
10. no production mutation before R5.

Initial classifications:

- cardless self-hosted SQLite service: **conditional candidate**;
- Supabase Free Postgres plus pg_cron/Edge Functions: **conditional candidate**;
- Turso Free storage plus cardless self-hosted executor: **conditional candidate**;
- existing Cloudflare Workers/D1/Queues profile: **blocked** pending zero-additional-charge and account-access proof, with separate technical blockers;
- GitHub Actions-only collector: **rejected** as the normal clock;
- Deno Deploy Free managed runtime: **rejected** because unrestricted Free use requires card verification and the beta has no uptime guarantee.

No provider or profile is selected. No hosted resource or credential is created by R4A.

### R4B — Machine-readable evaluator

Status: **next after the R4A contract merges**.

R4B will implement exact profile descriptors, hard-gate evidence validation, canonical decisions, and a rule that prevents scoring while any hard gate fails or remains unresolved.

### R4C–R4E

- R4C: local SQLite, Postgres, libSQL/Turso-compatible, and Cloudflare resource-model harnesses;
- R4D: read-only shadow measurement only after cost-safety gates pass;
- R4E: select exactly one qualified profile or record `no_profile_qualified`.

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
- Do not call a theoretical no-cost projection an operating result.
