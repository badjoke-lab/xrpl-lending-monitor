# T5 production-scale bulk history evidence — 2026-07-10

## Status

This document records retained non-production Devnet evidence for the production-eligible T5 fixed-target bulk history generation path.

This evidence does not authorize production cutover. Production remains on the protected four-hour WSS32 window-4 cadence. M5-5 remains incomplete. M6 has not started.

## Frozen production-eligible target

Read-only production evidence was captured before bulk generation. The target was chosen from the validated observed head and was strictly ahead of the active D1 cursor.

- production cursor at capture: `3502426`;
- fixed target ledger: `3536520`;
- fixed target hash: `6462640F28B507F09A1AD4E9A5E9B1378080D73D9B0CE235CBB4C413F97890C9`;
- cursor-to-target distance at capture: `34,094` ledgers;
- read-only replacement-base planner result: `rebase`.

The immutable extension plan started immediately after the active history publication terminal:

- source terminal ledger: `3432924`;
- source terminal hash: `52C13CBFFC3433750DBBB986390C4C6E6F7CC82CF70B4B909C506536A8BD9218`;
- extension range: `3432925..3536520`;
- extension ledger count: `103,596`;
- segment ledger limit: `500`;
- extension segment count: `208`.

## Parallel shard strategy

PR #327 added deterministic frozen-plan shard partitioning and proved the model on a small real Devnet range before the production-scale run.

The production-scale extension was split into eight contiguous shards. Every shard:

- used segment descriptors from the same frozen extension plan;
- resolved one fixed predecessor-ledger hash before generation;
- generated segments sequentially within the shard;
- used bounded per-segment retries;
- maintained a shard-local anchored checkpoint;
- uploaded an immutable retained shard artifact.

After all eight shards completed, the verifier reconstructed the original plan order across all manifests and required both:

1. exact plan-bound artifact realization for all 208 segments;
2. full source-terminal-to-target chain continuity.

## Production-scale run result

Workflow run `29076859742` completed the full non-production generation and verification path.

All eight shard generation jobs succeeded.

Retained shard artifacts:

- shard 1: `8221414460`;
- shard 2: `8221431273`;
- shard 3: `8221413110`;
- shard 4: `8221747507`;
- shard 5: `8221454010`;
- shard 6: `8221467282`;
- shard 7: `8222164927`;
- shard 8: `8221693543`.

Plan artifact: `8221085685`.
Final result artifact: `8222184179`.

Final verified extension evidence:

- generated ledgers: `103,596`;
- generated segments: `208`;
- frozen-plan verification: passed;
- extension chain verification: passed;
- verified start ledger: `3432925`;
- verified end ledger: `3536520`;
- verified terminal hash: `6462640F28B507F09A1AD4E9A5E9B1378080D73D9B0CE235CBB4C413F97890C9`.

## Full publication result

The verified 208-segment extension was appended to the existing 123-segment immutable source prefix using the source-bound extended publication builder.

Result:

- chain ID: `canonical-devnet-3371676-3536520`;
- publication segment count: `331`;
- publication ledger count: `164,845`;
- start ledger: `3371676`;
- terminal ledger: `3536520`;
- terminal hash: `6462640F28B507F09A1AD4E9A5E9B1378080D73D9B0CE235CBB4C413F97890C9`;
- publication SHA-256: `adc81c029b3c424757de063225665910036dff59b5fc47997fa7537e7124feda`.

## Dense-region evidence

The production-scale run crossed the same type of dense backlog region that had caused the Worker/D1 hot path to become persistence-limited.

One retained high-density shard covered 13,000 ledgers and completed successfully with bounded retries. Its aggregate logical records included approximately:

- `67,698` object changes;
- `4,535` protocol events;
- `5,396` current-projection mutations.

A single 500-ledger segment in the dense region contained more than `21,000` total records, yet the immutable Actions-side generator completed within the configured retry ceiling.

This is important because it demonstrates that the dense backlog can be processed outside D1 without relying on higher Worker transport capacity or sustained D1 history writes.

## Target-near density observation

The newest-side shard was also generated successfully. Although the shard contained historically dense intervals, the final target-near portion was materially lighter than the earlier dense backlog region.

The final 1,096-ledger neighborhood before the frozen target contained approximately:

- `3,143` object changes;
- `212` protocol events;
- `302` current-projection mutations.

The final 96-ledger segment contained `233` total logical records.

This does not prove that every future live-tail interval will remain light. It does show that the dense backlog bottleneck was not uniformly distributed through the target-near region and supports a separate bounded live-tail validation after cutover.

## What is now proved

The retained evidence now proves, at the real backlog scale used for the recovery plan, that the system can:

1. bind a production-eligible fixed target from read-only evidence;
2. construct a 103,596-ledger immutable extension plan;
3. partition 208 frozen segments into independently anchored parallel shards;
4. process dense historical regions outside the Worker/D1 hot path;
5. retain every shard artifact;
6. reconstruct all 208 manifests in original plan order;
7. verify exact frozen-plan realization;
8. verify full hash continuity from the existing immutable terminal to the target;
9. build a 331-segment full publication ending at the exact frozen target.

The earlier uncertainty about whether the backlog-scale immutable generation path itself would work is therefore materially reduced.

## Still pending

The following are still pending and must not be claimed as complete:

- absorb the post-bulk T0-to-T1 delta to a newer fixed validated head;
- rebuild the T1 exact index;
- rebuild replacement current state at the same T1 ledger/hash;
- publish dedicated real T1 candidate branches;
- pass remote candidate history/current-state rehearsal at T1;
- build a retained cutover preflight bundle binding candidate commit SHAs, publication digest, current-state manifest digest, target identity, and fresh production cursor/overlay evidence;
- activate the production history source;
- execute the guarded same-epoch D1 rebase;
- activate the matching production current-state source;
- resume and validate bounded live-tail collection;
- complete M5-5 production-shaped browser evidence and exit reconciliation.

## Active next gate

The active next gate is the post-bulk delta and real candidate-pair run. It consumes the retained T0 bulk artifacts, freezes a new T1 validated head, generates only the T0-to-T1 delta, then rebuilds and aligns:

- T1 immutable history publication;
- T1 exact history index;
- T1 replacement current state;
- dedicated T1 history and current-state candidate branches;
- remote current list/exact and immutable exact/recent history reads.

Production cutover remains blocked until that gate and the fresh cutover preflight gate pass.
