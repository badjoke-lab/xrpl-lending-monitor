# R4C2d Supabase throughput and resource baseline evidence — 2026-08-03

## Result

The first retained R4C2d baseline completed successfully against the read-only active qualification profile `supabase-devnet`.

This baseline **does not qualify G7 or G8**. It proves the measurement path and establishes the actual current rate and resource snapshot.

## Source

- workflow run: `30754437078`, attempt `2`
- main commit: `69f8c2b0e8b1604211bd4c5270b8af14f8ec755d`
- artifact: `8835523407`
- artifact digest: `sha256:0d344035acc876125dc360534971877411d087db43d3b8d752d7b75e32cbf912`
- observed: `2026-08-02T15:32:53.253Z` / `2026-08-03 00:32:53 JST`
- verified: `2026-08-02T15:32:54.541Z`
- profile: `supabase-devnet`
- epoch: `supabase-r4c2c-v1`
- network: `devnet`

The first run attempt reached the new verifier but failed because the baseline referenced the retired probe runtime name. PR #1138 added a service-role-only read projection over `xrpl_collector_runtime`. The first attempt of run `30754437078` then encountered a transient Supabase Functions API `409 deployment already exists`; rerunning the same job completed all ten deployments and every verifier.

## Throughput

All minute buckets are represented, including minutes with zero committed work.

| Window | Committed ledgers | Productive minutes | Zero minutes | Average/min | p50/min | p95/min | Max/min |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 60 minutes | 19 | 19 | 41 | 0.316667 | 0 | 1 | 1 |
| 360 minutes | 119 | 119 | 241 | 0.330556 | 0 | 1 | 1 |
| 1,440 minutes | 208 | 208 | 1,232 | 0.144444 | 0 | 1 | 1 |

The fixed steady gate requires p95 above `21` committed ledgers/minute. The observed p95 is `1` in all three windows. The current active qualification cadence therefore fails the steady throughput gate by design and cannot be promoted as a recovery/catch-up profile.

Catch-up mode was not executed, so the `>30` committed-ledgers/minute catch-up gate remains unmeasured and failed closed.

## End-to-end work latency

| Window | Samples | p50 | p95 | Max |
| --- | ---: | ---: | ---: | ---: |
| 60 minutes | 20 | 120,089.5 ms | 120,899.35 ms | 120,906 ms |
| 360 minutes | 120 | 119,994 ms | 120,580.95 ms | 121,197 ms |
| 1,440 minutes | 209 | 119,990 ms | 120,463.4 ms | 121,197 ms |

This is complete committed-work latency, not scan-only time. The approximately two-minute work interval is consistent with the present phase scheduling sequence and explains the measured ceiling of one committed ledger in a productive minute.

## Phase attempts

Across the 24-hour window:

- scan: `211` messages, `209` completed, `1` error, p50/p95 attempts `1 / 1`;
- commit: `209` messages, all completed, no errors or retries, p50/p95 attempts `1 / 1`;
- finalize: `209` messages, all completed, no errors or retries, p50/p95 attempts `1 / 1`.

One old scan message retained a maximum attempt count of `241`; it does not change the p50/p95 result and must not be mistaken for current retry activity. Runtime consecutive failures were `0` at measurement time.

## Resource snapshot

- database size: `24,128,659` bytes;
- phase messages: `2,375,680` bytes / `629` rows;
- phase work: `1,081,344` bytes / `209` rows;
- phase successors: `917,504` bytes / `627` rows;
- payload chunks: `499,712` bytes / `209` rows;
- committed reference rows: `499,712` bytes / `209` rows;
- commit chunks: `188,416` bytes / `209` rows;
- stream and watermark tables: `32,768` bytes each.

Payload evidence:

- payload p50/p95/max: `990 / 990 / 990` bytes;
- configured payload ceiling: `512,000` bytes;
- scheduler payload p50/p95/max: `519 / 570 / 570` bytes;
- configured scheduler ceiling: `16,000` bytes.

Connection snapshot:

- active: `1`;
- idle: `7`;
- total: `9`;
- configured maximum: `60`;
- observed usage ratio: `0.15`.

These values show substantial headroom for the measured rows, payloads, and connections. They do not establish sustained Free-plan safety because growth rates, provider quota counters, Edge CPU, memory, invocation count, bandwidth, and billing/overage behavior were not measured by this unit.

## Isolation and credentials

The verifier read the active watermark before and after measurement:

- ledger before: `4,132,600`;
- ledger after: `4,132,600`;
- advance caused by verifier: `0`;
- source identity preserved: `true`.

Missing-token and wrong-purpose calls were rejected. No Mainnet, public-reader, production, R5, stabilization, or soak mutation occurred.

## Gate decision

- G7 throughput: **failed / unqualified**;
- G8 resource fail-closed: **incomplete / unqualified**;
- profile selection: **not selected**.

The next R4C2d work must not merely repeat the same normal cadence. It must add an isolated catch-up executor capable of exercising the full phase chain above the fixed thresholds, plus provider-visible or independently retained CPU, memory, invocation, bandwidth, storage-growth, quota, billing, and pre-ceiling halt evidence.

Machine-readable evidence: [`r4c2d-supabase-throughput-resource-baseline-evidence-2026-08-03.json`](r4c2d-supabase-throughput-resource-baseline-evidence-2026-08-03.json).
