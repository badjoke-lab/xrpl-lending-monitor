# Catch-up runtime monitoring

Last updated: 2026-07-05.

## Purpose

The catch-up runtime monitor is the permanent operational check for the active Devnet continuation phase. It is read-only: it does not deploy, mutate D1, submit XRPL transactions, or alter collector configuration.

The monitor runs every 30 minutes and can also be started manually. Each scheduled run samples collector state three times over ten minutes. Pull-request validation uses the same logic with shorter one-minute intervals between samples.

## Evidence captured

Each run records:

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
- HYB-7 continuation-verification path states;
- M1 exit gate states;
- guarded catch-up initialization/replay state.

The run uploads a `catch-up-runtime-monitor` artifact with raw JSON, the three-sample series, and a compact summary. Evidence is retained for 14 days.

## Automatic failure conditions

The workflow fails when either condition is observed:

1. any sampled collector state has a non-null error or a positive consecutive-failure count;
2. catch-up lag is still positive but the committed cursor does not advance across the sample window.

A positive lag delta by itself is recorded but does not fail the workflow. Devnet head production can temporarily outrun the collector over a short sample window. Operational tuning decisions use repeated lag-slope evidence rather than a single short interval.

## Interpretation

### Healthy catch-up

Expected pattern while HYB-6 is active:

- collector cursor increases;
- consecutive failures remain zero;
- error remains null;
- lag trends downward over repeated runs;
- ledger continuity and cursor/overlay agreement remain `observed`;
- additional HYB-7 paths move from `missing` to `observed` as evidence enters the collected range.

### Stalled catch-up

A monitor failure with no cursor advance while lag remains positive means the collector requires immediate inspection. Check the raw collector error, run usage, current cursor, and the first unprocessed ledger before changing any resource limit.

### Resource-pressure regression

If the collector reports a subrequest, row, statement, overlay, transaction, or single-ledger budget failure, inspect the exact live ledger evidence and adjust only the relevant bound or implementation path. Do not raise all limits together.

### Head reached

When lag reaches zero, inspect:

1. `freshness` in continuation verification;
2. all remaining HYB-7 path states;
3. `validatedHeadReached` and `liveContinuation` in M1 exit review.

Head arrival alone does not complete M1. Remaining missing or inconsistent live paths must be resolved with canonical validated-ledger evidence.

## Operator order after head arrival

1. Re-run and archive continuation-verification evidence.
2. Separate naturally observed paths from still-missing paths.
3. Investigate any inconsistent activity/lifecycle/balance path before generating additional evidence.
4. For genuinely missing paths, prepare bounded Devnet-only evidence generation for the minimum required transaction sequence.
5. Confirm transaction, activity, lifecycle, balance-history, current projection, archive/tombstone where applicable, continuity, and freshness agreement.
6. Run M1 exit review and close M1 only when every required gate is observed.
7. Proceed to M5-5 cross-audit real-data integration, then M6 hardening and multi-day Devnet soak.
