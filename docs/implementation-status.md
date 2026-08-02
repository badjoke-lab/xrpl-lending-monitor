# Implementation status

Last updated: `2026-08-03`.

## Current phase

XRPL Lending Monitor is **not formally released**.

The retired Cloudflare fixed-32-ledger recovery remains halted after a content-dependent Worker subrequest failure. Worker Cron remains empty, Mainnet remains disabled, the public read surface remains legacy-authoritative, and no recovery, stabilization qualification, or soak is active.

The separate Supabase Free Devnet qualification surfaces now have retained remote proof for:

- a deployed seven-class active executor;
- schema-3 `scan -> commit -> finalize -> next scan` continuation;
- a qualification-only committed reader with immutable fences and source-bound cursors;
- `237` canonical real Devnet rows across all seven semantic classes;
- historical committed reads `100 / 100 / 37`;
- exact lookup and count parity for every historical class;
- a non-empty `16`-row cross-class Loan relationship query;
- exact duplicate historical loader convergence;
- standard multi-chunk execution `scan -> commit:0 -> commit:1 -> commit:2 -> finalize`;
- exact payload, commit, and reader page sizes `40 / 40 / 36`;
- exact collection, scheduler, publication, and maintenance export;
- typed empty-target restore with canonical text and SHA-256 parity;
- exact duplicate restore convergence and digest-tamper rejection;
- post-restore `scan -> commit -> finalize -> next scan` continuation;
- exact one-ledger restored-watermark advance and full-row digest parity;
- duplicate scan, commit, finalize, and terminal replay convergence;
- transactional interruption rollback;
- exact 30-second retry/backoff;
- exact-expiry stale-lease reclaim;
- terminal integrity halt with no successor;
- fail-closed cursor, source, fence, credential, and purpose rejection;
- active-profile isolation for every isolated qualification unit;
- fixed 60-minute, 6-hour, and 24-hour committed-throughput baselines including zero-production minutes;
- end-to-end work latency, phase attempts, database/table bytes, row counts, payload sizes, scheduler-message sizes, and connection usage.

R4C2c is complete for the planned Supabase remote behavioral qualification. The first R4C2d baseline is also complete, but it **failed G7** and does not close G8: steady p95 was only `1` committed ledger/minute against a required value above `21`, catch-up mode was not measured, and Edge CPU, memory, invocation, bandwidth, billing, and automatic-overage evidence remain unavailable. Supabase therefore remains an R4 conditional candidate and is not selected for public or production cutover.

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
- Historical witness discovery: [`ops/r4c2c-devnet-historical-witness-evidence-2026-08-02.md`](ops/r4c2c-devnet-historical-witness-evidence-2026-08-02.md)
- Historical remote evidence: [`ops/r4c2c-supabase-historical-witness-remote-evidence-2026-08-02.md`](ops/r4c2c-supabase-historical-witness-remote-evidence-2026-08-02.md)
- Multi-chunk implementation plan: [`ops/r4c2c-supabase-multichunk-witness-plan-2026-08-02.md`](ops/r4c2c-supabase-multichunk-witness-plan-2026-08-02.md)
- Durable-source correction: [`ops/r4c2c-multichunk-durable-source-recovery-2026-08-02.md`](ops/r4c2c-multichunk-durable-source-recovery-2026-08-02.md)
- Multi-chunk remote evidence: [`ops/r4c2c-supabase-multichunk-remote-evidence-2026-08-02.md`](ops/r4c2c-supabase-multichunk-remote-evidence-2026-08-02.md)
- Complete-state transfer evidence: [`ops/r4c2c-supabase-complete-state-transfer-remote-evidence-2026-08-02.md`](ops/r4c2c-supabase-complete-state-transfer-remote-evidence-2026-08-02.md)
- Post-restore continuation evidence: [`ops/r4c2c-supabase-restore-continuation-remote-evidence-2026-08-02.md`](ops/r4c2c-supabase-restore-continuation-remote-evidence-2026-08-02.md)
- Remote fault evidence: [`ops/r4c2c-supabase-remote-fault-evidence-2026-08-02.md`](ops/r4c2c-supabase-remote-fault-evidence-2026-08-02.md)
- R4C2d throughput/resource baseline: [`ops/r4c2d-supabase-throughput-resource-baseline-evidence-2026-08-03.md`](ops/r4c2d-supabase-throughput-resource-baseline-evidence-2026-08-03.md)
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
- Isolated standard-phase multi-chunk implementation and durable replay: PRs #1124–#1127.
- Exact remote complete-state transfer: PRs #1128–#1131.
- Isolated post-restore continuation and retained evidence: PRs #1132–#1134.
- Isolated remote fault qualification: PRs #1135–#1136.
- R4C2d throughput/resource baseline and runtime-source correction: PRs #1137–#1138.

## R3 completion

R3 is complete on `main`. Retained R3A–R3E suites prove provider-neutral phase execution, committed-reader semantics, strict seven-class mapping, legacy-authoritative shadow comparison, verified publication, publication-gated maintenance, and exact complete-state export, restore, and continuation in the provider-neutral/local contract.

The corresponding Supabase transfer, continuation, and planned remote fault semantics are now also remotely proved in isolated R4C2c qualification profiles.

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

### R4C2c — Seven-class remote collector, reader, transfer, continuation, and fault parity

Status: **complete for the planned remote behavioral qualification; conditional profile remains unselected**.

#### Active executor and committed reader

The qualification profile remains `supabase-devnet` under epoch `supabase-r4c2c-v1`. Retained runs prove repeated standard phase execution, committed-only visibility, immutable read fences, deterministic order, exact and range queries, source-bound cursors, stale-fence rejection, and credential rejection.

#### Seven-class historical and relationship proof

The isolated historical profile retains `237` canonical rows from three real Devnet ledgers with page sizes `100 / 100 / 37`, exact lookup for every class, semantic-count parity, and a `16`-row Loan relationship spanning object change, lifecycle, archive, and current projection.

#### Standard multi-chunk proof

Run `30747137075` proved one real `116`-row work with exact sequence:

1. `scan`;
2. `commit:0` — `40` rows;
3. `commit:1` — `40` rows;
4. `commit:2` — `36` rows;
5. `finalize`.

Payload, commit, mutation, and reader pages all retained exact `40 / 40 / 36` parity under one immutable work fence. The active watermark remained isolated.

#### Complete-state transfer

Run `30750389833` proved exact export and typed empty-target restore of collection, scheduler, publication, and maintenance state:

- canonical bytes: `300,890`;
- canonical digest: `fb9b7dda66802f18c18200b2991ff6293cd5b11b3dd04a91d5089524ea93dda2`;
- exact 13 table-class counts;
- five completed and one pending scheduler message;
- canonical text and digest parity;
- duplicate restore convergence;
- digest-tamper rejection;
- active-profile isolation.

#### Post-restore continuation

Run `30751813536` restored ledger `4,132,573`, executed `scan -> commit -> finalize`, committed ledger `4,132,574`, and reserved the next scan. Full-row count and digest matched the durable source work. Scan, commit, and finalize duplicate completion replays all converged. The active watermark remained isolated.

#### Remote fault qualification

Run `30752742177` proved:

- transaction-abort rollback of mutation, completion, and successor reservation;
- exact `30`-second retry/backoff with pre-due rejection and attempt-2 completion;
- exact-expiry stale-lease reclaim with previous-owner evidence and attempt-2 completion;
- terminal integrity halt with message `error`, stream `halted`, no successor, pending halt probe, and duplicate terminal convergence;
- missing-token and wrong-purpose rejection;
- active watermark unchanged at ledger `4,132,584` during the isolated verifier.

This closes the planned R4C2c remote behavioral evidence for G3, G4, G5, and G6. Final gate status remains subject to the R4B evaluator; this statement is not a profile-selection decision.

### R4C2d — Throughput and Free-plan resource qualification

Status: **active; first retained baseline completed and G7/G8 remain unqualified**.

Run `30754437078`, attempt `2`, measured the active read-only profile at `2026-08-02T15:32:53.253Z`:

| Window | Committed ledgers | Average/min | p95/min | Max/min | Work p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 60 minutes | 19 | 0.316667 | 1 | 1 | 120,899.35 ms |
| 360 minutes | 119 | 0.330556 | 1 | 1 | 120,580.95 ms |
| 1,440 minutes | 208 | 0.144444 | 1 | 1 | 120,463.4 ms |

The steady gate requires p95 above `21` committed ledgers/minute. Observed p95 was `1`; G7 therefore failed. Catch-up mode was not measured and remains failed closed.

Measured resource snapshot:

- database: `24,128,659` bytes;
- payload p95/max: `990 / 990` bytes against a `512,000`-byte configured ceiling;
- scheduler payload p95/max: `570 / 570` bytes against a `16,000`-byte configured ceiling;
- connections: `9 / 60`, usage ratio `0.15`;
- runtime consecutive failures: `0`;
- active watermark unchanged by the verifier at ledger `4,132,600`.

G8 remains incomplete because this unit did not measure Edge CPU, memory, invocation count, bandwidth, billing/overage, sustained storage growth, or pre-ceiling halt behavior.

Required next work:

1. build an isolated full-phase catch-up harness rather than reusing the normal two-minute cadence;
2. prove complete committed throughput above `30/min` without active-profile mutation;
3. add retained CPU, memory, invocation, bandwidth, quota, billing, and storage-growth evidence;
4. prove fail-closed thresholds before provider ceilings;
5. revise R4B only after the new measurements exist.

### R4C2e and R4E — Re-evaluation and selection decision

After R4C2d, revise the machine-readable R4B evidence and produce either:

- `qualified_profile_selected`; or
- `no_profile_qualified`.

G1, G2, G9, and G10 require final evidence reconciliation. No schedule pressure can promote the conditional Supabase profile.

## Later phases

### R5 — Controlled recovery

Deploy only a fully qualified and explicitly selected R4 profile. Then prove one staged work item, rollback, restore, and a fixed two-hour catch-up qualification.

### R6 — Lag-zero and steady qualification

Reach lag zero, pass twelve consecutive five-minute freshness checkpoints, and remain inside a measured no-cost envelope.

### R7 — Formal operation evidence

Pass fixed 24-hour and seven-day evidence windows before reopening formal Devnet release qualification.

## Operating restrictions

- Do not describe any isolated qualification surface as a public-reader or production cutover.
- Do not describe R4C2c completion as Supabase selection or R4 completion.
- Do not describe the first R4C2d baseline as G7 or G8 qualification.
- Do not describe the retired Cloudflare collector as operating.
- Do not restart the retired fixed-32-ledger runtime.
- Do not select a profile before all R4 hard gates pass.
- Do not add a payment method, paid plan, or automatic-overage profile.
- Do not use GitHub Actions as the normal collection clock; Supabase `pg_cron` owns the qualification clock.
- Do not start R5 recovery, R6 stabilization, or R7 soak early.
- Do not enable Mainnet.
- Do not switch the public reader.
- Do not skip a failed ledger or advance state after partial persistence.
- Do not silently fall back after integrity or identity failure.
- Do not call a theoretical no-cost projection an operating result.
