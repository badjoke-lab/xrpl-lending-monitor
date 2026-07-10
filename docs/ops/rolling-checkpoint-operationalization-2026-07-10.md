# Rolling checkpoint operationalization — 2026-07-10

## Status

XRPL Lending Monitor has moved from one-time fixed-target recovery into rolling checkpoint operationalization on XRPL Devnet.

The successful T5 fixed-target cutover established the current production base at ledger `3539657` with replacement snapshot `devnet-3539657-747554dd57de`. Production history uses verified hybrid mode: immutable canonical history through the replacement boundary plus bounded D1 live-tail continuation after that boundary.

The production Worker remains on the protected four-hour schedule while rolling checkpoint operation is being proven. The protection schedule is not a catch-up strategy. Large backlog catch-up is intentionally moved out of the Worker/D1 hot path.

## Why the architecture changed

Retained production evidence showed that the main bottleneck was D1 persistence cost, not XRPL transport capacity.

The accepted operating direction is therefore:

```text
verified history/current-state source pair
  -> bounded fixed target
  -> immutable delta history
  -> chain verification
  -> incremental exact-index update
  -> rolling current-state update
  -> isolated candidate branches
  -> remote candidate rehearsal
  -> read-only fail-closed preflight
  -> separately guarded production promotion
  -> bounded Worker live-tail continuation
```

The Worker is not expected to replay or persist an unbounded backlog into D1.

## Retained proof points

The following proof points exist before this reusable workflow standardization:

1. T1 production fixed-target recovery cutover completed successfully.
2. A rolling current-state builder was added and validated against full replay with byte-identical read-model output.
3. A rolling exact-index builder was added and validated against full rebuild output.
4. Bounded history read windows were added with byte-equivalence evidence.
5. Incremental exact-index bucket processing was changed to validate the sorted base, sort only delta records, and merge linearly.
6. A T2 rolling candidate pair was published and its retained evidence recovery workflow passed.
7. The T2 read-only fail-closed production preflight passed.
8. A subsequent T3 rolling candidate pair was published from a rolling current-state base and its retained evidence recovery workflow passed.
9. The T3 read-only fail-closed production preflight passed.
10. The reusable candidate-only rolling checkpoint workflow is merged into `main`.
11. This change standardizes the reusable read-only preflight workflow.

The temporary T2 and T3 operational PRs were evidence vehicles. Their candidate branches and retained workflow evidence prove the repeated path without making those temporary workflows part of the permanent production control plane.

## Permanent workflow boundary

### Candidate workflow

The reusable candidate workflow accepts:

- source history branch;
- source current-state branch;
- output history candidate branch;
- output current-state candidate branch;
- maximum delta width;
- segment width;
- bounded history read window.

It freezes a bounded target, generates and verifies delta history, updates the exact index incrementally, builds current state from an existing rolling base when available, publishes isolated candidate branches, rehearses the remote pair, and retains evidence.

It performs no production branch promotion, D1 write, Worker deployment, cron change, or M6 work.

### Preflight workflow

The reusable preflight workflow accepts candidate history and current-state branches, then:

- rehearses the exact remote candidate pair;
- binds exact candidate commit SHAs;
- reads production sync, epoch, and overlay evidence through SELECT-only D1 queries;
- refreshes the evidence with the live validated Devnet head;
- builds the existing fail-closed replacement-base preflight bundle;
- captures current UTC-day D1 use and remaining headroom;
- retains a compact evidence summary.

It also performs no production branch promotion, D1 write, Worker deployment, cron change, guarded rebase execution, current-state promotion, or M6 work.

## Production promotion remains separate

Candidate generation and preflight success do not authorize production promotion by themselves.

A future reusable guarded promotion path must preserve the successful T1 safety properties:

1. exact candidate branch SHA binding;
2. publication/current-state identity binding;
3. fresh production sync/epoch/overlay evidence;
4. live validated head at or beyond the candidate target;
5. fail-closed rebase or replay plan;
6. D1 write-headroom gate with rollback margin;
7. exact history source promotion order;
8. temporary cadence only when required for guarded rebase execution;
9. replacement-base `replayed` alignment before current-state promotion;
10. protected cadence restoration in success and cleanup paths;
11. final history/current-state/cursor/overlay/source invariants;
12. retained operational evidence.

No generic production-write workflow should be enabled until these controls are preserved without hard-coded T1 identities.

## Current blockers and next order

The next order is:

1. merge and validate the reusable read-only preflight workflow;
2. run the reusable candidate workflow on the next bounded rolling cycle;
3. run the reusable read-only preflight against that exact candidate pair;
4. compare retained candidate/preflight evidence against the successful T1 cutover safety contract;
5. implement the smallest reusable guarded promotion path with exact identity inputs and cleanup-safe cadence restoration;
6. execute production promotion only after fresh D1 headroom and fail-closed preflight gates pass;
7. validate post-promotion live-tail continuation, cursor movement, failures, lag, and D1 burn;
8. repeat enough cycles to establish ordinary operation rather than one-time recovery;
9. only then resume production-shaped M5-5 browser evidence;
10. keep M6 blocked until M5-5 exits.

Mainnet remains disabled.
