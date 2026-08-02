# Implementation status

Last updated: `2026-08-02`.

## Current phase

XRPL Lending Monitor is **not formally released**.

The retired Cloudflare fixed-32-ledger recovery remains halted after a content-dependent Worker subrequest failure. Worker Cron remains empty, Mainnet remains disabled, the public read surface remains legacy-authoritative, and no stabilization qualification or soak is active.

The separate Supabase Free Devnet profile now has verified one-minute remote execution and a durable `scan -> commit -> finalize -> next scan` phase chain. It remains an R4 conditional candidate, not the full seven-class collector and not a public-reader or production cutover.

## Controlling documents

- Recovery design and schedule: [`ops/p0-budgeted-microbatch-reconstruction-2026-08-01.md`](ops/p0-budgeted-microbatch-reconstruction-2026-08-01.md)
- R4 qualification contract and schedule: [`ops/r4-deployment-profile-qualification-plan-2026-08-01.md`](ops/r4-deployment-profile-qualification-plan-2026-08-01.md)
- R4 initial matrix: [`ops/r4-initial-profile-matrix-2026-08-01.json`](ops/r4-initial-profile-matrix-2026-08-01.json)
- R4B evaluator evidence: [`ops/r4b-profile-qualification-evaluator-evidence-2026-08-01.md`](ops/r4b-profile-qualification-evaluator-evidence-2026-08-01.md)
- R4C1 local SQLite evidence: [`ops/r4c1-local-sqlite-service-evidence-2026-08-01.md`](ops/r4c1-local-sqlite-service-evidence-2026-08-01.md)
- R4C2a Supabase probe evidence: [`ops/r4c2-supabase-remote-probe-evidence-2026-08-02.md`](ops/r4c2-supabase-remote-probe-evidence-2026-08-02.md)
- R4C2b remote phase evidence: [`ops/r4c2b-supabase-remote-phase-chain-evidence-2026-08-02.md`](ops/r4c2b-supabase-remote-phase-chain-evidence-2026-08-02.md)
- R4C2b machine-readable evidence: [`ops/r4c2b-supabase-remote-phase-chain-evidence-2026-08-02.json`](ops/r4c2b-supabase-remote-phase-chain-evidence-2026-08-02.json)
- Completed R3 plan: [`ops/r3-adapter-reader-integration-plan-2026-08-01.md`](ops/r3-adapter-reader-integration-plan-2026-08-01.md)
- Runtime invariants: [`history-runtime-contract.md`](history-runtime-contract.md)
- Resource gates: [`resource-envelope.md`](resource-envelope.md)

## Retired production checkpoint

Controlling checkpoint: Issue #1079.

- network: `devnet`
- Mainnet enabled: `false`
- Worker Cron: empty
- last completed slot: `2026-08-01T03:52:00Z`
- failed slot: `2026-08-01T03:53:00Z`
- failure: `Too many subrequests by single Worker invocation`
- last processed ledger: `4,051,454`
- latest observed ledger at halt: `4,108,194`
- terminal lag: `56,740`
- successor chain: halted
- 24-hour soak: not started

The halted Cloudflare deployment is rollback context and historical evidence only. It is not an operating collector.

## Completed reconstruction milestones

- R0 contract and portability reset: PR #1081.
- R1 reference schema and deterministic planner: PR #1082.
- R2 portable typed runtime and parent exit: PRs #1084–#1095.
- R3 adapters, reader, mappers, publication, maintenance, and complete-state transfer: PRs #1096–#1101.
- R4A qualification contract and initial matrix: PR #1102.
- R4B machine-readable evaluator: PR #1103.
- R4C1 local SQLite service supervisor: PR #1104.
- R4C2a Supabase remote probe bootstrap and unattended deploy: PRs #1105–#1107.
- R4C2b Supabase durable remote phase chain: PR #1108, merge `aa5712e874707993d7eb945430c9d926d070b461`.
- Supabase deployment run ledger: Issue #1109 and PR #1110, merge `c6446d8c5f336665e1f873c34c30556ec0c907bd`.

## R3 completion

R3 is complete on `main`. Retained R3A–R3E suites prove provider-neutral phase execution, committed-reader semantics, strict seven-class mapping, legacy-authoritative shadow comparison, verified publication, publication-gated maintenance, and exact complete-state export, restore, and continuation.

## Active R4 work

### R4C1 — Local SQLite profile

Status: **complete on `main`; conditional and unselected**.

The local file-backed SQLite supervisor proves crash/reopen persistence, exact-expiry process-lease reclaim, scheduler-state persistence, backoff, graceful stop, and terminal halt. G7 throughput, G8 sustained resources, and G9 actual always-on operations remain unresolved.

### R4C2a — Supabase remote probe

Status: **complete**.

Run `30709474048` verified cardless remote project access, Vault-backed authentication, migration and Edge Function deployment, one-minute `pg_cron`, short-lived transactional tick leases, repeated Devnet observation, and sanitized evidence.

### R4C2b — Supabase durable remote phase chain

Status: **remote implementation and verification complete; evidence merge pending**.

Run `30726776731` succeeded on main commit `c6446d8c5f336665e1f873c34c30556ec0c907bd`.

Verified deployment steps:

- exact project link;
- pending migration application;
- exact Devnet phase executor deployment;
- remote phase-chain verifier;
- sanitized evidence artifact;
- Issue #1109 run locator publication.

Retained evidence at `2026-08-02T01:17:22.860Z`:

- profile: `supabase-devnet`;
- network: `devnet`;
- phase epoch: `supabase-r4c2b-v1`;
- immutable base ledger: `4,132,391`;
- stream status: `active`;
- completed ticks: `504`;
- recent Cron runs: `5/5 completed`;
- consecutive failures: `0`;
- last error: `null`;
- retained consecutive committed works: `4`;
- committed watermark ledger: `4,132,395`;
- committed watermark hash: `63B0C8EDE770DCA9591E9147CA036821AC5197B8AC2403A394D8C1AA8F9D9454`;
- latest successor: `scan / pending / attempt 0`;
- recent terminal phase messages: `0`.

The latest retained work proves the exact sequence:

`scan completed/staged -> deterministic commit completed -> deterministic finalize completed/committed -> committed watermark -> deterministic next scan pending`.

The committed-only view exposed the `validated-ledger` row matching the watermark. Four consecutive ledger rows from `4,132,392` through `4,132,395` were retained as committed evidence.

This closes the initial remote portions of G3 and G4 for one validated-ledger work item per scan and provides remote committed-only visibility evidence for that class. It does not complete the full hard gates.

### R4C2c — Seven-class remote collector and reader/transfer parity

Status: **next**.

Required work:

1. extend remote scan normalization and persistence to all seven semantic classes;
2. preserve exact phase identity, atomic successor reservation, and committed-only visibility;
3. implement immutable Supabase reader fences and source/query/order-bound cursors;
4. implement exact collection, scheduler, publication, and maintenance export;
5. prove empty-target restore with canonical parity and post-restore continuation;
6. add interruption, retry, stale-lease, duplicate, and terminal-injection evidence remotely.

### R4C2d–R4E

- R4C2d: G7 throughput and G8 sustained resource/quota qualification;
- R4C2e: R4B decision revision and R4E selection or `no_profile_qualified`.

The Supabase profile remains `remote_verified_conditional_candidate`, `not_selected`, and unavailable for public cutover or R5 recovery.

## Later phases

### R5 — Controlled recovery

Deploy only a fully qualified and explicitly selected R4 profile. Then prove one staged work item, rollback, restore, and a fixed two-hour catch-up qualification.

### R6 — Lag-zero and steady qualification

Reach lag zero, pass twelve consecutive five-minute freshness checkpoints, and remain inside a measured no-cost envelope.

### R7 — Formal operation evidence

Pass fixed 24-hour and seven-day evidence windows before reopening formal Devnet release qualification.

## Operating restrictions

- Do not describe the Supabase R4C2b chain as the full seven-class collector.
- Do not describe the retired Cloudflare collector as operating.
- Do not restart the retired fixed-32-ledger runtime.
- Do not select a profile before all R4 hard gates pass.
- Do not add a payment method, paid plan, or automatic-overage profile.
- Do not use GitHub Actions as the normal collection clock; Supabase `pg_cron` owns the remote clock.
- Do not start R5 recovery or R6 stabilization/soak early.
- Do not enable Mainnet.
- Do not switch the public reader.
- Do not skip a failed ledger or advance state after partial persistence.
- Do not silently fall back after integrity or identity failure.
- Do not call a theoretical no-cost projection an operating result.
