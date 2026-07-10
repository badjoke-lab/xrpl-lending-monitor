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
  -> canonical production-config reconciliation
  -> bounded Worker live-tail continuation
```

The Worker is not expected to replay or persist an unbounded backlog into D1.

## Retained proof points

The following proof points exist before guarded promotion standardization:

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
11. The reusable read-only fail-closed preflight workflow is merged into `main`.
12. This change introduces the smallest reusable guarded production-promotion path while keeping execution manual and identity-pinned.

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

### Guarded production promotion workflow

The reusable guarded promotion workflow is manual and requires:

- candidate history branch name;
- candidate current-state branch name;
- exact 40-character HEAD SHA for each candidate branch;
- explicit production-write authorization.

Target ledger, ledger hash, publication digest, snapshot ID, and current-state manifest digest are derived from the SHA-pinned candidate artifacts and cross-checked against the remote candidate rehearsal. They are not trusted as free-form operator inputs.

Before production writes, the workflow:

1. binds local and remote candidate branch HEADs to the supplied exact SHAs;
2. cross-checks publication, exact-index, current-state summary, manifest, and channel identities;
3. re-runs the remote candidate-pair rehearsal;
4. captures production history/current-state branch heads;
5. pins the pre-promotion production history ref locally for rollback;
6. captures fresh production sync, epoch, and overlay evidence through SELECT-only D1 queries;
7. requires canonical `wrangler.jsonc` rollback-base identity and protected cron to match the current production D1 base before any write;
8. refreshes the evidence with the live validated Devnet head;
9. rebuilds the fail-closed rebase/replay preflight bundle;
10. requires current UTC-day D1 write headroom with rollback margin;
11. renders target-bound temporary-minute and protected-four-hour Worker configs;
12. rechecks candidate branch HEADs immediately before production writes.

The production sequence is:

```text
promote exact history candidate
  -> confirm production history source identity
  -> detect existing target rebase alignment
  -> temporary minute cadence only when rebase is pending
  -> require replacement-base replay alignment
  -> promote exact current-state candidate
  -> deploy protected four-hour target config
  -> verify history/current-state/cursor/overlay/source invariants
```

Cleanup behavior is fail-closed:

- after a confirmed rebase, current-state promotion is retried in an `always()` path;
- after any temporary minute deployment, a four-hour protected Worker configuration is restored;
- if rebase is not confirmed, the original Worker configuration is restored and a history promotion performed by the workflow is rolled back with force-with-lease to the locally pinned pre-promotion ref;
- unexpected production branch movement is never overwritten blindly.

A successful promotion emits `canonicalConfigReconciliationRequired: true`. The canonical `wrangler.jsonc` target identity must be reconciled to the successful production target before another guarded promotion is allowed. The promotion workflow itself enforces this by requiring the canonical rollback base to match current D1 production state at the start of each run.

This workflow must not be used until its PR CI is green and an exact candidate pair has separately passed the reusable read-only preflight workflow.

## Production promotion remains separate from candidate generation

Candidate generation and preflight success do not authorize production promotion by themselves.

The reusable guarded promotion path preserves the successful T1 safety properties:

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
12. retained operational evidence;
13. mandatory canonical config reconciliation before another production cycle.

Production execution remains manual. A merged workflow is an operational tool, not automatic authorization to run a promotion.

## Current blockers and next order

The next order is:

1. merge and validate the reusable guarded promotion workflow;
2. run the reusable candidate workflow on the next bounded rolling cycle;
3. run the reusable read-only preflight against that exact candidate pair;
4. compare candidate and preflight retained evidence against the pinned target identity;
5. execute guarded production promotion only after fresh D1 headroom and fail-closed preflight gates pass;
6. immediately reconcile canonical `wrangler.jsonc` target identity and production current-state source after successful promotion, before another production cycle;
7. validate post-promotion live-tail continuation, cursor movement, failures, lag, and D1 burn;
8. repeat enough production cycles to establish ordinary operation rather than one-time recovery;
9. only then resume production-shaped M5-5 browser evidence;
10. keep M6 blocked until M5-5 exits.

Mainnet remains disabled.
