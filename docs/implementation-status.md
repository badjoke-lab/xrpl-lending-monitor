# Implementation status

Last updated: 2026-07-11 18:00 JST.

## Current phase

XRPL Lending Monitor is publicly operating on XRPL Devnet and has entered the first 24-hour production soak.

The public-release exit was accepted after the production API audit, cron/runtime audit, exact-ledger comparison, production-shaped canary, and real Chromium browser gate all passed. Mainnet remains disabled.

The active operational unit is:

> Public Devnet operation with a bounded 24-hour soak from 2026-07-11 18:00 JST through 2026-07-12 18:00 JST.

This replaces the previous T5-2 and M5-5 blocked state. Those entries are historical and must not be used as the current implementation position.

## Production runtime

Production keeps one Cloudflare Worker schedule:

```text
*/5 * * * *
```

The shared schedule behaves as follows:

- every five-minute invocation runs the fast-lane current-state cycle;
- UTC four-hour boundary invocations also run the protected canonical heavy cycle;
- no second production cron is installed;
- Mainnet collection is disabled;
- the public site remains Devnet-only.

The canonical heavy cycle is expected to report `behind` between four-hour boundaries. Public current-state freshness is determined by the five-minute fast lane, not by requiring the canonical heavy collector itself to remain at the live head.

Collector status identifies this distinction explicitly:

- role: `canonical_overlay_refresh`;
- expected interval: `14400` seconds;
- stale threshold: `18000` seconds;
- expected non-error states between boundaries: `behind` or `healthy`.

## Public current-state architecture

Public current state resolves through three layers:

```text
verified base snapshot
  -> canonical overlay
  -> five-minute fast lane
```

Resolution rules:

1. compare `(source_ledger_index, source_transaction_index)` lexicographically;
2. use a fast-lane row only when its base binding matches the active canonical base;
3. allow a newer fast-lane row to supersede canonical state;
4. preserve deletion tombstones so deleted objects cannot reappear from an older layer;
5. fail closed on manifest, identity, binding, cursor, or relationship-integrity errors;
6. use semantic projections for public collections;
7. keep exact/raw enrichment bounded to detail paths that require it.

The public routes using the three-layer reader include:

- `/api/overview`;
- `/api/vaults` and `/api/vaults/:id`;
- `/api/loan-brokers` and `/api/loan-brokers/:id`;
- `/api/loans` and `/api/loans/:id`.

Collection relationship materialization is batched and deduplicated. Loan Broker collections resolve related Vaults in one batch. Loan collections resolve related Brokers and then Vaults in two bounded batches.

## Pagination contract

The public current-state cursor is opaque and fail closed.

The production path includes:

- nested canonical/base cursor compaction below the public 1024-character limit;
- decoding compatibility for the previous compact cursor representation;
- preservation of the first-page Loan schedule evaluation time across later pages;
- duplicate-free and strictly ordered page boundaries;
- rejection when fast-lane binding, query scope, sort, or filters change during pagination.

Production-shaped tests passed two-page retrieval for Vaults, Loan Brokers, and Loans at `limit=25`.

## History and exact-index paths

Verified hybrid history remains active:

- immutable canonical history is served from verified release artifacts;
- post-boundary continuation is served from D1;
- exact-index references are used for bounded object, lifecycle, archive, transaction, and Search lookups where available;
- generic immutable scans remain bounded and fail closed.

Production browser discovery exposed three sparse-history/current-search defects. They were fixed before public-release acceptance:

- PR #399: filtered Lifecycle Explorer now uses exact Loan lifecycle references;
- PR #401: Archived Object detail now uses exact archive references;
- PR #403: 64-character object-ID Search now uses bounded three-layer detail lookup instead of scanning account collections.

No immutable scan limit, Worker subrequest limit, or D1 resource limit was increased to hide these failures.

## Production-shaped canary evidence

The cron-free three-layer canary passed before browser exit reconciliation.

Verified conditions included:

- canary schedule count: `0`;
- production schedule count: `1` with `*/5 * * * *`;
- exact-ledger re-verification passed;
- fast-lane differential verification passed;
- candidate failure count: `0`;
- 30 current-state witnesses verified;
- production and candidate were fully converged for all sampled witnesses;
- Vault, Loan Broker, and Loan collection smoke passed;
- two-page Loan pagination passed after cursor and evaluation-time fixes;
- temporary canary Worker cleanup passed.

The durable gate was merged in PR #386.

## Production runtime audit evidence

The production-only read audit passed before browser exit reconciliation.

The retained audit recorded:

- six consecutive fast-lane runs;
- interval range: approximately `299.975` to `300.023` seconds;
- processed runs: `6 / 6`;
- maximum sampled lag: `0` ledgers;
- fast-lane differential sample: `500` rows;
- exact projection mismatches: `0`;
- production schedule: exactly one shared five-minute cron;
- Overview current-state watermark matched D1 fast-lane ledger and hash;
- active base binding matched the Overview snapshot;
- Vault, Loan Broker, and Loan first/second pages passed;
- representative details matched their collection objects.

The production audit workflow was merged in PR #395. Collector cadence interpretation was corrected in PR #396 and re-verified in PR #397.

## Final production browser exit

PR #398 merged the durable production browser gate after clean-head success.

The final retained evidence at `2026-07-11T08:37:52Z` recorded:

- exact route matrix: `15 / 15` passed;
- required behavior checks: `8 / 8` passed;
- technical findings: `0`;
- public current-state source: `fast_lane`;
- current-state cursor/head: `3565204 / 3565204`;
- public current-state lag: `0`;
- consecutive failures: `0`;
- canonical refresh role: `canonical_overlay_refresh`;
- canonical refresh status: `behind`, as expected between protected boundaries;
- discovery logical API requests: `11`;
- discovery HTTP attempts: `11`;
- browser API requests: `60`;
- D1 rows read: `2,280,454 / 5,000,000` (`45.60908%`);
- D1 rows written: `15,830 / 100,000` (`15.83%`);
- exit evaluator failed checks: `0`.

The route matrix covered:

1. Overview;
2. Vaults;
3. Vault detail;
4. Loan Brokers;
5. Loan Broker detail;
6. Loans;
7. Loan detail;
8. Activity;
9. Transaction detail;
10. Lifecycle Explorer;
11. Archived Objects;
12. Archived Object detail;
13. Cover & Loss;
14. Search;
15. Network Status.

The behavior matrix covered:

1. Vault detail rendering;
2. Loan Broker -> Vault relationship link;
3. Loan -> Broker -> Vault relationship links;
4. Loan lifecycle/history rendering;
5. Lifecycle -> current Loan link;
6. archived-object context presentation;
7. Search -> current Loan link;
8. Network Status freshness presentation.

The gate also failed closed on rendered state errors, console errors, page errors, HTTP 5xx responses, missing required routes, missing required behaviors, and D1 headroom above the approved threshold.

Human visual review remains a separate presentation-quality task. It is not a hidden technical-release blocker because the automated browser route and behavior gate passed.

## Public-release decision

Public Devnet operation is accepted as of 2026-07-11 18:00 JST.

This means:

- the site may remain publicly accessible;
- the five-minute fast lane is the accepted public freshness source;
- the four-hour canonical cycle remains the protected reconciliation source;
- the production browser/API gate is retained in `main`;
- no rollback is required from the current evidence;
- Mainnet remains explicitly out of scope.

## Active 24-hour soak

The soak window is:

```text
start: 2026-07-11 18:00 JST
end:   2026-07-12 18:00 JST
```

A temporary dated GitHub Actions schedule runs the production read audit approximately every two hours during this window.

Each run verifies:

- exactly one production `*/5 * * * *` schedule;
- current fast-lane state and base binding;
- recent run intervals and run statuses;
- rolling 24-hour run count;
- rolling 24-hour failure count;
- rolling 24-hour maximum lag;
- rolling 24-hour maximum run gap;
- Overview current-state and counts watermarks;
- fast-lane differential result;
- Vault, Loan Broker, and Loan two-page pagination;
- representative detail consistency;
- collector and history-source status.

Rolling-window requirements are:

- at least `200` fast-lane run metrics in the previous 24 hours;
- failure count `0`;
- maximum lag at most `10` ledgers;
- maximum run gap at most `420` seconds;
- exact projection mismatches `0`;
- no additional production cron;
- no API pagination or detail failure.

The temporary dated schedules must be removed after soak reconciliation.

## Soak exit criteria

The 24-hour soak passes only when:

1. all retained scheduled audit runs are green;
2. no fast-lane run enters an error status;
3. no sampled lag exceeds 10 ledgers;
4. no sampled run gap exceeds 420 seconds;
5. D1 remains below approved daily headroom thresholds;
6. Overview never presents a current-state watermark behind the counts watermark;
7. exact projection mismatches remain zero;
8. no deleted object reappears from an older layer;
9. no cursor duplicate, gap, or second-page error recurs;
10. Lifecycle, Archive, Search, and relationship routes remain free of HTTP 5xx errors.

A failure does not automatically permit weakening a gate. The response order is diagnose, isolate, fix, re-run, and retain evidence.

## Remaining blockers and exclusions

The following remain outside the accepted public Devnet release:

- Mainnet enablement;
- Mainnet data guarantees;
- completion of the 24-hour soak;
- removal of the temporary soak schedule after reconciliation;
- human visual/presentation review;
- final-host SEO binding and later release hardening;
- Observatory O1-O3 work;
- any throughput experiment that weakens D1 or Worker safety margins.

## Next order

1. Complete and reconcile the 24-hour public soak.
2. Remove the temporary dated soak schedules.
3. Record the final soak artifact set and release conclusion.
4. Run the separate human visual/presentation review.
5. Begin the next approved post-release hardening unit without changing the one-cron architecture.
6. Keep Mainnet disabled until a separate Mainnet readiness decision is approved.

## Historical references

The earlier throughput, WSS windowing, D1 persistence, canonical-history, replacement-base, M1, M5-5, and M6 preparation documents remain useful historical evidence. They do not override the current public-release and soak status recorded here.
