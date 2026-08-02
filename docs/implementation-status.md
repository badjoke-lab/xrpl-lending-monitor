# Implementation status

Last updated: `2026-08-03`.

## Current phase

XRPL Lending Monitor is **not formally released**.

The retired Cloudflare fixed-32-ledger recovery remains halted. Worker Cron remains empty, Mainnet remains disabled, the legacy public reader remains authoritative, and no R5 recovery, stabilization qualification, or soak is active.

The Supabase Free Devnet profile remains **conditional and unselected**. R4C2c behavioral qualification is complete. R4C2d now has a qualified G7 throughput result, while G8 resource and no-charge qualification remains incomplete.

## Current gate result

- G3 durable scheduler and fault behavior: remotely proved in isolated qualification profiles.
- G4 transactional phase completion and rollback: remotely proved.
- G5 committed-only reads and source-bound fences/cursors: remotely proved.
- G6 complete-state export, typed restore, digest parity, duplicate convergence, and post-restore continuation: remotely proved.
- G7 throughput: **qualified** for the measured Supabase qualification design.
  - network-inclusive steady p95: `24 committed ledgers/minute`, threshold `>21`;
  - retained isolated catch-up p95: `14,178.400673920027 committed ledgers/minute`, threshold `>30`.
- G8 resource fail-closed behavior: **incomplete**.
- G1, G2, G9, and G10: require final R4B evidence reconciliation before any profile selection.
- profile selected: `false`.

## Controlling evidence

- R4 qualification contract: [`ops/r4-deployment-profile-qualification-plan-2026-08-01.md`](ops/r4-deployment-profile-qualification-plan-2026-08-01.md)
- R4 initial matrix: [`ops/r4-initial-profile-matrix-2026-08-01.json`](ops/r4-initial-profile-matrix-2026-08-01.json)
- R4B evaluator evidence: [`ops/r4b-profile-qualification-evaluator-evidence-2026-08-01.md`](ops/r4b-profile-qualification-evaluator-evidence-2026-08-01.md)
- R4C1 local SQLite evidence: [`ops/r4c1-local-sqlite-service-evidence-2026-08-01.md`](ops/r4c1-local-sqlite-service-evidence-2026-08-01.md)
- R4C2a remote probe: [`ops/r4c2-supabase-remote-probe-evidence-2026-08-02.md`](ops/r4c2-supabase-remote-probe-evidence-2026-08-02.md)
- R4C2b durable phase chain: [`ops/r4c2b-supabase-remote-phase-chain-evidence-2026-08-02.md`](ops/r4c2b-supabase-remote-phase-chain-evidence-2026-08-02.md)
- R4C2c seven-class executor: [`ops/r4c2c-supabase-seven-class-remote-evidence-2026-08-02.md`](ops/r4c2c-supabase-seven-class-remote-evidence-2026-08-02.md)
- R4C2c committed reader: [`ops/r4c2c-supabase-committed-reader-evidence-2026-08-02.md`](ops/r4c2c-supabase-committed-reader-evidence-2026-08-02.md)
- historical seven-class witness: [`ops/r4c2c-supabase-historical-witness-remote-evidence-2026-08-02.md`](ops/r4c2c-supabase-historical-witness-remote-evidence-2026-08-02.md)
- standard multi-chunk evidence: [`ops/r4c2c-supabase-multichunk-remote-evidence-2026-08-02.md`](ops/r4c2c-supabase-multichunk-remote-evidence-2026-08-02.md)
- complete-state transfer: [`ops/r4c2c-supabase-complete-state-transfer-remote-evidence-2026-08-02.md`](ops/r4c2c-supabase-complete-state-transfer-remote-evidence-2026-08-02.md)
- post-restore continuation: [`ops/r4c2c-supabase-restore-continuation-remote-evidence-2026-08-02.md`](ops/r4c2c-supabase-restore-continuation-remote-evidence-2026-08-02.md)
- remote fault qualification: [`ops/r4c2c-supabase-remote-fault-evidence-2026-08-02.md`](ops/r4c2c-supabase-remote-fault-evidence-2026-08-02.md)
- normal-cadence/resource baseline: [`ops/r4c2d-supabase-throughput-resource-baseline-evidence-2026-08-03.md`](ops/r4c2d-supabase-throughput-resource-baseline-evidence-2026-08-03.md)
- isolated catch-up throughput: [`ops/r4c2d-supabase-isolated-catchup-throughput-evidence-2026-08-03.md`](ops/r4c2d-supabase-isolated-catchup-throughput-evidence-2026-08-03.md)
- network-inclusive steady throughput: [`ops/r4c2d-supabase-network-steady-throughput-evidence-2026-08-03.md`](ops/r4c2d-supabase-network-steady-throughput-evidence-2026-08-03.md)
- runtime invariants: [`history-runtime-contract.md`](history-runtime-contract.md)
- resource gates: [`resource-envelope.md`](resource-envelope.md)

## R4C2c completion

R4C2c is complete for the planned remote behavioral qualification. Retained evidence covers:

- active seven-class phase execution and committed-reader semantics;
- `237` real historical Devnet rows across all seven semantic classes;
- historical pages `100 / 100 / 37` and a non-empty `16`-row cross-class Loan relationship query;
- one real `116`-row multi-chunk work with exact payload, commit, mutation, and reader parity `40 / 40 / 36`;
- exact collection, scheduler, publication, and maintenance export;
- typed empty-target restore with canonical text and SHA-256 parity;
- duplicate restore convergence and digest-tamper rejection;
- post-restore `scan -> commit -> finalize -> next scan` continuation;
- transactional interruption rollback;
- exact retry/backoff and stale-lease reclaim;
- terminal integrity halt with no invalid successor;
- duplicate phase and terminal replay convergence;
- active-profile isolation for every isolated unit.

This completion is not a profile-selection or production-cutover decision.

## R4C2d throughput

### Baseline

Run `30754437078`, attempt `2`, measured the old normal one-phase-per-cron cadence:

| Window | Average/min | p95/min | Complete work p95 |
| --- | ---: | ---: | ---: |
| 60 minutes | 0.316667 | 1 | 120,899.35 ms |
| 360 minutes | 0.330556 | 1 | 120,580.95 ms |
| 1,440 minutes | 0.144444 | 1 | 120,463.4 ms |

That cadence failed the steady threshold and was not promoted.

### Isolated catch-up component

Run `30755497115` completed five trials of 64 real committed Devnet works. Across 320 works and 960 completed phases:

- minimum: `12,563.651375831556/min`;
- p50: `13,975.162925561042/min`;
- p95: `14,178.400673920027/min`;
- maximum: `14,225.868101463015/min`;
- all completed phases used attempt `1`;
- committed-row count/digest and target-watermark parity passed;
- active source remained read only.

The catch-up component passed the required value above `30/min`.

### Network-inclusive steady component

Run `30756935523` completed six consecutive internal `pg_cron` minute buckets. Each minute fetched, parsed, normalized, and atomically committed 24 exact Devnet ledgers through the existing Lending parser and seven-class normalizer.

- session: `r4c2d-steady-msc0utga-b72f98af`;
- ledger range: `4,132,622–4,132,765`;
- minute rates: `[24, 24, 24, 24, 24, 24]`;
- p50/p95/max: `24 / 24 / 24` ledgers/minute;
- complete Edge wall per minute: approximately `1.64–2.11 seconds`;
- atomic database transaction per minute: approximately `23–39 ms`;
- exact isolated target advance: `144` ledgers;
- all completed attempts: `1`;
- active source epoch and base identity preserved;
- active source remained read only.

The steady component passed the required value above `21/min`. Combined with the retained catch-up pass, **G7 is qualified**.

## R4C2d resource status

The retained baseline measured:

- database size: `24,128,659` bytes before the new sustained batch evidence;
- payload p95/max: `990 / 990` bytes against a `512,000`-byte configured ceiling;
- scheduler payload p95/max: `570 / 570` bytes against a `16,000`-byte configured ceiling;
- database connections: `9 / 60`;
- runtime consecutive failures: `0`.

G8 remains incomplete. Required remaining evidence includes:

1. Edge CPU consumption for normal and batch executions;
2. Edge memory consumption;
3. Function invocation counts and sustained quota use;
4. bandwidth and egress;
5. database/storage growth under the 24-ledger steady design;
6. provider quota counters and no-charge evidence;
7. billing and automatic-overage behavior;
8. explicit fail-closed thresholds before every applicable provider ceiling.

No theoretical projection may be substituted for retained provider or runtime evidence.

## Next stage

Continue R4C2d with G8 resource instrumentation and fail-closed thresholds. After G8 evidence exists, revise the machine-readable R4B decision and evaluate G1, G2, G9, and G10. R4E must produce either a fully qualified selected profile or `no_profile_qualified`.

R5 must not begin before that explicit decision.

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

The halted Cloudflare deployment remains rollback context and historical evidence only.

## Operating restrictions

- Do not describe any isolated qualification surface as a public-reader or production cutover.
- Do not describe G7 qualification as G8 qualification or Supabase selection.
- Do not describe R4C2c completion as R4 completion.
- Do not restart the retired fixed-32-ledger runtime.
- Do not select a profile before all R4 hard gates pass.
- Do not add a payment method, paid plan, or automatic-overage profile.
- Do not use GitHub Actions as the normal collection clock.
- Do not start R5 recovery, stabilization, or soak early.
- Do not enable Mainnet.
- Do not switch the public reader.
- Do not skip a failed ledger or advance state after partial persistence.
- Do not silently fall back after integrity or identity failure.
