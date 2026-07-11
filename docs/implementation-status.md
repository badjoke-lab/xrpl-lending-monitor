# Implementation status

Last updated: 2026-07-11 18:00 JST.

## Current phase

XRPL Lending Monitor is publicly operating on XRPL Devnet and is in its first bounded 24-hour production soak.

Public-release acceptance followed passing production API, shared-cron/runtime, exact-ledger, cron-free canary, and real Chromium browser gates. Mainnet remains disabled.

The active operational unit is:

> Public Devnet operation from 2026-07-11 18:00 JST, with soak through 2026-07-12 18:00 JST and final reconciliation at approximately 18:17 JST.

This status supersedes earlier T5-2 and M5-5 blocked entries.

## Production runtime

Production has exactly one Worker schedule:

```text
*/5 * * * *
```

- every invocation runs the five-minute fast lane;
- UTC four-hour boundaries also run the protected canonical heavy cycle;
- no second production cron exists;
- Mainnet remains disabled.

The canonical collector role is `canonical_overlay_refresh`, with a four-hour expected interval and five-hour stale threshold. `behind` is expected between protected boundaries. Public freshness is determined by the fast lane.

## Current-state read path

Public current state resolves through:

```text
verified base snapshot
  -> canonical overlay
  -> five-minute fast lane
```

Rules:

1. compare `(source_ledger_index, source_transaction_index)` lexicographically;
2. require fast-lane base binding to match the active canonical base;
3. allow only newer rows to supersede older layers;
4. preserve deletion tombstones;
5. fail closed on identity, binding, cursor, manifest, or relationship errors;
6. use semantic projections for collections;
7. keep raw enrichment bounded to detail paths.

Vault, Loan Broker, and Loan collections use batched and deduplicated relationship resolution.

## Pagination

The public cursor is opaque and fail closed.

Production includes nested cursor compaction, previous-format compatibility, first-page Loan evaluation-time pinning, duplicate-free ordered page boundaries, and rejection when binding, filters, query scope, or sort change.

Two-page production checks passed for Vaults, Loan Brokers, and Loans at `limit=25`.

## History and exact lookup

Verified hybrid history serves immutable release history plus post-boundary D1 continuation.

Production browser discovery found and fixed three sparse-history/current-search defects:

- PR #399: filtered Lifecycle Explorer uses exact Loan references;
- PR #401: Archived Object detail uses exact archive references;
- PR #403: 64-character object-ID Search uses bounded three-layer detail lookup.

No scan, Worker, or D1 limit was increased to hide these failures.

## Accepted production evidence

The cron-free canary passed with zero canary schedules, one production `*/5` schedule, exact-ledger verification, zero candidate failures, 30 witnesses, collection smoke, pagination, and cleanup. The durable gate was merged in PR #386.

The production-only audit passed with six consecutive runs at approximately 300-second intervals, lag `0`, exact projection mismatches `0`, matching Overview/D1 watermarks, matching base binding, and passing first/second pages and details. The audit and cadence fixes were merged in PRs #395-#397.

The final browser exit was merged in PR #398. Retained evidence at `2026-07-11T08:37:52Z` recorded:

- routes: `15 / 15`;
- behaviors: `8 / 8`;
- technical findings: `0`;
- current-state source: `fast_lane`;
- cursor/head: `3565204 / 3565204`;
- public lag: `0`;
- consecutive failures: `0`;
- D1 rows read: `2,280,454 / 5,000,000` (`45.60908%`);
- D1 rows written: `15,830 / 100,000` (`15.83%`);
- browser API requests: `60`;
- failed exit checks: `0`.

The browser matrix covered Overview, all current lists/details, Activity, transaction detail, Lifecycle, Archive list/detail, Cover & Loss, Search, and Network Status. It failed closed on rendered state errors, console/page errors, HTTP 5xx, missing routes or behaviors, and excessive D1 usage.

## Public-release decision

Public Devnet operation is accepted as of 2026-07-11 18:00 JST.

The site may remain public. The fast lane is the accepted freshness source, the four-hour canonical cycle remains the reconciliation source, no rollback is required, and Mainnet remains out of scope.

## Active 24-hour soak

The soak window is:

```text
start: 2026-07-11 18:00 JST
end: 2026-07-12 18:00 JST
final audit: approximately 2026-07-12 18:17 JST
```

A temporary dated GitHub Actions schedule runs a read-only production audit about every two hours.

Each audit verifies:

- exactly one production `*/5 * * * *` schedule;
- current fast-lane state and base binding;
- six recent run intervals and statuses;
- cumulative health since public-release start;
- elapsed-time-adjusted minimum run count;
- failure count, maximum lag, and maximum run gap;
- Overview and counts watermarks;
- fast-lane differential health;
- Vault/Broker/Loan pagination and detail consistency;
- collector and history-source status.

The metrics table does not contain a full pre-release 24 hours. Therefore the soak gate measures from `2026-07-11T09:00:00Z` and calculates the minimum expected run count from elapsed time at five-minute cadence, with a two-run timing margin.

Requirements:

- observed runs at least the elapsed-time minimum;
- failure count `0`;
- maximum lag `<= 10` ledgers;
- maximum gap `<= 420` seconds;
- exact projection mismatches `0`;
- no additional production cron;
- no pagination or detail failure.

The first diagnostic capture found 62 stored runs since `2026-07-11T04:00:51Z`, failure count `0`, maximum lag `0`, maximum gap `305` seconds, and a healthy caught-up fast lane. This proved the original fixed 200-run assumption was invalid for retention length, not that production was unhealthy.

## Soak exit criteria

The soak passes only if every retained audit is green, elapsed run counts are met, no run enters error, lag stays within 10, gaps stay within 420 seconds, D1 remains within headroom, watermarks remain ordered, mismatches remain zero, deleted objects do not reappear, pagination remains consistent, and Lifecycle/Archive/Search/relationship routes remain free of HTTP 5xx.

A failure does not authorize weakening a gate. Diagnose, isolate, fix, re-run, and retain evidence.

## Remaining exclusions

- Mainnet enablement and guarantees;
- completion and reconciliation of the 24-hour soak;
- removal of the temporary dated soak schedule;
- separate human visual review;
- final-host SEO and later release hardening;
- Observatory O1-O3;
- throughput experiments that weaken Worker or D1 margins.

## Next order

1. Complete and reconcile the soak.
2. Remove temporary dated schedules.
3. Record final soak evidence and conclusion.
4. Run separate human visual review.
5. Continue post-release hardening without changing the one-cron architecture.
6. Keep Mainnet disabled until separately approved.
