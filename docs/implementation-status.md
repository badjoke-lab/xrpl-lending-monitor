# Implementation status

Last updated: `2026-08-02`.

## Current phase

XRPL Lending Monitor is **not formally released**.

The retired Cloudflare fixed-32-ledger recovery remains halted after a content-dependent Worker subrequest failure. Worker Cron remains empty, Mainnet remains disabled, the public read surface remains legacy-authoritative, and no stabilization qualification or soak is active.

The separate Supabase Free Devnet qualification surfaces now have:

- a deployed seven-class active executor;
- a remotely verified schema-3 `scan -> commit -> finalize -> next scan` active phase chain;
- a remotely verified qualification-only active committed reader;
- an isolated historical-witness profile containing `237` canonical real Devnet rows across all seven semantic classes;
- remotely verified historical committed reads `100 / 100 / 37`;
- exact lookup and count parity for every historical class;
- a non-empty `16`-row cross-class Loan relationship query;
- exact duplicate historical loader convergence;
- an isolated standard-phase multi-chunk profile;
- remotely verified `scan -> commit:0 -> commit:1 -> commit:2 -> finalize` execution;
- exact payload and commit chunk sizes `40 / 40 / 36`;
- remotely verified committed-reader continuation `40 / 40 / 36` under one work fence;
- active-watermark isolation during the multi-chunk work;
- fail-closed cursor, source, fence, credential, and purpose rejection.

Complete-state transfer, post-restore continuation, remote fault qualification, throughput, and Free-plan resource qualification remain incomplete. The Supabase profile remains an R4 conditional candidate and is not selected for public or production cutover.

## Controlling documents

- Recovery design and schedule: [`ops/p0-budgeted-microbatch-reconstruction-2026-08-01.md`](ops/p0-budgeted-microbatch-reconstruction-2026-08-01.md)
- R4 qualification contract and schedule: [`ops/r4-deployment-profile-qualification-plan-2026-08-01.md`](ops/r4-deployment-profile-qualification-plan-2026-08-01.md)
- R4 initial matrix: [`ops/r4-initial-profile-matrix-2026-08-01.json`](ops/r4-initial-profile-matrix-2026-08-01.json)
- R4B evaluator evidence: [`ops/r4b-profile-qualification-evaluator-evidence-2026-08-01.md`](ops/r4b-profile-qualification-evaluator-evidence-2026-08-01.md)
- R4C1 local SQLite evidence: [`ops/r4c1-local-sqlite-service-evidence-2026-08-01.md`](ops/r4c1-local-sqlite-service-evidence-2026-08-01.md)
- R4C2a Supabase probe evidence: [`ops/r4c2-supabase-remote-probe-evidence-2026-08-02.md`](ops/r4c2-supabase-remote-probe-evidence-2026-08-02.md)
- R4C2b remote phase evidence: [`ops/r4c2b-supabase-remote-phase-chain-evidence-2026-08-02.md`](ops/r4c2b-supabase-remote-phase-chain-evidence-2026-08-02.md)
- R4C2c remote executor evidence: [`ops/r4c2c-supabase-seven-class-remote-evidence-2026-08-02.md`](ops/r4c2c-supabase-seven-class-remote-evidence-2026-08-02.md)
- R4C2c active committed-reader evidence: [`ops/r4c2c-supabase-committed-reader-evidence-2026-08-02.md`](ops/r4c2c-supabase-committed-reader-evidence-2026-08-02.md)
- R4C2c historical witness discovery: [`ops/r4c2c-devnet-historical-witness-evidence-2026-08-02.md`](ops/r4c2c-devnet-historical-witness-evidence-2026-08-02.md)
- R4C2c historical profile plan: [`ops/r4c2c-supabase-historical-witness-profile-plan-2026-08-02.md`](ops/r4c2c-supabase-historical-witness-profile-plan-2026-08-02.md)
- R4C2c historical remote evidence: [`ops/r4c2c-supabase-historical-witness-remote-evidence-2026-08-02.md`](ops/r4c2c-supabase-historical-witness-remote-evidence-2026-08-02.md)
- R4C2c multi-chunk plan: [`ops/r4c2c-supabase-multichunk-witness-plan-2026-08-02.md`](ops/r4c2c-supabase-multichunk-witness-plan-2026-08-02.md)
- R4C2c durable-source correction: [`ops/r4c2c-multichunk-durable-source-recovery-2026-08-02.md`](ops/r4c2c-multichunk-durable-source-recovery-2026-08-02.md)
- R4C2c multi-chunk remote evidence: [`ops/r4c2c-supabase-multichunk-remote-evidence-2026-08-02.md`](ops/r4c2c-supabase-multichunk-remote-evidence-2026-08-02.md)
- R4C2c machine-readable multi-chunk evidence: [`ops/r4c2c-supabase-multichunk-remote-evidence-2026-08-02.json`](ops/r4c2c-supabase-multichunk-remote-evidence-2026-08-02.json)
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
- R4C2b Supabase durable remote phase chain: PR #1108.
- R4C2c seven-class executor, prebundle, and transport separation: PRs #1112–#1115.
- R4C2c qualification-only active committed reader and evidence: PRs #1116–#1117.
- Read-only historical witness discovery and evidence: PRs #1119–#1121.
- Isolated historical persistence and seven-class reader: PR #1122.
- Historical remote evidence reconciliation: PR #1123.
- Isolated standard-phase multi-chunk implementation: PR #1124.
- Durable historical loader reuse: PR #1125.
- Durable source reconstruction for multi-chunk work: PR #1126.

## R3 completion

R3 is complete on `main`. Retained R3A–R3E suites prove provider-neutral phase execution, committed-reader semantics, strict seven-class mapping, legacy-authoritative shadow comparison, verified publication, publication-gated maintenance, and exact complete-state export, restore, and continuation in the provider-neutral/local contract.

R4 still requires the selected remote profile to prove the corresponding transfer and continuation behavior remotely.

## Active R4 work

### R4C1 — Local SQLite profile

Status: **complete on `main`; conditional and unselected**.

The local file-backed SQLite supervisor proves crash/reopen persistence, exact-expiry process-lease reclaim, scheduler-state persistence, backoff, graceful stop, and terminal halt. G7 throughput, G8 sustained resources, and G9 actual always-on operations remain unresolved.

### R4C2a — Supabase remote probe

Status: **complete**.

Run `30709474048` verified cardless remote project access, Vault-backed authentication, migration and Edge Function deployment, one-minute `pg_cron`, short-lived transactional tick leases, repeated Devnet observation, and sanitized evidence.

### R4C2b — Supabase durable remote phase chain

Status: **complete with retained repository evidence**.

Run `30726776731` proved durable scan, commit, finalize, watermark, and successor state with four consecutive committed validated-ledger works.

### R4C2c — Seven-class remote collector and reader/transfer parity

Status: **non-empty seven-class, relationship, and standard multi-chunk phase/reader evidence complete in isolated qualification profiles; remote transfer and fault evidence active**.

#### Active executor and reader

The active Supabase profile remains `supabase-devnet` under epoch `supabase-r4c2c-v1`. Run `30747137075` reverified it on main commit `3f1d8b43e0100edba61f3016cd67d3f162d48be0`:

- completed ticks: `914`;
- consecutive failures: `0`;
- watermark ledger: `4,132,531`;
- collector verifier attempt: `1`;
- committed-reader verifier attempt: `1`.

The active reader retains immutable-fence, exact, ledger-range, deterministic order, cursor tamper, query/order mismatch, cross-source, stale-fence, and bounded-page evidence for active committed rows.

#### Historical seven-class and relationship proof

The isolated historical profile retains `237` canonical rows from three real Devnet ledgers with page sizes `100 / 100 / 37`, exact lookup for every class, and a `16`-row Loan relationship spanning object change, lifecycle, archive, and current projection.

Run `30747137075` passed that verifier again without depending on pruned external history.

#### Standard multi-chunk phase and reader proof

Run `30747137075` completed one isolated work under profile `supabase-devnet-multichunk-witness`.

Source work:

- ledger: `2,776,760`;
- source rows: `116`;
- durable historical set digest: `bac80ec90ba841b683ee9e4b154cf385ffd972ce636f9797cb8f6cff1cdd209a`;
- work ID: `collector-work-v1:devnet:supabase-r4c2c-v1:multichunk-witness-2776760:2776760:E7E4E253C314D5EBD39E8C063415A99299E48FB23A0E613F1FE5CA534B0C0628`.

Exact phase sequence, all at attempt `1`:

1. `scan`;
2. `commit:0` — `40` rows;
3. `commit:1` — `40` rows;
4. `commit:2` — `36` rows;
5. `finalize`.

Remote parity:

- payload chunks: `40 / 40 / 36`;
- commit operations: `40 / 40 / 36`;
- row mutations: `40 / 40 / 36`;
- committed rows: `116`;
- reader pages: `40 / 40 / 36`;
- unique reader rows: `116`;
- exact lookup: passed;
- semantic-count parity: passed;
- immutable work fence: passed;
- cursor and credential rejection: passed.

The active watermark was identical before and after isolated execution at ledger `4,132,531`; the isolated work ID never entered the active watermark.

This closes retained true multi-chunk standard-phase execution and single-work multi-page committed-reader continuation for the isolated remote qualification profile.

Remaining R4C2c work:

1. implement exact remote collection, scheduler, publication, and maintenance export;
2. prove empty-target restore with canonical parity;
3. prove post-restore continuation;
4. add remote interruption rollback evidence;
5. add remote retry and backoff evidence;
6. add stale-lease reclaim evidence;
7. add duplicate phase replay evidence;
8. add terminal-injection and fail-closed halt evidence.

### R4C2d–R4E

- R4C2d: G7 throughput and G8 sustained resource/quota qualification;
- R4C2e: R4B decision revision and R4E selection or `no_profile_qualified`.

R4C2d must not start from a claim that R4C2c is complete. The Supabase profile remains `remote_verified_conditional_candidate`, `not_selected`, and unavailable for public cutover or R5 recovery.

## Later phases

### R5 — Controlled recovery

Deploy only a fully qualified and explicitly selected R4 profile. Then prove one staged work item, rollback, restore, and a fixed two-hour catch-up qualification.

### R6 — Lag-zero and steady qualification

Reach lag zero, pass twelve consecutive five-minute freshness checkpoints, and remain inside a measured no-cost envelope.

### R7 — Formal operation evidence

Pass fixed 24-hour and seven-day evidence windows before reopening formal Devnet release qualification.

## Operating restrictions

- Do not describe isolated historical or multi-chunk proof as a public-reader or active-profile cutover.
- Do not describe R4C2c as complete while remote transfer and fault evidence remain unresolved.
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
