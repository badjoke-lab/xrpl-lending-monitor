# Implementation status

Last updated: `2026-08-02`.

## Current phase

XRPL Lending Monitor is **not formally released**.

The retired Cloudflare fixed-32-ledger recovery remains halted after a content-dependent Worker subrequest failure. Worker Cron remains empty, Mainnet remains disabled, the public read surface remains legacy-authoritative, and no stabilization qualification or soak is active.

The separate Supabase Free Devnet profile now has:

- a deployed seven-class executor;
- a remotely verified schema-3 `scan -> commit -> finalize -> next scan` phase chain;
- a remotely verified qualification-only committed reader for retained active `validated-ledger` data;
- a separate isolated historical-witness profile containing `237` canonical real Devnet rows across all seven semantic classes;
- remotely verified three-page committed reads `100 / 100 / 37`;
- exact lookup and count parity for every class;
- a non-empty `16`-row cross-class Loan relationship query;
- exact duplicate loader convergence;
- fail-closed cursor, source, fence, credential, and purpose rejection.

The isolated witness profile does not replace or advance the active collector stream and does not alter the public reader. True multi-chunk active work, complete-state transfer, post-restore continuation, remote fault qualification, throughput, and Free-plan resource qualification remain incomplete. The Supabase profile remains an R4 conditional candidate and is not selected for public or production cutover.

## Controlling documents

- Recovery design and schedule: [`ops/p0-budgeted-microbatch-reconstruction-2026-08-01.md`](ops/p0-budgeted-microbatch-reconstruction-2026-08-01.md)
- R4 qualification contract and schedule: [`ops/r4-deployment-profile-qualification-plan-2026-08-01.md`](ops/r4-deployment-profile-qualification-plan-2026-08-01.md)
- R4 initial matrix: [`ops/r4-initial-profile-matrix-2026-08-01.json`](ops/r4-initial-profile-matrix-2026-08-01.json)
- R4B evaluator evidence: [`ops/r4b-profile-qualification-evaluator-evidence-2026-08-01.md`](ops/r4b-profile-qualification-evaluator-evidence-2026-08-01.md)
- R4C1 local SQLite evidence: [`ops/r4c1-local-sqlite-service-evidence-2026-08-01.md`](ops/r4c1-local-sqlite-service-evidence-2026-08-01.md)
- R4C2a Supabase probe evidence: [`ops/r4c2-supabase-remote-probe-evidence-2026-08-02.md`](ops/r4c2-supabase-remote-probe-evidence-2026-08-02.md)
- R4C2b remote phase evidence: [`ops/r4c2b-supabase-remote-phase-chain-evidence-2026-08-02.md`](ops/r4c2b-supabase-remote-phase-chain-evidence-2026-08-02.md)
- R4C2b machine-readable evidence: [`ops/r4c2b-supabase-remote-phase-chain-evidence-2026-08-02.json`](ops/r4c2b-supabase-remote-phase-chain-evidence-2026-08-02.json)
- R4C2c remote deployment evidence: [`ops/r4c2c-supabase-seven-class-remote-evidence-2026-08-02.md`](ops/r4c2c-supabase-seven-class-remote-evidence-2026-08-02.md)
- R4C2c machine-readable deployment evidence: [`ops/r4c2c-supabase-seven-class-remote-evidence-2026-08-02.json`](ops/r4c2c-supabase-seven-class-remote-evidence-2026-08-02.json)
- R4C2c committed-reader implementation unit: [`ops/r4c2c-supabase-committed-reader-plan-2026-08-02.md`](ops/r4c2c-supabase-committed-reader-plan-2026-08-02.md)
- R4C2c committed-reader remote evidence: [`ops/r4c2c-supabase-committed-reader-evidence-2026-08-02.md`](ops/r4c2c-supabase-committed-reader-evidence-2026-08-02.md)
- R4C2c committed-reader machine-readable evidence: [`ops/r4c2c-supabase-committed-reader-evidence-2026-08-02.json`](ops/r4c2c-supabase-committed-reader-evidence-2026-08-02.json)
- R4C2c historical witness discovery: [`ops/r4c2c-devnet-historical-witness-evidence-2026-08-02.md`](ops/r4c2c-devnet-historical-witness-evidence-2026-08-02.md)
- R4C2c historical witness machine-readable discovery: [`ops/r4c2c-devnet-historical-witness-evidence-2026-08-02.json`](ops/r4c2c-devnet-historical-witness-evidence-2026-08-02.json)
- R4C2c isolated historical profile plan: [`ops/r4c2c-supabase-historical-witness-profile-plan-2026-08-02.md`](ops/r4c2c-supabase-historical-witness-profile-plan-2026-08-02.md)
- R4C2c isolated historical remote evidence: [`ops/r4c2c-supabase-historical-witness-remote-evidence-2026-08-02.md`](ops/r4c2c-supabase-historical-witness-remote-evidence-2026-08-02.md)
- R4C2c isolated historical machine-readable evidence: [`ops/r4c2c-supabase-historical-witness-remote-evidence-2026-08-02.json`](ops/r4c2c-supabase-historical-witness-remote-evidence-2026-08-02.json)
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
- R4C2c seven-class remote executor implementation: PR #1112, merge `9bd01c94f891f72f7e04c54ebb106f55fa475d37`.
- Supabase prebundle and Cloudflare-transport separation: PRs #1113 and #1114, final merge `fa275a6372cd8d9ee3a486b5e65b530ffc421eb1`.
- R4C2c remote deployment evidence reconciliation: PR #1115, merge `805f0fca31e763abd3f65555019e5e8d2317124b`.
- R4C2c qualification-only committed reader: PR #1116, merge `5b3a1843743c3cada0061ea51f00d5612651490a`.
- R4C2c committed-reader evidence reconciliation: PR #1117, merge `7607cec34176349b1bd68d4f86e479fc406d3052`.
- Read-only Devnet historical witness discovery: PRs #1119 and #1120, final merge `9139af3b4d677d5d70fcbae92052de892746ecfe`.
- Historical witness discovery evidence: PR #1121, merge `6a8575cda4fdc1b127996ffa39350280e540fd74`.
- Isolated historical persistence and seven-class reader: PR #1122, merge `11c0c472aedb7cc58248d9b83f429aa3f26cdf8f`.

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

Status: **complete with retained repository evidence**.

Run `30726776731` succeeded on main commit `c6446d8c5f336665e1f873c34c30556ec0c907bd`.

Retained evidence:

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
- latest successor: `scan / pending / attempt 0`.

This closes the initial remote normal-success-path portions of G3 and G4 for one validated-ledger work item per scan and initial committed-only visibility for that class. It does not complete the full hard gates.

### R4C2c — Seven-class remote collector and reader/transfer parity

Status: **isolated non-empty seven-class and relationship reader evidence complete; active multi-chunk, transfer, and fault evidence active**.

#### Active executor and reader

Run `30735822415` on main commit `fa275a6372cd8d9ee3a486b5e65b530ffc421eb1` proved deployment of the seven-class executor. It retained one `validated-ledger` row and zero rows in the other six semantic classes.

Run `30737493360` on main commit `5b3a1843743c3cada0061ea51f00d5612651490a` deployed the qualification-only committed reader and passed both remote verifiers on attempt `1`.

Retained active-reader evidence:

- reader bundle bytes: `17,636`;
- reader bundle SHA-256: `cd58239dc91cfe61828216e7de3e0e711984b6d2c62295dad45bf083e7f04d03`;
- unresolved relative imports: `0`;
- Cloudflare runtime imports: `0`;
- one-run verifier token: rotated and masked, value not retained;
- fence ledger: `4,132,435`;
- fence hash: `CB19F0E00E3314DA18D4C17AFFEDF1C7F120D46FAC6634DDCFC81A259011CBB6`;
- collector completed ticks: `624`;
- consecutive failures: `0`;
- last error: `null`;
- latest successor: `scan / pending / attempt 0`.

The active reader proved immutable-fence pagination, deterministic ordering, exact lookup parity, ledger-range parity, digest-tamper rejection, query/order mismatch rejection, cross-source rejection, stale-fence rejection, and bounded page size for `validated-ledger` data.

#### Real Devnet historical witness discovery

Read-only workflow run `30741004656` located a minimal three-ledger real Devnet witness set:

- ledger `2,776,760`;
- ledger `2,980,845`;
- ledger `3,127,240`.

The normalized set contains `237` canonical rows and non-empty data for all seven semantic classes.

#### Isolated historical persistence and reader

Run `30742455945` on main commit `11c0c472aedb7cc58248d9b83f429aa3f26cdf8f` succeeded.

Isolated profile:

- profile: `supabase-devnet-historical-witness`;
- source: `supabase-r4c2c-historical-witness`;
- purpose: `r4c2c-historical-witness-remote-verification`;
- epoch: `supabase-r4c2c-historical-witness-v1`;
- base identity: `historical-witness-2776760-2980845-3127240`;
- fence ledger: `3,127,240`;
- work: `historical-witness-work-v1:2776760:2980845:3127240`.

Atomic persistence:

- rows: `237`;
- records digest: `sha256:bac80ec90ba841b683ee9e4b154cf385ffd972ce636f9797cb8f6cff1cdd209a`;
- first exact commit: `duplicate: false`;
- repeated exact commit: `duplicate: true`.

Committed reader:

- page sizes: `100 / 100 / 37`;
- unique rows: `237`;
- `validated-ledger`: `3`;
- `protocol-event`: `13`;
- `object-change`: `197`;
- `loan-lifecycle`: `3`;
- `archived-object`: `1`;
- `balance-history`: `2`;
- `current-projection`: `18`;
- exact lookup: passed for every class;
- relationship rows: `16`;
- relationship classes: object change, loan lifecycle, archived object, and current projection;
- cursor tamper rejection: passed;
- query/order mismatch rejection: passed;
- cross-source rejection: passed;
- stale-fence rejection: passed;
- missing-token rejection: passed;
- wrong-purpose rejection: passed.

The same run reverified the active collector and active reader at watermark ledger `4,132,485`, with `774` completed ticks, zero consecutive failures, no last error, five completed recent Cron runs, and a pending next scan at attempt `0`. The historical profile remained separate from the active watermark and public reader.

This closes retained non-empty seven-class read/count/exact parity and non-empty relationship-query evidence for the isolated qualification profile. It does not prove a true multi-chunk all-class active collector work item.

Remaining R4C2c work:

1. prove true multi-chunk active phase execution and committed-reader continuation;
2. implement exact collection, scheduler, publication, and maintenance export;
3. prove empty-target restore with canonical parity and post-restore continuation;
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

- Do not describe the isolated historical-witness proof as a public or active-stream cutover.
- Do not describe R4C2c as complete while true multi-chunk active work, transfer, and remote fault evidence remain unresolved.
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
