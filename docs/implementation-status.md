# Implementation status

Last updated: 2026-07-11, after the live XRPL Devnet source audit.

## Current phase

XRPL Lending Monitor remains publicly reachable on XRPL Devnet, but public-release acceptance is withdrawn.

The project is now in:

> Current-state continuity recovery and immutable-history rolling catch-up.

Mainnet remains disabled.

The previous statement that the first 24-hour production soak was active and healthy is superseded by the live-source audit described below.

## Confirmed live-source audit result

At approximately `2026-07-11T12:27Z`, the public API was compared in one run with both configured XRPL Devnet RPC sources and with direct ledger, ledger-entry, and transaction lookups.

Source heads:

- Honeycluster: ledger `3,569,175`;
- Ripple Devnet: ledger `3,569,176`;
- source spread: `1` ledger.

### Five-minute current-state layer

At the audit instant:

- public fast-lane watermark: ledger `3,569,165`;
- live XRPL source head: ledger `3,569,176`;
- lag: `11` ledgers;
- watermark age: `41` seconds;
- watermark ledger hash: exact match with XRPL;
- sampled objects: three Vaults, three Loan Brokers, and three Loans;
- all nine sampled objects existed in the live validated ledger and matched substantively.

Therefore the current-state list/detail path was fresh at the audit instant.

However, continuity failed during the preceding period:

- previous run: `2026-07-11T11:20:55Z`;
- next run: `2026-07-11T12:10:57Z`;
- observed gap: `3,002` seconds, approximately 50 minutes;
- recovery run status: `reanchored`;
- lag after recovery: `0`.

The five-minute continuity requirement was not met. The existing `Healthy` presentation did not disclose this gap and is not an acceptable public freshness signal.

### Overview counts and indexed history

At the same audit instant:

- counts/canonical coverage ledger: `3,540,803`;
- live source head: `3,569,176`;
- lag: `28,373` ledgers;
- coverage close time: `2026-07-10T09:36:21Z`;
- coverage age: approximately `26.84` hours;
- stored coverage hash: valid for ledger `3,540,803`.

The data was internally valid but stale for the declared four-hour cadence.

Affected public values and APIs include:

- Overview Vault, Loan Broker, Loan, and Current Objects counts;
- Activity and activity exports/feeds;
- transaction detail for post-coverage transactions;
- object history;
- Loan lifecycle and Lifecycle Explorer;
- archived objects;
- Cover, Debt, and Loss history;
- history-side Search results.

The stale Activity result was not caused by a quiet Devnet. Recent fast-lane runs observed substantial Lending transaction counts after the indexed-history boundary.

## Root cause

The protected canonical heavy cycle was introduced as a D1 headroom protection measure, not as a complete catch-up mechanism.

Production currently has one schedule:

```text
*/5 * * * *
```

Inside that schedule:

- every tick attempts the compact fast lane;
- UTC four-hour boundaries additionally attempt the protected heavy cycle.

The protected heavy configuration is bounded to at most `32` ledgers per run. Running this once every four hours cannot keep pace with Devnet ledger production. It is suitable only as a protected reconciliation tail, not as the mechanism for closing a large history backlog.

The intended large-backlog path already exists separately:

- fixed-target immutable history extension;
- incremental exact-index construction;
- rolling current-state reconstruction;
- candidate history/current-state branch publication;
- remote candidate rehearsal;
- guarded production promotion and base rebind.

The rolling candidate workflow is merged. The reusable preflight and guarded promotion work remained unmerged/outdated, so the rolling path was never completed as normal production operation.

Existing aligned rolling candidate branches currently cover ledger `3,540,657` for both immutable history and current state.

## Recovery plan

### R1 — Preserve service but withdraw the success claim

- keep the public Devnet endpoint reachable;
- do not call it normally operating or release-complete;
- keep Mainnet disabled;
- retain the five-minute fast lane because it is currently useful and can recover by reanchor;
- treat the failed soak and live-source audit as the active evidence baseline.

### R2 — Catch immutable history and current state up outside D1

Use the merged rolling checkpoint candidate pipeline from the aligned candidate pair at ledger `3,540,657`.

- advance in bounded steps of at most `5,000` ledgers;
- generate immutable history, exact index, and current state together;
- verify ledger index/hash equality for every candidate pair;
- alternate isolated candidate branches between cycles;
- continue until the final candidate is within the accepted freshness window of the live Devnet head.

The initial measured gap requires approximately six bounded cycles, plus another cycle if Devnet advancement during generation requires it.

### R3 — Restore reusable preflight and guarded promotion

Port the useful parts of PRs `#356` and `#357` onto current `main` instead of merging their stale heads directly.

The restored gates must additionally require:

- candidate history/current state ledger and hash identity match;
- candidate source rehearsal passes;
- candidate coverage age is within the declared history freshness window;
- current-state and history candidates are promoted as one logical checkpoint;
- D1 write headroom remains fail-closed;
- the fast-lane base binding is updated to the promoted checkpoint;
- rollback refs are pinned before any production write;
- no Mainnet mutation is possible.

### R4 — Promote one aligned checkpoint

After the final candidate and preflight pass:

1. promote immutable history;
2. confirm the public hybrid history source reads the promoted publication;
3. rebind/rebase the compact current-state tail to the same target ledger/hash;
4. promote the matching current-state branch;
5. deploy the reconciled Worker configuration;
6. verify all public API classes against live XRPL source data.

The 28,000-ledger backlog must not be replayed into D1 row-by-row. Immutable history and rebuilt current state are the backlog recovery path; D1 remains the bounded post-checkpoint tail.

### R5 — Fix continuity and public freshness reporting

Independently investigate the 3,002-second fast-lane gap.

Public status must be split into at least:

- current-state ledger, age, lag, and last successful five-minute run;
- immutable/indexed-history coverage ledger and age;
- separate current-state and history verdicts.

A missing fast-lane metric for more than ten minutes must show `Degraded` or `Stale`, never `Healthy`.

### R6 — Restart release qualification

The previous soak is failed and cannot be resumed.

After recovery, start a new 24-hour soak from zero.

Required exit conditions:

- no fast-lane run gap above `420` seconds;
- current-state age within ten minutes and source lag within the accepted ledger bound;
- immutable/indexed-history coverage age within five hours;
- exact ledger hashes match XRPL source data;
- sampled Vault, Loan Broker, and Loan objects match live ledger entries;
- Overview counts identify their own coverage watermark;
- Activity/Lifecycle/Archive/Cover-Loss coverage is proven, not inferred from HTTP success;
- no projection mismatch, cursor gap, tombstone regression, pagination failure, or HTTP 5xx;
- D1 remains within free-plan headroom;
- Mainnet remains disabled.

## Formal decision

Current formal state:

> Publicly reachable Devnet recovery build; current-state layer recovered at the latest audit instant, five-minute continuity not yet proven, immutable history and counts stale, release acceptance withdrawn.

No public-release completion claim is permitted until R2-R6 pass.
