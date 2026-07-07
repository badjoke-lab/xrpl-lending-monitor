# Catch-up runtime monitoring

Last updated: 2026-07-07.

## Purpose

The catch-up runtime monitor is the permanent read-only operational check for the post-cutover Devnet continuation phase. It does not deploy, mutate D1, submit XRPL transactions, or alter collector configuration.

The monitor runs every 30 minutes and can also be started manually. Each scheduled run samples collector state three times over ten minutes. Pull-request validation uses the same logic with shorter one-minute intervals between samples.

The monitor now validates the complete post-cutover source layout:

- canonical immutable history through ledger `3432924`;
- replacement current-state snapshot `devnet-3432924-canonical`;
- replacement-base rebase replay/no-op state;
- D1 live continuation after ledger `3432924`;
- boundary-aware HYB-7 evidence;
- M1 exit gates.

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
- replacement-base target identity and replay status;
- hybrid history mode, canonical end ledger, segment count, and exact-index record count;
- active current-state overview evidence for the replacement snapshot;
- HYB-7 aggregate source evidence counts;
- HYB-7 continuation-verification path states derived from the same evidence snapshot;
- HYB-7 linkage-gap diagnostics;
- M1 expected/bound base evidence and exit gate states.

The HYB-7 diagnostic snapshot is boundary-aware. It evaluates processed-ledger continuity, object changes, current-overlay projections, protocol activity, lifecycle derivation, managed transitions, archives, balance source changes, and balance-history rows only after the active replacement base boundary.

The run uploads a `catch-up-runtime-monitor` artifact with raw JSON, the three-sample collector series, collector summary, compact HYB-7 diagnostic summary, compact M1 summary, and cutover-source summary. Evidence is retained for 14 days.

## Automatic failure conditions

The workflow fails when any of these conditions is observed:

1. any sampled collector state has a non-null error or a positive consecutive-failure count;
2. catch-up lag is still positive but the committed cursor does not advance across the sample window;
3. replacement-base status is not `replayed`;
4. hybrid history is not configured and healthy through canonical end ledger `3432924`;
5. the public overview no longer exposes the replacement snapshot identity.

A positive lag delta by itself is recorded but does not fail the workflow. Devnet head production can temporarily outrun the collector over a short sample window. Operational tuning decisions use repeated lag-slope evidence rather than a single short interval.

HYB-7 `missing` states are recorded but do not automatically fail the catch-up monitor. After the replacement boundary, a missing path may simply mean that the required live protocol event has not naturally occurred yet. `inconsistent` states require investigation from the raw boundary-scoped evidence counts.

## Interpretation

### Healthy post-cutover catch-up

Expected pattern while the collector is still behind:

- replacement rebase remains `replayed`;
- hybrid history remains healthy and pinned through ledger `3432924`;
- current-state overview remains bound to `devnet-3432924-canonical`;
- collector cursor increases;
- consecutive failures remain zero;
- error remains null;
- lag trends downward over repeated runs;
- ledger continuity and cursor/overlay agreement remain `observed`;
- additional HYB-7 source counts increase only as real events enter the post-boundary processed range;
- additional HYB-7 paths move from `missing` to `observed` when matching source and projection evidence exists.

### HYB-7 diagnostic classification

Use the aggregate evidence and path report together.

- source count `0` and projection/lifecycle count `0`: genuinely not yet observed after the replacement boundary;
- source count `>0` but matching projection/lifecycle count `0`: investigate derivation or projection mismatch;
- source count `0` but derived evidence `>0`: investigate provenance inconsistency;
- both sides `>0` with the path `observed`: live continuation evidence is present;
- activity/lifecycle/balance remains `inconsistent` while one layer is zero: identify the missing derivation layer before generating any additional Devnet evidence.

Do not generate synthetic evidence merely to turn a path green before confirming whether the source transaction already exists in the post-boundary processed range.

### Stalled catch-up

A monitor failure with no cursor advance while lag remains positive means the collector requires immediate inspection. Check the raw collector error, run usage, current cursor, the first unprocessed ledger, and replacement-base replay state before changing any resource limit.

### Resource-pressure regression

If the collector reports a subrequest, row, statement, overlay, transaction, or single-ledger budget failure, inspect the exact live ledger evidence and adjust only the relevant bound or implementation path. The active 2048 statement / 2048 row / 128 overlay-mutation values are ceilings and must be evaluated against actual write usage, not assumed maximum writes.

### Source-layout regression

If replacement rebase stops reporting `replayed`, hybrid history becomes unavailable, or the current-state replacement snapshot disappears from overview, treat that as a cutover integrity regression. Do not compensate by resetting D1 or republishing data before checking target identity, branch/channel pointers, and D1 overlay binding.

### Head reached

When lag reaches zero, inspect:

1. `freshness` in continuation verification;
2. all remaining HYB-7 path states;
3. the corresponding boundary-scoped diagnostic source and projection counts;
4. `validatedHeadReached` and `liveContinuation` in M1 exit review;
5. replacement-base replay and source-layout invariants one final time.

Head arrival alone does not complete M1. Remaining missing or inconsistent live paths must be resolved with canonical validated-ledger evidence.

## Operator order after head arrival

1. Re-run and archive the permanent runtime monitor artifact.
2. Confirm replacement rebase, hybrid history, and replacement current-state snapshot invariants.
3. Separate naturally observed HYB-7 paths from still-missing paths using boundary-scoped source and projection counts.
4. Investigate any inconsistent current projection or activity/lifecycle/balance path before generating additional evidence.
5. For genuinely missing paths, prepare bounded Devnet-only evidence generation for the minimum required transaction sequence.
6. Confirm transaction, activity, lifecycle, balance-history, current projection, archive/tombstone where applicable, continuity, and freshness agreement.
7. Run M1 exit review and close M1 only when every required gate is observed.
8. Proceed to M5-5 cross-audit real-data integration, then M6 hardening and multi-day Devnet soak.
