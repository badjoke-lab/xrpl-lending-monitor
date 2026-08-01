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

## R3 completion

R3 is complete on `main`. The retained R3A–R3E suites prove provider-neutral phase execution, committed-reader semantics, seven strict mappers, legacy-authoritative shadow comparison, independently verified publication, publication-gated maintenance, and exact complete-state export, restore, and continuation.

## Active R4 work

### R4A — Qualification contract and initial matrix

Status: **complete on `main`** in PR #1102, merge `158087602b1bcde515f0b68eae47133bb93645ea`.

R4A defines ten non-overridable hard gates for cost/card safety, automatic overage, scheduler durability, transactionality, committed-only reads, complete-state portability, throughput, resource fail-closed behavior, operator independence, and production isolation.

Initial classifications remain:

- cardless self-hosted SQLite service: conditional candidate;
- Supabase Free Postgres plus pg_cron/Edge Functions: conditional candidate;
- Turso Free storage plus cardless self-hosted executor: conditional candidate;
- existing Cloudflare Workers/D1/Queues profile: blocked;
- GitHub Actions-only collector: rejected;
- Deno Deploy Free managed runtime: rejected.

No profile is selected.

### R4B — Machine-readable evaluator

Status: **implementation and validation passed in PR #1103; merge pending**.

Delivered on the branch:

- exact versioned profile identity and component schema;
- canonical SHA-256 profile identity digest;
- exactly one evidence record for each of gates `G1`–`G10`;
- evidence binding to profile ID, revision, and digest;
- deterministic rejected, conditional, or qualified classification;
- permanent `selection: not_selected` in R4B;
- scoring prohibited while a gate fails or remains unresolved;
- exact ten-dimension scorecard validation;
- canonical decision artifact and decision digest;
- changed identity, foreign evidence, missing/duplicate gate, incomplete scorecard, unsupported version, extra field, non-canonical timestamp, and invalid score rejection.

Implementation head `e17020bb001d8e848a32e4fc8ac76bbdcdf6db40` passed CI run `30703462350`:

- workflow-surface guard;
- lint;
- shell syntax and canonical-base checks;
- TypeScript type-check;
- production runner bundle and configuration validation;
- complete unit-test suite;
- clean migrations through `10007`;
- application build;
- browser smoke.

The final documentation head must pass the same ordinary CI. R4B is complete only after PR #1103 merges to `main`.

### R4C — Local profile harnesses

Status: **next after PR #1103 merges**.

Planned local-only order:

1. service-managed SQLite profile harness;
2. Postgres transaction and scheduler semantics harness;
3. libSQL/Turso-compatible storage and transfer harness;
4. Cloudflare Worker/D1/Queue resource model without remote deployment.

### R4D–R4E

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
- Do not call a theoretical no-cost projection an operating result.
