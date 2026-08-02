# Implementation status

Last updated: `2026-08-02`.

## Current phase

XRPL Lending Monitor is **not formally released**.

The retired Cloudflare fixed-32-ledger recovery remains halted after a content-dependent Worker subrequest failure. Worker Cron remains empty, Mainnet remains disabled, the public read surface remains legacy-authoritative, and no stabilization qualification or soak is active.

A separate Supabase Free Devnet remote probe is now deployed and verified. It is an R4 qualification candidate, not the full collector and not a public-reader or production cutover.

## Controlling documents

- Recovery design and schedule: [`ops/p0-budgeted-microbatch-reconstruction-2026-08-01.md`](ops/p0-budgeted-microbatch-reconstruction-2026-08-01.md)
- R4 qualification contract and schedule: [`ops/r4-deployment-profile-qualification-plan-2026-08-01.md`](ops/r4-deployment-profile-qualification-plan-2026-08-01.md)
- R4 initial matrix: [`ops/r4-initial-profile-matrix-2026-08-01.json`](ops/r4-initial-profile-matrix-2026-08-01.json)
- R4B evaluator evidence: [`ops/r4b-profile-qualification-evaluator-evidence-2026-08-01.md`](ops/r4b-profile-qualification-evaluator-evidence-2026-08-01.md)
- R4C1 local SQLite evidence: [`ops/r4c1-local-sqlite-service-evidence-2026-08-01.md`](ops/r4c1-local-sqlite-service-evidence-2026-08-01.md)
- R4C2 Supabase remote evidence: [`ops/r4c2-supabase-remote-probe-evidence-2026-08-02.md`](ops/r4c2-supabase-remote-probe-evidence-2026-08-02.md)
- R4C2 machine-readable evidence: [`ops/r4c2-supabase-remote-probe-evidence-2026-08-02.json`](ops/r4c2-supabase-remote-probe-evidence-2026-08-02.json)
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
- R4C1 local SQLite service supervisor harness: PR #1104, merge `2e93a2b7f498ab6b292d9b2f05c8b0fe75e9fdb5`.
- Supabase remote probe bootstrap: PR #1105, merge `05a3ce015e6a9ef39fbfe92fa11e522b3091b7ff`.
- Unattended Supabase deploy and verification workflow: PR #1106, merge `ca5c029311a3a50404eedb4ea3f7a0e5c2735c30`.

## R3 completion

R3 is complete on `main`. Retained R3A–R3E suites prove provider-neutral phase execution, committed-reader semantics, strict seven-class mapping, legacy-authoritative shadow comparison, verified publication, publication-gated maintenance, and exact complete-state export, restore, and continuation.

## Active R4 work

### R4C1 — Local SQLite profile

Status: **complete on `main`**.

The local file-backed SQLite supervisor proves crash/reopen persistence, exact-expiry process-lease reclaim, scheduler-state persistence, backoff, graceful stop, and terminal halt.

Its R4B decision remains conditional and unselected because G7 throughput, G8 sustained resource evidence, and G9 actual always-on operations were unresolved.

### R4C2 — Supabase Free remote probe

Status: **remote deployment and repeated one-minute probe verified; full profile qualification incomplete**.

GitHub Actions run `30709474048` succeeded on main commit `ca5c029311a3a50404eedb4ea3f7a0e5c2735c30`.

Verified steps:

- exact project link;
- pending migration application;
- `xrpl-collector-tick` Edge Function deployment;
- repeated one-minute `pg_cron` execution;
- sanitized evidence upload.

Retained evidence at `2026-08-01T17:03:16.005Z`:

- profile: `supabase-devnet`;
- network: `devnet`;
- health: `ok`;
- completed ticks observed: `10`;
- recent retained Cron runs: `5/5 completed`;
- consecutive failures: `0`;
- last error: `null`;
- latest validated ledger: `4,123,382`;
- latest validated ledger hash: `1DEDFD5F3A1074226E683988309B1D0A54F258881536891618AB9EB9A082F4C6`.

The runtime reports `stopped` between ticks because each short Cron invocation releases its lease after completion. Repeated completed `pg_cron` runs prove that the remote schedule was active at the evidence timestamp.

This proves remote deployment, Vault-backed authentication, one-minute scheduling, short-lived transactional lease behavior, repeated Devnet ledger observation, and unattended GitHub-driven redeployment.

It does **not** yet prove the complete portable collector on Supabase. Remaining qualification work:

1. remote scan, commit, finalize, retry, lease, and successor conformance;
2. remote committed-reader isolation and exact complete-state transfer;
3. all seven semantic classes;
4. G7 throughput measurement;
5. G8 sustained resource and quota stop evidence;
6. longer unattended reliability evidence;
7. R4B decision update and R4E selection or `no_profile_qualified`.

The Supabase profile remains a conditional candidate, unselected, and unavailable for public cutover or R5 recovery.

## Later phases

### R5 — Controlled recovery

Deploy only a fully qualified and explicitly selected R4 profile. Then prove one staged work item, rollback, restore, and a fixed two-hour catch-up qualification.

### R6 — Lag-zero and steady qualification

Reach lag zero, pass twelve consecutive five-minute freshness checkpoints, and remain inside a measured no-cost envelope.

### R7 — Formal operation evidence

Pass fixed 24-hour and seven-day evidence windows before reopening formal Devnet release qualification.

## Operating restrictions

- Do not describe the Supabase probe as the full collector.
- Do not describe the retired Cloudflare collector as operating.
- Do not restart the retired fixed-32-ledger runtime.
- Do not select a profile before all R4 hard gates pass.
- Do not add a payment method, paid plan, or automatic-overage profile.
- Do not use GitHub Actions as the normal collection clock; Supabase `pg_cron` owns the remote probe clock.
- Do not start R5 recovery or R6 stabilization/soak early.
- Do not enable Mainnet.
- Do not switch the public reader.
- Do not skip a failed ledger or advance state after partial persistence.
- Do not silently fall back after integrity or identity failure.
- Do not call a theoretical no-cost projection an operating result.
