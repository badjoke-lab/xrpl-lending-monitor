# Rolling checkpoint operations

## Purpose

Rolling checkpoints keep immutable history and current-state artifacts near the validated Devnet head without requiring the Worker collector to persist the entire backlog through D1.

The operating model is:

1. freeze a bounded validated target;
2. extend immutable history from the current source publication terminal;
3. verify segment continuity and target identity;
4. update the exact index incrementally from the source index plus delta records;
5. update current state from the compact rolling base plus delta mutations;
6. publish isolated candidate branches;
7. rehearse the remote candidate pair;
8. run a read-only production preflight;
9. only then consider a guarded production cutover.

M5-5 remains incomplete until production-shaped browser evidence passes. M6 must not start before M5-5 is formally complete.

## Proven path

The following Devnet sequence has been proven:

- T1 production base: ledger `3539657`;
- T1 to T2: 2,000-ledger bounded delta to `3541657`;
- T2 current-state output includes a 64-segment compact rolling base;
- T2 to T3: 1,000-ledger delta to `3542657`;
- T2 to T3 history reads used bounded read window `4`;
- T3 current state was built from the T2 compact rolling base rather than replaying the original release-native base and full history;
- T3 remote candidate-pair rehearsal passed;
- T3 read-only production preflight produced deterministic action `rebase`.

The rolling current-state equivalence rehearsal also proved that a 24-ledger rolling update and the legacy full-history replay produced byte-identical read-model outputs.

## Candidate workflow

Use `.github/workflows/rolling-checkpoint-candidate.yml` manually.

Required inputs:

- source history branch;
- source current-state branch;
- output history candidate branch;
- output current-state candidate branch;
- maximum delta ledgers;
- ledgers per segment;
- bounded history read window.

Conservative Devnet defaults are:

- maximum delta: `1000`;
- segment size: `250`;
- read window: `4`.

The workflow is candidate-only. It must not update `history-data`, `current-state-data`, D1, Worker deployment, or cron schedules.

## Source-pair gate

Before a cycle starts, the source history terminal and source current-state identity must match exactly:

- epoch;
- ledger index;
- ledger hash.

If a compact rolling base exists, its ledger identity must also match the same source terminal. Otherwise the cycle may bootstrap from the source read model.

A cycle must fail closed if the live validated head is not ahead of the source terminal.

## Delta gate

The target is fixed before generation and must be no farther than the configured maximum delta width.

Every generated segment must preserve:

- exact requested start and end ledger identity;
- parent-hash continuity;
- predecessor segment ID;
- predecessor terminal hash;
- deterministic manifest/file digests.

The full delta chain must verify against the fixed target ledger and target ledger hash before publication construction.

## Exact-index gate

The rolling workflow uses the incremental exact-index builder.

The proven optimization is:

1. verify source exact-index manifest and every source bucket digest;
2. require source buckets to already be sorted;
3. extract and sort only delta records;
4. linearly merge each source bucket with its delta bucket;
5. write a target manifest bound to the target publication.

The T2-to-T3 rehearsal requires manifest-referenced target assets and target manifest to match the full rebuild byte for byte.

Full exact-index rebuilds must clean their output directory before writing a new layout. Manifest-unreferenced stale files are not canonical data and must not survive rebuilds.

## Current-state gate

The rolling current-state builder must:

- verify source base identity against the extension source terminal;
- apply only ordered delta mutation records;
- fail on stale or conflicting mutation positions;
- preserve projection/object kind consistency;
- generate the normal read model;
- generate a new 64-segment compact rolling base;
- require read-model and rolling-base object counts to agree.

Remote candidate rehearsal must pass before any production preflight.

## Read-only production preflight

A production preflight must perform no writes.

It must bind:

- exact history candidate commit SHA;
- exact current-state candidate commit SHA;
- publication digest;
- current-state manifest digest;
- target snapshot ID;
- target ledger index and hash.

It must read current production evidence directly from D1 using SELECT-only queries:

- `sync_state`;
- current `network_epochs` row;
- `current_state_overlay_state` rows for the active epoch.

It must refresh the latest observed ledger using a live validated-head RPC and run the deterministic replacement-base planner.

Only `rebase` or `replay` is acceptable.

## D1 headroom gate

Candidate generation and read-only preflight do not imply permission to cut over.

The current conservative production-write gate is:

- remaining daily D1 rows written: at least `10,000`;
- sufficient read headroom for final validation and diagnostics;
- no collector error or consecutive failure state.

The retained T3 preflight measured only `7,676` remaining write rows, so production cutover is blocked even though the deterministic planner returned `rebase`.

Do not lower this gate merely to force a cutover.

## Guarded cutover order

When all gates pass, the required order is:

1. re-run candidate rehearsal and exact SHA binding;
2. re-check D1 headroom immediately before writes;
3. rebuild fresh D1/live-head preflight;
4. promote exact history candidate;
5. deploy the fixed replacement target with temporary bounded trigger cadence;
6. wait for guarded D1 rebase and require `replayed` alignment;
7. promote exact current-state candidate only after rebase confirmation;
8. restore protected cadence;
9. verify replacement-base, history-source, collector, and Overview alignment;
10. reconcile canonical main configuration with production reality.

If history was promoted but rebase never aligned, history promotion must be rolled back to the exact pre-cutover SHA. D1 cursor rollback must not be improvised.

## Next milestone

The next milestone is not M6.

The next milestone is to demonstrate repeated rolling cycles with:

- bounded delta generation;
- stable windowed history reads;
- incremental exact-index updates;
- compact rolling-base current-state updates;
- remote candidate rehearsal;
- read-only production preflight;
- acceptable D1 resource headroom for guarded cutover;
- production freshness sufficient to resume M5-5 browser evidence.
