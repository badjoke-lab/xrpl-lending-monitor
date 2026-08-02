# R4C2d Supabase network steady throughput evidence — 2026-08-03

## Result

The network-inclusive isolated steady component passed its fixed threshold.

Six consecutive internal Supabase `pg_cron` minute buckets each fetched, parsed, normalized, and atomically committed exactly `24` real Devnet ledgers. The observed steady p95 was `24 committed ledgers/minute`, above the required value greater than `21`.

The retained isolated catch-up p95 remains `14,178.400673920027 committed ledgers/minute`, above the required value greater than `30`. Therefore **G7 is qualified** for the measured Supabase qualification design.

G8 remains unqualified. This evidence does not select the profile and does not authorize R5, public-reader cutover, Mainnet, stabilization, or soak.

## Source

- workflow run: `30756935523`
- main commit: `86f138d66c025005304e294cbf0839d9d216c9d8`
- artifact: `8836287727`
- artifact digest: `sha256:db59982af833f1da2832944247b6e9705929e334d6bb539000ea63c6b6158b66`
- verified: `2026-08-02T16:41:07.704Z` / `2026-08-03 01:41:07 JST`
- session: `r4c2d-steady-msc0utga-b72f98af`
- source profile: `supabase-devnet`
- isolated target: `supabase-devnet-steady-qualification`
- network: `devnet`

The first network-steady session in run `30756685312` halted on a missing provider-neutral `createdAt` value for one otherwise valid normalized reference row. PR #1143 added a qualification-only insert-time timestamp fallback in `xrpl_steady_v1`. The corrected run created a new session and completed the fixed window without reusing the halted session.

## Fixed window

- internal clock: Supabase `pg_cron`
- target ticks: `6`
- completed ticks: `6`
- batch size: `24`
- total committed ledgers: `144`
- source ledger range: `4,132,622–4,132,765`
- target watermark: ledger `4,132,765`
- target watermark hash: `E9601D78CB69D08A0DB8CDC30CB9093DE0CBF69271BCB6BB145090FA277D28B5`
- elapsed verifier window: `319,610 ms`

Every completed minute retained a separate works digest and committed-row digest. Every minute had `73` phase messages and `72` successor reservations for the 24 full-phase works.

## Per-minute measurements

| Minute | Ledger range | Rate | XRPL fetch | Normalize | DB transaction | Complete Edge wall |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 16:36 UTC | 4,132,622–4,132,645 | 24/min | 1,098.592 ms | 25.661 ms | 35.393 ms | 1,641.352 ms |
| 16:37 UTC | 4,132,646–4,132,669 | 24/min | 1,104.783 ms | 23.721 ms | 32.622 ms | 1,700.838 ms |
| 16:38 UTC | 4,132,670–4,132,693 | 24/min | 1,137.328 ms | 22.178 ms | 39.145 ms | 1,871.202 ms |
| 16:39 UTC | 4,132,694–4,132,717 | 24/min | 1,097.307 ms | 24.172 ms | 26.760 ms | 1,877.337 ms |
| 16:40 UTC | 4,132,718–4,132,741 | 24/min | 1,138.741 ms | 26.479 ms | 23.083 ms | 2,107.162 ms |
| 16:41 UTC | 4,132,742–4,132,765 | 24/min | 1,137.901 ms | 22.658 ms | 28.294 ms | 1,886.471 ms |

All complete Edge executions remained far below the `50,000 ms` cron HTTP timeout.

## Full-phase semantics

Each of the `144` ledgers was obtained through the real Devnet RPC and passed through the existing parser and seven-class normalizer. Each minute completed one atomic database transaction containing:

1. 24 exact-ledger scan phases;
2. canonical normalized payload chunks;
3. committed reference rows;
4. commit chunk evidence;
5. 24 finalize phases;
6. deterministic successor reservations;
7. exact isolated watermark advancement.

The session checks passed:

- target advance exact;
- completed tick count parity;
- committed work count parity;
- every completed phase attempt count equal to `1`;
- active source watermark non-regression;
- active source epoch and base identity preserved.

## Active isolation

The active source was ledger `4,132,621` when the isolated session was prepared. The active profile advanced independently to ledger `4,132,623` during the six-minute window. The isolated target advanced to ledger `4,132,765` without writing that target state into the active profile.

The active profile remained read-only to the qualification path, its epoch remained `supabase-r4c2c-v1`, and its base identity was preserved.

## G7 decision

Steady result:

- minute rates: `[24, 24, 24, 24, 24, 24]`;
- minimum: `24/min`;
- p50: `24/min`;
- p95: `24/min`;
- maximum: `24/min`;
- threshold: greater than `21/min`;
- steady component: **passed**.

Bound retained catch-up result:

- workflow run: `30755497115`;
- artifact: `8835798472`;
- artifact digest: `sha256:05ab7a8199a13fb5577bd8d1d1f135363974c73501661409c9daa0eb516f2c07`;
- p95: `14,178.400673920027/min`;
- threshold: greater than `30/min`;
- catch-up component: **passed**.

**G7 throughput: qualified.**

## Remaining boundary

G8 remains incomplete because the retained evidence still does not cover every provider resource and no-charge surface, including:

- Edge CPU consumption;
- Edge memory consumption;
- sustained Function invocation counts;
- bandwidth and egress;
- sustained storage growth under the new 24-ledger batches;
- provider quota counters;
- billing and automatic-overage behavior;
- fail-closed stopping before every applicable provider ceiling.

The Supabase profile remains conditional and unselected. R5, Mainnet, public-reader cutover, stabilization, and soak remain forbidden.

Machine-readable evidence: [`r4c2d-supabase-network-steady-throughput-evidence-2026-08-03.json`](r4c2d-supabase-network-steady-throughput-evidence-2026-08-03.json).
