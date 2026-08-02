# R4C2d Supabase isolated catch-up throughput evidence — 2026-08-03

## Result

The isolated full-phase catch-up component passed its fixed `>30 committed ledgers/minute` threshold.

It does **not** close G7. The retained normal steady baseline remains p95 `1 committed ledger/minute`, below the required value above `21`. G7 therefore remains failed and the Supabase profile remains conditional and unselected.

## Source

- workflow run: `30755497115`
- main commit: `3b2510d87b639b778c1e9e243a3baedd28ce30f3`
- artifact: `8835798472`
- artifact digest: `sha256:05ab7a8199a13fb5577bd8d1d1f135363974c73501661409c9daa0eb516f2c07`
- verified: `2026-08-02T15:58:04.320Z` / `2026-08-03 00:58:04 JST`
- verifier run: `r4c2d-msbzi7yo-383429d0`
- source profile: `supabase-devnet`
- isolated target profile: `supabase-devnet-catchup-qualification`
- isolated schema: `xrpl_catchup_v1`
- network: `devnet`

## Source window

Every trial used the same 64 contiguous, already committed real Devnet works:

- start ledger: `4,132,545`;
- end ledger: `4,132,608`;
- end hash: `7C27A4ACA337E1CF9CF7CEDAB804A7661102295FC03F10834228D63839743FC5`;
- committed rows: `64`;
- committed-row digest: `bdb286f0af2d0ca40ed1e50d21b6470088e2c6b3fffbe99daaee5a690421607d`.

The active profile was a read-only source. Its watermark was ledger `4,132,608` before and after the five trials.

## Full-phase contract

Each trial executed all 64 works through isolated scheduler state:

1. `scan` claim and completion;
2. exact payload-chunk copy;
3. `commit` claim and completion;
4. exact committed-row and commit-chunk copy;
5. `finalize` claim and completion;
6. isolated watermark advance;
7. next-scan reservation.

Required state per trial:

- committed works: `64`;
- total messages: `193`;
- completed messages: `192`;
- pending next-scan messages: `1`;
- successor reservations: `192`;
- attempt count for every completed phase: `1`;
- source rows: `64`;
- target rows: `64`;
- source/target row digest parity: passed;
- target watermark parity: passed.

Across five trials this produced `320` committed works, `960` completed phases, and `960` successor reservations.

## Measurements

Throughput uses the slower of PostgreSQL execution time and the complete Edge-to-PostgREST request wall time.

| Trial | DB elapsed | Edge wall | Effective rate |
| --- | ---: | ---: | ---: |
| 1 | 97.814 ms | 305.644 ms | 12,563.651 ledgers/min |
| 2 | 77.753 ms | 274.511 ms | 13,988.531 ledgers/min |
| 3 | 78.724 ms | 277.424 ms | 13,841.630 ledgers/min |
| 4 | 78.556 ms | 274.773 ms | 13,975.163 ledgers/min |
| 5 | 78.367 ms | 269.931 ms | 14,225.868 ledgers/min |

Summary:

- minimum: `12,563.651375831556` ledgers/min;
- p50: `13,975.162925561042` ledgers/min;
- p95: `14,178.400673920027` ledgers/min;
- maximum: `14,225.868101463015` ledgers/min;
- DB elapsed p50/p95: `78.556 / 93.996` ms;
- Edge wall p50/p95: `274.773183 / 299.999696` ms.

The isolated catch-up component therefore exceeds the required value above `30/min` by a large margin.

## Interpretation boundary

This is a deliberately batched, isolated catch-up executor benchmark. It proves that the PostgreSQL phase-state mutations, exact row copying, successor reservations, and watermark progression can be completed above the catch-up threshold when removed from the normal one-phase-per-cron cadence.

It does not prove that the current normal collector has adequate steady throughput. The retained 60-minute, six-hour, and 24-hour normal baseline remains p95 `1/min`, with complete work latency around two minutes. Therefore:

- catch-up component: **passed**;
- steady component: **failed**;
- G7 overall: **failed / unqualified**;
- G8: **still incomplete**;
- profile selection: **not selected**.

A future steady executor must apply safe batching or multiple phase advances per tick without weakening transactional, lease, duplicate, cursor, or fail-closed guarantees. The resulting steady profile must then be remeasured in retained p95 windows.

## Safety and isolation

- missing-token request rejected;
- wrong-purpose request rejected;
- active source profile unchanged;
- Mainnet disabled;
- no public-reader cutover;
- no profile selection;
- no R5 recovery;
- no stabilization or soak.

Machine-readable evidence: [`r4c2d-supabase-isolated-catchup-throughput-evidence-2026-08-03.json`](r4c2d-supabase-isolated-catchup-throughput-evidence-2026-08-03.json).
