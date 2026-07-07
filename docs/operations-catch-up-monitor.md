# Catch-up runtime monitoring

Last updated: 2026-07-07.

## Purpose

The runtime monitor is the permanent read-only operational check for the post-cutover Devnet continuation phase. It does not deploy, mutate D1, submit XRPL transactions, or alter collector configuration.

Monitoring is deliberately split into two cadences so operational visibility does not consume the D1 read budget needed by the live collector and public API.

- lightweight monitoring runs every 30 minutes;
- deep HYB-7 and M1 diagnostics run every 6 hours;
- manual dispatch runs both jobs;
- pull-request validation runs only the lightweight job against production.

This split was introduced after D1 Analytics showed that the original full diagnostic monitor was responsible for avoidable read amplification. The dominant overlay/object-change match query was separately optimized to use the existing object-history index, but the expensive evidence scans remain intentionally low-frequency.

## Lightweight monitoring

The 30-minute job records:

- collector status;
- committed cursor ledger;
- latest observed validated ledger;
- lag in ledgers;
- last run duration;
- ledgers processed by the last collector run;
- RPC request count;
- estimated row and statement usage;
- overlay mutation count;
- consecutive failures and the current collector error;
- replacement-base rebase replay state;
- hybrid history source state;
- canonical history end ledger, segment count, and exact-index record count;
- active replacement current-state snapshot evidence from `/api/overview`;
- actual daily D1 rows read, rows written, and query counts from Cloudflare Analytics.

Each lightweight scheduled run samples the collector three times over ten minutes. Pull-request validation uses one-minute intervals between samples.

The job fails when:

1. any collector sample has a non-null error or positive consecutive-failure count;
2. lag is positive but the cursor does not advance across the sample window;
3. replacement-base status is not `replayed`;
4. hybrid history is unavailable or does not end at canonical ledger `3432924`;
5. the replacement current-state snapshot identity disappears from the public overview.

D1 daily usage at or above 80% of the configured Free-plan allowance is emitted as a workflow warning. Usage alone does not fail the monitor because the active account plan and UTC-day reset boundary must be considered before changing production behavior.

The lightweight job uploads `catch-up-runtime-monitor-lightweight` for 14 days.

## Deep diagnostics

The deep job runs every 6 hours and captures:

- boundary-aware HYB-7 continuation diagnostics;
- processed-ledger range and discontinuity count;
- created, modified, and deleted object-change counts;
- overlay upsert/tombstone and source-match counts;
- LoanPay and LoanManage activity counts;
- impairment, unimpairment, and default source-transition counts;
- lifecycle derivation counts;
- archive/tombstone agreement;
- balance-source and balance-history counts;
- linkage gaps between protocol activity, lifecycle rows, and balance rows;
- M1 expected and bound replacement-base evidence;
- M1 exit gate states;
- replacement-base replay state;
- hybrid history source state.

The deep job allows `missing` HYB-7 paths and M1 gates while the collector is still behind or while the required live protocol event has not naturally occurred. It fails when a path or gate is `inconsistent`, or when cutover source invariants regress.

The deep job uploads `catch-up-runtime-monitor-deep` for 30 days.

## D1 read-budget policy

Operational diagnostics must not compete with live continuation for D1 reads.

The permanent policy is:

1. never run full HYB-7 and M1 diagnostics every minute or every collector cron;
2. keep the 30-minute job limited to point reads and small status payloads;
3. run full evidence scans at the 6-hour cadence unless an operator is actively investigating a regression;
4. inspect actual D1 Analytics usage rather than inferring billing usage from collector row estimates;
5. measure query-level `rows read` before increasing diagnostic cadence;
6. prefer existing indexed lookup paths before adding new indexes or migrations;
7. keep the diagnostic schedule paused if a newly introduced query causes read amplification.

The first post-cutover query investigation found that the overlay/object-change match query lacked the canonical object-type predicate needed to use the existing `(network, epoch_id, object_type, object_id, ledger_index, ...)` object-history index. After adding the type mapping, the old query disappeared from the recent top-read list. The remaining heaviest deep query is the processed-ledger continuity scan, so deep diagnostics remain intentionally low-frequency even after the hot-query fix.

## Interpretation

### Healthy continuation

Expected pattern while the collector remains behind:

- replacement rebase remains `replayed`;
- hybrid history remains healthy through ledger `3432924`;
- current-state remains bound to `devnet-3432924-canonical`;
- collector cursor increases;
- consecutive failures remain zero;
- error remains null;
- lag trends downward over repeated runs;
- ledger continuity and cursor/overlay agreement remain `observed`;
- additional HYB-7 paths move from `missing` to `observed` only when matching post-boundary source and projection evidence exists.

### HYB-7 diagnostic classification

Use the aggregate evidence and path report together.

- source count `0` and projection/lifecycle count `0`: genuinely not yet observed after the replacement boundary;
- source count `>0` but matching projection/lifecycle count `0`: investigate derivation or projection mismatch;
- source count `0` but derived evidence `>0`: investigate provenance inconsistency;
- both sides `>0` with the path `observed`: live continuation evidence is present;
- activity/lifecycle/balance remains `inconsistent` while one layer is zero: identify the missing derivation layer before generating any additional Devnet evidence.

Do not generate synthetic evidence merely to turn a path green before confirming whether the source transaction already exists in the post-boundary processed range.

### Stalled continuation

A lightweight monitor failure with no cursor advance while lag remains positive means the collector requires immediate inspection. Check the raw collector error, run usage, current cursor, replacement-base replay state, and the first unprocessed ledger before changing any resource limit.

### Resource-pressure regression

If the collector reports a subrequest, row, statement, overlay, transaction, or single-ledger budget failure, inspect the exact live ledger evidence and adjust only the relevant bound or implementation path. The active statement, row, and overlay-mutation settings are ceilings, not expected writes.

If D1 actual usage approaches the daily allowance, first inspect whether the growth comes from collector writes, public reads, lightweight monitoring, or deep diagnostic scans. Do not raise collector budgets to solve a diagnostic-query problem.

### Source-layout regression

If replacement rebase stops reporting `replayed`, hybrid history becomes unavailable, or the current-state replacement snapshot disappears from overview, treat that as a cutover integrity regression. Do not reset D1 or republish data before checking target identity, branch/channel pointers, and overlay binding.

### Head reached

When lag reaches zero:

1. inspect `freshness` in deep continuation diagnostics;
2. inspect all remaining HYB-7 path states;
3. inspect the corresponding boundary-scoped source and projection counts;
4. inspect `validatedHeadReached` and `liveContinuation` in M1 exit review;
5. confirm replacement-base replay and source-layout invariants one final time.

Head arrival alone does not complete M1. Remaining missing or inconsistent live paths must be resolved with canonical validated-ledger evidence.

## Operator order after head arrival

1. Run manual dispatch so both lightweight and deep jobs execute.
2. Archive both monitor artifacts.
3. Confirm replacement rebase, hybrid history, and replacement current-state snapshot invariants.
4. Separate naturally observed HYB-7 paths from still-missing paths using boundary-scoped source and projection counts.
5. Investigate any inconsistent current projection or activity/lifecycle/balance path before generating additional evidence.
6. For genuinely missing paths, prepare bounded Devnet-only evidence generation for the minimum required transaction sequence.
7. Confirm transaction, activity, lifecycle, balance-history, current projection, archive/tombstone where applicable, continuity, and freshness agreement.
8. Run M1 exit review and close M1 only when every required gate is observed.
9. Proceed to M5-5 cross-audit real-data integration, then M6 hardening and multi-day Devnet soak.
