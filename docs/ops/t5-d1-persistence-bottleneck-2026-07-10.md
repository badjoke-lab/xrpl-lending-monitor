# T5 D1 persistence bottleneck evidence — 2026-07-10

## Scope

This document records the first production measurements from the T5-1 persistence-batch instrumentation and the immediate D1 protection decision. It does not start M6 and does not approve a new catch-up architecture by itself.

## Measurement contract

PR #311 added measured persistence-batch fields to collector status without changing the existing guarded incremental commit boundary:

- `persistence_batch_results`;
- `persistence_statements`;
- `persistence_rows_read`;
- `persistence_rows_written`.

These values cover the existing atomic incremental persistence batch only. They do not claim to represent total scheduled-invocation D1 usage. Network-status refresh, preflight reads, collector-state save, public status reads, and diagnostics remain outside this measurement.

## Retained WSS32 production baseline

Runtime monitor run `29060806372`, retained lightweight artifact `8219138203`, captured three five-minute WSS32 window-4 samples after the measurement deployment.

| Sample | RPC reads | Ledgers committed | Lending tx | Estimated statements | Persistence rows read | Persistence rows written | Duration |
|---|---:|---:|---:|---:|---:|---:|---:|
| 0 | 32 | 9 | 26 | 484 | 887 | 2,493 | 6,856 ms |
| 1 | 32 | 10 | 29 | 498 | 906 | 2,578 | 7,368 ms |
| 2 | 32 | 9 | 24 | 445 | 816 | 2,294 | 7,122 ms |

Across the sampled window:

- cursor: `3502397 -> 3502416`;
- observed head: `3536222 -> 3536421`;
- `cursor_delta=19`;
- `head_delta=199`;
- `lag_delta=+180`;
- `samples_with_failures=0`;
- endpoint was WSS with one endpoint attempt per run;
- consecutive failures remained zero;
- error remained null.

The same artifact recorded current UTC-day D1 usage at `2026-07-10T05:37Z`:

- rows read: `3,759,947 / 5,000,000` (`75.19894%`);
- rows written: `77,113 / 100,000` (`77.113%`).

## Interpretation

The active bottleneck in the measured backlog region is no longer ledger transport. Each run successfully read 32 ledgers through one WSS connection, but the commit prefix stopped at 9, 10, and 9 ledgers because the configured estimated row/statement budgets were approached before the full scanned range could be committed.

The three measured runs wrote `7,365` D1 rows while committing `28` ledgers, or approximately `263` measured persistence rows written per committed ledger across this specific sampled region. This is an observed regional average, not a universal per-ledger constant.

The schema also has material write amplification because logical history records maintain primary and secondary indexes. For example, `object_changes` has its primary key plus object-history, transaction, and relationship indexes. Therefore one logical inserted record can contribute multiple D1 `rows_written` effects.

## Immediate protection decision

A temporary operational deployment changed the production schedule from five-minute cadence to:

```text
0 */4 * * *
```

The Cloudflare schedules API returned one active schedule with cron `0 */4 * * *` after deployment. The temporary operational PR was closed without merge after evidence capture.

The four-hour cadence is a resource-protection profile, not a catch-up profile. Its purpose is to prevent the measured dense backlog region from exhausting the remaining UTC-day D1 write allowance while T5 evaluates a different catch-up path.

## Blocked experiments

The prepared WSS64 comparison branch must not be deployed while the current-day D1 write headroom is insufficient for bounded comparison plus rollback margin.

Window-8 and 128-ledger production tests are also blocked. The measured WSS32 result shows that increasing transport or scan capacity alone cannot guarantee cursor throughput when persistence row/statement budgets and D1 write amplification are the limiting factors.

## Active next investigation

T5 next work is to evaluate two paths before any new production throughput increase:

1. reduce D1 write amplification while preserving required public query contracts, exact history behavior, cursor atomicity, overlay watermark guards, and continuity checks;
2. move backlog history generation to the existing canonical history segment pipeline outside the Worker/D1 hot path, then define a safe replacement-base and bounded live-tail continuation cutover.

The repository already has a canonical-history generation path that builds bounded segments, verifies the complete chain, builds a publication manifest, and builds the exact index outside the production Worker. The next design unit must determine whether that path can be extended from the current canonical boundary through a fixed, verified catch-up target without weakening live current-state correctness or hybrid history guarantees.

## Gates

- M5-5 remains incomplete.
- Production-shaped browser evidence remains blocked while the collector is materially behind.
- M6 has not started and remains blocked behind M5-5 exit.
- Mainnet remains disabled.
